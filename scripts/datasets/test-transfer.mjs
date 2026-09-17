/** Integration test: original Lake View snapshot + custom local edit -> additive
 * Uttam Nagar transfer -> exact verification -> safe repeat -> collision refusal.
 * Uses an exclusively created test DB and bucket; never clears the user's data.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectRoot,repositoryEnvironment} from '../repo-env.mjs';
import {loadBundle,installBundle,verifyBundle,schema,canonical,digest,identifier} from './bundle.mjs';
const root=projectRoot(),env=repositoryEnvironment(),require=createRequire(resolve(root,'apps/web/package.json'));
const {Pool}=require('pg'),sdk=require('@aws-sdk/client-s3');
const name='ulpin_transfer_test_'+Date.now(),bucket=name.replaceAll('_','-');
assert.match(name,/^ulpin_transfer_test_[0-9]+$/);
const admin=new Pool({connectionString:env.DATABASE_URL}),url=new URL(env.DATABASE_URL);url.pathname='/'+name;
const target={...env,DATABASE_URL:url.href,S3_BUCKET:bucket};
const pool=new Pool({connectionString:target.DATABASE_URL});
const s3=new sdk.S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
const report={startedAt:new Date().toISOString(),database:name,bucket,result:'RUNNING',checks:[]};
const pass=text=>{report.checks.push(text);console.log('PASS '+text);};
let createdDb=false,createdBucket=false;
async function fingerprints(client){
  const result={};
  for(const table of Object.keys((await schema(client)).tables))result[table]=new Set((await client.query(`SELECT row_to_json(t)::text AS row FROM public.${identifier(table)} t`)).rows.map(r=>digest(canonical(JSON.parse(r.row)))));
  return result;
}
function subset(before,after){for(const [table,rows] of Object.entries(before))for(const hash of rows)assert(after[table].has(hash),'Existing row changed: '+table);}
try{
  await admin.query(`CREATE DATABASE ${identifier(name)}`);createdDb=true;
  await s3.send(new sdk.CreateBucketCommand({Bucket:bucket}));createdBucket=true;
  await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
  const restore=spawnSync('docker',['exec','-i','ulpin-repo-postgres-1','pg_restore','-U',env.POSTGRES_USER,'-d',name,'--no-owner','--no-acl','--exit-on-error','--single-transaction','--schema=public'],{input:await readFile(resolve(root,'repo-data/database.dump')),maxBuffer:10*1024*1024});
  assert.equal(restore.status,0,String(restore.stderr));
  const migration=spawnSync(process.execPath,['--import','tsx','scripts/migrate.ts'],{cwd:root,env:{...process.env,...target,REPO_DATA:'false'},encoding:'utf8',maxBuffer:10*1024*1024});
  assert.equal(migration.status,0,migration.stderr);
  await pool.query("UPDATE map_areas SET name='Test-only teammate edit: Lake View' WHERE id='0ded05d3-b596-46a8-9918-ab1bc0a433be'");
  const sentinelId=randomUUID();
  await pool.query('INSERT INTO cases(id,name,frame) VALUES($1,$2,$3)',[sentinelId,'Transfer test: pre-existing unrelated case',{id:'LOCAL-TRANSFER-TEST',horizontalUnit:'m',verticalUnit:'m',benchmark:'TEST'}]);
  await s3.send(new sdk.PutObjectCommand({Bucket:bucket,Key:'_test/preexisting.txt',Body:'Retain this unrelated original',ContentType:'text/plain'}));
  const client=await pool.connect();
  try{
    await client.query("SET TIME ZONE 'UTC'");
    const before=await fingerprints(client),bundle=await loadBundle(resolve(root,'data-bundles/uttam-nagar'));
    report.firstInstall=await installBundle(client,s3,sdk,target,bundle);
    assert.equal(report.firstInstall.alreadyInstalled,false);
    assert(report.firstInstall.insertedRows>0);assert(report.firstInstall.uploadedObjects>0);
    pass('Installed all six areas into a separate database containing the original snapshot and unrelated local changes');
    subset(before,await fingerprints(client));
    const sentinel=await s3.send(new sdk.GetObjectCommand({Bucket:bucket,Key:'_test/preexisting.txt'}));
    assert.equal(await sentinel.Body.transformToString(),'Retain this unrelated original');
    pass('Every pre-existing database row and unrelated storage object remained unchanged');
    report.exactVerification=await verifyBundle(client,s3,sdk,target,bundle,true);
    pass('All transferred row values, PostGIS geometry, source bytes and source metadata match exactly');
    const first=await fingerprints(client),second=await installBundle(client,s3,sdk,target,bundle);
    assert(second.alreadyInstalled);assert.deepEqual(await fingerprints(client),first);
    pass('Second install is a no-op, with no duplicated data');
    const area=bundle.manifest.areas[0],edited='Test-only edited Uttam Nagar';
    await client.query('UPDATE map_areas SET name=$1 WHERE id=$2',[edited,area.id]);
    const repeat=await installBundle(client,s3,sdk,target,bundle);assert.equal(repeat.changedRows,1);
    assert.equal((await client.query('SELECT name FROM map_areas WHERE id=$1',[area.id])).rows[0].name,edited);
    pass('Repeated install preserves subsequent Uttam Nagar edits');
    await client.query('DELETE FROM dataset_bundle_installs WHERE id=$1',[bundle.manifest.id]);
    const conflictBefore=await fingerprints(client);
    await assert.rejects(installBundle(client,s3,sdk,target,bundle),/rows differ/);
    assert.deepEqual(await fingerprints(client),conflictBefore);
    pass('An untracked conflicting identity is rejected without overwriting any data');
    await client.query('UPDATE map_areas SET name=$1 WHERE id=$2',[area.name,area.id]);
    const adopted=await installBundle(client,s3,sdk,target,bundle);assert.equal(adopted.insertedRows,0);
    pass('Existing exact saved data can be adopted without duplication');
  }finally{client.release();}
  report.result='PASS';
}catch(error){report.result='FAIL';report.error=String(error);console.error(error.message);process.exitCode=1;}
finally{
  await pool.end();
  if(createdDb){await admin.query(`DROP DATABASE ${identifier(name)}`).catch(e=>{report.cleanupError=e.message;});}
  if(createdBucket){
    let token;
    do{const listed=await s3.send(new sdk.ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));if(listed.Contents?.length)await s3.send(new sdk.DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:listed.Contents.map(o=>({Key:o.Key}))}}));token=listed.NextContinuationToken;}while(token);
    await s3.send(new sdk.DeleteBucketCommand({Bucket:bucket}));
  }
  await admin.end();s3.destroy();report.finishedAt=new Date().toISOString();
  await mkdir(resolve(root,'.runtime/transfer-tests'),{recursive:true});
  await writeFile(resolve(root,'.runtime/transfer-tests',name+'.json'),JSON.stringify(report,null,2));
  console.log('Transfer acceptance: '+report.result);
}

/** Maintainer-only: snapshot the six reviewed Uttam Nagar areas without exporting
 * other projects, credentials, role definitions or execution queues. Run with
 * the app stopped. A bundle is immutable: this command refuses to overwrite it.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {projectRoot,repositoryEnvironment,repositoryMode,baseEnvironment} from '../repo-env.mjs';
import {canonical,digest,schema,rowKey,insertionOrder,validateGraph,identifier} from './bundle.mjs';

const root=projectRoot(),out=resolve(root,'data-bundles/uttam-nagar');
assert(repositoryMode(),'Select REPO_DATA=true before exporting');
assert(!existsSync(out),'Bundle directory already exists. Do not overwrite a published seed.');
const ids=[
  '276dc595-97c4-4253-bf47-db4a12fd542b','457bac4c-1c6c-4157-a12a-1d44ba3c1bcf',
  '9bb67cbc-9773-4cee-ad1a-df29fc6c23a5','eb82b76d-84cc-4fd0-ae93-b4a229fc4837',
  'd1b4ca2e-378e-4b43-8c34-04406dbb285b','6a190c0f-3940-4dc4-b5b6-c2e8fbd26f16',
];
const env=repositoryEnvironment(),require=createRequire(resolve(root,'apps/web/package.json'));
const {Pool}=require('pg'),sdk=require('@aws-sdk/client-s3');
const pool=new Pool({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000});
const s3=new sdk.S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
const client=await pool.connect();
const local=baseEnvironment(),secrets=[env.POSTGRES_PASSWORD,env.S3_SECRET_KEY,env.GEO_SERVICE_TOKEN,local.NOUS_API_KEY].filter(v=>v&&v.length>8);
function checkSecret(bytes){for(const s of secrets)assert(!Buffer.from(bytes).includes(Buffer.from(s)),'A local credential was found; export refused');}
try{
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TIME ZONE 'UTC'");
  const structure=await schema(client),all={},selected={};
  for(const [name,table] of Object.entries(structure.tables)){
    assert(table.primaryKey.length,`No primary key: ${name}`);
    all[name]=(await client.query(`SELECT row_to_json(t)::text AS value FROM public.${identifier(name)} t`)).rows.map(r=>JSON.parse(r.value));
    selected[name]=new Map();
  }
  const sites=all.map_areas.filter(r=>ids.includes(r.id));assert.equal(sites.length,6);
  assert(sites.every(r=>/Uttam Nagar/.test(r.name)&&!r.archived_at));
  const siteIds=new Set(sites.map(s=>s.site_id)),caseIds=new Set(all.cases.filter(c=>siteIds.has(c.site_id)).map(c=>c.id));
  function add(name,row){const map=selected[name],key=rowKey(row,structure.tables[name].primaryKey);const n=map.size;map.set(key,row);return map.size!==n;}
  for(const [name,rows] of Object.entries(all))for(const row of rows){
    if((name==='registry_sites'&&siteIds.has(row.id)) || (name==='map_areas'&&ids.includes(row.id)) ||
       siteIds.has(row.site_id)||ids.includes(row.area_id)||caseIds.has(row.case_id)||(name==='cases'&&caseIds.has(row.id)))add(name,row);
  }
  // Child history/link tables without their own scope column inherit membership.
  let changed=true;
  while(changed){changed=false;
    for(const fk of structure.fks){
      if(!all[fk.child]||!selected[fk.parent])continue;
      const cols=structure.tables[fk.child].columns;
      if(['registry_sites','map_areas','cases'].includes(fk.child)||cols.some(c=>['site_id','area_id','case_id'].includes(c)))continue;
      const parents=new Set([...selected[fk.parent].values()].map(r=>rowKey(r,fk.targets)));
      for(const row of all[fk.child])if(fk.columns.every(c=>row[c]!==null)&&parents.has(rowKey(row,fk.columns)))changed=add(fk.child,row)||changed;
    }
  }
  // Complete dependencies without turning shared administrative metadata into a
  // downward traversal of unrelated datasets.
  changed=true;
  while(changed){changed=false;
    for(const fk of structure.fks){
      if(!selected[fk.child])continue;
      const parents=new Map((all[fk.parent]||[]).map(r=>[rowKey(r,fk.targets),r]));
      for(const row of selected[fk.child].values()){
        if(fk.columns.some(c=>row[c]===null))continue;
        const parent=parents.get(rowKey(row,fk.columns));assert(parent,`Missing live dependency ${fk.parent}`);
        changed=add(fk.parent,parent)||changed;
      }
    }
  }
  assert.equal(selected.registry_sites.size,6,'Scope escaped the requested sites');
  assert.equal(selected.map_areas.size,6,'Scope escaped the requested areas');
  assert([...selected.cases.values()].every(c=>siteIds.has(c.site_id)),'Unrelated case dependency');
  assert([...selected.jobs.values()].every(j=>['succeeded','failed','stale'].includes(j.status)),'Wait for active jobs before exporting');
  const tables={};
  for(const [name,map] of Object.entries(selected))if(map.size)tables[name]={...structure.tables[name],rows:[...map.values()].sort((a,b)=>rowKey(a,structure.tables[name].primaryKey).localeCompare(rowKey(b,structure.tables[name].primaryKey)))};
  const foreignKeys=structure.fks.filter(f=>tables[f.child]);
  validateGraph(tables,foreignKeys);
  const payload={id:'uttam-nagar-2026-09-17-v1',tables,foreignKeys,order:insertionOrder(tables,foreignKeys)};
  const data=Buffer.from(JSON.stringify(payload));checkSecret(data);
  const compressed=gzipSync(data,{level:9});
  await mkdir(resolve(out,'objects'),{recursive:true});
  const objects=[];
  for(const source of tables.sources.rows){
    const response=await s3.send(new sdk.GetObjectCommand({Bucket:env.S3_BUCKET,Key:source.object_key}));
    const bytes=Buffer.from(await response.Body.transformToByteArray()),sha256=digest(bytes);
    assert.equal(sha256,source.sha256);assert.equal(bytes.length,Number(source.bytes));checkSecret(bytes);checkSecret(canonical(response.Metadata||{}));
    const extension={'application/pdf':'pdf','image/png':'png','application/json':'json','application/geo+json':'geojson','text/plain':'txt','text/csv':'csv'}[response.ContentType]||'bin';
    const file=`objects/${sha256}.${extension}`;
    await writeFile(resolve(out,file),bytes);
    objects.push({key:source.object_key,file,sha256,bytes:bytes.length,contentType:response.ContentType||'application/octet-stream',metadata:response.Metadata||{}});
  }
  const areas=sites.map(a=>{
    const features=tables.physical_features.rows.filter(f=>f.area_id===a.id&&f.revision>0);
    const records=tables.registry_records.rows.filter(r=>r.site_id===a.site_id&&r.revision>0);
    return {id:a.id,name:a.name,siteId:a.site_id,classification:features.every(f=>f.body.worldStatus==='observed')?'reference':'fictional',features:features.length,buildings:features.filter(f=>f.body.kind==='building').length,roads:features.filter(f=>f.body.kind==='road').length,parcels:features.filter(f=>f.body.kind==='parcel').length,floors:records.filter(r=>r.kind==='floor').length,spaces:records.filter(r=>r.kind==='space').length};
  });
  const manifest={version:1,id:payload.id,createdAt:new Date().toISOString(),areas,database:{file:'rows.json.gz',sha256:digest(compressed),bytes:compressed.length},tables:Object.values(tables).map(t=>({name:t.name,rows:t.rows.length,sha256:digest(canonical(t.rows))})),objects:objects.sort((a,b)=>a.key.localeCompare(b.key)),licence:'ODbL-1.0 (Google Open Buildings V3 ODbL option; OpenStreetMap boundary/road data). Authored demo sources explicitly marked fictional.',provenance:'Append-only saved-state transfer of six Uttam Nagar reference/scenario areas. Includes actual previously reviewed geometry, original files, fictional room/shared-use records and recorded history; not official title or resident data.',exclusions:['Local credentials and .env files','PostgreSQL roles','Redis queue/cache','Other areas such as Lake View and Bronx','Browser-local notes','7.19 GB regional Google download and 236 MB Delhi-wide extract']};
  await writeFile(resolve(out,'rows.json.gz'),compressed);
  await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await client.query('COMMIT');
  console.log(JSON.stringify({areas:areas,rows:manifest.tables.reduce((n,t)=>n+t.rows,0),tables:manifest.tables.length,objects:objects.length,compressedDatabaseBytes:compressed.length},null,2));
}finally{await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();s3.destroy();}

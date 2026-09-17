/** Append-only transfer of a bounded, reviewed dataset. Not a general SQL restore.
 * Database constraints stay enabled; collisions never overwrite user records.
 * Storage keys are immutable and checked before any database insertion.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {gunzipSync} from 'node:zlib';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k,normalize(value[k])]));
  return value;
}
export function identifier(name) {
  assert.match(name,/^[a-z_][a-z0-9_]*$/,'Unsafe database identifier');
  return '"'+name+'"';
}
export function inside(root,name) {
  const file=resolve(root,name),rel=relative(root,file);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel),'Bundle path escapes its directory');
  return file;
}
export async function schema(client) {
  const columns=(await client.query(`SELECT c.table_name,c.column_name,c.udt_name FROM information_schema.columns c
    JOIN pg_tables t ON t.schemaname=c.table_schema AND t.tablename=c.table_name
    WHERE c.table_schema='public' AND c.table_name NOT IN ('spatial_ref_sys','repo_data_state','dataset_bundle_installs')
    ORDER BY c.table_name,c.ordinal_position`)).rows;
  const keys=(await client.query(`SELECT c.relname AS name, array_agg(a.attname::text ORDER BY u.ord) AS columns
    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY u(attnum,ord)
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.attnum
    WHERE p.contype='p' AND n.nspname='public' GROUP BY c.relname`)).rows;
  const fks=(await client.query(`SELECT c.relname AS child, r.relname AS parent,
    array_agg(a.attname::text ORDER BY u.ord) AS columns, array_agg(b.attname::text ORDER BY u.ord) AS targets
    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_class r ON r.oid=p.confrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(p.conkey,p.confkey) WITH ORDINALITY u(cn,pn,ord)
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.cn
    JOIN pg_attribute b ON b.attrelid=r.oid AND b.attnum=u.pn
    WHERE p.contype='f' AND n.nspname='public' GROUP BY p.oid,c.relname,r.relname`)).rows;
  const tables={};
  for(const c of columns){tables[c.table_name]??={name:c.table_name,columns:[],primaryKey:keys.find(k=>k.name===c.table_name)?.columns||[]};tables[c.table_name].columns.push(c.column_name);}
  return {tables,fks};
}
export function rowKey(row,columns) { return canonical(columns.map(c=>row[c])); }
export function insertionOrder(tables,fks) {
  const remaining=new Set(Object.keys(tables)),ordered=[];
  while(remaining.size){
    const ready=[...remaining].filter(name=>!fks.some(f=>f.child===name&&f.parent!==name&&remaining.has(f.parent)&&tables[name].rows.some(r=>f.columns.every(c=>r[c]!==null))));
    assert(ready.length,'Dataset contains a non-null foreign-key cycle; no constraints were disabled');
    for(const name of ready.sort()){ordered.push(name);remaining.delete(name);}
  }
  return ordered;
}
export function validateGraph(tables,fks) {
  for(const fk of fks){
    if(!tables[fk.child])continue;
    const parent=new Set((tables[fk.parent]?.rows||[]).map(r=>rowKey(r,fk.targets)));
    for(const row of tables[fk.child].rows){
      if(fk.columns.some(c=>row[c]===null))continue;
      assert(parent.has(rowKey(row,fk.columns)),`Missing ${fk.parent} dependency in ${fk.child}`);
    }
  }
}
export async function loadBundle(directory) {
  const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
  assert.equal(manifest.version,1);assert.equal(manifest.id,'uttam-nagar-2026-09-17-v1');
  const bytes=await readFile(inside(directory,manifest.database.file));
  assert.equal(bytes.length,manifest.database.bytes);assert.equal(digest(bytes),manifest.database.sha256,'Dataset checksum mismatch');
  const payload=JSON.parse(gunzipSync(bytes,{maxOutputLength:128*1024*1024}).toString('utf8'));
  assert.equal(payload.id,manifest.id);
  for(const [name,table] of Object.entries(payload.tables)){
    identifier(name);assert.equal(table.name,name);assert(table.primaryKey.length);
    table.columns.forEach(identifier);table.primaryKey.forEach(c=>assert(table.columns.includes(c)));
    const keys=new Set();
    for(const row of table.rows){
      assert.deepEqual(Object.keys(row).sort(),[...table.columns].sort(),`Columns differ in ${name}`);
      const key=rowKey(row,table.primaryKey);assert(!keys.has(key),'Duplicate row key');keys.add(key);
    }
    const expected=manifest.tables.find(t=>t.name===name);assert(expected);
    assert.equal(table.rows.length,expected.rows);assert.equal(digest(canonical(table.rows)),expected.sha256,`Table checksum ${name}`);
  }
  assert.equal(Object.keys(payload.tables).length,manifest.tables.length);
  validateGraph(payload.tables,payload.foreignKeys);
  assert.deepEqual(insertionOrder(payload.tables,payload.foreignKeys),payload.order);
  const sources=payload.tables.sources.rows;
  assert.equal(manifest.objects.length,sources.length);
  const keys=new Set();
  for(const object of manifest.objects){
    assert(!keys.has(object.key),'Duplicate storage key');keys.add(object.key);
    const file=await readFile(inside(directory,object.file));
    assert.equal(file.length,object.bytes);assert.equal(digest(file),object.sha256,'Object checksum '+object.file);
    assert(sources.some(s=>s.object_key===object.key&&s.sha256===object.sha256&&Number(s.bytes)===object.bytes),'Unbound object in dataset');
  }
  return {directory,manifest,payload};
}
async function compareTable(client,table,exact) {
  const name=identifier(table.name),columns=table.columns.map(identifier).join(','),join=table.primaryKey.map(k=>`t.${identifier(k)}=s.${identifier(k)}`).join(' AND ');
  const result=(await client.query(`WITH seed AS (SELECT * FROM jsonb_populate_recordset(NULL::public.${name},$1::jsonb))
    SELECT count(*)::int AS found, count(*) FILTER(WHERE to_jsonb(t)=to_jsonb(s))::int AS identical
    FROM (SELECT ${columns} FROM public.${name}) t JOIN seed s ON ${join}`,[JSON.stringify(table.rows)])).rows[0];
  if(exact)assert.equal(result.identical,result.found,`Existing ${table.name} rows differ. Preserved; do not delete local data to replay this seed.`);
  return result;
}
async function checkStorage(s3,sdk,env,bundle,put=false) {
  let uploaded=0;
  for(const o of bundle.manifest.objects){
    let response;
    try{response=await s3.send(new sdk.GetObjectCommand({Bucket:env.S3_BUCKET,Key:o.key}));}
    catch(error){
      if(!put||!(error.name==='NoSuchKey'||error.$metadata?.httpStatusCode===404))throw error;
      // Atomic create-only upload. A concurrent writer cannot be overwritten.
      await s3.send(new sdk.PutObjectCommand({Bucket:env.S3_BUCKET,Key:o.key,Body:await readFile(inside(bundle.directory,o.file)),ContentType:o.contentType,Metadata:o.metadata,IfNoneMatch:'*'}));
      uploaded++;response=await s3.send(new sdk.GetObjectCommand({Bucket:env.S3_BUCKET,Key:o.key}));
    }
    assert.equal(digest(await response.Body.transformToByteArray()),o.sha256,`Stored object differs: ${o.key}`);
    assert.equal(response.ContentType,o.contentType,`Content type differs: ${o.key}`);
    assert.equal(canonical(response.Metadata||{}),canonical(o.metadata||{}),`Metadata differs: ${o.key}`);
  }
  return uploaded;
}
export async function verifyBundle(client,s3,sdk,env,bundle,exact=true) {
  await client.query("SET TIME ZONE 'UTC'");
  let rows=0,changed=0;
  for(const name of bundle.payload.order){
    const t=bundle.payload.tables[name],r=await compareTable(client,t,false);
    assert.equal(r.found,t.rows.length,`Missing ${name} rows; run data:uttam:install`);
    if(exact)assert.equal(r.identical,r.found,`Imported ${name} differs from the seed; local edits were not overwritten`);
    rows+=r.found;changed+=r.found-r.identical;
  }
  await checkStorage(s3,sdk,env,bundle);
  return {rows,changedRows:changed,objects:bundle.manifest.objects.length,areas:bundle.manifest.areas};
}
export async function installBundle(client,s3,sdk,env,bundle) {
  await client.query("SET TIME ZONE 'UTC'");
  await client.query('BEGIN');
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
    await client.query(`CREATE TABLE IF NOT EXISTS dataset_bundle_installs(id text PRIMARY KEY,sha256 text NOT NULL,installed_at timestamptz NOT NULL DEFAULT now())`);
    const marker=(await client.query('SELECT sha256 FROM dataset_bundle_installs WHERE id=$1',[bundle.manifest.id])).rows[0];
    if(marker){
      assert.equal(marker.sha256,bundle.manifest.database.sha256,'Installed bundle version differs; refusing to replace local data');
      // Same seed is already installed. Never reapply it over local edits.
      await client.query('COMMIT');
      return {alreadyInstalled:true,...await verifyBundle(client,s3,sdk,env,bundle,false)};
    }
    const actual=await schema(client);
    for(const name of bundle.payload.order){
      const t=bundle.payload.tables[name];assert(actual.tables[name],`Missing table ${name}: run db:migrate first`);
      assert.deepEqual(actual.tables[name].columns,t.columns,`Schema changed for ${name}; run matching migrations`);
      assert.deepEqual(actual.tables[name].primaryKey,t.primaryKey,`Primary key differs for ${name}`);
      await compareTable(client,t,true);
    }
    // No database data rows are written until all existing identities are checked.
    const uploaded=await checkStorage(s3,sdk,env,bundle,true);
    let inserted=0;
    for(const name of bundle.payload.order){
      const t=bundle.payload.tables[name];if(!t.rows.length)continue;
      const cols=t.columns.map(identifier).join(',');
      const result=await client.query(`INSERT INTO public.${identifier(name)} (${cols}) SELECT ${cols}
        FROM jsonb_populate_recordset(NULL::public.${identifier(name)},$1::jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(t.rows)]);
      inserted+=result.rowCount;
      const checked=await compareTable(client,t,true);
      assert.equal(checked.found,t.rows.length,`A unique-key collision prevented importing ${name}; transaction rolled back`);
    }
    await client.query('INSERT INTO dataset_bundle_installs(id,sha256) VALUES($1,$2)',[bundle.manifest.id,bundle.manifest.database.sha256]);
    await client.query('COMMIT');
    return {alreadyInstalled:false,insertedRows:inserted,uploadedObjects:uploaded,...await verifyBundle(client,s3,sdk,env,bundle,true)};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}

import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pool} from '../../apps/web/lib/server/db';
import {settings} from '../../apps/web/lib/server/config';
const mode=process.argv[2];assert(['before','after'].includes(mode));assert.equal(settings.dataMode,'linked');
const file='.runtime/ux-preservation-before.json';
const tables=['physical_feature_revisions','registry_revisions','unit_revisions'];
try {
 const client=await pool().connect();const values:Record<string,Record<string,number>>={};
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const table of tables){const {rows}=await client.query(`SELECT md5(row_to_json(t)::text) AS digest,count(*)::int AS multiplicity FROM ${table} t GROUP BY md5(row_to_json(t)::text)`);values[table]=Object.fromEntries(rows.map(r=>[r.digest,r.multiplicity]));}
  const {rows}=await client.query('SELECT md5(row_to_json(t)::text) AS digest,count(*)::int AS multiplicity FROM (SELECT id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key FROM sources) t GROUP BY md5(row_to_json(t)::text)');
  values.source_receipts=Object.fromEntries(rows.map(r=>[r.digest,r.multiplicity]));
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 if(mode==='before'){await mkdir('.runtime',{recursive:true});await writeFile(file,JSON.stringify({at:new Date().toISOString(),values}));console.log('Captured immutable revision and original receipt fingerprints.');}
 else {const before=JSON.parse(await readFile(file,'utf8'));const counts=[];for(const [name,old]of Object.entries(before.values)){for(const [hash,count]of Object.entries(old as Record<string,number>))assert((values[name][hash]??0)>=count,`Existing ${name} changed or disappeared`);const total=(v:Record<string,number>)=>Object.values(v).reduce((a,b)=>a+b,0);counts.push({table:name,before:total(old as Record<string,number>),after:total(values[name])});}await mkdir('docs/evidence/t068',{recursive:true});await writeFile('docs/evidence/t068/preservation.json',JSON.stringify({result:'PASS',scope:'Existing immutable revisions and source original receipt columns; object byte download checks are separately reported.',before:before.at,after:new Date().toISOString(),counts},null,2));console.log(JSON.stringify({result:'PASS',counts}));}
}finally{await pool().end();}

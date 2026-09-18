import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pool} from '../../apps/web/lib/server/db';
const mode=process.argv[2];assert(['before','after'].includes(mode));assert.equal(process.env.REPO_DATA,'true');
const file='.runtime/engineering/T058-preservation-before.json',out='docs/evidence/t058/verification/data-preservation.json';
const tables=['map_areas','physical_features','physical_feature_revisions','registry_records','registry_revisions','sources','units','unit_revisions'];
try{
 const client=await pool().connect();let values:Record<string,Record<string,number>>={};
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,'ulpin_repo');
 for(const name of tables){const {rows}=await client.query(`SELECT md5(row_to_json(t)::text) AS digest,count(*)::int AS multiplicity FROM ${name} t GROUP BY md5(row_to_json(t)::text)`);values[name]=Object.fromEntries(rows.map(r=>[r.digest,r.multiplicity]));}
 await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 if(mode==='before'){await writeFile(file,JSON.stringify({at:new Date().toISOString(),values}));console.log('Protected existing-row fingerprints captured before the new synthetic source upload.');}
 else{const before=JSON.parse(await readFile(file,'utf8')),counts=[];for(const name of tables){for(const [hash,count]of Object.entries(before.values[name]))assert((values[name][hash]??0)>=(count as number),`An original ${name} row changed or disappeared`);const count=(v:Record<string,number>)=>Object.values(v).reduce((a,b)=>a+b,0);counts.push({table:name,original:count(before.values[name]),after:count(values[name])});}await mkdir('docs/evidence/t058/verification',{recursive:true});await writeFile(out,JSON.stringify({kind:'protected-existing-row-multiset',result:'PASS',before:before.at,after:new Date().toISOString(),tables:counts,scope:'Existing original rows were retained. New synthetic source uploads may add rows; no claim of zero writes.'},null,2)+'\n');console.log(JSON.stringify({result:'PASS',counts}));}
}finally{await pool().end();}

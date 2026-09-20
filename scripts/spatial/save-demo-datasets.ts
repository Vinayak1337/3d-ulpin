// Explicit local operation: save/reuse the two authorized fictional source datasets. Never overwrites a dataset.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {saveSpatialDataset,listSpatialDatasets,readSpatialDatasetOriginal} from '../../apps/web/lib/server/spatial-datasets';
import {readObject,sha256} from '../../apps/web/lib/server/storage';
import {pool,query} from '../../apps/web/lib/server/db';
import {normalizeReferencePackage} from '../../apps/web/features/spatial/reference-import/browser';
async function main(){
 const before=await listSpatialDatasets();
 await assert.rejects(saveSpatialDataset('invalid.json',new TextEncoder().encode('{"bad":true}')));
 assert.equal((await listSpatialDatasets()).length,before.length);
 const results=[];
 for(const file of ['lake-view-complete.zip','provided-master.zip']){
  const bytes=new Uint8Array(await readFile('apps/web/public/reference/'+file));
  const [saved,replayed]=await Promise.all([saveSpatialDataset(file,bytes),saveSpatialDataset(file,bytes)]);
  assert.equal(saved.id,replayed.id,'duplicate/concurrent imports must reuse the durable dataset');
  const readback=await readSpatialDatasetOriginal(saved.id);assert.equal(sha256(readback.bytes),sha256(bytes));
  const normalized=await normalizeReferencePackage(file,bytes);
  const row=(await query('SELECT * FROM spatial_datasets WHERE id=$1',[saved.id])).rows[0];
  assert.deepEqual(row.canonical_input,normalized.canonical.input);
  assert.deepEqual(row.normalized_source,JSON.parse(normalized.receipt.normalizedText));
  assert.equal(row.digest,normalized.render.scene.canonicalSnapshotDigest);
  const sourceRows=(await query('SELECT id,name,object_key,sha256,bytes FROM sources WHERE case_id=$1',[row.case_id])).rows;
  assert.equal(sourceRows.length,normalized.receipt.files.size+1);
  for(const source of sourceRows){const actual=await readObject(source.object_key);assert.equal(sha256(actual),source.sha256);assert.equal(actual.length,Number(source.bytes));const expected=source.id===row.original_source_id?bytes:normalized.receipt.files.get(source.name);assert.ok(expected);assert.equal(sha256(actual),sha256(expected));}
  assert.equal(row.source_bindings.filter((b:any)=>b.canonicalSourceId).length,normalized.render.scene.sources.length);
  results.push({...saved,verifiedOriginals:sourceRows.length,concurrentReplaySameId:true,canonicalSnapshotEqual:true});
 }
 await writeFile('docs/engineering-plan/evidence/t083/persistence.json',JSON.stringify({invalidInputNoWrites:true,datasets:results},null,2));
 console.log(JSON.stringify(results.map(({id,name,buildingCount,floorCount,verifiedOriginals})=>({id,name,buildingCount,floorCount,verifiedOriginals})),null,2));
 await pool().end();
}
main().catch(async e=>{console.error(e.message);await pool().end();process.exitCode=1;});

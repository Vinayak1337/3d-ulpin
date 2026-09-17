import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {canonical,identifier,inside,rowKey,insertionOrder,validateGraph,loadBundle} from '../scripts/datasets/bundle.mjs';

test('bundle canonicalization ignores object-key order but preserves array order',()=>{
  assert.equal(canonical({b:2,a:{d:4,c:3}}),canonical({a:{c:3,d:4},b:2}));
  assert.notEqual(canonical([1,2]),canonical([2,1]));
});
test('bundle file paths and SQL identifiers reject escapes',()=>{
  const root=resolve('data-bundles/uttam-nagar');
  assert.equal(inside(root,'objects/source.json'),resolve(root,'objects/source.json'));
  for(const value of ['../secret','../../.env',root])assert.throws(()=>inside(root,value));
  for(const value of ['a; DROP TABLE cases','public.cases','a"',''])assert.throws(()=>identifier(value));
  assert.equal(identifier('registry_records'),'"registry_records"');
});
test('dependencies order inserts without disabling constraints and handle nullable cycles',()=>{
  const tables={parent:{rows:[{id:1,back:null}]},child:{rows:[{id:2,parent:1}]}};
  const fks=[{child:'child',parent:'parent',columns:['parent'],targets:['id']},{child:'parent',parent:'child',columns:['back'],targets:['id']}];
  validateGraph(tables,fks);assert.deepEqual(insertionOrder(tables,fks),['parent','child']);
  tables.parent.rows[0].back=2;assert.throws(()=>insertionOrder(tables,fks),/cycle/);
});
test('missing dependencies and composite-key ambiguity cannot silently pass',()=>{
  assert.notEqual(rowKey({a:'x,y',b:'z'},['a','b']),rowKey({a:'x',b:'y,z'},['a','b']));
  assert.throws(()=>validateGraph({child:{rows:[{parent:9}]}},[{child:'child',parent:'missing',columns:['parent'],targets:['id']}]),/dependency/);
});
test('checked-in bundle is self-contained with six distinct real/fictional areas',async()=>{
  const bundle=await loadBundle(resolve('data-bundles/uttam-nagar'));
  assert.equal(bundle.manifest.areas.length,6);
  assert.equal(bundle.manifest.areas.filter(a=>a.classification==='reference').length,3);
  assert.equal(bundle.manifest.areas.filter(a=>a.classification==='fictional').length,3);
  assert.equal(bundle.manifest.areas.reduce((n,a)=>n+a.spaces,0),90);
  assert(bundle.payload.tables.sources.rows.length>0);
  assert(bundle.payload.tables.jobs.rows.every(j=>['succeeded','failed','stale'].includes(j.status)));
  assert(bundle.manifest.areas.every(a=>/Uttam Nagar/.test(a.name)));
});

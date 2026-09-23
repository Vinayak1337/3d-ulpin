import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {canonical,identifier,inside,rowKey,insertionOrder,validateGraph,loadBundle,assertCompatibleBundleSchema,compareTable} from '../scripts/datasets/bundle.mjs';
import {originalColumns} from '../scripts/datasets/uttam-v1-schema.mjs';

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
test('only the known nullable job-start column may extend the pinned v1 bundle',async()=>{
  const bundle=await loadBundle(resolve('data-bundles/uttam-nagar'));
  const original=Object.fromEntries(bundle.payload.order.map(name=>[name,{
    columns:[...bundle.payload.tables[name].columns],primaryKey:[...bundle.payload.tables[name].primaryKey],
  }]));
  const columnDefinitions=Object.fromEntries(Object.entries(originalColumns).map(([name,columns])=>[
    name,Object.fromEntries(columns.map(([column,formattedType,nullable,defaultValue])=>[
      column,{formattedType,nullable,default:defaultValue},
    ])),
  ]));
  columnDefinitions.jobs.started_at={udtName:'timestamptz',formattedType:'timestamp with time zone',nullable:'YES',default:null};
  const actual={tables:structuredClone(original),columnDefinitions};
  assert.doesNotThrow(()=>assertCompatibleBundleSchema(bundle,actual));
  actual.tables.jobs.columns.push('started_at');
  assert.doesNotThrow(()=>assertCompatibleBundleSchema(bundle,actual));
  for(const change of [
    a=>a.tables.jobs.columns.pop(),
    a=>a.tables.jobs.columns.push('unreviewed_at'),
    a=>{a.tables.jobs.columns.push('started_at');a.tables.jobs.primaryKey=['source_id'];},
    a=>a.tables.jobs.columns.splice(1,1),
    a=>a.tables.sources.columns.push('started_at'),
    a=>{a.tables.jobs.columns.push('started_at');a.columnDefinitions.jobs.started_at.udtName='text';},
    a=>{a.tables.jobs.columns.push('started_at');a.columnDefinitions.jobs.started_at.nullable='NO';},
    a=>{a.tables.jobs.columns.push('started_at');a.columnDefinitions.jobs.started_at.default='now()';},
    a=>a.columnDefinitions.jobs.created_at.formattedType='date',
    a=>a.columnDefinitions.jobs.created_at.nullable='YES',
    a=>a.columnDefinitions.jobs.created_at.default='CURRENT_DATE',
    a=>a.columnDefinitions.physical_features.geometry.formattedType='geometry(Point,4326)',
  ]){
    const altered=structuredClone({tables:original,columnDefinitions:actual.columnDefinitions});
    change(altered);
    assert.throws(()=>assertCompatibleBundleSchema(bundle,altered));
  }
  for(const field of ['id','sha256']){
    const unpinned={...bundle,manifest:{...bundle.manifest,database:{...bundle.manifest.database}}};
    if(field==='id')unpinned.manifest.id='different-bundle';
    else unpinned.manifest.database.sha256='different-hash';
    assert.throws(()=>assertCompatibleBundleSchema(unpinned,actual),/Unsupported dataset bundle schema version/);
  }
});
test('existing original values still reject a conflicting identity',async()=>{
  const table={name:'jobs',columns:['id','status'],primaryKey:['id'],rows:[{id:'saved-id',status:'succeeded'}]};
  const stored={id:'saved-id',status:'failed',started_at:null};
  const client={query:async(sql,params)=>{
    assert.match(sql,/WITH seed AS \(SELECT "id","status" FROM jsonb_populate_recordset/);
    assert.match(sql,/FROM \(SELECT "id","status" FROM public\."jobs"\) t/);
    const [seed]=JSON.parse(params[0]);
    return {rows:[{found:Number(stored.id===seed.id),identical:Number(table.columns.every(c=>stored[c]===seed[c]))}]};
  }};
  await assert.rejects(compareTable(client,table,true),/Existing jobs rows differ/);
  stored.status='succeeded';
  assert.deepEqual(await compareTable(client,table,true),{found:1,identical:1});
});

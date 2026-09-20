import test from 'node:test';
import assert from 'node:assert/strict';
import type {MapArea} from '@ulpin/contracts';
import {legacyUrl,rootPresentationUrl} from '../apps/web/lib/legacy-url';
import {studioProductUrl,studioResolutionUrl} from '../apps/web/features/studio/product/urls';
import {datasetLabel,filterAreas,filterWorkspaces} from '../apps/web/features/officer/shared/directory';
import {readStudioRoute} from '../apps/web/features/studio/routing';
import {district} from '../apps/web/features/studio/data/district';

const id='74a89235-0917-4576-b42c-675d80e1bf9c';
const context={area:'block-context',source:'source-context',page:'2',floor:'F1',unit:'U1',tag:['a','b']};
const wrappers:[string,string,Record<string,string>][]=[
 ['blocks','/studio/datasets',{}],
 ['blocks/[areaId]',`/studio/areas/${id}`,{areaId:id}],
 ['register','/studio/registry',{}],
 ['properties/[buildingId]',`/studio/properties/${id}/register`,{buildingId:id}],
 ['properties/[buildingId]/register',`/studio/properties/${id}/register`,{buildingId:id}],
 ['properties/[buildingId]/prepare',`/studio/properties/${id}/workspace`,{buildingId:id}],
 ['properties/[buildingId]/workspace',`/studio/properties/${id}/workspace`,{buildingId:id}],
 ['register/sites/[siteId]',`/studio/registry/sites/${id}`,{siteId:id}],
 ['register/records/[identifier]','/studio/registry/records/3DU-A%3AB001',{identifier:'3DU-A:B001'}],
 ['workspace','/studio/workspaces',{}],
 ['workspace/[caseId]',`/studio/cases/${id}`,{caseId:id}],
 ['workspace/[caseId]/geometry',`/studio/cases/${id}/geometry`,{caseId:id}],
 ['delhi','/studio/source-study',{}],
];
for(const [file,destination,params] of wrappers)test(`${file} redirects directly to Studio with original context`,async()=>{
 const {default:Page}=await import(`../apps/web/app/(officer)/${file}/page`);
 await assert.rejects(Page({params:Promise.resolve(params),searchParams:Promise.resolve(context)}),(error:Error&{digest?:string})=>{
  assert(error.digest?.startsWith('NEXT_REDIRECT;'));
  const url=new URL(error.digest.split(';')[2],'http://local');
  assert.equal(url.pathname,destination);
  for(const [key,value] of Object.entries(context))assert.deepEqual(url.searchParams.getAll(key),Array.isArray(value)?value:[value]);
  return true;
 });
});
test('root and historical nested families terminate directly in saved Studio views',()=>{
 assert.equal(rootPresentationUrl({}),'/studio/work');
 for(const prefix of ['/legacy','/v2','/legacy/v2']){
  assert.equal(legacyUrl(prefix+`/areas/${id}?tag=a&tag=b`),`/studio/areas/${id}?tag=a&tag=b`);
  assert.equal(legacyUrl(prefix+`/properties/${id}/prepare`),`/studio/properties/${id}/workspace`);
 }
});
test('malformed route tails are not silently discarded or replaced with another identity',()=>{
 assert.equal(legacyUrl(`/areas/${id}/extra`),`/studio/areas/${id}/extra`);
 assert.equal(legacyUrl('/registry/id/extra'),'/studio/registry/records/id/extra');
 assert.equal(legacyUrl('/sites/id/extra'),'/studio/registry/sites/id/extra');
 assert.equal(legacyUrl('/properties/id/prepare/extra'),'/studio/properties/id/prepare/extra');
 assert.equal(studioProductUrl('/blocks/BLD-0413'),'/studio/areas/BLD-0413');
 assert(readStudioRoute(`/studio/map/${id}`,district).error);
 assert.equal(readStudioRoute('/studio/map?selection=none',district).property,null);
});
test('resolved identifiers keep repeated incoming context, including a supplied area',()=>{
 const url=new URL(studioResolutionUrl(`/studio/properties/${id}/register?area=inferred`,context),'http://local');
 for(const [key,value] of Object.entries(context))assert.deepEqual(url.searchParams.getAll(key),Array.isArray(value)?value:[value]);
 assert.equal(studioResolutionUrl('/studio/registry?q=ambiguous',{tag:['a','b']}),'/studio/registry?q=ambiguous&tag=a&tag=b');
});
test('directories classify by stored metadata, retain empty datasets, and do not guess from names',()=>{
 const areas=[
  {id:'real',name:'Verification source',dataKind:'real',featureCount:0},
  {id:'demo',name:'Ordinary block',dataKind:'demonstration',featureCount:4},
  {id:'unknown',name:'Real survey',featureCount:2},
 ] as MapArea[];
 assert.deepEqual(filterAreas(areas,'','saved').map(a=>a.id),['unknown']);
 assert.deepEqual(filterAreas(areas,' ordinary ','demonstration').map(a=>a.id),['demo']);
 assert.equal(filterAreas(areas,'missing','all').length,0);
 assert.equal(filterAreas(areas,'','all').length,3);
 assert.equal(datasetLabel(undefined),'Source status unclassified');
 assert.equal(datasetLabel('mixed'),'Mixed real and fictional sources');
 assert.equal(datasetLabel('empty'),'No mapped sources yet');
 assert.equal(datasetLabel('demonstration'),'Fictional demonstration');
 assert.equal(areas.length,3);
});
test('workspace retrieval searches source and property names with assignment and stable recency',()=>{
 const cases=[
  {id:'first',name:'Survey plan',propertyName:'House 42',buildingId:id,sourceCount:2,updatedAt:'2026-09-18T12:00:00Z'},
  {id:'second',name:'Unassigned survey',sourceCount:1,updatedAt:'2026-09-20T12:00:00Z'},
 ];
 assert.deepEqual(filterWorkspaces(cases,' survey ','all').map(c=>c.id),['second','first']);
 assert.deepEqual(filterWorkspaces(cases,'house 42','linked').map(c=>c.id),['first']);
 assert.deepEqual(filterWorkspaces(cases,'','unassigned').map(c=>c.id),['second']);
 assert.deepEqual(cases.map(c=>c.id),['first','second']);
});

test('an ambiguity choice retains repeated evidence and vertical scope but owns its selected identity',()=>{
 const url=new URL(studioResolutionUrl(`/studio/properties/${id}/register?area=selected-area&record=selected-record`,{
  ...context,record:'stale-record',building:'stale-building',feature:'stale-feature',source:['s1','s2'],
 },true),'http://local');
 assert.equal(url.searchParams.get('record'),'selected-record');
 assert.equal(url.searchParams.get('area'),'selected-area');
 assert.equal(url.searchParams.has('building'),false);
 assert.equal(url.searchParams.has('feature'),false);
 for(const key of ['page','floor','unit','tag'] as const)assert.deepEqual(url.searchParams.getAll(key),Array.isArray(context[key])?context[key]:[context[key]]);
 assert.deepEqual(url.searchParams.getAll('source'),['s1','s2']);
});

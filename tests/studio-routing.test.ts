import test from 'node:test';
import assert from 'node:assert/strict';
import {district,getBuilding} from '../apps/web/features/studio/data/district';
import {readStudioRoute,studioUrl} from '../apps/web/features/studio/routing';
const b=getBuilding(district.defaultBuildingId);
test('Studio default and aliases resolve the exact synthetic property',()=>{
 assert.equal(readStudioRoute('/studio',district).property,b.id);
 assert.equal(readStudioRoute('/studio/map/'+b.ulpin,district).property,b.id);
});
test('record, unit, floor, document, mode and inspector survive URL round trips',()=>{
 const state={view:'register' as const,property:b.id,unit:b.units[3].id,floor:b.units[3].floor,doc:'lease' as const,mode:'2d' as const,tab:'floors' as const,exploded:true};
 const route=readStudioRoute(studioUrl(state),district);assert.equal(route.error,null);
 for(const [key,value]of Object.entries(state))assert.equal(route[key as keyof typeof route],value);
});
for(const [name,url]of [
 ['unknown property','/studio/map/unknown'],['unknown view','/studio/bogus'],
 ['cross-property unit',`/studio/register/${b.id}?unit=BLD-0001%2FF1%2FU1`],
 ['nonexistent floor',`/studio/map/${b.id}?floor=99`],
 ['unit/floor mismatch',`/studio/register/${b.id}?floor=2&unit=${encodeURIComponent(b.units[0].id)}`],
 ['repeated parameters',`/studio/map/${b.id}?mode=2d&mode=3d`],
 ['unknown document',`/studio/documents/${b.id}?doc=deed-invented`],
 ['invalid mode','/studio?mode=perspective'],['unselected register','/studio/register?selection=none'],
] as const)test(`Studio route rejects ${name} rather than substituting another property`,()=>assert(readStudioRoute(url,district).error));
test('no selection is an explicit map state',()=>assert.equal(readStudioRoute('/studio/map?selection=none',district).property,null));

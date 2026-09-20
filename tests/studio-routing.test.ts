import test from 'node:test';
import assert from 'node:assert/strict';
import {district,getBuilding} from '../apps/web/features/studio/data/district';
import {readStudioRoute,studioUrl} from '../apps/web/features/studio/routing';
const b=getBuilding(district.defaultBuildingId);
test('Explicit fixture map and aliases resolve the exact synthetic property',()=>{
 assert.equal(readStudioRoute('/studio/map',district).property,b.id);
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
test('quick map documents retain exact unit, floor and inspector when closed and reopened through history',()=>{
 const unit=b.units.find(u=>u.floor===3)!;
 const selection=readStudioRoute(`/studio/map/${b.ulpin}?tab=floors&unit=${encodeURIComponent(unit.id)}`,district);
 assert.equal(selection.error,null);assert.equal(selection.property,b.id);assert.equal(selection.floor,3);
 const documentUrl=studioUrl({...selection,doc:'lease'});
 const reloaded=readStudioRoute(documentUrl,district);
 assert.deepEqual(reloaded,{...selection,doc:'lease'});
 const closed=readStudioRoute(studioUrl({...reloaded,doc:null}),district);
 assert.deepEqual(closed,selection);
 assert.deepEqual(readStudioRoute(documentUrl,district),reloaded);
 const full=readStudioRoute(studioUrl({...reloaded,view:'register'}),district);
 assert.deepEqual(full,{...reloaded,view:'register'});
});
test('a quick document cannot point to an unselected property or a foreign unit',()=>{
 assert.match(readStudioRoute('/studio/map?selection=none&doc=land',district).error??'',/Choose a property/);
 const foreign=district.buildings.find(other=>other.id!==b.id)!.units[0];
 assert.match(readStudioRoute(`/studio/map/${b.id}?doc=lease&unit=${encodeURIComponent(foreign.id)}`,district).error??'',/unit does not belong/);
});

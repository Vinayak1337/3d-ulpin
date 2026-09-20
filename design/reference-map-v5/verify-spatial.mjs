import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deriveSpatialChecks, multiPolygonArea} from './spatial-checks.js';
const rect = (x, y, w, h) => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];
const frame = {id:'F',kind:'local_cartesian',horizontalUnit:'metre',verticalUnit:'metre'};
function fixture(shapes) {
  const objects = [], geometries = [];
  for (const [id, coordinates, extra = {}] of shapes) {
    const {type = 'building', baseElevationM = 0, heightM = 4, ...rest} = extra;
    objects.push({id, label:id, type, geometryId:`G-${id}`, attributes:{}});
    geometries.push({id:`G-${id}`,objectId:id,version:1,type:'Polygon',coordinates,frameId:'F',verticalDatum:'BM',baseElevationM,heightM,...rest});
  }
  return {frames:[frame],objects,geometries,relations:[],issues:[]};
}
const run = data => deriveSpatialChecks(data);
const check = (name, fn) => { fn(); console.log(`PASS ${name}`); };
check('shared-wall touch has zero area and no conflict', () => {
  assert.equal(run(fixture([['A',rect(0,0,5,5)],['B',rect(5,0,5,5)]])).issues.length,0);
});
check('identical polygons preserve identities and compute volume', () => {
  const d=fixture([['A',rect(0,0,5,5)],['B',rect(0,0,5,5),{heightM:3}]]);
  const before=JSON.stringify(d), r=run(d), i=r.issues[0];
  assert.equal(i.evidence.areaM2,25); assert.equal(i.evidence.volumeM3,75);
  assert.deepEqual(i.objectIds,['A','B']); assert.equal(JSON.stringify(d),before);
});
check('different vertical levels and vertical touch are not volume conflicts', () => {
  for(const z of [4,8]) assert.equal(run(fixture([['A',rect(0,0,5,5)],['B',rect(0,0,5,5),{baseElevationM:z}]])).issues.length,0);
});
check('partial vertical overlap uses common height, not whole building', () => {
  const i=run(fixture([['A',rect(0,0,5,5),{heightM:6}],['B',rect(3,0,5,5),{baseElevationM:4}]])).issues[0];
  assert.equal(i.evidence.areaM2,10); assert.equal(i.evidence.overlapHeightM,2); assert.equal(i.evidence.volumeM3,20);
});
check('unknown height is only footprint review; no invented volume', () => {
  const i=run(fixture([['A',rect(0,0,5,5)],['B',rect(3,0,5,5),{heightM:null}]])).issues[0];
  assert.equal(i.evidence.verticalRelation,'unknown'); assert.equal(i.evidence.volumeM3,null); assert.equal(i.severity,'review');
});
check('concave polygons retain their missing corner', () => {
  const L=[[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4],[0,0]]];
  assert.equal(run(fixture([['A',L],['B',rect(2,2,1,1)]])).issues.length,0);
  assert.equal(run(fixture([['A',L],['B',rect(0,0,4,4)]])).issues[0].evidence.areaM2,7);
});
check('holes subtract area and courtyard occupant does not intersect shell', () => {
  const ring=[...rect(0,0,10,10),...rect(2,2,6,6)];
  assert.equal(run(fixture([['A',ring],['B',rect(3,3,1,1)]])).issues.length,0);
  assert.equal(run(fixture([['A',ring],['B',rect(0,0,10,10)]])).issues[0].evidence.areaM2,64);
});
check('MultiPolygon calculation sums disconnected parts', () => {
  const d=fixture([['A',[],{type:'building'}],['B',rect(0,0,10,10)]]);
  d.geometries[0].type='MultiPolygon'; d.geometries[0].coordinates=[rect(0,0,2,2),rect(8,8,2,2)];
  assert.equal(run(d).issues[0].evidence.areaM2,8);
});
check('road and linked parcel checks use actual polygon area', () => {
  const d=fixture([['A',rect(0,0,5,5)],['P',rect(0,0,4,5),{type:'parcel'}],['R',rect(4,0,3,5),{type:'road'}]]);
  d.relations=[{fromId:'P',toId:'A',kind:'contains'}];
  const issues=run(d).issues; assert.equal(issues.length,2);
  assert.equal(issues.find(i=>i.code==='OUTSIDE_PARCEL').evidence.areaM2,5);
  assert.equal(issues.find(i=>i.code==='ROAD_OVERLAP').evidence.areaM2,5);
  assert.ok(issues.every(i=>i.evidence.legalFinding===false && i.evidence.volumeM3===null));
});
check('moving geometry recomputes and removes old fixture issue', () => {
  const d=run(fixture([['A',rect(0,0,5,5)],['B',rect(3,0,5,5)]]));
  d.issues.push({id:'source-missing-height',code:'MISSING_BUILDING_HEIGHT'});
  d.geometries[1]={...d.geometries[1],version:2,coordinates:rect(30,0,5,5)};
  assert.deepEqual(run(d).issues,[{id:'source-missing-height',code:'MISSING_BUILDING_HEIGHT'}]);
});
check('geometry revision evidence follows current geometry', () => {
  const d=fixture([['A',rect(0,0,5,5)],['B',rect(3,0,5,5),{version:7}]]);
  assert.equal(run(d).issues[0].evidence.geometryRefs[1].version,7);
});
check('different datum cannot create fabricated overlap volume', () => {
  const d=fixture([['A',rect(0,0,5,5)],['B',rect(3,0,5,5),{verticalDatum:'OTHER'}]]);
  assert.equal(run(d).issues[0].evidence.volumeM3,null);
});
check('different frame cannot create a measured overlap', () => {
  const d=fixture([['A',rect(0,0,5,5)],['B',rect(3,0,5,5),{frameId:'OTHER'}]]);
  d.frames.push({...frame,id:'OTHER'});
  const r=run(d);assert.equal(r.issues.length,0);assert.equal(r.spatialCheckReport.status,'partial');
});
check('over preview limit is explicit, not a misleading partial clean result', () => {
  const d=fixture(Array.from({length:101},(_,i)=>[`B${i}`,rect(i*8,0,5,5)]));
  assert.equal(run(d).spatialCheckReport.status,'not_run');
});
check('area computation stable at projected-size offsets', () => {
  assert.equal(multiPolygonArea([rect(714000,3160000,10,10)]),100);
});
check('current dense source fixture matches independent Shapely oracle', () => {
  const data=JSON.parse(fs.readFileSync(new URL('./data/reference-scene.json',import.meta.url)));
  const expected=data.issues.filter(i=>i.origin==='spatial-preview');
  const result=run(data), actual=result.issues.filter(i=>i.origin==='spatial-preview');
  assert.equal(result.spatialCheckReport.status,'complete');
  assert.deepEqual(actual.map(i=>i.id).sort(),expected.map(i=>i.id).sort());
  for(const e of expected) {
    const a=actual.find(i=>i.id===e.id);
    assert.ok(Math.abs(a.evidence.areaM2-e.evidence.areaM2)<1e-6);
    if(e.evidence.volumeM3===null) assert.equal(a.evidence.volumeM3,null);
    else assert.ok(Math.abs(a.evidence.volumeM3-e.evidence.volumeM3)<1e-6);
  }
});
console.log('16 spatial runtime checks passed.');

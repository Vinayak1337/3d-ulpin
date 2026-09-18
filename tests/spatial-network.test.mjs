import assert from 'node:assert/strict';
import test from 'node:test';
import {isCalibrationGeometry} from '../scripts/spatial/network.mjs';
const base='http://127.0.0.1:3000';
test('actual revision-qualified GLB requests remain geometry requests',()=>{
  assert(isCalibrationGeometry(base+'/api/v1/spatial/calibration/garden/hash/context.glb?v=version',base));
  assert(isCalibrationGeometry('/api/v1/spatial/calibration/dense/hash/detail.glb',base));
});
test('query strings, external origins and unrelated screenshots cannot stand in for geometry',()=>{
  for(const url of [base+'/screenshot.png?asset=x.glb',base+'/api/v1/spatial/calibration/garden/manifest.json?x=.glb','https://other.example/api/v1/spatial/calibration/a/b.glb','http://[bad',base+'/private/model.glb'])
    assert.equal(isCalibrationGeometry(url,base),false);
});

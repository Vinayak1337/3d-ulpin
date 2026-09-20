import test from "node:test";
import assert from "node:assert/strict";
import type { AreaReference, CoordinateFrame, ImportPackage, SpatialMlCalibration, SpatialMlItem } from "@ulpin/contracts";
import { retainedFootprintCalibration } from "../apps/web/lib/server/spatial-ml-retained-calibration";
import { fingerprint } from "../apps/web/lib/server/domain";
const frame: CoordinateFrame = {id:"area-frame",horizontalUnit:"m",verticalUnit:"m",benchmark:"documented-BM"};
const reference = {analysisCrs:"EPSG:32643",origin:[500000,2800000]} as AreaReference;
const part = {id:"part",sourceRevisionId:"source",entityIds:[],locator:"image",text:"retained image"};
const calibration: SpatialMlCalibration = {rasterSha256:"raster",imagePoints:[[0,0],[1200,0]],worldPoints:[[20,30],[140,30]],frame:frame.id,reason:"Explicit fictional controls for qualification"};
const item = {id:"item",packageId:"package",partId:part.id,sourceRevisionId:part.sourceRevisionId,sourceSha256:"source-hash",page:1,task:"building",state:"succeeded",currentJobId:"job",inputFingerprint:"inference",applications:[],result:{raster:{sha256:"raster",width:1200,height:800},model:{id:"building-model",sha256:"model-hash"}}} as unknown as SpatialMlItem;
const workspace = {caseId:"case",frame,worldStatus:"synthetic" as const,areaReferenceFingerprint:fingerprint(reference)};
const pkg = {id:item.packageId,areaId:"area",parts:[part],sourceRevisionIds:[part.sourceRevisionId],sourceWorkspace:workspace} as ImportPackage;
const receipt = {itemId:item.id,jobId:item.currentJobId,inferenceFingerprint:item.inputFingerprint,originalSourceRevisionId:item.sourceRevisionId,originalSha256:item.sourceSha256,originalPartId:item.partId,page:item.page,rasterSha256:calibration.rasterSha256,model:item.result!.model,calibration,sourceWorkspace:workspace,target:{areaId:pkg.areaId,frame:frame.id}};
const current = {frame,reference,sourceSha256:item.sourceSha256,sourcePartHash:fingerprint(part)};
test("historical footprint receipt restores exact nonzero controls without floor applications or item migration",()=>{
  const before=JSON.stringify({item,receipt,pkg});
  assert.deepEqual(retainedFootprintCalibration(item,receipt,pkg,current),calibration);
  assert.equal(JSON.stringify({item,receipt,pkg}),before);
  assert.equal(item.applications.length,0);
});
test("building calibration reuse rejects source, part, raster, model, job and source association changes",()=>{
  for(const change of [{originalSourceRevisionId:"other"},{originalSha256:"other"},{originalPartId:"other"},{rasterSha256:"other"},{page:2},{jobId:"other"},{inferenceFingerprint:"other"},{model:{id:"other",sha256:"other"}},{calibration:{...calibration,rasterSha256:"other"}}])
    assert.equal(retainedFootprintCalibration(item,{...receipt,...change},pkg,current),undefined);
  assert.equal(retainedFootprintCalibration(item,receipt,pkg,{...current,sourceSha256:"changed-original"}),undefined);
  assert.equal(retainedFootprintCalibration(item,receipt,{...pkg,parts:[{...part,text:"changed source part"}]},current),undefined);
  assert.equal(retainedFootprintCalibration(item,receipt,{...pkg,sourceRevisionIds:[]},current),undefined);
});
test("building calibration reuse rejects same-name changed frame, changed area origin and invalid controls",()=>{
  assert.equal(retainedFootprintCalibration(item,receipt,pkg,{...current,frame:{...frame,benchmark:"changed"}}),undefined);
  assert.equal(retainedFootprintCalibration(item,receipt,pkg,{...current,reference:{...reference,origin:[500001,2800000]}}),undefined);
  for(const change of [{frame:"different"},{imagePoints:[[0,0],[1201,0]]},{imagePoints:[[0,0],[0,0]]},{worldPoints:[[0,0],[0,0]]}])
    assert.equal(retainedFootprintCalibration(item,{...receipt,calibration:{...calibration,...change}},pkg,current),undefined);
  assert.equal(retainedFootprintCalibration(item,{...receipt,sourceWorkspace:undefined},pkg,current),undefined);
});
test("new property-linked footprint receipts require the same complete frame/reference evidence",()=>{
  const linked={...pkg,sourceWorkspace:undefined};
  const linkedReceipt={...receipt,sourceWorkspace:undefined,target:{...receipt.target,coordinateFrame:frame,areaReferenceFingerprint:fingerprint(reference)}};
  assert.deepEqual(retainedFootprintCalibration(item,linkedReceipt,linked,current),calibration);
  assert.equal(retainedFootprintCalibration(item,{...linkedReceipt,target:{...linkedReceipt.target,areaId:"other"}},linked,current),undefined);
});

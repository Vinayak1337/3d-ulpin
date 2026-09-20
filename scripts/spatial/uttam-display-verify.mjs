/** Saved Uttam display verification. Read-only API/browser inspection; no response mocks. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser} from './browser-launch.mjs';

const base=process.env.STUDIO_BASE_URL||'http://127.0.0.1:3000';
const out=process.env.UTTAM_DISPLAY_DIR||'docs/evidence/t060/uttam-final';
const areaId='9bb67cbc-9773-4cee-ad1a-df29fc6c23a5';
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const report={startedAt:new Date().toISOString(),areaId,viewport:{width:1440,height:960},scope:'Existing saved Uttam dataset, read-only browser/API verification. No injected records, responses, viewer state or presentation geometry.',checks:[],errors:[],badResponses:[],blockedWrites:[],geometryRequests:[]};
await mkdir(out,{recursive:true});
const pass=(name,detail={})=>{report.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
let browser,page;

// Inspect the live runtime already held in React's exposed component ref. This
// does not install a debug global, mutate the viewer or synthesize telemetry.
function inspectLiveScene(expectedRoads){
 const host=document.querySelector('[data-tile-canvas]');
 if(!host)return {available:false,reason:'Tile canvas is not mounted'};
 const fiberKey=Object.keys(host).find(key=>key.startsWith('__reactFiber$'));
 let fiber=fiberKey?host[fiberKey]:null,active=null,depth=0;
 while(fiber&&!active&&depth++<60){
  for(const node of [fiber,fiber.alternate]){
   let hook=node?.memoizedState,steps=0;
   while(hook&&steps++<100){
    const candidate=hook.memoizedState?.current;
    if(candidate?.viewer?.scene&&candidate?.tileset?.root){active=candidate;break;}
    hook=hook.next;
   }
   if(active)break;
  }
  fiber=fiber.return;
 }
 if(!active)return {available:false,reason:'No live viewer ref is exposed on the mounted component'};
 const {viewer,tileset}=active,time=viewer.clock.currentTime,roads=new Set(expectedRoads);
 const overlays=viewer.entities.values.filter(entity=>entity.polyline).map(entity=>{
  const id=entity.properties?.entityId?.getValue(time);
  const positions=entity.polyline.positions?.getValue(time)??[];
  return {entityId:id??null,visible:entity.isShowing&&entity.polyline.show?.getValue(time)!==false,positionCount:positions.length,finite:positions.every(p=>[p.x,p.y,p.z].every(Number.isFinite)),width:entity.polyline.width?.getValue(time)??null};
 }).filter(row=>roads.has(row.entityId));
 const features=new Map(),seenTiles=new Set();
 function contentFeatures(content){
  if(!content)return;
  for(const inner of content.innerContents??[])contentFeatures(inner);
  for(let i=0;i<(content.featuresLength??0);i++){
   const feature=content.getFeature(i),id=feature.getProperty('entityId');
   if(typeof id==='string')features.set(id,{entityId:id,kind:feature.getProperty('kind'),show:feature.show});
  }
 }
 function walk(tile){
  if(!tile||seenTiles.has(tile))return;seenTiles.add(tile);
  contentFeatures(tile.content);
  for(const child of tile.children??[])walk(child);
 }
 walk(tileset.root);
 const shown=[...features.values()].filter(feature=>feature.show);
 const camera={position:[viewer.camera.position.x,viewer.camera.position.y,viewer.camera.position.z],heading:viewer.camera.heading,pitch:viewer.camera.pitch,roll:viewer.camera.roll};
 return {available:true,inspection:'Read-only React runtime ref / Cesium entity and loaded feature APIs',runtimeId:host.dataset.mapRuntimeId,ready:host.dataset.sceneReady,loadedTiles:Number(host.dataset.loadedTiles),camera,roadOverlays:overlays,visibleRoadOverlayCount:overlays.filter(row=>row.visible).length,loadedBuildingIds:[...features.values()].filter(feature=>feature.kind==='building').map(feature=>feature.entityId).sort(),visibleBuildingIds:shown.filter(feature=>feature.kind==='building').map(feature=>feature.entityId).sort(),loadedFeatureCount:features.size};
}

try{
 browser=await launchBrowser();
 const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1});
 const get=async path=>{const response=await context.request.get(base+'/api/v1'+path,{timeout:60000});assert.equal(response.status(),200,path);return response.json();};
 const source=await get(`/areas/${areaId}/context`);
 assert.equal(source.area.id,areaId);
 const buildings=source.features.filter(feature=>feature.kind==='building');
 const roads=source.features.filter(feature=>feature.kind==='road');
 assert.equal(buildings.length,113,'Saved source building count');
 assert.equal(roads.length,35,'Saved source road count');
 const worlds=[...new Set(source.features.map(feature=>feature.worldStatus))];
 assert(worlds.includes('observed'),'Uttam must retain observed source world');
 const descriptorPath=`/spatial/core/areas/${areaId}/scene/observed/descriptor.json`;
 const descriptor=await get(descriptorPath);
 assert.equal(descriptor.areaId,areaId);assert.equal(descriptor.world,'observed');
 const buildingItems=descriptor.items.filter(item=>item.kind==='building');
 assert.equal(buildingItems.length,113);
 assert(buildingItems.every(item=>item.height===null&&item.renderStatus==='footprint'),'No invented building heights or storeys');
 const buildingRepresentations=descriptor.snapshot.representations.filter(rep=>buildingItems.some(item=>item.id===rep.entityId));
 assert.equal(buildingRepresentations.length,113);
 assert(buildingRepresentations.every(rep=>rep.vertical?.lower===rep.vertical?.upper),'Unknown-height source representations must stay flat');
 const roadIds=descriptor.items.filter(item=>item.kind==='road').map(item=>item.id).sort();
 assert.equal(roadIds.length,35);
 const roadRepresentations=descriptor.snapshot.representations.filter(rep=>roadIds.includes(rep.entityId));
 assert.equal(roadRepresentations.length,35);
 assert(roadRepresentations.every(rep=>rep.geometry.type==='LineString'));
 const before={context:digest(source),descriptor:digest(descriptor),readDigest:descriptor.readDigest,sourceCount:descriptor.sourceCount,documentCount:descriptor.documentCount,buildings:113,roads:35,sourceRevisionIds:[...new Set(source.features.map(feature=>feature.sourceRevisionId))].sort()};
 assert(before.sourceRevisionIds.length>0&&before.sourceRevisionIds.every(id=>typeof id==='string'&&id.length>0));
 report.source={areaName:source.area.name,world:'observed',before};
 pass('Actual saved source has 113 unknown-height building outlines and 35 recorded road LineStrings',{buildings:113,roads:35,unknownHeights:113,sourceCount:descriptor.sourceCount});

 page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('response',response=>{if(response.url().startsWith(base)&&response.status()>=400)report.badResponses.push({path:new URL(response.url()).pathname,status:response.status()});});
 page.on('request',request=>{if(request.url().startsWith(base)&&new URL(request.url()).pathname.endsWith('.glb'))report.geometryRequests.push(new URL(request.url()).pathname);});
 await page.route('**/api/v1/**',route=>{const request=route.request();if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.blockedWrites.push({method:request.method(),path:new URL(request.url()).pathname});return route.abort();}return route.continue();});
 await page.goto(`${base}/studio/areas/${areaId}`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.locator('[data-product-header]').waitFor();
 await page.getByRole('heading',{name:source.area.name,exact:true}).waitFor();
 await page.getByRole('button',{name:'3D',exact:true}).click();
 const world=page.getByRole('combobox',{name:'Source world',exact:true});
 if(await world.inputValue()!=='observed')await world.selectOption('observed');
 await page.waitForFunction(()=>{const host=document.querySelector('[data-tile-canvas]');return host?.dataset.sceneReady==='true'&&Number(host.dataset.loadedTiles)>0;},{},{timeout:120000});
 report.graphics=await page.locator('[data-tile-canvas] canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2')??canvas.getContext('webgl');if(!gl)return null;const info=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(info?info.UNMASKED_RENDERER_WEBGL:gl.RENDERER),version:gl.getParameter(gl.VERSION)};});
 assert(report.graphics,'Actual WebGL context is required');
 const rail=page.getByRole('complementary',{name:'Map layers and properties',exact:true});
 await rail.getByRole('button',{name:'Layers',exact:true}).click();
 const roadsCheckbox=rail.getByRole('checkbox',{name:'Show roads',exact:true});
 await roadsCheckbox.check();
 await rail.getByRole('checkbox',{name:'Show buildings',exact:true}).check();
 await page.getByRole('button',{name:'Return to block view',exact:true}).click();
 await page.waitForTimeout(1200);
 await page.locator('.ui-map-legend').waitFor({state:'visible'});
 await page.locator('.saved-scene-proof').getByText('Road centerlines',{exact:false}).waitFor();
 const proof=await page.locator('.saved-scene-proof').innerText();
 assert(proof.includes('113 source outlines')&&proof.includes('heights unavailable'),proof);
 report.legend=await page.locator('.ui-map-legend').innerText();
 assert(report.legend.includes('Buildings'),'Building legend must be visible');
 report.captionLayout=await page.evaluate(()=>{
  const bounds=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  return {proof:bounds('.saved-scene-proof'),legend:bounds('.ui-map-legend'),map:bounds('.ui-map-stage'),viewport:{width:innerWidth,height:innerHeight}};
 });
 const {proof:proofRect,legend:legendRect,map:mapRect,viewport}=report.captionLayout;
 assert(proofRect.right<=legendRect.left||proofRect.left>=legendRect.right||proofRect.bottom<=legendRect.top||proofRect.top>=legendRect.bottom,'Source-height caption must not overlap the map legend');
 assert(proofRect.left>=mapRect.left&&proofRect.right<=mapRect.right&&proofRect.top>=mapRect.top&&proofRect.bottom<=mapRect.bottom,'Source-height caption must fit its map viewport');
 assert(proofRect.left>=0&&proofRect.right<=viewport.width&&proofRect.top>=0&&proofRect.bottom<=viewport.height,'Caption must be visible within the1440×960 viewport');
 const snapshot=async name=>{
  const scene=await page.evaluate(inspectLiveScene,roadIds);
  assert(scene.available,scene.reason);
  scene.canvasSha256=sha(await page.locator('[data-tile-canvas] canvas').screenshot({path:`${out}/${name}-canvas.png`}));
  await page.screenshot({path:`${out}/${name}.png`});
  return scene;
 };
 const initial=await snapshot('01-roads-on');
 assert.equal(initial.visibleRoadOverlayCount,35,'All 35 road overlays must exist and be visible in Cesium');
 assert.deepEqual(initial.loadedBuildingIds,buildingItems.map(item=>item.id).sort());
 assert.deepEqual(initial.visibleBuildingIds,initial.loadedBuildingIds);
 for(const rep of roadRepresentations){const overlay=initial.roadOverlays.find(row=>row.entityId===rep.entityId);assert(overlay?.finite);assert.equal(overlay.positionCount,rep.geometry.coordinates.length);assert.equal(overlay.width,2);}
 pass('Live Cesium holds 113 visible building features and 35 visible finite road centerlines',{runtimeId:initial.runtimeId,loadedTiles:initial.loadedTiles,buildingFeatures:initial.visibleBuildingIds.length,roadOverlays:initial.visibleRoadOverlayCount,legend:report.legend,proof,captionDoesNotOverlapLegend:true});

 await roadsCheckbox.uncheck();
 await page.waitForFunction(ids=>{const host=document.querySelector('.saved-scene-proof');return host&&!host.textContent.includes('Road centerlines');},roadIds);
 await page.waitForTimeout(600);
 const hidden=await snapshot('02-roads-off');
 assert.equal(hidden.visibleRoadOverlayCount,0);
 assert.deepEqual(hidden.visibleBuildingIds,initial.visibleBuildingIds);
 assert.equal(hidden.runtimeId,initial.runtimeId);
 assert.deepEqual(hidden.camera,initial.camera);
 assert.notEqual(hidden.canvasSha256,initial.canvasSha256,'Canvas pixels must change when road overlays are hidden');
 await roadsCheckbox.check();
 await page.locator('.saved-scene-proof').getByText('Road centerlines',{exact:false}).waitFor();
 await page.waitForTimeout(600);
 const restored=await snapshot('03-roads-restored');
 assert.equal(restored.visibleRoadOverlayCount,35);
 assert.deepEqual(restored.visibleBuildingIds,initial.visibleBuildingIds);
 assert.equal(restored.runtimeId,initial.runtimeId);
 assert.deepEqual(restored.camera,initial.camera);
 report.scene={initial,hidden,restored};
 pass('Roads layer toggles 35→0→35 actual overlays on one unchanged camera/runtime',{canvasChanges:true,buildingFeaturesRemain113:true});

 const afterSource=await get(`/areas/${areaId}/context`),afterDescriptor=await get(descriptorPath);
 const after={context:digest(afterSource),descriptor:digest(afterDescriptor),readDigest:afterDescriptor.readDigest,sourceCount:afterDescriptor.sourceCount,documentCount:afterDescriptor.documentCount,buildings:afterSource.features.filter(feature=>feature.kind==='building').length,roads:afterSource.features.filter(feature=>feature.kind==='road').length,sourceRevisionIds:[...new Set(afterSource.features.map(feature=>feature.sourceRevisionId))].sort()};
 assert.deepEqual(after,before);
 assert.deepEqual(report.blockedWrites,[]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);
 assert(report.geometryRequests.length>0,'Actual compiled GLBs must load');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflows the 1440px viewport');
 report.source.after=after;
 pass('Original saved counts, source revision identities, geometry/context and descriptor hashes stay unchanged',{sourceCount:after.sourceCount,buildings:after.buildings,roads:after.roads,noWrites:true});
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack||String(error);console.error(report.error);if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();await writeFile(`${out}/results.json`,JSON.stringify(report,null,2)+'\n');}

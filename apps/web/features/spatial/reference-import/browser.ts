import {adaptReferenceScene} from './adapter';
import {toReferenceRenderScene} from './render-scene';
import {readReferencePackage} from './package';
import {normalizePresentation,normalizeObjectAppearance} from './presentation';

export {adaptReferenceScene,toReferenceRenderScene,readReferencePackage};
/** Shared browser/Next import path. The receipt remains separate from its disposable render projection. */
export async function normalizeReferencePackage(name:string,bytes:Uint8Array){
  const receipt=await readReferencePackage(name,bytes);
  const canonical=await adaptReferenceScene(receipt.normalizedText);
  const render=toReferenceRenderScene(canonical);
  const scene=render.scene;
  if(scene.objects.filter(o=>o.type==='building').length>100||scene.geometries.length>1000)throw new Error('The detailed reference view supports up to 100 buildings and 1,000 geometry records. Use the streamed scene profile for larger datasets.');
  let facadeWork=0;
  for(const o of scene.objects){
    const geometry=scene.geometries.find(g=>g.id===o.geometryId);
    if(!geometry)continue;
    if(geometry.heightM!==null&&geometry.heightM>500)throw new Error('The detailed reference height profile is bounded to 500 metres.');
    if(o.type!=='building'||!['Polygon','MultiPolygon'].includes(geometry.type))continue;
    const polygons=(geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates) as readonly (readonly (readonly (readonly number[])[])[])[];
    for(const polygon of polygons)for(const ring of polygon){
      if(ring.length>256)throw new Error('Detailed facade rings are limited to 256 vertices; use the streamed profile for more complex sources.');
      for(let i=1;i<ring.length;i++)facadeWork+=Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1])*Math.max(1,Number(o.attributes?.floorCount)||1);
    }
  }
  if(facadeWork>150000)throw new Error('Detailed facade work exceeds this preview profile. Use the streamed scene compiler.');
  const extent=scene.metadata.extent;
  if(extent&&(extent[2]-extent[0]>2000||extent[3]-extent[1]>2000))throw new Error('The detailed reference view is bounded to a 2 km extent.');
  const presentation=extent?normalizePresentation(canonical.source.sceneDecoration,canonical.snapshot.manifest.inputDigest,extent,new Set(scene.objects.map(o=>o.id))):undefined;
  const utilityGeometry=new Set(canonical.source.objects.filter(o=>o.type==='utility').map(o=>o.geometryId));
  const displayGeometries=canonical.source.geometries.filter(g=>utilityGeometry.has(g.id)&&g.frameId===scene.frames[0]?.id&&g.type==='LineString'&&Array.isArray(g.coordinates)&&g.coordinates.length>=2&&g.coordinates.length<=1000&&g.coordinates.every((p:unknown)=>Array.isArray(p)&&p.length===3&&p.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=5000))).map(g=>({...g,displayRole:'display_only' as const,analysisStatus:'unavailable' as const,coordinates:g.coordinates as number[][]}));
  const data={...scene,displayGeometries,sceneDecoration:presentation?.decoration,objects:scene.objects.map(o=>({...o,attributes:{...o.attributes,appearance:normalizeObjectAppearance(o.attributes?.appearance)}}))};
  return {receipt,canonical,render:{...render,scene:data},presentation};
}

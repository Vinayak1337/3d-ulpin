export interface LocalOrbitState {
  kind:'engineering-orbit';
  frameId:string;
  snapshotDigest:string;
  view:{
    selectedId:string|null;activeConflictId:string|null;mode:'2d'|'3d';floor:string;space:string;floorMode:string;floorPlates:boolean;
    inspectorOpen:boolean;labels:boolean;railTab:'layers'|'properties'|'findings';inspectorTab:'overview'|'floors'|'parcels'|'sources'|'history';explode:boolean;section:boolean;sectionHeight:number;underground:boolean;layers:Record<string,boolean>;
    sourceView?:string;sourceModelOverlay?:boolean;
    camera:{position:number[];target:number[];zoom:number;orthoHalfHeight:number;perspectiveOffset:number[]};
  };
}
/** Local engineering coordinates must never be interpreted as a geodetic Cesium camera. */
export function localOrbitState(input:unknown,frameId:string,snapshotDigest:string):LocalOrbitState|null{
  if(!input||typeof input!=='object')return null;
  const v=input as Record<string,unknown>,camera=v.camera as Record<string,unknown>|undefined;
  const vector=(p:unknown):p is number[]=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
  if(!camera||!vector(camera.position)||!vector(camera.target)||!vector(camera.perspectiveOffset)||typeof camera.zoom!=='number'||!Number.isFinite(camera.zoom)||camera.zoom<=0||typeof camera.orthoHalfHeight!=='number'||!Number.isFinite(camera.orthoHalfHeight)||camera.orthoHalfHeight<=0)return null;
  const text=(key:string,fallback:string)=>typeof v[key]==='string'?(v[key] as string).slice(0,300):fallback;
  const inspectorTabs=['overview','floors','parcels','sources','history'] as const;
  const inspectorTab=inspectorTabs.find(tab=>tab===v.inspectorTab)??'overview';
  const layers=Object.fromEntries(Object.entries(v.layers&&typeof v.layers==='object'?v.layers:{}).filter(([key,value])=>['buildings','parcels','roads','publicLand','trees','utilities','conflicts'].includes(key)&&typeof value==='boolean')) as Record<string,boolean>;
  return {kind:'engineering-orbit',frameId,snapshotDigest,view:{sourceView:text('sourceView','model'),sourceModelOverlay:v.sourceModelOverlay===true,selectedId:typeof v.selectedId==='string'?v.selectedId:null,activeConflictId:typeof v.activeConflictId==='string'?v.activeConflictId:null,mode:v.mode==='2d'?'2d':'3d',floor:text('floor','all'),space:text('space','none'),floorMode:text('floorMode','below'),floorPlates:v.floorPlates===true,inspectorOpen:v.inspectorOpen!==false,labels:v.labels!==false,railTab:v.railTab==='properties'?'properties':v.railTab==='findings'?'findings':'layers',inspectorTab,explode:v.explode===true,section:v.section===true,sectionHeight:typeof v.sectionHeight==='number'&&Number.isFinite(v.sectionHeight)?v.sectionHeight:100,underground:v.underground===true,layers,camera:{position:[...camera.position],target:[...camera.target],perspectiveOffset:[...camera.perspectiveOffset],zoom:camera.zoom,orthoHalfHeight:camera.orthoHalfHeight}}};
}

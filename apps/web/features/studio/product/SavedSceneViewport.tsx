'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {enuToEcef,transformPoint,geometryBounds,validateSpatialSnapshot,type SpatialGeometry,type SpatialRepresentation,type SpatialFrame,type WorldState,type AreaGeometry} from '@ulpin/contracts';
import {useSharedResource} from '../../spatial/data/useResource';
import {displayProjector,type NeighbourhoodView} from '../../spatial/data/core-display';
import type {MapSelection} from '../../spatial/data/session';
import type {TileNavigation,TileOverlay,TileTelemetry} from '../../spatial/layers/TileLayer';
import type {BlockController} from '../../officer/block/useBlock';
import ExternalSceneViewport from '../../usp/shared/ExternalSceneViewport';
const MapViewport=dynamic(()=>import('../../spatial/MapViewport').then(m=>m.MapViewport),{ssr:false});
type Saved=NeighbourhoodView&{manifestUrl:string;publicationId:string};
function geometryParts(g:AreaGeometry):SpatialGeometry[]{
 const xy=(p:number[]):[number,number]=>{if(p.length!==2||!p.every(Number.isFinite))throw new Error('Overlay coordinates must be finite geographic XY pairs');return [p[0],p[1]];};
 if(g.type==='GeometryCollection')return g.geometries.flatMap(geometryParts);
 if(g.type==='MultiLineString')return g.coordinates.map(c=>({type:'LineString',coordinates:c.map(xy)}));
 if(g.type==='MultiPoint')return g.coordinates.map(c=>({type:'Point',coordinates:xy(c)}));
 if(g.type==='Point')return [{type:g.type,coordinates:xy(g.coordinates)}];
 if(g.type==='LineString')return [{type:g.type,coordinates:g.coordinates.map(xy)}];
 if(g.type==='Polygon')return [{type:g.type,coordinates:g.coordinates.map(r=>r.map(xy))}];
 return [{type:g.type,coordinates:g.coordinates.map(p=>p.map(r=>r.map(xy)))}];
}
function projectGeometry(g:SpatialGeometry,project:(xy:readonly[number,number])=>readonly[number,number]):SpatialGeometry{
 const point=(p:readonly number[])=>project([p[0],p[1]]) as [number,number];
 if(g.type==='Point')return {...g,coordinates:point(g.coordinates)};
 if(g.type==='LineString')return {...g,coordinates:g.coordinates.map(point)};
 if(g.type==='Polygon')return {...g,coordinates:g.coordinates.map(r=>r.map(point))};
 return {...g,coordinates:g.coordinates.map(p=>p.map(r=>r.map(point)))};
}
type SavedSceneProps={block:BlockController;world:WorldState;recordId:string|null;onRecord:(id:string)=>void;explode?:number;opacityByKind?:Readonly<Record<string,number>>};
export default function SavedSceneViewport(props:SavedSceneProps){
 const visible=props.block.features.filter(feature=>feature.worldStatus===props.world);
 const external=visible.filter(feature=>feature.kind==='building'&&typeof feature.properties.external_cityjson_sha256==='string');
 const feature=external.find(item=>item.id===props.block.selectedId)??(visible.length===1&&external.length===1?external[0]:null);
 if(feature)return <ExternalSceneViewport key={`${feature.id}:${feature.revision}`} feature={feature} block={props.block} opacity={props.opacityByKind?.building}/>;
 return <CanonicalSavedSceneViewport {...props}/>;
}
function CanonicalSavedSceneViewport({block,world,recordId,onRecord,explode=0,opacityByKind}:SavedSceneProps){
 const areaId=block.context.data!.area.id;
 const resource=useSharedResource<Saved>(`/spatial/core/areas/${areaId}/scene/${world}/descriptor.json`);
 const loadedRevision=useRef(block.context.data!.area.revision);
 useEffect(()=>{const next=block.context.data?.area.revision;if(next!==loadedRevision.current){loadedRevision.current=next!;void resource.reload();}},[block.context.data?.area.revision,resource.reload]);
 const validated=useMemo(()=>{if(!resource.data)return {view:null,error:''};try{validateSpatialSnapshot(resource.data.snapshot);if(resource.data.areaId!==areaId||resource.data.world!==world)throw new Error('The scene does not match this dataset and source world');return {view:resource.data,error:''};}catch(e){return {view:null,error:e instanceof Error?e.message:'Invalid scene'};}},[resource.data,areaId,world]);
 const view=validated.view,scene=view?.snapshot,frame=scene?.frames[0];
 const selected=view?.items.find(i=>i.canonicalRef.id===block.selectedId);
 const baseRep=scene?.representations.find(r=>r.entityId===selected?.id);
 const [telemetry,setTelemetry]=useState<TileTelemetry|null>(null);
 const details=block.dossier.data?.detailedScene??[];
 const floor=block.dossier.data?.records.find(r=>r.id===recordId&&r.kind==='floor');
 const spaces=block.dossier.data?.records.filter(r=>r.kind==='space'&&(r.id===recordId||floor&&r.links.some(l=>l.type==='floor'&&l.targetId===floor.id)))??[];
 const showInterior=!!recordId||explode>0;
 const roadCenterlines=useMemo<TileOverlay[]>(()=>{
  if(!scene||!frame||block.preferences.hiddenLayers.includes('road'))return [];
  const roads=new Set(scene.entities.filter(entity=>entity.kind==='road').map(entity=>entity.id));
  // Reuse the exact recorded alignment. Only its screen-space stroke is enlarged for legibility.
  return scene.representations.filter(rep=>roads.has(rep.entityId)&&rep.geometry.type==='LineString').map(representation=>({representation,frame,color:'#263d3d',strokeWidth:2,opacity:Math.max(.05,Math.min(1,opacityByKind?.road??1))}));
 },[scene,frame,block.preferences.hiddenLayers,opacityByKind?.road]);
 const overlays=useMemo<TileOverlay[]>(()=>{
  if(!frame?.anchor||!frame.verticalReference)return [];
  const reference=frame.verticalReference;
  const project=displayProjector(frame.anchor.longitude,frame.anchor.latitude),result:TileOverlay[]=[...roadCenterlines];
  const add=(id:string,geometry:AreaGeometry,lower:number,upper:number,color:string,options:Partial<TileOverlay>={})=>{
   for(const [i,g]of geometryParts(geometry).entries()){
    const representation:SpatialRepresentation={id:`overlay:${id}:${i}`,entityId:id,revision:1,frameId:frame.id,role:'display_only',geometry:projectGeometry(g,project),vertical:{lower,upper,reference},evidence:[]};
    result.push({representation,frame,color,...options});
   }
  };
  if(showInterior){
   const floors=[...new Set(details.map(d=>d.lower).filter((x):x is number=>Number.isFinite(x)))].sort((a,b)=>a-b);
   const chosen=new Set(spaces.map(r=>r.id));
   for(const d of details){
    if(!d.geographicGeometry||d.lower==null||d.upper==null||!Number.isFinite(d.lower)||!Number.isFinite(d.upper)||d.upper<=d.lower||!d.verticalReference)continue;
    if(!explode&&recordId&&d.record.id!==recordId&&!chosen.has(d.record.id))continue;
    if(explode&&d.record.kind==='floor')continue;
    const offset=Math.max(0,floors.indexOf(d.lower))*explode;
    add('record:'+d.record.id,d.geographicGeometry,d.lower+offset,d.upper+offset,d.record.id===recordId?'#dbb764':d.record.kind==='space'?'#82b8a0':'#7dbaae',{opacity:d.record.id===recordId?.8:.6});
   }
  }
  if(block.geographicIssueGeometry)add('finding:'+(block.finding?.id??'all'),block.geographicIssueGeometry,.21,.22,'#df6e3e',{opacity:.72,selectable:false});
  for(const boundary of block.boundaries)if(boundary.geographicGeometry)add('boundary:'+boundary.id,boundary.geographicGeometry,.25,.25,'#987743',{opacity:.1,outlineOnly:true,selectable:false});
  return result;
 },[frame,roadCenterlines,details,showInterior,recordId,explode,spaces.map(r=>r.id).join('|'),block.geographicIssueGeometry,block.boundaries,block.finding?.id]);
 const onSelect=useCallback((selection:MapSelection|null)=>{
  if(!selection)return;
  if(selection.entityId.startsWith('record:')){const id=selection.entityId.slice(7);if(block.dossier.data?.records.some(r=>r.id===id))onRecord(id);return;}
  const item=view?.items.find(i=>i.id===selection.entityId);if(item)block.select(item.canonicalRef.id);
 },[view,block.select,block.dossier.data,onRecord]);
 const navigation=useMemo<TileNavigation>(()=>{
  const old=block.navigation,action=old.action==='return'?'fit':old.action==='angle'?'reverse':old.action==='issue'?'focus':old.action;
  const rep=recordId?overlays.find(o=>o.representation.entityId==='record:'+recordId)?.representation??baseRep:baseRep;
  let target:readonly[number,number,number]|undefined,targetRadius:number|undefined;
  if(rep&&frame){const bounds=geometryBounds(rep.geometry);target=transformPoint(enuToEcef(frame),[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2,rep.vertical?(rep.vertical.lower+rep.vertical.upper)/2:0]);targetRadius=Math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1],rep.vertical?rep.vertical.upper-rep.vertical.lower:0)/2;}
  return {action:['fit','focus','north','zoom_in','zoom_out','reverse','neighbourhood'].includes(action)?action as TileNavigation['action']:'reverse',sequence:old.sequence,target,targetRadius};
 },[block.navigation,baseRep,frame,recordId,overlays]);
 const visibleKinds=useMemo(()=>['building','building_part','parcel','road','rail','public_land','vegetation','utility','terrain'].filter(k=>!block.preferences.hiddenLayers.includes(k as never)),[block.preferences.hiddenLayers]);
 if(!view||!scene||!frame)return <div className="spatial-loading" role={resource.error||validated.error?'alert':'status'}><span>{resource.error||validated.error||'Preparing source-linked 3D neighbourhood…'}</span>{(resource.error||validated.error)&&<button className="ui-button" onClick={()=>void resource.reload()}>Retry scene</button>}</div>;
 const buildings=view.items.filter(item=>item.kind==='building'),unknownHeights=buildings.filter(item=>item.height===null).length;
 const sceneSummary=unknownHeights===buildings.length&&buildings.length?`${buildings.length} source outlines · heights unavailable`:unknownHeights?`${buildings.length} buildings · ${unknownHeights} heights unavailable`:`${buildings.length} buildings`;
 return <div style={{height:'100%',position:'relative'}} data-normalized-scene={view.readDigest} data-world={world}>
  <MapViewport source={{kind:'tiles',props:{manifestUrl:view.manifestUrl,sessionKey:`product:${areaId}:${world}`,selection:selected?{entityId:selected.id}:null,onSelect,mode:'3d',navigation,visibleKinds,shadows:true,opacityByKind,highlightedIds:block.highlightedIds.map(id=>view.items.find(i=>i.canonicalRef.id===id)?.id??'').filter(Boolean),hiddenEntityIds:showInterior&&overlays.some(o=>o.representation.entityId.startsWith('record:'))&&selected?[selected.id]:[],overlays,outline:baseRep&&selected&&block.preferences.labels?{representation:baseRep,frame,label:selected.label}:undefined,onTelemetry:setTelemetry}}}/>
  {resource.error&&<div className="normalized-map-notice" role="alert">Scene refresh failed. Previous records remain visible.<button onClick={()=>void resource.reload()}>Retry</button></div>}
  <div className="saved-scene-proof"><i/>{telemetry?.ready?sceneSummary:'Loading geometry'}{roadCenterlines.length>0&&<span title="Recorded road centerlines. The screen stroke does not establish physical road width."> · Road centerlines</span>} <span>Revision {scene.revision} · {world}</span></div>
 </div>;
}

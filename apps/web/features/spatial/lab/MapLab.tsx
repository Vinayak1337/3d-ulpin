"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {enuToEcef,geometryBounds,measureRepresentation,transformPoint,validateSpatialSnapshot,type SpatialEntity,type SpatialSnapshot,type WorldState} from "@ulpin/contracts";
import {useSharedResource} from "../data/useResource";
import {useMapSession} from "../data/useMapSession";
import type {NeighbourhoodView} from "../data/core-display";
import type {TileNavigation,TileTelemetry} from "../layers/TileLayer";
import {Icon} from "@/features/officer/shared/ui";
import {routes} from "@/features/officer/shared/routes";
import "./lab.css";

const MapViewport=dynamic(()=>import("../MapViewport").then(m=>m.MapViewport),{ssr:false,loading:()=> <div className="lab-engine-loading">Loading the shared 3D engine…</div>});
type SavedView=NeighbourhoodView&{publicationId:string;manifestUrl:string};
type Props={areaId?:string;world?:WorldState};
const layerGroups=[
  {kind:"building",label:"Buildings",icon:"building"},{kind:"parcel",label:"Parcels",icon:"map"},
  {kind:"road",label:"Roads & paths",icon:"utility"},{kind:"public_land",label:"Public land",icon:"layers"},
  {kind:"utility",label:"Utility alignments",icon:"utility"},{kind:"vegetation",label:"Trees",icon:"home"},
] as const;
const fmt=(n:number|null|undefined)=>n==null?"—":n.toLocaleString("en",{maximumFractionDigits:2});

/** One explorer for both authored calibration and normalized saved neighbourhoods. */
export default function MapLab({areaId,world="synthetic"}:Props) {
  const [kind,setKind]=useState<"garden"|"dense"|"saved">(areaId?"saved":"garden");
  const [tab,setTab]=useState<"map"|"building"|"sources">("map");
  const [filter,setFilter]=useState("");
  const [shadows,setShadows]=useState(true);
  const [layers,setLayers]=useState<string[]>(["building","building_part","parcel","road","rail","utility","public_land","vegetation","terrain"]);
  const [navigation,setNavigation]=useState<TileNavigation>({action:"fit",sequence:0});
  const [telemetry,setTelemetry]=useState<TileTelemetry|null>(null);
  const [panel,setPanel]=useState<"none"|"layers"|"inspector">("none");
  const saved=kind==="saved"&&!!areaId;
  const resource=useSharedResource<SpatialSnapshot|SavedView>(saved?`/spatial/core/areas/${areaId}/scene/${world}/descriptor.json`:`/spatial/calibration/${kind}/snapshot.json`);
  const sessionKey=saved?`core-scene:${areaId}:${world}`:`calibration:${kind}`;
  const [session,updateSession]=useMapSession(sessionKey);
  const sourceView=resource.data?.schemaVersion==="ulpin-neighbourhood-view/1"?resource.data:null;
  const validated=useMemo(()=>{
    if(!resource.data)return {snapshot:null,error:""};
    try{const data=resource.data.schemaVersion==="ulpin-neighbourhood-view/1"?resource.data.snapshot:resource.data;validateSpatialSnapshot(data);return {snapshot:data,error:""};}
    catch(error){return {snapshot:null,error:error instanceof Error?error.message:"Invalid scene"};}
  },[resource.data]);
  const scene=validated.snapshot;
  const buildings=useMemo(()=>scene?.entities.filter(e=>e.kind==="building"||e.kind==="building_part")??[],[scene]);
  useEffect(()=>{if(buildings.length&&(!session.selection||!scene?.entities.some(e=>e.id===session.selection!.entityId)))updateSession({selection:{entityId:buildings[0].id}});},[buildings,scene,session.selection,updateSession]);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setPanel("none");};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[]);
  const selected=scene?.entities.find(e=>e.id===session.selection?.entityId);
  const rep=scene?.representations.find(r=>r.entityId===selected?.id),frame=scene?.frames.find(f=>f.id===rep?.frameId);
  const item=sourceView?.items.find(i=>i.id===selected?.id);
  const area=item?item.horizontalArea:rep&&frame?measureRepresentation(rep,frame,"horizontal_area").value:null;
  const volume=item?item.prismVolume:rep&&frame?measureRepresentation(rep,frame,"prism_volume").value:null;
  const buildingId=selected?.kind==="building"?selected.id:scene?.relations.find(r=>r.fromId===selected?.id&&r.kind==="part_of")?.toId;
  const levels=scene?.entities.filter(e=>e.kind==="level"&&scene.relations.some(r=>r.fromId===e.id&&r.toId===buildingId&&r.kind==="part_of"))??[];
  const inspection=useMemo(()=>!saved&&(selected?.kind==="level"||selected?.kind==="space")&&rep&&frame?{representation:rep,frame,parentId:buildingId}:undefined,[saved,selected?.kind,rep,frame,buildingId]);
  const outline=useMemo(()=>rep&&frame&&selected&&(layers.includes(selected.kind)||!!inspection)?{representation:rep,frame,label:selected.label}:undefined,[rep,frame,selected,layers,inspection]);
  const select=useCallback((entity:SpatialEntity)=>{updateSession({selection:{entityId:entity.id}});},[updateSession]);
  const onSelect=useCallback((selection:typeof session.selection)=>{if(selection&&!selection.entityId.startsWith("display-context:")&&scene?.entities.some(e=>e.id===selection.entityId)){updateSession({selection});}},[updateSession,scene]);
  const onTelemetry=useCallback((state:TileTelemetry)=>setTelemetry(state),[]);
  const command=(action:TileNavigation['action'])=>{
    let target:readonly [number,number,number]|undefined,targetRadius:number|undefined;
    if(action==="focus"&&rep&&frame){const b=geometryBounds(rep.geometry);target=transformPoint(enuToEcef(frame),[(b[0]+b[2])/2,(b[1]+b[3])/2,rep.vertical?(rep.vertical.lower+rep.vertical.upper)/2:0]);targetRadius=Math.hypot(b[2]-b[0],b[3]-b[1],rep.vertical?rep.vertical.upper-rep.vertical.lower:0)/2;}
    setNavigation(n=>({action,sequence:n.sequence+1,...(target?{target,targetRadius}:{})}));
  };
  const sceneName=sourceView?.name??(kind==="garden"?"Garden neighbourhood":kind==="dense"?"Dense neighbourhood":"Saved neighbourhood");
  const sceneWorld=sourceView?.world??"synthetic";
  const filtered=buildings.filter(e=>`${e.label} ${e.id} ${e.identifiers.map(i=>i.value).join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
  const manifestUrl=sourceView?.manifestUrl??`/api/v1/spatial/calibration/${kind}/manifest.json`;
  const selectedNumber=selected?buildings.findIndex(b=>b.id===selected.id):-1;
  const previousNext=(step:number)=>{if(!buildings.length)return;select(buildings[(Math.max(selectedNumber,0)+step+buildings.length)%buildings.length]);};
  const hasKind=(value:string)=>scene?.entities.some(e=>e.kind===value);
  return <main className={`map-lab ${panel!=="none"?`lab-open-${panel}`:""}`} data-map-lab data-source-kind={saved?"normalized-records":"calibration"}>
    <header className="lab-context">
      <div className="lab-context-title">{areaId&&<Link href={routes.block(areaId)} aria-label="Return to saved block" className="lab-back"><Icon name="back"/></Link>}<div><span className="lab-eyebrow">3D PROPERTY EXPLORER</span><h1>{sceneName}</h1></div><span className={`lab-demo ${sceneWorld==="observed"?"is-reference":""}`}>{sceneWorld==="synthetic"?"Synthetic data":"Source geometry"}</span></div>
      <div className="lab-dataset"><label htmlFor="lab-dataset">Scene</label><select id="lab-dataset" value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setTelemetry(null);setFilter("");setNavigation({action:"fit",sequence:0});setPanel("none");}}>{areaId&&<option value="saved">Saved neighbourhood</option>}<option value="garden">Garden neighbourhood</option><option value="dense">Dense neighbourhood</option></select></div>
    </header>
    <div className="lab-layout">
      {panel!=="none"&&<button className="lab-drawer-shade" aria-label="Close side panel" onClick={()=>setPanel("none")}/>}
      <aside className="lab-left" aria-label="Scene layers and property list">
        <div className="lab-tabs" role="tablist" aria-label="Map panels">{(["map","building","sources"] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}><Icon name={t==="map"?"layers":t==="building"?"building":"document"}/>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>
        <div className="lab-panel-content">
          {tab==="map"&&<><div className="lab-section-title"><h2>Map layers</h2><button className="lab-text-button" onClick={()=>setLayers(["building","building_part","parcel","road","rail","utility","public_land","vegetation","terrain"])}>Reset</button></div><div className="lab-layers">{layerGroups.filter(l=>hasKind(l.kind)).map(l=><label key={l.kind}><Icon name={l.icon}/><span>{l.label}</span><input type="checkbox" checked={layers.includes(l.kind)} onChange={e=>setLayers(old=>e.target.checked?[...old,l.kind]:old.filter(k=>k!==l.kind))}/></label>)}</div><div className="lab-divider"/><div className="lab-section-title"><h2>Properties <span>{buildings.length}</span></h2></div><label className="lab-search"><Icon name="search"/><input placeholder="Find a property" aria-label="Find in scene" value={filter} onChange={e=>setFilter(e.target.value)}/></label><div className="lab-buildings">{filtered.map(e=><button key={e.id} data-building-id={e.id} className={selected?.id===e.id?"is-selected":""} onClick={()=>{select(e);setPanel("none");}}><span className="lab-building-icon"><Icon name="building"/></span><span><strong>{e.label}</strong><small>{e.identifiers[0]?.value.split(':').at(-1)??"No external identifier"}</small></span><Icon name="chevron" size={14}/></button>)}{!filtered.length&&<p className="lab-muted">No property matches this search.</p>}</div></>}
          {tab==="building"&&<><h2>Floors & spaces</h2>{levels.length?levels.map(level=><section className="lab-level" key={level.id}><button onClick={()=>select(level)}><Icon name="layers"/><strong>{level.label.split("level ").at(-1)==="0"?"Ground floor":`Floor ${level.label.split("level ").at(-1)}`}</strong></button>{scene!.relations.filter(r=>r.toId===level.id&&r.kind==="occupies_level").map(link=>{const unit=scene!.entities.find(e=>e.id===link.fromId)!;return <button className="lab-unit" key={unit.id} onClick={()=>select(unit)}><Icon name="home"/>Unit {unit.label.split("unit ").at(-1)}</button>;})}</section>):<div className="lab-empty"><Icon name="layers" size={32}/><strong>{saved?"Interior placement not supplied":"Exterior geometry only"}</strong><p>{saved?"Linked floor and unit records stay available in the original register. They are not positioned by guessing from the exterior.":"The first building has authored floor and unit geometry. Other buildings have exterior data only."}</p>{saved&&item?.recordId?<Link className="lab-primary-link" href={routes.register(item.canonicalRef.id,areaId)}>Open property register <Icon name="external" size={15}/></Link>:!saved&&<button onClick={()=>buildings[0]&&select(buildings[0])}>Select Building 1</button>}</div>}</>}
          {tab==="sources"&&<><h2>Source contributions</h2><article className="lab-source"><Icon name="document" size={24}/><strong>{saved?"Normalized saved records":"Authored vectors & level schedule"}</strong><small>{saved?`${sourceView?.sourceCount??0} original source receipts`:'Synthetic calibration input'}</small><p>{saved?"Identities, revisions and original hashes are preserved by the read-only data bridge.":"Display details are illustrative. Geometry and levels come from the authored fixture."}</p></article><article className="lab-source"><strong>{sourceView?.documentCount??scene?.attachments.length??0} attached PDFs</strong><p>Documents are optional. Missing evidence is not replaced with inferred property facts.</p></article>{sourceView&&<div className="lab-read-receipt"><span className="lab-status-dot"/><span>Read-only snapshot</span><code>{sourceView.readDigest.slice(0,12)}</code></div>}<details className="lab-source-notes"><summary>Display limits & provenance</summary>{(sourceView?.notices??["Facade details are illustration, not additional surveyed volume.","No original registry record or source file is modified."]).map(note=><p key={note}>{note}</p>)}</details></>}
        </div>
        <footer className="lab-left-footer"><span className="lab-status-dot"/>{saved?"Normalized records · read only":"Shared scene · synthetic"}<button className="lab-mobile-close" onClick={()=>setPanel("none")}>Close</button></footer>
      </aside>
      <section className="lab-map" aria-label="Shared 3D map">
        {scene?<MapViewport source={{kind:"tiles",props:{manifestUrl,sessionKey,selection:session.selection,onSelect,mode:session.mode,navigation,visibleKinds:layers,shadows,inspection,outline,onTelemetry}}}/>:resource.error||validated.error?<div className="lab-engine-loading" role="alert"><Icon name="warning"/><span>{resource.error||validated.error}</span><button onClick={()=>void resource.reload()}>Retry</button></div>:<div className="lab-engine-loading"><Icon name="loading"/>Preparing normalized scene…</div>}
        {scene&&resource.error&&<div className="lab-refresh-error" role="alert">Could not refresh. The previous scene is retained.<button onClick={()=>void resource.reload()}>Retry</button></div>}
        <div className="lab-map-tools"><div className="lab-mode"><button aria-pressed={session.mode==="3d"} onClick={()=>updateSession({mode:"3d"})}>3D</button><button aria-pressed={session.mode==="2d"} onClick={()=>updateSession({mode:"2d"})}>2D</button></div><button className="lab-mobile-toggle" aria-label="Open layers and properties" onClick={()=>setPanel("layers")}><Icon name="layers"/>Layers</button><button onClick={()=>command("neighbourhood")}><Icon name="target"/>Neighbourhood</button><button onClick={()=>command("fit")}><Icon name="expand"/>Fit scene</button></div>
        <div className="lab-camera-tools"><button aria-label="North" title="Orient north" onClick={()=>command("north")}>N</button><button aria-label="Zoom in" onClick={()=>command("zoom_in")}><Icon name="plus"/></button><button aria-label="Zoom out" onClick={()=>command("zoom_out")}><Icon name="minus"/></button><button aria-label="Reverse view" title="Inspect the other side" onClick={()=>command("reverse")}><Icon name="history"/></button><button aria-label="Toggle shadows" title="Toggle soft shadows" aria-pressed={shadows} onClick={()=>setShadows(value=>!value)}><Icon name="eye"/></button><button aria-label="Focus selection" onClick={()=>command("focus")}><Icon name="target"/></button>{saved&&<button aria-label="Refresh saved scene" title="Reload current record revisions" onClick={()=>void resource.reload()}><Icon name="history"/></button>}</div>
        <div className="lab-map-caption"><span className="lab-eyebrow">{saved?"SOURCE-LINKED NEIGHBOURHOOD":"FULL NEIGHBOURHOOD"}</span><strong>{buildings.length} buildings <i/> One connected view</strong><span>{saved?"Supplied footprints · relative-height display":"Authored geometry · shared renderer"}</span></div>
        <button className="lab-inspector-toggle" onClick={()=>setPanel("inspector")}><Icon name="building"/><span>{selected?.label??"Property details"}</span><Icon name="chevron"/></button>
        <div className="lab-telemetry"><span className="lab-status-dot"/>{telemetry?.ready?"View ready":"Loading scene"}<span>{telemetry?.loadedTiles??0} tiles</span><span>{((telemetry?.tileBytes??0)/1048576).toFixed(1)} MiB tile estimate</span></div>
        {!!sourceView?.attributions.length&&<div className="lab-attribution">{sourceView.attributions.includes("google")&&<a href="https://sites.research.google/gr/open-buildings/" target="_blank" rel="noreferrer">Google Open Buildings</a>}{sourceView.attributions.includes("osm")&&<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}<span>ODbL</span></div>}
      </section>
      <aside className="lab-inspector" aria-label="Selected property" data-selected-entity={selected?.id??""}>
        <div className="lab-inspector-heading"><Icon name="building"/><h2>Property</h2><div className="lab-property-navigation"><button aria-label="Previous property" onClick={()=>previousNext(-1)}><Icon name="back" size={16}/></button><button aria-label="Next property" onClick={()=>previousNext(1)}><Icon name="chevron" size={16}/></button><button className="lab-mobile-close" aria-label="Close property details" onClick={()=>setPanel("none")}><Icon name="close" size={18}/></button></div></div>
        <div className="lab-inspector-body"><div className="lab-property-summary"><span className="lab-selection-mark"><Icon name={selected?.kind==="space"?"home":"building"} size={30}/></span><span className="lab-eyebrow">{saved?"LINKED SPATIAL IDENTITY":"AUTHORED SPATIAL IDENTITY"}</span><h3>{selected?.label??"Select a property"}</h3><code title={selected?.id}>{item?.identifier??selected?.identifiers[0]?.value??selected?.id}</code><div className="lab-pills"><span>{selected?.kind??"No selection"}</span><span>Revision {selected?.revision??"—"}</span><span>{sceneWorld==="synthetic"?"Fictional":"Source supplied"}</span></div></div>
          <div className="lab-inspector-tabs"><strong>Overview</strong><button onClick={()=>{setTab("building");setPanel("layers");}}>Floors</button><button onClick={()=>{setTab("sources");setPanel("layers");}}>Sources</button></div>
          <h2>Canonical measurements</h2><div className="lab-metrics"><div><small>Horizontal area</small><strong data-metric-area data-horizontal-area={area??""}>{fmt(area)} <em>m²</em></strong></div><div><small>Prism volume</small><strong data-metric-volume>{fmt(volume)} <em>m³</em></strong></div><div><small>{saved?"Relative height":"Lower / upper"}</small><strong>{saved?fmt(item?.height):rep?.vertical?`${fmt(rep.vertical.lower)} / ${fmt(rep.vertical.upper)}`:"—"} <em>m</em></strong></div></div>
          {saved&&volume==null?<div className="lab-limit-note"><Icon name="info" size={17}/><p>Volume is unavailable without a qualified footprint and vertical reference. Display height is not a survey datum.</p></div>:<p className="lab-muted">Measurements use the analytical representation, never display detail or camera position.</p>}
          <div className="lab-divider"/><h2>Geometry & evidence</h2><dl className="lab-facts"><div><dt>Representation</dt><dd>{item?.renderStatus??(selected?.kind==="space"?"Unit volume":"Authored exterior")}</dd></div><div><dt>Original records</dt><dd>{saved?item?.recordId?"Linked":"Not associated":"Synthetic fixture"}</dd></div><div><dt>Interior placement</dt><dd>{saved?"Unresolved":levels.length||inspection?"Supplied":"Not supplied"}</dd></div></dl>
          <details className="lab-source-notes"><summary>Identity & reference</summary><code>{selected?.id}</code><p>{saved?"Relative display plane · source coordinates retained":frame?.verticalReference??"Unresolved"}</p><div className="lab-memberships">{selected?.areaIds.map(id=><span key={id}>{id.split(':').at(-1)}</span>)}</div></details>
        </div>
        <div className="lab-inspector-actions"><button onClick={()=>command("focus")}><Icon name="target"/>Focus object</button>{saved&&item?.recordId?<Link href={routes.register(item.canonicalRef.id,areaId)}><Icon name="register"/>Open register</Link>:<button onClick={()=>{setTab("building");setPanel("layers");}}><Icon name="register"/>Inspect records</button>}</div>
      </aside>
    </div>
  </main>;
}

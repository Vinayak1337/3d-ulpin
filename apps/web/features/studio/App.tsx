'use client';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Search, MapPin, ChevronRight, Layers3, Building2, TriangleAlert, Download, ShieldCheck, ChevronLeft, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Trees, Route, Droplets, Zap, Cable, Tag, Box, Focus, Maximize, Plus, Minus, ArrowUpRight, FileText, X, HelpCircle, Check, Database, Map, ChevronDown, Scan, Eye, Rotate3D, Crosshair, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import CityScene from './scene/CityScene';
import Inspector from './components/Inspector';
import RecordModal from './components/RecordModal';
import { AerialMap } from './components/Visuals';
import { district, allFindings, computeFindings, getBuilding, exportGeoJSON } from './data/district';
import { downloadDocument, saveJSON } from './data/documents';
import type { Building, CameraCommand, InspectorTab, Layers, ModalKind, RecordContext } from './types';
import { mapScale } from './data/mapScale';
import DialogSection from './components/DialogSection';
import UtilitySection from './components/UtilitySection';
import StudioWorkspace from './components/StudioWorkspace';
import StudioImport from './components/StudioImport';
import {useStudioRoute} from './useStudioRoute';
import {usePropertyPreview} from './data/usePropertyPreview';
import QuickDocumentDrawer from './components/QuickDocumentDrawer';
import ProductHeader from './product/ProductHeader';
import './hierarchy.css';


const defaults:Layers={buildings:true,parcels:true,roads:true,greenery:true,water:true,sewer:false,electric:false,findings:true,labels:true};
const layerConfig:{key:keyof Layers;label:string;Icon:LucideIcon;tone:string}[]=[{key:'buildings',label:'Buildings',Icon:Building2,tone:'blue'},{key:'parcels',label:'Parcels (ULPIN)',Icon:Scan,tone:'blue'},{key:'roads',label:'Roads & streets',Icon:Route,tone:'grey'},{key:'greenery',label:'Public land & trees',Icon:Trees,tone:'green'},{key:'water',label:'Water pipeline',Icon:Droplets,tone:'cyan'},{key:'sewer',label:'Sewer network',Icon:Cable,tone:'gold'},{key:'electric',label:'Electric cables',Icon:Zap,tone:'purple'},{key:'findings',label:'Findings / conflicts',Icon:MapPin,tone:'red'}];
class SceneBoundary extends Component<{children:ReactNode},{error:string|null}>{state={error:null as string|null};static getDerivedStateFromError(e:Error){return {error:e.message};}componentDidCatch(e:Error,i:ErrorInfo){console.error('3D scene failed',e,i);}render(){return this.state.error?<div className="scene-failure"><Box size={34}/><h2>3D view could not start</h2><p>{this.state.error}</p><p>Use a browser with WebGL 2 and hardware acceleration enabled.</p><button onClick={()=>location.reload()}>Reload scene</button></div>:this.props.children;}}

export default function App(){
  const {route,navigate}=useStudioRoute();
  const selectedId=route.property,tab=route.tab,mode=route.mode,exploded=route.exploded,floor=route.floor;
  const modal:ModalKind=route.view==='map'?null:route.view==='overview'?'aerial':route.view;
  const recordContext:RecordContext={...(route.unit?{unitId:route.unit}:{}),...(route.floor!==null?{floor:route.floor}:{}),...(route.doc?{doc:route.doc}:route.view==='workspace'?{doc:'plan'}:{})};
  const setTab=(value:InspectorTab)=>navigate({tab:value});
  const setMode=(value:'2d'|'3d')=>navigate({mode:value});
  const setFloor=(value:number|null)=>navigate({floor:value,unit:null});
  const setModal=(value:ModalKind)=>navigate({view:value==='aerial'?'overview':value??'map',doc:null,unit:null});
  const [layers,setLayers]=useState<Layers>(defaults),[leftTab,setLeftTab]=useState<'layers'|'properties'|'findings'>('layers'),[underground,setUnderground]=useState(false),[localQuery,setLocalQuery]=useState(''),[limit,setLimit]=useState(60),[findType,setFindType]=useState('All'),[toast,setToast]=useState(''),[ready,setReady]=useState(false),[checking,setChecking]=useState(false),[presentation,setPresentation]=useState(false);
  const [command,setCommand]=useState<CameraCommand>({type:'block',nonce:0}),[camera,setCamera]=useState({x:0,z:0,zoom:6.1,heading:0});
  const [mobileLayers,setMobileLayers]=useState(false),[overviewOpen,setOverviewOpen]=useState(false),[mobileExpanded,setMobileExpanded]=useState(false);
  const [advancedUtilities,setAdvancedUtilities]=useState(false);
  const mobileLayersButton=useRef<HTMLButtonElement>(null);
  const quickDocument=route.view==='map'&&route.doc?recordContext:null;
  const [sceneFailed,setSceneFailed]=useState(false);
  useEffect(()=>{const failed=()=>setSceneFailed(true);window.addEventListener('studio-viewport-error',failed);return()=>window.removeEventListener('studio-viewport-error',failed);},[]);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('ulpin:studio-map-preferences:v1')||'null');if(saved?.layers)setLayers({...defaults,...saved.layers});if(typeof saved?.underground==='boolean')setUnderground(saved.underground);}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem('ulpin:studio-map-preferences:v1',JSON.stringify({layers,underground}));}catch{}},[layers,underground]);
  const selected=selectedId?getBuilding(selectedId):null,recordBuilding=selected||getBuilding(district.defaultBuildingId);
  const openModal=useCallback((kind:ModalKind,context:RecordContext={})=>{
    if(kind==='documents'){
      if(!selected)return;
      const doc=context.doc??(context.unitId?'lease':'land');
      const requestedFloor=context.floor??route.floor;
      const unit=context.unitId?selected.units.find(u=>u.id===context.unitId):selected.units.find(u=>u.id===route.unit&&(requestedFloor===null||u.floor===requestedFloor))??(doc==='lease'?selected.units.find(u=>u.floor===(requestedFloor??0)):undefined);
      navigate({view:'map',doc,unit:unit?.id??context.unitId??null,floor:unit?.floor??requestedFloor});
      return;
    }
    navigate({view:kind==='aerial'?'overview':kind??'map',doc:context.doc??null,unit:context.unitId??null,floor:context.floor??null});
  },[navigate,selected,route.unit,route.floor]);
  const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const findings=useMemo(()=>selected?computeFindings(selected):[],[selected]);
  const notify=useCallback((message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),6000);},[]);
  useEffect(()=>{const notice=(e:Event)=>notify((e as CustomEvent<string>).detail);window.addEventListener('studio-notice',notice);return()=>{window.removeEventListener('studio-notice',notice);if(toastTimer.current)clearTimeout(toastTimer.current);};},[notify]);
  const move=useCallback((type:CameraCommand['type'])=>setCommand(c=>({type,nonce:c.nonce+1})),[]);
  const select=useCallback((id:string)=>{navigate({property:id,view:'map',exploded:false,floor:null,unit:null,doc:null,tab:'overview'});setMobileExpanded(false);setMobileLayers(false);},[navigate]);
  const focus=()=>move('focus');
  const selectAndFly=(id:string)=>{select(id);setCommand(c=>({type:'block',nonce:c.nonce+1}));};
  const selectUnit=(id:string)=>{const unit=selected?.units.find(u=>u.id===id);if(!unit)return;navigate({view:'map',unit:unit.id,floor:unit.floor,doc:null,tab:'floors'});setLayers(l=>({...l,buildings:true}));};
  const changeFloor=(f:number|null)=>{navigate({floor:f,unit:null,...(f!==null?{tab:'floors'}:{})});if(f!==null)setLayers(l=>({...l,buildings:true}));};
  const toggleExplode=()=>{navigate({exploded:!exploded,floor:null,unit:null});setLayers(l=>({...l,buildings:true}));};
  const matches=(b:Building,q:string)=>`${b.ulpin} ${b.id} ${b.name} ${b.address} ${b.owner} ${b.parcelId} ${b.units.map(u=>u.occupant).join(' ')}`.toLowerCase().includes(q.toLowerCase().trim());
  const filtered=useMemo(()=>{
    const q=localQuery.trim(),base=q?district.buildings.filter(b=>matches(b,q)):district.buildings;
    const anchor=selected||getBuilding(district.defaultBuildingId);
    return [...base].sort((a,b)=>(a.id===anchor.id?-Infinity:(a.x-anchor.x)**2+(a.z-anchor.z)**2)-(b.id===anchor.id?-Infinity:(b.x-anchor.x)**2+(b.z-anchor.z)**2));
  },[localQuery,selected]);
  const filteredFindings=useMemo(()=>allFindings.filter(f=>findType==='All'||f.type===findType),[findType]);
  useEffect(()=>{const keys=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.defaultPrevented){setMobileLayers(false);if(mobileLayers)mobileLayersButton.current?.focus();if(route.view!=='map')navigate({view:'map',doc:null,unit:null});}};window.addEventListener('keydown',keys);return()=>window.removeEventListener('keydown',keys);},[navigate,route.view,mobileLayers]);
  const previousMode=useRef(mode);useEffect(()=>{if(previousMode.current!==mode){move(mode);previousMode.current=mode;}},[mode,move]);
  const handleCamera=useCallback((v:{x:number;z:number;zoom:number;heading:number})=>setCamera(old=>Math.abs(old.x-v.x)+Math.abs(old.z-v.z)+Math.abs(old.zoom-v.zoom)+Math.abs(old.heading-v.heading)<.0005?old:v),[]);
  const scale=mapScale(camera.zoom);
  const handleReady=useCallback(()=>setReady(true),[]);
  const preview=usePropertyPreview(selectedId,ready,modal===null,command,`${mode}:${underground}:${exploded}:${floor}`);
  const check=()=>{setChecking(true);setLayers(l=>({...l,findings:true}));setMobileLayers(true);setLeftTab('findings');setTimeout(()=>{const result=district.buildings.flatMap(computeFindings);setChecking(false);notify(`Checked ${district.buildings.length} footprints: ${result.length} computed findings across ${new Set(result.map(f=>f.buildingId)).size} buildings. Demo thresholds only.`);},450);};
  const setView=(v:'2d'|'3d')=>setMode(v);
  const snapshot=()=>{const canvas=document.querySelector('.map-viewport canvas') as HTMLCanvasElement|null;if(!canvas){notify('Wait for the 3D map to load first.');return;}const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='DEMO-Lake-View-3D-map.png';a.click();notify('Current map image exported. The scene uses synthetic geometry.');};
  const occupied=district.buildings.reduce((n,b)=>n+b.units.filter(u=>u.tenure!=='Vacant').length,0);
  const disputed=new Set(allFindings.map(f=>f.buildingId));

  if(route.error)return <main className="studio-route-error" role="alert"><Box size={36}/><h1>That record is unavailable</h1><p>{route.error}</p><button onClick={()=>navigate({view:'map',property:district.defaultBuildingId,tab:'overview',mode:'3d',floor:null,unit:null,doc:null,exploded:false},true)}>Return to the Studio map</button><a href="/blocks">Open saved neighbourhoods</a></main>;
  return <div className={`app ${presentation?'presentation':''}`} data-studio-root data-studio-view={route.view}>
    <ProductHeader dataset="Lake View · synthetic" onDemoSelect={selectAndFly} actions={<>
      <button aria-label="Import" onClick={()=>setModal('import')} title="Upload originals and manage source data"><ArrowUpRight size={16}/><span>Import</span></button>
      <button aria-label={checking?'Checking…':'Check'} className="check-button" onClick={check} disabled={checking}><ShieldCheck size={17}/><span>{checking?'Checking…':'Check'}</span></button>
      <button aria-label="Export" onClick={()=>setModal('export')}><Download size={16}/><span>Export</span></button>
      <button onClick={()=>setModal('help')} aria-label="Map controls and help"><HelpCircle size={17}/></button>
    </>}/>
    <div className="workspace">
      {!presentation&&mobileLayers&&<div className="studio-layer-shade" onClick={event=>{if(event.target===event.currentTarget)setMobileLayers(false);}}><DialogSection onClose={()=>setMobileLayers(false)} labelledBy="studio-layers-title" className="sidebar studio-layers-dialog">
        <h2 id="studio-layers-title">Map controls</h2>
        <button className="mobile-layer-close" aria-label="Close layers" onClick={()=>setMobileLayers(false)}><X size={18}/></button>
          <div className="sidebar-tabs">{[{id:'layers',label:'Layers',Icon:Layers3},{id:'properties',label:'Properties',Icon:Building2},{id:'findings',label:'Findings',Icon:TriangleAlert}].map(({id,label,Icon})=><button key={id} onClick={()=>setLeftTab(id as typeof leftTab)} className={leftTab===id?'active':''}><Icon size={19}/><span>{label}</span>{id==='findings'&&<i className="tab-alert"/>}</button>)}</div>
          {leftTab==='layers'&&<section className="layers-section"><div className="section-heading"><h2>Map layers</h2><button onClick={()=>{setLayers({...defaults});setUnderground(false);}}>Reset</button></div><div className="layer-rows">{layerConfig.filter(({key})=>advancedUtilities||!['sewer','electric'].includes(key)).map(({key,label,Icon,tone})=><div className="layer-row" key={key}><span className={`layer-icon ${tone}`}><Icon size={15}/></span><span>{label}</span><button className={`switch ${layers[key]?'on':''}`} aria-label={label} role="switch" aria-checked={layers[key]} onClick={()=>setLayers(l=>({...l,[key]:!l[key]}))}><i/></button></div>)}</div><div className="studio-extra-layers"><button aria-pressed={underground} onClick={()=>{setUnderground(v=>!v);setLayers(l=>({...l,water:true}));}}>Underground</button><button aria-pressed={layers.labels} onClick={()=>setLayers(l=>({...l,labels:!l.labels}))}>Labels</button></div><button className="studio-utility-disclosure" aria-expanded={advancedUtilities} onClick={()=>setAdvancedUtilities(v=>!v)}>{advancedUtilities?'Fewer utility layers':'Sewer & electrical layers'}<ChevronDown size={12}/></button></section>}
          {leftTab==='properties'&&<section className="property-section"><div className="section-heading"><h2>Properties in district <span>({district.buildings.length})</span></h2>{leftTab==='properties'&&<Building2 size={16}/>}</div>{leftTab==='properties'&&<div className="property-summary"><span><strong>{district.buildings.length}</strong>buildings</span><span><strong>{occupied.toLocaleString()}</strong>occupied units</span><span><strong>{disputed.size}</strong>with findings</span></div>}<div className="local-search"><Search size={14}/><input aria-label="Search properties in district" value={localQuery} onChange={e=>{setLocalQuery(e.target.value);setLimit(60);}} placeholder="Search in district…"/>{localQuery?<button onClick={()=>setLocalQuery('')} title="Clear property search"><X size={13}/></button>:<SlidersHorizontal size={14}/>}</div><div className="property-list" data-testid="property-list">{filtered.slice(0,limit).map(b=><button key={b.id} className={`property-row ${selectedId===b.id?'selected':''}`} onClick={()=>select(b.id)}><span className="property-icon"><Building2 size={17}/></span><span className="property-text"><strong>{b.ulpin}</strong><small>{b.address}</small></span>{disputed.has(b.id)?<span className="property-warning" title="Computed finding"><TriangleAlert size={12}/></span>:<i className="property-dot"/>}</button>)}{filtered.length===0&&<p className="empty-message">No properties match this search.</p>}{filtered.length>limit&&<button className="load-more" onClick={()=>setLimit(n=>n+60)}>Show 60 more <ChevronDown size={13}/></button>}</div><footer className="list-footer"><span>{Math.min(limit,filtered.length)} of {filtered.length} shown</span><span>Linked demo records</span></footer></section>}
          {leftTab==='findings'&&<section className="findings-section"><div className="section-heading"><h2>District findings</h2><span className="count-chip">{allFindings.length}</span></div><p className="section-caption">Computed from the actual fixture geometry.</p><div className="finding-filters">{['All','Parcel','Road','Utility'].map(t=><button className={findType===t?'active':''} key={t} onClick={()=>setFindType(t)}>{t}</button>)}</div><div className="findings-list">{filteredFindings.map(f=><button key={f.id} onClick={()=>{navigate({property:f.buildingId,view:'map',floor:null,unit:null,doc:null,exploded:false,tab:f.type==='Utility'?'utilities':'parcel'});setMobileLayers(false);move('block');}}><span className={`finding-small-icon ${f.type==='Utility'?'blue':''}`}>{f.type==='Utility'?<Droplets size={17}/>:<TriangleAlert size={16}/>}</span><div><strong>{f.title}</strong><small>{getBuilding(f.buildingId).ulpin}</small><p>{f.value} {f.unit}<span>{f.type}</span></p></div><ChevronRight size={14}/></button>)}</div></section>}
          <div className="sidebar-status"><i/><span>Local demo dataset</span><button onClick={()=>setModal('help')} title="Dataset information"><Info size={13}/></button></div>
      </DialogSection></div>}
      <main className="map-viewport" aria-label="Interactive 3D district map">
        <SceneBoundary><Suspense fallback={null}><CityScene inspectUtilities={tab==='utilities'} paused={modal!==null} onUnit={selectUnit} selected={selected} layers={layers} underground={underground} exploded={exploded} floor={floor} mode={mode} command={command} onSelect={select} onFloor={changeFloor} onCamera={handleCamera} onReady={handleReady}/></Suspense></SceneBoundary>
        {!ready&&!sceneFailed&&<div className="map-loading"><span className="loading-cube"><Box size={33}/></span><h2>Building your district</h2><p>{district.buildings.length} buildings. One connected neighbourhood.</p><div className="loading-track"><i/></div></div>}
        <button ref={mobileLayersButton} className="mobile-layers-button" aria-expanded={mobileLayers} onClick={()=>setMobileLayers(v=>!v)}><Layers3 size={17}/>Layers</button>
        <div className="map-toolbar"><div className="view-switch"><button className={mode==='3d'?'active':''} onClick={()=>setView('3d')}>3D</button><button className={mode==='2d'?'active':''} onClick={()=>setView('2d')}>2D</button></div></div>
        <div className="map-fit-tools"><button aria-expanded={overviewOpen} onClick={()=>setOverviewOpen(v=>!v)}><Map size={16}/><span>Overview</span></button><button aria-label="Fit block" onClick={()=>{move('block');}} title="Fit the selected neighbourhood"><Scan size={16}/><span>Fit block</span></button><button aria-label="Fit district" onClick={()=>{move('district');}} title={`View all ${district.buildings.length} buildings`} data-testid="fit-district"><Maximize size={15}/><span>Fit district</span></button></div>
        <div className="district-chip"><i/>{district.buildings.length} buildings <span>·</span> {(district.extent**2/1e6).toFixed(3)} km²<span className="chip-divider"/>Prepared synthetic dataset</div>
        <div className="map-controls"><button className="compass" onClick={()=>move('north')} title="Orient north"><span>N</span><i style={{transform:`rotate(${-camera.heading}rad)`}}/></button><div className="zoom-controls"><button onClick={()=>move('zoomIn')} title="Zoom in"><Plus size={19}/></button><button onClick={()=>move('zoomOut')} title="Zoom out"><Minus size={19}/></button><button onClick={focus} title="Focus selected building" disabled={!selected}><Crosshair size={18}/></button></div><button className="fullscreen-control" onClick={()=>setPresentation(v=>!v)} title={presentation?'Restore panels':'Expand map'}><Maximize size={17}/></button><button className="fullscreen-control" onClick={()=>setModal('help')} title="Map interaction help"><HelpCircle size={17}/></button></div>
        {underground&&<div className="underground-banner"><Droplets size={16}/><div><strong>Subsurface inspection</strong><span>Water −2.6 m · Sewer −3.8 m · Power −1.2 m</span></div><button onClick={()=>setUnderground(false)} title="Return to surface"><X size={15}/></button></div>}
        {overviewOpen&&<div className="minimap"><div className="minimap-image"><AerialMap selected={selectedId||undefined} onSelect={selectAndFly}/><span className="minimap-extent" style={{left:`${Math.max(4,Math.min(92,50+camera.x/(district.extent/100)))}%`,top:`${Math.max(4,Math.min(92,50+camera.z/(district.extent/100)))}%`,width:`${Math.max(8,Math.min(85,35/camera.zoom))}%`,height:`${Math.max(8,Math.min(85,32/camera.zoom))}%`}}/></div><button onClick={()=>{move('district');}}>District overview <ArrowUpRight size={12}/></button><button onClick={()=>setOverviewOpen(false)}>Close overview</button></div>}
        {selected&&(exploded||floor!==null)&&<div className="floor-toolbar"><span><Layers3 size={16}/>{exploded?'Exploded floors':'Floor cutaway'}</span><button className={floor===null?'active':''} onClick={()=>setFloor(null)}>All</button>{Array.from({length:selected.floors},(_,f)=><button className={floor===f?'active':''} key={f} onClick={()=>changeFloor(f)}>{f===0?'G':f}</button>)}<button title="Toggle exploded floors" className={exploded?'active':''} onClick={toggleExplode}><Layers3 size={16}/></button><button onClick={()=>{navigate({floor:null,unit:null,exploded:false});move('block');}} title="Return to full building"><X size={16}/></button></div>}
        <div className="map-bottom-bar"><div className="scale"><span data-metres={scale.metres} style={{width:`${scale.pixels}px`}}/><small>{scale.label}</small></div><p>Local E {camera.x.toFixed(1)} <span>·</span> N {(-camera.z).toFixed(1)} <b>|</b> Synthetic data <b>|</b> {mode==='3d'?'3D scene':'Orthographic plan'}</p></div>
        {!selected&&<div className="selection-hint"><Building2 size={17}/>Select a building to inspect its parcel, floors and records.</div>}
      </main>
      {selected&&!presentation&&<Inspector building={selected} findings={findings} tab={tab} onTab={setTab} onClose={()=>navigate({property:null,floor:null,unit:null,doc:null,exploded:false,tab:'overview'})} onFocus={focus} onModal={openModal} onFloor={changeFloor} onExplode={toggleExplode} exploded={exploded} floor={floor} unitId={route.unit} onUnit={selectUnit} preview={preview} mobileExpanded={mobileExpanded} onToggleMobile={()=>setMobileExpanded(v=>!v)}/>}
    </div>
    {toast&&<div className="toast" role="status"><Check size={17}/><span>{toast}</span><button title="Dismiss notification" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {modal==='workspace'&&<StudioWorkspace key={recordBuilding.id} b={recordBuilding} context={recordContext} onContext={context=>navigate({doc:context.doc??null,unit:context.unitId??null,floor:context.floor??null})} onClose={()=>setModal(null)} onRegister={()=>navigate({view:'register',doc:null})}/>}
    {quickDocument&&selected&&<QuickDocumentDrawer building={selected} context={quickDocument} onClose={()=>navigate({doc:null})} onFull={()=>navigate({view:'register'})}/>}
    {modal==='import'&&<StudioImport onClose={()=>setModal(null)}/>}
    {modal&&modal!=='export'&&modal!=='workspace'&&modal!=='import'&&<RecordModal key={`${modal}-${recordBuilding.id}`} context={recordContext} onContext={context=>navigate({doc:context.doc??null,unit:context.unitId??null,floor:context.floor??null})} preview={preview} kind={modal} building={recordBuilding} findings={findings} onClose={()=>setModal(null)} onFloor={f=>{navigate({view:'map',floor:f,unit:null,doc:null,tab:'floors'});focus();}}/>}
    {modal==='export'&&<div className="rec-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null);}}><DialogSection onClose={()=>setModal(null)} labelledBy="export-title" className="export-dialog"><header><span className="export-icon"><Database size={25}/></span><button className="icon-button" onClick={()=>setModal(null)} aria-label="Close export dialog"><X size={20}/></button></header><span className="ins-eyebrow">LOCAL, SELF-CONTAINED DATASET</span><h2 id="export-title">Take the district with you.</h2><p>Export the same records and geometry used by the map. Every dataset and document is clearly marked as synthetic.</p><div className="export-stats"><span><strong>{district.buildings.length}</strong>buildings & parcels</span><span><strong>{district.buildings.reduce((s,b)=>s+b.units.length,0).toLocaleString()}</strong>unit records</span><span><strong>{district.utilities.length}</strong>utility segments</span></div><div className="export-options"><button onClick={()=>{saveJSON(exportGeoJSON(),'DEMO-lake-view-parcels.geojson');notify(`${district.buildings.length} synthetic parcels exported as GeoJSON.`);}}><Map size={20}/><div><strong>2D parcel GeoJSON</strong><small>14-digit demo IDs · approximate WGS84 placement</small></div><Download size={16}/></button><button onClick={()=>{saveJSON({...district,synthetic:true,findings:allFindings},'DEMO-complete-district.json');notify('Complete linked district dataset exported.');}}><Database size={20}/><div><strong>Complete linked dataset</strong><small>Buildings, floors, residents, roads, utilities & findings</small></div><Download size={16}/></button><button onClick={()=>downloadDocument('aerial',recordBuilding)}><FileText size={20}/><div><strong>District overview PDF</strong><small>Entire area, north arrow context & legend</small></div><Download size={16}/></button><button onClick={snapshot}><Box size={20}/><div><strong>Current map as PNG</strong><small>Capture the current 3D or 2D camera view</small></div><Download size={16}/></button></div><div className="export-note"><Info size={16}/><p>Local dimensions are synthetic metres. GeoJSON uses an approximate demonstration origin near Delhi, not a surveyed location. No official land records or real personal data are included.</p></div></DialogSection></div>}
  </div>;
}

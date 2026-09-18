import { Building2, X, MapPin, Layers3, ChevronRight, FileText, TriangleAlert, Expand, ArrowUpRight, Droplets, Users, Box, Landmark, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Building, Finding, InspectorTab, ModalKind, RecordContext } from '../types';
import { BuildingPreview, FloorPlan } from './Visuals';
import UtilitySection, { nearestWater } from './UtilitySection';
import {district} from '../data/district';
import SourceReceipt from './SourceReceipt';
type Props={building:Building;findings:Finding[];tab:InspectorTab;onTab:(t:InspectorTab)=>void;onClose:()=>void;onFocus:()=>void;onModal:(k:ModalKind,c?:RecordContext)=>void;onFloor:(f:number|null)=>void;onExplode:()=>void;exploded:boolean;floor:number|null;preview?:string;mobileExpanded?:boolean;onToggleMobile?:()=>void};

export default function Inspector({building:b,findings,tab,onTab,onClose,onFocus,onModal,onFloor,onExplode,exploded,floor,preview,mobileExpanded,onToggleMobile}:Props){
  const scroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{scroll.current?.scrollTo({top:0});},[b.id,tab]);
  const closest=nearestWater(b),parcelFinding=findings.find(f=>f.type==='Parcel');
  const vacant=b.units.filter(u=>u.tenure==='Vacant').length;
  return <aside className={`inspector ${mobileExpanded?'mobile-expanded':'mobile-peek'}`} aria-label="Property inspector">
    <div className="ins-heading"><strong><Building2 size={17}/>Building</strong><div><button className="icon-button" title="Focus selected building" onClick={onFocus}><Expand size={16}/></button><button className="icon-button" title="Close inspector" onClick={onClose}><X size={18}/></button></div></div>
    <div className="mobile-property-handle"><button onClick={onToggleMobile} aria-expanded={mobileExpanded} aria-label={mobileExpanded?'Collapse property details':'Expand property details'}><Building2 size={20}/><span><strong>{b.name}</strong><small>{b.ulpin} · {b.floors} floors</small></span>{mobileExpanded?<ChevronDown size={20}/>:<ChevronUp size={20}/>}</button><button onClick={onClose} aria-label="Close mobile property details"><X size={18}/></button></div>
    <div ref={scroll} className="ins-scroll">
      <div className="ins-preview">{preview?<img className="building-preview" src={preview} alt={`Scene view of ${b.name}`}/>:<BuildingPreview b={b}/>}<span className={`ins-preview-status ${findings.length?'alert':''}`}>{findings.length?<TriangleAlert size={13}/>:<Check size={13}/>} {findings.length?`${findings.length} inspection findings`:'No geometry findings'}</span><button onClick={onFocus} className="ins-preview-focus" title="Focus building on map"><Expand size={16}/></button></div>
      <div className="ins-identity"><span className="ins-eyebrow">SYNTHETIC PROPERTY REFERENCE</span><h2 data-testid="selected-ulpin">{b.ulpin}</h2><p className="ins-building-name">{b.name}</p><p><MapPin size={14}/>{b.address}</p><div className="ins-badges"><span><Building2 size={13}/>{b.use}</span><span><Layers3 size={13}/>G+{b.floors-1}</span><span className="green"><i/>Modelled</span></div></div>
      <nav className="ins-tabs" aria-label="Inspector tabs">{(['overview','parcel','floors','evidence','utilities'] as InspectorTab[]).map(t=><button aria-current={tab===t?'page':undefined} className={tab===t?'active':''} key={t} onClick={()=>onTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}</nav>
      <div className="ins-content">
        {tab==='overview'&&<>
          <div className="ins-metrics"><div><span>Footprint</span><strong>{b.width*b.depth} <small>m²</small></strong></div><div><span>Floors / units</span><strong>{b.floors} / {b.units.length}</strong></div><div><span>Parcel area</span><strong>{(b.parcel.width*b.parcel.depth).toFixed(2)} <small>m²</small></strong></div></div>
          {parcelFinding&&<div className="ins-alert"><TriangleAlert size={21}/><div><span>Footprint outside recorded parcel</span><strong>{parcelFinding.value} m²</strong></div><span className="ins-tiny-pill">Computed</span></div>}
          <div className="ins-section-title"><h3>Issues & clearances <span>({findings.length})</span></h3><span>Geometry checks</span></div>
          {findings.length?findings.map(f=><button key={f.id} className={`ins-finding ${f.type==='Utility'?'utility':''}`} onClick={()=>onTab(f.type==='Utility'?'utilities':'parcel')}><span className="ins-finding-icon">{f.type==='Utility'?<Droplets size={17}/>:<TriangleAlert size={16}/>}</span><span>{f.title}</span><strong>{f.value} {f.unit}</strong><ChevronRight size={14}/></button>):<div className="ins-ok"><Check size={17}/>Footprint is inside this demo parcel.</div>}
          <div className="ins-section-title"><h3>Linked property records</h3><span>{b.units.length} units</span></div>
          <button className="ins-link-row" onClick={()=>onTab('parcel')}><span className="ins-tile"><Landmark size={17}/></span><div><strong>Land & parcel record</strong><small>{b.parcelId} · {b.owner}</small></div><ChevronRight size={16}/></button>
          <button className="ins-link-row" onClick={()=>onTab('floors')}><span className="ins-tile"><Users size={17}/></span><div><strong>Floor-wise occupancy</strong><small>{b.units.length-vacant} occupied · {vacant} vacant</small></div><ChevronRight size={16}/></button>
          <button className="ins-link-row" onClick={()=>onModal('documents',{doc:'land'})}><span className="ins-tile"><FileText size={17}/></span><div><strong>Evidence & documents</strong><small>Parcel, floor plans & rental records</small></div><ChevronRight size={16}/></button>
        </>}
        {tab==='parcel'&&<>
          <div className="ins-section-title"><h3>Parcel & land details</h3><Landmark size={17}/></div>
          <dl className="ins-details">{[['Parcel ID',b.parcelId],['Demo ULPIN',b.ulpin],['Survey reference',b.surveyNumber],['Owner (fictional)',b.owner],['Land use',b.use],['Tenure','Freehold (demo)'],['Parcel area',`${b.parcel.width*b.parcel.depth} m²`],['Ground footprint',`${b.width*b.depth} m²`],['Gross floor area',`${b.width*b.depth*b.floors} m²`],['Model height',`${b.height.toFixed(1)} m`],['Record date',b.registeredOn]].map(([l,v])=><div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>
          <button className="ins-wide-button" onClick={()=>onModal('documents',{doc:'land'})}><FileText size={16}/>Inspect land record<ArrowUpRight size={15}/></button>
          <p className="ins-note">Local metre-based geometry. This identifier is a demo reference, not an issued ULPIN. Ownership is fictional.</p>
        </>}
        {tab==='floors'&&<>
          <div className="ins-section-title"><h3>Floors & units</h3><span>{b.units.length} linked records</span></div>
          <div className="ins-floor-actions"><button onClick={onExplode} className={exploded?'active':''}><Layers3 size={16}/>{exploded?'Collapse floors':'Explode floors'}</button><button onClick={()=>onFloor(null)}>Show all</button></div>
          {Array.from({length:b.floors},(_,i)=>b.floors-1-i).map(f=><div key={f} className={`ins-floor ${floor===f?'active':''}`}><button className="ins-floor-heading" onClick={()=>onFloor(f)}><Layers3 size={16}/><strong>{f===0?'Ground floor':`Floor ${f}`}</strong><span>+{(f*b.floorHeight).toFixed(1)} m</span><ChevronRight size={15}/></button>{b.units.filter(u=>u.floor===f).map(u=><button className="ins-unit" key={u.id} onClick={()=>onModal('register',{unitId:u.id,floor:f})}><div><strong>Unit {u.number}</strong><small>{u.occupant}</small></div><span className={u.tenure==='Vacant'?'vacant':'occupied'}>{u.tenure==='Rented'?'Rented':u.tenure==='Vacant'?'Vacant':'Owner'}</span></button>)}</div>)}
          <p className="ins-note">Select a floor to cut it away, or a unit to inspect that exact occupancy record. Rooms share the same geometry across map, plan and register.</p>
        </>}
        {tab==='evidence'&&<>
          <div className="ins-section-title"><h3>Evidence & documents</h3><span>Demo specimens</span></div>
          <button className="ins-link-row" onClick={()=>onModal('documents',{doc:'land'})}><span className="ins-tile"><Landmark size={17}/></span><div><strong>Land record & parcel map</strong><small>Ownership reference and 2D boundary</small></div><ArrowUpRight size={15}/></button>
          <button className="ins-link-row" onClick={()=>onModal('documents',{doc:'plan',floor:floor??0})}><span className="ins-tile"><Layers3 size={17}/></span><div><strong>Floor plans</strong><small>Ground through top floor</small></div><ArrowUpRight size={15}/></button>
          <button className="ins-link-row" onClick={()=>onModal('documents',{doc:'lease',floor:floor??0})}><span className="ins-tile"><Users size={17}/></span><div><strong>Occupancy & rent agreements</strong><small>Unit-linked fictional residents</small></div><ArrowUpRight size={15}/></button>
          <button className="ins-link-row" onClick={()=>onModal('aerial')}><span className="ins-tile"><MapPin size={17}/></span><div><strong>Neighbourhood overview</strong><small>Entire {district.extent} × {district.extent} m fixture</small></div><ArrowUpRight size={15}/></button>
          <SourceReceipt buildingId={b.id}/>
          <button className="ins-plan-preview" onClick={()=>onModal('documents',{doc:'plan',floor:floor??0})} aria-label="Open floor plan preview"><FloorPlan b={b} floor={floor??0}/></button>
        </>}
        {tab==='utilities'&&<>
          <div className="ins-section-title"><h3>Nearest utility asset</h3><Droplets size={18}/></div>
          <div className="utility-asset-title"><Droplets size={21}/><strong>Water pipeline</strong><span>Active demo</span></div>
          <dl className="ins-details">{[['Asset ID',closest.u.id],['Network',closest.u.operator],['Diameter',`${closest.u.diameter} mm`],['Centre depth',`${closest.u.depth} m below grade`],['Horizontal clearance',`${closest.gap} m`]].map(([l,v])=><div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>
          <div className={`utility-clearance ${closest.gap<2?'warning':''}`}><Droplets size={20}/><div><span>Horizontal clearance</span><strong>{closest.gap} m</strong><small>{closest.gap<2?'Below':'Above'} the 2 m demo review threshold</small></div></div>
          <div className="ins-section-title"><h3>Section · ground to pipe</h3></div><div className="ins-section-diagram"><UtilitySection building={b}/></div>
          <p className="ins-note">Horizontal clearance and pipe burial depth are different measurements. The 2 m threshold is a demonstration setting, not a municipal regulation.</p>
        </>}
      </div>
    </div>
    <div className="ins-footer"><button onClick={()=>onModal('register',{floor:floor??undefined})}><FileText size={16}/>Open register</button><button onClick={()=>onModal('workspace',{doc:'plan',floor:floor??0})}><Box size={16}/>Open workspace</button><p>All people, identifiers and records are synthetic.</p></div>
  </aside>;
}

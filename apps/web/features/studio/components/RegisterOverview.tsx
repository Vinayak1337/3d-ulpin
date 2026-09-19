import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Box, Building2, ChevronDown, FileText, Layers3, Ruler, Users, CheckCircle2 } from 'lucide-react';
import type { Building, Unit } from '../types';
import RegisterModel from '../scene/RegisterModel';
import FloorPlan from './FloorPlan';
import SectionView from '../../spatial/SectionView';
import {getFloorLayout} from '../data/floorLayout';
import type {SectionBody} from '../../spatial/data/section';

type Props={b:Building;unit:Unit;floor:number;onFloor:(f:number)=>void;onUnit:(u:Unit)=>void;onDocument:(u:Unit)=>void;onMap:(f:number)=>void};
export default function RegisterOverview({b,unit,floor,onFloor,onUnit,onDocument,onMap}:Props){
  const [view,setView]=useState<'exploded'|'elevation'|'plan'|'section'>('exploded');
  const [collapsed,setCollapsed]=useState<number[]>([]);
  const sections=useMemo<SectionBody[]>(()=>Array.from({length:b.floors},(_,floor)=>getFloorLayout(b,floor).units.map(({unit,boundary:r})=>({id:unit.id,label:`Unit ${unit.number}`,lower:floor*b.floorHeight,upper:(floor+1)*b.floorHeight,reference:'Authored local grade ? synthetic',geometry:{type:'Polygon' as const,coordinates:[[[r.x-r.width/2,r.z-r.depth/2],[r.x+r.width/2,r.z-r.depth/2],[r.x+r.width/2,r.z+r.depth/2],[r.x-r.width/2,r.z+r.depth/2],[r.x-r.width/2,r.z-r.depth/2]]]}}))).flat(),[b]);
  const table=useRef<HTMLElement>(null);
  useEffect(()=>{
    const panel=table.current,row=panel?.querySelector<HTMLElement>(`[data-unit-id="${unit.id}"]`);
    if(!panel||!row)return;
    const p=panel.getBoundingClientRect(),r=row.getBoundingClientRect();
    if(r.top<p.top+85)panel.scrollTop+=r.top-(p.top+90);
    else if(r.bottom>p.bottom-155)panel.scrollTop+=r.bottom-(p.bottom-160);
  },[unit.id,collapsed]);
  return <div className="register-overview">
    <div className="register-metrics"><div><Layers3 size={24}/><span><strong>{b.floors}</strong><small>Floors · G+{b.floors-1}</small></span></div><div><Users size={24}/><span><strong>{b.units.length}</strong><small>Linked units</small></span></div><div><Ruler size={23}/><span><strong>{b.width*b.depth} <em>m²</em></strong><small>Ground footprint</small></span></div><div><Building2 size={23}/><span><strong>{b.parcel.width*b.parcel.depth} <em>m²</em></strong><small>Recorded demo parcel</small></span></div></div>
    <div className="register-split"><section className="register-model-panel"><header><span><Box size={16}/>Linked building model</span><span className="green-label">Interactive</span></header><div className="register-model">
      {view==='section'?<SectionView bodies={sections} selectedId={unit.id} onSelect={id=>{const u=b.units.find(u=>u.id===id);if(u)onUnit(u);}}/>:view==='plan'?<FloorPlan b={b} floor={floor} selectedUnit={unit.id} onUnit={id=>{const u=b.units.find(u=>u.id===id);if(u)onUnit(u);}}/>:<RegisterModel b={b} floor={floor} selectedUnit={unit.id} elevation={view==='elevation'} onFloor={onFloor} onUnit={id=>{const u=b.units.find(u=>u.id===id);if(u){onUnit(u);}}}/>}
    </div><div className="register-view-switch"><button className={view==='exploded'?'active':''} onClick={()=>setView('exploded')}><Box size={14}/>3D view</button><button className={view==='elevation'?'active':''} onClick={()=>setView('elevation')}><Building2 size={14}/>Elevation</button><button className={view==='plan'?'active':''} onClick={()=>setView('plan')}><Layers3 size={14}/>Floor plan</button><button className={view==='section'?'active':''} onClick={()=>setView('section')}>Section</button></div><p className="register-model-hint">Drag to pan · Right-drag to orbit · Scroll to zoom<br/>Floors and plans share the same room geometry.</p></section>
    <section ref={table} className="register-table-panel"><header><h3>Floors & units</h3><span>{b.units.filter(u=>u.tenure!=='Vacant').length} occupied</span></header><div className="register-table-head"><span>Level / unit</span><span>Usable area</span><span>Occupancy</span></div>
      {Array.from({length:b.floors},(_,i)=>b.floors-i-1).map(f=><section className={`register-floor-group ${floor===f?'active':''}`} key={f}>
        <div className="register-level"><button onClick={()=>onFloor(f)}><Layers3 size={16}/><strong>{f===0?'Ground floor':`Floor ${f}`}</strong><small>+{(f*b.floorHeight).toFixed(1)} m</small></button><button aria-label={`${collapsed.includes(f)?'Expand':'Collapse'} floor ${f} units`} onClick={()=>setCollapsed(old=>old.includes(f)?old.filter(n=>n!==f):[...old,f])}><ChevronDown size={16} style={{transform:collapsed.includes(f)?'rotate(-90deg)':''}}/></button></div>
        {!collapsed.includes(f)&&b.units.filter(u=>u.floor===f).map(u=><button className={`register-unit-row ${unit.id===u.id?'active':''}`} data-unit-id={u.id} key={u.id} onClick={()=>{onUnit(u);}}><span><strong>Unit {u.number}</strong><small>{u.occupant}</small></span><span>{u.area.toFixed(2)} m²</span><span className={`unit-status ${u.tenure==='Vacant'?'vacant':''}`}>{u.tenure==='Owner occupied'?'Owner':u.tenure}</span></button>)}
      </section>)}
      <div className="register-selection" data-selected-unit={unit.id}><div><CheckCircle2 size={16}/><strong>Unit {unit.number}</strong><span>{unit.bedrooms} bedroom{unit.bedrooms===1?'':'s'}</span></div><p>{unit.occupant}<small>{unit.tenure==='Rented'?`₹${unit.rent.toLocaleString('en-IN')} / month · ${unit.leaseStart} to ${unit.leaseEnd}`:unit.tenure}</small></p><div className="register-selection-actions"><button onClick={()=>onDocument(unit)}><FileText size={15}/>Inspect record</button><button onClick={()=>onMap(unit.floor)}><ArrowUpRight size={15}/>View in map</button></div></div>
    </section></div>
  </div>;
}

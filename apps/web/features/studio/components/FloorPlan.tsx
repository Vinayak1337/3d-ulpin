import type { Building } from '../types';
import { getFloorLayout, roomPalette } from '../data/floorLayout';
import {useId} from 'react';

export default function FloorPlan({b,floor=0,selectedUnit,onUnit,onPoint,points=[],closed=false}:{b:Building;floor?:number;selectedUnit?:string;onUnit?:(id:string)=>void;onPoint?:(point:[number,number])=>void;points?:readonly (readonly [number,number])[];closed?:boolean}) {
  const gridId=useId().replaceAll(':','');
  const layout=getFloorLayout(b,floor),s=Math.min(435/b.width,298/b.depth),left=(600-b.width*s)/2,top=64;
  const X=(x:number)=>left+(x+b.width/2)*s,Z=(z:number)=>top+(z+b.depth/2)*s;
  return <svg viewBox="0 0 600 430" className="floor-plan" role="img" aria-label={`Metre-based floor ${floor} plan; ${layout.units.map(u=>`unit ${u.unit.number}: ${u.unit.bedrooms} bedrooms`).join(', ')}`} onClick={e=>{if(!onPoint)return;const m=e.currentTarget.getScreenCTM();if(!m)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()),x=(p.x-left)/s-b.width/2,z=(p.y-top)/s-b.depth/2;if(Math.abs(x)<=b.width/2&&Math.abs(z)<=b.depth/2)onPoint([Math.round(x*100)/100,Math.round(z*100)/100]);}}>
    <defs><pattern id={gridId} width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0H0V15" fill="none" stroke="#e3e9e7" strokeWidth=".5"/></pattern></defs>
    <rect width="600" height="430" fill="#fafcfb"/><rect width="600" height="430" fill={`url(#${gridId})`}/>
    <text x="28" y="28" fontFamily="Arial" fontSize="11" fill="#708078">{floor===0?'GROUND FLOOR':`FLOOR ${floor}`} · +{(floor*b.floorHeight).toFixed(1)} m</text>
    <text x="560" y="33" textAnchor="middle" fontFamily="Arial" fontSize="10" fill="#42604e">N</text><path d="M560 39l-4 11 4-3 4 3z" fill="#42604e"/>
    <rect x={left} y={top} width={b.width*s} height={b.depth*s} fill="#c7cec9" stroke="#53675c" strokeWidth="2"/>
    <rect x={X(-.8)} y={Z(-layout.corridor.depth/2)} width={1.6*s} height={layout.corridor.depth*s} fill="#f0efe6"/>
    {Array.from({length:10},(_,i)=><path key={i} d={`M${X(-.65)} ${Z(-b.depth*.12+i*.25)}h${1.3*s}`} stroke="#9eaaa0" strokeWidth="1"/>)}
    {layout.units.map(({unit,rooms,boundary})=><g key={unit.id} data-unit-id={unit.id} onClick={()=>{if(!onPoint)onUnit?.(unit.id);}} style={{cursor:onPoint?'crosshair':onUnit?'pointer':'default'}}>
      {rooms.map(r=><g key={r.id} data-room-kind={r.kind}>
        <rect x={X(r.x-r.width/2)} y={Z(r.z-r.depth/2)} width={r.width*s} height={r.depth*s} fill={roomPalette[r.kind]} stroke="#87978b" strokeWidth="1.2"/>
        {r.kind==='bedroom'&&<g><rect x={X(r.x-r.width/2+.3)} y={Z(r.z-r.depth/2+.35)} width={Math.min(1.55,r.width-.5)*s} height={2*s} fill="#b5c5b4" stroke="#809383" strokeWidth=".7"/><rect x={X(r.x-r.width/2+.38)} y={Z(r.z-r.depth/2+.45)} width={Math.min(1.38,r.width-.66)*s} height={.45*s} rx="2" fill="#fcfaf2"/></g>}
        {r.kind==='kitchen'&&<path d={`M${X(r.x-r.width/2+.2)} ${Z(r.z-r.depth/2+.2)}h${(r.width-.4)*s}v${.55*s}h${-(r.width-.4)*s}z`} fill="#a7b5a7"/>}
        {r.kind==='living'&&<g><rect x={X(r.x-r.width/2+.35)} y={Z(r.z-r.depth/2+.6)} width={.8*s} height={2*s} rx="3" fill="#9bada4"/><rect x={X(r.x-.45)} y={Z(r.z-.25)} width={.9*s} height={.65*s} rx="2" fill="#bf9d75"/></g>}
        <text x={X(r.x)} y={Z(r.z+r.depth*.31)} textAnchor="middle" fontFamily="Arial" fontSize={r.width*s<54?7.5:9} fill="#53645a">{r.label}</text>
      </g>)}
      <rect x={X(boundary.x-boundary.width/2)} y={Z(-boundary.depth/2)} width={boundary.width*s} height={boundary.depth*s} fill="none" stroke={selectedUnit===unit.id?'#168474':'transparent'} strokeWidth="3"/>
      <text x={X(boundary.x)} y={Z(boundary.depth/2)-8} textAnchor="middle" fontFamily="Arial" fontSize="9" fontWeight="bold" fill="#416052">UNIT {unit.number} · {unit.area.toFixed(2)} m²</text>
    </g>)}
    {points.length>0&&<g pointerEvents="none"><path d={points.map(([x,z],i)=>`${i?'L':'M'}${X(x)} ${Z(z)}`).join(' ')+(closed&&points.length>2?'Z':'')} fill={closed?'#15916a20':'none'} stroke="#168474" strokeWidth="2.4" strokeDasharray={closed?undefined:'5 3'}/>{points.map(([x,z],i)=><g key={i}><circle cx={X(x)} cy={Z(z)} r="4.5" fill="white" stroke="#13845d" strokeWidth="2"/><text x={X(x)+7} y={Z(z)-8} fontSize="9" fill="#235d48">{i+1}</text></g>)}</g>}
    <path d={`M${left} ${top-14}V${top-24}M${left+b.width*s} ${top-14}V${top-24}M${left} ${top-19}h${b.width*s}`} fill="none" stroke="#84988e"/>
    <text x="300" y={top-25} textAnchor="middle" fontFamily="Arial" fontSize="10" fill="#667a6f">{b.width.toFixed(1)} m</text>
    <text x={left-23} y={top+b.depth*s/2} textAnchor="middle" transform={`rotate(-90 ${left-23} ${top+b.depth*s/2})`} fontFamily="Arial" fontSize="10" fill="#667a6f">{b.depth.toFixed(1)} m</text>
    <text x="300" y="405" textAnchor="middle" fontFamily="Arial" fontSize="10" fill="#788a80">SYNTHETIC PLAN · Same room geometry as the 3D cutaway and register</text>
  </svg>;
}

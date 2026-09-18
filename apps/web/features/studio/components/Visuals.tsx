import type { Building } from '../types';
import { district } from '../data/district';
export function BuildingPreview({b}:{b:Building}) {
  const floors=Math.min(b.floors,6);const h=floors*18;const y=155-h;
  return <svg className="building-preview" viewBox="0 0 330 188" role="img" aria-label={`Illustrated ${b.floors}-floor building`}>
    <defs><linearGradient id="preview-sky" x2="0" y2="1"><stop stopColor="#e0e9e1"/><stop offset="1" stopColor="#c9d3bd"/></linearGradient><filter id="preview-shadow"><feGaussianBlur stdDeviation="4"/></filter></defs>
    <rect width="330" height="188" fill="url(#preview-sky)"/><path d="M0 140L170 67L330 124L148 211Z" fill="#adb891"/><path d="M0 178L139 116L330 184" stroke="#7d8980" strokeWidth="30" fill="none"/><path d="M0 178L139 116L330 184" stroke="#e0dfcb" strokeWidth="1" strokeDasharray="9 8" fill="none"/>
    <path d="M60 158L183 107L277 140L146 195Z" fill="#42583a" opacity=".2" filter="url(#preview-shadow)"/>
    <path d={`M117 ${y+20}L179 ${y-3}L229 ${y+17}V148L168 170L117 150Z`} fill="#bda996"/>
    <path d={`M117 ${y+20}L168 ${y+42}V170L117 150Z`} fill="#d8c9b3"/>
    <path d={`M168 ${y+42}L229 ${y+17}V148L168 170Z`} fill="#b5b4a4"/>
    <path d={`M115 ${y+19}L178 ${y-7}L232 ${y+16}L169 ${y+42}Z`} fill="#e7e4d7" stroke="#f5f2e9" strokeWidth="3"/>
    <path d={`M128 ${y+19}L178 ${y-1}L219 ${y+16}L169 ${y+35}Z`} fill="#c3c9bd"/>
    {Array.from({length:floors},(_,f)=>[0,1,2].map(c=><g key={`${f}-${c}`}>
      <path d={`M${175+c*16} ${y+51+f*18-c*6.5}l9 -3.6v10l-9 3.6Z`} fill="#586e6d"/>
      {c<2&&<path d={`M${124+c*20} ${y+39+f*18+c*8}l12 5v10l-12 -5Z`} fill="#526b69"/>}
    </g>))}
    <path d={`M167 ${y+42}V170M117 150L168 170L229 148`} stroke="#e88765" strokeWidth="2.5" fill="none"/>
    <path d={`M115 ${y+19}L178 ${y-7}L232 ${y+16}L169 ${y+42}Z`} fill="#df6b57" opacity=".17"/>
    {[ [64,141],[84,105],[258,132],[281,158],[42,168],[275,96] ].map(([x,z],i)=><g key={i}><path d={`M${x} ${z}v14`} stroke="#7a7357" strokeWidth="3"/><circle cx={x} cy={z-4} r={10+i%3} fill={i%2?'#758d52':'#607c48'}/><circle cx={x-4} cy={z-8} r="7" fill="#8c9f65"/></g>)}
  </svg>;
}
export function AerialMap({selected,className='',onSelect}:{selected?:string;className?:string;onSelect?:(id:string)=>void}) {
 const half=district.extent/2+10,size=half*2;
 return <svg className={className} viewBox={`${-half} ${-half} ${size} ${size}`} role="img" aria-label="Synthetic orthographic overview of the complete neighbourhood">
  <rect x={-half} y={-half} width={size} height={size} fill="#778580"/>
  {district.blocks.map(b=><rect key={b.id} x={b.x-b.width/2} y={b.z-b.depth/2} width={b.width} height={b.depth} rx="1" fill="#b6bf9f"/>)}
  {district.parks.map(p=><g key={p.id}><rect x={p.x-p.width/2} y={p.z-p.depth/2} width={p.width} height={p.depth} fill="#88a16b"/><path d={`M${p.x-p.width/2} ${p.z}h${p.width}M${p.x} ${p.z-p.depth/2}v${p.depth}`} stroke="#c9c5a5" strokeWidth="1.4"/><circle cx={p.x} cy={p.z} r="3" fill="#9eb09b"/></g>)}
  {district.buildings.map(b=><g key={b.id} onClick={()=>onSelect?.(b.id)} style={{cursor:onSelect?'pointer':'default'}}><rect x={b.parcel.x-b.parcel.width/2} y={b.parcel.z-b.parcel.depth/2} width={b.parcel.width} height={b.parcel.depth} fill="none" stroke="#eceddb" strokeWidth=".5"/><rect x={b.x-b.width/2+1.1} y={b.z-b.depth/2+1.7} width={b.width} height={b.depth} fill="#5e6758" opacity=".28"/><rect x={b.x-b.width/2} y={b.z-b.depth/2} width={b.width} height={b.depth} fill={b.id===selected?'#dd745c':b.color} stroke={b.id===selected?'#a53623':'#a2aa9a'} strokeWidth={b.id===selected?1.2:.3}/></g>)}
  <g transform={`translate(${half-15},${-half+18})`}><circle r="8" fill="#fff" opacity=".9"/><path d="M0 -6L-3 5L0 3L3 5Z" fill="#315b4b"/><text y="-10" textAnchor="middle" fontSize="7" fill="#fff" fontFamily="Arial">N</text></g>
 </svg>;
}

export { default as FloorPlan } from "./FloorPlan";

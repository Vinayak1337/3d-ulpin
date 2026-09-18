import { Html, Line } from '@react-three/drei';
import type { Building } from '../types';
import { district, utilityClearance } from '../data/district';

/** Horizontal footprint-to-pipe measurement; vertical depth is shown separately. */
export default function UtilityMeasure({building:b,underground}:{building:Building;underground:boolean}){
  const {u,gap}=district.utilities.filter(u=>u.kind==='Water').map(u=>({u,gap:utilityClearance(b,u)})).sort((a,c)=>a.gap-c.gap)[0];
  const a=u.points[0],c=u.points.at(-1)!,horizontal=Math.abs(a[2]-c[2])<.001;
  const radius=u.diameter/2000;
  let x1:number,z1:number,x2:number,z2:number;
  if(horizontal){x1=x2=Math.max(Math.min(a[0],c[0]),Math.min(b.x,Math.max(a[0],c[0])));const sign=Math.sign(a[2]-b.z)||1;z1=b.z+sign*b.depth/2;z2=a[2]-sign*radius;}
  else{z1=z2=Math.max(Math.min(a[2],c[2]),Math.min(b.z,Math.max(a[2],c[2])));const sign=Math.sign(a[0]-b.x)||1;x1=b.x+sign*b.width/2;x2=a[0]-sign*radius;}
  const pipeY=underground?a[1]:.57;
  return <group>
    <Line points={[[a[0],pipeY,a[2]],[c[0],pipeY,c[2]]]} color="#3096c8" lineWidth={4} transparent opacity={.95}/>
    <Line points={[[x1,.67,z1],[x2,.67,z2]]} color="#d18d36" lineWidth={3} depthTest={false}/>
    {underground&&<Line points={[[x2,.67,z2],[x2,a[1],z2]]} color="#5899b2" dashed dashSize={.35} gapSize={.2} lineWidth={1.5}/>}
    {[ [x1,z1],[x2,z2] ].map(([x,z],i)=><mesh key={i} position={[x,.72,z]} raycast={()=>{}}><sphereGeometry args={[.24,12,8]}/><meshBasicMaterial color="#f7c46d" depthTest={false}/></mesh>)}
    <Html wrapperClass="map-label-wrapper" position={[(x1+x2)/2,2.4,(z1+z2)/2]} center zIndexRange={[19,0]}><div className="utility-map-callout"><strong>{gap} m</strong><span>Horizontal clearance</span></div></Html>
  </group>;
}

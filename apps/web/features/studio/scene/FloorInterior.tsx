import { getFloorLayout, roomPalette } from '../data/floorLayout';
import type { Building } from '../types';
import type { ThreeEvent } from '@react-three/fiber';

/** Shared metre-based interior, used by the map and the register workspace. */
export default function FloorInterior({b,floor,active=true,selectedUnit,onFloor,onUnit}:{b:Building;floor:number;active?:boolean;selectedUnit?:string;onFloor?:(f:number)=>void;onUnit?:(id:string)=>void}) {
  const layout=getFloorLayout(b,floor);
  const pick=(id:string)=>(e:ThreeEvent<MouseEvent>)=>{if(e.delta<5){e.stopPropagation();onFloor?.(floor);onUnit?.(id);}};
  return <group>
    <mesh receiveShadow castShadow position={[0,.12,0]}><boxGeometry args={[b.width,.24,b.depth]}/><meshStandardMaterial color={active?'#e6e1d3':'#bac5bf'}/></mesh>
    <mesh position={[0,.255,0]}><boxGeometry args={[1.6,.035,layout.corridor.depth]}/><meshStandardMaterial color="#e4e3d8"/></mesh>
    {layout.units.map(({unit,rooms,boundary})=><group key={unit.id}>
      <mesh position={[boundary.x,.276,0]} onClick={pick(unit.id)}><boxGeometry args={[boundary.width,.025,boundary.depth]}/><meshStandardMaterial color={selectedUnit===unit.id?'#99c6bc':'#d2d1c2'}/></mesh>
      {rooms.map(r=><group key={r.id} position={[r.x,0,r.z]}>
        <mesh position={[0,.29,0]} onClick={pick(unit.id)} receiveShadow><boxGeometry args={[r.width,.04,r.depth]}/><meshStandardMaterial color={selectedUnit===unit.id?'#a9cdc1':roomPalette[r.kind]}/></mesh>
        {[-1,1].map(side=><mesh castShadow key={side} position={[side*(r.width/2+.06),.8,0]}><boxGeometry args={[.12,1.04,r.depth+.16]}/><meshStandardMaterial color="#eeeae0"/></mesh>)}
        <mesh castShadow position={[0,.8,-r.depth/2-.06]}><boxGeometry args={[r.width+.12,1.04,.12]}/><meshStandardMaterial color="#e9e5d9"/></mesh>
        {r.kind==='bedroom'&&<group position={[-r.width/2+1.02,0,-r.depth/2+1.45]}>
          <mesh castShadow position={[0,.59,0]}><boxGeometry args={[1.5,.52,2.1]}/><meshStandardMaterial color="#a9baad"/></mesh>
          <mesh position={[0,.88,0]}><boxGeometry args={[1.43,.12,1.96]}/><meshStandardMaterial color="#eeeadd"/></mesh>
          <mesh position={[0,.97,-.63]}><boxGeometry args={[1.26,.11,.48]}/><meshStandardMaterial color="#f8f6ec"/></mesh>
          <mesh position={[0,.97,.32]}><boxGeometry args={[1.44,.065,1.12]}/><meshStandardMaterial color={floor%2?'#94ac9f':'#c1af8e'}/></mesh>
          <mesh castShadow position={[1.13,.63,-.54]}><boxGeometry args={[.48,.55,.48]}/><meshStandardMaterial color="#b7956b"/></mesh>
        </group>}
        {r.kind==='living'&&<>
          <mesh castShadow position={[-r.width/2+.75,.69,-r.depth/2+1.55]}><boxGeometry args={[.88,.72,2.6]}/><meshStandardMaterial color="#98aea4"/></mesh>
          <mesh castShadow position={[-r.width/2+.38,1.02,-r.depth/2+1.55]}><boxGeometry args={[.2,.65,2.6]}/><meshStandardMaterial color="#819b8e"/></mesh>
          <mesh castShadow position={[0,.56,-.7]}><boxGeometry args={[1,.45,.8]}/><meshStandardMaterial color="#b7986e"/></mesh>
          <mesh castShadow position={[r.width*.18,.68,r.depth*.18]}><boxGeometry args={[1.3,.75,1.1]}/><meshStandardMaterial color="#b89a73"/></mesh>
        </>}
        {r.kind==='kitchen'&&<><mesh castShadow position={[0,.76,-r.depth/2+.34]}><boxGeometry args={[r.width-.25,.9,.6]}/><meshStandardMaterial color="#b8c2b4"/></mesh><mesh position={[0,1.23,-r.depth/2+.34]}><boxGeometry args={[r.width-.18,.07,.64]}/><meshStandardMaterial color="#e1e2d9"/></mesh><mesh position={[r.width*.15,1.28,-r.depth/2+.34]}><boxGeometry args={[.6,.035,.42]}/><meshStandardMaterial color="#6e8988" metalness={.4} roughness={.4}/></mesh></>}
        {r.kind==='bathroom'&&<><mesh position={[-r.width*.2,.58,-r.depth*.24]}><boxGeometry args={[.6,.54,.72]}/><meshStandardMaterial color="#f4f5eb"/></mesh><mesh position={[r.width*.2,.68,r.depth*.18]}><boxGeometry args={[.7,.72,.5]}/><meshStandardMaterial color="#f3f5ed"/></mesh></>}
      </group>)}
    </group>)}
    {Array.from({length:10},(_,i)=><mesh castShadow key={i} position={[0,.31+i*.075,-1.25+i*.25]}><boxGeometry args={[1.25,.09,.25]}/><meshStandardMaterial color="#c7c9bc"/></mesh>)}
    {[-1,1].map(side=><mesh castShadow key={side} position={[0,.89,side*(b.depth/2-.15)]}><boxGeometry args={[b.width,.3,.3]}/><meshStandardMaterial color="#eeebe0"/></mesh>)}
  </group>;
}

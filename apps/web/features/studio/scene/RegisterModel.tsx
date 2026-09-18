import {useCallback,useEffect,useMemo,useRef} from 'react';
import {useThree} from '@react-three/fiber';
import {Html,Edges} from '@react-three/drei';
import type {MapControls} from 'three/addons/controls/MapControls.js';
import type {Building} from '../types';
import {StudioViewport} from './SharedViewport';
import {NavigationControls} from './NavigationControls';
import FloorInterior from './FloorInterior';
import BuildingEnvelope from './BuildingEnvelope';
import InstanceBatch from './InstanceBatch';
import {EnvironmentLighting} from './Appearance';
import ContactLighting from './ContactLighting';
import type {SceneInstance} from './architecture';
import {Vector3} from 'three';

interface Props{
 b:Building;floor:number|null;selectedUnit?:string;elevation:boolean;exterior?:boolean;
 onFloor:(floor:number)=>void;onUnit:(id:string)=>void;
}
function Model({b,floor,selectedUnit,elevation,exterior=false,onFloor,onUnit}:Props){
 const {camera,size}=useThree(),controls=useRef<MapControls>(null);
 const local=useMemo(()=>({...b,x:0,z:0}),[b]);
 const exploded=!elevation&&!exterior,spacing=exploded?6.5:b.floorHeight;
 const height=exploded?(b.floors-1)*spacing+b.floorHeight:b.height+3.6;
 const onStart=useCallback(()=>{},[]);
 const trees=useMemo<SceneInstance[]>(()=>[-1,1].flatMap(side=>[-1,1].map(end=>({p:[side*(b.width/2+3),3.7,end*(b.depth/2+1)] as [number,number,number],s:[1.7,2.2,1.7] as [number,number,number],c:side<0?'#698553':'#80925f'}))),[b.width,b.depth]);
 useEffect(()=>{
  const ctl=controls.current;if(!ctl)return;
  const targetY=height*.49;
  ctl.target.set(0,targetY,0);ctl.enableRotate=!elevation;ctl.maxPolarAngle=Math.PI/2;
  camera.position.set(elevation?0:34,elevation?targetY+.1:targetY+32,elevation?70:43);
  camera.lookAt(0,targetY,0);camera.updateMatrixWorld(true);
  const projected:Vector3[]=[];
  for(const x of [-b.width/2-5,b.width/2+5])for(const y of [-.3,height+.8])for(const z of [-b.depth/2-5,b.depth/2+5])projected.push(new Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
  const spanX=Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x));
  const spanY=Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y));
  camera.zoom=Math.min(size.width/spanX,size.height/spanY)*.9;
  camera.updateProjectionMatrix();ctl.update();
 },[b.id,elevation,exterior,height,size.width,size.height]);
 return <>
  <color attach="background" args={['#f1f5f3']}/>
  <ambientLight intensity={.22}/><hemisphereLight intensity={.55} groundColor="#9ba895"/>
  <directionalLight position={[-35,65,40]} intensity={2.65} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={60} shadow-camera-bottom={-25} shadow-normalBias={.025}/>
  <EnvironmentLighting/>
  <mesh receiveShadow position={[0,-.13,0]}><boxGeometry args={[b.width+8,.26,b.depth+10]}/><meshStandardMaterial color="#bcc9ad" roughness={.95}/></mesh>
  <mesh receiveShadow position={[0,.015,b.depth/2+3]}><boxGeometry args={[b.width+8,.035,3.4]}/><meshStandardMaterial color="#828d8c" roughness={.97}/></mesh>
  <BuildingEnvelope building={local} cutaway={exploded} spacing={spacing}/>
  {exploded&&Array.from({length:b.floors},(_,f)=><group key={f} position={[0,.4+f*spacing,0]}>
   <FloorInterior b={b} floor={f} selectedUnit={selectedUnit} active={floor===null||floor===f} onFloor={onFloor} onUnit={onUnit}/>
  </group>)}
  {!exploded&&floor!==null&&<mesh position={[0,.4+(floor+.5)*b.floorHeight,0]} raycast={()=>{}}><boxGeometry args={[b.width+.15,b.floorHeight,b.depth+.15]}/><meshBasicMaterial color="#459f86" transparent opacity={.12} depthWrite={false}/><Edges color="#4c9275" lineWidth={1}/></mesh>}
  {exterior&&<InstanceBatch items={trees} kind="crown"/>}
  {size.height>240&&Array.from({length:b.floors},(_,f)=><Html key={f} position={[-b.width/2-2.5,.4+f*spacing+1,0]} center zIndexRange={[5,0]}><button className={`register-floor-label ${floor===f?'active':''}`} onClick={()=>onFloor(f)}>{f===0?'G':`F${f}`}<span>+{(f*b.floorHeight).toFixed(1)} m</span></button></Html>)}
  <NavigationControls ref={controls} mode="3d" onStart={onStart}/>
 </>;
}
export default function RegisterModel(props:Props){
 return <StudioViewport name={props.exterior?'workspace-building':'register'} priority={10}><Model {...props}/></StudioViewport>;
}

import {useCallback,useEffect,useMemo,useRef} from 'react';
import {useThree} from '@react-three/fiber';
import {Html,Edges} from '@react-three/drei';
import type {MapControls} from 'three/addons/controls/MapControls.js';
import type {Building} from '../types';
import {StudioViewport} from './SharedViewport';
import {NavigationControls} from './NavigationControls';
import FloorInterior from './FloorInterior';
import BuildingEnvelope,{ArchitectureParts} from './BuildingEnvelope';
import InstanceBatch from './InstanceBatch';
import {EnvironmentLighting,useGroundMaps} from './Appearance';
import ContactLighting from './ContactLighting';
import {buildTerrace,type SceneInstance} from './architecture';
import {Vector3} from 'three';

interface Props{
 b:Building;floor:number|null;selectedUnit?:string;elevation:boolean;exterior?:boolean;
 onFloor:(floor:number)=>void;onUnit:(id:string)=>void;
}
function Model({b,floor,selectedUnit,elevation,exterior=false,onFloor,onUnit}:Props){
 const {camera,size}=useThree(),controls=useRef<MapControls>(null);
 const local=useMemo(()=>({...b,x:0,z:0}),[b]);
 const terrace=useMemo(()=>buildTerrace(local),[local]);
 const groundMaps=useGroundMaps();
 const exploded=!elevation&&!exterior,spacing=exploded?6.5:b.floorHeight;
 const height=exploded?b.floors*spacing+3.6:b.height+3.6;
 const onStart=useCallback(()=>{},[]);
 const trees=useMemo<SceneInstance[]>(()=>[-1,1].flatMap(side=>[-1,1].map(end=>({p:[side*(b.width/2+3),3.7,end*(b.depth/2+1)] as [number,number,number],s:[1.7,2.2,1.7] as [number,number,number],c:side<0?'#698553':'#80925f'}))),[b.width,b.depth]);
 const trunks=useMemo<SceneInstance[]>(()=>trees.map(tree=>({...tree,p:[tree.p[0],1.5,tree.p[2]],s:[.22,3,.22],c:'#796b51'})),[trees]);
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
  <color attach="background" args={['#f4f6f3']}/>
  <ambientLight intensity={.24}/><hemisphereLight intensity={.62} groundColor="#9ba895"/>
  <directionalLight position={[-35,65,40]} intensity={2.4} color="#fff4e4" castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={60} shadow-camera-bottom={-25} shadow-normalBias={.025}/>
  <EnvironmentLighting/>
  <mesh receiveShadow position={[0,-.13,0]}><boxGeometry args={[b.width+8,.26,b.depth+10]}/><meshStandardMaterial color="#b6bba8" roughness={.95}/></mesh>
  <mesh receiveShadow position={[0,.007,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[b.width+7.5,b.depth+9.5]}/><meshStandardMaterial color="#d5dfba" map={groundMaps.grass} roughness={.96}/></mesh>
  <mesh receiveShadow position={[0,.035,b.depth/2+3]}><boxGeometry args={[b.width+8,.055,3.4]}/><meshStandardMaterial color="#8a9493" map={groundMaps.asphaltX} roughness={.97}/></mesh>
  <mesh receiveShadow position={[0,.065,b.depth/2+1.25]}><boxGeometry args={[b.width+8,.09,.24]}/><meshStandardMaterial color="#dedecf" roughness={.95}/></mesh>
  <BuildingEnvelope building={local} cutaway={exploded} spacing={spacing}/>
  {exploded&&<group position={[0,b.floors*spacing-b.height,0]}><ArchitectureParts parts={terrace}/></group>}
  {exploded&&Array.from({length:b.floors},(_,f)=><group key={f} position={[0,.4+f*spacing,0]}>
   <FloorInterior b={b} floor={f} selectedUnit={selectedUnit} active={floor===null||floor===f} onFloor={onFloor} onUnit={onUnit}/>
  </group>)}
  {!exploded&&floor!==null&&<mesh position={[0,.4+(floor+.5)*b.floorHeight,0]} raycast={()=>{}}><boxGeometry args={[b.width+.15,b.floorHeight,b.depth+.15]}/><meshBasicMaterial color="#459f86" transparent opacity={.12} depthWrite={false}/><Edges color="#4c9275" lineWidth={1}/></mesh>}
  {(exterior||exploded)&&<><InstanceBatch items={trunks} kind="cylinder"/><InstanceBatch items={trees} kind="crown"/></>}
  {size.height>240&&Array.from({length:b.floors},(_,f)=><Html key={f} position={[-b.width/2-2.5,.4+f*spacing+1,0]} center zIndexRange={[5,0]}><button className={`register-floor-label ${floor===f?'active':''}`} onClick={()=>onFloor(f)}>{f===0?'G':`F${f}`}<span>+{(f*b.floorHeight).toFixed(1)} m</span></button></Html>)}
  {exploded&&size.height>240&&<Html position={[-b.width/2-2.5,b.floors*spacing+1.4,0]} center zIndexRange={[5,0]}><div className="register-floor-label">Terrace<span>+{b.height.toFixed(1)} m</span></div></Html>}
  <NavigationControls ref={controls} mode="3d" onStart={onStart}/>
  <ContactLighting/>
 </>;
}
export default function RegisterModel(props:Props){
 return <StudioViewport name={props.exterior?'workspace-building':'register'} priority={10}><Model {...props}/></StudioViewport>;
}

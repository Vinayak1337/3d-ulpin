import { useCallback, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {StudioViewport} from './SharedViewport';
import { Html } from '@react-three/drei';
import { PCFShadowMap } from 'three';
import type { MapControls } from 'three/addons/controls/MapControls.js';
import type { Building } from '../types';
import FloorInterior from './FloorInterior';
import { NavigationControls } from './NavigationControls';

function Model({b,floor,selectedUnit,elevation,onFloor,onUnit}:{b:Building;floor:number|null;selectedUnit?:string;elevation:boolean;onFloor:(n:number)=>void;onUnit:(id:string)=>void}){
  const {camera,size}=useThree(),controls=useRef<MapControls>(null);
  const spacing=elevation?b.floorHeight:5.9,height=(b.floors-1)*spacing+3;
  const noOp=useCallback(()=>{},[]);
  useEffect(()=>{
    const ctl=controls.current;if(!ctl)return;
    const targetY=height*.5;
    ctl.target.set(0,targetY,0);
    ctl.enableRotate=!elevation;
    ctl.maxPolarAngle=Math.PI/2;
    camera.position.set(elevation?0:-34,elevation?targetY+1:targetY+30,elevation?70:40);
    camera.zoom=Math.min(size.width/((b.width+b.depth)*.94),size.height/(height+b.depth*.45))*1.04;
    camera.lookAt(0,targetY,0);camera.updateProjectionMatrix();ctl.update();
  },[b.id,elevation,size.width,size.height]);
  return <>
    <color attach="background" args={['#f1f6f6']}/><ambientLight intensity={.65}/><hemisphereLight intensity={1.1} groundColor="#a7b8ad"/><directionalLight position={[-25,50,25]} intensity={2.3} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={42} shadow-camera-bottom={-24} shadow-normalBias={.08}/>
    <mesh receiveShadow position={[0,-.13,0]}><boxGeometry args={[b.width+3,.2,b.depth+3]}/><meshStandardMaterial color="#b5c6ad"/></mesh>
    {Array.from({length:b.floors},(_,f)=><group key={f} position={[0,f*spacing,0]}>
      <FloorInterior b={b} floor={f} selectedUnit={selectedUnit} active={floor===null||floor===f} onFloor={onFloor} onUnit={onUnit}/>
      <Html position={[-b.width/2-1.7,1,0]} center zIndexRange={[5,0]}><button className={`register-floor-label ${floor===f?'active':''}`} onClick={()=>onFloor(f)}>{f===0?'G':`F${f}`}<span>+{(f*b.floorHeight).toFixed(1)} m</span></button></Html>
    </group>)}
    <NavigationControls ref={controls} mode="3d" onStart={noOp}/>
  </>;
}
export default function RegisterModel(props:{b:Building;floor:number|null;selectedUnit?:string;elevation:boolean;onFloor:(n:number)=>void;onUnit:(id:string)=>void}){
  return <StudioViewport name="register" priority={10}><Model {...props}/></StudioViewport>;
}

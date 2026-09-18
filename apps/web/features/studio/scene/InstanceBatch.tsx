import {useLayoutEffect,useRef} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import type {SceneInstance} from './architecture';
import {foliageAssets} from './foliage';

export const noSceneRaycast=()=>{};
interface Props{
 items:SceneInstance[];kind?:'box'|'crown'|'cylinder';hidden?:string;opacity?:number;
 onPick?:(id:string)=>void;onHover?:(id:string|null)=>void;cast?:boolean;roughness?:number;
 map?:THREE.Texture;normalMap?:THREE.Texture;wire?:boolean;highlight?:{id:string;tint:string;strength:number};
}
/** Shared instancing, material and picking policy for district and single-building views. */
export default function InstanceBatch({items,kind='box',hidden,opacity=1,onPick,onHover,cast=true,roughness=.86,map,normalMap,wire=false,highlight}:Props){
 const ref=useRef<THREE.InstancedMesh>(null!);
 const foliage=kind==='crown'?foliageAssets():null;
 useLayoutEffect(()=>{
  const object=new THREE.Object3D(),color=new THREE.Color(),tint=new THREE.Color(highlight?.tint??'#ffffff');
  items.forEach((item,i)=>{
   object.position.set(...item.p);object.rotation.set(...(item.r??[0,0,0]));
   object.scale.set(...(hidden!==undefined&&item.owner===hidden?[0,0,0] as [number,number,number]:item.s));object.updateMatrix();ref.current.setMatrixAt(i,object.matrix);
   color.set(item.c);if(highlight&&item.owner===highlight.id)color.lerp(tint,highlight.strength);ref.current.setColorAt(i,color);
  });
  ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;ref.current.computeBoundingSphere();
 },[items,hidden,highlight?.id,highlight?.tint,highlight?.strength]);
 const picked=(event:ThreeEvent<MouseEvent>)=>{if(event.instanceId!==undefined&&event.delta<5){const id=items[event.instanceId]?.owner;if(id){event.stopPropagation();onPick?.(id);}}};
 return <instancedMesh ref={ref} args={[undefined,undefined,items.length]} castShadow={cast&&opacity===1} receiveShadow frustumCulled={false} onClick={onPick?picked:undefined} onPointerMove={onHover?event=>{event.stopPropagation();onHover(items[event.instanceId??0]?.owner??null);}:undefined} onPointerOut={onHover?()=>onHover(null):undefined} raycast={onPick?undefined:noSceneRaycast}>
  {kind==='crown'?<primitive object={foliage!.geometry} attach="geometry"/>:kind==='cylinder'?<cylinderGeometry args={[.5,.5,1,14]}/>:<boxGeometry/>}
  {wire?<meshBasicMaterial wireframe transparent opacity={opacity} depthWrite={false}/>:<meshStandardMaterial roughness={roughness} metalness={roughness<.6?.1:0} transparent={opacity<1} opacity={opacity} depthWrite={opacity>.6} map={foliage?.texture??map} normalMap={normalMap} normalScale={[.2,.2]} alphaTest={foliage?.38:0} side={foliage?THREE.DoubleSide:THREE.FrontSide}/>}
 </instancedMesh>;
}

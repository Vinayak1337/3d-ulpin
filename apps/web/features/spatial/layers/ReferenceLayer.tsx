'use client';
import {useEffect,useRef,useState} from 'react';
import type {normalizeReferencePackage} from '../reference-import/browser';
import {useSpatialServices} from '../data/Provider';
import {localOrbitState} from '../data/local-session';
import {mountMap,type ReferenceRuntime} from '../reference-runtime/map';
import '../reference-runtime/map.css';

export type ReferenceScene=Awaited<ReturnType<typeof normalizeReferencePackage>>['render']['scene'];
export interface ReferenceLayerProps {
 scene:ReferenceScene;sessionKey:string;
 onFloorSelect?:(id:string)=>void;onSelect?:(id:string)=>void;onRegister?:(id:string)=>void;onReview?:(id:string)=>void;onWorkspace?:(id:string)=>void;
 onReady?:(runtime:ReferenceRuntime)=>void;
}
export default function ReferenceLayer(props:ReferenceLayerProps){
 const host=useRef<HTMLDivElement>(null),callbacks=useRef(props),{sessions}=useSpatialServices();
 const [error,setError]=useState('');callbacks.current=props;
 useEffect(()=>{
  const element=host.current!;let viewer:ReferenceRuntime|undefined;setError('');
  try{
   viewer=mountMap(element,props.scene,{onSelect:id=>{sessions.patch(props.sessionKey,{selection:{entityId:id}});callbacks.current.onSelect?.(id);},onFloorSelect:id=>callbacks.current.onFloorSelect?.(id),onRegister:id=>callbacks.current.onRegister?.(id),onReview:id=>callbacks.current.onReview?.(id),onWorkspace:props.onWorkspace?(id=>callbacks.current.onWorkspace?.(id)):undefined});
   const state=sessions.get(props.sessionKey).localOrbit;
   if(state?.snapshotDigest===props.scene.canonicalSnapshotDigest&&state.frameId===props.scene.frames[0]?.id)viewer.restoreState(state.view);
   callbacks.current.onReady?.(viewer);
  }catch(e){viewer?.dispose();viewer=undefined;setError(e instanceof Error?e.message:'Unable to display this scene.');}
  return ()=>{
   if(viewer){viewer.setPresentation?.('block');const state=localOrbitState(viewer.getState(),props.scene.frames[0]?.id??'',props.scene.canonicalSnapshotDigest);if(state)sessions.patch(props.sessionKey,{localOrbit:state,selection:state.view.selectedId?{entityId:state.view.selectedId}:null,mode:state.view.mode});viewer.dispose();}
  };
 },[props.scene,props.sessionKey,sessions]);
 return <div className="shared-reference-view" style={{position:'relative',width:'100%',height:'100%',minHeight:0}}>{error&&<div role="alert" className="reference-render-error">{error} Original records remain available.</div>}<div ref={host} style={{height:'100%',width:'100%'}} data-shared-reference-map/></div>;
}

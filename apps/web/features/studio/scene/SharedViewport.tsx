'use client';
import {Component,Suspense,createContext,useContext,useLayoutEffect,useMemo,useRef,useState,type ReactNode,type ErrorInfo} from 'react';
import {createPortal} from 'react-dom';
import {Canvas} from '@react-three/fiber';
import {PCFShadowMap} from 'three';

type Lease={id:symbol;host:HTMLDivElement;scene:ReactNode;priority:number;paused:boolean;name:string};
type Service={put:(lease:Lease)=>void;remove:(id:symbol)=>void;memory:Map<string,unknown>};
const ServiceContext=createContext<Service|null>(null);
class ViewportFailureBoundary extends Component<{children:ReactNode},{error:string|null}>{
 state={error:null as string|null};
 static getDerivedStateFromError(error:Error){return {error:error.message};}
 componentDidCatch(error:Error,_info:ErrorInfo){window.dispatchEvent(new CustomEvent('studio-viewport-error',{detail:error.message}));}
 render(){return this.state.error?<div className="studio-viewport-failure" role="alert"><h2>3D view is unavailable</h2><p>A rendering resource could not be loaded. Property records and original source files have not changed.</p><button onClick={()=>location.reload()}>Reload current view</button><small>The current property route is retained.</small></div>:this.props.children;}
}
export function StudioViewportProvider({children}:{children:ReactNode}){
 const [leases,setLeases]=useState<Lease[]>([]);
 const [surface]=useState(()=>{const div=document.createElement('div');div.className='studio-shared-surface';div.style.cssText='position:absolute;inset:0;width:100%;height:100%;';return div;});
 const service=useMemo<Service>(()=>({memory:new Map(),put:lease=>setLeases(old=>[...old.filter(item=>item.id!==lease.id),lease]),remove:id=>setLeases(old=>old.filter(item=>item.id!==id))}),[]);
 const active=[...leases].sort((a,b)=>b.priority-a.priority)[0];
 useLayoutEffect(()=>{if(!active)return;active.host.appendChild(surface);window.dispatchEvent(new Event('resize'));},[active?.host,surface]);
 useLayoutEffect(()=>()=>{surface.remove();service.memory.clear();},[surface,service]);
 return <ServiceContext.Provider value={service}>{children}{createPortal(<ViewportFailureBoundary><Canvas orthographic shadows={{type:PCFShadowMap}} frameloop={!active||active.paused?'never':'always'} camera={{position:[175,320,430],zoom:7.8,near:.1,far:3000}} dpr={[1,2]} gl={{antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.domElement.dataset.studioCanvas='shared';gl.setClearColor('#dfe5d9');}}><Suspense fallback={null}>{active?.scene}</Suspense></Canvas></ViewportFailureBoundary>,surface)}</ServiceContext.Provider>;
}
/** Leases a view of one persistent GPU canvas; no route creates a second renderer. */
export function StudioViewport({children,priority=0,paused=false,name}:{children:ReactNode;priority?:number;paused?:boolean;name:string}){
 const service=useContext(ServiceContext);if(!service)throw new Error('Studio views need the shared viewport provider');
 const host=useRef<HTMLDivElement>(null),id=useRef(Symbol(name));
 useLayoutEffect(()=>{service.put({id:id.current,host:host.current!,scene:children,priority,paused,name});},[children,priority,paused,name,service]);
 useLayoutEffect(()=>()=>service.remove(id.current),[service]);
 return <div ref={host} data-studio-viewport={name} style={{position:'relative',width:'100%',height:'100%',overflow:'hidden'}}/>;
}
export function useStudioSceneMemory(){const service=useContext(ServiceContext);if(!service)throw new Error('Missing Studio scene memory');return service.memory;}

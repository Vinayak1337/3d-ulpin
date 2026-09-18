'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import {district} from './data/district';
import {readStudioRoute,studioUrl,type StudioRoute} from './routing';
const event='ulpin-studio-navigation';
const read=()=>window.location.pathname+window.location.search;
const server=()=>'/studio';
const subscribe=(fn:()=>void)=>{window.addEventListener('popstate',fn);window.addEventListener(event,fn);return()=>{window.removeEventListener('popstate',fn);window.removeEventListener(event,fn);};};
/** Route state is the selection authority; the 3D canvas is not re-created by navigation. */
export function useStudioRoute(){
 const url=useSyncExternalStore(subscribe,read,server);
 const route=useMemo(()=>readStudioRoute(url,district),[url]);
 const navigate=useCallback((patch:Partial<StudioRoute>,replace=false)=>{
   const current=readStudioRoute(read(),district),next=studioUrl({...current,...patch,error:null});
   if(next===read())return;
   window.history[replace?'replaceState':'pushState'](null,'',next);
   window.dispatchEvent(new Event(event));
 },[]);
 return {route,navigate};
}

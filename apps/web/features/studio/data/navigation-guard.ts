'use client';
import {useEffect,useRef} from 'react';

type Guard={path:string;dirty:boolean;message:string};
const guards=new Map<symbol,Guard>();
const leaving=(url:string)=>{
 if(typeof window==='undefined')return [];
 const target=new URL(url,location.href);
 return [...guards.values()].filter(g=>g.dirty&&(target.origin!==location.origin||target.pathname!==g.path));
};
export function confirmStudioNavigation(url:string){
 const pending=leaving(url);if(!pending.length)return true;
 return window.confirm(pending[0].message);
}
/** Cover explicit actions, normal links, browser Back/Forward and page reload.
 * Query-only floor changes keep the mounted draft buffers and do not discard them. */
export function useUnsavedNavigation(dirty:boolean,message='You have unsaved workspace changes. Leave without saving them?'){
 const owner=useRef(Symbol('workspace-navigation'));
 const latest=useRef({dirty,message});latest.current={dirty,message};
 useEffect(()=>{
  const id=owner.current,path=location.pathname;
  guards.set(id,{path,dirty:latest.current.dirty,message:latest.current.message});
  let lastUrl=location.href,lastState=history.state;
  const track=()=>{lastUrl=location.href;lastState=history.state;};
  const beforeUnload=(e:BeforeUnloadEvent)=>{if(guards.get(id)?.dirty){e.preventDefault();e.returnValue='';}};
  const click=(e:MouseEvent)=>{
   if(e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
   const anchor=(e.target as Element)?.closest<HTMLAnchorElement>('a[href]');
   if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download')||anchor.pathname.startsWith('/api/'))return;
   if(leaving(anchor.href).length&&!confirmStudioNavigation(anchor.href)){e.preventDefault();e.stopImmediatePropagation();}
  };
  const back=(e:PopStateEvent)=>{
   if(leaving(location.href).length&&!confirmStudioNavigation(location.href)){
    e.stopImmediatePropagation();
    history.pushState(lastState,'',lastUrl);
   }else track();
  };
  window.addEventListener('beforeunload',beforeUnload);
  window.addEventListener('popstate',back,true);
  window.addEventListener('ulpin-studio-navigation',track);
  document.addEventListener('click',click,true);
  return()=>{guards.delete(id);window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('popstate',back,true);window.removeEventListener('ulpin-studio-navigation',track);document.removeEventListener('click',click,true);};
 },[]);
 useEffect(()=>{const g=guards.get(owner.current);if(g){g.dirty=dirty;g.message=message;}},[dirty,message]);
}

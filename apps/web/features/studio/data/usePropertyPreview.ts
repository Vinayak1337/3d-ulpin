'use client';
import {useEffect,useState} from 'react';
import type {CameraCommand} from '../types';

/** A captured picture is qualified by identity, never reused for another property. */
export function usePropertyPreview(id:string|null,ready:boolean,active:boolean,command:CameraCommand,sceneKey:string){
  const [capture,setCapture]=useState<{id:string;url:string}|null>(null);
  useEffect(()=>{
    if(!id||!ready||!active)return;
    let cancelled=false;
    const take=()=>{
      if(cancelled)return;
      const source=document.querySelector<HTMLCanvasElement>('.map-viewport canvas');
      const project=(window as unknown as {__CITY_PROJECT__?:(id:string)=>{x:number;y:number}|null}).__CITY_PROJECT__;
      const point=project?.(id);
      if(!source||!point)return;
      const rect=source.getBoundingClientRect(),px=point.x-rect.left,py=point.y-rect.top;
      if(!rect.width||!rect.height||px<0||py<0||px>rect.width||py>rect.height){setCapture(old=>old?.id===id?null:old);return;}
      try{
        const out=document.createElement('canvas');out.width=640;out.height=370;
        const ctx=out.getContext('2d');if(!ctx)return;
        const width=Math.min(rect.width,310),height=Math.min(rect.height,width*370/640);
        const x=Math.max(0,Math.min(rect.width-width,px-width/2));
        const y=Math.max(0,Math.min(rect.height-height,py-height/2));
        ctx.drawImage(source,x*source.width/rect.width,y*source.height/rect.height,width*source.width/rect.width,height*source.height/rect.height,0,0,640,370);
        setCapture({id,url:out.toDataURL('image/jpeg',.9)});
      }catch{setCapture(old=>old?.id===id?null:old);}
    };
    const timer=setTimeout(take,1400);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[id,ready,active,command,sceneKey]);
  return capture?.id===id?capture.url:undefined;
}

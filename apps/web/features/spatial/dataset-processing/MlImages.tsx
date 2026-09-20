'use client';
import {useEffect,useRef,useState} from 'react';
import type {SpatialMlResult} from '@ulpin/contracts';
import {decodeMaskLabels} from './mask-pixels';
import {pathFor} from './geometry';
import styles from './visual-story.module.css';

export const classColors:Record<string,string>={background:'#f4f5ef',building:'#54bc91',outdoor:'#cbd4ba',wall:'#6d7b82',kitchen:'#e5b25b',living_room:'#80b8a0',bedroom:'#9ca6d6',bath:'#7abbd1',hallway:'#d4a187',railing:'#a5a79d',storage:'#c195bd',garage:'#bac67e',other_room:'#cabdae'};
export const classLabel=(name:string)=>name.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());

/** Recolour the retained integer labels for display; never re-segment the input. */
export function PixelMask({result}:{result:SpatialMlResult}){
 const canvas=useRef<HTMLCanvasElement>(null);
 const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{
  const controller=new AbortController();setState('loading');
  void (async()=>{
   const response=await fetch(result.mask.url,{signal:controller.signal});
   if(!response.ok)throw new Error('Mask unavailable');
   const labels=decodeMaskLabels(new Uint8Array(await response.arrayBuffer()),result.mask.width,result.mask.height);
   const target=canvas.current,context=target?.getContext('2d');
   if(!target||!context)throw new Error('Canvas unavailable');
   target.width=result.mask.width;target.height=result.mask.height;
   const pixels=context.createImageData(target.width,target.height);
   const palette=result.receipt.maskPalette as Record<string,string>|undefined;
   if(!palette)throw new Error('Mask palette missing');
   for(let index=0;index<labels.length;index++){
    const label=palette[String(labels[index])];if(!label)throw new Error('Unknown mask label');
    const color=classColors[label]??'#b7b3ad',i=index*4;
    pixels.data[i]=parseInt(color.slice(1,3),16);pixels.data[i+1]=parseInt(color.slice(3,5),16);pixels.data[i+2]=parseInt(color.slice(5,7),16);pixels.data[i+3]=255;
   }
   if(!controller.signal.aborted){context.putImageData(pixels,0,0);setState('ready');}
  })().catch(()=>{if(!controller.signal.aborted)setState('error');});
  return()=>controller.abort();
 },[result]);
 return <div className={styles.imageStage}>
  <canvas ref={canvas} className={styles.mask} style={{aspectRatio:`${result.mask.width}/${result.mask.height}`,visibility:state==='ready'?'visible':'hidden'}} role="img" aria-label="Actual model pixel mask, colored by predicted class"/>
  {state!=='ready'&&<span className={styles.imageStatus} role={state==='error'?'alert':'status'}>{state==='error'?'Mask unavailable':'Loading mask…'}</span>}
 </div>;
}

export function RasterPrediction({result,overlay=false,showImage=true}:{result:SpatialMlResult;overlay?:boolean;showImage?:boolean}){
 const [failed,setFailed]=useState(false);
 return <div className={styles.imageStage}>
  <svg className={styles.raster} viewBox={`0 0 ${result.raster.width} ${result.raster.height}`} role="img" aria-label={overlay?(showImage?'Extracted candidate outlines on the input image':'Extracted candidate outlines'):'Actual model input image'}>
   {showImage&&!failed&&<image href={result.raster.url} width={result.raster.width} height={result.raster.height} onError={()=>setFailed(true)}/>}
   {overlay&&result.components.map(c=><path key={c.id} d={pathFor(c.geometry)} fillRule="evenodd" fill={classColors[c.className]??'#b7b3ad'} fillOpacity={showImage ? .23 : .65} stroke={classColors[c.className]??'#b7b3ad'} strokeWidth={1.7} vectorEffect="non-scaling-stroke"><title>{classLabel(c.className)} · candidate</title></path>)}
  </svg>
  {failed&&showImage&&<span className={styles.imageStatus} role="alert">Image unavailable</span>}
 </div>;
}

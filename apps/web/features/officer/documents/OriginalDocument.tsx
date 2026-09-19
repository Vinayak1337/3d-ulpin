'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Minus,Plus,RotateCw,Download,Maximize,Focus} from 'lucide-react';
import type {SourceLocator} from '@ulpin/contracts';
import type {CanvasSource} from '../workspace/types';
import {useSourceRaster} from '../workspace/useSourceRaster';
import './original-document.css';

interface Props{source:CanvasSource;locators?:SourceLocator[];initialPage?:number;onPage?:(page:number)=>void;compact?:boolean}
function Surface({source,locators=[],initialPage=1,onPage,compact=false}:Props){
 const [page,setPage]=useState(initialPage),[zoom,setZoom]=useState(1),[rotation,setRotation]=useState(0),[locatorIndex,setLocatorIndex]=useState<number|null>(null);
 const raster=useSourceRaster(source,page),stage=useRef<HTMLDivElement>(null);
 useEffect(()=>{setPage(initialPage);setZoom(1);setRotation(0);setLocatorIndex(null);},[source.id,source.hash,initialPage]);
 const change=(next:number)=>{const p=Math.max(1,Math.min(raster.pages,next));setPage(p);onPage?.(p);setZoom(1);stage.current?.scrollTo({left:0,top:0});};
 useEffect(()=>{if(!raster.loading&&!raster.error&&page>raster.pages)change(raster.pages);},[raster.pages,raster.loading,raster.error]);
 const evidence=locators.filter(l=>!l.page||l.page===page);
 const chosen=locatorIndex===null?null:locators[locatorIndex];
 const width=raster.width,height=raster.height;
 return <section className={`original-document ${compact?'is-compact':''}`} data-original-id={source.id} data-original-hash={source.hash} aria-label={`Original document: ${source.name}`}>
  <header><div className="original-page-controls"><button aria-label="Previous original page" disabled={page<=1||raster.loading} onClick={()=>change(page-1)}><ChevronLeft size={17}/></button><label>Page <input aria-label="Original page number" inputMode="numeric" type="number" min={1} max={raster.pages} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=raster.pages)change(n);}}/> of {raster.pages}</label><button aria-label="Next original page" disabled={page>=raster.pages||raster.loading} onClick={()=>change(page+1)}><ChevronRight size={17}/></button></div><div className="original-view-controls"><button aria-label="Zoom original out" onClick={()=>setZoom(z=>Math.max(.5,z-.25))}><Minus size={16}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom original in" onClick={()=>setZoom(z=>Math.min(4,z+.25))}><Plus size={16}/></button><button aria-label="Fit original page" onClick={()=>{setZoom(1);setRotation(0);}}><Maximize size={16}/></button><button aria-label="Rotate original page" onClick={()=>setRotation(r=>(r+90)%360)}><RotateCw size={16}/></button>{source.url&&<a href={source.url} target="_blank" rel="noreferrer" aria-label="Open original source bytes"><Download size={17}/></a>}</div></header>
  <div className="original-stage" ref={stage}>
   {raster.loading&&<p role="status">Rendering retained original…</p>}
   {raster.error&&<p role="alert">{raster.error}</p>}
   {raster.url&&!raster.error&&<div className="original-page" style={{width:`${zoom*100}%`,minWidth:`${zoom*100}%`,transform:rotation?`rotate(${rotation}deg)`:undefined,aspectRatio:`${width}/${height}`}}><img src={raster.url} alt={`${source.name} · original page ${page}`} draggable={false}/>{evidence.map((l,i)=>l.region&&<span key={i} className={`original-region ${chosen===l?'is-selected':''}`} title="Source-linked region" style={{left:`${l.region.x*100}%`,top:`${l.region.y*100}%`,width:`${l.region.width*100}%`,height:`${l.region.height*100}%`}}/>)}</div>}
  </div>
  {!!locators.length&&<footer className="original-locators"><span>Evidence locations</span>{locators.map((l,i)=><button key={i} aria-pressed={locatorIndex===i} onClick={()=>{setLocatorIndex(i);if(l.page)change(l.page);}}><Focus size={12}/>{l.page?`Page ${l.page}`:l.row?`Row ${l.row}`:l.featureId?`Feature ${l.featureId}`:l.jsonPointer??'Original'}{l.region?' · region':''}</button>)}</footer>}
 </section>;
}
export default function OriginalDocument(props:Props){
 const [attempt,setAttempt]=useState(0);
 return <div className="original-viewer"><Surface key={`${props.source.id}:${props.source.hash}:${attempt}`} {...props}/><button className="original-retry" onClick={()=>setAttempt(n=>n+1)}>Reload original preview</button></div>;
}

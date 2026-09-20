'use client';
import type {Dispatch,SetStateAction} from 'react';
import {ArrowRight,Building2,FileImage,FileText,Layers,Play,Upload,Minus,Plus} from 'lucide-react';
import type {DatasetMlOverview,DatasetMlSource} from '@/lib/dataset-ml';
import {sourcePurpose,sourceTitle,readyToExtract,type ExtractionChoice,type SourcePurpose} from './source-purpose';
import styles from './processing.module.css';

export default function SourcePicker({data,busy,choices,setChoices,onUpload,onRun}:{data:DatasetMlOverview;busy:boolean;choices:Record<string,ExtractionChoice>;setChoices:Dispatch<SetStateAction<Record<string,ExtractionChoice>>>;onUpload:()=>void;onRun:(items:(ExtractionChoice&{task:'building'|'floor-plan'})[])=>void}){
 const items=Object.values(choices),ready=readyToExtract(items,data.sources);
 const aerial=data.sources.filter(s=>sourcePurpose(s)==='building'),plans=data.sources.filter(s=>sourcePurpose(s)==='floor-plan').sort((a,b)=>{const x=a.name.match(/(B\d+)-level-(-?\d+)/i),y=b.name.match(/(B\d+)-level-(-?\d+)/i);return x&&y?x[1].localeCompare(y[1],undefined,{numeric:true})||Number(x[2])-Number(y[2]):a.name.localeCompare(b.name);}),other=data.sources.filter(s=>!['building','floor-plan'].includes(sourcePurpose(s)));
 function tile(source:DatasetMlSource){
  const purpose=sourcePurpose(source),selected=choices[source.id];
  const Icon=purpose==='building'?Building2:purpose==='floor-plan'?Layers:FileText;
  const labels:Record<SourcePurpose,string>={building:'Aerial image','floor-plan':'Floor plan',document:'Supporting document',unknown:'Choose source type'};
  return <div className={styles.sourceTile} data-selected={!!selected} key={source.id}>
   <label className={styles.sourceSelect}><input type="checkbox" aria-label={`Select ${source.name}`} disabled={busy||!selected&&items.length>=12} checked={!!selected} onChange={e=>setChoices(prev=>{const next={...prev};if(e.target.checked)next[source.id]={sourceId:source.id,task:purpose==='building'||purpose==='floor-plan'?purpose:'',page:1};else delete next[source.id];return next;})}/><Icon size={22}/><span><strong>{sourceTitle(source.name)}</strong><small title={source.name}>{source.name}</small>{source.mimeType==='application/pdf'&&<small className={styles.pageCount}>{source.pageCount?`${source.pageCount} page${source.pageCount===1?'':'s'}`:'Page count unavailable'}</small>}</span><em>{labels[purpose]}</em></label>
   {selected&&(source.mimeType==='application/pdf'||purpose==='document'||purpose==='unknown')&&<div className={styles.sourceOptions}>
    {(purpose==='document'||purpose==='unknown')&&<label>Extract<select disabled={busy} aria-label={`Task for ${source.name}`} value={selected.task} onChange={e=>setChoices(p=>({...p,[source.id]:{...selected,task:e.target.value as ExtractionChoice['task']}}))}><option value="" disabled>Choose type</option><option value="building">Buildings</option><option value="floor-plan">Rooms</option></select></label>}
    {source.mimeType==='application/pdf'&&<div className={styles.pagePicker}><span>Page</span><div><button aria-label={`Previous page for ${source.name}`} disabled={busy||selected.page<=1||!source.pageCount} onClick={()=>setChoices(p=>({...p,[source.id]:{...selected,page:selected.page-1}}))}><Minus size={14}/></button><input disabled={busy||!source.pageCount} aria-label={`Page for ${source.name}`} type="number" min="1" max={Math.min(source.pageCount??1,500)} value={selected.page||''} onChange={e=>setChoices(p=>({...p,[source.id]:{...selected,page:Number(e.target.value)}}))}/><button aria-label={`Next page for ${source.name}`} disabled={busy||!source.pageCount||selected.page>=Math.min(source.pageCount,500)} onClick={()=>setChoices(p=>({...p,[source.id]:{...selected,page:selected.page+1}}))}><Plus size={14}/></button></div><span>of {source.pageCount??'—'}</span></div>}
    {source.pageCountError&&<span role="alert">{source.pageCountError}</span>}
   </div>}
  </div>;
 }
 return <>
  <div className={styles.sourceToolbar}><span>{data.sources.length} image / PDF sources</span><button disabled={busy} onClick={onUpload}><Upload size={15}/>Add files</button></div>
  {!data.sources.length&&<div className={`${styles.card} ${styles.empty}`}><FileImage size={32}/><h2>Add an aerial image or floor plan</h2><span>JPG · PNG · PDF</span></div>}
  {!!aerial.length&&<section className={styles.sourceGroup} aria-label="Aerial images for building extraction"><div className={styles.groupHeading}><div><Building2 size={20}/><h2>Buildings</h2><span>{aerial.length}</span></div><span>Aerial image <ArrowRight size={13}/> building outlines</span></div><div className={styles.sourceTiles}>{aerial.map(tile)}</div></section>}
  {!!plans.length&&<section className={styles.sourceGroup} aria-label="Single-building floor plans for room extraction"><div className={styles.groupHeading}><div><Layers size={20}/><h2>Rooms</h2><span>{plans.length}</span></div><span>Single-building floor plan <ArrowRight size={13}/> room outlines</span></div><div className={styles.sourceTiles}>{plans.map(tile)}</div></section>}
  {!!other.length&&<details className={styles.otherSources}><summary>Other documents <span>{other.length}</span></summary><div className={styles.sourceTiles}>{other.map(tile)}</div></details>}
  <div className={styles.sourceBottom}><div><strong>{items.length?`${items.length} selected`:'Select files to extract'}</strong><span>{items.length&&!ready?'Choose a task and valid page for each file':'Up to 12 per batch'} · {data.retainedOnly} other files stored</span></div><button className={styles.primary} disabled={busy||!ready} onClick={()=>{if(readyToExtract(items,data.sources))onRun(items);}}><Play size={15}/>{busy?'Starting…':'Run extraction'}</button></div>
 </>;
}

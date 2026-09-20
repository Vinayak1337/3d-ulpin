'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Layers,RefreshCw,ChevronLeft,ChevronRight} from 'lucide-react';
import type {DatasetMlOverview,DatasetMlRun} from '@/lib/dataset-ml';
import {useResource} from '@/features/officer/shared/hooks';
import {useSpatialServices} from '../data/Provider';
import Review from './Review';
import SourcePicker from './SourcePicker';
import {sourceTitle,sourcePurpose,extractionLabel,type ExtractionChoice} from './source-purpose';
import Walkthrough from './Walkthrough';
import styles from './processing.module.css';
export async function send(url:string,body:unknown){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Unable to save.');return result;}
export function runLabel(run:DatasetMlRun){return run.status==='succeeded'?run.result?.components.length?`${run.result.components.length} regions · ${run.review?run.review.decision==='keep'?'review saved':'rejected':'needs review'}`:'No regions found':run.status==='failed'?'Processing failed':run.status==='running'?'Extracting…':'Queued';}
export default function DatasetProcessing({id,initialRun='',initialStage='review'}:{id:string;initialRun?:string;initialStage?:'sources'|'review'|'explain'}){
 const {resources}=useSpatialServices();
 const path=`/spatial-datasets/${id}/ml`,resource=useResource<DatasetMlOverview>(path),data=resource.data;
 const [stage,setStage]=useState<'sources'|'review'|'explain'>(initialStage),[active,setActive]=useState(initialRun),[choices,setChoices]=useState<Record<string,ExtractionChoice>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{const q=new URLSearchParams({view:stage});if(active)q.set('run',active);window.history.replaceState(null,'',`/studio/processing/${id}?${q}`);},[id,stage,active]);
 const lock=useRef(false),file=useRef<HTMLInputElement>(null);
 const pending=data?.runs.some(r=>['queued','running'].includes(r.status));
 useEffect(()=>{if(!pending)return;const timer=setInterval(()=>resource.reload(),2000);return()=>clearInterval(timer);},[pending,resource.reload]);
 const run=data?.runs.find(r=>r.id===active)??data?.runs[0];
 const purpose=run?sourcePurpose({id:run.sourceId,name:run.sourceName,mimeType:'',task:run.task,reason:''}):'unknown';
 const runIndex=data?.runs.findIndex(r=>r.id===run?.id)??-1;
 const mismatch=(purpose==='building'||purpose==='floor-plan')&&run?.task!==purpose;
 async function operation(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await work();resources.invalidate(key=>key.startsWith('/work-queue'));await resource.reload();}catch(e){setError(e instanceof Error?e.message:'Unable to complete this action.');}finally{lock.current=false;setBusy(false);}}
 async function start(items:{sourceId:string;task:'floor-plan'|'building';page:number}[]){if(!data)return;await operation(async()=>{await send(`/api/v1${path}`,{requestKey:crypto.randomUUID(),expectedDigest:data.digest,items});setActive('');setChoices({});setStage('review');setNotice('Extraction started.');});}
 async function attach(original:File){await operation(async()=>{const response=await fetch(`/api/v1${path}/source`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(original.name),'X-Request-Key':crypto.randomUUID()},body:original});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Unable to add file.');setNotice('File added.');});}
 if(stage==='explain'&&!data)return <main className={styles.page}><span role={resource.error?'alert':'status'}>{resource.error||'Loading visuals…'}</span></main>;
 if(data&&stage==='explain')return <Walkthrough data={data} run={run} onReview={()=>setStage('review')}/>;
 return <main className={styles.page}>
  <header className={styles.header}><Link href={`/studio/showcase?saved=${id}`}><ArrowLeft size={16}/>Back to map</Link><button onClick={()=>setStage('explain')}>Present <ArrowRight size={16}/></button></header>
  <div className={styles.heading}><div><h1>ML extraction</h1><p>{data?.name.split(' · ')[0]??'Loading…'}</p></div>{data?.name.toLowerCase().includes('fictional')&&<span className={styles.badge}>Fictional dataset</span>}</div>
  <nav className={styles.tabs} aria-label="ML processing">{(['sources','review'] as const).map(s=><button key={s} aria-current={stage===s?'page':undefined} onClick={()=>setStage(s)}>{s==='sources'?'Sources':'Results'}{data&&<span>{s==='sources'?data.sources.length:data.runs.length}</span>}</button>)}</nav>
  {(error||resource.error)&&<p role="alert" className={styles.error}>{error||resource.error} <button onClick={()=>resource.reload()}>Reload</button></p>}
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {!data&&!resource.error&&<p role="status">Loading sources…</p>}
  <input ref={file} hidden type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void attach(f);}}/>
  {data&&stage==='sources'&&<SourcePicker data={data} busy={busy} choices={choices} setChoices={setChoices} onUpload={()=>file.current?.click()} onRun={items=>void start(items)}/>}
  {data&&stage==='review'&&<>{!run?<div className={`${styles.card} ${styles.empty}`}><Layers size={32}/><h2>No results yet</h2><p>Select an aerial image or floor plan to start.</p><button className={styles.primary} onClick={()=>setStage('sources')}>Open sources <ArrowRight size={16}/></button></div>:<>
   <div className={styles.runbar}><div className={styles.resultArrows} aria-label="Result navigation"><button aria-label="Previous result" disabled={busy||runIndex<=0} onClick={()=>setActive(data.runs[runIndex-1].id)}><ChevronLeft size={18}/></button><span aria-live="polite">{runIndex+1} / {data.runs.length}</span><button aria-label="Next result" disabled={busy||runIndex<0||runIndex>=data.runs.length-1} onClick={()=>setActive(data.runs[runIndex+1].id)}><ChevronRight size={18}/></button></div><span className={styles.taskBadge}>{purpose==='building'?'Aerial image':purpose==='floor-plan'?'Floor plan':'Source'} → {extractionLabel(run.task)}</span><label>Source<select aria-label="Retained extraction" value={run.id} onChange={e=>setActive(e.target.value)}>{data.runs.map(r=><option value={r.id} key={r.id}>{sourceTitle(r.sourceName)} · {extractionLabel(r.task)} · {new Date(r.createdAt).toLocaleString('en-IN')}</option>)}</select></label><span className={styles.badge}>{mismatch?'Source / task mismatch':runLabel(run)}</span><button disabled={busy||['queued','running'].includes(run.status)} onClick={()=>{if(mismatch&&(purpose==='building'||purpose==='floor-plan')){setChoices(p=>({...p,[run.sourceId]:{sourceId:run.sourceId,task:purpose,page:run.page}}));setStage('sources');}else void start([{sourceId:run.sourceId,task:run.task,page:run.page}]);}}><RefreshCw size={15}/>{mismatch?'Choose correct task':'Run again'}</button></div>
   {run.result?<Review key={run.id} run={run} data={data} busy={busy} save={body=>operation(async()=>{await send(`/api/v1${path}?action=review`,body);setNotice('Review saved.');})}/>:<div className={`${styles.card} ${styles.empty}`}><h2>{runLabel(run)}</h2><p>{run.error??'Processing source…'}</p>{run.status==='failed'&&<button onClick={()=>setStage('sources')}>Review source and page</button>}</div>}
  </>}</>}
  <footer className={styles.pageFooter}>Local ML · candidates for review</footer>
 </main>;
}

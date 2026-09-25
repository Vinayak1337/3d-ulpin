'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {useDebouncedValue,useResource} from '../shared/hooks';
import {Button,EmptyState,ErrorState,Icon,LoadingState} from '../shared/ui';
import {workItemAction,type WorkItem,type WorkQueueResult} from '@/lib/work-queue';
import './work.css';

function stage(item:WorkItem):string {
 if(item.currentRecorded || item.kind==='import'&&item.state==='COMMITTED')return 'Recorded';
 if(['queued','running','dispatched','retrying'].includes(item.jobStatus||''))return 'Processing';
 if(item.jobStatus==='failed')return 'Needs review';
 if(item.kind==='dataset')return 'Needs review';
 if(!item.sourceCount)return 'Draft';
 return 'Needs review';
}

export default function WorkQueue(){
 const params=useSearchParams();
 const [search,setSearch]=useState(params.get('q')||'');
 useEffect(()=>setSearch(params.get('q')||''),[params]);
 const settled=useDebouncedValue(search), status=['all','processing','recorded'].includes(params.get('status')||'')?params.get('status')!:'all';
 const page=Math.min(100000,Math.max(1,Math.floor(Number(params.get('page'))||1)));
 const work=useResource<WorkQueueResult>(`/work-queue?q=${encodeURIComponent(settled)}&status=${status}&page=${page}`);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void work.reload();};const timer=window.setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[work.reload]);
 const pending=(work.loading&&!work.data) || search!==settled;
 const update=(key:string,value:string)=>{const next=new URLSearchParams(window.location.search);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');window.history.replaceState(null,'','/studio/work'+(next.size?'?'+next:''));};
 return <main className="work-queue">
  <div className="work-intro"><div><p className="work-eyebrow">Officer workspace</p><h1>Batches</h1><p>Open saved work, review its next step, or add source files.</p></div><Link href="/studio/add-files" className="work-primary"><Icon name="upload" size={18}/>Add files</Link></div>
  <div className="work-layout"><section className="work-list" aria-label="Saved work">
   <div className="work-toolbar"><div className="work-filters" role="group" aria-label="Filter work">{[['all','All work'],['processing','Processing'],['recorded','Recorded']].map(([value,label])=><button key={value} aria-pressed={status===value} onClick={()=>update('status',value==='all'?'':value)}>{label}</button>)}</div><label className="work-search"><Icon name="search" size={18}/><input aria-label="Find saved work" placeholder="Search saved work" maxLength={150} value={search} onChange={e=>{setSearch(e.target.value);update('q',e.target.value);}}/></label></div>
   {pending?<LoadingState label="Loading saved work"/>:work.error?<ErrorState message={work.error} retry={work.reload}/>:work.data?.items.length?<><div className="work-columns" aria-hidden="true"><span>Batch and area</span><span>Stage</span><span>Next action</span><span>Updated</span></div><div className="work-rows">{work.data.items.map(item=>{const action=workItemAction(item);const itemStage=stage(item);return <article className="work-row" key={item.kind+item.id}>
    <div className="work-name"><h2><Link href={action.href}>{item.name}</Link></h2><p>{item.areaName||'Area unknown'} <span aria-hidden="true">·</span> {item.sourceCount} source file{item.sourceCount===1?'':'s'}</p></div>
    <span className="work-status" data-status={itemStage}>{itemStage}</span><Link className="work-next" href={action.href}>{action.label}<Icon name="arrow" size={16}/></Link><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</time>
   </article>;})}</div></>:<div className="work-empty"><EmptyState title={search||status!=='all'?'No batches match':'No batches yet'} description={search||status!=='all'?'Change the search or filter to find saved work.':'Add files to start a batch.'} icon="document"/>{!search&&status==='all'&&<Link href="/studio/add-files" className="work-empty-action">Add files <Icon name="arrow" size={16}/></Link>}</div>}
   {work.data&&!pending&&work.data.total>0&&<footer className="work-pagination"><span>{(page-1)*work.data.pageSize+1}–{Math.min(page*work.data.pageSize,work.data.total)} of {work.data.total} matching work items</span><div><Button disabled={page<=1} onClick={()=>update('page',String(page-1))}>Previous</Button><Button disabled={page*work.data.pageSize>=work.data.total} onClick={()=>update('page',String(page+1))}>Next</Button></div></footer>}
  </section><aside className="work-aside" aria-label="Other saved records"><p className="work-eyebrow">Explore records</p><h2>Continue in the Studio</h2><p>Open an area map or find a property record saved in this workspace.</p><Link href="/studio/datasets"><Icon name="map" size={19}/><span>Browse areas</span><Icon name="arrow" size={16}/></Link><Link href="/studio/registry"><Icon name="register" size={19}/><span>Property register</span><Icon name="arrow" size={16}/></Link></aside></div>
 </main>;
}

'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {ArrowRight,Plus,Search} from 'lucide-react';
import {useDebouncedValue,useResource} from '../shared/hooks';
import {Button,EmptyState,ErrorState,LoadingState} from '../shared/ui';
import {workItemAction,type WorkQueueResult} from '@/lib/work-queue';
import './work.css';
export default function WorkQueue(){
 const params=useSearchParams();
 const [search,setSearch]=useState(params.get('q')||'');
 useEffect(()=>setSearch(params.get('q')||''),[params]);
 const settled=useDebouncedValue(search), status=['all','processing','recorded'].includes(params.get('status')||'')?params.get('status')!:'all';
 const page=Math.min(100000,Math.max(1,Math.floor(Number(params.get('page'))||1)));
 const work=useResource<WorkQueueResult>(`/work-queue?q=${encodeURIComponent(settled)}&status=${status}&page=${page}`);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void work.reload();};const timer=window.setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[work.reload]);
 const pending=(work.loading&&!work.data) || search!==settled;
 const update=(key:string,value:string)=>{const next=new URLSearchParams(window.location.search); if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');window.history.replaceState(null,'','/studio/work'+(next.size?'?'+next:''));};
 return <main className="work-queue">
  <header className="work-heading"><div><h1>Batches</h1><p>Import an area, review what needs attention, then record the checked work.</p></div><Link href="/studio/add-files" className="work-primary"><Plus size={17}/>New batch</Link></header>
  <div className="work-demo-entry"><div><strong>Try the Lake View sample</strong><p>Download the fictional source files, import the package and explore the resulting draft map.</p></div><Link href="/studio/showcase?import=1">Open import demo →</Link></div>
  <section className="work-list" aria-label="Saved work">
   <div className="work-toolbar"><div className="work-filters" role="group" aria-label="Filter work">{[['all','All work'],['processing','Processing'],['recorded','Recorded history']].map(([value,label])=><button key={value} aria-pressed={status===value} onClick={()=>update('status',value==='all'?'':value)}>{label}</button>)}</div><label className="work-search"><Search size={17}/><input aria-label="Find saved work" placeholder="Find a name, block or work ID" maxLength={150} value={search} onChange={e=>{setSearch(e.target.value);update('q',e.target.value);}}/></label></div>
   {status==='recorded'&&<p className="work-filter-note">Work with a recorded revision. Later changes may still need review.</p>}
   {pending?<LoadingState label="Loading saved work"/>:work.error?<ErrorState message={work.error} retry={work.reload}/>:work.data?.items.length?<><div className="work-columns" aria-hidden="true"><span>Work</span><span>Status</span><span>Updated</span><span>Next step</span></div><div className="work-rows">{work.data.items.map(item=>{const action=workItemAction(item);return <article className="work-row" key={item.kind+item.id}>
    <div className="work-name"><h2><Link href={action.href}>{item.name}</Link></h2><p>{item.areaName||'Block not assigned'} · {item.sourceCount} file{item.sourceCount===1?'':'s'}{item.dataKind==='demonstration'?' · Fictional demonstration':''}</p></div>
    <span className="work-status" data-status={action.status}>{action.status}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</time><Link className="work-next" href={action.href}>{action.label}<ArrowRight size={16}/></Link>
   </article>;})}</div></>:<EmptyState title={search||status!=='all'?'No matching work':'Start with your source files'} description={search||status!=='all'?'Change the search or filter to find another item.':'Add plans, documents or GIS boundaries to begin.'} icon="document"/>}
   {work.data&&!pending&&<footer className="work-pagination"><span>{work.data.total?`${(page-1)*20+1}–${Math.min(page*20,work.data.total)} of ${work.data.total}`:'0 items'}</span><div><Button disabled={page<=1} onClick={()=>update('page',String(page-1))}>Previous</Button><Button disabled={page*20>=work.data.total} onClick={()=>update('page',String(page+1))}>Next</Button></div></footer>}
  </section>
  <footer className="work-help"><span>Looking for an existing property?</span><Link href="/studio/datasets">Browse saved blocks</Link><Link href="/studio/registry">Property Register</Link></footer>
 </main>;
}

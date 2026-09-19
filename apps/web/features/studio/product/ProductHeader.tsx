'use client';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {Building2,Map as MapIcon,Search,Layers3,ChevronDown,ArrowUpRight,FileText,Box,Menu,X,RotateCw} from 'lucide-react';
import type {MapArea} from '@ulpin/contracts';
import {district} from '../data/district';
import {searchTargets,searchTargetRoute,type ResolveMatch} from '../../officer/shared/search-targets';
import {useDebouncedValue,useResource} from '../../officer/shared/hooks';
import {productFamily,productNavigation} from './urls';
import './product.css';
import {confirmStudioNavigation} from '../data/navigation-guard';

interface Props{actions?:ReactNode;dataset?:string;areaId?:string;onDemoSelect?:(id:string)=>void}
type Result={key:string;label:string;detail:string;href:string;fixtureId?:string};
export default function ProductHeader({actions,dataset='Choose a dataset',areaId,onDemoSelect}:Props){
 const path=usePathname(),router=useRouter(),family=productFamily(path);
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[datasets,setDatasets]=useState(false),[mobile,setMobile]=useState(false);
 const search=useRef<HTMLInputElement>(null),container=useRef<HTMLDivElement>(null);
 const settled=useDebouncedValue(query.trim());
 const remote=useResource<{matches:ResolveMatch[]}>(settled?`/resolve?identifier=${encodeURIComponent(settled)}`:null);
 const areas=useResource<MapArea[]>(datasets?'/areas':null);
 const results=useMemo<Result[]>(()=>{
  if(!query.trim())return [];
  const q=query.trim().toLowerCase();
  const demo=district.buildings.filter(b=>`${b.id} ${b.ulpin} ${b.name} ${b.address} ${b.owner}`.toLowerCase().includes(q)).slice(0,5).map(b=>({key:'fixture:'+b.id,label:b.name,detail:`Reference quarter · ${b.ulpin}`,href:`/studio/${family==='register'?'register':family==='workspace'?'workspace':'map'}/${b.id}`,fixtureId:b.id}));
  const stored=settled===query.trim()?(remote.data?.matches??[]).flatMap(m=>searchTargets(m)).map(t=>({key:`${t.kind}:${t.id}:${t.areaId}:${t.recordId??''}`,label:t.recordName?`${t.recordName} · ${t.name}`:t.name,detail:`Saved record · ${t.identifier}`,href:searchTargetRoute(t,family)})):[];
  return [...new Map([...stored,...demo].map(x=>[x.key,x])).values()].slice(0,12);
 },[query,settled,remote.data,family]);
 useEffect(()=>setActive(results.length?0:-1),[query,results.length]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();search.current?.focus();setOpen(true);}if(e.key==='Escape'){setOpen(false);setDatasets(false);setMobile(false);}};
  const outside=(e:PointerEvent)=>{if(!container.current?.contains(e.target as Node))setOpen(false);};
  window.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);return()=>{window.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};
 },[]);
 const choose=(r:Result)=>{if(r.fixtureId&&onDemoSelect){onDemoSelect(r.fixtureId);setOpen(false);setQuery('');return;}if(!confirmStudioNavigation(r.href))return;setOpen(false);setQuery('');router.push(r.href);};
 return <header className="city-header" data-product-header>
  <Link className="city-brand" href="/studio"><span>3D ULPIN<small>CITY STUDIO</small></span><em>People · Parcels · Connected places</em></Link>
  <div className="city-search" ref={container}><Search size={17}/><input ref={search} role="combobox" aria-label="Search ULPIN, property or owner" aria-expanded={open&&!!query.trim()} aria-controls="city-search-list" aria-activedescendant={open&&active>=0?`city-result-${active}`:undefined} aria-autocomplete="list" value={query} maxLength={150} placeholder="Search all properties and records" onChange={e=>{setQuery(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(results.length-1,i+1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}if(e.key==='Enter'&&results[active]){e.preventDefault();choose(results[active]);}}}/><kbd>⌘ K</kbd>
   {open&&query.trim()&&<div className="city-search-results" id="city-search-list" role="listbox" aria-label="Matching properties">
    {results.map((r,i)=><button key={r.key} id={`city-result-${i}`} role="option" aria-selected={i===active} onMouseMove={()=>setActive(i)} onClick={()=>choose(r)}><Building2 size={19}/><span><strong>{r.label}</strong><small>{r.detail}</small></span><ArrowUpRight size={14}/></button>)}
    {(remote.loading||settled!==query.trim())&&<p role="status">Searching saved sources…</p>}
    {remote.error&&<p role="alert">Saved search unavailable. <button onClick={()=>void remote.reload()}>Retry</button></p>}
    {!results.length&&!remote.loading&&settled===query.trim()&&<p>No matching property. Check the source ID or address.</p>}
    <footer>Distinct datasets retain their own identities. <Link href="/studio/registry">Browse registers</Link></footer>
   </div>}
  </div>
  <nav className={`city-nav ${mobile?'is-open':''}`} aria-label="Product sections">{productNavigation.map(item=><Link key={item.key} href={item.href} aria-current={family===item.key?'page':undefined} onClick={()=>setMobile(false)}>{item.key==='block'?<MapIcon size={16}/>:item.key==='register'?<FileText size={16}/>:<Box size={16}/>}<span>{item.label}</span></Link>)}</nav>
  <div className="city-dataset"><button aria-label="Choose dataset" aria-expanded={datasets} onClick={()=>setDatasets(v=>!v)}><Layers3 size={16}/><span>{dataset}</span><ChevronDown size={13}/></button>{datasets&&<div className="city-dataset-menu"><header><strong>Datasets</strong><button onClick={()=>setDatasets(false)} aria-label="Close dataset chooser"><X size={15}/></button></header><Link href="/studio/map/BLD-0413" onClick={()=>setDatasets(false)}><Building2 size={17}/><span>Reference quarter<small>Authored 3D example · 62 buildings</small></span></Link>{areas.loading&&<p>Loading saved datasets…</p>}{areas.error&&<button onClick={()=>void areas.reload()}><RotateCw size={16}/>Retry saved datasets</button>}{areas.data?.map(a=><Link key={a.id} aria-current={a.id===areaId?'page':undefined} href={`/studio/areas/${a.id}`} onClick={()=>setDatasets(false)}><MapIcon size={16}/><span>{a.name}<small>{a.featureCount} features · {a.dataKind}</small></span></Link>)}<Link href="/studio/datasets">Browse all datasets →</Link></div>}</div>
  {actions&&<div className="city-header-actions">{actions}</div>}
  <button className="city-mobile-menu" aria-label="Main navigation" aria-expanded={mobile} onClick={()=>setMobile(v=>!v)}>{mobile?<X size={20}/>:<Menu size={20}/>}</button>
 </header>;
}

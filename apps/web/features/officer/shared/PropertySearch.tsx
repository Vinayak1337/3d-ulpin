'use client';
import {useState,useId} from 'react';
import {useDebouncedValue,useResource} from './hooks';
import {searchTargets,type ResolveMatch} from './search-targets';
import {Building2,ChevronRight,Search} from 'lucide-react';
export interface PropertyChoice{buildingId:string;areaId:string;name:string;identifier:string}
export default function PropertySearch({onChoose,recent=[]}:{onChoose:(choice:PropertyChoice)=>void;recent?:PropertyChoice[]}){
 const picker=useId().replaceAll(':','');
 const [value,setValue]=useState(''),[active,setActive]=useState(0),query=useDebouncedValue(value.trim());
 const data=useResource<{matches:ResolveMatch[]}>(query?'/resolve?identifier='+encodeURIComponent(query):null);
 const matches=value.trim()?(query===value.trim()?[...new Map((data.data?.matches??[]).flatMap(m=>searchTargets(m)).filter((t):t is typeof t & {id:string}=>t.kind==='building'&&typeof t.id==='string').map(t=>[`${t.id}:${t.areaId}`,{buildingId:t.id,areaId:t.areaId,name:t.recordName?`${t.recordName} · ${t.name}`:t.name,identifier:t.identifier}])).values()]:[]):recent;
 return <div className="property-picker"><label>Find an existing property<div><Search size={16}/><input role="combobox" aria-label="Existing property identifier" aria-expanded={matches.length>0} aria-controls={`${picker}-results`} aria-activedescendant={matches[active]?`${picker}-${active}`:undefined} value={value} maxLength={150} placeholder="Name, ULPIN or source identifier" onChange={e=>{setValue(e.target.value);setActive(0);}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(matches.length-1,a+1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(0,a-1));}if(e.key==='Enter'&&matches[active]){e.preventDefault();onChoose(matches[active]);}}}/></div></label><div id={`${picker}-results`} role="listbox">{matches.map((p,i)=><button type="button" key={`${p.buildingId}:${p.areaId}`} id={`${picker}-${i}`} role="option" aria-selected={active===i} onClick={()=>onChoose(p)}><Building2 size={19}/><span><strong>{p.name}</strong><small>{p.identifier}<br/>Dataset {p.areaId}</small></span><ChevronRight size={15}/></button>)}</div>{data.loading&&<p role="status">Searching retained properties…</p>}{data.error&&<p role="alert">{data.error}<button type="button" onClick={()=>void data.reload()}>Retry</button></p>}{!matches.length&&!data.loading&&<p>{query?'No matching building. No substitute property was chosen.':'Search a retained name or identifier. Multiple parent buildings remain separate choices.'}</p>}</div>;
}

'use client';
import {useState} from 'react';
import {Layers3,FileText,Users,ArrowUpRight,ChevronRight} from 'lucide-react';
import type {BuildingDossier,RegistryRecord} from '@ulpin/contracts';
import type {BlockController} from '../../officer/block/useBlock';
import {recordEvidence,number,words} from '../../officer/register/model';
import {Button,EmptyState} from '../../officer/shared/ui';
import {routes} from '../../officer/shared/routes';

export default function QuickRecords({block,onSource}:{block:BlockController;onSource:(id:string)=>void}){
 const [search,setSearch]=useState('');const dossier=block.dossier.data;
 if(!dossier)return <EmptyState title="Choose a building" description="Its saved floors and units appear here without leaving the map."/>;
 const selected=block.selectedRecord,floors=dossier.records.filter(r=>r.kind==='floor'),spaces=dossier.records.filter(r=>r.kind==='space');
 const floorId=selected?.kind==='floor'?selected.id:selected?.links.find(l=>l.type==='floor')?.targetId;
 const evidence=selected?recordEvidence(dossier,selected):[];
 const detail=selected&&dossier.detailedScene.find(d=>d.record.id===selected.id);
 return <div className="quick-records" data-quick-register={dossier.canonicalBuildingId}>
  <header><strong><Layers3 size={17}/>Floors & units</strong><span>{floors.length} / {spaces.length}</span></header>
  {block.recordUnavailable&&<p className="quick-warning" role="alert">The linked unit is not part of this building. No different record was selected.</p>}
  {!floors.length&&!spaces.length?<EmptyState title="Interior records not supplied" description="This property has a source exterior only. Missing floors are not inferred." action={<a className="ui-button" href={routes.workspace(dossier.canonicalBuildingId,dossier.area.id)}>Open plan workspace</a>}/>:<>
   <label className="quick-search"><span>Find unit or recorded party</span><input value={search} aria-label="Find unit in quick register" onChange={e=>setSearch(e.target.value)} placeholder="Unit, name, identifier"/></label>
   <Button variant="ghost" onClick={()=>block.selectRecord(null)}>Whole building</Button>
   {floors.map(f=><section key={f.id} className={`quick-floor ${floorId===f.id?'active':''}`}><button onClick={()=>block.selectRecord(f.id)} aria-pressed={floorId===f.id}><Layers3 size={15}/><strong>{f.name}</strong><span>{number(f.geometry?.lower,'m')}</span></button><div>{spaces.filter(r=>r.links.some(l=>l.type==='floor'&&l.targetId===f.id)).filter(r=>`${r.name} ${r.identifier} ${r.rights.map(x=>x.party).join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(r=><button key={r.id} onClick={()=>block.selectRecord(r.id)} aria-pressed={selected?.id===r.id}><Users size={13}/><span><strong>{r.name}</strong><small>{r.rights[0]?.party??'No party supplied'}</small></span><b>{number(r.geometry?.area,'m²')}</b><ChevronRight size={13}/></button>)}</div></section>)}
   {!!spaces.filter(r=>!r.links.some(l=>l.type==='floor')).length&&<section className="quick-floor"><strong>Shared / other spaces</strong>{spaces.filter(r=>!r.links.some(l=>l.type==='floor')).map(r=><button key={r.id} onClick={()=>block.selectRecord(r.id)}>{r.name}</button>)}</section>}
   {selected&&<article className="quick-unit-card"><header><strong>{selected.name}</strong><span>Revision {selected.revision}</span></header><code>{selected.identifier}</code><dl><div><dt>Use</dt><dd>{words(selected.use??selected.kind)}</dd></div><div><dt>Area</dt><dd>{number(selected.geometry?.area,'m²')}</dd></div><div><dt>Levels</dt><dd>{number(detail?.lower??selected.geometry?.lower)} – {number(detail?.upper??selected.geometry?.upper)} m</dd></div></dl>{selected.rights.map((r,i)=><p key={i}>{words(r.type)} · <strong>{r.party}</strong></p>)}{!detail?.geographicGeometry&&<p className="quick-warning">Source record retained; its placement in this map is not established.</p>}<strong className="quick-subtitle">Linked originals</strong>{evidence.length?evidence.map((e,i)=><button className="quick-source" key={`${e.source.id}:${i}`} onClick={()=>onSource(e.source.id)}><FileText size={15}/><span>{e.source.name}<small>{e.locator}</small></span><ArrowUpRight size={13}/></button>):<p>No direct source binding on this record.</p>}</article>}
  </>}
 </div>;
}

'use client';
import {useEffect,useMemo,useState} from 'react';
import type {PhysicalFeature} from '@ulpin/contracts';
import {useResource} from '../shared/hooks';
import {ErrorState,EmptyState,Button} from '../shared/ui';
import {dateTime,number,words} from './model';
import {revisionChanges,type FeatureRevisionResponse,type FeatureRevision} from './revision-model';
import {geometryPoints,geometryPath} from '../block/geometry';
import {routes} from '../shared/routes';
import './revision.css';

export default function RevisionCompare({feature}:{feature:PhysicalFeature}){
 const data=useResource<FeatureRevisionResponse>(`/physical-features/${feature.id}/revisions`);
 const [a,setA]=useState<number>(),[b,setB]=useState<number>();
 useEffect(()=>{setA(undefined);setB(undefined);},[feature.id]);
 const rows=data.data?.revisions??[],after=rows.find(r=>r.revision===b)??rows[0],before=rows.find(r=>r.revision===a)??rows[1]??after;
 const changes=before&&after?revisionChanges(before.body,after.body):[];
 const sharedFrame=before?.body.sourceReference?.analysisCrs===after?.body.sourceReference?.analysisCrs&&JSON.stringify(before?.body.sourceReference?.origin)===JSON.stringify(after?.body.sourceReference?.origin);
 const display=useMemo(()=>{
  if(!before||!after)return null;
  const geoms=[before.body.geometry,after.body.geometry],points=geoms.flatMap(geometryPoints);
  if(!points.length)return null;
  const bounds=points.reduce((s,p)=>[Math.min(s[0],p[0]),Math.min(s[1],-p[1]),Math.max(s[2],p[0]),Math.max(s[3],-p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  const w=Math.max(.01,bounds[2]-bounds[0]),h=Math.max(.01,bounds[3]-bounds[1]),margin=Math.max(w,h)*.13;
  return {paths:geoms.map(geometryPath),box:[bounds[0]-margin,bounds[1]-margin,w+margin*2,h+margin*2]};
 },[before,after]);
 if(data.error)return <ErrorState message={data.error} retry={data.reload}/>;
 if(!data.data)return <p role="status">Loading retained geometry revisions…</p>;
 if(!rows.length)return <EmptyState title="No retained physical revisions" description="Current registry events remain visible; historical geometry is not fabricated."/>;
 return <section className="revision-comparison" aria-label="Physical revision comparison"><header><div><h3>Retained geometry revisions</h3><p>Physical identity {feature.identifier} · current revision {data.data.currentRevision}</p></div><span>Read only</span></header><div className="revision-selectors"><label>Before<select aria-label="Before physical revision" value={before.revision} onChange={e=>setA(Number(e.target.value))}>{rows.map(r=><option key={r.revision} value={r.revision}>Revision {r.revision} · {dateTime(r.createdAt)}</option>)}</select></label><label>After<select aria-label="After physical revision" value={after.revision} onChange={e=>setB(Number(e.target.value))}>{rows.map(r=><option key={r.revision} value={r.revision}>Revision {r.revision} · {dateTime(r.createdAt)}</option>)}</select></label></div>
  {rows.length===1&&<p className="revision-note">Only one physical revision is retained. Comparing it with itself does not imply an earlier geometry.</p>}
  {display&&sharedFrame?<div className="revision-map"><svg viewBox={display.box.join(' ')} role="img" aria-label={`Retained outline comparison: revision ${before.revision} and ${after.revision}`}><path d={display.paths[0]} fill="#5497bd22" fillRule="evenodd" stroke="#4c86ad" strokeWidth="2" vectorEffect="non-scaling-stroke"/><path d={display.paths[1]} fill="#67a27522" fillRule="evenodd" stroke="#4e8657" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg><span><i className="before"/>Before {before.revision}<i className="after"/>After {after.revision}</span></div>:<p className="revision-note">The coordinate frames differ or no local outline is available. Numeric/source comparison remains available; outlines were not overlaid in an unqualified frame.</p>}
  <table><thead><tr><th>Source property</th><th>Before · rev {before.revision}</th><th>After · rev {after.revision}</th></tr></thead><tbody>{[['Name',before.body.name,after.body.name],['Height',number(before.body.height.value,'m'),number(after.body.height.value,'m')],['Footprint area',number(before.body.areaM2,'m²'),number(after.body.areaM2,'m²')],['Source world',words(before.body.worldStatus),words(after.body.worldStatus)],['Source receipt',before.body.sourceRevisionId,after.body.sourceRevisionId]].map(([label,left,right])=><tr key={label}><th>{label}</th><td>{left}</td><td>{right}</td></tr>)}</tbody></table>
  <div className="revision-changes"><strong>{changes.length?`${changes.length} changed fields`:'No changed fields in this comparison'}</strong>{changes.map(c=><span key={c.field}>{words(c.field)}</span>)}</div><footer><a href={routes.source(before.body.sourceRevisionId)} target="_blank" rel="noreferrer">Open before original ↗</a><a href={routes.source(after.body.sourceRevisionId)} target="_blank" rel="noreferrer">Open after original ↗</a></footer><p className="revision-note">{data.data.scope}</p>
 </section>;
}

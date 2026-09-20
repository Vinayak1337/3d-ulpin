'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {normalizeReferencePackage} from '@/features/spatial/reference-import/browser';
import {savedDatasetUrl,type SavedSpatialDataset} from '@/lib/spatial-datasets';
import {useMutation} from '../shared/hooks';
import {Button,ErrorState} from '../shared/ui';
type Imported=Awaited<ReturnType<typeof normalizeReferencePackage>>;
export default function DatasetIntake({file}:{file:File}){
 const [value,setValue]=useState<Imported|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState<SavedSpatialDataset|null>(null);
 const mutation=useMutation();
 useEffect(()=>{let active=true;setValue(null);setError('');void file.arrayBuffer().then(bytes=>normalizeReferencePackage(file.name,new Uint8Array(bytes))).then(result=>{if(active)setValue(result);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Unable to inspect this package.');});return()=>{active=false;};},[file]);
 const scene=value?.render.scene;
 return <section className="source-intake-gis" aria-label={`Dataset ${file.name}`}>
  <h2>{saved?'Dataset saved':'Review dataset'}</h2>
  {error&&<ErrorState message={error}/>}
  {!value&&!error&&<p role="status">Checking source files and dataset structure…</p>}
  {scene&&<><p><strong>{scene.metadata.title}</strong> · Fictional demonstration</p>
   <dl className="dataset-intake-counts">{[['Buildings',scene.objects.filter(o=>o.type==='building').length],['Floors',scene.objects.filter(o=>o.type==='floor').length],['Spaces',scene.objects.filter(o=>o.type==='space').length],['Source files',scene.sources.length]].map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
   <p>Original files and supplied records will be retained. Saving creates a dataset for review.</p>
   {mutation.error&&<ErrorState message={mutation.error}/>}
   {saved?<div className="source-intake-footer"><p>Saved · revision {saved.revision} · needs review</p><Link className="ui-button ui-button--primary" href={savedDatasetUrl(saved.id)}>Open map</Link><Link className="ui-button" href={`/studio/processing/${saved.id}`}>Open sources</Link></div>:<Button variant="primary" disabled={mutation.busy} onClick={()=>void mutation.run(async()=>{
    const response=await fetch('/api/v1/spatial-datasets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
    const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Dataset could not be saved.');setSaved(result);
   })}>{mutation.busy?'Saving dataset…':'Save dataset'}</Button>}
  </>}
 </section>;
}

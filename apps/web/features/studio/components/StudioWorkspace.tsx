import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Check,ChevronLeft,ChevronRight,Download,FileText,Layers3,Link2,Maximize,Minus,Plus,Ruler,Save,Send,ShieldCheck,SlidersHorizontal,Trash2,TriangleAlert,X} from 'lucide-react';
import type {Building,RecordContext} from '../types';
import FloorPlan from './FloorPlan';
import RegisterModel from '../scene/RegisterModel';
import {documentTitles,downloadDocument,saveJSON} from '../data/documents';
import {preparedDocumentId} from '../data/source-types';
import {useStudioSources,downloadPreparedAsset} from '../data/useSources';
import {loadStudioDraft,studioMeasurement,type StudioDraft} from '../data/workspace-draft';
import {useWorkspaceDraft} from '../data/useWorkspaceDraft';
import {verifyPreparedProperty,type SourceVerification} from '../data/verify-property-source';

type Props={b:Building;context:RecordContext;onContext:(context:RecordContext)=>void;onClose:()=>void;onRegister:()=>void};
export default function StudioWorkspace({b,context,onContext,onClose,onRegister}:Props){
 const sources=useStudioSources(),floor=context.floor??0,unit=b.units.find(u=>u.id===context.unitId)||b.units.find(u=>u.floor===floor)!;
 const draft=useWorkspaceDraft(b.id,floor,sources.data?.datasetSha256);
 const {tool,setTool,points,setPoints,calibration,setCalibration,notes,setNotes,revision,status}=draft;
 const [measure,setMeasure]=useState(false),[zoom,setZoom]=useState(1),[calibrate,setCalibrate]=useState(false),[compare,setCompare]=useState(false),[message,setMessage]=useState('');
 const [verification,setVerification]=useState<SourceVerification|null>(null),[busy,setBusy]=useState(false);

 const plans=useMemo(()=>sources.data?.documents.filter(d=>d.buildingId===b.id&&d.kind==='plan')??[],[sources.data,b.id]);
 const document=sources.data?.documents.find(d=>d.id===preparedDocumentId('plan',b.id,undefined,floor));
 const measurement=useMemo(()=>{try{return {value:studioMeasurement(points,tool,calibration),error:''};}catch(error){return {value:null,error:error instanceof Error?error.message:'Invalid draft measurement'};}},[points,tool,calibration]);
 const measured=measurement.value;
 const net=b.units.filter(u=>u.floor===floor).reduce((sum,u)=>sum+u.area,0);
 useEffect(()=>{setMeasure(false);},[floor]);
 useEffect(()=>{if(draft.loaded&&draft.unitId&&!context.unitId&&b.units.some(u=>u.id===draft.unitId&&u.floor===floor))onContext({doc:'plan',floor,unitId:draft.unitId});},[draft.loaded,draft.unitId,context.unitId,b,floor]);
 const checkSource=async()=>{
  if(!sources.data)throw new Error('Prepared source metadata is unavailable.');
  const result=await verifyPreparedProperty(b,sources.data);setVerification(result);return result;
 };
 const runCheck=async()=>{setBusy(true);try{const result=await checkSource();setMessage(`Source verified: ${result.floors} floors, ${result.units} units and ${result.documents} documents. Original SHA-256 matched.`);}catch(error){setVerification(null);setMessage(error instanceof Error?error.message:'Source verification failed.');}finally{setBusy(false);}};
 const save=async(nextStatus:StudioDraft['status'])=>{
  if(busy)return;setBusy(true);
  try{
   if(nextStatus==='ready_for_review'){
    if(measurement.error)throw new Error(measurement.error);
    if(points.length&&!measured)throw new Error('Complete or clear the unfinished measurement before review.');
    await checkSource();
   }
   const next=draft.save(unit.id,nextStatus);
   setMessage(nextStatus==='ready_for_review'?'Added to the local review queue. No registry record was modified.':`Local draft revision ${next.revision} saved. Original sources are unchanged.`);
  }catch(error){setMessage(error instanceof Error?error.message:'Draft storage failed.');}finally{setBusy(false);}
 };
 const chooseFloor=(f:number)=>{let next=b.units.find(u=>u.floor===f)!;try{const stored=loadStudioDraft(localStorage,b.id,f);if(stored&&stored.sourceHash===sources.data?.datasetSha256){next=b.units.find(u=>u.id===stored.unitId&&u.floor===f)??next;}}catch{}onContext({doc:'plan',floor:f,unitId:next.id});setMeasure(false);};
 const leave=()=>{if(draft.dirty&&!window.confirm('You have unsaved workspace changes. Leave without saving them?'))return;onClose();};
 useEffect(()=>{const clear=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='q'){event.preventDefault();setPoints([]);setMeasure(false);}};window.addEventListener('keydown',clear);return()=>window.removeEventListener('keydown',clear);},[setPoints]);

 return <section className="studio-plan-workspace" aria-label="Plan workspace">
  <header className="spw-header"><button onClick={leave}><ArrowLeft size={16}/>Back to map</button><div className="spw-breadcrumb"><span>{b.ulpin}</span><ChevronRight size={13}/><span>{b.address}</span><ChevronRight size={13}/><strong>Plan Workspace</strong></div><div className="spw-actions"><button disabled={busy||!sources.data||!draft.loaded||Boolean(draft.error)} onClick={()=>void save('draft')}><Save size={16}/>Save draft</button><button disabled={busy||!sources.data} onClick={()=>void runCheck()}><ShieldCheck size={16}/>Check source</button><button className="primary" disabled={busy||!sources.data||!draft.loaded||Boolean(draft.error)} onClick={()=>void save('ready_for_review')}><Send size={15}/>Queue for review</button><button onClick={onRegister}>Return to register</button></div></header>
  {draft.error&&<p role="alert" className="spw-notice">{draft.error}</p>}
  {message&&<div className="spw-notice" role="status"><InfoDot/><span>{message}</span><button onClick={()=>setMessage('')} aria-label="Dismiss workspace status"><X size={15}/></button></div>}
  <div className="spw-body">
   <aside className="spw-sources"><header><h2>Source documents <span>({plans.length+2})</span></h2><a href="/workspace" title="Open existing ingestion workspace"><Plus size={17}/>Add</a></header>
    <p className="spw-caption">Prepared before rendering · synthetic</p>
    {sources.error&&<p role="alert">{sources.error}</p>}
    <button className="spw-source-card" onClick={()=>void downloadDocument('land',b)}><span className="spw-doc-icon"><FileText size={31}/></span><span><strong>Parcel record</strong><small>DEMO-land-{b.id}.pdf</small><em><Link2 size={11}/>Linked original</em></span><Download size={14}/></button>
    {plans.map(d=><button key={d.id} className={`spw-source-card ${d.floor===floor?'active':''}`} onClick={()=>chooseFloor(d.floor!)}><span className="spw-plan-thumb"><FloorPlan b={b} floor={d.floor!}/></span><span><strong>{d.floor===0?'Ground floor':`Floor ${d.floor}`} plan</strong><small>{d.filename}</small><em><Check size={11}/>{d.floor===floor?'Active source':'Prepared'}</em></span></button>)}
    <button className="spw-source-card" onClick={()=>void downloadDocument('register',b)}><span className="spw-doc-icon"><Layers3 size={28}/></span><span><strong>Floor & unit register</strong><small>{b.units.length} linked unit records</small><em><Check size={11}/>Prepared</em></span><Download size={14}/></button>
    <div className="spw-source-proof"><ShieldCheck size={18}/><div><strong>Source integrity</strong><small>{document?`${document.pages} pages · ${(document.bytes/1024).toFixed(1)} KB`:'Loading source receipt…'}</small><code title={document?.sha256}>{document?.sha256.slice(0,20)}…</code></div></div>
    <a className="spw-source-link" href="/api/v1/studio/sources/assets/source-bundle">Download all prepared sources <ArrowUpRight size={14}/></a>
   </aside>
   <main className="spw-centre">
    <section className="spw-plan-panel"><header><div><strong>{floor===0?'Ground floor':`Floor ${floor}`} plan</strong><small>Local metre source · not an extracted scan</small></div><div className="spw-plan-nav"><button disabled={floor===0} onClick={()=>chooseFloor(floor-1)} aria-label="Previous floor"><ChevronLeft size={17}/></button><span>{floor+1} / {b.floors}</span><button disabled={floor===b.floors-1} onClick={()=>chooseFloor(floor+1)} aria-label="Next floor"><ChevronRight size={17}/></button></div><button aria-pressed={measure} onClick={()=>setMeasure(v=>!v)}><Ruler size={15}/>Measure</button><button aria-pressed={calibrate} onClick={()=>setCalibrate(v=>!v)}><SlidersHorizontal size={15}/>Calibrate</button><button aria-pressed={compare} onClick={()=>setCompare(v=>!v)}><Layers3 size={15}/>Compare</button></header>
     <div className="spw-tool-row">{(['distance','area','perimeter'] as const).map(t=><button className={tool===t?'active':''} key={t} onClick={()=>{setTool(t);setMeasure(true);setPoints([]);}}>{t[0].toUpperCase()+t.slice(1)}</button>)}<button onClick={()=>setPoints([])} disabled={!points.length}><Trash2 size={13}/>Clear</button><span>{measure?'Click source-plan points. Values are draft measurements.':'Select a unit or choose a measurement tool.'}</span><button onClick={()=>setZoom(v=>Math.max(.7,v-.15))} aria-label="Zoom plan out"><Minus size={13}/></button><b>{Math.round(zoom*100)}%</b><button onClick={()=>setZoom(v=>Math.min(2,v+.15))} aria-label="Zoom plan in"><Plus size={13}/></button></div>
     {measurement.error&&<p role="alert" className="spw-notice">{measurement.error}</p>}
     {calibrate&&<div className="spw-calibration"><label>Draft scale factor<input aria-label="Draft scale factor" type="number" min=".01" max="100" step=".01" value={calibration} onChange={e=>{const n=Number(e.target.value);if(n>0&&n<=100)setCalibration(n);}}/></label><span>The prepared source is already in metres. Scaling changes only the draft measurement, never original geometry.</span><button onClick={()=>setCalibration(1)}>Use source scale</button></div>}
     <div className={`spw-plan-stage ${compare?'is-comparing':''}`}><div style={{width:compare?'50%':`${zoom*100}%`,minWidth:compare?'50%':`${zoom*100}%`}}><FloorPlan b={b} floor={floor} selectedUnit={unit.id} onUnit={id=>onContext({doc:'plan',unitId:id,floor})} onPoint={measure?point=>setPoints(old=>old.length>=256?old:tool==='distance'&&old.length===2?[point]:[...old,point]):undefined} points={points} closed={tool!=='distance'}/></div>{compare&&<div className="spw-comparison"><FloorPlan b={b} floor={(floor+1)%b.floors}/><span>Comparison: floor {(floor+1)%b.floors}. The authored layout is identical; occupancy records differ.</span></div>}
      <div className="spw-plan-status"><span><ShieldCheck size={16}/>{verification?'Source checksum verified':'Prepared source linked'}</span>{measured&&<strong data-workspace-measurement>{measured.value.toFixed(2)} {measured.unit}</strong>}</div>
     </div>
    </section>
    <section className="spw-preview-row"><article className="spw-model-preview"><header><h2>3D preview</h2><small>Linked building envelope</small></header><div><RegisterModel b={b} floor={floor} selectedUnit={unit.id} elevation={false} exterior onFloor={chooseFloor} onUnit={id=>{const u=b.units.find(u=>u.id===id)!;onContext({doc:'plan',unitId:id,floor:u.floor});}}/></div></article><article className="spw-floor-stack"><h2>Floor stack</h2><div>{Array.from({length:b.floors},(_,i)=>b.floors-i-1).map(f=><button className={f===floor?'active':''} key={f} onClick={()=>chooseFloor(f)}><Layers3 size={29}/><strong>{f===0?'GF':`${f}F`}</strong><small>+{(f*b.floorHeight).toFixed(1)} m</small></button>)}</div></article><article className="spw-coverage"><h2>Coverage & details</h2><dl><div><dt>Floor footprint</dt><dd>{b.width*b.depth} m²</dd></div><div><dt>Unit room-net area</dt><dd>{net.toFixed(2)} m²</dd></div><div><dt>Units on this floor</dt><dd>{b.units.filter(u=>u.floor===floor).length}</dd></div><div><dt>Floor interval</dt><dd>{(floor*b.floorHeight).toFixed(1)}–{((floor+1)*b.floorHeight).toFixed(1)} m</dd></div></dl></article></section>
   </main>
   <aside className="spw-review"><h2>Plan to building details</h2><div className="spw-steps">{['Sources','Inspect','Draft','Review'].map((t,i)=><div key={t} className={i<2||status==='ready_for_review'?'done':''}><span>{i<2?<Check size={13}/>:i+1}</span><small>{t}</small></div>)}</div><section><h3>Source facts</h3><dl><div><dt>Footprint area</dt><dd>{b.width*b.depth} m²</dd></div><div><dt>Recorded floors</dt><dd>G + {b.floors-1}</dd></div><div><dt>Authored height</dt><dd>{b.height.toFixed(1)} m</dd></div><div><dt>Use</dt><dd>{b.use}</dd></div></dl><p>These are supplied synthetic facts, not ML predictions.</p></section><section><h3>Selected unit</h3><strong className="spw-unit-title">Unit {unit.number}</strong><dl><div><dt>Room-net area</dt><dd>{unit.area.toFixed(2)} m²</dd></div><div><dt>Bedrooms</dt><dd>{unit.bedrooms}</dd></div><div><dt>Occupancy</dt><dd>{unit.tenure}</dd></div></dl><button onClick={()=>void downloadDocument('lease',b,unit,unit.floor)}><FileText size={15}/>Open prepared unit record</button></section><section className="spw-checks"><h3>Review checks</h3><p><Check size={14}/>{verification?'Original checksum verified':'Prepared checksum recorded'}</p><p><Check size={14}/>Unit belongs to the selected floor</p><p><TriangleAlert size={14}/>Synthetic data — not cadastral approval</p><p><TriangleAlert size={14}/>Local draft queue — no registry changes</p></section><section className="spw-operational-handoff"><h3>Operational processing</h3><p>Use the persisted processing workspace for source mapping, control-point calibration, source comparison, candidate build and technical recording. This local Studio draft does not publish a registry revision.</p><a href="/workspace">Open processing workspaces <ArrowUpRight size={14}/></a></section><label className="spw-notes">Review notes<textarea value={notes} maxLength={4000} onChange={e=>setNotes(e.target.value)} placeholder="Record a question or a correction for review…"/></label><footer><span>{status==='ready_for_review'?'In local review queue':`Local draft · revision ${revision}`}</span><button className="primary" disabled={busy||!sources.data||!draft.loaded||Boolean(draft.error)} onClick={()=>void save('draft')}><Save size={15}/>Save draft</button><button onClick={()=>{if(!sources.data)return;saveJSON({buildingId:b.id,floor,unitId:unit.id,sourceHash:sources.data.datasetSha256,notes,points,calibration,tool,localDraft:true,synthetic:true},`DEMO-${b.id}-workspace-draft.json`);}}><Download size={15}/>Export draft</button></footer></aside>
  </div>
 </section>;
}
function InfoDot(){return <span className="spw-info-dot">i</span>;}

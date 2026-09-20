'use client';
import {useState} from 'react';
import {ArrowLeft,ArrowRight,Building2,FileImage,ScanLine} from 'lucide-react';
import type {SpatialMlResult,SpatialMlTask} from '@ulpin/contracts';
import type {DatasetMlOverview,DatasetMlRun} from '@/lib/dataset-ml';
import publicEvidence from './public-ml-evidence.json';
import {classColors,classLabel,PixelMask,RasterPrediction} from './MlImages';
import styles from './visual-story.module.css';

const samples=publicEvidence as unknown as Record<SpatialMlTask,SpatialMlResult>;

export default function Walkthrough({data,run,onReview}:{data:DatasetMlOverview;run?:DatasetMlRun;onReview:()=>void}){
 const [task,setTask]=useState<SpatialMlTask>(run?.task??'building');
 const [source,setSource]=useState<'public'|'dataset'>('public');
 const [showImage,setShowImage]=useState(true);
 const current=run?.task===task&&run.result?run:data.runs.find(r=>r.task===task&&r.result);
 const result=source==='public'?samples[task]:current?.result;
 const building=task==='building';
 const model=building?'RF-DETR':'CubiCasa5K';
 const sourceName=source==='public'?building?'OpenAerialMap · tile 1200':'CubiCasa5K · plan 1191':current?.sourceName??data.name;
 const key=`${source}:${task}:${result?.raster.sha256??'none'}`;
 const palette=result?.receipt.maskPalette as Record<string,string>|undefined;
 const labels=[...new Set(Object.values(palette??{}))].filter(label=>label!=='background');
 const elapsed=typeof result?.receipt.inferenceMs==='number'?(result.receipt.inferenceMs/1000).toFixed(2):null;
 const omitted=result?.receipt.omittedComponents as Record<string,number>|undefined;
 const omittedCount=Object.values(omitted??{}).reduce((sum,value)=>sum+value,0);
 return <main className={styles.story}>
  <header className={styles.header}>
   <button onClick={onReview} aria-label="Back to review"><ArrowLeft size={18}/></button>
   <strong>3D ULPIN</strong><span className={styles.divider}/><span>ML in action</span>
   <span className={styles.recorded}>Recorded inference</span>
  </header>
  <div className={styles.heading}>
   <nav className={styles.capabilities} aria-label="ML capabilities">
    <button aria-pressed={building} onClick={()=>setTask('building')}><Building2 size={20}/><span>Building extraction</span></button>
    <button aria-pressed={!building} onClick={()=>setTask('floor-plan')}><FileImage size={20}/><span>Room segmentation</span></button>
   </nav>
   <label className={styles.sourceChoice}>Example<select aria-label="Example source" value={source} onChange={e=>setSource(e.target.value as 'public'|'dataset')}><option value="public">Public test sample</option><option value="dataset">This dataset · {data.name.split(' · ')[0]}</option></select></label>
  </div>
  <div className={styles.context}><span>{sourceName}</span><span>{source==='public'?'Public test image':data.name.split(' · ')[0]}</span></div>
  {!result?<div className={styles.missing}><ScanLine size={48}/><strong>No saved {building?'building':'room'} extraction</strong><button onClick={onReview}>Open source processing <ArrowRight size={15}/></button></div>:<>
   <div className={styles.canvas} key={key}>
    <section className={styles.panel} aria-label="Input image">
     <div className={styles.panelLabel}><span>01</span><h1>{building?'Aerial image':'Floor plan'}</h1></div>
     <RasterPrediction result={result}/>
     <div className={styles.caption}><span>Model input</span><span>{result.raster.width} × {result.raster.height} px</span></div>
    </section>
    <div className={styles.connector}><ArrowRight size={21}/><span>{model}</span></div>
    <section className={`${styles.panel} ${styles.prediction}`} aria-label="Model predictions">
     <div className={styles.panelLabel}><span>02</span><h2>{building?'Roof pixels':'Room classes'}</h2></div>
     <PixelMask result={result}/>
     <div className={styles.caption}><span>Actual pixel mask</span><span>Color = class</span></div>
    </section>
    <div className={styles.connector}><ArrowRight size={21}/><span>Trace edges</span></div>
    <section className={styles.panel} aria-label="Candidate outlines">
     <div className={styles.panelLabel}><span>03</span><h2>Extracted outlines</h2></div>
     <RasterPrediction result={result} overlay showImage={showImage}/>
     <div className={styles.caption}><span>{result.components.length} candidate regions</span><button aria-pressed={showImage} onClick={()=>setShowImage(value=>!value)}>{showImage?'Hide image':'Show image'}</button></div>
    </section>
   </div>
   <div className={styles.legend} aria-label="Prediction classes">{labels.map(label=><span key={label}><i style={{background:classColors[label]??'#b7b3ad'}}/>{classLabel(label)}</span>)}</div>
   <footer className={styles.footer}>
    <div className={styles.runtime}><strong>{model}</strong><span>Pretrained · ONNX · local CPU</span>{elapsed&&<span>{elapsed} s <small>recorded</small></span>}</div>
    <span className={styles.review}>Candidates · review required</span>
    <details className={styles.evidence} key={key}><summary>Source &amp; evidence</summary><div>
     <strong>{sourceName}</strong>
     <a href={result.raster.url} target="_blank" rel="noreferrer">Input raster ↗</a><a href={result.mask.url} target="_blank" rel="noreferrer">Original label mask ↗</a>
     {source==='public'&&<><a href="/explainer/ml/receipts.json" target="_blank" rel="noreferrer">Inference receipts ↗</a><a href="/explainer/evaluation.md" target="_blank" rel="noreferrer">Attribution &amp; evaluation ↗</a><span>{building?'OpenAerialMap / HOTOSM · CC BY 4.0':'CubiCasa5K · CC BY-NC 4.0'}</span></>}
     <span>Mask → polygons · ≥16 px · 0.5 px simplification</span><span>{omittedCount} omitted regions · retained in mask</span>
     <span>Model SHA {result.model.sha256.slice(0,12)}</span><span>Raster SHA {result.raster.sha256.slice(0,12)}</span>
    </div></details>
   </footer>
  </>}
 </main>;
}

'use client';
import {useState} from 'react';
import {ArrowLeft,ArrowRight,Building2,FileImage,ScanLine} from 'lucide-react';
import type {SpatialMlTask} from '@ulpin/contracts';
import type {DatasetMlOverview,DatasetMlRun} from '@/lib/dataset-ml';
import {classColors,classLabel,PixelMask,RasterPrediction} from './MlImages';
import styles from './visual-story.module.css';

export default function Walkthrough({data,run,onReview}:{data:DatasetMlOverview;run?:DatasetMlRun;onReview:()=>void}){
 const [task,setTask]=useState<SpatialMlTask>(run?.task??'building');
 const [showImage,setShowImage]=useState(true);
 const current=run?.task===task&&run.result?run:data.runs.find(r=>r.task===task&&r.result);
 const result=current?.result;
 const building=task==='building';
 const model=result?.model.id??'Model unavailable';
 const sourceName=current?.sourceName??data.name;
 const key=`${task}:${result?.raster.sha256??'none'}`;
 const palette=result?.receipt.maskPalette as Record<string,string>|undefined;
 const labels=[...new Set(Object.values(palette??{}))].filter(label=>label!=='background');
 const elapsed=typeof result?.receipt.inferenceMs==='number'?(result.receipt.inferenceMs/1000).toFixed(2):null;
 const omitted=result?.receipt.omittedComponents as Record<string,number>|undefined;
 const omittedCount=Object.values(omitted??{}).reduce((sum,value)=>sum+value,0);
 return <main className={styles.story}>
  <header className={styles.header}>
   <button onClick={onReview} aria-label="Back to review"><ArrowLeft size={18}/></button>
   <strong>3D ULPIN</strong><span className={styles.divider}/><span>ML in action</span>
   <span className={styles.recorded}>{result?'Recorded inference':'No saved inference'}</span>
  </header>
  <div className={styles.heading}>
   <nav className={styles.capabilities} aria-label="ML capabilities">
    <button aria-pressed={building} onClick={()=>setTask('building')}><Building2 size={20}/><span>Building extraction</span></button>
    <button aria-pressed={!building} onClick={()=>setTask('floor-plan')}><FileImage size={20}/><span>Room segmentation</span></button>
   </nav>
   <span className={styles.sourceChoice}>{data.name}</span>
  </div>
  <div className={styles.context}><span>{sourceName}</span><span>{data.name}</span></div>
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
    <div className={styles.runtime}><strong>{model}</strong><span>Saved inference result</span>{elapsed&&<span>{elapsed} s <small>recorded</small></span>}</div>
    <span className={styles.review}>Candidates · review required</span>
    <details className={styles.evidence} key={key}><summary>Source &amp; evidence</summary><div>
     <strong>{sourceName}</strong>
     <a href={result.raster.url} target="_blank" rel="noreferrer">Input raster ↗</a><a href={result.mask.url} target="_blank" rel="noreferrer">Original label mask ↗</a>

     <span>Mask and candidate outlines retained with this run</span><span>{omittedCount} omitted regions · retained in mask</span>
     <span>Model SHA {result.model.sha256.slice(0,12)}</span><span>Raster SHA {result.raster.sha256.slice(0,12)}</span>
    </div></details>
   </footer>
  </>}
 </main>;
}

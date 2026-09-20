import { useState } from 'react';
import { ArrowUpRight, Box, Check, FileImage, RotateCw, ScanLine } from 'lucide-react';
import evidence from './evidence.json';
import styles from './explainer.module.css';

export function PlanVisual({step}: {step:number}) {
  const [sample,setSample] = useState<'floor-plan'|'building'>('floor-plan');
  const [overlay,setOverlay] = useState(true);
  const task = step === 1 ? sample : 'floor-plan';
  const data = evidence[task];
  const show = step > 0 && overlay;
  return <div className={styles.visual}>
    <div className={styles.visualToolbar}>
      <span><FileImage size={15}/>{task === 'floor-plan' ? 'CubiCasa5K / test plan 1191' : 'OpenAerialMap / test tile 1200'}</span>
      <span className={styles.pill}>Retained inference</span>
    </div>
    <div className={styles.planCanvas}>
      <svg viewBox={`-18 ${step === 2 ? -48 : -18} ${data.width+36} ${data.height+(step===2?70:36)}`} role="img" aria-label={`${task === 'floor-plan' ? 'Floor plan' : 'Aerial image'}${show ? ' with predicted regions' : ' original inference raster'}`}>
        <image href={`/explainer/${task}.png`} width={data.width} height={data.height}/>
        {show && <g data-testid="prediction-overlay">{data.regions.map((region,index)=><path key={region.id} d={region.path} fillRule="evenodd" className={index===0 && task==='floor-plan' ? styles.selectedRegion : region.label==='wall' ? styles.wallRegion : styles.region} opacity={step===2 && index!==0 ? .12 : 1}><title>{region.label.replaceAll('_',' ')} · uncalibrated model score {region.score.toFixed(3)}</title></path>)}</g>}
        {step===2 && <g className={styles.controls}><path d="M0,-22 H768 M0,-31 V0 M768,-31 V0"/><circle cx="0" cy="0" r="7"/><circle cx="768" cy="0" r="7"/><text x="384" y="-30" textAnchor="middle">40 m · synthetic test controls</text></g>}
      </svg>
    </div>
    <div className={styles.visualControls}>
      {step===1 ? <>
        <div className={styles.segment} aria-label="Example source">
          <button type="button" aria-pressed={sample==='floor-plan'} onClick={()=>setSample('floor-plan')}>Floor plan</button>
          <button type="button" aria-pressed={sample==='building'} onClick={()=>setSample('building')}>Aerial image</button>
        </div>
        <label className={styles.toggle}><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)}/>Show regions</label>
      </> : step===2 ? <><span className={styles.mono}>768 px → 40 m</span><span>0.052083 m / pixel</span></> : <><span><ScanLine size={15}/> {data.width} × {data.height} px</span><a href={`/explainer/${task}.png`} target="_blank" rel="noreferrer">Open source image <ArrowUpRight size={14}/></a></>}
    </div>
    <div className={styles.visualCaption} aria-live="polite">{step===0 ? 'The exact raster used for inference. Original source bytes are retained separately.' : step===1 ? `${data.regions.length} proposed regions · ${task==='floor-plan'?'amber marks the contour used in the recorded test':'roof regions do not establish parcels or height'}` : 'Amber contour selected for review · control coordinates are authored test inputs.'}</div>
  </div>;
}

export function PrismVisual({compact=false}: {compact?:boolean}) {
  const [angle,setAngle] = useState(25);
  const [solid,setSolid] = useState(true);
  const unit=evidence.unit;
  const xs=unit.footprint.map(p=>p[0]), ys=unit.footprint.map(p=>p[1]);
  const center=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
  const rad=angle*Math.PI/180;
  const project=(point:number[],z:number)=>{
    const x=point[0]-center[0],y=point[1]-center[1];
    const rx=x*Math.cos(rad)-y*Math.sin(rad),ry=x*Math.sin(rad)+y*Math.cos(rad);
    return [320+rx*24,240+ry*13-z*30];
  };
  const upper=solid?unit.height:0;
  const base=unit.footprint.map(p=>project(p,0)),top=unit.footprint.map(p=>project(p,upper));
  const points=(p:number[][])=>p.map(v=>v.join(',')).join(' ');
  const faces=base.map((p,i)=>({index:i,depth:(p[1]+base[(i+1)%base.length][1])/2})).sort((a,b)=>a.depth-b.depth);
  return <div className={`${styles.prism} ${compact?styles.compactPrism:''}`}>
    <div className={styles.prismHeader}><span><Box size={16}/> ML-ROOM-01</span><span>Retained test geometry</span></div>
    <svg viewBox="0 0 640 400" role="img" aria-label={`Schematic projection of the retained 220-vertex contour${solid?' extruded to the supplied 3 metre height':''}`}>
      <defs><pattern id={compact?'small-grid':'prism-grid'} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#dce5de" strokeWidth=".7"/></pattern></defs>
      <rect width="640" height="400" fill={`url(#${compact?'small-grid':'prism-grid'})`}/>
      <polygon points={points(base)} fill="#234f3a" fillOpacity=".09"/>
      {solid && faces.map(({index:i})=><polygon key={i} points={points([base[i],base[(i+1)%base.length],top[(i+1)%top.length],top[i]])} className={styles.prismSide}/>)}
      <polygon points={points(top)} className={styles.prismTop}/>
      <path d="M528 155V245 M522 155H534 M522 245H534" className={styles.heightLine} opacity={solid?1:0}/>
      <text x="544" y="205" className={styles.diagramText} opacity={solid?1:0}>3 m</text>
      <text x="320" y="365" textAnchor="middle" className={styles.diagramText}>220 retained contour vertices</text>
    </svg>
    {!compact && <div className={styles.visualControls}><div className={styles.segment}><button type="button" onClick={()=>setSolid(false)} aria-pressed={!solid}>2D footprint</button><button type="button" onClick={()=>setSolid(true)} aria-pressed={solid}>3D volume</button></div><button type="button" className={styles.textButton} onClick={()=>setAngle(a=>(a+45)%360)}><RotateCw size={15}/>Rotate view</button></div>}
    <div className={styles.measurements}><div><span>Footprint area</span><strong>69.99 <small>m²</small></strong></div><div><span>Supplied height</span><strong>3.00 <small>m</small></strong></div><div><span>Computed volume</span><strong>209.98 <small>m³</small></strong></div></div>
    <div className={styles.visualCaption}>Schematic display · synthetic placement and levels · geometry values from the retained worker result.</div>
  </div>;
}

export function RecordVisual() {
  return <div className={styles.recordVisual}>
    <div className={styles.recordHeading}><span className={styles.recordSeal}><Check size={22}/></span><div><span className={styles.eyebrow}>HISTORICAL VERIFICATION RECORD</span><h3>ML-ROOM-01</h3><p>Synthetic metric verification room · revision 1</p></div></div>
    <PrismVisual compact/>
    <div className={styles.provenance}>
      <div><span>01</span><p><strong>Original evidence</strong>CubiCasa5K plan 1191 · retained hash</p></div>
      <div><span>02</span><p><strong>Extraction receipt</strong>Pinned model · mask · exact contour</p></div>
      <div><span>03</span><p><strong>Review inputs</strong>Synthetic controls + independent level evidence</p></div>
      <div><span>04</span><p><strong>Technical revision</strong>Reviewed geometry + preserved history</p></div>
    </div>
  </div>;
}

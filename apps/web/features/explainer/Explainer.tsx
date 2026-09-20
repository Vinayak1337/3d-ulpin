'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Box, Check, ChevronRight, GitBranch, Layers, Maximize2, Minimize2, Play, ShieldCheck } from 'lucide-react';
import { steps } from './content';
import { PlanVisual, PrismVisual, RecordVisual } from './Visuals';
import Architecture from './Architecture';
import Results from './Results';
import styles from './explainer.module.css';

const views=[{id:'walkthrough',label:'The walkthrough',sub:'One source. One complete journey.',icon:Play},{id:'architecture',label:'The architecture',sub:'What runs where, and why.',icon:GitBranch},{id:'results',label:'The evidence',sub:'What we can actually claim.',icon:ShieldCheck}] as const;
type View=typeof views[number]['id'];

export default function Explainer() {
  const [view,setView]=useState<View>('walkthrough');
  const [step,setStep]=useState(0);
  const [fullscreen,setFullscreen]=useState(false);
  const [notice,setNotice]=useState('');
  const root=useRef<HTMLDivElement>(null);
  const current=steps[step];
  useEffect(()=>{
    const onFullscreen=()=>setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange',onFullscreen);
    return ()=>document.removeEventListener('fullscreenchange',onFullscreen);
  },[]);
  async function present(){
    try {if(document.fullscreenElement) await document.exitFullscreen();else if(root.current?.requestFullscreen) await root.current.requestFullscreen();else setNotice('Full screen is unavailable in this browser. The page is ready to present in this window.');}
    catch {setNotice('Full screen was unavailable. You can present in this browser window.');}
  }
  return <div className={styles.shell} ref={root}>
    <a href="#explainer-content" className={styles.skipLink}>Skip to content</a>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="/explain"><Box size={27} strokeWidth={1.4}/><span>3D ULPIN<small>INSIDE THE SYSTEM</small></span></a>
      <div className={styles.sidebarIntro}><span className={styles.eyebrow}>A GUIDED EXPLAINER</span><p>Behind<br/>the record.</p></div>
      <nav aria-label="Presentation sections">{views.map((item,index)=>{const Icon=item.icon;return <button type="button" key={item.id} aria-current={view===item.id?'page':undefined} onClick={()=>setView(item.id)}><span className={styles.navNumber}>0{index+1}</span><span><strong>{item.label}</strong><small>{item.sub}</small></span><Icon size={16}/></button>;})}</nav>
      <div className={styles.sidebarBottom}><div><span className={styles.localDot}/> Local processing, traceable evidence</div><p>ML proposes.<br/>Geometry computes.<br/>People review.</p><a href="/studio/processing">Open live processing <ArrowUpRight size={15}/></a><a href="/studio/datasets">Open saved maps <ArrowUpRight size={15}/></a></div>
    </aside>
    <main id="explainer-content" className={styles.main}>
      <header className={styles.topbar}><span>THE 3D ULPIN PROJECT <ChevronRight size={13}/> {views.find(v=>v.id===view)?.label}</span><button type="button" onClick={present}>{fullscreen?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{fullscreen?'Exit full screen':'Present'}</span></button></header>
      {notice && <p className={styles.notice} role="status">{notice}<button type="button" onClick={()=>setNotice('')}>Dismiss</button></p>}
      <div className={styles.pageHeading}><div><span className={styles.eyebrow}>{view==='walkthrough'?'FROM EVIDENCE TO RECORD':view==='architecture'?'SEVEN COMPONENTS. CLEAR RESPONSIBILITIES.':'MEASURED RESULTS, HONEST BOUNDARIES'}</span><h1>{view==='walkthrough'?<>A floor plan.<br/><em>A traceable 3D record.</em></>:view==='architecture'?<>A system you can<br/><em>explain, end to end.</em></>:<>Working inference.<br/><em>Visible limitations.</em></>}</h1></div><p>{view==='walkthrough'?'Follow a real retained model result through five stages. See where AI helps, where geometry takes over, and where human judgment matters.':view==='architecture'?'A local, single-operator workflow. Click a component to explore its inputs, outputs and responsibility.': 'Pretrained models evaluated on a small public sample. These results demonstrate feasibility and integration, not survey qualification.'}</p></div>
      {view==='walkthrough'? <>
        <nav className={styles.steps} aria-label="Walkthrough stages">{steps.map((item,index)=><button type="button" key={item.label} aria-current={step===index?'step':undefined} onClick={()=>setStep(index)}><span>{index<step?<Check size={14}/>:String(index+1).padStart(2,'0')}</span>{item.label}{index<steps.length-1 && <ChevronRight className={styles.stepArrow} size={16}/>}</button>)}</nav>
        <div className={styles.walkthrough}>
          <section className={styles.stage} aria-label="Example visualization">{step<3?<PlanVisual key={step} step={step}/>:step===3?<PrismVisual/>:<RecordVisual/>}</section>
          <section className={styles.explanation} aria-live="polite"><span className={styles.eyebrow}>{current.kicker}</span><h2>{current.title}</h2><p>{current.body}</p><div className={styles.io}><div><span>INPUT</span><strong>{current.input}</strong></div><ArrowRight size={17}/><div><span>OUTPUT</span><strong>{current.output}</strong></div></div><div className={styles.owner}><Layers size={17}/><span>{current.owner}</span></div><div className={styles.limit}><span>KEEP THIS DISTINCTION</span><p>{current.limit}</p></div></section>
        </div>
        <div className={styles.speakerNote}><span>SAY IT THIS WAY</span><p>“{current.note}”</p></div>
        <footer className={styles.walkthroughFooter}><span>0{step+1} <span>/ 05</span> <small>Historical test · no live inference or record changes</small></span><div><button type="button" className={styles.backButton} disabled={step===0} onClick={()=>setStep(s=>s-1)}><ArrowLeft size={16}/>Previous</button><button type="button" className={styles.nextButton} onClick={()=>step===4?setView('architecture'):setStep(s=>s+1)}>{step===4?'Explore architecture':'Next stage'}<ArrowRight size={16}/></button></div></footer>
      </> : view==='architecture'?<Architecture/>:<Results/>}
      <footer className={styles.pageFooter}><span>3D ULPIN / EXPLAINER</span><span>Reviewed assistance · source-linked geometry · technical records</span></footer>
    </main>
  </div>;
}

import { useState } from 'react';
import { Cpu, Database, Files, Layers, Monitor, Route, Server, ArrowRight } from 'lucide-react';
import { systems, type SystemId } from './content';
import styles from './explainer.module.css';

const icons={screen:Monitor,server:Server,database:Database,route:Route,files:Files,layers:Layers,cpu:Cpu};
const connections=[
  {from:'studio',to:'api',d:'M255 191 H275 V98 H290'},
  {from:'api',to:'db',d:'M405 128 V184'},
  {from:'db',to:'dispatcher',d:'M405 257 V313'},
  {from:'api',to:'storage',d:'M520 98 H720'},
  {from:'dispatcher',to:'queue',d:'M520 350 H620 V220 H720'},
  {from:'queue',to:'worker',d:'M835 257 V313'},
  {from:'storage',to:'worker',d:'M950 98 H982 V350 H950'},
];

export default function Architecture() {
  const [selected,setSelected]=useState<SystemId>('worker');
  const current=systems.find(s=>s.id===selected)!;
  return <>
    <div className={styles.architectureBoard}>
      <div className={styles.laneLabels}><span>01 / OFFICER INTERFACE</span><span>02 / APPLICATION</span><span>03 / PRIVATE PROCESSING</span></div>
      <div className={styles.systemGraph}>
        <svg className={styles.graphLines} viewBox="0 0 1000 430" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="architecture-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor"/></marker></defs>{connections.map(c=><path key={c.from+c.to} d={c.d} className={c.from===selected||c.to===selected?styles.activeConnection:''} markerEnd="url(#architecture-arrow)"/>)}</svg>
        {systems.map(system=>{const Icon=icons[system.icon];return <button type="button" key={system.id} className={styles.systemNode} style={{left:`${system.x}%`,top:`${system.y}%`}} aria-pressed={selected===system.id} onClick={()=>setSelected(system.id)}><Icon size={20}/><span><strong>{system.title}</strong><small>{system.sub}</small></span></button>;})}
        <span className={styles.graphHint}>Select a component to see its role</span>
      </div>
      <div className={styles.graphFooter}><span>Arrows show request, job and evidence flow.</span><span>Results return through the dispatcher for validation and ingestion.</span></div>
    </div>
    <section className={styles.systemDetail} aria-live="polite">
      <div><span className={styles.eyebrow}>COMPONENT / {String(systems.indexOf(current)+1).padStart(2,'0')}</span><h2>{current.title}</h2><p>{current.description}</p></div>
      <div className={styles.systemIO}><div><span>RECEIVES</span><p>{current.input}</p></div><ArrowRight size={20}/><div><span>PRODUCES</span><p>{current.output}</p></div></div>
    </section>
    <div className={styles.speakerNote}><span>THE IMPORTANT DISTINCTION</span><p>{current.note}</p></div>
    <div className={styles.architectureLegend}><span><i/> Local inference</span><span>No application DB access from the worker</span><span>Recording requires explicit review</span></div>
  </>;
}

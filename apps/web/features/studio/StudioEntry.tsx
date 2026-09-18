'use client';
import dynamic from 'next/dynamic';
import './styles.css';
import './refinements.css';
import './integration.css';
const Studio=dynamic(()=>import('./StudioApp'),{ssr:false,loading:()=> <div style={{height:'100dvh',display:'grid',placeItems:'center',fontFamily:'Segoe UI, sans-serif',background:'#f4f7f5',color:'#315f53'}}>Loading City Studio…</div>});
export default function StudioEntry(){return <div className="studio-root"><Studio/></div>;}

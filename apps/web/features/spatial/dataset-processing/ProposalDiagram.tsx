'use client';
import {useState} from 'react';
import {Box} from 'lucide-react';
import type {DatasetMlReview} from '@/lib/dataset-ml';
import {pathFor} from './geometry';
import styles from './processing.module.css';
export function ProposalDiagram({review}:{review:DatasetMlReview}){
 const [angle,setAngle]=useState(25);const geometries=review.geometry??[];
 if(!geometries.length)return null;
 const rings=geometries.flatMap(g=>{const geo=g.geometry as {type:string;coordinates:number[][][]|number[][][][]};return geo.type==='Polygon'?[geo.coordinates as number[][][]]:geo.coordinates as number[][][][];});
 const points=rings.flat(1).flat(1),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,extent=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1);
 const height=review.lowerM===undefined?0:review.upperM!-review.lowerM,scale=380/(extent+height),rad=angle*Math.PI/180;
 const project=(p:number[],z:number)=>{const x=p[0]-cx,y=p[1]-cy;return [320+(x*Math.cos(rad)-y*Math.sin(rad))*scale,230+(x*Math.sin(rad)+y*Math.cos(rad))*scale*.5-z*scale];};
 const projected=(poly:number[][][],z:number)=>pathFor({type:'Polygon',coordinates:poly.map(r=>r.map(p=>project(p,z)))});
 return <div className={styles.diagram}><div className={styles.imageHeader}><strong><Box size={16}/> {height?'Calculated prism illustration':'Calibrated outlines'}</strong><span>Candidate geometry · not a published map</span></div><svg viewBox="0 0 640 350" role="img" aria-label="Schematic projection of saved candidate polygons with supplied levels"><path d="M40 270H600M80 305H560" stroke="#d5ded8"/>{rings.map((poly,i)=><g key={i}><path d={projected(poly,0)} fill="#285a43" fillOpacity=".1" fillRule="evenodd"/>{height>0&&poly.flatMap((ring,k)=>ring.slice(0,-1).map((p,j)=><polygon key={`${k}-${j}`} points={[project(p,0),project(ring[j+1],0),project(ring[j+1],height),project(p,height)].map(v=>v.join(',')).join(' ')} fill="#517b64" fillOpacity=".25" stroke="#456650" strokeWidth=".4"/>))}<path d={projected(poly,height)} fill="#94b69c" fillOpacity=".8" fillRule="evenodd" stroke="#244b35" strokeWidth="1"/></g>)}</svg><label className={styles.diagramControl}>Rotate illustration<input aria-label="Rotate proposal illustration" type="range" min="0" max="360" value={angle} onChange={e=>setAngle(Number(e.target.value))}/></label></div>;
}

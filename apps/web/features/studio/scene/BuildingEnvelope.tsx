import {useMemo} from 'react';
import type {Building} from '../types';
import {buildArchitecture,type SceneInstance} from './architecture';
import InstanceBatch from './InstanceBatch';
import {useSurfaceMaps} from './Appearance';

export function ArchitectureParts({parts,hidden,underground=false,onPick,onHover,highlight}:{parts:Record<string,SceneInstance[]>;hidden?:string;underground?:boolean;onPick?:(id:string)=>void;onHover?:(id:string|null)=>void;highlight?:{id:string;tint:string;strength:number}}){
 const maps=useSurfaceMaps();
 return <>{Object.entries(parts).map(([name,items])=>items.length>0&&<InstanceBatch key={`${name}-${underground}`} items={items} kind={name==='tanks'?'cylinder':'box'} hidden={hidden} opacity={underground?.3:1} wire={underground} onPick={name==='body'||name==='roof'?onPick:undefined} onHover={name==='body'||name==='roof'?onHover:undefined} cast={name!=='windows'&&name!=='solar'} roughness={name==='windows'?.34:.88} map={name==='roof'?maps.roof:name==='body'||name==='frames'?maps.concrete:undefined} highlight={highlight}/>)}</>;
}

export default function BuildingEnvelope({building,cutaway=false,spacing,maxFloor,highlight}:{building:Building;cutaway?:boolean;spacing?:number;maxFloor?:number;highlight?:{id:string;tint:string;strength:number}}){
 const parts=useMemo(()=>buildArchitecture([building],{cutaway,spacing,maxFloor}),[building,cutaway,spacing,maxFloor]);
 return <ArchitectureParts parts={parts} highlight={highlight}/>;
}

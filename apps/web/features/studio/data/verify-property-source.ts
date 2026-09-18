import type {Building} from '../types';
import type {StudioSourceManifest} from './source-types';
import {getFloorLayout} from './floorLayout';

export interface SourceVerification{buildingId:string;floors:number;units:number;documents:number;sha256:string;checkedAt:string}
export function validatePreparedProperty(b:Building,raw:unknown,manifest:StudioSourceManifest):Omit<SourceVerification,'checkedAt'>{
  if(!raw||typeof raw!=='object')throw new Error('The prepared source is not a record object.');
  const data=raw as {synthetic?:boolean;datasetVersion?:string;district?:{buildings?:Building[]}};
  if(data.synthetic!==true||data.datasetVersion!==manifest.datasetVersion||!Array.isArray(data.district?.buildings))throw new Error('Prepared source metadata does not match the active dataset.');
  const matches=data.district.buildings.filter(item=>item.id===b.id);
  if(matches.length!==1||JSON.stringify(matches[0])!==JSON.stringify(b))throw new Error('The selected building differs from its prepared original record.');
  const docs=manifest.documents.filter(item=>item.buildingId===b.id);
  for(let f=0;f<b.floors;f++){
    if(docs.filter(d=>d.kind==='plan'&&d.floor===f).length!==1)throw new Error(`Floor ${f} has no unique prepared plan.`);
    const layout=getFloorLayout(b,f);
    for(const {unit,rooms}of layout.units){
      const area=Math.round(rooms.reduce((sum,r)=>sum+r.width*r.depth,0)*100)/100;
      if(Math.abs(area-unit.area)>.03)throw new Error(`Unit ${unit.number} room geometry and recorded area disagree.`);
      if(docs.filter(d=>d.kind==='lease'&&d.unitId===unit.id&&d.floor===f).length!==1)throw new Error(`Unit ${unit.number} has no unique prepared occupancy record.`);
    }
  }
  for(const kind of ['land','register','aerial'])if(docs.filter(d=>d.kind===kind).length!==1)throw new Error(`The ${kind} document is missing or duplicated.`);
  return {buildingId:b.id,floors:b.floors,units:b.units.length,documents:docs.length,sha256:manifest.datasetSha256};
}

/** Downloads and checks source bytes; a green result is never an unconditional toast. */
export async function verifyPreparedProperty(b:Building,manifest:StudioSourceManifest,request:typeof fetch=fetch):Promise<SourceVerification>{
  const asset=manifest.assets.find(a=>a.id==='records');
  if(!asset||asset.sha256!==manifest.datasetSha256)throw new Error('The original record asset is not linked to this manifest.');
  const response=await request('/api/v1/studio/sources/assets/records',{cache:'no-store'});
  if(!response.ok)throw new Error(`Original source verification failed (${response.status}).`);
  const bytes=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==asset.bytes||digest!==asset.sha256)throw new Error('The original source bytes do not match the prepared checksum.');
  return {...validatePreparedProperty(b,JSON.parse(new TextDecoder().decode(bytes)),manifest),checkedAt:new Date().toISOString()};
}

'use client';
import {useEffect,useState} from 'react';
import {STUDIO_DATA_VERSION} from './district';
import type {StudioSourceManifest} from './source-types';
let promise:Promise<StudioSourceManifest>|undefined;
export function getStudioSources(){return promise??=fetch('/api/v1/studio/sources/manifest.json',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Prepared documents are unavailable');const m=await r.json() as StudioSourceManifest;if(m.schemaVersion!=='studio-prepared-sources/1'||m.datasetVersion!==STUDIO_DATA_VERSION||m.synthetic!==true)throw new Error('Prepared documents do not match the active dataset');return m;}).catch(error=>{promise=undefined;throw error;});}
export function useStudioSources(){
 const [state,setState]=useState<{data:StudioSourceManifest|null;error:string}>({data:null,error:''});
 useEffect(()=>{let active=true;getStudioSources().then(data=>{if(active)setState({data,error:''});},error=>{if(active)setState({data:null,error:String(error)});});return()=>{active=false;};},[]);
 return state;
}
export async function downloadPreparedAsset(url:string,filename:string,expected?:string){
 try{
  const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Source download failed (${r.status})`);
  const bytes=await r.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(expected&&digest!==expected)throw new Error('Downloaded source differs from its registered checksum');
  const blob=new Blob([bytes],{type:r.headers.get('content-type')??'application/octet-stream'}),href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);
  window.dispatchEvent(new CustomEvent('studio-notice',{detail:'Prepared source downloaded · checksum verified'}));return true;
 }catch(error){window.dispatchEvent(new CustomEvent('studio-notice',{detail:error instanceof Error?error.message:'Source download failed'}));return false;}
}

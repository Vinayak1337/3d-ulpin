'use client';
import {useCallback,useEffect,useState,type SetStateAction} from 'react';
import {loadStudioDraft,saveStudioDraft,type StudioDraft} from './workspace-draft';

type Fields=Pick<StudioDraft,'tool'|'points'|'calibration'|'notes'|'status'|'revision'>;
type Local=Fields&{loaded:boolean;dirty:boolean;error:string;unitId:string|null};
const blank=():Local=>({tool:'distance',points:[],calibration:1,notes:'',status:'draft',revision:0,loaded:false,dirty:false,error:'',unitId:null});

/** Floor-local editing buffers survive navigation; explicit Save writes only that floor. */
export function useWorkspaceDraft(buildingId:string,floor:number,sourceHash:string|undefined){
 const [buffers,setBuffers]=useState<Record<string,Local>>({});
 const key=`${buildingId}:F${floor}`,current=buffers[key]??blank();
 const patch=useCallback((update:(old:Local)=>Local)=>setBuffers(all=>({...all,[key]:update(all[key]??blank())})),[key]);
 useEffect(()=>{
  if(!sourceHash||current.loaded)return;
  try{
   const saved=loadStudioDraft(localStorage,buildingId,floor);
   patch(old=>old.loaded?old:saved?{...old,...saved,loaded:true,dirty:false,error:saved.sourceHash===sourceHash?'':'The saved draft uses a different source revision. Its original has been retained.'}:{...old,loaded:true});
  }catch(error){patch(old=>({...old,loaded:true,error:error instanceof Error?error.message:'Stored draft could not be restored.'}));}
 },[buildingId,floor,sourceHash,current.loaded,patch]);
 const set=<K extends keyof Fields>(field:K)=>(value:SetStateAction<Fields[K]>)=>patch(old=>({...old,[field]:typeof value==='function'?(value as (v:Fields[K])=>Fields[K])(old[field]):value,dirty:true,status:'draft'}));
 const save=useCallback((unitId:string,nextStatus:StudioDraft['status'])=>{
  if(!sourceHash||!current.loaded)throw new Error('Wait for the prepared source before saving.');
  if(current.error)throw new Error(current.error);
  const result=saveStudioDraft(localStorage,{schemaVersion:'studio-local-draft/1',buildingId,sourceHash,floor,unitId,tool:current.tool,points:current.points,calibration:current.calibration,notes:current.notes,revision:current.revision,status:nextStatus,updatedAt:new Date().toISOString()});
  patch(old=>({...old,...result,loaded:true,dirty:false,error:''}));return result;
 },[buildingId,floor,sourceHash,current,patch]);
 return {...current,setTool:set('tool'),setPoints:set('points'),setCalibration:set('calibration'),setNotes:set('notes'),save};
}

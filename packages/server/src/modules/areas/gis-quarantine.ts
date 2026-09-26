import {GisGeometryDispositionSchema,GisQuarantineSchema,type GisGeometryDisposition} from '@ulpin/contracts';
export function gisQuarantine(disposition:GisGeometryDisposition|undefined,sourceSha256:string,sourceId?:string,sourceRevision?:number){
  if(!disposition)return undefined;
  const value=GisGeometryDispositionSchema.parse(disposition);
  if(!value.rejected)return undefined;
  const first=value.rejections[0];
  return GisQuarantineSchema.parse({...value,version:'gis-quarantine/1',sourceSha256,sourceId,sourceRevision,complete:false,
    message:`${value.accepted} of ${value.total} source features accepted; ${value.rejected} skipped. ${first.code}: ${first.reason}. Original retained unchanged; no geometry repaired.`});
}

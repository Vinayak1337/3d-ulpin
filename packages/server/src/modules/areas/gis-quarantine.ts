import {GisGeometryDispositionSchema,GisQuarantineSchema,GisSetAsideGeometrySchema,GisSetAsideSchema,
  type GisGeometryDisposition} from '@ulpin/contracts';
export function gisQuarantine(disposition:GisGeometryDisposition|undefined,sourceSha256:string,sourceId?:string,sourceRevision?:number){
  if(!disposition)return undefined;
  const value=GisGeometryDispositionSchema.parse(disposition);
  if(!value.rejected)return undefined;
  const first=value.rejections[0];
  return GisQuarantineSchema.parse({...value,version:'gis-quarantine/1',sourceSha256,sourceId,sourceRevision,complete:false,
    message:`${value.accepted} of ${value.total} source features accepted; ${value.rejected} skipped `
      + `(first reason: ${rejectionWords(first.reason)}); `
      + 'the original is kept unchanged and no geometry was repaired.'});
}

function rejectionWords(reason: string): string {
  const words = reason
    .replace(/Ring Self-intersection/gi, 'an outline ring crosses itself')
    .replace(/Self-intersection/gi, 'an outline crosses itself')
    .replace(/Polygon or MultiPolygon geometry/g, 'an outline or a group of outlines')
    .replace(/Polygon rings/g, 'outline rings')
    .replace(/Line geometry/g, 'the line')
    .replace(/\[([^\]]+)\]/g, ' at coordinates $1')
    .replace(/[.!]+\s*$/, '')
    .replace(/\. /g, '; ');
  return words.charAt(0).toLowerCase() + words.slice(1);
}

/** Counts the normalizer's geometry kind rejections by each feature's GeoJSON kind. A feature without one
 * (an ArcGIS shape) leaves the disposition as the normalizer wrote it. */
export function withSetAside(disposition:GisGeometryDisposition|undefined,kind:string,data:unknown){
  const outline=GisSetAsideSchema.shape.kind.safeParse(kind);
  const rows=(data as {features?:unknown}|null)?.features;
  const kindRejections=disposition?.rejections.filter(row=>row.code==='GEOMETRY_KIND')??[];
  if(!disposition||!outline.success||!Array.isArray(rows)||!kindRejections.length)return disposition;
  const counts:Partial<Record<string,number>>={};
  for(const rejection of kindRejections){
    const geometry=(rows[rejection.featureIndex] as {geometry?:{type?:unknown}}|undefined)?.geometry;
    const type=GisSetAsideGeometrySchema.safeParse(geometry?.type);
    if(!type.success)return disposition;
    counts[type.data]=(counts[type.data]??0)+1;
  }
  return {...disposition,setAside:GisSetAsideSchema.parse({kind:outline.data,counts})};
}

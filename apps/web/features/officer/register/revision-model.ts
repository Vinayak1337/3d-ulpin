import type {PhysicalFeature} from '@ulpin/contracts';
export type FeatureRevision={revision:number;createdAt:string;areaRevision:number;packageId:string;body:PhysicalFeature};
export interface FeatureRevisionResponse{featureId:string;currentRevision:number;revisions:FeatureRevision[];nextBefore:number|null;scope:string}
const stable=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(stable(v)??'null')])):Array.isArray(value)?value.map(v=>JSON.parse(stable(v)??'null')):value);
export function revisionChanges(before:PhysicalFeature,after:PhysicalFeature){
 if(before.id!==after.id)throw new Error('Cannot compare revisions of different physical identities');
 const fields=['name','kind','geometryRole','worldStatus','height','areaM2','geometry','geographicGeometry','sourceRevisionId','evidence','properties'] as const;
 return fields.filter(key=>stable(before[key])!==stable(after[key])).map(key=>({field:key,before:before[key],after:after[key]}));
}

import type {DatasetMlSource} from '@/lib/dataset-ml';
export type SourcePurpose='building'|'floor-plan'|'document'|'unknown';
/** Filename suggestions only; the operator can override the extraction task. */
export function sourcePurpose(source:DatasetMlSource):SourcePurpose{
 if(/floor[\s_-]*plan|plan[\s_-]*floor|(?:^|\/)plans\//i.test(source.name))return 'floor-plan';
 if(/orthomosaic|orthophoto|aerial|satellite|drone/i.test(source.name))return 'building';
 if(/report|schedule|(?:^|\/)records\//i.test(source.name))return 'document';
 return 'unknown';
}
export function sourceTitle(name:string){
 const match=name.match(/(?:^|\/)(B\d+)-level-(-?\d+)\.pdf$/i);
 return match?`${match[1]} · ${Number(match[2])<0?`Basement ${Math.abs(Number(match[2]))}`:`Floor ${match[2]}`}`:name.split('/').pop()??name;
}
export const extractionLabel=(task:'building'|'floor-plan')=>task==='building'?'Buildings':'Rooms';
export type ExtractionChoice={sourceId:string;task:'building'|'floor-plan'|'';page:number};
export function readyToExtract(items:ExtractionChoice[],sources?:DatasetMlSource[]):items is (ExtractionChoice&{task:'building'|'floor-plan'})[]{
 return items.length>0&&items.length<=12&&items.every(item=>(item.task==='building'||item.task==='floor-plan')&&Number.isInteger(item.page)&&item.page>=1&&item.page<=500&&(!sources||sources.some(source=>source.id===item.sourceId&&(source.mimeType==='application/pdf'?typeof source.pageCount==='number'&&item.page<=source.pageCount:item.page===1))));
}

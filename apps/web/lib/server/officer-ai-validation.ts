import { createHash, randomUUID } from 'node:crypto';
import type { AreaGeometry, CanonicalFactProperty, WorldStatus } from '@ulpin/contracts';
import type { OfficerAiCandidate, OfficerAiSuggestion } from '../officer-ai-types';

export const PROMPT_VERSION = 'officer-grounded-extraction/3';
export const SCHEMA_VERSION = 'officer-ai-grounded-suggestions/3';
const SOURCE_ROLES = ['floor_plan','section','level_schedule','survey','reference','unknown'] as const;
export const AI_PROPERTIES: CanonicalFactProperty[] = ['building.floorCount', 'building.exteriorHeight', 'space.lower', 'space.upper', 'space.label', 'space.levelLabel', 'source.date', 'source.status', 'outline.role','space.geometry','outline.geometry'];
export interface AiPart { id: string; sourceRevisionId: string; locator: string; text: string; entityIds: string[]; imageRegion?: {x:number;y:number;width:number;height:number}; derivativeSha256?: string }
export const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function redactPrivateText(text: string) {
  return text.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[redacted identifier]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/(?:\+91[ -]?)?\b[6-9]\d{9}\b/g, '[redacted phone]')
    .replace(/^(.*\b(?:owner(?:'s)?\s*name|father(?:'s)?\s*name|aadh?aar|mobile|phone|email)\s*[:=]).*$/gim, '$1 [redacted personal field]');
}
export function isFreeModel(model: any): boolean {
  const pricing = model?.pricing;
  const zero=(v:unknown)=>(typeof v==='number'||typeof v==='string') && String(v).trim()!=='' && Number.isFinite(Number(v)) && Number(v)===0;
  return !!pricing && ['prompt', 'completion'].every(k => zero(pricing[k])) && Object.values(pricing).every(zero);
}
export function chooseFreeModel(models: any[], requested?: string) {
  const eligible = models.filter(m => typeof m.id==='string' && isFreeModel(m) && (m.supported_parameters ?? []).includes('response_format') && (m.supported_parameters ?? []).includes('structured_outputs'));
  const model = requested ? eligible.find(m => m.id === requested) : eligible.find(m => m.id === 'stepfun/step-3.7-flash:free') ?? eligible.find(m => m.architecture?.input_modalities?.includes('image')) ?? eligible[0];
  if (!model) throw new Error('No authenticated zero-price route with structured response support is available. No paid fallback was attempted.');
  return model;
}
const pointSchema={type:'array',items:{type:'number'},minItems:2,maxItems:2};
const ringSchema={type:'array',items:pointSchema,minItems:4,maxItems:500};
const polygonSchema={type:'array',items:ringSchema,minItems:1,maxItems:30};
export const extractionSchema = {
  type: 'object', additionalProperties: false, required: ['candidates', 'questions'], properties: {
    candidates: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, required: ['entityId','subject','property','value','citations','rationale'], properties: {
      entityId: { type: 'string' }, subject: { type: 'string', maxLength: 120 }, property: { type: 'string', enum: AI_PROPERTIES },
      value: { anyOf: [{type:'number'}, {type:'string',maxLength:200},{type:'object',additionalProperties:false,required:['type','coordinates'],properties:{type:{type:'string',enum:['Polygon']},coordinates:polygonSchema}},{type:'object',additionalProperties:false,required:['type','coordinates'],properties:{type:{type:'string',enum:['MultiPolygon']},coordinates:{type:'array',items:polygonSchema,minItems:1,maxItems:30}}}] }, unit: { type:'string', enum:['m','ft','mm','count'] }, referenceFrameId: {type:'string'},
      citations: { type:'array', minItems:1, maxItems:8, items:{type:'object',additionalProperties:false,required:['partId','quote'],properties:{partId:{type:'string'},quote:{type:'string',minLength:1,maxLength:1000}}}}, rationale:{type:'string',maxLength:500}
    } } }, questions: {type:'array', maxItems:20, items:{type:'string',maxLength:500}},
    suggestions: {type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['kind','partId','quote','rationale'],properties:{kind:{type:'string',enum:['source_role','entity_association']},partId:{type:'string'},role:{type:'string',enum:SOURCE_ROLES},entityId:{type:'string'},matchedIdentifier:{type:'string',maxLength:200},quote:{type:'string',minLength:1,maxLength:1000},rationale:{type:'string',minLength:1,maxLength:500}}}}
  }
};
export function boundedPolygon(value:unknown):value is Extract<AreaGeometry,{type:'Polygon'|'MultiPolygon'}> {
  const g=value as any;
  if(!g||!['Polygon','MultiPolygon'].includes(g.type)||!Array.isArray(g.coordinates)||Object.keys(g).some(k=>!['type','coordinates'].includes(k)))return false;
  const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  let count=0;const points:number[][]=[];
  if(!polygons.length||polygons.length>30)return false;
  for(const poly of polygons){
    if(!Array.isArray(poly)||!poly.length||poly.length>30)return false;
    for(const ring of poly){
      if(!Array.isArray(ring)||ring.length<4)return false;
      for(const p of ring){if(!Array.isArray(p)||p.length!==2||!p.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e7)||++count>500)return false;points.push(p);}
      if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])return false;
      const signed=ring.slice(1).reduce((a:number,p:number[],i:number)=>a+ring[i][0]*p[1]-p[0]*ring[i][1],0);
      if(Math.abs(signed)<1e-8)return false;
    }
  }
  return Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))<50000&&Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))<50000;
}
function explicitWkt(text:string):unknown[] {
  const found:unknown[]=[];
  for(const match of text.matchAll(/\b(MULTIPOLYGON|POLYGON)\s*(\()/gi)) {
    let end=(match.index??0)+match[0].length-1,depth=0,start=end;
    do{if(text[end]==='(')depth++;if(text[end]===')')depth--;end++;}while(depth&&end<text.length&&end-start<15000);
    if(depth)continue;
    const original=text.slice(start,end),tokens=original.match(/[(),]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g)??[];
    if(tokens.join('')!==original.replace(/\s/g,''))continue;
    let index=0;
    const group=():any[]=>{if(tokens[index++]!=='(')throw Error();const out:any[]=[];while(tokens[index]!==')'){
      if(tokens[index]==='(')out.push(group());else{const x=Number(tokens[index++]),y=Number(tokens[index++]);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error();out.push([x,y]);}
      if(tokens[index]===',')index++;else if(tokens[index]!==')')throw Error();
      if(index>tokens.length)throw Error();
    }index++;return out;};
    try{const geometry={type:match[1].toUpperCase()==='POLYGON'?'Polygon':'MultiPolygon',coordinates:group()};if(index===tokens.length&&boundedPolygon(geometry))found.push(geometry);}catch{}
  }
  return found;
}
function explicitJsonGeometry(text:string):unknown[] {
  const out:unknown[]=[];let attempts=0;
  for(let start=text.indexOf('{');start>=0&&attempts++<32;start=text.indexOf('{',start+1)){
    let depth=0,inString=false,escaped=false;
    for(let end=start;end<Math.min(text.length,start+15000);end++){
      const c=text[end];if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{const v=JSON.parse(text.slice(start,end+1));if(boundedPolygon(v))out.push(v);}catch{}break;}
    }
  }
  return out;
}
export function validateExtraction(raw: unknown, parts: AiPart[], entities: {id:string;worldStatus:WorldStatus;identifiers?:string[]}[], allowedFrames: string[], geometryFrames:string[]=[]) {
  const candidates: OfficerAiCandidate[] = [], errors: string[] = [];
  const suggestions: OfficerAiSuggestion[] = [];
  const output = raw as any;
  if (!output || !Array.isArray(output.candidates) || !Array.isArray(output.questions) || (output.suggestions!==undefined&&!Array.isArray(output.suggestions)) || Object.keys(output).some(k => !['candidates','questions','suggestions'].includes(k)))
    return { candidates, suggestions, questions: [] as string[], errors: ['Output must be the extraction schema object.'] };
  if (output.candidates.length > 40 || output.questions.length > 20 || (output.suggestions?.length??0)>20) return {candidates,suggestions,questions:[] as string[],errors:['Output exceeds the candidate/question/suggestion budget.']};
  for(const [index,s] of (output.suggestions??[]).entries()) {
    const reject=(message:string)=>errors.push(`Suggestion ${index+1}: ${message}`);
    const p=parts.find(part=>part.id===s?.partId);
    if(!p||!['source_role','entity_association'].includes(s.kind)||Object.keys(s).some(k=>!['kind','partId','role','entityId','matchedIdentifier','quote','rationale'].includes(k))||typeof s.quote!=='string'||!s.quote.trim()||s.quote.length>1000||s.quote.includes('[redacted')||(!p.imageRegion&&!p.text.includes(s.quote))||typeof s.rationale!=='string'||!s.rationale.trim()||s.rationale.length>500){reject('requires a bounded exact quotation from a selected source part and an explicit rationale.');continue;}
    if(s.kind==='source_role'&&(!SOURCE_ROLES.includes(s.role)||s.entityId!==undefined||s.matchedIdentifier!==undefined)){reject('unknown source role or unexpected association fields.');continue;}
    if(s.kind==='entity_association'){
      const entity=entities.find(e=>e.id===s.entityId);
      if(!entity||s.role!==undefined||typeof s.matchedIdentifier!=='string'||!entity.identifiers?.includes(s.matchedIdentifier)||!s.quote.includes(s.matchedIdentifier)){reject('association requires an authorized entity identifier explicitly present in the cited source.');continue;}
    }
    suggestions.push({id:randomUUID(),kind:s.kind,partId:p.id,sourceRevisionId:p.sourceRevisionId,locator:p.locator,...(s.kind==='source_role'?{role:s.role}:{entityId:s.entityId,matchedIdentifier:s.matchedIdentifier}),quote:s.quote,rationale:(p.imageRegion?'Unverified image transcription; inspect the crop. ':'')+s.rationale,evidenceState:'unresolved',...(p.imageRegion?{imageRegion:p.imageRegion}:{})});
  }
  for (const [index, value] of output.candidates.entries()) {
    const reject = (reason: string) => errors.push(`Candidate ${index + 1}: ${reason}`);
    const entity = entities.find(e => e.id === value?.entityId);
    if (!entity || !AI_PROPERTIES.includes(value?.property) || !value.subject || value.subject.length > 120) { reject('unknown entity, subject or unsupported property; geometry requires native calibration.'); continue; }
    if (Object.keys(value).some(k => !['entityId','subject','property','value','unit','referenceFrameId','citations','rationale'].includes(k))) { reject('unexpected fields'); continue; }
    if (!Array.isArray(value.citations) || !value.citations.length || value.citations.length > 8) { reject('at least one selected source citation is required.'); continue; }
    const cited = value.citations.map((c:any) => ({c, p:parts.find(p => p.id === c?.partId)}));
    if (cited.some(({c,p}:any) => !p || !p.entityIds.includes(entity.id) || typeof c.quote !== 'string' || !c.quote.trim() || c.quote.length > 1000 || (!p.imageRegion && !p.text.includes(c.quote)) || c.quote.includes('[redacted'))) { reject('citations must quote selected, entity-associated source text exactly or identify the selected image crop for unverified transcription.'); continue; }
    const geometric=['space.geometry','outline.geometry'].includes(value.property);
    const numeric = ['building.floorCount','building.exteriorHeight','space.lower','space.upper'].includes(value.property);
    if(geometric) {
      const sourceText=cited.filter(({p}:any)=>!p.imageRegion).map(({c}:any)=>c.quote).join('\n');
      if(value.unit!=='m'||!geometryFrames.includes(value.referenceFrameId)||!sourceText.includes(value.referenceFrameId)||!/(?:\b(?:unit|units)\s*[:=]\s*m\b|"unit"\s*:\s*"m"|\bmetres?\b|\bmeters?\b)/i.test(sourceText)||!boundedPolygon(value.value)) {reject('geometry requires bounded closed 2D polygons, explicit source metres and an authorized horizontal frame. Image pixels must remain uncalibrated; request an evidenced coordinate outline and controls.');continue;}
      const explicit=[...explicitWkt(sourceText),...explicitJsonGeometry(sourceText)];
      if(!explicit.some((g:any)=>g.type===value.value.type&&JSON.stringify(g.coordinates)===JSON.stringify(value.value.coordinates))){reject('proposed geometry differs from explicit quoted source coordinates; inferred or image-traced measurements are unsupported.');continue;}
    } else if (numeric) {
      if (typeof value.value !== 'number' || !Number.isFinite(value.value) || (value.property.startsWith('building.') && value.value < 0)) { reject('invalid numeric value.'); continue; }
      if (value.property === 'building.floorCount' && (!Number.isInteger(value.value) || value.value > 250 || (value.unit && value.unit !== 'count'))) { reject('floor count must be a supported integer.'); continue; }
      if (value.property !== 'building.floorCount' && !['m','ft','mm'].includes(value.unit)) { reject('explicit supported source units are required.'); continue; }
      const text = value.citations.map((c:any)=>c.quote).join(' ');
      const numbers = (text.match(/[-+]?\d+(?:\.\d+)?/g)??[]).map(Number);
      if (!numbers.includes(value.value)) { reject('numeric value does not occur in its quoted source; conversion belongs to deterministic preparation.'); continue; }
      const unitPatterns:Record<string,RegExp> = {m:/\b(?:m|metres?|meters?)\b/i,mm:/\b(?:mm|millimetres?|millimeters?)\b/i,ft:/\b(?:ft|feet|foot)\b/i};
      if (value.property !== 'building.floorCount' && !unitPatterns[value.unit].test(text)) { reject('quoted source does not establish the proposed units.'); continue; }
    } else if (typeof value.value !== 'string' || !value.value.trim() || value.value.length > 200 || !value.citations.some((c:any)=>c.quote.includes(value.value))) { reject('text value must occur in the quoted source.'); continue; }
    if (!geometric && value.referenceFrameId && !allowedFrames.includes(value.referenceFrameId)) { reject('unknown vertical/reference frame.'); continue; }
    candidates.push({id:randomUUID(),entityId:entity.id,subject:value.subject,property:value.property,value:value.value,unit:value.unit,referenceFrameId:value.referenceFrameId,evidence:cited.map(({p}:any)=>({sourceRevisionId:p.sourceRevisionId,partId:p.id,...(p.imageRegion?{region:{...p.imageRegion,unit:'normalized'}}:{})})),evidenceState:'unresolved',worldStatus:entity.worldStatus,method:'ai_extraction',citations:value.citations,rationale:(cited.some(({p}:any)=>p.imageRegion)?'Unverified image transcription; inspect the cited crop. ':'')+String(value.rationale??'').slice(0,400)});
  }
  const questions=output.questions.filter((q:unknown)=>typeof q === 'string' && q.length>0 && q.length<=500);
  if(errors.some(e=>/geometry|outline|pixels/i.test(e)))questions.push('Which source provides the measured outline coordinates in metres and its named plan frame? For an image, supply evidenced control placement and a measured coordinate outline before preparing geometry.');
  return {candidates,suggestions,questions,errors};
}

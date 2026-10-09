import {CANONICAL_TARGETS,canonicalTarget,type CanonicalMappedValue,type CanonicalTarget,
  type MappingPlanV2,type MappingLayoutField} from '@ulpin/contracts';
import {ENUM_TABLES,validateMappingPlanV2,type MappingValidationContext} from './mapping-plan-v2';
import {UNIT_TABLE,UNIT_SUFFIXES} from './unit-table';

export type MappingRow=Readonly<Record<string,unknown>>;
export type MappedCell=CanonicalMappedValue&{sourceField:string;target:CanonicalTarget};
export type MappedRow={row:number;fields:MappedCell[]};
export type MappingExecutionContext=MappingValidationContext&{sourceRef:string;rowOffset?:number;
  /** Provided by the reader, never by the model plan. Coordinates remain in this source reference. */
  sourceCrs?:string;parents?:{field:string;rows:readonly MappingRow[]}[]};
export type MappingExecutionResult={version:'mapping-executor/1';method:string;layoutFingerprint:string;rows:MappedRow[];
  counts:{cells:number;candidate:number;needsInput:number;unknown:number;absent:number;null:number;conflicting:number}};
export function mappedCellCounts(rows:readonly MappedRow[]):MappingExecutionResult['counts']{
  const cells=rows.flatMap(row=>row.fields);
  return {cells:cells.length,candidate:cells.filter(cell=>cell.state==='candidate').length,
    needsInput:cells.filter(cell=>cell.state==='needs_input').length,unknown:cells.filter(cell=>cell.state==='unknown').length,
    absent:cells.filter(cell=>cell.state==='absent').length,null:cells.filter(cell=>cell.state==='null').length,
    conflicting:cells.filter(cell=>cell.state==='conflicting').length};
}
export class MappingPlanValidationError extends Error{
  readonly code='MAPPING_PLAN_INVALID';
  constructor(readonly errors:ReturnType<typeof validateMappingPlanV2>['errors']){super('MappingPlan v2 validation failed.');}
}
const asciiDigits=(text:string)=>text.replace(/[०-९]/gu,char=>String(char.charCodeAt(0)-'०'.charCodeAt(0)));
/** Strict Indian/western grouping, not Number('') and never an arbitrary factor/expression parser. */
export function parseIndianNumber(raw:unknown):number|null{
  if(typeof raw==='number')return Number.isFinite(raw)&&Math.abs(raw)<=Number.MAX_SAFE_INTEGER?raw:null;
  if(typeof raw!=='string')return null;
  const text=asciiDigits(raw.trim());
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?)$/.test(text))return null;
  const value=Number(text.replaceAll(',',''));
  return Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER?value:null;
}
export function parseSourceDate(raw:unknown,kind:'date_dmy'|'date_iso'):string|null{
  if(typeof raw!=='string')return null;
  const text=asciiDigits(raw.trim());
  const match=kind==='date_dmy'?/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text):/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(!match)return null;
  const [year,month,day]=kind==='date_dmy'?[Number(match[3]),Number(match[2]),Number(match[1])]:
    [Number(match[1]),Number(match[2]),Number(match[3])];
  if(year<1||month<1||month>12||day<1||day>31)return null;
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day
    ? `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
}
function quantity(raw:unknown,unit:NonNullable<MappingLayoutField['declaredUnit']>):number|null{
  if(typeof raw==='number')return parseIndianNumber(raw);
  if(typeof raw!=='string')return null;
  const text=asciiDigits(raw.trim()),match=/^([+-]?(?:[\d,]+(?:\.\d+)?|\.\d+))\s*(.*?)$/.exec(text);
  if(!match||match[2]&&!UNIT_SUFFIXES[unit].test(match[2]))return null;
  return parseIndianNumber(match[1]);
}
function sourcePolygon(raw:unknown):raw is Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  const geometry=raw as Record<string,unknown>;
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:
    Object.hasOwn(geometry,'rings')?[geometry.rings]:null;
  return Array.isArray(polygons)&&polygons.length>0&&polygons.every(polygon=>Array.isArray(polygon)&&polygon.length>0
    &&polygon.every(ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(position=>Array.isArray(position)
      &&position.length>=2&&position.length<=3&&position.every(n=>typeof n==='number'&&Number.isFinite(n)))
      &&JSON.stringify(ring[0])===JSON.stringify(ring[ring.length-1])));
}
/** Runs validation itself; accepting a caller's 'validated=true' is not a trust boundary. No persistence. */
export function executeMappingPlanV2(raw:unknown,rows:readonly MappingRow[],context:MappingExecutionContext):MappingExecutionResult{
  const checked=validateMappingPlanV2(raw,context);
  if(!checked.success)throw new MappingPlanValidationError(checked.errors);
  const plan:MappingPlanV2=checked.plan,inventory=new Map(context.fields.map(field=>[field.name,field]));
  const mapped:MappedRow[]=rows.map((row,index)=>({row:(context.rowOffset??0)+index,fields:plan.fields.map(field=>{
    const target=canonicalTarget(field.target),definition=CANONICAL_TARGETS[target],source=inventory.get(field.sourceField)!,op=field.operation;
    const rowIndex=(context.rowOffset??0)+index;
    const cell:MappedCell={sourceField:field.sourceField,target,value:null,state:'candidate',
      citations:[{sourceRef:context.sourceRef,row:rowIndex,column:field.sourceField}],method:plan.method};
    const needs=(code:string):MappedCell=>({...cell,value:null,state:'needs_input',issueCode:code});
    if(!Object.hasOwn(row,field.sourceField)||row[field.sourceField]===undefined)return {...cell,state:'absent'};
    const original=row[field.sourceField];cell.literal=structuredClone(original);
    if(original===null)return {...cell,state:'null'};
    if(target==='unknown')return {...cell,state:'unknown'};
    if(op.kind==='link_parent_key'){
      const parents=context.parents?.filter(parent=>parent.field===op.parentField);
      const matches=parents?.flatMap(parent=>parent.rows).filter(parent=>Object.hasOwn(parent,op.parentField)&&parent[op.parentField]===original)??[];
      if((typeof original!=='string'&&typeof original!=='number')||matches.length!==1)
        return needs(matches.length>1?'MAPPING_PARENT_KEY_AMBIGUOUS':'MAPPING_PARENT_KEY_NOT_FOUND');
      cell.value=original;return cell;
    }
    if(definition.valueKind==='text_literal'||definition.valueKind==='key'){
      if(typeof original!=='string'&&(definition.valueKind!=='key'||typeof original!=='number'||!Number.isSafeInteger(original)))
        return needs('MAPPING_LITERAL_UNPARSEABLE');
      if(typeof original==='string'&&!original.trim())return needs('MAPPING_LITERAL_EMPTY');
      cell.value=original;return cell;
    }
    if(definition.valueKind==='number_unit'){
      const unit=op.kind==='unit_convert'?op.sourceUnit:source.declaredUnit??(definition.unitFamily==='count'?'count':undefined);
      if(!unit)return needs('MAPPING_UNIT_REQUIRED');
      const conversion=UNIT_TABLE[unit];
      if(conversion.family!==definition.unitFamily)return needs('MAPPING_UNIT_FAMILY_MISMATCH');
      if(conversion.factor===null)return needs('MAPPING_REGIONAL_UNIT_NEEDS_INPUT');
      if(op.kind!=='unit_convert'&&conversion.factor!==1)return needs('MAPPING_UNIT_CONVERSION_REQUIRED');
      const parsed=quantity(original,unit);
      if(parsed===null)return needs('MAPPING_NUMBER_UNPARSEABLE');
      const value=parsed*(op.kind==='unit_convert'?conversion.factor:1);
      if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)return needs('MAPPING_NUMBER_OUT_OF_RANGE');
      if(definition.unitFamily==='count'&&(!Number.isInteger(value)||value<0)
        ||definition.unitFamily==='area'&&value<0||target==='building.heightM'&&value<0)return needs('MAPPING_QUANTITY_INVALID');
      cell.value=value;cell.unit=conversion.unit;if(conversion.source)cell.conversionSource=conversion.source;return cell;
    }
    if(definition.valueKind==='date'){
      const kind=op.kind==='parse_literal'&&(op.literalKind==='date_dmy'||op.literalKind==='date_iso')?op.literalKind:'date_iso';
      const value=parseSourceDate(original,kind);
      if(value===null)return needs('MAPPING_DATE_UNPARSEABLE');cell.value=value;return cell;
    }
    if(definition.valueKind==='enum'){
      const table=op.kind==='enum_lookup'?ENUM_TABLES[op.tableId]:Object.values(ENUM_TABLES).find(table=>table.target===target);
      if(typeof original!=='string'||!table)return needs('MAPPING_ENUM_UNRECOGNISED');
      const value=op.kind==='enum_lookup'?original.trim().toLowerCase():original;
      if(!(table.values as readonly string[]).includes(value))return needs('MAPPING_ENUM_UNRECOGNISED');cell.value=value;return cell;
    }
    if(definition.valueKind==='geometry'){
      if(!context.sourceCrs)return needs('MAPPING_CRS_UNVERIFIED');
      if(!sourcePolygon(original))return needs('MAPPING_GEOMETRY_UNPARSEABLE');
      cell.value=structuredClone(original);cell.sourceCrs=context.sourceCrs;return cell; // Source geometry only, never a local-frame scene projection.
    }
    return needs('MAPPING_VALUE_UNSUPPORTED');
  })}));
  // A later row may expose an unprofiled column: retain it with a locator, never silently drop it.
  for(let index=0;index<rows.length;index++)for(const name of Object.keys(rows[index]))if(!inventory.has(name))
    mapped[index].fields.push({sourceField:name,target:'unknown',value:null,state:'needs_input',literal:structuredClone(rows[index][name]),
      citations:[{sourceRef:context.sourceRef,row:mapped[index].row,column:name}],method:plan.method,issueCode:'MAPPING_ROW_SCHEMA_DRIFT'});
  // Cross-field contradictions retain both originals; no automatic schedule repair.
  for(const row of mapped){
    const lower=row.fields.find(field=>field.target==='level.lowerM'),upper=row.fields.find(field=>field.target==='level.upperM');
    if(lower?.state==='candidate'&&upper?.state==='candidate'&&typeof lower.value==='number'&&typeof upper.value==='number'&&lower.value>=upper.value)
      for(const field of [lower,upper]){field.state='conflicting';field.issueCode='MAPPING_LEVEL_BOUNDS_CONFLICT';}
  }
  return {version:'mapping-executor/1',method:plan.method,layoutFingerprint:plan.layoutFingerprint,rows:mapped,counts:mappedCellCounts(mapped)};
}

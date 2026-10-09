import {readFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Papa from 'papaparse';
import {ColumnProfileDocumentSchema,type ColumnProfile,type ColumnProfileDocument,type MappingLayoutField} from '@ulpin/contracts';
import {layoutFingerprint,normalizeMappingHeader} from './mapping-plan-v2';
import {parseIndianNumber,parseSourceDate,type MappingRow} from './mapping-executor';
import {UNIT_SUFFIXES} from './unit-table';

const digits=(text:string)=>text.replace(/[०-९]/gu,c=>String(c.charCodeAt(0)-0x966));
const floor=/^(?:G|GF|UGF|LGF|Stilt|B\d+|Mezz(?:anine)?|Terrace|Ground|First|Second|Third|\d+(?:st|nd|rd|th)?\s*(?:floor|fl))$/i;
const personalHeader=/(?:^|[\s_.-])(?:name|owner|person|applicant|allottee|purchaser|seller|buyer|father|mother|husband|wife|contact|phone|mobile|email|aadhaar|aadhar|pan)(?:$|[\s_.-])|नाम|पिता|मोबाइल|आधार/iu;
// Conservative privacy: arbitrary free-text words are masked, including names in unlabelled columns.
// These are source tokens retained for shape/enum diagnosis, not value-level synonym mappings.
const safeWords=new Set(('email pan aadhaar phone blank absent array object b residential commercial industrial institutional mixed group housing flat apartment common parking unit basement ground upper stilt podium mezzanine terrace room kitchen bedroom bathroom balcony shaft approved sanctioned registered draft expired revoked unknown absent null withheld conflicting sq square m meter meters metre metres ft foot feet yd yds yard yards gaj marla bigha kanal cent guntha count g gf ugf lgf mezz first second third floor fl true false yes no').split(' '));
export function maskColumnSample(raw:unknown,name=''):string{
  if(raw===undefined)return '[absent]';if(raw===null)return '[null]';
  if(typeof raw==='object')return Array.isArray(raw)?'[array]':'[object]';
  let text=String(raw).slice(0,256);if(!text.trim())return '[blank]';
  if(/^\[(?:null|absent|blank|array|object)\]$/.test(text))return text;
  text=text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi,'[PAN:AAAAADDDDA]')
    .replace(/(?<![\d०-९])(?:[\d०-९]{4}[ -]?){2}[\d०-९]{4}(?![\d०-९])/gu,'[Aadhaar:DDDD DDDD DDDD]')
    .replace(/(?<![\d०-९])(?:\+?91[ -]?)?[6-9६-९][\d०-९](?:[ -]?[\d०-९]){8}(?![\d०-९])/gu,'[phone:DDDDDDDDDD]');
  const sensitive=personalHeader.test(name);
  return text.replace(/[\p{L}]+/gu,word=>/^[XxDअ]+$/u.test(word)||!sensitive&&(safeWords.has(word.toLowerCase())
      ||/^(?:m|ft|yd|B)D+$/u.test(word))?word:
    word.replace(/[A-Z]/g,'X').replace(/[a-z]/g,'x').replace(/[^Xx]/gu,'अ'))
    .replace(/[0-9]/g,'D').replace(/[०-९]/gu,'०');
}
type Unit=NonNullable<MappingLayoutField['declaredUnit']>;
function headerUnits(name:string):Unit[]{
  const units=new Set<Unit>();
  // Exact tokens or parenthesised/bracketed tokens only: "Area" and magnitude are never evidence.
  const normalized=name.replace(/[_()[\]]/g,' ').trim();
  const words=normalized.split(/\s+/u);
  for(let start=0;start<words.length;start++)for(let length=1;length<=3;length++){
    const token=words.slice(start,start+length).join(' ');
    for(const [unit,re] of Object.entries(UNIT_SUFFIXES))if(re.test(token))units.add(unit as Unit);
  }
  // A length token inside an area expression is not separate evidence; an independent "ft" is.
  for(const [area,length] of [['ft2','ft'],['m2','m']] as const)if(units.has(area)){
    let remainder=normalized;
    for(let start=words.length-1;start>=0;start--)for(let count=3;count>=1;count--){
      const token=words.slice(start,start+count).join(' ');
      if(UNIT_SUFFIXES[area].test(token))remainder=remainder.replace(token,' ');
    }
    if(!remainder.split(/\s+/u).some(token=>UNIT_SUFFIXES[length].test(token)))units.delete(length);
  }
  return [...units];
}
function suffix(raw:unknown):{unit?:Unit;unrecognised:boolean}{
  if(typeof raw!=='string')return {unrecognised:false};
  const match=/^[+-]?(?:[\d०-९,]+(?:\.[\d०-९]+)?|\.[\d०-९]+)\s*(.*?)$/u.exec(raw.trim());
  if(!match||!match[1])return {unrecognised:false};
  const unit=Object.entries(UNIT_SUFFIXES).find(([,re])=>re.test(match[1]))?.[0] as Unit|undefined;
  return {unit,unrecognised:!unit};
}
export function profileColumns(rows:readonly MappingRow[],fields:readonly Pick<MappingLayoutField,'name'>[],sourceKind:ColumnProfileDocument['sourceKind']):ColumnProfileDocument{
  if(!fields.length||fields.length>256||new Set(fields.map(f=>normalizeMappingHeader(f.name))).size!==fields.length)
    throw new Error('COLUMN_LAYOUT_AMBIGUOUS');
  const columns:ColumnProfile[]=fields.map(({name})=>{
    const values=rows.map(row=>row[name]),present=values.filter(v=>v!==undefined&&v!==null&&!(typeof v==='string'&&!v.trim()));
    const rate=(predicate:(value:unknown)=>boolean)=>present.length?present.filter(predicate).length/present.length:null;
    const evidence=new Set(headerUnits(name));let conflict=false;
    for(const value of present){const observed=suffix(value);if(observed.unit)evidence.add(observed.unit);if(observed.unrecognised)conflict=true;}
    const declaredUnit=!conflict&&evidence.size===1?[...evidence][0]:undefined;
    const dateDmyRate=rate(v=>parseSourceDate(v,'date_dmy')!==null),dateIsoRate=rate(v=>parseSourceDate(v,'date_iso')!==null);
    const types=new Set(present.map(v=>{
      if(Array.isArray(v))return 'array';if(typeof v==='object')return 'object';if(typeof v==='boolean')return 'boolean';
      if(parseSourceDate(v,'date_dmy')||parseSourceDate(v,'date_iso'))return 'date';
      const text=typeof v==='string'?v.trim():v;
      if(typeof text==='string'&&/^(?:true|false)$/i.test(text))return 'boolean';
      if(parseIndianNumber(text)!==null)return 'number';
      if(typeof text==='string'&&suffix(text).unit&&parseIndianNumber(text.replace(/\s*[^\d०-९,.+-]+.*$/u,''))!==null)return 'number';
      return 'text';
    }));
    const inferredType=types.size===0?'unknown':types.size>1?'mixed':[...types][0] as ColumnProfile['inferredType'];
    // Evenly spaced observed cells; no replication/padding and no raw values escape this object.
    const count=Math.min(10,values.length),samples=Array.from({length:count},(_,i)=>values[Math.floor(i*values.length/count)]);
    return {name,inferredType,...(declaredUnit?{declaredUnit}:{}),valueShapes:{dateDmyRate,dateIsoRate,
      lakhGroupingRate:rate(v=>typeof v==='string'&&/^[+-]?\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?(?:\s|$)/.test(digits(v.trim()))),
      devanagariDigitRate:rate(v=>typeof v==='string'&&/[०-९]/u.test(v)),
      khasraLikeRate:rate(v=>typeof v==='string'&&/^\d+\/\d+$/.test(digits(v.trim()))),
      floorLabelRate:rate(v=>typeof v==='string'&&floor.test(digits(v.trim()))),
      nullRate:values.length?values.filter(v=>v===null).length/values.length:null,
      blankRate:values.length?values.filter(v=>typeof v==='string'&&!v.trim()).length/values.length:null,
      absentRate:values.length?values.filter(v=>v===undefined).length/values.length:null,
      distinctRatio:present.length?new Set(present.map(v=>JSON.stringify(v))).size/present.length:null},
      maskedSamples:samples.map(v=>maskColumnSample(v,name))};
  });
  return ColumnProfileDocumentSchema.parse({version:'column-profile/1',sourceKind,columns,
    layoutFingerprint:layoutFingerprint(columns),sampleShortfall:columns.some(c=>c.maskedSamples.length<5)});
}
export type ProfiledInput={profile:ColumnProfileDocument;rows:MappingRow[]};
/** Local reader seam: callers may supply attributes from ANY existing GIS reader. Geometry is never profiled. */
export function profileGisAttributes(rows:MappingRow[],names?:string[]):ProfiledInput{
  const fields=names??[...new Set(rows.flatMap(row=>Object.keys(row)))];
  return {rows,profile:profileColumns(rows,fields.map(name=>({name})),'gis_attributes')};
}
/** Reuse bounded native XLSX/ODS readers, not a spreadsheet evaluator or another format service. */
function workbookRows(path:string,sheet?:string,headerRow?:number):{rows:MappingRow[];names:string[]}{
  if(headerRow!==undefined&&(!Number.isSafeInteger(headerRow)||headerRow<1||headerRow>1048576))throw new Error('COLUMN_HEADER_ROW_INVALID');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../../..');
  const scriptPath = resolve(root, 'scripts/agent/read_workbook_cells.py');
  const servicesGeoPath = resolve(root, 'services/geo');
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [scriptPath, servicesGeoPath, resolve(path)], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if(run.status!==0)throw new Error('COLUMN_NATIVE_READER_UNAVAILABLE');
  const parsed=JSON.parse(run.stdout),parts=parsed.parts as {text:string;locator:{sheet:string;cell:string;cellState:string;ods?:{rowRepeat:number;columnRepeat:number}}}[];
  const selected=sheet??parts[0]?.locator.sheet;
  const cells=new Map<number,Map<number,unknown>>();
  for(const part of parts.filter(p=>p.locator.sheet===selected)){
    if(part.locator.ods&&(part.locator.ods.rowRepeat!==1||part.locator.ods.columnRepeat!==1)){
      // Ignore only empty repeated padding; no invented copies of repeated literal/formula data.
      if(['empty','empty_string','whitespace'].includes(part.locator.cellState))continue;
      throw new Error('COLUMN_ODS_REPEAT_NEEDS_INPUT');
    }
    const match=/^([A-Z]+)(\d+)$/.exec(part.locator.cell);if(!match)throw new Error('COLUMN_CELL_INVALID');
    const column=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1,row=Number(match[2]);
    if(!cells.has(row))cells.set(row,new Map());
    // Formula/error placeholders are never promoted to literal values.
    cells.get(row)!.set(column,part.locator.cellState==='literal'||part.locator.cellState==='whitespace'?part.text:null);
  }
  const ordered=[...cells].filter(([row])=>headerRow===undefined||row>=headerRow).sort(([a],[b])=>a-b);
  if(!ordered.length||headerRow!==undefined&&ordered[0][0]!==headerRow)throw new Error('COLUMN_SHEET_UNAVAILABLE');
  const header=ordered[0][1],namedColumns=[...header].filter(([,value])=>typeof value==='string'&&value.trim());
  if(!namedColumns.length)throw new Error('COLUMN_HEADER_NEEDS_INPUT');
  const width=Math.max(...namedColumns.map(([column])=>column))+1;
  if(ordered.some(([,row])=>[...row].some(([column,value])=>column>=width&&value!==null
    &&!(typeof value==='string'&&!value.trim()))))throw new Error('COLUMN_HEADER_NEEDS_INPUT');
  const names=Array.from({length:width},(_,i)=>header.get(i));
  if(names.some(n=>typeof n!=='string'||!n.trim()))throw new Error('COLUMN_HEADER_NEEDS_INPUT');
  return {names:names as string[],rows:ordered.slice(1).map(([,row])=>Object.fromEntries((names as string[]).map((name,i)=>[name,row.get(i)])))};
}
export function profileColumnFile(path:string,sheet?:string,headerRow?:number):ProfiledInput{
  if(/(?:^|[\\/])\.env(?:\.|$)|(?:key|credential|secret)[^\\/]*$/i.test(path))throw new Error('COLUMN_PATH_FORBIDDEN');
  if(statSync(path).size>20*1024*1024)throw new Error('COLUMN_FILE_LIMIT');
  const bytes=readFileSync(path);
  if(bytes[0]===80&&bytes[1]===75){const table=workbookRows(path,sheet,headerRow);return {rows:table.rows,
    profile:profileColumns(table.rows,table.names.map(name=>({name})),'tabular')};}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
  if(/^\s*\{/.test(text)){
    const layer=JSON.parse(text);
    if(!Array.isArray(layer.features))throw new Error('COLUMN_GIS_ATTRIBUTES_UNAVAILABLE');
    return profileGisAttributes(layer.features.map((feature:Record<string,unknown>)=>feature.attributes??feature.properties??{}),
      layer.fields?.map((f:{name:string})=>f.name));
  }
  const header=Papa.parse<string[]>(text,{preview:1}).data[0]??[];
  const parsed=Papa.parse<Record<string,string>>(text,{header:true,dynamicTyping:false,skipEmptyLines:'greedy'});
  if(parsed.errors.length||header.some(name=>!name.trim()))throw new Error('COLUMN_CSV_INVALID');
  return {rows:parsed.data,profile:profileColumns(parsed.data,header.map(name=>({name})),'tabular')};
}

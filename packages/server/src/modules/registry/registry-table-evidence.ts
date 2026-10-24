import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {RegistryTableRowCitationSchema,type RegistryTableRowCitation} from '@ulpin/contracts';
import {TABULAR_LIMITS,streamingReadMs,type IntakeTableRowLocator,type TableWindowRow} from '@ulpin/contracts/usp';
import {conflict} from '../../infrastructure/errors';
import {readRetainedOriginal,readObjectRange,sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {rowCells} from '../usp/ingestion/intake-evidence';
import {readTableWindowTx,windowRows} from '../usp/ingestion/table-windows';
import {readTabularSource,type TabularTable} from '../usp/ingestion/tabular-source';
import {readTabularWindows,unavailableColumns} from '../usp/ingestion/tabular-stream';
import {registryDocumentSourceAccessTx} from './registry-metadata';

/**
 * AU4-B3: one table row an officer's evidence confirmation accepted for a recorded building, cited beside the
 * native document citations and checked the same way: the retained original is read again at its pins and the row,
 * its key cell, its excerpt and the citation id must be exactly what that read gives. A row of a streamed CSV is
 * read again from its own byte range only; a streamed workbook row proves its sheet's stored bytes unchanged and
 * takes its cells from the stored window. Only originals within the tabular memory bound are read whole.
 * No cell becomes a field.
 */
const EXCERPT_CHARS=2048;
const SLICE_BYTES=1024*1024;
type Evidence=Pick<RegistryTableRowCitation,'row'|'key'|'confirmation'>;
type Target=RegistryTableRowCitation['target'];
type Cell=ReturnType<typeof rowCells>[number];
type Window=NonNullable<IntakeTableRowLocator['window']>;
type Windowed=IntakeTableRowLocator&{window:Window};
type Original={object_key:string;bytes:number|string;inspection?:{manualProfile?:{headers?:string[]}}};
/** The cited row read again: its exact excerpt and the access pin it was read under. */
export type CitedRow={excerpt:string;accessSha256:string};
/** `reads` holds what one write or check call already read, so an original or a sheet range is read once in it. */
export type TableEvidenceDependencies={source?:typeof registryDocumentSourceAccessTx;bytes?:typeof readRetainedOriginal;
  range?:typeof readObjectRange;reads?:Map<string,Promise<unknown>>};

/** A row's text cells, one 'header: value' line each in column order and a marked cell as 'header: unknown', under
 * an optional heading. A row longer than an excerpt keeps its key cell's line alone, so an excerpt is never cut. */
function rowExcerpt(headers:string[],cells:Cell[],columnIndex:number,heading:string[]=[]){
  const lines=cells.flatMap((cell,column)=>cell.state==='unknown'?[`${headers[column]}: unknown`]
    :cell.state==='literal'&&typeof cell.value==='string'&&cell.value?[`${headers[column]}: ${cell.value}`]:[]);
  const whole=[...heading,...lines].join('\n'),key=cells[columnIndex];
  return whole.length<=EXCERPT_CHARS?whole
    :[...heading,`${headers[columnIndex]}: ${String('value' in key?key.value:'')}`].join('\n');
}
export function tableRowExcerpt(table:TabularTable,index:number,columnIndex:number){
  return rowExcerpt(table.headers,rowCells(table,index),columnIndex);
}
/** The locator in words, as the native reader writes it; a streamed workbook row by its sheet and physical row. */
export function tableRowLocatorWords(row:IntakeTableRowLocator){
  return row.selection.format==='csv'?`CSV logical row ${row.sourceRow}`
    :`Sheet ${row.window?.sheet??row.selection.sheet}, row ${row.window?.physicalRow??row.sourceRow}`;
}
export function tableCitationId(pin:Evidence&{version:RegistryTableRowCitation['version'];target:Target}){
  return fingerprint({version:pin.version,row:pin.row,key:pin.key,confirmation:pin.confirmation,target:pin.target});
}
/** The row's cells, header and key cell must be exactly as the reading hashed them; a marked cell is never a key. */
function assertRowCells(row:IntakeTableRowLocator,headers:string[],cells:Cell[]|undefined){
  const cell=cells?.[row.columnIndex];
  if(!cells||fingerprint(cells)!==row.rowSha256||headers[row.columnIndex]!==row.columnHeader||
    cell?.state!=='literal'||cell.value!==row.cell.value)conflict('The cited row, its key cell or its header changed.');
  return cells;
}
/** The index of the cited row of a whole table read again. */
export function citedRowIndex(table:TabularTable,row:IntakeTableRowLocator){
  const index=table.sourceRows.indexOf(row.sourceRow);
  assertRowCells(row,table.headers,index<0?undefined:rowCells(table,index));
  return index;
}
/** A whole table's cited row from the retained original read again; the accepted reading's fence and result hash
 * must hold. */
export function wholeTableRow(row:IntakeTableRowLocator,bytes:Uint8Array){
  const table=readTabularSource(bytes,row.selection);
  if(fingerprint(table)!==row.rawResultSha256)conflict('The cited table no longer reads as its accepted reading did.');
  return tableRowExcerpt(table,citedRowIndex(table,row),row.columnIndex);
}
/** The record's cells as the stream reader stores them, read by that reader from the record's own bytes placed
 * under its header row; the bytes must come back as exactly one whole record. */
async function streamedCells(headers:string[],bytes:Uint8Array){
  const header=Buffer.from(`${headers.map(name=>`"${name.replaceAll('"','""')}"`).join(',')}\n`);
  const rows:TableWindowRow[]=[];
  await readTabularWindows(Readable.from([header,Buffer.from(bytes)]),async(window,names)=>{
    rows.push(...windowRows(window,names));
  });
  if(rows.length!==1||rows[0].byteStart!==header.length||rows[0].byteEnd!==header.length+bytes.length)
    conflict('The cited byte range is not exactly one record of the table.');
  return rows[0].cells.map((value):Cell=>value===null?{state:'absent'}:{state:'literal',value});
}
/** A streamed CSV row from its exact byte range of the original: the range's SHA-256 must be the one its window
 * stored, and the record read from it must give the hashed cells (a cell past the record's end is absent). */
export async function windowedTableRow(row:Windowed,headers:string[],bytes:Uint8Array){
  if(bytes.length!==row.window.byteEnd-row.window.byteStart||sha256(bytes)!==row.window.sha256)
    conflict('The cited byte range of the original differs from its window.');
  const cells=await streamedCells(headers,bytes);
  return rowExcerpt(headers,assertRowCells(row,headers,cells),row.columnIndex);
}
/** Dependencies whose calls share one record of reads; ones that already hold it are returned as they are. */
export function onceTableReads(dependencies:TableEvidenceDependencies={}):TableEvidenceDependencies{
  return dependencies.reads?dependencies:{...dependencies,reads:new Map()};
}
function once<T>(dependencies:TableEvidenceDependencies,key:string,read:()=>Promise<T>):Promise<T>{
  const reads=dependencies.reads;
  if(!reads)return read();
  if(!reads.has(key))reads.set(key,read());
  return reads.get(key) as Promise<T>;
}
/** [start, end) of the original in range reads of at most 1 MiB, under one deadline that grows with its length as a
 * streamed table's read does; each slice is handed on as it comes. */
async function readSlices(source:Original,start:number,end:number,read:typeof readObjectRange,
  onSlice:(bytes:Uint8Array)=>void){
  const deadline=Date.now()+streamingReadMs(end-start),signal=new AbortController().signal;
  for(let at=start;at<end;at+=SLICE_BYTES)
    onSlice(await read(source.object_key,at,Math.min(end,at+SLICE_BYTES),Number(source.bytes),deadline,signal));
}
/** A streamed CSV row's own byte range, read alone. */
export async function readRowRange(source:Original,window:Window,read:typeof readObjectRange=readObjectRange){
  const slices:Uint8Array[]=[];
  await readSlices(source,window.byteStart,window.byteEnd,read,bytes=>slices.push(bytes));
  return Buffer.concat(slices);
}
/** The sheet's stored bytes in the ZIP are unchanged: range-read and hashed, never kept, once per sheet range in a
 * call however many of its rows are cited. */
async function assertSheetRange(source:Original,window:Window,dependencies:TableEvidenceDependencies){
  const {byteStart,byteEnd}=window;
  const stored=await once(dependencies,`sheet\n${source.object_key}\n${byteStart}\n${byteEnd}`,async()=>{
    const hash=createHash('sha256');
    let length=0;
    await readSlices(source,byteStart,byteEnd,dependencies.range??readObjectRange,bytes=>{
      hash.update(bytes);
      length+=bytes.length;
    });
    return {length,sha256:hash.digest('hex')};
  });
  if(stored.length!==byteEnd-byteStart||stored.sha256!==window.sha256)
    conflict('The cited sheet\'s stored bytes in the original differ from its window.');
}
/** A streamed workbook row's cells as the stored window holds them, read back with its integrity check; the record
 * must sit at its physical row of the cited sheet range and hash to the candidate's row. A marked cell is unknown.
 * Its excerpt names the sheet and the physical row; no sheet XML is parsed again. */
async function storedSheetRowTx(client:PoolClient,row:Windowed,headers:string[]){
  const {window}=row,stored=await readTableWindowTx(client,row.rawJobId,window.index);
  const found=stored?.rows.find(item=>item.record===window.record);
  if(!found||found.sourceRow!==window.physicalRow||found.sheet!==window.sheet||
    found.sheetSha256!==window.sheetSha256||found.byteStart!==window.byteStart||found.byteEnd!==window.byteEnd||
    found.sha256!==window.sha256)conflict('The stored window row of the cited sheet row changed.');
  const unavailable=unavailableColumns(found);
  const cells=found.cells.map((value,column):Cell=>unavailable.has(column)?{state:'unknown'}
    :value===null?{state:'absent'}:{state:'literal',value});
  return rowExcerpt(headers,assertRowCells(row,headers,cells),row.columnIndex,[tableRowLocatorWords(row)]);
}
/** The window the stream stored for this row: same raw job, source revision, fence and window hash. */
async function storedWindowTx(client:PoolClient,row:Windowed){
  const stored=(await client.query(`SELECT fence,window_sha256,byte_start,byte_end FROM usp_table_windows
    WHERE job_id=$1 AND window_index=$2 AND source_id=$3 AND source_revision=$4`,
  [row.rawJobId,row.window.index,row.sourceId,row.sourceRevision])).rows[0];
  if(!stored||Number(stored.fence)!==row.acceptedFence||stored.window_sha256!==row.rawResultSha256||
    row.window.byteStart<Number(stored.byte_start)||row.window.byteEnd>Number(stored.byte_end))
    conflict('The stored window of the cited row changed.');
}
/** A streamed row read again under its stored window: a CSV row from its own byte range alone, a workbook row from
 * the stored window once its sheet's stored bytes are proven unchanged. Returns its exact excerpt. */
export async function streamedRowTx(client:PoolClient,row:Windowed,source:Original,
  dependencies:TableEvidenceDependencies={}){
  await storedWindowTx(client,row);
  const headers:string[]=source.inspection?.manualProfile?.headers??[];
  if(row.window.sheet===undefined)
    return windowedTableRow(row,headers,await readRowRange(source,row.window,dependencies.range));
  await assertSheetRange(source,row.window,dependencies);
  return storedSheetRowTx(client,row,headers);
}
const windowed=(row:IntakeTableRowLocator):row is Windowed=>row.window!==undefined;
/** The cited row read again at every pin from the retained original: a whole table read whole (once per call), a
 * streamed row as streamedRowTx reads it. */
export async function citedRowTx(client:PoolClient,siteId:string,row:IntakeTableRowLocator,
  dependencies:TableEvidenceDependencies={}):Promise<CitedRow>{
  const source=await (dependencies.source??registryDocumentSourceAccessTx)(client,siteId,row.sourceId);
  if(source.case_id!==row.caseId||Number(source.revision)!==row.sourceRevision||source.sha256!==row.sourceSha256)
    conflict('The cited table source is not at the revision and SHA-256 its row names.');
  if(windowed(row))
    return {excerpt:await streamedRowTx(client,row,source,dependencies),accessSha256:source.accessSha256};
  const job=(await client.query('SELECT accepted_fence FROM usp_job_metadata WHERE job_id=$1',[row.rawJobId])).rows[0];
  if(Number(job?.accepted_fence)!==row.acceptedFence)conflict('The accepted reading of the cited table changed.');
  const bytes=await once(dependencies,`whole\n${source.object_key}`,
    ()=>(dependencies.bytes??readRetainedOriginal)(source.object_key,Number(source.bytes),row.sourceSha256,
      TABULAR_LIMITS.bytes));
  if(bytes.length!==Number(source.bytes)||sha256(bytes)!==row.sourceSha256)
    conflict('The retained table original differs from its pins.');
  return {excerpt:wholeTableRow(row,bytes),accessSha256:source.accessSha256};
}
export function tableRowCitation(evidence:Evidence,cited:CitedRow,target:Target,subject:string){
  const base={version:'registry-table-row-citation/1' as const,...evidence,target};
  return RegistryTableRowCitationSchema.parse({...base,id:tableCitationId(base),excerpt:cited.excerpt,
    selection:{subject,accessSha256:cited.accessSha256,selectedAt:new Date().toISOString()},
    associationState:'operator_selected',qualification:'not_assessed'});
}
/** Every table-row citation of a record, each read again; a whole original or a sheet range is read once for all
 * its rows. */
export async function assertRegistryTableCitationsTx(client:PoolClient,siteId:string,pins:RegistryTableRowCitation[],
  dependencies:TableEvidenceDependencies={}){
  const reads=onceTableReads(dependencies);
  for(const pin of pins){
    const cited=await citedRowTx(client,siteId,pin.row,reads);
    if(pin.id!==tableCitationId(pin)||pin.selection.accessSha256!==cited.accessSha256||pin.excerpt!==cited.excerpt)
      conflict('The exact table row, excerpt, confirmation or access pin changed.');
  }
  return pins.map(pin=>({pin}));
}

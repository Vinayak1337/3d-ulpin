import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {RegistryTableRowCitationSchema,type RegistryTableRowCitation} from '@ulpin/contracts';
import type {IntakeTableRowLocator,TableWindowRow} from '@ulpin/contracts/usp';
import {conflict} from '../../infrastructure/errors';
import {readObject,readObjectRange,sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {rowCells} from '../usp/ingestion/intake-evidence';
import {windowRows} from '../usp/ingestion/table-windows';
import {readTabularSource,type TabularTable} from '../usp/ingestion/tabular-source';
import {readTabularWindows} from '../usp/ingestion/tabular-stream';
import {registryDocumentSourceAccessTx} from './registry-metadata';

/**
 * AU4-B3: one table row an officer's evidence confirmation accepted for a recorded building, cited beside the
 * native document citations and checked the same way: the retained original is read again at its pins and the row,
 * its key cell, its excerpt and the citation id must be exactly what that read gives. A row of a streamed table is
 * read again from its own byte range only, never the whole original. No cell becomes a field.
 */
const EXCERPT_CHARS=2048;
type Evidence=Pick<RegistryTableRowCitation,'row'|'key'|'confirmation'>;
type Target=RegistryTableRowCitation['target'];
type Cell=ReturnType<typeof rowCells>[number];
type Window=NonNullable<IntakeTableRowLocator['window']>;
/** The cited row read again: its exact excerpt and the access pin it was read under. */
export type CitedRow={excerpt:string;accessSha256:string};
export type TableEvidenceDependencies={source?:typeof registryDocumentSourceAccessTx;bytes?:typeof readObject;
  range?:typeof readObjectRange};

/** A row's literal text cells, one 'header: value' line each in column order. A row longer than an excerpt keeps
 * its key cell's line alone, so an excerpt is always exact and never cut. */
function rowExcerpt(headers:string[],cells:Cell[],columnIndex:number){
  const lines=cells.flatMap((cell,column)=>
    cell.state==='literal'&&typeof cell.value==='string'&&cell.value?[`${headers[column]}: ${cell.value}`]:[]);
  const whole=lines.join('\n'),key=cells[columnIndex];
  return whole.length<=EXCERPT_CHARS?whole:`${headers[columnIndex]}: ${String('value' in key?key.value:'')}`;
}
export function tableRowExcerpt(table:TabularTable,index:number,columnIndex:number){
  return rowExcerpt(table.headers,rowCells(table,index),columnIndex);
}
/** The locator in words, as the native reader writes it for a CSV. */
export function tableRowLocatorWords(row:IntakeTableRowLocator){
  return row.selection.format==='csv'?`CSV logical row ${row.sourceRow}`
    :`Sheet ${row.selection.sheet}, row ${row.sourceRow}`;
}
export function tableCitationId(pin:Evidence&{version:RegistryTableRowCitation['version'];target:Target}){
  return fingerprint({version:pin.version,row:pin.row,key:pin.key,confirmation:pin.confirmation,target:pin.target});
}
/** The row's cells, header and key cell must be exactly as the reading hashed them. */
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
/** A streamed row from its exact byte range of the original: the range's SHA-256 must be the one its window
 * stored, and the record read from it must give the hashed cells (a cell past the record's end is absent). */
export async function windowedTableRow(row:IntakeTableRowLocator&{window:Window},headers:string[],
  bytes:Uint8Array){
  if(bytes.length!==row.window.byteEnd-row.window.byteStart||sha256(bytes)!==row.window.sha256)
    conflict('The cited byte range of the original differs from its window.');
  const cells=await streamedCells(headers,bytes);
  return rowExcerpt(headers,assertRowCells(row,headers,cells),row.columnIndex);
}
/** The streamed row's own byte range, read alone. */
export function readRowRange(source:{object_key:string;bytes:number|string},window:Window,
  read:typeof readObjectRange=readObjectRange){
  return read(source.object_key,window.byteStart,window.byteEnd,Number(source.bytes),Date.now()+30_000,
    new AbortController().signal);
}
/** The window the stream stored for this row: same raw job, source revision, fence and window hash. */
async function storedWindowTx(client:PoolClient,row:IntakeTableRowLocator&{window:Window}){
  const stored=(await client.query(`SELECT fence,window_sha256,byte_start,byte_end FROM usp_table_windows
    WHERE job_id=$1 AND window_index=$2 AND source_id=$3 AND source_revision=$4`,
  [row.rawJobId,row.window.index,row.sourceId,row.sourceRevision])).rows[0];
  if(!stored||Number(stored.fence)!==row.acceptedFence||stored.window_sha256!==row.rawResultSha256||
    row.window.byteStart<Number(stored.byte_start)||row.window.byteEnd>Number(stored.byte_end))
    conflict('The stored window of the cited row changed.');
}
const windowed=(row:IntakeTableRowLocator):row is IntakeTableRowLocator&{window:Window}=>row.window!==undefined;
/** The cited row read again at every pin from the retained original: a whole table read whole, a streamed row
 * read from its byte range alone. */
export async function citedRowTx(client:PoolClient,siteId:string,row:IntakeTableRowLocator,
  dependencies:TableEvidenceDependencies={}):Promise<CitedRow>{
  const source=await (dependencies.source??registryDocumentSourceAccessTx)(client,siteId,row.sourceId);
  if(source.case_id!==row.caseId||Number(source.revision)!==row.sourceRevision||source.sha256!==row.sourceSha256)
    conflict('The cited table source is not at the revision and SHA-256 its row names.');
  if(windowed(row)){
    await storedWindowTx(client,row);
    const bytes=await readRowRange(source,row.window,dependencies.range);
    const headers:string[]=source.inspection?.manualProfile?.headers??[];
    return {excerpt:await windowedTableRow(row,headers,bytes),accessSha256:source.accessSha256};
  }
  const job=(await client.query('SELECT accepted_fence FROM usp_job_metadata WHERE job_id=$1',[row.rawJobId])).rows[0];
  if(Number(job?.accepted_fence)!==row.acceptedFence)conflict('The accepted reading of the cited table changed.');
  const bytes=await (dependencies.bytes??readObject)(source.object_key);
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
/** Every table-row citation of a record, each read again; a whole original is read once for all its rows. */
export async function assertRegistryTableCitationsTx(client:PoolClient,siteId:string,pins:RegistryTableRowCitation[],
  dependencies:TableEvidenceDependencies={}){
  const bytes=new Map<string,Promise<Uint8Array>>(),read=dependencies.bytes??readObject;
  const once={...dependencies,bytes:(key:string)=>{
    if(!bytes.has(key))bytes.set(key,read(key));
    return bytes.get(key)!;
  }};
  for(const pin of pins){
    const cited=await citedRowTx(client,siteId,pin.row,once);
    if(pin.id!==tableCitationId(pin)||pin.selection.accessSha256!==cited.accessSha256||pin.excerpt!==cited.excerpt)
      conflict('The exact table row, excerpt, confirmation or access pin changed.');
  }
  return pins.map(pin=>({pin}));
}

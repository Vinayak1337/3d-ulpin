import type {PoolClient} from 'pg';
import {RegistryTableRowCitationSchema,type RegistryTableRowCitation} from '@ulpin/contracts';
import type {IntakeTableRowLocator} from '@ulpin/contracts/usp';
import {conflict} from '../../infrastructure/errors';
import {readObject,sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {rowCells} from '../usp/ingestion/intake-evidence';
import {readTabularSource,type TabularTable} from '../usp/ingestion/tabular-source';
import {registryDocumentSourceAccessTx} from './registry-metadata';

/**
 * AU4-B3: one table row an officer's evidence confirmation accepted for a recorded building, cited beside the
 * native document citations and checked the same way: the retained original is read again at its pins and the row,
 * its key cell, its excerpt and the citation id must be exactly what that read gives. No cell becomes a field.
 */
const EXCERPT_CHARS=2048;
type Evidence=Pick<RegistryTableRowCitation,'row'|'key'|'confirmation'>;
type Target=RegistryTableRowCitation['target'];
export type CitedTable={table:TabularTable;accessSha256:string};
export type TableEvidenceDependencies={source?:typeof registryDocumentSourceAccessTx;bytes?:typeof readObject};

/** The row's literal text cells as read, one 'header: value' line each in column order. A row longer than an
 * excerpt keeps its key cell's line alone, so an excerpt is always exact and never cut. */
export function tableRowExcerpt(table:TabularTable,index:number,columnIndex:number){
  const lines=rowCells(table,index).flatMap((cell,column)=>
    cell.state==='literal'&&typeof cell.value==='string'&&cell.value?[`${table.headers[column]}: ${cell.value}`]:[]);
  const whole=lines.join('\n');
  return whole.length<=EXCERPT_CHARS?whole:`${table.headers[columnIndex]}: ${String(table.rows[index][columnIndex])}`;
}
/** The locator in words, as the native reader writes it for a CSV. */
export function tableRowLocatorWords(row:IntakeTableRowLocator){
  return row.selection.format==='csv'?`CSV logical row ${row.sourceRow}`
    :`Sheet ${row.selection.sheet}, row ${row.sourceRow}`;
}
export function tableCitationId(pin:Evidence&{version:RegistryTableRowCitation['version'];target:Target}){
  return fingerprint({version:pin.version,row:pin.row,key:pin.key,confirmation:pin.confirmation,target:pin.target});
}
/** The retained original at the row's pins, read again; the accepted reading's fence and result hash must hold. */
export async function citedTableTx(client:PoolClient,siteId:string,row:IntakeTableRowLocator,
  dependencies:TableEvidenceDependencies={}):Promise<CitedTable>{
  const source=await (dependencies.source??registryDocumentSourceAccessTx)(client,siteId,row.sourceId);
  if(source.case_id!==row.caseId||Number(source.revision)!==row.sourceRevision||source.sha256!==row.sourceSha256)
    conflict('The cited table source is not at the revision and SHA-256 its row names.');
  const job=(await client.query('SELECT accepted_fence FROM usp_job_metadata WHERE job_id=$1',[row.rawJobId])).rows[0];
  if(Number(job?.accepted_fence)!==row.acceptedFence)conflict('The accepted reading of the cited table changed.');
  const bytes=await (dependencies.bytes??readObject)(source.object_key);
  if(bytes.length!==Number(source.bytes)||sha256(bytes)!==row.sourceSha256)
    conflict('The retained table original differs from its pins.');
  const table=readTabularSource(bytes,row.selection);
  if(fingerprint(table)!==row.rawResultSha256)conflict('The cited table no longer reads as its accepted reading did.');
  return {table,accessSha256:source.accessSha256};
}
/** The index of the cited row; its cells, header and key cell must be exactly as the reading hashed them. */
export function citedRowIndex(table:TabularTable,row:IntakeTableRowLocator){
  const index=table.sourceRows.indexOf(row.sourceRow);
  const cells=index<0?undefined:rowCells(table,index),cell=cells?.[row.columnIndex];
  if(!cells||fingerprint(cells)!==row.rowSha256||table.headers[row.columnIndex]!==row.columnHeader||
    cell?.state!=='literal'||cell.value!==row.cell.value)conflict('The cited row, its key cell or its header changed.');
  return index;
}
export function tableRowCitation(evidence:Evidence,cited:CitedTable,target:Target,subject:string){
  const index=citedRowIndex(cited.table,evidence.row);
  const base={version:'registry-table-row-citation/1' as const,...evidence,target};
  return RegistryTableRowCitationSchema.parse({...base,id:tableCitationId(base),
    excerpt:tableRowExcerpt(cited.table,index,evidence.row.columnIndex),
    selection:{subject,accessSha256:cited.accessSha256,selectedAt:new Date().toISOString()},
    associationState:'operator_selected',qualification:'not_assessed'});
}
const readKey=(row:IntakeTableRowLocator)=>fingerprint({sourceId:row.sourceId,sourceRevision:row.sourceRevision,
  sourceSha256:row.sourceSha256,rawJobId:row.rawJobId,acceptedFence:row.acceptedFence,
  rawResultSha256:row.rawResultSha256,selection:row.selection});
/** Every table-row citation of a record, each original read once. */
export async function assertRegistryTableCitationsTx(client:PoolClient,siteId:string,pins:RegistryTableRowCitation[],
  dependencies:TableEvidenceDependencies={}){
  const reads=new Map<string,CitedTable>();
  for(const pin of pins){
    const cited=reads.get(readKey(pin.row))??await citedTableTx(client,siteId,pin.row,dependencies);
    reads.set(readKey(pin.row),cited);
    const index=citedRowIndex(cited.table,pin.row);
    if(pin.id!==tableCitationId(pin)||pin.selection.accessSha256!==cited.accessSha256||
      pin.excerpt!==tableRowExcerpt(cited.table,index,pin.row.columnIndex))
      conflict('The exact table row, excerpt, confirmation or access pin changed.');
  }
  return pins.map(pin=>({pin}));
}

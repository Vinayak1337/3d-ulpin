import type {PoolClient} from 'pg';
import {RegistryRecordEvidenceSchema,type RegistryRecordEvidence} from '../../../../contracts/src/registry-record-evidence';
import {RegistryRecordEvidenceExportRequestSchema,RegistryRecordEvidenceExportMetadataSchema,
  type RegistryRecordEvidenceExportRequest,type RegistryRecordEvidenceExportMetadata} from '../../../../contracts/src/registry-record-evidence-export';
import {SOURCE_FUSION_LIMITS} from '../../../../contracts/src/source-fusion';
import {transaction} from '../../infrastructure/db';
import {AppError} from '../../infrastructure/errors';
import {sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {documentReviewContext,type RegistryDocumentDependencies} from './registry-document-evidence';
import {readRegistryRecordEvidenceTx} from './registry-record-evidence';
import {fusionLive,type FusionBudget} from '../usp/ingestion/source-fusion-authority';

const reserve=8192;
const byteLimit=SOURCE_FUSION_LIMITS.responseBytes-reserve;
const exportLimit=()=>new AppError(413,'REGISTRY_RECORD_EVIDENCE_EXPORT_LIMIT','The complete export exceeds its download byte limit; select a smaller evidence context.');
const budget=():FusionBudget=>({deadlineAt:Date.now()+SOURCE_FUSION_LIMITS.deadlineMs,
  signal:new AbortController().signal,reservedBytes:0});
export type RegistryRecordEvidenceExport={metadata:RegistryRecordEvidenceExportMetadata;body:Buffer};

/** Every data cell contains a JSON string literal, then RFC-style CSV quote escaping.
 * A CSV reader sees a leading double quote, never a formula sigil or a coercible number.
 * JSON.parse(cell) recovers the exact string; entry_json then decodes to the complete entry.
 * This changes only the download representation, not any original/citation value. */
const csvCell=(value:string)=>`"${JSON.stringify(value).replace(/"/g,'""')}"`;
/** Pure synchronous rendering: no new parsing of source semantics or external I/O. */
export function renderRegistryRecordEvidenceExport(raw:RegistryRecordEvidence,format:'text'|'csv',bounds:FusionBudget):RegistryRecordEvidenceExport{
  fusionLive(bounds);const evidence=RegistryRecordEvidenceSchema.parse(raw);
  if(format!=='text'&&format!=='csv')throw new AppError(400,'REGISTRY_RECORD_EVIDENCE_EXPORT_FORMAT','Choose text or csv.');
  const formatting=format==='text'?'readable-json/1':'csv-json-string-cells/1';
  let content:string;
  if(format==='text'){
    // Compact JSON avoids indentation amplification of opaque deeply nested source records.
    content=JSON.stringify({version:'registry-record-evidence-export/1',formatting,evidence})+'\n';
  }else{
    const {citations,...manifest}=evidence;
    const headers=['export_version','formatting','record_id','record_revision','record_body_sha256','site_id',
      'row_type','citation_ordinal','manifest_json','entry_json'];
    const prefix=['registry-record-evidence-export/1',formatting,evidence.recordId,String(evidence.recordRevision),
      evidence.recordBodySha256,evidence.siteId];
    // A mandatory manifest row preserves all top-level qualifications and an honest empty list.
    const rows=[headers.join(','),[...prefix,'manifest','',JSON.stringify({...manifest,citationCount:citations.length}),'[]'].map(csvCell).join(',')];
    let csvBytes=rows.reduce((bytes,row)=>bytes+Buffer.byteLength(row)+2,0);
    if(csvBytes>byteLimit)throw exportLimit();
    for(const [index,entry] of citations.entries()){
      fusionLive(bounds);
      const row=[...prefix,'citation',String(index),'',JSON.stringify(entry)].map(csvCell).join(',');
      csvBytes+=Buffer.byteLength(row)+2;
      if(csvBytes>byteLimit)throw exportLimit();
      rows.push(row);
    }
    content=rows.join('\r\n')+'\r\n';
  }
  fusionLive(bounds);
  const size=Buffer.byteLength(content);
  if(size>byteLimit)throw exportLimit();
  const body=Buffer.from(content,'utf8');
  const metadata=RegistryRecordEvidenceExportMetadataSchema.parse({version:'registry-record-evidence-export/1',format,
    formatting,mediaType:format==='text'?'text/plain; charset=utf-8':'text/csv; charset=utf-8',
    filename:`registry-${evidence.recordId}-revision-${evidence.recordRevision}-citations.${format==='text'?'txt':'csv'}`,
    bytes:body.length,sha256:sha256(body),recordId:evidence.recordId,recordRevision:evidence.recordRevision,
    recordBodySha256:evidence.recordBodySha256,siteId:evidence.siteId});
  fusionLive(bounds);return {metadata,body};
}

export async function readRegistryRecordEvidenceExportTx(client:PoolClient,raw:RegistryRecordEvidenceExportRequest,
  dependencies?:RegistryDocumentDependencies,bounds:FusionBudget=budget()):Promise<RegistryRecordEvidenceExport>{
  const input=RegistryRecordEvidenceExportRequestSchema.parse(raw);fusionLive(bounds);
  const access=fingerprint(documentReviewContext());
  const evidence=await readRegistryRecordEvidenceTx(client,{recordId:input.recordId,revision:input.revision},dependencies,bounds);
  // Canonical source/body/target/site recapture has completed; its locks remain held.
  // Rendering has no awaits or external reads. Recheck live access and bounds afterwards.
  const output=renderRegistryRecordEvidenceExport(evidence,input.format,bounds);
  if(fingerprint(documentReviewContext())!==access)
    throw new AppError(403,'REGISTRY_DOCUMENT_REVIEW_DENIED','The private document access context changed during export rendering.');
  fusionLive(bounds);return output;
}
export function readRegistryRecordEvidenceExport(raw:RegistryRecordEvidenceExportRequest){
  const input=RegistryRecordEvidenceExportRequestSchema.parse(raw),bounds=budget();
  return transaction(client=>readRegistryRecordEvidenceExportTx(client,input,undefined,bounds),
    {deadlineAt:bounds.deadlineAt,signal:bounds.signal});
}
export class RegistryRecordEvidenceExportService{
  read(recordId:string,revision:number,format:'text'|'csv'){return readRegistryRecordEvidenceExport({recordId,revision,format});}
}

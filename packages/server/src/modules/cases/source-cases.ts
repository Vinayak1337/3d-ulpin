import { documentLimitMiB } from "../../shared/document-formats";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "../../infrastructure/db";
import { fingerprint } from "./domain";
import { type DocumentFile } from "../areas/areas";
import {sha256} from '../../infrastructure/storage';
import { AppError, conflict, notFound } from "../../infrastructure/errors";

export const sourceCaseSchema = z.object({requestKey:z.string().uuid(),name:z.string().trim().min(1).max(150)}).strict();
export async function createSourceCase(value: unknown): Promise<{caseId:string}> {
  const input = sourceCaseSchema.parse(value);
  const digest=fingerprint(input), key=`source-case:${input.requestKey}`;
  return transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);
    const prior=(await client.query("SELECT case_id,payload_hash FROM operations WHERE operation_key=$1 AND kind='source-case'",[key])).rows[0];
    if(prior){if(prior.payload_hash!==digest)conflict("This source-case request key has different inputs.");return {caseId:prior.case_id};}
    const caseId=randomUUID();
    await client.query("INSERT INTO cases(id,name,description,frame) VALUES($1,$2,$3,$4)",[caseId,input.name,"Unassigned source receipt. No source placement or vertical benchmark established.",{id:"UNASSIGNED",horizontalUnit:"m",verticalUnit:"m",benchmark:"UNASSIGNED"}]);
    await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'source-case',$3,$4)",[caseId,key,digest,{caseId}]);
    return {caseId};
  });
}
export async function receiveCaseDocument(caseId:string,file:DocumentFile):Promise<{caseId:string;sourceId:string;jobId?:string}> {
  if(!file.bytes.length || file.bytes.length>documentLimitMiB(file.format)*1024*1024)throw new AppError(413,"FILE_SIZE",`Choose a nonempty ${file.format.toUpperCase()} document within its receipt size limit.`);
  const requestKey=z.uuid().parse(file.requestKey);
  // Preserve immutable receipts issued by the earlier synchronous adapter.
  // Historical originals are not relabelled as queued or reprocessed on replay.
  const legacy=await transaction(async client=>{
    const {documentCaseTx}=await import('../usp/ingestion/document-context');await documentCaseTx(client,caseId,true);
    const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='case-document'",[caseId,`case-document:${requestKey}`])).rows[0];
    if(!prior)return null;
    if(prior.payload_hash!==fingerprint([file.name,file.format,sha256(file.bytes)]))conflict('This receipt key names different original bytes.');
    return prior.result as {caseId:string;sourceId:string};
  });
  if(legacy)return legacy;
  const {DocumentIngestionService}=await import('../usp/ingestion/documents');
  const receipt=await new DocumentIngestionService().retain(caseId,{requestKey,mode:'native_only'},file);
  return {caseId:receipt.caseId,sourceId:receipt.sourceId,jobId:receipt.jobId};
}

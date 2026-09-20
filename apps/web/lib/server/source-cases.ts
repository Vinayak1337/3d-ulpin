import { documentLimitMiB } from "../document-formats";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { fingerprint } from "./domain";
import { extractDocument, documentMime, type DocumentFile } from "./areas";
import { putOriginal, sha256 } from "./storage";
import { originalAttempt } from "./original-attempt";
import { AppError, conflict, notFound } from "./errors";

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
export async function receiveCaseDocument(caseId:string,file:DocumentFile):Promise<{caseId:string;sourceId:string}> {
  const requestKey=z.string().uuid().parse(file.requestKey), key=`case-document:${requestKey}`;
  if(!file.bytes.length || file.bytes.length>documentLimitMiB(file.format)*1024*1024)throw new AppError(413,"FILE_SIZE",`Choose a nonempty ${file.format.toUpperCase()} document up to ${documentLimitMiB(file.format)} MiB.`);
  const hash=sha256(file.bytes), digest=fingerprint([file.name,file.format,hash]);
  const prior=(await query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='case-document'",[caseId,key])).rows[0];
  if(prior){if(prior.payload_hash!==digest)conflict("This receipt key names different original bytes.");return prior.result;}
  const extracted=await extractDocument(file),sourceId=randomUUID(),objectKey=`sources/${sourceId}/${hash}`;
  if(!extracted.parts.length)extracted.parts.push({locator:{label:"original file"},text:"No native text extracted. Read the retained original; calibration and geometry need separate review."});
  const referenceParts=extracted.parts.map(part=>({id:randomUUID(),sourceRevisionId:sourceId,locator:part.locator.label,text:part.text,entityIds:[]}));
  return originalAttempt("sources",sourceId,async remember=>{
    remember(objectKey);await putOriginal(objectKey,file.bytes,documentMime[file.format]);
    return transaction(async client=>{
      if(!(await client.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE",[caseId])).rowCount)notFound("Source workspace not found.");
      const replay=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='case-document'",[caseId,key])).rows[0];
      if(replay){if(replay.payload_hash!==digest)conflict("This receipt key names different original bytes.");return replay.result;}
      if((await client.query("SELECT id FROM import_packages WHERE case_id=$1",[caseId])).rowCount)conflict("This workspace now has a package. Refresh and add documents through its retained context.");
      if((await client.query("SELECT case_id FROM registry_case_feature_mappings WHERE case_id=$1",[caseId])).rowCount)throw new AppError(422,"CASE_ASSOCIATION","Use the linked property's source receipt.");
      await client.query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$1,1,$3,$4,$5,$6,$7,$8,'needs_input',$9)",[sourceId,caseId,file.name,`${file.format}-reference-v2`,documentMime[file.format],file.bytes.length,hash,objectKey,{profile:`${file.format}-reference-v2`,status:"needs_input",issues:[],summary:"Original retained. Native text, where available, is reference material; geometry suitability and placement require review.",referenceParts,warnings:extracted.warnings || []}]);
      const result={caseId,sourceId};
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'case-document',$3,$4)",[caseId,key,digest,result]);
      await client.query("UPDATE cases SET updated_at=now() WHERE id=$1",[caseId]);
      return result;
    });
  });
}

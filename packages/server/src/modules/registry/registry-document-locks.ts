import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {RegistryRecord} from '@ulpin/contracts';
import {conflict} from '../../infrastructure/errors';
import {lockSourceCaseDestinationTx} from '../cases/source-case-lock';

/** Lookup identities only; a removed/revoked citation needs no document access. */
export function registryDocumentCases(caseId:string,records:readonly RegistryRecord[],extra:readonly string[]=[]){
  return [...new Set([caseId,...records.flatMap(record=>(record.documentCitations??[]).map(pin=>pin.document.caseId)),...extra]
    .map(value=>z.uuid().parse(value).toLowerCase()))].sort();
}
/** Call before destination rows, document authority rows or recording/receipt locks. */
export async function lockRegistryDocumentCasesTx(client:PoolClient,cases:readonly string[],regions:readonly string[]=[]){
  for(const caseId of cases)await lockSourceCaseDestinationTx(client,caseId);
  // Source-only regions have no job authority to protect their case. Acquire
  // these rows before any destination or recording lock; removal needs only
  // the identity lookup and remains possible if the case is unavailable.
  for(const caseId of regions)await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE',[caseId]);
}
export function registryRegionCases(records:readonly RegistryRecord[],extra:readonly string[]=[]){
  return [...new Set([...records.flatMap(record=>(record.documentCitations??[])
    .filter(pin=>pin.version==='registry-document-region-citation/1').map(pin=>pin.document.caseId)),...extra]
    .map(value=>z.uuid().parse(value).toLowerCase()))].sort();
}
/** Never discover/acquire an additional gate after waiting with destination rows held. */
export function assertRegistryDocumentCases(held:readonly string[],current:readonly string[]){
  if(held.length!==current.length||held.some((value,index)=>value!==current[index]))
    conflict('The registry document case set changed while acquiring locks. Refresh the draft.');
}

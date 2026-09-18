import {coreFail,coreRefKey,type CoreRef,type CoreRevisionRef} from "./scalars";

export interface CoreVersionedRecord {readonly ref:CoreRef;readonly revision:number}
export function indexCoreRecords<T extends CoreVersionedRecord>(records:readonly T[],kind:string):Map<string,T> {
  const result=new Map<string,T>();
  for(const record of records) {
    const key=coreRefKey(record.ref);
    if(result.has(key))coreFail("DUPLICATE_RECORD",`Duplicate ${kind} reference`);
    result.set(key,record);
  }
  return result;
}
export function requireCoreRevision<T extends CoreVersionedRecord>(records:ReadonlyMap<string,T>,link:CoreRevisionRef,kind:string):T {
  const record=records.get(coreRefKey(link.ref));
  if(!record)coreFail("MISSING_REFERENCE",`Missing ${kind} reference`);
  if(record.revision!==link.revision)coreFail("STALE_REFERENCE",`Stale ${kind} reference`);
  return record;
}
export function uniqueCoreKeys(keys:readonly string[],kind:string):void {
  if(new Set(keys).size!==keys.length)coreFail("DUPLICATE_REFERENCE",`Duplicate ${kind} association`);
}

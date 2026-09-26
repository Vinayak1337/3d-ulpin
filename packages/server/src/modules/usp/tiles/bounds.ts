import type {PoolClient,QueryResultRow} from 'pg';
import {PRIVATE_MVT_PROFILE as p} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {AppError} from '../../../infrastructure/errors';

export function assertMvtDeadline(deadline?:number){
  if(deadline!==undefined&&Date.now()>=deadline)throw new AppError(503,'MVT_JOB_TIMEOUT','The bounded tile build deadline expired.');
}
/** Install limits before any authority, advisory or row lock is requested. */
export async function mvtBoundsTx(client:PoolClient,deadline?:number){
  assertMvtDeadline(deadline);
  const remaining=deadline===undefined?p.sqlMs:Math.max(1,deadline-Date.now());
  await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
    [`${Math.min(p.sqlMs,remaining)}ms`,`${Math.min(p.lockMs,remaining)}ms`]);
}
export function mvtTransaction<T>(action:(client:PoolClient)=>Promise<T>,deadline?:number){
  return transaction(async client=>{await mvtBoundsTx(client,deadline);const result=await action(client);assertMvtDeadline(deadline);return result;});
}
export function mvtQuery<T extends QueryResultRow=any>(text:string,values:unknown[]=[],deadline?:number){
  return mvtTransaction(client=>client.query<T>(text,values),deadline);
}

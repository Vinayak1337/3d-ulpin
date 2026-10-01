import { sql } from "./sql-loader";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { migrateRegistry } from "../modules/registry/registry-db";
import { migrateAreas } from "../modules/areas/area-db";
import { migrateOfficer } from "../modules/officer/officer-db";
import { migrateOfficerAi } from "../modules/ai/officer-ai";
import { migrateSpatialMl } from "../modules/spatial/spatial-ml-db";
import { migrateUsp } from "../modules/usp/migrations";
import { settings } from "./config";
import {AppError} from './errors';
export type DbDeadline={deadlineAt:number;signal?:AbortSignal};
export class DbCommitOutcomeUnknown extends AppError {
  constructor(){super(503,'DB_COMMIT_UNKNOWN','Commit was dispatched before cancellation; its outcome requires a fresh authoritative read.');}
}
const globals = globalThis as unknown as { ulpinPool?: Pool };
export function pool(): Pool {
  if (!globals.ulpinPool) {
    const connectionPool = new Pool({
      connectionString: settings.databaseUrl,
      max: 8,
      connectionTimeoutMillis: 5000,
    });
    // pg removes a failed idle connection. Handle its event so a database
    // restart does not terminate the web server or the durable job dispatcher.
    connectionPool.on("error", () => {
      console.warn(
        "An idle database connection closed; the pool will reconnect on the next request.",
      );
    });
    globals.ulpinPool = connectionPool;
  }
  return globals.ulpinPool;
}
/** Closes only a pool created by this process; shutdown never opens a connection. */
export async function closePool(): Promise<void> {
  const connectionPool = globals.ulpinPool;
  globals.ulpinPool = undefined;
  if (connectionPool) await connectionPool.end();
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  deadline?:DbDeadline,
) {
  if(deadline)return transaction(client=>client.query<T>(text,values),deadline);
  return pool().query<T>(text, values);
}
export async function transaction<T>(
  action: (client: PoolClient) => Promise<T>,
  deadline?:DbDeadline,
): Promise<T> {
  if(deadline)return deadlineTransaction(action,deadline);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
/** Opt-in only: exclusive pooled connection, server bounds and active connection
 * destruction on stop/deadline. A cancelled connection is never returned idle.
 * No SQL/action may continue on it, including after a delayed query callback. */
async function deadlineTransaction<T>(action:(client:PoolClient)=>Promise<T>,options:DbDeadline):Promise<T>{
  if(!Number.isFinite(options.deadlineAt))throw new AppError(500,'DB_DEADLINE_CONFIG','A finite absolute database deadline is required.');
  let raw:PoolClient|undefined,released=false,destroyed=false,aborted:unknown,commitSent=false,
    pendingReject:((error:unknown)=>void)|undefined,actionReject:((error:unknown)=>void)|undefined;
  const timeout=()=>new AppError(504,'DB_DEADLINE','The absolute database deadline expired.');
  const destroy=()=>{if(raw&&!released){released=true;destroyed=true;raw.release(true);}};
  const abort=(reason:unknown)=>{
    if(aborted)return;
    aborted=commitSent?new DbCommitOutcomeUnknown():reason;
    destroy();pendingReject?.(aborted);actionReject?.(aborted);
  };
  const check=()=>{
    if(!aborted&&options.signal?.aborted)abort(options.signal.reason??timeout());
    if(!aborted&&Date.now()>=options.deadlineAt)abort(timeout());
    if(aborted)throw aborted;
    if(released)throw new AppError(503,'DB_SCOPE_CLOSED','This bounded database scope is closed.');
  };
  const onAbort=()=>abort(options.signal?.reason??timeout());
  const onClientError=(error:Error)=>abort(['57014','55P03','25P03'].includes((error as {code?:string}).code??'')?
    timeout():new AppError(503,'DB_UNAVAILABLE','The owned database connection became unavailable.'));
  const detachClientError=()=>raw?.removeListener?.('error',onClientError);
  const timer=setTimeout(()=>abort(timeout()),Math.max(0,options.deadlineAt-Date.now()));
  options.signal?.addEventListener('abort',onAbort,{once:true});
  /** Reject only after destroying the actual connection; consume late callbacks.
   * Server statement/lock timeouts also bound backend work if TCP close detection lags. */
  const run=(args:unknown[])=>new Promise<any>((resolve,reject)=>{
    try{check();}catch(error){reject(error);return;}
    const finish=(error:unknown,value?:unknown)=>{
      if(pendingReject!==cancel)return;pendingReject=undefined;
      if(error)reject(error);else resolve(value);
    };
    const cancel=(error:unknown)=>finish(error);
    pendingReject=cancel;
    try{(raw!.query as Function).apply(raw,args).then((value:unknown)=>finish(undefined,value),(error:unknown)=>finish(error));}
    catch(error){finish(error);}
  });
  const guard=async()=>{
    check();
    const remaining=Math.max(1,Math.floor(options.deadlineAt-Date.now()));
    const result=await run(["SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true),clock_timestamp() < $2::timestamptz AS deadline_live",
      [`${remaining}ms`,new Date(options.deadlineAt).toISOString()]]);
    if(result.rows[0]?.deadline_live!==true)abort(timeout());
    check();
  };
  try{
    check();
    raw=await new Promise<PoolClient>((resolve,reject)=>{
      // A late acquisition never starts SQL; release/destroy it immediately.
      // The existing pool's connectionTimeoutMillis also bounds its pending queue.
      pendingReject=reject;
      pool().connect().then(client=>{
        if(aborted){client.release(true);return;}
        pendingReject=undefined;resolve(client);
      },error=>{pendingReject=undefined;reject(error);});
    });
    raw.on?.('error',onClientError);
    check();await run(['BEGIN']);await guard();
    const client=new Proxy(raw,{get(target,key){
      if(key==='query')return async(...args:unknown[])=>{await guard();const value=await run(args);check();return value;};
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const result=await new Promise<T>((resolve,reject)=>{
      actionReject=reject;
      // The owned connection has already been destroyed before abort rejects
      // this scope; a late callback can never issue SQL through the guarded client.
      Promise.resolve().then(()=>{check();return action(client);}).then(value=>{
        actionReject=undefined;resolve(value);
      },error=>{actionReject=undefined;reject(error);});
    });
    await guard();check(); // Includes the boundary after accepted-state/outbox writes.
    commitSent=true;
    try{await run(['COMMIT']);check();}catch{
      // COMMIT can cross durability before a timeout/cancellation/error response.
      // Discard the connection and require a fresh authoritative read; never retry.
      destroy();throw new DbCommitOutcomeUnknown();
    }
    commitSent=false;return result;
  }catch(error){
    if(['57014','55P03'].includes((error as {code?:string})?.code??'')){
      abort(timeout());error=aborted;
    }
    if(raw&&!released){
      // Do not reuse the cancelled deadline for cleanup. ROLLBACK has its own
      // small allowance; destruction ensures no later COMMIT can be issued.
      const rollbackTimer=setTimeout(()=>abort(new AppError(503,'DB_ROLLBACK_TIMEOUT','Bounded rollback timed out.')),2000);
      try{await run(['ROLLBACK']);}catch{destroy();}finally{clearTimeout(rollbackTimer);}
    }
    throw error;
  }finally{
    clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);
    // A checked-out pg client needs an error listener for server idle expiry.
    // Consume late destruction errors until end; clean reuse restores pool handling.
    if(destroyed)raw?.once?.('end',detachClientError);else detachClientError();
    if(raw&&!released){released=true;raw.release();}
  }
}
export async function migrate() {
  await query(sql('core.schema'));
  await migrateRegistry();
  await migrateAreas();
  await migrateOfficer();
  await migrateOfficerAi();
  await migrateSpatialMl();
  await migrateUsp();
}

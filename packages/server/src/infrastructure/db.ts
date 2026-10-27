import { sql } from "./sql-loader";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { setTimeout as delay } from 'node:timers/promises';
import { migrateRegistry } from "../modules/registry/registry-db";
import { migrateAreas } from "../modules/areas/area-db";
import { migrateOfficer } from "../modules/officer/officer-db";
import { migrateOfficerAi } from "../modules/ai/officer-ai";
import { migrateSpatialMl } from "../modules/spatial/spatial-ml-db";
import { migrateUsp } from "../modules/usp/migrations";
import { settings } from "./config";
import {AppError} from './errors';
export type DbDeadline={deadlineAt:number;signal?:AbortSignal};
/** Internal opt-in; omitted mode preserves the connection's transaction defaults. */
export type DbTransactionMode='repeatable_read_only';
function transactionBegin(mode?:DbTransactionMode){
  if(mode===undefined)return 'BEGIN';
  if(mode==='repeatable_read_only')return 'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY';
  throw new AppError(500,'DB_TRANSACTION_MODE','Unsupported internal transaction mode.');
}
export class DbCommitOutcomeUnknown extends AppError {
  constructor(){super(503,'DB_COMMIT_UNKNOWN','Commit was dispatched before cancellation; its outcome requires a fresh authoritative read.');}
}
const globals = globalThis as unknown as { ulpinPool?: Pool };
let dispatcherPoolMax: number | undefined;
/** Explicit dispatcher startup only; every other process retains its existing size and acquisition behavior. */
export function useDispatcherPool(max: number): void {
  if (globals.ulpinPool) throw new Error('Dispatcher pool must be configured before the pool is created.');
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('A positive dispatcher pool size is required.');
  dispatcherPoolMax = max;
}
export function pool(): Pool {
  if (!globals.ulpinPool) {
    const connectionPool = new Pool({
      connectionString: settings.databaseUrl,
      max: dispatcherPoolMax ?? 8,
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
/** Observes only an existing pool; health diagnostics never create one. */
export function poolPressure(): { total: number; idle: number; waiting: number } | null {
  const connectionPool = globals.ulpinPool;
  if (!connectionPool) return null;
  return { total: connectionPool.totalCount, idle: connectionPool.idleCount, waiting: connectionPool.waitingCount };
}
/** Closes only a pool created by this process; shutdown never opens a connection. */
export async function closePool(): Promise<void> {
  const connectionPool = globals.ulpinPool;
  globals.ulpinPool = undefined;
  if (connectionPool) await connectionPool.end();
}
/** Only queue acquisition is retried, never SQL, connection establishment, or an unknown commit outcome. */
async function acquire(deadline?: DbDeadline): Promise<PoolClient> {
  const owner = pool();
  for (;;) {
    if (deadline?.signal?.aborted) throw deadline.signal.reason;
    if (deadline && Date.now() >= deadline.deadlineAt)
      throw new AppError(504, 'DB_DEADLINE', 'The absolute database deadline expired.');
    try { return await owner.connect(); }
    catch (error) {
      if (dispatcherPoolMax === undefined || !(error instanceof Error)
        || error.message !== 'timeout exceeded when trying to connect') throw error;
      // No worker failure or new attempt: work starts only once a connection is acquired.
      await delay(Math.min(2000, deadline ? Math.max(1, deadline.deadlineAt - Date.now()) : 2000));
    }
  }
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  deadline?:DbDeadline,
) {
  if(deadline)return transaction(client=>client.query<T>(text,values),deadline);
  if (dispatcherPoolMax === undefined) return pool().query<T>(text, values);
  const client = await acquire();
  // Preserve pg-pool.query's error listener and discard-on-error behavior after admission.
  return new Promise<QueryResult<T>>((resolve, reject) => {
    let released = false;
    const finish = (error: Error | null, result?: QueryResult<T>) => {
      if (released) return;
      released = true;
      client.removeListener('error', onError);
      client.release(error ?? undefined);
      if (error) reject(error);
      else resolve(result!);
    };
    const onError = (error: Error) => finish(error);
    client.once('error', onError);
    try { client.query<T>(text, values, (error, result) => finish(error, result)); }
    catch (error) { finish(error as Error); }
  });
}
export async function transaction<T>(
  action: (client: PoolClient) => Promise<T>,
  deadline?:DbDeadline,
  mode?:DbTransactionMode,
): Promise<T> {
  const begin=transactionBegin(mode);
  if(deadline)return deadlineTransaction(action,deadline,begin);
  const client = await acquire();
  try {
    await client.query(begin);
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
async function deadlineTransaction<T>(action:(client:PoolClient)=>Promise<T>,options:DbDeadline,
  begin:ReturnType<typeof transactionBegin>):Promise<T>{
  if(!Number.isFinite(options.deadlineAt))throw new AppError(500,'DB_DEADLINE_CONFIG','A finite absolute database deadline is required.');
  let raw:PoolClient|undefined,released=false,destroyed=false,aborted:unknown,commitSent=false,
    pendingReject:((error:unknown)=>void)|undefined,actionReject:((error:unknown)=>void)|undefined;
  const timeout=()=>new AppError(504,'DB_DEADLINE','The absolute database deadline expired.');
  const destroy=()=>{if(raw&&!released){released=true;destroyed=true;raw.release(true);}};
  /** Closing the socket does not stop a busy backend: send the cancel request (process id and secret key, so a
   * recycled process id is never hit) on a one-shot connection of the pool's own settings. A COMMIT is never cancelled. */
  const cancelRunning=()=>{
    const query=(raw as unknown as {activeQuery?:unknown}|undefined)?.activeQuery;
    if(!raw||released||commitSent||!query)return;
    try{
      const owner=pool() as unknown as {Client:new(options:unknown)=>{
        connection?:{on?:(event:string,listener:()=>void)=>void};cancel:(client:unknown,query:unknown)=>void};options:unknown};
      const canceller=new owner.Client(owner.options);
      canceller.connection?.on?.('error',()=>{});
      canceller.cancel(raw,query);
    }catch{/* the destroyed connection and the server-side statement timeout still bound the work */}
  };
  const abort=(reason:unknown)=>{
    if(aborted)return;
    aborted=commitSent?new DbCommitOutcomeUnknown():reason;
    cancelRunning();destroy();pendingReject?.(aborted);actionReject?.(aborted);
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
      acquire(options).then(client=>{
        if(aborted){client.release(true);return;}
        pendingReject=undefined;resolve(client);
      },error=>{pendingReject=undefined;reject(error);});
    });
    raw.on?.('error',onClientError);
    // A guard SELECT is already a transaction query: select the mode in BEGIN.
    check();await run([begin]);await guard();
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

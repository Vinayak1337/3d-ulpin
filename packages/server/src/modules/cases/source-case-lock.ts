import type {PoolClient} from 'pg';
import {z} from 'zod';

/** Shared gate for transactions that lock both a source case and a destination.
 * Acquire before any case/site/area/draft row or caller-specific advisory lock.
 * Reuse the existing registry-import key/function for compatibility; this is
 * per case, not a global recording lock. Lookup identities must be revalidated
 * after row locking before the transaction accesses the case authority. */
export async function lockSourceCaseDestinationTx(client:PoolClient,caseId:string){
  const canonicalId=z.uuid().parse(caseId).toLowerCase();
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`registry-import:${canonicalId}`]);
}

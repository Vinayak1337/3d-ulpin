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

/** Take the jobs.case_id foreign-key lock before any item/job/outbox write, not during a later INSERT.
 * KEY SHARE excludes case FOR UPDATE but lets the cut's readers and non-key case updates keep sharing.
 * If the transaction uses the destination advisory gate, take that gate first to avoid reversing its order. */
export async function lockCaseEnqueueTx(client: PoolClient, caseId: string): Promise<void> {
  await client.query('SELECT id FROM cases WHERE id=$1 FOR KEY SHARE', [caseId]);
}

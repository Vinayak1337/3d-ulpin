import type { PoolClient } from 'pg';
import { IFC_LIMITS, type IFCResult, type IntakeCard } from '@ulpin/contracts/usp';
import type { IntakeSourceRow } from './intake-context';
import { writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';
import { ifcSourceTx, insertIFCJobTx } from './ifc';

/** IFC3. An IFC kept in a batch through /uploads: the native IFC reader takes it without another request. */
export function batchIfc(source: IntakeSourceRow, card?: IntakeCard): boolean {
  return card?.format === 'ifc' && source.profile === 'large-original-v1';
}

/** One item and source revision name one IFC job, so a replayed enrolment finds the job it queued. */
export function intakeIfcJobId(itemId: string, source: IntakeSourceRow): string {
  return stableUuid(`intake-ifc/1:${itemId}:${source.id}:${source.revision}:${source.sha256}`);
}

/**
 * The publishing transaction queues one native IFC reading and the item carries its job while it waits or runs.
 * Above the reader's byte limit nothing is queued: the item rests kept, its words naming the limit.
 */
export async function queueIntakeIfcTx(client: PoolClient, source: IntakeSourceRow): Promise<string | null> {
  const item = (await client.query(`SELECT item_id,case_id,plan_ref FROM usp_intake_items
    WHERE source_id=$1 AND parent_item_id IS NULL FOR UPDATE`, [source.id])).rows[0];
  if (!item) return null;
  const jobId = intakeIfcJobId(item.item_id, source);
  if (item.plan_ref?.ifcJobId === jobId) return jobId;
  if (item.plan_ref) return null;
  if (Number(source.bytes) > IFC_LIMITS.originalBytes) {
    await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'probed', placement: 'not_understood',
      planRef: null, recordsSeen: 0, limitReason: `This IFC has ${Number(source.bytes)} bytes, above the `
        + `${IFC_LIMITS.originalBytes}-byte limit of the IFC reader, so the building, storeys and spaces it states `
        + 'are not read. The original is kept with its SHA-256.' });
    return null;
  }
  const queued = (await client.query("SELECT id FROM jobs WHERE id=$1 AND operation='ifc-native'", [jobId])).rows[0];
  if (!queued) await insertIFCJobTx(client, await ifcSourceTx(client, source.case_id, source.id), jobId);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'reading', placement: 'undecided',
    planRef: { ifcJobId: jobId }, recordsSeen: 0, limitReason: null });
  return jobId;
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Words from the accepted result's summary only; nothing is counted or named that the reading did not state. */
export function intakeIfcReadWords(summary: IFCResult['summary']): string {
  const structure = summary.structure;
  if (!structure) return 'The IFC was read; this reading has no structure scan.';
  if (structure.state === 'not_read') return `The IFC was read, but not the building, storeys and spaces it `
    + `states (${structure.code}): ${structure.reason}`;
  return `The file states ${counted(summary.buildingCount, 'building')}, ${counted(summary.storeyCount, 'storey')} `
    + `and ${counted(summary.spaceCount, 'space')}; they are candidates.`;
}

export type IntakeIfcEnd = { summary: IFCResult['summary'] } | { status: 'failed' | 'stale'; code: string };

function stoppedWords(end: { status: 'failed' | 'stale'; code: string }): string {
  const why = end.status === 'stale' ? 'went out of date: the file, the case or the reader changed' : 'stopped';
  return `The IFC reading ${why} (${end.code}), so the building, storeys and spaces it states are not read. `
    + 'The original is kept with its SHA-256.';
}

/** The ended job's item, if a batch queued it, is read: in words from the result, or the reason it stopped. */
export async function settleIntakeIfcTx(client: PoolClient, caseId: string, jobId: string, end: IntakeIfcEnd) {
  const item = (await client.query(`SELECT item_id FROM usp_intake_items WHERE case_id=$1 AND parent_item_id IS NULL
    AND plan_ref->>'ifcJobId'=$2 FOR UPDATE`, [caseId, jobId])).rows[0];
  if (!item) return;
  const read = 'summary' in end;
  await writeIntakeDraftTx(client, caseId, item.item_id, { state: 'read',
    placement: read ? 'undecided' : 'not_understood', planRef: { ifcJobId: jobId },
    recordsSeen: read ? end.summary.entityCount : 0,
    limitReason: read ? intakeIfcReadWords(end.summary) : stoppedWords(end) });
}

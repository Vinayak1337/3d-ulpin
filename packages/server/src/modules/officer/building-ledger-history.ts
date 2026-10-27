import type { BuildingLedger, RegistryKind } from '@ulpin/contracts';

type ActorReference = { actor?: string | null };
type Receipt = ActorReference & {
  recordRevision?: number;
  action?: string;
  proposal?: ActorReference;
  schedule?: { decision?: ActorReference } | null;
};
type RevisionBody = {
  kind?: RegistryKind | null;
  name?: string | null;
  sourceOnly?: { decision?: ActorReference };
  canonicalConflictDecisions?: Array<ActorReference & { recordRevision?: number }>;
  sourceSpaceCommands?: Array<{ receipt: Receipt }>;
  levelScheduleCommands?: Array<{ receipt: Receipt }>;
};
export type LedgerRegistryRevision = {
  record_id: string;
  revision: number;
  created_at: Date | string;
  body: RevisionBody;
};

/** Carried creation decisions are not the actor of a later identity assignment. */
function registryRevisionActor(body: RevisionBody, revision: number): string | null {
  const actors: Array<string | null | undefined> = [];
  if (revision === 1) actors.push(body.sourceOnly?.decision?.actor);
  for (const decision of body.canonicalConflictDecisions ?? []) {
    if (decision.recordRevision === revision) actors.push(decision.actor);
  }
  for (const { receipt } of body.sourceSpaceCommands ?? []) {
    if (receipt.recordRevision === revision) actors.push(receipt.actor);
  }
  for (const { receipt } of body.levelScheduleCommands ?? []) {
    if (receipt.recordRevision !== revision) continue;
    if (receipt.action === 'propose') actors.push(receipt.proposal?.actor);
    if (receipt.action === 'review') actors.push(receipt.schedule?.decision?.actor);
  }
  const stored = [...new Set(actors.filter((actor): actor is string => typeof actor === 'string' && !!actor))];
  return stored.length === 1 ? stored[0] : null;
}

/** Each entry is named by its own immutable revision body, never by today's record or another event. */
export function ledgerRegistryHistoryEntry(row: LedgerRegistryRevision): BuildingLedger['history']['registry'][number] {
  return {
    recordId: row.record_id,
    revision: row.revision,
    recordedAt: new Date(row.created_at).toISOString(),
    recordKind: row.body.kind ?? null,
    recordName: row.body.name ?? null,
    actor: registryRevisionActor(row.body, row.revision),
  };
}

export const ledgerRegistryHistorySql = `SELECT record_id,revision,created_at,body
  FROM registry_revisions WHERE record_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 201`;

import { openDB, type IDBPDatabase } from 'idb';
import { P3_ALPHABET, normalizeProjectCode, projectCodeForPayload } from '@ulpin/contracts/usp';

/**
 * Workflow state created by using the Studio (GOAL section 7, source 3): reviews, assigned proposed
 * codes and cards. Nothing here is pre-written; every entry comes from an officer action on a record
 * derived from a retained source. Stored in this browser only (IndexedDB) until the identity and
 * packet endpoints are wired for these records (backend cards PACK-01 and the identity routes).
 */
export type WorkflowStatus = 'Draft' | 'Reviewed' | 'Assigned';

export interface WorkflowEvent {
  revision: number;
  kind: 'draft' | 'evidence' | 'recorded';
  title: string;
  at: string;
  by: string;
  hash: string;
  previousHash: string | null;
}

export interface SpaceWorkflow {
  spaceId: string;
  buildingId: string;
  spaceName: string;
  status: WorkflowStatus;
  code: string | null;
  assignedAt: string | null;
  events: WorkflowEvent[];
}

/**
 * Building-level officer actions: candidate decisions on a level review, findings raised from a check,
 * reviewed details recorded for a draft. Each is a hashed entry chained per building.
 */
export interface BuildingAction {
  id: string;
  buildingId: string;
  kind: 'candidate' | 'finding' | 'record';
  subjectId: string;
  value: string;
  title: string;
  at: string;
  by: string;
  hash: string;
  previousHash: string | null;
}

const DB = 'ulpin-studio-workflow';
const STORE = 'spaces';
const ACTIONS = 'actions';
/** No sign-in yet: actions are attributed to the duty officer of this workstation. */
const ACTOR = 'Duty officer';

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  dbPromise ??= openDB(DB, 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore(STORE, { keyPath: 'spaceId' });
        store.createIndex('buildingId', 'buildingId');
        store.createIndex('code', 'code');
      }
      if (oldVersion < 2) database.createObjectStore(ACTIONS, { keyPath: 'id' }).createIndex('buildingId', 'buildingId');
    },
  });
  return dbPromise;
}

export async function listBuildingActions(buildingId: string): Promise<BuildingAction[]> {
  const all = (await (await db()).getAllFromIndex(ACTIONS, 'buildingId', buildingId)) as BuildingAction[];
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

/** Records one action; a later action on the same subject supersedes it (same id). */
export async function recordAction(input: { buildingId: string; kind: BuildingAction['kind']; subjectId: string; value: string; title: string }): Promise<BuildingAction> {
  const previous = (await listBuildingActions(input.buildingId))[0] ?? null;
  const at = new Date().toISOString();
  const previousHash = previous?.hash ?? null;
  const hash = await digest({ ...input, at, by: ACTOR, previousHash });
  const action: BuildingAction = { id: `${input.kind}:${input.subjectId}`, ...input, at, by: ACTOR, hash, previousHash };
  await (await db()).put(ACTIONS, action);
  return action;
}

export async function clearAction(buildingId: string, kind: BuildingAction['kind'], subjectId: string): Promise<void> {
  const database = await db();
  const found = (await database.get(ACTIONS, `${kind}:${subjectId}`)) as BuildingAction | undefined;
  if (found?.buildingId === buildingId) await database.delete(ACTIONS, found.id);
}

export async function getSpaceWorkflow(spaceId: string): Promise<SpaceWorkflow | null> {
  return ((await (await db()).get(STORE, spaceId)) as SpaceWorkflow | undefined) ?? null;
}

/** Every space with a proposed code (the public projection releases them). */
export async function listAssigned(): Promise<SpaceWorkflow[]> {
  return ((await (await db()).getAll(STORE)) as SpaceWorkflow[]).filter((w) => w.code);
}

export async function listBuildingWorkflow(buildingId: string): Promise<SpaceWorkflow[]> {
  return (await (await db()).getAllFromIndex(STORE, 'buildingId', buildingId)) as SpaceWorkflow[];
}

/** Record reviewed details for one space: Draft → Reviewed, a new hashed revision. */
async function recordReview(
  input: { spaceId: string; buildingId: string; spaceName: string; recordRevision: number },
): Promise<SpaceWorkflow> {
  const existing = await getSpaceWorkflow(input.spaceId);
  if (existing && existing.status !== 'Draft') return existing;
  const at = new Date().toISOString();
  const draft = await event(1, 'draft', `r1 Draft from source revision ${input.recordRevision}`, at, null, input);
  const reviewed = await event(2, 'evidence', 'r2 Reviewed details recorded', at, draft.hash, input);
  const workflow: SpaceWorkflow = { ...input, status: 'Reviewed', code: null, assignedAt: null, events: [reviewed, draft] };
  await (await db()).put(STORE, workflow);
  return workflow;
}

/** Assign a proposed 3D ULPIN: a random P3 payload with its check pair (packages/contracts P3/1). */
export async function assignProposedCode(input: string | { spaceId: string; buildingId: string; spaceName: string; recordRevision: number }): Promise<SpaceWorkflow> {
  const spaceId = typeof input === 'string' ? input : input.spaceId;
  let workflow = await getSpaceWorkflow(spaceId);
  // A record that arrives already reviewed has no session history yet: record the review first.
  if (!workflow && typeof input !== 'string') workflow = await recordReview(input);
  if (!workflow || workflow.status !== 'Reviewed') throw new Error('Record reviewed details before assigning a code.');
  const code = projectCodeForPayload(randomPayload());
  const at = new Date().toISOString();
  const previous = workflow.events[0]!;
  const recorded = await event(previous.revision + 1, 'recorded', `r${previous.revision + 1} Proposed code assigned`, at, previous.hash, { ...workflow, code });
  const next: SpaceWorkflow = { ...workflow, status: 'Assigned', code, assignedAt: at, events: [recorded, ...workflow.events] };
  await (await db()).put(STORE, next);
  return next;
}

/** Same-device verification: find the card for a code on this device. */
export async function resolveCode(input: string): Promise<SpaceWorkflow | null> {
  const code = normalizeProjectCode(input);
  if (!code) return null;
  return ((await (await db()).getFromIndex(STORE, 'code', code)) as SpaceWorkflow | undefined) ?? null;
}

/** Recomputes each revision hash from its content and checks every previous-hash link. */
export async function chainState(workflow: SpaceWorkflow): Promise<'consistent' | 'broken'> {
  const ordered = [...workflow.events].sort((a, b) => a.revision - b.revision);
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i]!;
    const expectedPrevious = i === 0 ? null : ordered[i - 1]!.hash;
    if (e.previousHash !== expectedPrevious) return 'broken';
    const recomputed = await digest({ revision: e.revision, kind: e.kind, title: e.title, at: e.at, by: e.by, previousHash: e.previousHash, spaceId: workflow.spaceId, code: e.kind === 'recorded' ? workflow.code : null });
    if (recomputed !== e.hash) return 'broken';
  }
  return 'consistent';
}

export function randomPayload(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => P3_ALPHABET[b % 32]).join('');
}

async function event(revision: number, kind: WorkflowEvent['kind'], title: string, at: string, previousHash: string | null, subject: { spaceId: string; code?: string | null }): Promise<WorkflowEvent> {
  const hash = await digest({ revision, kind, title, at, by: ACTOR, previousHash, spaceId: subject.spaceId, code: kind === 'recorded' ? subject.code ?? null : null });
  return { revision, kind, title, at, by: ACTOR, hash, previousHash };
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const shortHash = (hash: string) => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

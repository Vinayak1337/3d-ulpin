import {
  captureSnapshot, confirmPlan, createPlan, executePlan, previewCard, readCard, readPlanEntries,
} from '../../api/queries';
import { captureBody, type AssignSubject, type SnapshotScope } from './assignment';
import {
  confirmBody, entriesBody, executeBody, firstCard, nextRevision, planBody, planEntry, StepFailure,
  type CardPreview, type CardRequest, type IssueTarget, type PlanEntry,
} from './issue';

/** What the officer typed, as it is sent: the instant of `Valid until` and the reason for the citation. */
export interface Typed { expiresAt: string; inclusionReason: string }

/** What the steps of Prepare answered so far; shown as answered, also when a later step stops. */
export interface Answered {
  entry?: PlanEntry;
  plan?: { planId: string; version: number };
  packet?: { packetId: string; artifact: { sha256: string } };
}

/** The card request whose rows the officer reads, and those rows as the registry answered them. */
export interface Prepared { request: CardRequest; preview: CardPreview }

/** What one dialog session keeps between two runs of Prepare: the snapshot it stored for a record revision. */
export interface PrepareSession { captured: { revision: number; scope: SnapshotScope } | null }

const key = () => crypto.randomUUID();

async function step<T>(name: string, stores: boolean, sent: Promise<T>): Promise<T> {
  try {
    return await sent;
  } catch (error) {
    throw new StepFailure(name, stores, error);
  }
}

async function capturedScope(subject: AssignSubject, session: PrepareSession): Promise<SnapshotScope> {
  if (session.captured?.revision !== subject.revision) {
    const { scope } = await step('the snapshot', true, captureSnapshot(captureBody(subject)));
    session.captured = { revision: subject.revision, scope };
  }
  return session.captured.scope;
}

/**
 * Prepare of a first card: snapshot, entry, plan, confirmation, packet, then the rows of the card. Every step
 * is sent once. It answers the sentence that says why it stopped when the entry cannot be planned.
 */
export async function prepareFirstCard(
  subject: AssignSubject, typed: Typed, session: PrepareSession, report: (answered: Answered) => void,
): Promise<Prepared | string> {
  const scope = await capturedScope(subject, session);
  const read = await step('the entry of the citation', false, readPlanEntries(entriesBody(scope, subject)));
  const planned = planEntry(read.entries);
  if (typeof planned === 'string') return planned;
  report({ entry: planned.entry });
  if (planned.stop) return planned.stop;
  const plan = await step('the plan', true, createPlan(planBody(scope, subject, planned.entry, typed, key())));
  report({ plan });
  const confirmation = confirmPlan(confirmBody(plan, scope, key()));
  const { confirmationId } = await step('the confirmation of the plan', true, confirmation);
  const { packet } = await step('the packet', true, executePlan(executeBody(plan, confirmationId, key())));
  report({ packet });
  const request = firstCard(plan, typed.expiresAt);
  return { request, preview: await step('the rows of the card', false, previewCard(request)) };
}

/** Prepare of a revision: the stored card is read for its plan and snapshot, then the rows. It stores nothing. */
export async function prepareRevision(
  target: Extract<IssueTarget, { mode: 'update' }>, expiresAt: string,
): Promise<Prepared> {
  const { card } = await step('the listed card', false, readCard(target));
  const request = nextRevision(card, expiresAt);
  return { request, preview: await step('the rows of the card', false, previewCard(request)) };
}

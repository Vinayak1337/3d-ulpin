import type { Schemas } from '@ulpin/api-client';
import { INTAKE_EVIDENCE_LIMITS, INTAKE_TARGET_LIMITS } from '@ulpin/contracts/upload-reader-limits';
import type { Package } from '../run/model';
import type { Candidate, EvidencePage, KeyProfile } from './model';

export type ConfirmBody =
  Schemas['POST_ingestion_cases_caseId_intake_evidence_confirmations_Request_application_json'];
export type ConfirmInput = Omit<ConfirmBody, 'requestKey'>;
export type EvidenceConfirmation =
  Schemas['POST_ingestion_cases_caseId_intake_evidence_confirmations_Response_202_application_json'];
export type EvidenceSource = EvidencePage['sources'][number];
type Citations = Extract<ConfirmInput['additions'], { kind: 'citations' }>;
type Decision = Citations['decisions'][number];
type Accept = Extract<Decision, { decision: 'accept' }>;

/** The officer's decision on one candidate, holding the candidate as read so a later page cannot change it. */
export type Choice = { decision: 'accept'; candidate: Candidate } | { decision: 'reject'; candidate: Candidate;
  reason: string };
/** Decisions by candidate id. */
export type Choices = Readonly<Record<string, Choice>>;
/** Excluded files of the key, by item id, each with the officer's reason as typed. */
export type Exclusions = Readonly<Record<string, string>>;
/** A building a confirmation names, with the package the evidence read says proposes it. */
export interface NamedBuilding { targetId: string; packageId: string; locator: string }

export const sourcesOf = (page: EvidencePage, profile: KeyProfile) =>
  page.sources.filter((source) => source.profileId === profile.profileId);

/** Only current retained pins may be named in a confirmation, including an exclusion. */
export function retainedSource(source: EvidenceSource): source is EvidenceSource &
  Pick<ConfirmInput['included'][number], 'sourceId' | 'sourceRevision' | 'sourceSha256' | 'bytes'> {
  return source.source?.state !== 'unavailable' && source.sourceId !== null && source.sourceRevision !== null
    && source.sourceSha256 !== null && source.bytes !== null;
}

/** Only a retained reading that closed can be included; it names the job and result that read it. */
export function closedReading(source: EvidenceSource) {
  return retainedSource(source) && source.coverage?.state === 'closed'
    && source.jobId !== null && source.resultSha256 !== null;
}

/** An exact single match: the only outcome that may become a citation. */
export const singleMatch = (candidate: Candidate) => candidate.outcome === 'matched' && candidate.anchors.length === 1;
/** Several and conflicting candidates are questions: the officer may reject one, never accept it. */
export const question = (candidate: Candidate) =>
  candidate.outcome === 'several' || candidate.outcome === 'conflicting';

/** The candidates of this key the officer can decide on the page as read; a no-match names no building. */
export function decidable(page: EvidencePage, profile: KeyProfile) {
  const retained = new Set(sourcesOf(page, profile).filter(retainedSource).map((source) => source.itemId));
  return page.candidates.filter((candidate) => candidate.key.profileId === profile.profileId
    && retained.has(candidate.evidence.itemId) && (singleMatch(candidate) || question(candidate)));
}

/** The candidates of one file as read under one key; `more` says the read stopped at its bound with more left. */
export interface FileMatches { itemId: string; matches: readonly Candidate[]; more: boolean }
/** The choices after one press, and the words saying what the press left for the next confirmation. */
export interface FileSelection { choices: Choices; words: string | null }

/** The candidates a stored confirmation accepted; "accept every match" does not offer them again. */
export function acceptedIds(confirmation: EvidenceConfirmation): string[] {
  const { additions } = confirmation.input;
  return additions.kind === 'citations'
    ? additions.decisions.flatMap((decision) => decision.decision === 'accept' ? [decision.candidateId] : []) : [];
}

/** The candidates confirmations of this key accepted: those the read lists, and those stored here since it. */
export function confirmedOf(page: EvidencePage, profile: KeyProfile,
  stored: Iterable<EvidenceConfirmation> = []): ReadonlySet<string> {
  const current = [...stored].filter(confirmation => confirmation.input.profileId === profile.profileId
    && confirmation.input.included.every(named => page.sources.some(source => source.itemId === named.itemId
      && source.profileId === profile.profileId && source.jobId === named.jobId
      && source.resultSha256 === named.resultSha256)));
  return new Set([...page.confirmations.filter((confirmation) => confirmation.profileId === profile.profileId
    && !confirmation.superseded)
    .flatMap((confirmation) => confirmation.accepted ?? []), ...current.flatMap(acceptedIds)]);
}

/**
 * "Accept every exact single match of this file": the file's matched candidates as read, in candidate order, up to
 * the decision limit less the decisions already made on other candidates. A match a stored confirmation accepted is
 * not offered again, so the next press continues after it. Other decisions are kept; a question is never selected.
 */
export function acceptFile(choices: Choices, file: FileMatches,
  confirmed: ReadonlySet<string> = new Set()): FileSelection {
  const limit = INTAKE_EVIDENCE_LIMITS.decisions;
  const matches = file.matches
    .filter((candidate) => candidate.evidence.itemId === file.itemId && singleMatch(candidate))
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const own = new Set(matches.map((candidate) => candidate.candidateId));
  const next: Record<string, Choice> = Object.fromEntries(Object.entries(choices)
    .filter(([candidateId, choice]) => !own.has(candidateId) || choice.decision !== 'accept'));
  const others = Object.keys(next).length;
  const offered = matches.filter((candidate) => !confirmed.has(candidate.candidateId));
  const chosen = offered.slice(0, Math.max(0, limit - others));
  for (const candidate of chosen) next[candidate.candidateId] = { decision: 'accept', candidate };
  const total = file.more ? `more than ${matches.length}` : `${matches.length}`;
  const words: string[] = [];
  if (!matches.length && !file.more) words.push('This file has no exact single match under this key.');
  if (offered.length > chosen.length) {
    words.push(`This file has ${total} exact single matches; one confirmation takes ${limit}. Confirm these, then `
      + `accept the next ${limit}.`);
    if (others) {
      words.push(`${others} other ${others === 1 ? 'decision is' : 'decisions are'} already made, so `
        + `${chosen.length} are selected.`);
    }
  }
  const before = matches.length - offered.length;
  if (before) {
    const again = before === 1 ? 'was confirmed already here and is' : 'were confirmed already here and are';
    words.push(offered.length ? `${before} ${again} not offered again.`
      : 'Every exact single match of this file read here was confirmed already.');
  }
  if (file.more) {
    words.push(`Only the first ${INTAKE_EVIDENCE_LIMITS.page * INTAKE_EVIDENCE_LIMITS.decisions} candidates of this `
      + 'file are read; more remain.');
  }
  return { choices: next, words: words.length ? words.join(' ') : null };
}

export function setAccept(choices: Choices, candidate: Candidate, on: boolean): Choices {
  const { [candidate.candidateId]: _, ...rest } = choices;
  return on && singleMatch(candidate) ? { ...rest, [candidate.candidateId]: { decision: 'accept', candidate } } : rest;
}

/** A reason of null withdraws the rejection. Only a question can be rejected here. */
export function setReject(choices: Choices, candidate: Candidate, reason: string | null): Choices {
  const { [candidate.candidateId]: _, ...rest } = choices;
  return reason !== null && question(candidate)
    ? { ...rest, [candidate.candidateId]: { decision: 'reject', candidate, reason } } : rest;
}

/** Reader jobs and review revisions may advance; the selected source row or document part must not change. */
function evidenceIdentity(candidate: Candidate) {
  const evidence = candidate.evidence;
  const source = [evidence.kind, evidence.itemId, evidence.sourceId, evidence.sourceRevision, evidence.sourceSha256];
  if (evidence.kind === 'document_part') {
    return JSON.stringify([...source, evidence.partId, evidence.partSha256, evidence.quote]);
  }
  return JSON.stringify([...source, evidence.selection, evidence.sourceRow, evidence.rowSha256,
    evidence.columnIndex, evidence.cell]);
}

/** Keep only the same evidence and building decision; new matches are never automatically selected. */
export function reconcileChoices(choices: Choices, candidates: readonly Candidate[]) {
  const current = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const next: Record<string, Choice> = {};
  const updated: string[] = [], dropped: string[] = [];
  for (const choice of Object.values(choices)) {
    const before = choice.candidate;
    const candidate = current.get(before.candidateId);
    const sameTargets = candidate && JSON.stringify(candidate.anchors.map(anchor => anchor.targetId).sort())
      === JSON.stringify(before.anchors.map(anchor => anchor.targetId).sort());
    const allowed = candidate && (choice.decision === 'accept' ? singleMatch(candidate) : question(candidate));
    if (!candidate || !allowed || !sameTargets || evidenceIdentity(candidate) !== evidenceIdentity(before)) {
      dropped.push(before.key.literal);
      continue;
    }
    next[candidate.candidateId] = { ...choice, candidate };
    if (candidate.candidateSha256 !== before.candidateSha256) updated.push(candidate.key.literal);
  }
  const words: string[] = [];
  if (updated.length) words.push(`The package review or evidence reading changed for: ${updated.join(', ')}. `
    + 'Your selections remain.');
  if (dropped.length) words.push(`Selections removed: ${dropped.join(', ')}. The candidate disappeared or its `
    + 'evidence, building or outcome changed.');
  return { choices: next as Choices, words: words.join(' ') };
}

const anchorOf = (candidate: Candidate): NamedBuilding[] => candidate.anchors.map((anchor) =>
  ({ targetId: anchor.targetId, packageId: anchor.packageId, locator: anchor.locator }));

/**
 * The buildings the confirmation names: those of the accepted candidates. With nothing accepted, those of the
 * rejected candidates; with nothing decided, those the key's candidates on the page name. Each once, in order.
 */
export function namedBuildings(choices: Choices, pageCandidates: readonly Candidate[]): NamedBuilding[] {
  const decided = Object.values(choices);
  const accepted = decided.filter((choice) => choice.decision === 'accept').map((choice) => choice.candidate);
  const source = accepted.length ? accepted : decided.length ? decided.map((choice) => choice.candidate)
    : pageCandidates;
  const unique = new Map(source.flatMap(anchorOf).map((building) => [building.targetId, building] as const));
  return [...unique.values()];
}

function decisionOf(choice: Choice): Decision {
  const { candidateId, candidateSha256 } = choice.candidate;
  if (choice.decision === 'reject') return { decision: 'reject', candidateId, candidateSha256, reason: choice.reason };
  // The evidence locator exactly as read; the wire type only drops a null selection table on reading.
  return { decision: 'accept', candidateId, candidateSha256, targetId: choice.candidate.anchors[0]!.targetId,
    evidence: choice.candidate.evidence as Accept['evidence'] };
}

export interface ConfirmState {
  profile: KeyProfile; sources: readonly EvidenceSource[]; exclusions: Exclusions; choices: Choices;
  acknowledgement: string; noAdditions: boolean; buildings: readonly NamedBuilding[];
  packages: ReadonlyMap<string, Package>; name: (itemId: string) => string;
}

function sourcePins(state: ConfirmState): Pick<ConfirmInput, 'included' | 'excluded'> | string {
  const included: ConfirmInput['included'] = [], excluded: ConfirmInput['excluded'] = [];
  for (const source of state.sources) {
    if (!retainedSource(source)) {
      return `${state.name(source.itemId)}: this key cannot be confirmed while a source is unavailable.`;
    }
    const pins = { itemId: source.itemId, sourceId: source.sourceId, sourceRevision: source.sourceRevision,
      sourceSha256: source.sourceSha256, bytes: source.bytes };
    const reason = state.exclusions[source.itemId];
    if (reason !== undefined) {
      if (!reason.trim()) return `Give your reason for excluding ${state.name(source.itemId)}.`;
      excluded.push({ ...pins, reason });
    } else if (closedReading(source)) {
      included.push({ ...pins, jobId: source.jobId!, resultSha256: source.resultSha256!, coverage: source.coverage! });
    } else {
      return `${state.name(source.itemId)} can be confirmed when its reading closes. Exclude it with your reason to `
        + 'confirm this key without it.';
    }
  }
  return included.length ? { included, excluded } : 'Include at least one file whose reading closed.';
}

function additionsOf(state: ConfirmState, included: Set<string>): ConfirmInput['additions'] | string {
  const choices = Object.values(state.choices).sort((a, b) =>
    a.candidate.candidateId.localeCompare(b.candidate.candidateId));
  if (!choices.length) {
    return state.noAdditions ? { kind: 'no_additions' }
      : 'Accept or reject a candidate, or confirm that this key adds no citations.';
  }
  if (choices.length > INTAKE_EVIDENCE_LIMITS.decisions) {
    return `One confirmation decides at most ${INTAKE_EVIDENCE_LIMITS.decisions} candidates; `
      + `${choices.length} are decided. Undo some and confirm them next.`;
  }
  for (const choice of choices) {
    if (!included.has(choice.candidate.evidence.itemId)) {
      return `A decision names a candidate of ${state.name(choice.candidate.evidence.itemId)}, which is not `
        + 'included. Undo it or include the file.';
    }
    if (choice.decision === 'accept' && !singleMatch(choice.candidate)) {
      return `${choice.candidate.key.literal} is a question, not an exact single match; it is never accepted.`;
    }
    if (choice.decision === 'reject' && !choice.reason.trim()) return 'Give your reason for each rejected candidate.';
  }
  return { kind: 'citations', decisions: choices.map(decisionOf) };
}

function targetsOf(state: ConfirmState): ConfirmInput['targets'] | string {
  if (!state.buildings.length) return 'No building is named by a candidate of this key on this page yet.';
  if (state.buildings.length > INTAKE_TARGET_LIMITS.confirmationTargets) {
    return `One confirmation names at most ${INTAKE_TARGET_LIMITS.confirmationTargets} buildings; `
      + `${state.buildings.length} are named. Undo some and confirm them next.`;
  }
  const targets: ConfirmInput['targets'] = [];
  for (const building of state.buildings) {
    const pkg = state.packages.get(building.packageId);
    if (!pkg) return `The package of ${building.locator} is not in the targets read. Refresh the batch and try again.`;
    if (pkg.reviewFingerprint === null) {
      return `${building.locator}: its package has no current review, so it cannot be named yet.`;
    }
    // Commit advances the package once; evidence still names the reviewed revision the commit accepted.
    const packageRevision = pkg.state === 'COMMITTED' ? pkg.revision - 1 : pkg.revision;
    targets.push({ targetId: building.targetId, packageId: pkg.packageId, packageRevision,
      reviewFingerprint: pkg.reviewFingerprint });
  }
  return targets;
}

/**
 * The confirmation as the server takes it, without its request key and without the link manifest hash (the server
 * computes it), or the words saying what is still missing.
 */
export function confirmInput(state: ConfirmState): ConfirmInput | string {
  if (!state.acknowledgement.trim()) return 'Type your acknowledgement in your own words.';
  const sources = sourcePins(state);
  if (typeof sources === 'string') return sources;
  const additions = additionsOf(state, new Set(sources.included.map((source) => source.itemId)));
  if (typeof additions === 'string') return additions;
  const targets = targetsOf(state);
  if (typeof targets === 'string') return targets;
  return { acknowledgement: state.acknowledgement, profileId: state.profile.profileId,
    profileSha256: state.profile.profileSha256, ...sources, targets, additions };
}

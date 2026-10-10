import type { GetResponse } from '@ulpin/api-client';
import type { MultiPolygon } from '@ulpin/scene';
import type { StatusWord } from '@ulpin/ui';

type AreaCanonical = GetResponse<'/api/v1/areas/{areaId}/canonical'>;
type BuildingCanonical = GetResponse<'/api/v1/buildings/{buildingId}/canonical'>;

/** One entry of `candidates` in a canonical area or building record, exactly as the API publishes it. */
export type CanonicalCandidate = NonNullable<AreaCanonical['candidates']>[number]
  | NonNullable<BuildingCanonical['candidates']>[number];

export type CandidateKind = 'roofprint' | 'room';
export type CandidateState = 'candidate' | 'reviewed' | 'rejected';

/** A state chip: a fixed status word, or a plain label for a recorded outcome that is not a status word. */
export type StateChip = { kind: 'status'; word: StatusWord } | { kind: 'plain'; label: string };

export interface CandidateDecision {
  outcome: 'accepted' | 'rejected';
  reason: string;
  actor: string;
  time: string;
}

export interface CandidateCitation {
  source: string;
  locator: string;
}

export interface CandidateCard {
  id: string;
  kind: CandidateKind;
  kindLabel: string;
  title: string;
  state: CandidateState;
  chip: StateChip;
  /** The recorded method, for example `model:<id>@<hash>` or `deterministic:vector-plan@1`. */
  method: string;
  modelId: string | null;
  /** Always says whether the score is calibrated; a candidate without a score says so. */
  confidence: string;
  /** Verbatim from the record. */
  limitations: string[];
  citations: CandidateCitation[];
  decision: CandidateDecision | null;
  /** The model inference item of a roofprint (from its output reference). */
  itemId: string | null;
  levelId: string | null;
  levelLiteral: string | null;
  frame: string;
  /** Polygons in the candidate's own frame: area metres for a roofprint, plan metres for a room. */
  polygons: MultiPolygon;
}

const ITEM_REF = /\/spatial-ml\/items\/([0-9a-f-]{36})#/;
const ROOM_FALLBACK = 'Unlabelled region';

export function itemIdOf(outputRef: string | null | undefined): string | null {
  return ITEM_REF.exec(outputRef ?? '')?.[1] ?? null;
}

type Citation = NonNullable<CanonicalCandidate['citations']>[number];

function round(value: number, places = 1): string {
  return value.toFixed(places);
}

/** `p.2 · x 443.8, y 1196.9 · 71.3 × 79.8 pt` for a region, `p.1` for a page; other kinds name their key. */
export function locatorText(locator: Citation['locator']): string {
  switch (locator.kind) {
    case 'page': return `p.${locator.page}`;
    case 'region': {
      const size = `${round(locator.width)} × ${round(locator.height)} ${locator.unit}`;
      return `p.${locator.page} · x ${round(locator.x)}, y ${round(locator.y)} · ${size}`;
    }
    case 'row': return `row ${locator.row}`;
    case 'cell': return `row ${locator.row}, column ${locator.column}`;
    case 'entity': return `entity ${locator.entityId}`;
    case 'feature': return `feature ${locator.featureId}`;
    case 'point': return `point ${locator.pointId}`;
  }
}

/** The recorded score with its calibration. Nothing is called calibrated unless the record says so. */
export function confidenceText(candidate: CanonicalCandidate): string {
  if (typeof candidate.confidence !== 'number') return 'Not scored';
  const score = round(candidate.confidence, 2);
  if (candidate.confidenceCalibration === 'uncalibrated') return `${score} · uncalibrated`;
  return `${score} · calibration not recorded`;
}

export function candidateState(candidate: CanonicalCandidate): CandidateState {
  if (candidate.review?.outcome === 'rejected') return 'rejected';
  return candidate.state === 'reviewed' ? 'reviewed' : 'candidate';
}

/**
 * A candidate waiting for an officer is "Needs review"; "Reviewed" appears only when the record carries an
 * accepted decision, and a rejection is shown as the outcome it is.
 */
export function stateChip(state: CandidateState): StateChip {
  if (state === 'rejected') return { kind: 'plain', label: 'Rejected' };
  return { kind: 'status', word: state === 'reviewed' ? 'Reviewed' : 'Needs review' };
}

function titleOf(candidate: CanonicalCandidate, kind: CandidateKind): string {
  if (kind === 'room') return candidate.labelLiteral ?? ROOM_FALLBACK;
  return `Roofprint ${candidate.candidateId.slice(0, 8)}`;
}

function citationOf(citation: Citation): CandidateCitation {
  return { source: citation.sourceId.slice(0, 8), locator: locatorText(citation.locator) };
}

export function candidateCard(candidate: CanonicalCandidate): CandidateCard | null {
  if (!candidate.kind || !candidate.polygons) return null;
  const state = candidateState(candidate);
  return {
    id: candidate.candidateId,
    kind: candidate.kind,
    kindLabel: candidate.kind === 'room' ? 'Room' : 'Roofprint',
    title: titleOf(candidate, candidate.kind),
    state,
    chip: stateChip(state),
    method: candidate.method ?? 'Not recorded',
    modelId: candidate.modelId ?? null,
    confidence: confidenceText(candidate),
    limitations: candidate.limitations ?? [],
    citations: (candidate.citations ?? []).map(citationOf),
    decision: candidate.review ?? null,
    itemId: itemIdOf(candidate.outputRef),
    levelId: candidate.levelId ?? null,
    levelLiteral: candidate.levelLabelLiteral ?? null,
    frame: candidate.coordinateFrame ?? 'Not recorded',
    polygons: candidate.polygons as MultiPolygon,
  };
}

/** Cards for every drawable candidate of a canonical record, plus how many entries carry no geometry. */
export function candidateCards(candidates: readonly CanonicalCandidate[] | undefined, kind: CandidateKind) {
  const cards = (candidates ?? []).flatMap((c) => candidateCard(c) ?? []).filter((card) => card.kind === kind);
  return { cards, withoutGeometry: (candidates ?? []).length - cards.length };
}

export interface CandidateGroup {
  key: string;
  title: string;
  cards: CandidateCard[];
}

/** Roofprints by model inference (one retained image); rooms by plan panel (its literal floor title). */
export function candidateGroups(cards: readonly CandidateCard[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const card of cards) {
    const key = card.kind === 'roofprint' ? (card.itemId ?? 'unlinked') : card.frame;
    const title = card.kind === 'roofprint' ? `Image ${key.slice(0, 8)}` : (card.levelLiteral ?? 'Level not stated');
    const group = groups.get(key) ?? { key, title, cards: [] };
    group.cards.push(card);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export type QueueFilter = 'all' | CandidateState;

export function filterCards(cards: readonly CandidateCard[], filter: QueueFilter): CandidateCard[] {
  return filter === 'all' ? [...cards] : cards.filter((card) => card.state === filter);
}

export function countByState(cards: readonly CandidateCard[]): Record<CandidateState, number> {
  const counts: Record<CandidateState, number> = { candidate: 0, reviewed: 0, rejected: 0 };
  for (const card of cards) counts[card.state] += 1;
  return counts;
}

/** Candidates with an officer decision on record, newest first: the history of the review. */
export function decisionHistory(cards: readonly CandidateCard[]): CandidateCard[] {
  return cards
    .filter((card) => card.decision)
    .sort((a, b) => b.decision!.time.localeCompare(a.decision!.time));
}

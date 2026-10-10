import type { GetResponse } from '@ulpin/api-client';
import type { MultiPolygon } from '@ulpin/scene';
import type { StatusWord } from '@ulpin/ui';
import type { RecordedCitation } from '../recorded/model';

type AreaCanonical = GetResponse<'/api/v1/areas/{areaId}/canonical'>;
type BuildingCanonical = GetResponse<'/api/v1/buildings/{buildingId}/canonical'>;
type Level = BuildingCanonical['levels'][number];

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

/** A room's size exactly as the read states it, formatted for the card; the Studio computes nothing. */
export type PlanEstimateView = { state: 'estimated'; extent: string; area: string } | { state: 'unknown' };

/** A candidate's citation has the shape of a recorded label's, so both open the evidence viewer the same way. */
export type CandidateCitation = RecordedCitation;

/** The size a sheet prints beside a room: its text exactly as the read carries it, and where that text is. */
export interface StatedSizeView {
  literal: string;
  citation: CandidateCitation;
}

/** The level line of a room's card. `stated` is false when the text stands in for a label the read lacks. */
export interface CandidateLevel {
  text: string;
  stated: boolean;
}

export interface CandidateCard {
  id: string;
  kind: CandidateKind;
  kindLabel: string;
  title: string;
  state: CandidateState;
  /** Only undecided candidates expose accept, reject or attach controls. */
  canDecide: boolean;
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
  /** The level a room names, in the read's own words; see `candidateLevel`. */
  level: CandidateLevel;
  levelLiteral: string | null;
  frame: string;
  /** Polygons in the candidate's own frame: area metres for a roofprint, plan metres for a room. */
  polygons: MultiPolygon;
  /** Null when the read states no estimate (an older server, or not a room). */
  planEstimate: PlanEstimateView | null;
  /** Null when the record holds none; never filled from a label, a neighbour or the estimate. */
  statedSize: StatedSizeView | null;
}

const ITEM_REF = /\/spatial-ml\/items\/([0-9a-f-]{36})#/;
const ROOM_FALLBACK = 'Unlabelled region';
const NO_LEVEL: CandidateLevel = { text: 'Not attached to a level', stated: false };

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
  if (candidate.review?.outcome === 'accepted' || candidate.state === 'reviewed') return 'reviewed';
  return 'candidate';
}

/**
 * A candidate waiting for an officer is "Needs review"; "Reviewed" appears only when the record carries an
 * accepted decision, and a rejection is shown as the outcome it is.
 */
export function stateChip(state: CandidateState): StateChip {
  if (state === 'rejected') return { kind: 'plain', label: 'Rejected' };
  return { kind: 'status', word: state === 'reviewed' ? 'Reviewed' : 'Needs review' };
}

/** The read states hundredths; the card prints them as stated, so nothing is rounded a second time. */
function hundredths(value: number): string {
  return value.toFixed(2);
}

/** `2.42 × 2.71 m` and `6.55 m²` from the read's own numbers; an incomplete estimate is unknown. */
export function planEstimateView(candidate: CanonicalCandidate): PlanEstimateView | null {
  const estimate = candidate.planEstimate;
  if (!estimate) return null;
  const [width, height] = estimate.extentM ?? [];
  if (estimate.areaM2 === null || width === undefined || height === undefined) return { state: 'unknown' };
  const extent = `${hundredths(width)} × ${hundredths(height)} m`;
  return { state: 'estimated', extent, area: `${hundredths(estimate.areaM2)} m²` };
}

/** A state word of the read in plain words: `source_supported` reads `source supported`. */
function stateWords(state: string): string {
  return state.replaceAll('_', ' ');
}

function listedLevel(level: Level): CandidateLevel {
  const { value, state } = level.label;
  if (value === null) return { text: `Label ${stateWords(state)}`, stated: false };
  return { text: state === 'reviewed' ? value : `${value} (${stateWords(state)})`, stated: true };
}

/**
 * The level a room names, as the read states it: the level's label, with the label's state when it is not
 * reviewed. A label is never made up from an id or an order.
 */
export function candidateLevel(levelId: string | null | undefined, levels: readonly Level[]): CandidateLevel {
  if (!levelId) return NO_LEVEL;
  const level = levels.find((item) => item.levelId === levelId);
  if (level) return listedLevel(level);
  return { text: `Level not listed in this record · ${levelId.slice(0, 8)}`, stated: false };
}

function titleOf(candidate: CanonicalCandidate, kind: CandidateKind): string {
  if (kind === 'room') return candidate.labelLiteral ?? ROOM_FALLBACK;
  return `Roofprint ${candidate.candidateId.slice(0, 8)}`;
}

function citationOf(citation: Citation, index: number): CandidateCitation {
  const { sourceId } = citation;
  return {
    key: `${sourceId}:${index}`,
    sourceId,
    source: sourceId.slice(0, 8),
    locator: locatorText(citation.locator),
    place: citation.locator,
    sha256: citation.sourceSha256,
    revision: citation.sourceRevision ?? null,
  };
}

/** The stated size as the read carries it. The text is not parsed, converted or compared with the estimate. */
export function statedSizeView(candidate: CanonicalCandidate): StatedSizeView | null {
  const stated = candidate.statedSize;
  return stated ? { literal: stated.literal, citation: citationOf(stated.citation, 0) } : null;
}

/** The accessible name of a citation's control: what it opens, by the source and place the chip shows. */
export function citationOpenLabel(citation: CandidateCitation): string {
  return `Open cited source ${citation.source} at ${citation.locator}`;
}

export function candidateCard(candidate: CanonicalCandidate, levels: readonly Level[] = []): CandidateCard | null {
  if (!candidate.kind || !candidate.polygons) return null;
  const state = candidateState(candidate);
  return {
    id: candidate.candidateId,
    kind: candidate.kind,
    kindLabel: candidate.kind === 'room' ? 'Room' : 'Roofprint',
    title: titleOf(candidate, candidate.kind),
    state,
    canDecide: !candidate.review && state === 'candidate',
    chip: stateChip(state),
    method: candidate.method ?? 'Not recorded',
    modelId: candidate.modelId ?? null,
    confidence: confidenceText(candidate),
    limitations: candidate.limitations ?? [],
    citations: (candidate.citations ?? []).map(citationOf),
    decision: candidate.review ?? null,
    itemId: itemIdOf(candidate.outputRef),
    level: candidateLevel(candidate.levelId, levels),
    levelLiteral: candidate.levelLabelLiteral ?? null,
    frame: candidate.coordinateFrame ?? 'Not recorded',
    polygons: candidate.polygons as MultiPolygon,
    planEstimate: planEstimateView(candidate),
    statedSize: statedSizeView(candidate),
  };
}

/**
 * Cards for every drawable candidate of a canonical record, plus how many entries carry no geometry. `levels`
 * are the building's, for the level a room names; an area has none.
 */
export function candidateCards(
  candidates: readonly CanonicalCandidate[] | undefined, kind: CandidateKind, levels: readonly Level[] = [],
) {
  const ofKind = (candidates ?? []).filter((candidate) => candidate.kind === kind);
  const cards = ofKind.flatMap((candidate) => candidateCard(candidate, levels) ?? []);
  return { cards, withoutGeometry: ofKind.length - cards.length };
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

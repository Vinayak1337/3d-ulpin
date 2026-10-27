import type { GetResponse } from '@ulpin/api-client';
import { formatMeasure } from '@ulpin/ui';
import type { RegisterRecord } from '../../../api/queries';
import type { EvidenceRef, Locator } from '../../evidence/refs';
import { locatorText } from '../candidates/model';

export type BuildingCanonical = GetResponse<'/api/v1/buildings/{buildingId}/canonical'>;
type Level = BuildingCanonical['levels'][number];
type Space = Level['spaces'][number];
type Citation = Level['label']['citations'][number];
type Measure = Level['lowerM'] | NonNullable<Space['areaM2']>;

export interface RecordedCitation {
  key: string;
  sourceId: string;
  /** The short source id shown on the chip; the record carries no file name. */
  source: string;
  locator: string;
  /** The place exactly as the citation records it, and the original it was recorded against. */
  place: Citation['locator'];
  sha256: string;
  revision: number | null;
}

/** A record value as text. `known` is false when the text is the state word of a value the record lacks. */
export interface RecordedValue {
  text: string;
  known: boolean;
}

export interface RecordedUnit {
  id: string;
  label: string;
  kind: RecordedValue;
  area: RecordedValue;
  citations: RecordedCitation[];
  /** The assigned application code exactly as recorded, or null when none is reviewed. */
  code: string | null;
}

export interface RecordedFloor {
  id: string;
  /** The id the register read lists this floor under. */
  registerId: string;
  label: string;
  /** True for a floor recorded from a source label; false for a schedule row the server linked one to. */
  reviewed: boolean;
  origin: string;
  lower: RecordedValue;
  upper: RecordedValue;
  citations: RecordedCitation[];
  units: RecordedUnit[];
}

const NOT_REPORTED: RecordedValue = { text: 'Not reported', known: false };
const UNIT_SYMBOLS = { m: 'm', m2: 'm²' } as const;
// Gaps are plain sentences without a code, so the server's sentence is found by its opening words.
const SOURCE_LABEL_GAP = /^Source-stated labels\b/;

/**
 * The state of a value the record lacks, in words: "Not recorded" where the record states it absent, "Unknown"
 * only where it says unknown, and any other state by its own word. None becomes 0 or blank.
 */
function stateWord(state: string): RecordedValue {
  if (state === 'absent') return { text: 'Not recorded', known: false };
  return { text: state.charAt(0).toUpperCase() + state.slice(1), known: false };
}

function measureValue(measure: Measure | undefined): RecordedValue {
  if (!measure) return NOT_REPORTED;
  if (measure.value === null) return stateWord(measure.state);
  const symbol = UNIT_SYMBOLS[measure.unit as keyof typeof UNIT_SYMBOLS];
  const text = symbol ? formatMeasure(measure.value, symbol) : `${measure.value} ${measure.unit ?? ''}`.trim();
  return { text, known: true };
}

function literalValue(field: { value: string | null; state: string } | undefined): RecordedValue {
  if (!field) return NOT_REPORTED;
  return field.value === null ? stateWord(field.state) : { text: field.value, known: true };
}

/** A kind the record gives as the word unknown is the read saying unknown, not a kind of unit. */
function kindValue(field: Space['kind']): RecordedValue {
  return field?.value === 'unknown' ? stateWord('unknown') : literalValue(field);
}

function citationOf(citation: Citation, index: number): RecordedCitation {
  const locator = locatorText(citation.locator);
  return { key: `${citation.sourceId}:${index}`, sourceId: citation.sourceId,
    source: citation.sourceId.slice(0, 8), locator, place: citation.locator, sha256: citation.sourceSha256,
    revision: citation.sourceRevision ?? null };
}

function originText(level: Level): string {
  if (level.recordState !== 'reviewed') {
    return 'Level schedule row · a floor recorded from a source label is linked to it';
  }
  if (level.polygons?.state === 'absent') return 'Recorded from a source label · geometry not recorded';
  return 'Recorded from a source label';
}

function recordedUnit(space: Space): RecordedUnit {
  const code = space.proposedCode;
  return {
    id: space.spaceId,
    label: literalValue(space.label).text,
    kind: kindValue(space.kind),
    area: measureValue(space.areaM2),
    citations: (space.label?.citations ?? []).map(citationOf),
    code: code.state === 'reviewed' ? code.value : null,
  };
}

function recordedFloor(level: Level, registerId: string): RecordedFloor {
  return {
    id: level.levelId,
    registerId,
    label: literalValue(level.label).text,
    reviewed: level.recordState === 'reviewed',
    origin: originText(level),
    lower: measureValue(level.lowerM),
    upper: measureValue(level.upperM),
    citations: level.label.citations.map(citationOf),
    units: level.spaces.filter((space) => space.recordState === 'reviewed' && space.label).map(recordedUnit),
  };
}

/**
 * Levels that carry a floor recorded from a source label, in the order the record lists them. A floor the
 * server linked to a schedule row arrives as that row, so it appears once. No number is read from a label.
 */
export function recordedFloors(levels: BuildingCanonical['levels']): RecordedFloor[] {
  return levels.flatMap((level) => (level.registryFloorId ? [recordedFloor(level, level.registryFloorId)] : []));
}

/** The register read as the panel holds it: its entries once answered, or that it could not be read. */
export interface RegisterRead {
  records: readonly RegisterRecord[] | undefined;
  failed: boolean;
}

/**
 * A recorded floor's identifier exactly as the register read states it. The read publishes `identifier` as a
 * required string, so a floor it states none for is one it lists no entry for; that, a failed read and a read
 * still on its way are each said in words, and no identifier is composed here.
 */
export function floorIdentifier(register: RegisterRead, registerId: string): RecordedValue {
  if (register.failed) return { text: 'The register could not be read, so no identifier is shown.', known: false };
  if (!register.records) return { text: 'Reading the register…', known: false };
  const identifier = register.records.find((record) => record.id === registerId)?.identifier;
  if (!identifier) return { text: 'The register read states no identifier for this floor.', known: false };
  return { text: identifier, known: true };
}

/** The building's own sentence on what a source-stated label does not establish, as returned. */
export function sourceLabelGaps(gaps: readonly string[]): string[] {
  return gaps.filter((gap) => SOURCE_LABEL_GAP.test(gap));
}

/** A page or region keeps its own numbers and unit for the viewer; any other place stays text. */
function viewerLocator(citation: RecordedCitation): Locator {
  const { place, locator: text } = citation;
  if (place.kind === 'page') return { kind: 'page', page: place.page, text };
  if (place.kind !== 'region') return { kind: 'text', text };
  const { x, y, width, height, unit } = place;
  return { kind: 'region', page: place.page, region: { x, y, width, height, unit }, text };
}

/** The pointer the evidence viewer opens: the cited source at its page and region, pinned to the cited original. */
export function evidenceRef(label: string, citation: RecordedCitation): EvidenceRef {
  const pin = citation.revision === null ? undefined : { revision: citation.revision, sha256: citation.sha256 };
  return { sourceId: citation.sourceId, label, locator: viewerLocator(citation), pin,
    supports: [{ source: citation.source, locator: citation.locator }] };
}

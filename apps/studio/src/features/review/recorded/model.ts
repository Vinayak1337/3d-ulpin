import type { GetResponse } from '@ulpin/api-client';
import { formatMeasure } from '@ulpin/ui';
import type { EvidenceRef } from '../../evidence/refs';
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
}

export interface RecordedUnit {
  id: string;
  label: string;
  kind: string;
  area: string;
  citations: RecordedCitation[];
  /** The assigned application code exactly as recorded, or null when none is reviewed. */
  code: string | null;
}

export interface RecordedFloor {
  id: string;
  label: string;
  /** True for a floor recorded from a source label; false for a schedule row the server linked one to. */
  reviewed: boolean;
  origin: string;
  lower: string;
  upper: string;
  citations: RecordedCitation[];
  units: RecordedUnit[];
}

const NOT_REPORTED = 'Not reported';
const UNIT_SYMBOLS = { m: 'm', m2: 'm²' } as const;
// Gaps are plain sentences without a code, so the server's sentence is found by its opening words.
const SOURCE_LABEL_GAP = /^Source-stated labels\b/;

/** The state as a word, so unknown, absent, withheld and conflicting stay distinct and none becomes 0 or blank. */
function stateWord(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function measureText(measure: Measure | undefined): string {
  if (!measure) return NOT_REPORTED;
  if (measure.value === null) return stateWord(measure.state);
  const symbol = UNIT_SYMBOLS[measure.unit as keyof typeof UNIT_SYMBOLS];
  return symbol ? formatMeasure(measure.value, symbol) : `${measure.value} ${measure.unit ?? ''}`.trim();
}

function literalText(field: { value: string | null; state: string } | undefined): string {
  if (!field) return NOT_REPORTED;
  return field.value ?? stateWord(field.state);
}

function citationOf(citation: Citation, index: number): RecordedCitation {
  const locator = locatorText(citation.locator);
  return { key: `${citation.sourceId}:${index}`, sourceId: citation.sourceId,
    source: citation.sourceId.slice(0, 8), locator };
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
    label: literalText(space.label),
    kind: literalText(space.kind),
    area: measureText(space.areaM2),
    citations: (space.label?.citations ?? []).map(citationOf),
    code: code.state === 'reviewed' ? code.value : null,
  };
}

function recordedFloor(level: Level): RecordedFloor {
  return {
    id: level.levelId,
    label: literalText(level.label),
    reviewed: level.recordState === 'reviewed',
    origin: originText(level),
    lower: measureText(level.lowerM),
    upper: measureText(level.upperM),
    citations: level.label.citations.map(citationOf),
    units: level.spaces.filter((space) => space.recordState === 'reviewed' && space.label).map(recordedUnit),
  };
}

/**
 * Levels that carry a floor recorded from a source label, in the order the record lists them. A floor the
 * server linked to a schedule row arrives as that row, so it appears once. No number is read from a label.
 */
export function recordedFloors(levels: BuildingCanonical['levels']): RecordedFloor[] {
  return levels.filter((level) => level.registryFloorId).map(recordedFloor);
}

/** The building's own sentence on what a source-stated label does not establish, as returned. */
export function sourceLabelGaps(gaps: readonly string[]): string[] {
  return gaps.filter((gap) => SOURCE_LABEL_GAP.test(gap));
}

/** The pointer the evidence viewer opens: the cited source, with the page and region as its locator. */
export function evidenceRef(label: string, citation: RecordedCitation): EvidenceRef {
  return { sourceId: citation.sourceId, label, locator: { kind: 'text', text: citation.locator },
    supports: [{ source: citation.source, locator: citation.locator }] };
}

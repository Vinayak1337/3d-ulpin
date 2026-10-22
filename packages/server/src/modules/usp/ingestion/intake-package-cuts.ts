import { isDeepStrictEqual } from 'node:util';
import type { StreamingVectorRecord, ChunkMappingObservation } from '@ulpin/contracts/usp';
import type { SourceRangeReference } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import { CutExtent, featureExtent, frameZone, measurableCrs, type AreaFrame, type FeatureExtent,
  type SourceCrs } from './intake-package-extent';
import { setAsideGeometryTypes } from './registry';

/** Mirror services/geo/geo/area.py's compact ensure_ascii source JSON ceiling. */
export const AREA_NORMALIZER_SOURCE_JSON_LIMIT = 20 * 1024 * 1024;
export const INTAKE_PACKAGE_LIMITS = Object.freeze({
  features: 2000, rawBytes: 16 * 1024 * 1024, vertices: 100000, featureVertices: 10000,
  serializedInput: AREA_NORMALIZER_SOURCE_JSON_LIMIT,
});
export type MappedPartFeature = {
  raw: StreamingVectorRecord; mapped: ChunkMappingObservation; feature: Record<string, unknown>;
};
type Cost = { features: number; rawBytes: number; vertices: number; serializedInput: number };
export type IntakePackageCut = { index: number; features: MappedPartFeature[]; cost: Cost };
export type HeldPartFeature = { featureIndex: number; code: HeldPartCode };
/** Too many vertices or bytes for any package; wider than any one map area; outside the area it is drafted into. */
export type HeldPartCode = 'PART_FEATURE_VERTEX_BOUND' | 'PART_FEATURE_INPUT_BOUND' | 'PART_FEATURE_EXTENT_BOUND'
  | 'PART_FEATURE_AREA_BOUND';

function vertices(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  if (typeof value[0] === 'number') return 1;
  return value.reduce((sum: number, item: unknown) => sum + vertices(item), 0);
}

/** Python's ensure_ascii expands UTF-16 units; reserve two extra characters per JSON number.
 * Python may spell a binary float's exponent with an extra zero or emit .0. This envelope
 * is intentionally conservative, never an attempt to reserialize original feature spans. */
export function normalizerInputUpperBound(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new AppError(422, 'PART_SOURCE_JSON', 'The source is not JSON data.');
  const escaped = serialized.replace(/[\u007f-\uffff]/g,
    token => `\\u${token.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const numberCount = (item: unknown): number => {
    if (typeof item === 'number') return 1;
    if (!item || typeof item !== 'object') return 0;
    return Object.values(item).reduce<number>((sum, child) => sum + numberCount(child), 0);
  };
  return escaped.length + 2 * numberCount(value);
}

function featureCost(feature: Record<string, unknown>,
  range: Pick<SourceRangeReference, 'byteStart' | 'byteEnd'>): Cost {
  const geometry = feature.geometry as { coordinates?: unknown } | null;
  return { features: 1, rawBytes: range.byteEnd - range.byteStart,
    vertices: vertices(geometry?.coordinates), serializedInput: normalizerInputUpperBound(feature) + 1 };
}

function plus(left: Cost, right: Cost): Cost {
  return { features: left.features + right.features, rawBytes: left.rawBytes + right.rawBytes,
    vertices: left.vertices + right.vertices, serializedInput: left.serializedInput + right.serializedInput };
}
function fits(cost: Cost): boolean {
  return cost.features <= INTAKE_PACKAGE_LIMITS.features && cost.rawBytes <= INTAKE_PACKAGE_LIMITS.rawBytes
    && cost.vertices <= INTAKE_PACKAGE_LIMITS.vertices && cost.serializedInput <= INTAKE_PACKAGE_LIMITS.serializedInput;
}
function initialCost(metadata: Record<string, unknown>): Cost {
  return { features: 0, rawBytes: 0, vertices: 0,
    serializedInput: normalizerInputUpperBound({ ...metadata, type: 'FeatureCollection', features: [] }) };
}

/** Raw and mapped payloads must already have passed their existing immutable-storage reader. */
function assertPair(item: MappedPartFeature, previous: number) {
  const { raw, mapped } = item;
  if (raw.featureIndex <= previous || raw.featureIndex !== mapped.featureIndex
    || raw.byteStart !== mapped.byteStart || raw.byteEnd !== mapped.byteEnd || raw.rawSha256 !== mapped.rawSha256
    || raw.byteEnd <= raw.byteStart || !isDeepStrictEqual(raw.feature, item.feature)
    || raw.disposition !== 'accepted' || mapped.geometryRef?.featureIndex !== raw.featureIndex
    || mapped.geometryRef?.rawSha256 !== raw.rawSha256)
    throw new AppError(422, 'PART_RECORD_MISMATCH', 'The mapped record does not name this exact ordered raw feature.');
}

/** One sealed raw part and its mapped part, as the cutter takes them: accepted, observed, keyed, not duplicated.
 * A feature the layout's kind sets aside stays in the original and joins no package. */
export function pairMappedFeatures(raw: readonly StreamingVectorRecord[], mapped: readonly ChunkMappingObservation[],
  fold: { after: number; conflicts: ReadonlySet<number>; kind: string }): MappedPartFeature[] {
  const observed = new Map(mapped.map(record => [record.featureIndex, record]));
  return raw.flatMap(record => {
    const match = observed.get(record.featureIndex);
    const geometry = (record.feature as { geometry?: { type?: unknown } } | null)?.geometry;
    const setAside = setAsideGeometryTypes(fold.kind, [String(geometry?.type)]).length > 0;
    if (record.featureIndex <= fold.after || record.disposition !== 'accepted'
      || fold.conflicts.has(record.featureIndex) || match?.disposition !== 'observed'
      || match.sourceKey.state !== 'known' || !match.geometryRef || setAside) return [];
    return [{ raw: record, mapped: match, feature: record.feature as Record<string, unknown> }];
  });
}

/** Recheck scheduler bounds at the import door without making a synthetic mapping record. */
export function assertProvedPartBounds(features: Record<string, unknown>[], ranges: Map<number, SourceRangeReference>,
  metadata: Record<string, unknown>) {
  const positions = [...ranges.values()];
  let cost = initialCost(metadata);
  if (!features.length || features.length !== positions.length)
    throw new AppError(422, 'PART_RANGE_PAIRING', 'Every proved Feature needs its own original range.');
  for (const [index, feature] of features.entries()) {
    const next = featureCost(feature, positions[index]);
    cost = plus(cost, next);
    if (next.vertices > INTAKE_PACKAGE_LIMITS.featureVertices || !fits(cost))
      throw new AppError(413, 'PART_CUT_BOUND', 'This proved part does not fit one unchanged normalizer input.');
  }
}

/** The area rule for one file: its declared system and the area reference, when both can be measured here.
 * Otherwise no extent is measured and cuts close on their size alone, as before. */
class ExtentRule {
  private readonly crs: SourceCrs | null;

  constructor(metadata: Record<string, unknown>, private readonly frame: AreaFrame | null) {
    const crs = measurableCrs(metadata);
    this.crs = frame && frameZone(frame) === null ? null : crs;
  }

  open(): CutExtent | null {
    return this.crs ? new CutExtent(this.frame) : null;
  }

  /** The feature's extent, or why it can join no package: wider than any one area, or outside this area. */
  measure(feature: Record<string, unknown>): FeatureExtent | HeldPartCode | null {
    if (!this.crs) return null;
    const extent = featureExtent(feature, this.crs);
    if (!extent || !new CutExtent(null).admit(extent)) return 'PART_FEATURE_EXTENT_BOUND';
    return new CutExtent(this.frame).admit(extent) ? extent : 'PART_FEATURE_AREA_BOUND';
  }
}

function sizeHold(next: Cost, metadata: Record<string, unknown>): HeldPartCode | null {
  if (next.vertices > INTAKE_PACKAGE_LIMITS.featureVertices) return 'PART_FEATURE_VERTEX_BOUND';
  return fits(plus(initialCost(metadata), next)) ? null : 'PART_FEATURE_INPUT_BOUND';
}

/** Bounded fold state can be carried between sealed raw payloads without retaining a whole file.
 * A held feature is judged against an empty cut, and a cut closes on its own contents (size, and the extent
 * `services/geo/geo/area.py` takes in the area's fixed reference), so a fold resumed after a stored cut's last
 * feature, with that cut's next index and the same area reference, closes the same cuts as one fold from the start. */
export class IntakePackageCutter {
  private features: MappedPartFeature[] = [];
  private cost: Cost;
  private previous: number;
  private index: number;
  private readonly rule: ExtentRule;
  private extent: CutExtent | null;

  constructor(private readonly metadata: Record<string, unknown> = {},
    resume: { index: number; previous: number } = { index: 0, previous: -1 }, frame: AreaFrame | null = null) {
    this.cost = initialCost(metadata);
    this.index = resume.index;
    this.previous = resume.previous;
    this.rule = new ExtentRule(metadata, frame);
    this.extent = this.rule.open();
  }

  consume(item: MappedPartFeature): { cut?: IntakePackageCut; held?: HeldPartFeature } {
    if (item.mapped.disposition !== 'observed') return {};
    assertPair(item, this.previous);
    this.previous = item.raw.featureIndex;
    const next = featureCost(item.feature, item.raw);
    const sized = sizeHold(next, this.metadata);
    if (sized) return { held: { featureIndex: this.previous, code: sized } };
    const extent = this.rule.measure(item.feature);
    if (typeof extent === 'string') return { held: { featureIndex: this.previous, code: extent } };
    const full = !fits(plus(this.cost, next)) || extent !== null && !this.extent!.admit(extent);
    const cut = full ? this.close() : undefined;
    if (full && extent) this.extent!.admit(extent);
    this.features.push(item);
    this.cost = plus(this.cost, next);
    return cut ? { cut } : {};
  }

  close(): IntakePackageCut | undefined {
    if (!this.features.length) return undefined;
    const cut = { index: this.index++, features: this.features, cost: this.cost };
    this.features = [];
    this.cost = initialCost(this.metadata);
    this.extent = this.rule.open();
    return cut;
  }
}

/** Collection convenience for bounded comparisons; production uses the one-cut accumulator above. */
export function cutMappedFeatures(items: Iterable<MappedPartFeature>, metadata: Record<string, unknown> = {},
  frame: AreaFrame | null = null) {
  const cutter = new IntakePackageCutter(metadata, undefined, frame);
  const cuts: IntakePackageCut[] = [], held: HeldPartFeature[] = [];
  for (const item of items) {
    const result = cutter.consume(item);
    if (result.cut) cuts.push(result.cut);
    if (result.held) held.push(result.held);
  }
  const last = cutter.close();
  if (last) cuts.push(last);
  return { cuts, held };
}

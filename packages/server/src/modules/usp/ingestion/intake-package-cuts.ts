import { isDeepStrictEqual } from 'node:util';
import type { StreamingVectorRecord, ChunkMappingObservation } from '@ulpin/contracts/usp';
import type { SourceRangeReference } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';

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
export type HeldPartFeature = { featureIndex: number; code: string };

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

/** Bounded fold state can be carried between sealed raw payloads without retaining a whole file. */
export class IntakePackageCutter {
  private features: MappedPartFeature[] = [];
  private cost: Cost;
  private previous = -1;
  private index = 0;

  constructor(private readonly metadata: Record<string, unknown> = {}) {
    this.cost = initialCost(metadata);
  }

  consume(item: MappedPartFeature): { cut?: IntakePackageCut; held?: HeldPartFeature } {
    if (item.mapped.disposition !== 'observed') return {};
    assertPair(item, this.previous);
    this.previous = item.raw.featureIndex;
    const next = featureCost(item.feature, item.raw);
    if (next.vertices > INTAKE_PACKAGE_LIMITS.featureVertices || !fits(plus(initialCost(this.metadata), next))) {
      return { held: { featureIndex: this.previous, code: next.vertices > INTAKE_PACKAGE_LIMITS.featureVertices
        ? 'PART_FEATURE_VERTEX_BOUND' : 'PART_FEATURE_INPUT_BOUND' } };
    }
    const cut = !fits(plus(this.cost, next)) ? this.close() : undefined;
    this.features.push(item);
    this.cost = plus(this.cost, next);
    return cut ? { cut } : {};
  }

  close(): IntakePackageCut | undefined {
    if (!this.features.length) return undefined;
    const cut = { index: this.index++, features: this.features, cost: this.cost };
    this.features = [];
    this.cost = initialCost(this.metadata);
    return cut;
  }
}

/** Collection convenience for bounded comparisons; production uses the one-cut accumulator above. */
export function cutMappedFeatures(items: Iterable<MappedPartFeature>, metadata: Record<string, unknown> = {}) {
  const cutter = new IntakePackageCutter(metadata);
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

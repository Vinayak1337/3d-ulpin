import { isDeepStrictEqual } from 'node:util';
import { NativeRecordReferenceSchema, SourceRangeReferenceSchema,
  type NativeRecordReference, type SourceRangeReference } from '@ulpin/contracts';
import { STREAMING_VECTOR_LIMITS } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { readObjectRange, sha256 } from '../../../infrastructure/storage';
import { areaGeo } from '../../areas/areas';
import { permitsDecodedFeatureCitation } from '../../registry/registry-reference-policy';

type Member = { name: string; start: number; end: number };

function whitespaceEnd(text: string, start: number): number {
  while (start < text.length && /[\t\n\r ]/.test(text[start])) start++;
  return start;
}

function stringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '"') return index + 1;
  }
  throw new Error('Incomplete string');
}

function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] !== '{' && text[start] !== '[') {
    let end = start;
    while (end < text.length && !/[\t\n\r ,}\]]/.test(text[end])) end++;
    return end;
  }
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const token = text[index];
    if (token === '"') index = stringEnd(text, index) - 1;
    else if (token === '{' || token === '[') depth++;
    else if ((token === '}' || token === ']') && --depth === 0) return index + 1;
  }
  throw new Error('Incomplete value');
}

function objectMembers(text: string, start: number): Member[] {
  const members: Member[] = [];
  let position = whitespaceEnd(text, start + 1);
  while (text[position] !== '}') {
    const nameEnd = stringEnd(text, position);
    const name = JSON.parse(text.slice(position, nameEnd)) as string;
    const colon = whitespaceEnd(text, nameEnd);
    const valueStart = whitespaceEnd(text, colon + 1);
    const end = valueEnd(text, valueStart);
    members.push({ name, start: valueStart, end });
    position = whitespaceEnd(text, end);
    if (text[position] === ',') position = whitespaceEnd(text, position + 1);
  }
  return members;
}

function arrayElement(text: string, start: number, wanted: number): number | null {
  let position = whitespaceEnd(text, start + 1);
  let index = 0;
  while (text[position] !== ']') {
    if (index === wanted) return position;
    position = whitespaceEnd(text, valueEnd(text, position));
    if (text[position] === ',') position = whitespaceEnd(text, position + 1);
    index++;
  }
  return null;
}

export type NativeRecordDecoded = {
  status: 'available' | 'unavailable'; code?: string; sourceSha256: string;
  sourceKey?: string; fields?: Record<string, unknown>; decodedRecord?: NativeRecordReference;
};
export type NativeRecordDecoder = (bytes: Buffer, reference: NativeRecordReference) => Promise<NativeRecordDecoded>;

export const decodeNativeRecord: NativeRecordDecoder = (bytes, reference) => areaGeo<NativeRecordDecoded>('normalize', {
  operation: 'decode_record', format: reference.format, base64: bytes.toString('base64'), nativeRecord: reference,
});

function decodedFieldText(fields: Record<string, unknown>): string[] {
  return Object.entries(fields).map(([name, value]) => {
    // JSON escapes control characters so a field value cannot impersonate a citation heading.
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)
      || typeof value === 'number' && (!Number.isFinite(value)
        || Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new AppError(422, 'PACKET_PLAN_NATIVE_FIELD_UNSUPPORTED', 'A decoded field is not an exact finite scalar.');
    return `${JSON.stringify(name)}: ${JSON.stringify(value)}`;
  });
}

export async function decodedRecordExtract(original: Buffer,
  source: { name: string; sha256: string; bytes: number; profile?: string; status?: string;
    inspection?: { status?: string } | null },
  observation: Record<string, any> | null, decode: NativeRecordDecoder = decodeNativeRecord) {
  if (original.length !== Number(source.bytes) || sha256(original) !== source.sha256)
    throw new AppError(422, 'PACKET_PLAN_ORIGINAL_INTEGRITY', 'The original does not match its retained receipt.');
  if (typeof source.name !== 'string' || !source.name.length)
    throw new AppError(422, 'PACKET_PLAN_NATIVE_SOURCE_UNSUPPORTED', 'The retained file name is unavailable.');
  const reference = NativeRecordReferenceSchema.safeParse(observation?.sourceReference?.nativeRecord);
  if (!reference.success)
    throw new AppError(422, 'PACKET_PLAN_NATIVE_POSITION_UNAVAILABLE', 'No import-time native record position is available.');
  if (!permitsDecodedFeatureCitation(source, reference.data))
    throw new AppError(422, 'PACKET_PLAN_NATIVE_SOURCE_UNSUPPORTED', 'The native reference does not match this source profile.');
  const decoded = await decode(original, reference.data);
  if (decoded.sourceSha256 !== source.sha256)
    throw new AppError(422, 'PACKET_PLAN_ORIGINAL_INTEGRITY', 'The decoder read a different retained original.');
  if (decoded.status !== 'available')
    throw new AppError(422, decoded.code ?? 'PACKET_PLAN_NATIVE_RECORD_UNAVAILABLE', 'The exact native record is unavailable.');
  if (!isDeepStrictEqual(decoded.decodedRecord, reference.data))
    throw new AppError(422, 'PACKET_PLAN_NATIVE_REFERENCE_MISMATCH', 'The decoded position or encoding changed.');
  if (decoded.sourceKey !== observation?.sourceKey)
    throw new AppError(422, 'PACKET_PLAN_NATIVE_KEY_MISMATCH', 'This position decodes to a different source key.');
  const record = reference.data;
  const member = record.format === 'gpkg' ? record.table : record.member;
  const number = record.format === 'gpkg' ? record.position : record.position + 1;
  const excerpt = [`Decoded field values of record ${number} of ${member} in ${source.name}`,
    `Encoding: ${record.encoding}`, ...decodedFieldText(decoded.fields ?? {})].join('\n');
  if (!decoded.fields || !Object.keys(decoded.fields).length || excerpt.length > 16000)
    throw new AppError(422, 'PACKET_PLAN_NATIVE_EXCERPT_BOUND', 'The decoded record exceeds the exact excerpt bound.');
  return { excerpt, method: 'decoded_record' as const, decodedRecord: record };
}

export function observedFeatureExtract(bytes: Uint8Array, observation: Record<string, any> | null) {
  if (!observation) return null;
  const excerpt = featurePropertiesExtract(Buffer.from(bytes), observation.sourceFeatureIndex);
  return checkedFeatureProperties(excerpt, observation);
}

function checkedFeatureProperties(excerpt: string | null, observation: Record<string, any>) {
  if (excerpt === null || !excerpt.length || excerpt.length > 16000) return null;
  const original = JSON.parse(excerpt);
  for (const [name, value] of Object.entries(observation.properties ?? {}))
    if (Object.hasOwn(original, name) && !isDeepStrictEqual(value, original[name])) return null;
  return excerpt;
}

const rangeMismatch = () => new AppError(422, 'PACKET_PLAN_RANGE_MISMATCH',
  'The exact feature range does not match its retained import-time observation.');

function assertFeatureRangeBound(range: SourceRangeReference) {
  if (range.byteEnd - range.byteStart > STREAMING_VECTOR_LIMITS.featureBytes)
    throw new AppError(422, 'PACKET_PLAN_RANGE_BOUND', 'The feature span exceeds the reader\'s 1 MiB bound.');
}

export function capturedSourceRange(observation: Record<string, any> | null, sourceBytes: number) {
  const reference = observation?.sourceReference?.sourceRange;
  if (reference === undefined) return null;
  const parsed = SourceRangeReferenceSchema.safeParse(reference);
  if (!parsed.success || parsed.data.featureIndex !== observation?.sourceFeatureIndex
    || !Number.isSafeInteger(sourceBytes) || parsed.data.byteEnd > sourceBytes) throw rangeMismatch();
  assertFeatureRangeBound(parsed.data);
  return parsed.data;
}

/** Decode only the verified Feature bytes; the returned text is never reserialized. */
export function featureRangeExtract(bytes: Uint8Array, range: SourceRangeReference,
  observation: Record<string, any>): string | null {
  assertFeatureRangeBound(range);
  if (range.featureIndex !== observation.sourceFeatureIndex
    || bytes.length !== range.byteEnd - range.byteStart || sha256(bytes) !== range.rawSha256)
    throw rangeMismatch();
  let excerpt: string;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const feature = JSON.parse(text);
    if (!feature || Array.isArray(feature) || feature.type !== 'Feature' || text[0] !== '{'
      || text.at(-1) !== '}') throw rangeMismatch();
    const properties = objectMembers(text, 0).filter(member => member.name === 'properties');
    if (properties.length !== 1 || text[properties[0].start] !== '{') throw rangeMismatch();
    excerpt = text.slice(properties[0].start, properties[0].end);
  } catch {
    throw rangeMismatch();
  }
  const checked = checkedFeatureProperties(excerpt, observation);
  if (checked === null && excerpt.length <= 16000) throw rangeMismatch();
  return checked;
}

export async function readFeatureRangeBytes(source: { object_key: string; bytes: number | string },
  range: SourceRangeReference, read: typeof readObjectRange = readObjectRange) {
  try {
    return await read(source.object_key, range.byteStart, range.byteEnd, Number(source.bytes),
      Date.now() + 30000, new AbortController().signal);
  } catch (error) {
    if (error instanceof AppError && error.code === 'SOURCE_INTEGRITY') throw rangeMismatch();
    throw error;
  }
}

export async function readFeatureRange(source: { object_key: string; bytes: number | string },
  observation: Record<string, any>, read: typeof readObjectRange = readObjectRange) {
  const range = capturedSourceRange(observation, Number(source.bytes));
  if (!range) throw rangeMismatch();
  return featureRangeExtract(await readFeatureRangeBytes(source, range, read), range, observation);
}

/** The source's own words: the properties object of element N, with its original spelling and whitespace. */
export function featurePropertiesExtract(original: Buffer, featureIndex: number): string | null {
  if (!Number.isSafeInteger(featureIndex) || featureIndex < 0) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(original);
    // Validate the entire file first: an early selected span must not conceal a truncated remainder.
    JSON.parse(text);
    const root = whitespaceEnd(text, 0);
    if (text[root] !== '{') return null;
    const features = objectMembers(text, root).filter(member => member.name === 'features');
    if (features.length !== 1 || text[features[0].start] !== '[') return null;
    const element = arrayElement(text, features[0].start, featureIndex);
    if (element === null || text[element] !== '{') return null;
    const properties = objectMembers(text, element).filter(member => member.name === 'properties');
    if (properties.length !== 1 || text[properties[0].start] !== '{') return null;
    return text.slice(properties[0].start, properties[0].end);
  } catch {
    return null;
  }
}

import type { GetResponse } from '@ulpin/api-client';
import { MODEL_PREVIEW_MAX_POSITIONS, type ModelPreviewInput } from '@ulpin/scene';
import type { NativeReader } from './reader-of';

/**
 * NO1. A batch item's native reading and the features its conversion left out, read through routes that already
 * hold the original's authority. Every value shown is read from those records; nothing here places or confirms.
 */
export type NativeStatus =
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/citygml/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/cityjson/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/gltf/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/obj/jobs/{jobId}'>;
export type NativeOmissions = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/omissions'>;
type Layer = NativeOmissions['layers'][number];

export const readerWords: Record<NativeReader, string> = { dxf: 'DXF', citygml: 'CityGML', cityjson: 'CityJSON',
  gltf: 'glTF', obj: 'OBJ' };

export type SummaryLine = { label: string; value: string };
/** The summary in words, and apart from it the fingerprints and the reader's format, which an officer opens. */
export type SummaryLines = { lines: SummaryLine[]; hashes: SummaryLine[] };

const labelWords: Record<string, string> = { citygml: 'CityGML', crs: 'CRS', dxf: 'DXF', gltf: 'glTF', obj: 'OBJ',
  sha256: 'SHA-256' };

/** A field name in words, in sentence case; a nested field's name (`capital` false) follows its parent's. */
const label = (key: string, capital = true) => {
  if (key === 'schemaVersion') return 'Reader format';
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')
    .map(word => labelWords[word] ?? word).join(' ');
  return capital ? words.charAt(0).toUpperCase() + words.slice(1) : words;
};

const technical = (key: string) => key === 'schemaVersion' || /sha256$/i.test(key);

/**
 * A stored state such as `not_assessed` or `UNSUPPORTED_CONTENT` in words ("Not assessed"); the state `null` (a
 * field the file wrote as empty) reads "Stated as empty". Names, versions and other literals stay as stored.
 */
function textWords(key: string, value: string): string {
  if (key === 'name' || !/^[a-z]+(_[a-z0-9]+)*$|^[A-Z]+(_[A-Z0-9]+)+$/.test(value)) return value;
  if (value === 'null') return 'Stated as empty';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A stored null is "Not stated", apart from the states Unknown, Absent and Stated as empty. */
function valueWords(key: string, value: unknown): string {
  if (value === null) return 'Not stated';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return technical(key) ? value : textWords(key, value);
  if (Array.isArray(value)) return value.length ? value.map(entry => valueWords(key, entry)).join(', ') : 'None listed';
  return String(value);
}

function addLines(into: SummaryLines, name: string, key: string, value: unknown) {
  if (Array.isArray(value) && value.some(entry => entry !== null && typeof entry === 'object')) {
    value.forEach((entry, index) => addLines(into, `${name} ${index + 1}`, key, entry));
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [child, inner] of Object.entries(value)) {
      addLines(into, `${name} · ${label(child, false)}`, child, inner);
    }
  } else (technical(key) ? into.hashes : into.lines).push({ label: name, value: valueWords(key, value) });
}

/** The reader's summary fields as stored, one labelled line each; a nested value gives one line per field. */
export function summaryLines(summary: Record<string, unknown>): SummaryLines {
  const into: SummaryLines = { lines: [], hashes: [] };
  for (const [key, value] of Object.entries(summary)) addLines(into, label(key), key, value);
  return into;
}

export type ReadingView =
  | { state: 'words'; words: string }
  | { state: 'read'; lines: SummaryLine[]; hashes: SummaryLine[]; createdAt: string };

export function readingView(reader: NativeReader, status: NativeStatus | null): ReadingView {
  const name = readerWords[reader];
  if (!status) return { state: 'words', words: `No ${name} reading is named for this file.` };
  if (status.status === 'failed') return { state: 'words',
    words: `The ${name} reading stopped${status.code ? ` (${status.code})` : ''}; there is no reading to open.` };
  if (status.status === 'stale') return { state: 'words',
    words: 'This reading is out of date: the file, the case or the reader changed after it ran.' };
  if (status.status !== 'completed') return { state: 'words', words: status.status === 'queued'
    ? `The ${name} reading is waiting to start.` : `The ${name} file is being read.` };
  if (!status.result) return { state: 'words', words: 'The reading finished without an accepted result.' };
  const { lines, hashes } = summaryLines(status.result.summary as Record<string, unknown>);
  return { state: 'read', lines, createdAt: status.result.createdAt,
    hashes: [...hashes, { label: 'Stored reading SHA-256', value: status.result.artifact.sha256 }] };
}

const count = (value: number) => value.toLocaleString('en-US');
const counted = (value: number, noun: string) => `${count(value)} ${noun}${value === 1 ? '' : 's'}`;

/** One line per layer: what was written, what was not and how the list was read. */
export function layerWords(layer: Layer): string {
  const counts = `${count(layer.written)} written, ${count(layer.notWritten)} not written`;
  const scans: Record<Layer['scan'], string> = {
    none_left_out: 'nothing left out',
    whole: layer.notWritten > layer.listed.length
      ? `the first ${count(layer.listed.length)} of ${count(layer.notWritten)} listed` : 'all listed',
    partial: `${count(layer.listed.length)} listed from the start of its locator file, not checked against its SHA-256`,
    not_read: 'not listed in this read; counts only',
  };
  return `${counts} · ${scans[layer.scan]}`;
}

export const positionWords = (layer: Layer, position: number | string) =>
  layer.positionKind ? `${layer.positionKind} ${position}` : String(position);

/**
 * S5.21. A glTF or OBJ reading's accepted result drawn in the file's own frame. Only the stored positions and the
 * polygons that name them are read; axes and units are reported as the reading states them, node transforms are not
 * applied, and nothing is converted, placed or measured.
 */
export type ModelReader = Extract<NativeReader, 'gltf' | 'obj'>;
export type ModelArtifactPins = { sha256: string; bytes: number };
export type ModelView =
  | { state: 'none' }
  | { state: 'words'; words: string }
  | { state: 'mesh'; model: ModelPreviewInput; label: string; lines: SummaryLine[] };
/** Before the accepted result is read: nothing to draw, words, or the pins of the result to read. */
export type ModelPreviewPlan =
  | Exclude<ModelView, { state: 'mesh' }>
  | { state: 'read'; reader: ModelReader; artifact: ModelArtifactPins; summary: Record<string, unknown> };

export const MODEL_MALFORMED = 'The accepted result is not in the shape its reader writes, so no preview is drawn.';
const MODEL_READING = 'The model is being read from the accepted result.';
const NOTHING_TO_DRAW = 'The reading holds no polygon the preview can draw.';

const capWords = (stated: number) => `This reading states ${count(stated)} positions; the preview draws a model of `
  + `at most ${count(MODEL_PREVIEW_MAX_POSITIONS)}, so it is not drawn.`;

/** The result to read for a completed glTF or OBJ reading, or words when it holds nothing the preview can draw. */
export function modelPreviewPlan(reader: NativeReader | null, status: NativeStatus | undefined): ModelPreviewPlan {
  if ((reader !== 'gltf' && reader !== 'obj') || status?.status !== 'completed' || !status.result) {
    return { state: 'none' };
  }
  const summary = status.result.summary as Record<string, unknown>;
  if (summary.geometryProjectionStatus === 'unavailable') return { state: 'words', words: NOTHING_TO_DRAW };
  const stated = reader === 'gltf' ? summary.projectedPositions : summary.vertexCount;
  if (typeof stated === 'number' && stated > MODEL_PREVIEW_MAX_POSITIONS) {
    return { state: 'words', words: capWords(stated) };
  }
  const { sha256, bytes } = status.result.artifact;
  return { state: 'read', reader, artifact: { sha256, bytes }, summary };
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Words for a result the preview refuses; any other fault reads as the malformed words. */
class Refusal extends Error {}
function need(ok: unknown): asserts ok {
  if (!ok) throw new Refusal(MODEL_MALFORMED);
}
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
/** The first three stored values of a position; an OBJ weight past them is 1 when the reader marks it eligible. */
function triple(value: unknown): [number, number, number] {
  need(Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite));
  return [value[0], value[1], value[2]];
}
/** A stored literal such as `right_handed_Y_up` in words ("Right handed Y up"); an absent one is Not stated. */
const frameWords = (value: unknown) => typeof value === 'string'
  ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : 'Not stated';

type Built = { model: ModelPreviewInput; lines: SummaryLine[]; label: string };

/** glTF: each projected triangle-list primitive's POSITION values, by its indices or, when absent, stored order. */
function gltfModel(native: Json): Built {
  need(Array.isArray(native.primitives));
  const positions: [number, number, number][] = [];
  const polygons: number[][] = [];
  let skipped = 0;
  for (const primitive of native.primitives) {
    need(isRecord(primitive));
    const mode = isRecord(primitive.mode) ? primitive.mode.value : undefined;
    if (primitive.status !== 'available_local_projection' || mode !== 4) {
      skipped += 1;
      continue;
    }
    const projection = primitive.projection;
    need(isRecord(projection) && isRecord(projection.POSITION) && isRecord(projection.indices)
      && Array.isArray(projection.POSITION.values));
    const values = projection.POSITION.values.map(triple);
    const indices: unknown = projection.indices.status === 'available' ? projection.indices.values
      : values.map((_, at) => at);
    need(Array.isArray(indices) && indices.length % 3 === 0
      && indices.every(index => isIndex(index) && index < values.length));
    const offset = positions.length;
    if (offset + values.length > MODEL_PREVIEW_MAX_POSITIONS) throw new Refusal(capWords(offset + values.length));
    positions.push(...values);
    for (let at = 0; at < indices.length; at += 3) {
      polygons.push([offset + indices[at], offset + indices[at + 1], offset + indices[at + 2]]);
    }
  }
  const qualification = isRecord(native.qualification) ? native.qualification : {};
  const frame = isRecord(qualification.localFrame) ? qualification.localFrame : {};
  const drawn = counted(polygons.length, 'triangle');
  return { model: { positions, polygons }, label: `glTF model in its own frame, ${drawn}`,
    lines: [
      { label: 'Axes as the reading states', value: frameWords(frame.axes) },
      { label: 'Unit as the reading states', value: frameWords(frame.linearUnit) },
      { label: 'Drawn', value: `${drawn} from ${counted(positions.length, 'stored position')}` },
      { label: 'Not drawn', value: skipped ? `${counted(skipped, 'primitive')} not a projected triangle list`
        : 'None' },
      { label: 'Node transforms', value: 'Not applied' },
    ] };
}

/** OBJ: each face the reader marked eligible, by its resolved vertex indices, in stored corner order. */
function objModel(native: Json, summary: Json): Built {
  need(Array.isArray(native.vertices) && Array.isArray(native.faces));
  const vertices: unknown[] = native.vertices;
  const positions: [number, number, number][] = [];
  const drawnAt = new Map<number, number>();
  const polygons: number[][] = [];
  let skipped = 0;
  let fans = 0;
  for (const face of native.faces) {
    need(isRecord(face) && Array.isArray(face.references) && face.references.length >= 3);
    if (face.projectionEligible !== true) {
      skipped += 1;
      continue;
    }
    polygons.push(face.references.map((reference: unknown) => {
      need(isRecord(reference) && isRecord(reference.vertex) && isIndex(reference.vertex.resolvedIndex));
      const source = reference.vertex.resolvedIndex;
      let at = drawnAt.get(source);
      if (at === undefined) {
        const vertex = vertices[source];
        need(isRecord(vertex) && vertex.cartesianProjectionEligible === true);
        if (positions.length >= MODEL_PREVIEW_MAX_POSITIONS) throw new Refusal(capWords(vertices.length));
        at = positions.push(triple(vertex.values)) - 1;
        drawnAt.set(source, at);
      }
      return at;
    }));
    if (face.references.length > 3) fans += 1;
  }
  const drawn = counted(polygons.length, 'polygon');
  return { model: { positions, polygons }, label: `OBJ model in its own frame, ${drawn}`,
    lines: [
      { label: 'Axes as the reading states', value: frameWords(summary.axes) },
      { label: 'Units as the reading states', value: frameWords(summary.units) },
      { label: 'Drawn', value: `${drawn} from ${counted(positions.length, 'stored position')}` },
      { label: 'Not drawn', value: skipped ? `${counted(skipped, 'face')} the reader did not project` : 'None' },
      ...(fans ? [{ label: 'Faces of more than three corners',
        value: `${count(fans)}, filled as fans for display` }] : []),
    ] };
}

/** The accepted result as a preview, checked field by field; anything off the reader's shape becomes words. */
export function modelView(reader: ModelReader, native: unknown, summary: Record<string, unknown>): ModelView {
  try {
    need(isRecord(native));
    const built = reader === 'gltf' ? gltfModel(native) : objModel(native, summary);
    if (!built.model.polygons.length) return { state: 'words', words: NOTHING_TO_DRAW };
    return { state: 'mesh', model: built.model, label: built.label, lines: [...built.lines,
      { label: 'Drawn as up', value: 'The second value (y)' }] };
  } catch (error) {
    return { state: 'words', words: error instanceof Refusal ? error.message : MODEL_MALFORMED };
  }
}

/** The plan and the read of its result as one view: words while it is read or when the read is refused. */
export function previewView(plan: ModelPreviewPlan,
  read: { data: unknown; error: Error | null; isPending: boolean }): ModelView {
  if (plan.state !== 'read') return plan;
  if (read.error) return { state: 'words',
    words: `The model could not be read from the accepted result: ${read.error.message}` };
  if (read.isPending) return { state: 'words', words: MODEL_READING };
  return modelView(plan.reader, read.data, plan.summary);
}

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { DXF_LIMITS } from '@ulpin/contracts/upload-reader-limits';
import { modelPreviewPlan, previewView, type ModelArtifactPins, type ModelReader, type ModelView,
  type NativeOmissions, type NativeStatus } from './reading-model';
import type { NativeReader } from './reader-of';
import type { DxfInspection } from './DxfDrawing';

type Pins = { caseId: string; sourceId: string; jobId: string };

/** Each reader's existing private status route; its service checks the original's authority and pins. */
async function readStatus(reader: NativeReader, path: Pins): Promise<NativeStatus> {
  const params = { params: { path } };
  switch (reader) {
    case 'dxf': return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}',
      params));
    case 'citygml': return unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/citygml/jobs/{jobId}', params));
    case 'cityjson': return unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/cityjson/jobs/{jobId}', params));
    case 'gltf': return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/gltf/jobs/{jobId}',
      params));
    case 'obj': return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/obj/jobs/{jobId}',
      params));
  }
}

/** The reading the item names, read again every five seconds while it waits or runs. */
export function useNativeStatus(reader: NativeReader | null, pins: Pins) {
  return useQuery({ queryKey: ['intake', pins.caseId, 'native-reading', reader, pins.sourceId, pins.jobId],
    enabled: Boolean(reader && pins.jobId), retry: false,
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status ?? '') ? 5000 : false,
    queryFn: () => readStatus(reader!, pins) });
}

const NATIVE = {
  dxf: '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}/native',
  gltf: '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/gltf/jobs/{jobId}/native',
  obj: '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/obj/jobs/{jobId}/native',
} as const;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The accepted DXF, glTF or OBJ result by its existing route: bytes that differ from
 * the reading's size and SHA-256 are refused.
 */
export async function readModelArtifact(reader: ModelReader | 'dxf', path: Pins, artifact: ModelArtifactPins,
  signal: AbortSignal): Promise<unknown> {
  const result = await api.GET(NATIVE[reader], { params: { path }, parseAs: 'arrayBuffer', signal });
  if (!result.response.ok || !result.data) throw new ApiError(result.response.status, NATIVE[reader], result.error);
  return artifactJson(result.data as ArrayBuffer, artifact);
}

async function artifactJson(bytes: ArrayBuffer, artifact: ModelArtifactPins): Promise<unknown> {
  if (bytes.byteLength !== artifact.bytes
    || hex(await crypto.subtle.digest('SHA-256', bytes)) !== artifact.sha256)
    throw new Error('its bytes differ from the size and SHA-256 the reading states.');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('it is not readable JSON.');
  }
}

/** The completed glTF or OBJ reading drawn in its own frame: its accepted result is read once, by its hash. */
export function useModelPreview(reader: NativeReader | null, pins: Pins, status: NativeStatus | undefined): ModelView {
  const plan = useMemo(() => modelPreviewPlan(reader, status), [reader, status]);
  const read = plan.state === 'read' ? plan : null;
  const native = useQuery({ queryKey: ['intake', pins.caseId, 'native-model', reader, pins.sourceId, pins.jobId,
    read?.artifact.sha256], enabled: Boolean(read), retry: false, staleTime: Infinity,
    queryFn: ({ signal }) => readModelArtifact(read!.reader, pins, read!.artifact, signal) });
  // One view per result, so the preview is built once and not on every render.
  const { data, error, isPending } = native;
  return useMemo(() => previewView(plan, { data, error, isPending }), [plan, data, error, isPending]);
}

/** Read the accepted head and, for paged inspections, each pinned entity page through the existing private route. */
export async function readDxfArtifact(path: Pins, artifact: ModelArtifactPins, signal: AbortSignal) {
  type Head = DxfInspection & { sourceSha256: string; pages?: (ModelArtifactPins & {
    pageIndex: number; firstOrdinal: number; entityCount: number })[] };
  const head = await readModelArtifact('dxf', path, artifact, signal) as Head;
  if (!head.units || (!Array.isArray(head.entities) && !Array.isArray(head.pages))) {
    throw new Error('The DXF inspection has no entity list.');
  }
  if (!head.pages) return head;
  if (head.pages.length > DXF_LIMITS.pages) throw new Error('The DXF inspection has too many pages.');
  const entities: DxfInspection['entities'] = [];
  for (const pin of head.pages) {
    if (pin.firstOrdinal !== entities.length || pin.bytes > DXF_LIMITS.pageBytes
      || entities.length + pin.entityCount > DXF_LIMITS.entities) {
      throw new Error('The DXF page order or size differs from its reading.');
    }
    const result = await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}/native/pages/{pageIndex}',
      { params: { path: { ...path, pageIndex: pin.pageIndex } }, parseAs: 'arrayBuffer', signal });
    if (!result.response.ok || !result.data) throw new Error('The DXF entity page could not be read.');
    const page = await artifactJson(result.data as ArrayBuffer, pin) as Head & { pageIndex: number;
      firstOrdinal: number };
    if (page.sourceSha256 !== head.sourceSha256 || page.pageIndex !== pin.pageIndex
      || page.firstOrdinal !== pin.firstOrdinal
      || !Array.isArray(page.entities) || page.entities.length !== pin.entityCount) {
      throw new Error('The DXF entity page differs from its reading.');
    }
    entities.push(...page.entities);
  }
  return { ...head, entities };
}

export function useDxfDrawing(reader: NativeReader | null, pins: Pins, status: NativeStatus | undefined) {
  const artifact = reader === 'dxf' && status?.status === 'completed' ? status.result?.artifact : null;
  return useQuery({ queryKey: ['intake', pins.caseId, 'dxf-drawing', pins.sourceId, pins.jobId, artifact?.sha256],
    enabled: Boolean(artifact), retry: false, staleTime: Infinity,
    queryFn: ({ signal }) => readDxfArtifact(pins, artifact!, signal) });
}

/** The features each converted layer left out, read under the original item's authority. */
export function useNativeOmissions(enabled: boolean, caseId: string, itemId: string) {
  return useQuery({ queryKey: ['intake', caseId, 'omissions', itemId], enabled, retry: false,
    queryFn: async (): Promise<NativeOmissions> => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/omissions', { params: { path: { caseId, itemId } } })) });
}

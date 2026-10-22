import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import type { NativeOmissions, NativeReader, NativeStatus } from './reading-model';

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

/** The features each converted layer left out, read under the original item's authority. */
export function useNativeOmissions(enabled: boolean, caseId: string, itemId: string) {
  return useQuery({ queryKey: ['intake', caseId, 'omissions', itemId], enabled, retry: false,
    queryFn: async (): Promise<NativeOmissions> => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/omissions', { params: { path: { caseId, itemId } } })) });
}

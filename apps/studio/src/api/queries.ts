import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap, type GetResponse } from '@ulpin/api-client';

export type WorkQueue = GetResponse<'/api/v1/work-queue'>;
export type WorkItem = WorkQueue['items'][number];
export type WorkStatusFilter = 'all' | 'processing' | 'recorded';
export type Area = GetResponse<'/api/v1/areas'>[number];
export type AreaContext = GetResponse<'/api/v1/areas/{areaId}/context'>;
export type AreaFeature = AreaContext['features'][number];
export type Capabilities = GetResponse<'/api/v1/workspace-capabilities'>;
/** The JSON form of the register (the endpoint also serves CSV and HTML exports). */
export type BuildingRegister = Exclude<GetResponse<'/api/v1/buildings/{buildingId}/register'>, string>;
export type RegisterRecord = BuildingRegister['register'][number];
export type RegisterSource = BuildingRegister['sources'][number];

export const queryKeys = {
  workQueue: (status: WorkStatusFilter, q: string, page: number) => ['work-queue', status, q, page] as const,
  areas: ['areas'] as const,
  areaContext: (areaId: string) => ['areas', areaId, 'context'] as const,
  capabilities: ['workspace-capabilities'] as const,
  register: (buildingId: string) => ['buildings', buildingId, 'register'] as const,
};

export function useWorkQueue(status: WorkStatusFilter, q: string, page: number) {
  return useQuery({
    queryKey: queryKeys.workQueue(status, q, page),
    queryFn: async () => unwrap(await api.GET('/api/v1/work-queue', { params: { query: { status, q: q || undefined, page } } })),
    placeholderData: keepPreviousData,
    // Poll while anything is processing; SSE replaces this when the backend streaming card lands.
    refetchInterval: (query) => (query.state.data?.items.some((item) => isProcessing(item.jobStatus)) ? 4000 : false),
  });
}

export function useAreas() {
  return useQuery({ queryKey: queryKeys.areas, queryFn: async () => unwrap(await api.GET('/api/v1/areas')), staleTime: 60_000 });
}

export function useAreaContext(areaId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.areaContext(areaId ?? ''),
    enabled: Boolean(areaId),
    queryFn: async () => unwrap(await api.GET('/api/v1/areas/{areaId}/context', { params: { path: { areaId: areaId! } } })),
    staleTime: 60_000,
  });
}

export function useBuildingRegister(buildingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.register(buildingId ?? ''),
    enabled: Boolean(buildingId),
    queryFn: async () => unwrap(await api.GET('/api/v1/buildings/{buildingId}/register', { params: { path: { buildingId: buildingId! } } })) as BuildingRegister,
    staleTime: 60_000,
  });
}

export function useCapabilities() {
  return useQuery({
    queryKey: queryKeys.capabilities,
    queryFn: async () => unwrap(await api.GET('/api/v1/workspace-capabilities')),
    staleTime: 5 * 60_000,
  });
}

export const isProcessing = (jobStatus: string | null) =>
  jobStatus === 'queued' || jobStatus === 'running' || jobStatus === 'dispatched' || jobStatus === 'retrying';

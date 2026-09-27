import { demoAreas, isDemoId, useDemoAreaStream } from './demo-import';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap, type GetResponse } from '@ulpin/api-client';
import type { BuildingImport, BuildingLedger, DocumentPages, FileDetection, ImportBatch, LevelReview, RegisterRequest, RequestState, WorkBoard } from '@ulpin/api-client/draft';

export type WorkQueue = GetResponse<'/api/v1/work-queue'>;
export type WorkItem = WorkQueue['items'][number];
export type WorkStatusFilter = 'all' | 'processing' | 'recorded';
export type Area = GetResponse<'/api/v1/areas'>[number];
export type AreaContext = GetResponse<'/api/v1/areas/{areaId}/context'>;
export type AreaFeature = AreaContext['features'][number];
export type Capabilities = GetResponse<'/api/v1/workspace-capabilities'>;
/** The JSON form of the register (the endpoint also serves CSV and HTML exports). */
export type BuildingRegister = Extract<GetResponse<'/api/v1/buildings/{buildingId}/register'>, { register: unknown }>;
export type RegisterRecord = BuildingRegister['register'][number];
export type RegisterSource = BuildingRegister['sources'][number];

/** Published identifier resolver; keeps ULPIN and registry associations on the backend. */
export function useMapIdentifierSearch(identifier: string) {
  return useQuery({
    queryKey: ['map-identifier-search', identifier],
    enabled: identifier.length >= 3,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/resolve', {
      params: { query: { identifier } }, signal,
    })),
    staleTime: 30_000,
    retry: false,
  });
}

export const queryKeys = {
  workQueue: (status: WorkStatusFilter, q: string, page: number) => ['work-queue', status, q, page] as const,
  areas: ['areas'] as const,
  areaContext: (areaId: string) => ['areas', areaId, 'context'] as const,
  capabilities: ['workspace-capabilities'] as const,
  register: (buildingId: string) => ['buildings', buildingId, 'register'] as const,
  ledger: (buildingId: string) => ['buildings', buildingId, 'ledger'] as const,
  workBoard: ['work-board'] as const,
  levelReview: (buildingId: string, levelId: string) => ['buildings', buildingId, 'levels', levelId, 'review'] as const,
  documentPages: (sourceId: string) => ['sources', sourceId, 'pages'] as const,
};

/** Draft routes (not in the OpenAPI document yet): same client conventions, typed by the draft contract. */
async function getDraft<T>(path: string): Promise<T | null> {
  const response = await globalThis.fetch(path, { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, path, await response.json().catch(() => null));
  return (await response.json()) as T;
}

/** Rights, areas, shares, readiness, checks and history of a building. Null when the backend has none. */
export function useBuildingLedger(buildingId: string | null | undefined, live = false) {
  return useQuery({
    queryKey: queryKeys.ledger(buildingId ?? ''),
    enabled: Boolean(buildingId),
    queryFn: () => getDraft<BuildingLedger>(`/api/v1/buildings/${buildingId}/ledger`),
    staleTime: 60_000,
    refetchInterval: live ? 700 : false,
  });
}

/** What an officer reviews on one level: room candidates from a plan page, or a level question. */
export function useLevelReview(buildingId: string | null | undefined, levelId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.levelReview(buildingId ?? '', levelId ?? ''),
    enabled: Boolean(buildingId && levelId),
    queryFn: () => getDraft<LevelReview>(`/api/v1/buildings/${buildingId}/levels/${levelId}/review`),
    staleTime: 60_000,
  });
}

/** Page list of a retained document. Null for sources that are not paged documents (tables, features). */
export function useDocumentPages(sourceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.documentPages(sourceId ?? ''),
    enabled: Boolean(sourceId),
    queryFn: () => getDraft<DocumentPages>(`/api/v1/sources/${sourceId}/pages`).catch(() => null),
    staleTime: Infinity,
  });
}

/** Page render as an object URL (fetched, so the local layer answers it even without a service worker). */
export function usePageImage(url: string | null | undefined) {
  return useQuery({
    queryKey: ['page-image', url ?? ''],
    enabled: Boolean(url),
    queryFn: async () => {
      const response = await globalThis.fetch(url!);
      if (!response.ok) throw new ApiError(response.status, url!, null);
      // Any image type the document service renders (SVG, PNG); kept for the session.
      return URL.createObjectURL(await response.blob());
    },
    staleTime: Infinity,
  });
}

/** A saved import batch: what was found in each file and the questions still open. */
export function useImportBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ['import-batches', batchId ?? ''],
    enabled: Boolean(batchId),
    queryFn: () => getDraft<ImportBatch>(`/api/v1/import-batches/${batchId}`),
  });
}

export function useWorkBoard() {
  return useQuery({ queryKey: queryKeys.workBoard, queryFn: () => getDraft<WorkBoard>('/api/v1/work-board'), staleTime: 30_000 });
}

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
  return useQuery({ queryKey: queryKeys.areas, queryFn: async () => [...unwrap(await api.GET('/api/v1/areas')), ...await demoAreas()], staleTime: 60_000 });
}

/** `live`: an import into this area is streaming, so poll until it settles (SSE replaces this later). */
export function useAreaContext(areaId: string | undefined, live = false) {
  useDemoAreaStream(areaId);
  return useQuery({
    queryKey: queryKeys.areaContext(areaId ?? ''),
    enabled: Boolean(areaId) && !isDemoId(areaId),
    queryFn: async () => unwrap(await api.GET('/api/v1/areas/{areaId}/context', { params: { path: { areaId: areaId! } } })),
    staleTime: 60_000,
    refetchInterval: live && !isDemoId(areaId) ? 700 : false,
  });
}

export function useBuildingRegister(buildingId: string | null | undefined, live = false) {
  return useQuery({
    queryKey: queryKeys.register(buildingId ?? ''),
    enabled: Boolean(buildingId),
    queryFn: async (): Promise<BuildingRegister> => {
      const result = unwrap(await api.GET('/api/v1/buildings/{buildingId}/register', { params: { path: { buildingId: buildingId! } } }));
      if (typeof result !== 'object' || result === null || !('register' in result)) {
        throw new Error('The API returned an unexpected building register profile.');
      }
      return result;
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: live ? 700 : false,
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

/** Building documents: what each file is (before import). */
export async function detectBuildingFiles(buildingId: string, files: File[]): Promise<FileDetection[]> {
  const body = new FormData();
  for (const f of files) body.append('file', f);
  const response = await globalThis.fetch(`/api/v1/buildings/${buildingId}/imports/inspect`, { method: 'POST', body });
  if (!response.ok) throw new ApiError(response.status, 'inspect', await response.json().catch(() => null));
  return (await response.json()) as FileDetection[];
}

export async function startBuildingImport(buildingId: string, files: File[]): Promise<BuildingImport> {
  const body = new FormData();
  for (const f of files) body.append('file', f);
  const response = await globalThis.fetch(`/api/v1/buildings/${buildingId}/imports`, { method: 'POST', body });
  if (!response.ok) throw new ApiError(response.status, 'import', await response.json().catch(() => null));
  return (await response.json()) as BuildingImport;
}

/** Progress of a building import; polls while it runs. */
export function useBuildingImport(importId: string | null) {
  return useQuery({
    queryKey: ['building-imports', importId ?? ''],
    enabled: Boolean(importId),
    queryFn: () => getDraft<BuildingImport>(`/api/v1/building-imports/${importId}`),
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 700 : false),
  });
}

/** The proposed 3D ULPIN the area import allotted a building (absent on sources that carry none). */
export const featureCode = (feature: AreaFeature | null | undefined): string | null =>
  ((feature as { projectCode?: string } | null | undefined)?.projectCode) ?? null;

// ------------------------------------------------------------------ requests from the public (REQUEST-01)
export type RequestFilter = 'open' | 'accepted' | 'rejected' | 'all';

export function useRegisterRequests(filter: RequestFilter) {
  return useQuery({
    queryKey: ['register-requests', filter],
    queryFn: async () => (await getDraft<RegisterRequest[]>(`/api/v1/register-requests?state=${filter}`)) ?? [],
    // New requests from the portal show up without a reload.
    refetchInterval: 3000,
  });
}

export async function decideRegisterRequest(ref: string, state: RequestState, note: string | null): Promise<RegisterRequest> {
  const response = await globalThis.fetch(`/api/v1/register-requests/${encodeURIComponent(ref)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, note }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { message?: string } | null)?.message ?? `Could not update the request (${response.status}).`);
  return body as RegisterRequest;
}

// ------------------------------------------------------------------ deletion
async function remove(path: string) {
  const response = await globalThis.fetch(path, { method: 'DELETE' });
  if (!response.ok && response.status !== 204) throw new ApiError(response.status, path, await response.json().catch(() => null));
}
export const deleteBuilding = (buildingId: string) => remove(`/api/v1/buildings/${buildingId}`);
export const deleteArea = (areaId: string) => remove(`/api/v1/areas/${areaId}`);

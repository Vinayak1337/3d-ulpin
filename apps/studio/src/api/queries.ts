import { ledgerFromPublished } from './ledger';
import { demoAreas, isDemoId, useDemoAreaStream } from './demo-import';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap, type GetResponse, type paths } from '@ulpin/api-client';
import type { BuildingImport, DocumentPages, FileDetection, ImportBatch, LevelReview, RegisterRequest, RequestState, WorkBoard, BuildingResidents } from '@ulpin/api-client/draft';

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
export type SpatialMlBatch = GetResponse<'/api/v1/spatial-ml/batches/{batchId}'>;
export type SpatialMlItem = GetResponse<'/api/v1/spatial-ml/items/{itemId}'>;
export type ImportPackage = GetResponse<'/api/v1/import-packages/{packageId}'>;
export type BuildingSnapshots = GetResponse<'/api/v1/buildings/{buildingId}/snapshots'>;
type CardListResponse = paths['/api/v1/usp/property-cards/list']['post']['responses'][200];
export type ListedCard = CardListResponse['content']['application/json']['data']['items'][number];
const CARD_VERIFICATION_PATH = '/api/v1/usp/property-cards/{cardId}/revisions/{revision}/verification';
export type CardVerification = GetResponse<typeof CARD_VERIFICATION_PATH>['data'];
export type IdentityReviews = GetResponse<'/api/v1/usp/identity/records/{recordId}/reviews'>;
export type IdentityReview = IdentityReviews['items'][number];
type PostOf<P extends keyof paths> = paths[P] extends { post: infer Operation } ? Operation : never;
type JsonOf<T> = T extends { content: { 'application/json': infer Body } } ? Body : never;
/** The request body of a published POST route, straight from the OpenAPI document. */
export type PostBody<P extends keyof paths> = PostOf<P> extends { requestBody: infer R } ? JsonOf<R> : never;
/** The `data` a published POST route answers with 200, straight from the OpenAPI document. */
export type PostData<P extends keyof paths> = PostOf<P> extends { responses: { 200: infer R } }
  ? JsonOf<R> extends { data: infer Data } ? Data : never
  : never;

/** What the registry lists as the cards of one unit, and how far the search for them went. */
export interface UnitCards {
  /** When the snapshot whose scope listed the cards was created; null when no scope tried lists a card. */
  snapshotCreatedAt: string | null;
  cards: ListedCard[];
  /** The server holds more cards under that scope than the page it returned. */
  truncated: boolean;
  /** With no card listed: false when the building has snapshots the search did not try (older, or unreadable). */
  searchedAll: boolean;
}

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
  areaCanonical: (areaId: string) => ['areas', areaId, 'canonical'] as const,
  buildingCanonical: (buildingId: string) => ['buildings', buildingId, 'canonical'] as const,
  buildingSnapshots: (buildingId: string) => ['buildings', buildingId, 'snapshots'] as const,
  unitCards: (buildingId: string, spaceId: string) => ['buildings', buildingId, 'units', spaceId, 'cards'] as const,
  cardVerification: (cardId: string, revision: number) => ['property-cards', cardId, revision, 'verification'] as const,
  unitReviews: (recordId: string) => ['identity', 'records', recordId, 'reviews'] as const,
  capabilities: ['workspace-capabilities'] as const,
  register: (buildingId: string) => ['buildings', buildingId, 'register'] as const,
  ledger: (buildingId: string) => ['buildings', buildingId, 'ledger'] as const,
  residents: (buildingId: string) => ['buildings', buildingId, 'residents'] as const,
  workBoard: ['work-board'] as const,
  levelReview: (buildingId: string, levelId: string) => ['buildings', buildingId, 'levels', levelId, 'review'] as const,
  documentPages: (sourceId: string) => ['sources', sourceId, 'pages'] as const,
  spatialMlBatch: (batchId: string) => ['spatial-ml', 'batches', batchId] as const,
  spatialMlItem: (itemId: string) => ['spatial-ml', 'items', itemId] as const,
  importPackage: (packageId: string) => ['import-packages', packageId] as const,
};

/** Draft routes (not in the OpenAPI document yet): same client conventions, typed by the draft contract. */
async function getDraft<T>(path: string): Promise<T | null> {
  const response = await globalThis.fetch(path, { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, path, await response.json().catch(() => null));
  return (await response.json()) as T;
}

/** The published ledger in the shape the screens read. Null when the backend has no such building. */
export function useBuildingLedger(buildingId: string | null | undefined, live = false) {
  return useQuery({
    queryKey: queryKeys.ledger(buildingId ?? ''),
    enabled: Boolean(buildingId),
    queryFn: async ({ signal }) => {
      const result = await api.GET('/api/v1/buildings/{buildingId}/ledger', { params: { path: { buildingId: buildingId! } }, signal });
      return result.response.status === 404 ? null : ledgerFromPublished(unwrap(result));
    },
    staleTime: 60_000,
    refetchInterval: live ? 700 : false,
  });
}

/** Registered holders and occupants of each unit. Null when no register extract exists. */
export function useBuildingResidents(buildingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.residents(buildingId ?? ''),
    enabled: Boolean(buildingId),
    queryFn: () => getDraft<BuildingResidents>(`/api/v1/buildings/${buildingId}/residents`),
    staleTime: 60_000,
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
  return useQuery({ queryKey: queryKeys.areas, queryFn: async () => {
    // Uploaded areas stay listed when the registry API is unavailable; registry areas need it.
    const [registry, uploaded] = await Promise.allSettled([api.GET('/api/v1/areas').then(unwrap), demoAreas()]);
    if (registry.status === 'rejected' && (uploaded.status === 'rejected' || !uploaded.value.length)) throw registry.reason;
    return [...(registry.status === 'fulfilled' ? registry.value : []), ...(uploaded.status === 'fulfilled' ? uploaded.value : [])];
  }, staleTime: 60_000 });
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

/** The canonical area record in local metres: what the scene draws. Locally uploaded areas have none. */
export function useAreaCanonical(areaId: string | undefined, live = false) {
  return useQuery({
    queryKey: queryKeys.areaCanonical(areaId ?? ''),
    enabled: Boolean(areaId) && !isDemoId(areaId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/areas/{areaId}/canonical', { params: { path: { areaId: areaId! } }, signal })),
    staleTime: 60_000,
    refetchInterval: live ? 700 : false,
  });
}

/** The canonical record of one building: state, gaps, levels and spaces. */
export function useBuildingCanonical(buildingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.buildingCanonical(buildingId ?? ''),
    enabled: Boolean(buildingId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/buildings/{buildingId}/canonical', { params: { path: { buildingId: buildingId! } }, signal })),
    staleTime: 60_000,
  });
}

// A recorded unit is a registry record; the card list names it by that namespace and its id.
const UNIT_NAMESPACE = 'registry_record';
const CARD_PAGE_SIZE = 20;

/** The recorded snapshots that hold a building, newest first: the server's default page of five. */
const buildingSnapshotsQuery = (buildingId: string) => ({
  queryKey: queryKeys.buildingSnapshots(buildingId),
  queryFn: async () => unwrap(await api.GET('/api/v1/buildings/{buildingId}/snapshots', {
    params: { path: { buildingId } },
  })),
  staleTime: 60_000,
});

/** Passes each listed scope on unchanged, newest first, and stops at the first that lists a card of the unit. */
async function listUnitCards(snapshots: BuildingSnapshots, spaceId: string, signal: AbortSignal): Promise<UnitCards> {
  for (const snapshot of snapshots.items) {
    const page = unwrap(await api.POST('/api/v1/usp/property-cards/list', {
      body: { scope: snapshot.scope, target: { namespace: UNIT_NAMESPACE, id: spaceId }, limit: CARD_PAGE_SIZE },
      signal,
    })).data;
    if (page.items.length) {
      return { snapshotCreatedAt: snapshot.createdAt, cards: page.items, truncated: page.truncated, searchedAll: true };
    }
  }
  const searchedAll = !snapshots.truncated && snapshots.unreadable === 0;
  return { snapshotCreatedAt: null, cards: [], truncated: false, searchedAll };
}

/**
 * The property cards the registry lists for one recorded unit. The snapshots of a building are read once and
 * shared by its units; a refusal of either read fails the query and is never answered as an empty list.
 */
export function useUnitCards(
  buildingId: string | null | undefined, spaceId: string | null | undefined, enabled = true,
) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.unitCards(buildingId ?? '', spaceId ?? ''),
    enabled: enabled && Boolean(buildingId && spaceId),
    queryFn: async ({ signal }) => listUnitCards(
      await client.fetchQuery(buildingSnapshotsQuery(buildingId!)), spaceId!, signal,
    ),
    staleTime: 60_000,
  });
}

/** The server's verification report of one exact card revision. Asked again on every visit to its page. */
export function useCardVerification(cardId: string | null, revision: number | null) {
  return useQuery({
    queryKey: queryKeys.cardVerification(cardId ?? '', revision ?? 0),
    enabled: Boolean(cardId && revision),
    queryFn: async ({ signal }) => unwrap(await api.GET(CARD_VERIFICATION_PATH, {
      params: { path: { cardId: cardId!, revision: String(revision) } }, signal,
    })).data,
    staleTime: 0,
  });
}

/** The identity reviews that name one recorded unit, newest first: the server's default page of five. */
export const unitReviewsQuery = (recordId: string) => ({
  queryKey: queryKeys.unitReviews(recordId),
  queryFn: async () => unwrap(await api.GET('/api/v1/usp/identity/records/{recordId}/reviews', {
    params: { path: { recordId } },
  })),
  staleTime: 0,
});

/** The reviews of one unit, asked again whenever its block is shown: an assignment must name the newest one. */
export function useUnitReviews(recordId: string, enabled = true) {
  return useQuery({ ...unitReviewsQuery(recordId), enabled });
}

/** Stores a snapshot of the site that pins the named records; its answered scope is passed on unchanged. */
export async function captureSnapshot(body: PostBody<'/api/v1/usp/snapshots'>) {
  return unwrap(await api.POST('/api/v1/usp/snapshots', { body })).data;
}

/** Stores an identity review under a captured scope. It changes no record until an assignment names it. */
export async function recordIdentityReview(body: PostBody<'/api/v1/usp/identity/reviews'>) {
  return unwrap(await api.POST('/api/v1/usp/identity/reviews', { body })).data;
}

/** Assigns the application code a stored review allows. The same key with the same body answers the same receipt. */
export async function assignCode(body: PostBody<'/api/v1/usp/identity/assign'>) {
  return unwrap(await api.POST('/api/v1/usp/identity/assign', { body })).data;
}

/** Reads the recorded citation a plan for this unit may include, with the handle the plan names. Stores nothing. */
export async function readPlanEntries(body: PostBody<'/api/v1/usp/packets/plans/entries'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/entries', { body })).data;
}

/** Stores a plan of the citations a packet of this unit will hold. */
export async function createPlan(body: PostBody<'/api/v1/usp/packets/plans/create'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/create', { body })).data;
}

/** Stores the confirmation that the plan was reviewed; a plan is executed under its confirmation only. */
export async function confirmPlan(body: PostBody<'/api/v1/usp/packets/plans/confirm'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/confirm', { body })).data;
}

/** Stores the packet of a confirmed plan. A card is issued from an executed plan only. */
export async function executePlan(body: PostBody<'/api/v1/usp/packets/plans/execute'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/execute', { body })).data;
}

/** Reads one stored card revision: its plan and the snapshot a further revision must name. Stores nothing. */
export async function readCard(body: PostBody<'/api/v1/usp/property-cards/read'>) {
  return unwrap(await api.POST('/api/v1/usp/property-cards/read', { body })).data;
}

/** Reads the rows a card of this executed plan would state, and the revision it would be. Stores nothing. */
export async function previewCard(body: PostBody<'/api/v1/usp/property-cards/preview'>) {
  return unwrap(await api.POST('/api/v1/usp/property-cards/preview', { body })).data;
}

/** Stores the card. The same key with the same body answers the same card. */
export async function generateCard(body: PostBody<'/api/v1/usp/property-cards/generate'>) {
  return unwrap(await api.POST('/api/v1/usp/property-cards/generate', { body })).data;
}

/** One retained inference batch with its items: model, state and the decisions already applied. */
export function useSpatialMlBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.spatialMlBatch(batchId ?? ''),
    enabled: Boolean(batchId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/spatial-ml/batches/{batchId}', {
      params: { path: { batchId: batchId! } }, signal,
    })),
    staleTime: 30_000,
  });
}

/** One inference item: its batch, the package it was run for, the model receipt and any footprint drafts. */
export function useSpatialMlItem(itemId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.spatialMlItem(itemId ?? ''),
    enabled: Boolean(itemId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/spatial-ml/items/{itemId}', {
      params: { path: { itemId: itemId! } }, signal,
    })),
    staleTime: 30_000,
  });
}

/** An import package: its revision is what a decision on its candidates must quote. */
export function useImportPackage(packageId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.importPackage(packageId ?? ''),
    enabled: Boolean(packageId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/import-packages/{packageId}', {
      params: { path: { packageId: packageId! } }, signal,
    })),
    staleTime: 30_000,
  });
}

/** Several import packages at once, for example every footprint draft an inference item has produced. */
export function useImportPackages(packageIds: readonly string[]) {
  return useQueries({
    queries: packageIds.map((packageId) => ({
      queryKey: queryKeys.importPackage(packageId),
      queryFn: async ({ signal }: { signal: AbortSignal }) => unwrap(
        await api.GET('/api/v1/import-packages/{packageId}', { params: { path: { packageId } }, signal }),
      ),
      staleTime: 30_000,
    })),
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

export function useRegisterRequests(filter: RequestFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['register-requests', filter],
    // A caller on a build that does not serve the route passes `enabled: false`: it asks and refetches nothing.
    enabled: options.enabled ?? true,
    queryFn: () => getDraft<RegisterRequest[]>(`/api/v1/register-requests?state=${filter}`),
    // New requests from the portal show up without a reload; a missing route is not asked again.
    refetchInterval: (query) => (query.state.data === null ? false : 3000),
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

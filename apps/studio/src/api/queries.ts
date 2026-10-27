import { ledgerFromPublished } from './ledger';
import { demoAreas, isDemoId, useDemoAreaStream } from './demo-import';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap, type GetResponse, type paths } from '@ulpin/api-client';
import type { BuildingImport, DocumentPages, FileDetection, ImportBatch, LevelReview, RegisterRequest, RequestState, BuildingResidents } from '@ulpin/api-client/draft';

export type WorkQueue = GetResponse<'/api/v1/work-queue'>;
export type WorkItem = WorkQueue['items'][number];
export type WorkStatusFilter = 'all' | 'processing' | 'recorded';
export type Area = GetResponse<'/api/v1/areas'>[number];
export type AreaContext = GetResponse<'/api/v1/areas/{areaId}/context'>;
export type AreaFeature = AreaContext['displayFeatures'][number];
export type AreaDisplaySummary = GetResponse<'/api/v1/areas/{areaId}/display-summary'>;
export type AreaDisplayWindow = GetResponse<'/api/v1/areas/{areaId}/display-window'>;
export type AreaWindowFeature = AreaDisplayWindow['features'][number];
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

type CardPage = CardListResponse['content']['application/json']['data'];

/** The card read of one listed snapshot: the page its scope answered, or null when that read failed. */
export interface SnapshotCardRead {
  createdAt: string;
  page: Pick<CardPage, 'items' | 'truncated'> | null;
}

/** What the registry lists as the cards of one unit, and how far the search for them went. */
export interface UnitCards {
  /** When the newest snapshot whose scope lists a card was created; null when no scope read lists one. */
  snapshotCreatedAt: string | null;
  /** Every card revision the snapshots read list for the unit, once each, newest snapshot first. */
  cards: ListedCard[];
  /** The server holds more cards under one of those scopes than the page it returned. */
  truncated: boolean;
  /** False when the building has snapshots that were not read: `unlisted` ones, or ones whose card read failed. */
  searchedAll: boolean;
  /** The building has snapshots the listing did not return: older than its one page, or unreadable. */
  unlisted: boolean;
  /** How many snapshots the listing returned. */
  snapshots: number;
  /** How many of those snapshots' card reads failed. */
  unread: number;
}

/**
 * The card reads of the listed snapshots as one list. A scope lists every card of a unit it holds, so the same
 * revision arrives under several snapshots: it is kept once, where the newest snapshot lists it. A failed read
 * is counted, never dropped, and leaves the search short.
 */
export function mergeUnitCards(
  reads: readonly SnapshotCardRead[], listing: Pick<BuildingSnapshots, 'truncated' | 'unreadable'>,
): UnitCards {
  const listed = new Map<string, ListedCard>();
  for (const card of reads.flatMap((read) => read.page?.items ?? [])) {
    const key = `${card.cardId}:${card.revision}`;
    if (!listed.has(key)) listed.set(key, card);
  }
  const unread = reads.filter((read) => !read.page).length;
  const unlisted = listing.truncated || listing.unreadable > 0;
  return {
    snapshotCreatedAt: reads.find((read) => read.page?.items.length)?.createdAt ?? null,
    cards: [...listed.values()],
    truncated: reads.some((read) => read.page?.truncated),
    searchedAll: !unlisted && unread === 0,
    unlisted,
    snapshots: reads.length,
    unread,
  };
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
  areaDisplaySummary: (areaId: string) => ['areas', areaId, 'display-summary'] as const,
  buildingCanonical: (buildingId: string) => ['buildings', buildingId, 'canonical'] as const,
  buildingSnapshots: (buildingId: string) => ['buildings', buildingId, 'snapshots'] as const,
  unitCards: (buildingId: string, spaceId: string) => ['buildings', buildingId, 'units', spaceId, 'cards'] as const,
  cardVerification: (cardId: string, revision: number) => ['property-cards', cardId, revision, 'verification'] as const,
  unitReviews: (recordId: string) => ['identity', 'records', recordId, 'reviews'] as const,
  capabilities: ['workspace-capabilities'] as const,
  register: (buildingId: string) => ['buildings', buildingId, 'register'] as const,
  ledger: (buildingId: string) => ['buildings', buildingId, 'ledger'] as const,
  residents: (buildingId: string) => ['buildings', buildingId, 'residents'] as const,
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

export function useWorkQueue(status: WorkStatusFilter, q: string, page: number) {
  return useQuery({
    queryKey: queryKeys.workQueue(status, q, page),
    queryFn: async () => unwrap(await api.GET('/api/v1/work-queue', { params: { query: { status, q: q || undefined, page } } })),
    placeholderData: keepPreviousData,
    // Poll while anything is processing; the frame's first page also polls slowly for its tab dot and news.
    refetchInterval: (query) => {
      if (query.state.data?.items.some((item) => isProcessing(item.jobStatus))) return 4000;
      return status === 'all' && !q && page === 1 ? 15_000 : false;
    },
    refetchIntervalInBackground: false,
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

/**
 * How often a live area is read again. Both reads are large (the context of the demo area is tens of megabytes),
 * and React Query never overlaps them: an interval tick while the previous read of the same query is still
 * running joins that read instead of starting another (query-core `Query.fetch`: a fetch that is not idle is
 * returned as is unless `cancelRefetch` is asked, and the interval never asks it).
 */
export const AREA_LIVE_REFRESH_MS = 5000;

/**
 * Whether the import package `packageId` is still streaming into the area the context describes: it is listed as
 * RECEIVED, or the area has no read made since the package was opened (`fresh`). A read cached from before may
 * predate the package. The context lists the area's newest packages and the map opens a package only once it
 * exists, so a package a fresh read does not list is an older one that has settled.
 */
export function packageStreaming(context: Pick<AreaContext, 'packages'> | undefined, packageId: string, fresh = true) {
  if (!context || !fresh) return true;
  return context.packages.some((pkg) => pkg.id === packageId && pkg.state === 'RECEIVED');
}

/**
 * `live`: true reads the area again until the page closes; a package id reads it again only while that package
 * streams, so the reads stop with the read that reports the package settled, whatever the URL still says. A
 * package is opened at `openedAt`: the area is read afresh then, and only reads made since then can settle it.
 */
export const areaContextQuery = (areaId: string | undefined, live: boolean | string | null, openedAt = 0) => ({
  queryKey: queryKeys.areaContext(areaId ?? ''),
  enabled: Boolean(areaId) && !isDemoId(areaId),
  queryFn: async () => unwrap(await api.GET('/api/v1/areas/{areaId}/context', {
    params: { path: { areaId: areaId! } },
  })),
  staleTime: 60_000,
  refetchOnMount: typeof live === 'string' ? 'always' as const : true,
  refetchInterval: ({ state }: { state: { data?: unknown; dataUpdatedAt: number } }) => (
    !isDemoId(areaId) && (typeof live === 'string'
      ? packageStreaming(state.data as AreaContext | undefined, live, state.dataUpdatedAt >= openedAt) : live)
      ? AREA_LIVE_REFRESH_MS : false as const),
});

/** `live`: an import into this area is streaming, so poll until it settles (SSE replaces this later). */
export function useAreaContext(areaId: string | undefined, live: boolean | string | null = false, openedAt = 0) {
  useDemoAreaStream(areaId);
  return useQuery(areaContextQuery(areaId, live, openedAt));
}

export const areaCanonicalQuery = (areaId: string | undefined, live: boolean) => ({
  queryKey: queryKeys.areaCanonical(areaId ?? ''),
  enabled: Boolean(areaId) && !isDemoId(areaId),
  queryFn: async ({ signal }: { signal: AbortSignal }) => unwrap(await api.GET('/api/v1/areas/{areaId}/canonical', {
    params: { path: { areaId: areaId! } }, signal,
  })),
  staleTime: 60_000,
  refetchInterval: live ? AREA_LIVE_REFRESH_MS : false as const,
});

/** The canonical area record in local metres: what the scene draws. Locally uploaded areas have none. */
export function useAreaCanonical(areaId: string | undefined, live = false) {
  return useQuery(areaCanonicalQuery(areaId, live));
}

/** How many features an area beyond the display limit holds and their extent in local metres. */
export function useAreaDisplaySummary(areaId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.areaDisplaySummary(areaId ?? ''),
    enabled: Boolean(areaId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/areas/{areaId}/display-summary', {
      params: { path: { areaId: areaId! } }, signal,
    })),
    staleTime: 60_000,
  });
}

/** One keyset page of the features meeting a window of the area, in its local metres. */
export async function readAreaWindow(
  areaId: string, [minX, minY, maxX, maxY]: readonly [number, number, number, number], after: string | undefined,
  limit: number, signal: AbortSignal,
): Promise<AreaDisplayWindow> {
  return unwrap(await api.GET('/api/v1/areas/{areaId}/display-window', {
    params: { path: { areaId }, query: { minX, minY, maxX, maxY, after, limit } }, signal,
  }));
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

/**
 * Passes each scope of the listing's one page on unchanged, newest first and one read at a time. A read that
 * fails is kept as failed; when every read fails the first failure is thrown, so nothing is answered as empty.
 */
async function listUnitCards(snapshots: BuildingSnapshots, spaceId: string, signal: AbortSignal): Promise<UnitCards> {
  const reads: SnapshotCardRead[] = [];
  let failure: unknown = null;
  for (const { scope, createdAt } of snapshots.items) {
    try {
      const page = unwrap(await api.POST('/api/v1/usp/property-cards/list', {
        body: { scope, target: { namespace: UNIT_NAMESPACE, id: spaceId }, limit: CARD_PAGE_SIZE }, signal,
      })).data;
      reads.push({ createdAt, page });
    } catch (error) {
      if (signal.aborted) throw error;
      failure ??= error;
      reads.push({ createdAt, page: null });
    }
  }
  if (failure && reads.every((read) => !read.page)) throw failure;
  return mergeUnitCards(reads, snapshots);
}

/**
 * The property cards the registry lists for one recorded unit, across the snapshots the listing returns. The
 * snapshots of a building are read once and shared by its units. A refusal of the listing, or of every card
 * read, fails the query; a card read that fails beside one that answers is counted in the answer.
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
  return unwrap(await api.POST('/api/v1/usp/packets/plans/entries', {
    body: { scope: body.scope, target: body.target },
  })).data;
}

/** Stores a plan of the citations a packet of this unit will hold. */
export async function createPlan(body: PostBody<'/api/v1/usp/packets/plans/create'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/create', {
    body: { input: body.input, guard: body.guard },
  })).data;
}

/** Stores the confirmation that the plan was reviewed; a plan is executed under its confirmation only. */
export async function confirmPlan(body: PostBody<'/api/v1/usp/packets/plans/confirm'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/confirm', {
    body: { planId: body.planId, version: body.version, planSha256: body.planSha256,
      reviewed: body.reviewed, guard: body.guard },
  })).data;
}

/** Stores the packet of a confirmed plan. A card is issued from an executed plan only. */
export async function executePlan(body: PostBody<'/api/v1/usp/packets/plans/execute'>) {
  return unwrap(await api.POST('/api/v1/usp/packets/plans/execute', {
    body: { planId: body.planId, version: body.version, confirmationId: body.confirmationId, guard: body.guard },
  })).data;
}

/** Reads one stored card revision: its plan and the snapshot a further revision must name. Stores nothing. */
export async function readCard(body: PostBody<'/api/v1/usp/property-cards/read'>) {
  return unwrap(await api.POST('/api/v1/usp/property-cards/read', {
    body: { cardId: body.cardId, revision: body.revision },
  })).data;
}

/** Reads the rows a card of this executed plan would state, and the revision it would be. Stores nothing. */
export async function previewCard(body: PostBody<'/api/v1/usp/property-cards/preview'>) {
  return unwrap(await api.POST('/api/v1/usp/property-cards/preview', {
    body: { planId: body.planId, planVersion: body.planVersion, cardId: body.cardId,
      expiresAt: body.expiresAt, guard: body.guard },
  })).data;
}

/** Stores the card. The same key with the same body answers the same card. */
export async function generateCard(body: PostBody<'/api/v1/usp/property-cards/generate'>) {
  return unwrap(await api.POST('/api/v1/usp/property-cards/generate', {
    body: { planId: body.planId, planVersion: body.planVersion, cardId: body.cardId,
      expiresAt: body.expiresAt, guard: body.guard },
  })).data;
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

/** Retires an area at the revision on screen; nothing is deleted and the server records who, when and why. */
export async function retireArea(areaId: string, body: PostBody<'/api/v1/areas/{areaId}/retire'>) {
  return unwrap(await api.POST('/api/v1/areas/{areaId}/retire', { params: { path: { areaId } }, body }));
}

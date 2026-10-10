import { http, HttpResponse, passthrough } from 'msw';
import { LOCAL_SOURCE_HEADER } from '@ulpin/api-client';
import { localRoutes } from './routes';
import { buildingImport, detect, startFloorsImport } from './imports';
import { lake } from './sources';
import { storyAreas, storyBoard, storyQueueItems } from './story';
import { publicAreas, publicBuilding, publicCode, publicMap, publicRecord, publicSearch } from './public';
import { RequestError, decideRequest, fileRequest, getRequest, listRequests, trackRequest } from './requests';
import { deleteArea, deleteBuilding } from './session';
import { buildingVisible, floorsDone } from './story';
import { residentsFor } from '../../../../scripts/demo-import/sample-registry.mjs';
import { LOCAL_SOURCE_LABELS, documents, importBatches, levelReviews, workBoard, workQueue } from './sources';

const json = (body: unknown, label: string) => HttpResponse.json(body as never, { headers: { [LOCAL_SOURCE_HEADER]: label } });
const fail = (error: unknown) => {
  if (error instanceof RequestError) return HttpResponse.json({ error: error.code, message: error.message }, { status: error.status });
  throw error;
};
const LOCAL = LOCAL_SOURCE_LABELS.lake;

type Json = Record<string, unknown>;

/** City layers uploaded through the upload server, listed as import batches. */
async function uploadedQueueItems(): Promise<(Json & { id: string; areaId: string; state: string; featureCount: number })[]> {
  if (import.meta.env.VITE_DEMO_IMPORT !== '1') return [];
  try {
    const areas = (await (await fetch('/api/demo/areas')).json()) as { id: string; name: string; uploadName: string | null; createdAt: string; state: string; packageId: string; sourceCount: number; featureCount: number }[];
    return areas.map((a) => ({
      id: a.packageId, kind: 'import', name: a.uploadName ?? `${a.sourceCount} city layers`, areaId: a.id, areaName: a.name, dataKind: 'mixed', buildingId: null, sourceCount: a.sourceCount,
      updatedAt: a.createdAt, state: a.state === 'RECEIVED' ? 'RECEIVED' : 'COMMITTED', jobStatus: a.state === 'RECEIVED' ? 'running' : null,
      recordedHistory: a.state !== 'RECEIVED', currentRecorded: a.state !== 'RECEIVED', featureCount: a.featureCount,
      provenance: { classification: 'official', basis: 'Issued by the uploading office' },
    }));
  } catch { return []; }
}

type Params = Record<string, string | readonly string[] | undefined>;
/** Local answers by route path. Returning undefined means "not held locally": fall through to the API. */
const RESOLVERS: Record<string, (params: Params, url: URL, request: Request) => Response | undefined | Promise<Response | undefined>> = {
  '/api/v1/work-board': async () => {
    const uploaded = await uploadedQueueItems();
    const board = storyBoard(workBoard as never, storyQueueItems(workQueue.items)) as { items: Json[]; counts: Json[] };
    return json({ ...board, items: [...uploaded.map((u) => ({
      id: u.id, stage: u.state === 'RECEIVED' ? 'add_files' : 'recorded', detail: `${u.featureCount} features`,
      nextAction: { label: u.state === 'RECEIVED' ? 'Importing…' : 'Open the map', target: { kind: 'area', areaId: u.areaId } },
      readiness: { met: u.state === 'RECEIVED' ? 3 : 6, unknown: 0, of: 6 },
    })), ...board.items] }, LOCAL_SOURCE_LABELS.lake);
  },
  '/api/v1/buildings/:buildingId/residents': ({ buildingId }) => {
    if (String(buildingId) !== lake.register.property.id) return undefined;
    if (!buildingVisible(String(buildingId)) || !floorsDone()) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    const floors = new Map(lake.register.register.filter((r) => r.kind === 'floor').map((r) => [r.id, r.geometry?.levelLabel ?? r.name]));
    const units = lake.register.register.filter((r) => r.use === 'apartment').map((r) => ({
      spaceId: r.id, unit: r.name, level: floors.get(r.links.find((l) => l.type === 'floor')?.targetId ?? '') ?? '',
    }));
    return json(residentsFor(String(buildingId), units, { locale: 'IN', addressLine: lake.ledger.address }), LOCAL_SOURCE_LABELS.lake);
  },
  '/api/v1/buildings/:buildingId/levels/:levelId/review': ({ buildingId, levelId }) => {
    const body = levelReviews[String(levelId)];
    return body && body.buildingId === buildingId ? json(body, LOCAL_SOURCE_LABELS.lake) : undefined;
  },
  '/api/v1/buildings/:buildingId/imports/inspect': async (_p, _u, request) => {
    const files = (await request.formData()).getAll('file').filter((f): f is File => f instanceof File);
    return json(files.map((f) => detect(f.name, f.size)), LOCAL_SOURCE_LABELS.lake);
  },
  '/api/v1/buildings/:buildingId/imports': async ({ buildingId }, _u, request) => {
    if (String(buildingId) !== lake.register.property.id) return HttpResponse.json({ error: 'not_supported' }, { status: 400 });
    const files = (await request.formData()).getAll('file').filter((f): f is File => f instanceof File);
    return HttpResponse.json(startFloorsImport(String(buildingId), files.map((f) => f.name)) as never, { status: 201, headers: { [LOCAL_SOURCE_HEADER]: LOCAL_SOURCE_LABELS.lake } });
  },
  '/api/v1/building-imports/:importId': ({ importId }) => {
    const body = buildingImport(String(importId));
    return body ? json(body, LOCAL_SOURCE_LABELS.lake) : HttpResponse.json({ error: 'not_found' }, { status: 404 });
  },
  '/api/v1/import-batches/:batchId': ({ batchId }) => {
    const body = importBatches[String(batchId)];
    return body ? json(body, LOCAL_SOURCE_LABELS.lake) : undefined;
  },
  '/api/v1/sources/:sourceId/pages': ({ sourceId }) => {
    const doc = documents[String(sourceId)];
    if (!doc) return undefined;
    return json({
      sourceId, name: doc.name, revision: doc.revision, pageCount: doc.pages.length,
      pages: doc.pages.map((p) => ({ page: p.page, label: p.label, calibration: p.calibration ?? null, url: `/api/v1/sources/${String(sourceId)}/pages/${p.page}` })),
      anchors: doc.anchors.map(([locator, page, region]) => ({ locator, page, region: region ?? null })),
    }, LOCAL_SOURCE_LABELS.lake);
  },
  '/api/v1/sources/:sourceId/pages/:page': ({ sourceId, page }) => {
    const found = documents[String(sourceId)]?.pages.find((p) => String(p.page) === String(page));
    return found ? new HttpResponse(found.svg, { headers: { 'Content-Type': 'image/svg+xml', [LOCAL_SOURCE_HEADER]: LOCAL_SOURCE_LABELS.lake } }) : undefined;
  },
  '/api/v1/public/records': async (_p, url) => json(await publicSearch(url.searchParams.get('q') ?? ''), LOCAL_SOURCE_LABELS.lake),
  '/api/v1/public/records/:recordId': async ({ recordId }) => {
    const body = await publicRecord(String(recordId));
    return body ? json(body, LOCAL_SOURCE_LABELS.lake) : HttpResponse.json({ error: 'not_released' }, { status: 404 });
  },
  '/api/v1/public/buildings/:buildingId': async ({ buildingId }) => {
    const body = await publicBuilding(String(buildingId));
    return body ? json(body, LOCAL_SOURCE_LABELS.lake) : HttpResponse.json({ error: 'not_released' }, { status: 404 });
  },
  '/api/v1/public/areas': async () => json(await publicAreas(), LOCAL_SOURCE_LABELS.lake),
  '/api/v1/public/areas/:areaId/map': async ({ areaId }) => {
    const body = await publicMap(String(areaId));
    return body ? json(body, LOCAL_SOURCE_LABELS.lake) : undefined;
  },
  '/api/v1/public/codes/:code': async ({ code }) => {
    const body = await publicCode(decodeURIComponent(String(code)));
    return body ? json(body, LOCAL) : HttpResponse.json({ error: 'not_found' }, { status: 404 });
  },
  '/api/v1/public/requests': async (_p, _u, request) => {
    try { return HttpResponse.json(await fileRequest(await request.formData()) as never, { status: 201, headers: { [LOCAL_SOURCE_HEADER]: LOCAL } }); } catch (e) { return fail(e); }
  },
  '/api/v1/public/requests/track': async (_p, _u, request) => {
    const { ref, mobile } = (await request.json().catch(() => ({}))) as { ref?: string; mobile?: string };
    const body = ref && mobile ? trackRequest(ref, mobile) : undefined;
    return body ? json(body, LOCAL) : HttpResponse.json({ error: 'not_found', message: 'No request matches this reference and mobile number.' }, { status: 404 });
  },
  '/api/v1/register-requests': (_p, url) => json(listRequests(url.searchParams.get('state')), LOCAL),
  '/api/v1/register-requests/:ref': async ({ ref }, _u, request) => {
    if (request.method === 'PATCH') {
      const { state, note } = (await request.json().catch(() => ({}))) as { state?: string; note?: string };
      try { return json(decideRequest(String(ref), state as never, note ?? null), LOCAL); } catch (e) { return fail(e); }
    }
    const body = getRequest(String(ref));
    return body ? json(body, LOCAL) : HttpResponse.json({ error: 'not_found' }, { status: 404 });
  },
  '/api/v1/buildings/:buildingId': ({ buildingId }) => {
    if (!buildingVisible(String(buildingId))) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    deleteBuilding(String(buildingId));
    return new HttpResponse(null, { status: 204 });
  },
  '/api/v1/areas/:areaId': ({ areaId }) => {
    if (String(areaId) !== lake.context.area.id || !storyAreas()?.length) return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    deleteArea();
    return new HttpResponse(null, { status: 204 });
  },
};

export const handlers = localRoutes().map((route) => {
  const resolver = RESOLVERS[route.path];
  if (!resolver) throw new Error(`Local route ${route.method} ${route.path} has no resolver`);
  const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
  return http[method](route.path, async ({ params, request }) => (await resolver(params, new URL(request.url), request)) ?? passthrough());
});

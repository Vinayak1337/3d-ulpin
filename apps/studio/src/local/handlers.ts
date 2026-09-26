import { http, HttpResponse, passthrough } from 'msw';
import { LOCAL_SOURCE_HEADER } from '@ulpin/api-client';
import { localRoutes } from './routes';
import { publicAreas, publicBuilding, publicMap, publicRecord, publicSearch } from './public';
import { LOCAL_SOURCE_LABELS, derivedAreas, derivedContexts, derivedRegister, derivedSourceFiles, documents, importBatches, ledgers, levelReviews, workBoard, workQueue } from './sources';

const ALL_LOCAL = Object.values(LOCAL_SOURCE_LABELS).join('; ');
const json = (body: unknown, label: string) => HttpResponse.json(body as never, { headers: { [LOCAL_SOURCE_HEADER]: label } });

type Params = Record<string, string | readonly string[] | undefined>;
/** Local answers by route path. Returning undefined means "not held locally": fall through to the API. */
const RESOLVERS: Record<string, (params: Params, url: URL) => Response | undefined | Promise<Response | undefined>> = {
  '/api/v1/work-queue': (_params, url) => {
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const status = url.searchParams.get('status') ?? 'all';
    const items = workQueue.items.filter((item) => (!q || String(item.name).toLowerCase().includes(q) || String(item.id).includes(q))
      && (status !== 'recorded' || item.currentRecorded) && (status !== 'processing' || item.jobStatus));
    return json({ ...workQueue, total: items.length, items }, LOCAL_SOURCE_LABELS.lake);
  },
  '/api/v1/work-board': () => json(workBoard, LOCAL_SOURCE_LABELS.lake),
  '/api/v1/buildings/:buildingId/ledger': ({ buildingId }) => {
    const body = ledgers[String(buildingId)];
    return body ? json(body, LOCAL_SOURCE_LABELS.lake) : undefined;
  },
  '/api/v1/buildings/:buildingId/levels/:levelId/review': ({ buildingId, levelId }) => {
    const body = levelReviews[String(levelId)];
    return body && body.buildingId === buildingId ? json(body, LOCAL_SOURCE_LABELS.lake) : undefined;
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
  '/api/v1/areas': () => json(derivedAreas, ALL_LOCAL),
  '/api/v1/areas/:areaId/context': ({ areaId }) => {
    const body = derivedContexts[String(areaId)];
    return body ? json(body, ALL_LOCAL) : undefined;
  },
  '/api/v1/buildings/:buildingId/register': ({ buildingId }) => {
    const found = derivedRegister(String(buildingId));
    return found ? json(found.body, LOCAL_SOURCE_LABELS[found.source]) : undefined;
  },
  '/api/v1/sources/:sourceId/file': ({ sourceId }) => {
    const file = derivedSourceFiles[String(sourceId)];
    if (!file) return undefined;
    return new HttpResponse(file.body, {
      headers: {
        'Content-Type': file.type,
        'Content-Disposition': `inline; filename="${file.name.split('/').pop()}"`,
        [LOCAL_SOURCE_HEADER]: ALL_LOCAL,
      },
    });
  },
};

export const handlers = localRoutes().map((route) => {
  const resolver = RESOLVERS[route.path];
  if (!resolver) throw new Error(`Local route ${route.method} ${route.path} has no resolver`);
  const method = route.method.toLowerCase() as 'get' | 'post' | 'patch';
  return http[method](route.path, async ({ params, request }) => (await resolver(params, new URL(request.url))) ?? passthrough());
});

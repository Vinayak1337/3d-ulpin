import { http, HttpResponse, passthrough } from 'msw';
import { LOCAL_SOURCE_HEADER } from '@ulpin/api-client';
import { localRoutes } from './routes';
import { LOCAL_SOURCE_LABELS, derivedAreas, derivedContexts, derivedRegister, derivedSourceFiles, ledgers, workBoard, workQueue } from './sources';

const ALL_LOCAL = Object.values(LOCAL_SOURCE_LABELS).join('; ');
const json = (body: unknown, label: string) => HttpResponse.json(body as never, { headers: { [LOCAL_SOURCE_HEADER]: label } });

type Params = Record<string, string | readonly string[] | undefined>;
/** Local answers by route path. Returning undefined means "not held locally": fall through to the API. */
const RESOLVERS: Record<string, (params: Params, url: URL) => Response | undefined> = {
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
  return http[method](route.path, ({ params, request }) => resolver(params, new URL(request.url)) ?? passthrough());
});

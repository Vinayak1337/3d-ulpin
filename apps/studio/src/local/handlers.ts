import { http, HttpResponse, passthrough } from 'msw';
import { LOCAL_SOURCE_HEADER } from '@ulpin/api-client';
import { localRoutes } from './routes';
import { LOCAL_SOURCE_LABELS, derivedAreas, derivedContexts, derivedRegister, derivedSourceFiles } from './sources';

const ALL_LOCAL = Object.values(LOCAL_SOURCE_LABELS).join('; ');
const json = (body: unknown, label: string) => HttpResponse.json(body as never, { headers: { [LOCAL_SOURCE_HEADER]: label } });

type Params = Record<string, string | readonly string[] | undefined>;
/** Local answers by route path. Returning undefined means "not held locally": fall through to the API. */
const RESOLVERS: Record<string, (params: Params) => Response | undefined> = {
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
  return http[method](route.path, ({ params }) => resolver(params) ?? passthrough());
});

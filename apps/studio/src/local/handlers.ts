import { http, HttpResponse, passthrough } from 'msw';
import { LOCAL_SOURCE_HEADER } from '@ulpin/api-client';
import { localRoutes } from './routes';
import { LOCAL_SOURCE_LABEL, derivedAreas, derivedContexts } from './sources';

const headers = { [LOCAL_SOURCE_HEADER]: LOCAL_SOURCE_LABEL };

type Resolver = (params: Record<string, string | readonly string[] | undefined>) => unknown | undefined;

/** Local answers by route path. `undefined` means "not held locally": fall through to the API. */
const RESOLVERS: Record<string, Resolver> = {
  '/api/v1/areas': () => derivedAreas,
  '/api/v1/areas/:areaId/context': ({ areaId }) => derivedContexts[String(areaId)],
};

export const handlers = localRoutes().map((route) => {
  const resolver = RESOLVERS[route.path];
  if (!resolver) throw new Error(`Local route ${route.method} ${route.path} has no resolver`);
  const method = route.method.toLowerCase() as 'get' | 'post' | 'patch';
  return http[method](route.path, ({ params }) => {
    const body = resolver(params);
    return body === undefined ? passthrough() : HttpResponse.json(body as never, { headers });
  });
});

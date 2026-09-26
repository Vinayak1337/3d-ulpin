/**
 * The local/live route table (GOAL section 7). Every endpoint the Studio calls is listed here.
 *
 * - `live`: the request goes to the Nest API through the Vite proxy.
 * - `local`: in development, the local data layer answers with a response that matches the
 *   OpenAPI schema. Content is derived from retained official sources or created by using the
 *   app; never invented. Flip an entry to `live` when the backend endpoint is ready; screens
 *   don't change.
 */
export type RouteMode = 'live' | 'local';

export interface RouteEntry {
  method: 'GET' | 'POST' | 'PATCH';
  /** OpenAPI path with `:param` placeholders (MSW syntax). */
  path: string;
  mode: RouteMode;
  /** Why the route is local, or which backend card it waits for. */
  reason?: string;
}

export const ROUTES: RouteEntry[] = [
  { method: 'GET', path: '/api/v1/health', mode: 'live' },
  { method: 'GET', path: '/api/v1/workspace-capabilities', mode: 'live' },
  { method: 'GET', path: '/api/v1/work-queue', mode: 'live' },
  {
    method: 'GET', path: '/api/v1/areas', mode: 'local',
    reason: 'No official-source area is installed in the running API. Answers with the area derived from the retained NYC OTI Bronx crop.',
  },
  {
    method: 'GET', path: '/api/v1/areas/:areaId/context', mode: 'local',
    reason: 'Same derived NYC OTI area; unknown area IDs fall through to the live API.',
  },
];

export const localRoutes = () => ROUTES.filter((route) => route.mode === 'local');

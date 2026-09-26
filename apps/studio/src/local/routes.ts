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
  /** Not in docs/api/openapi.json yet: a draft contract in @ulpin/api-client/draft. */
  draft?: boolean;
}

export const ROUTES: RouteEntry[] = [
  { method: 'GET', path: '/api/v1/health', mode: 'live' },
  { method: 'GET', path: '/api/v1/workspace-capabilities', mode: 'live' },
  {
    method: 'GET', path: '/api/v1/work-queue', mode: 'local',
    reason: 'The linked database holds no current area work; answers with the Lake View batches.',
  },
  {
    method: 'GET', path: '/api/v1/work-board', mode: 'local', draft: true,
    reason: 'READY-01: stage, next action and readiness per work item.',
  },
  {
    method: 'GET', path: '/api/v1/buildings/:buildingId/ledger', mode: 'local', draft: true,
    reason: 'READY-01, RIGHTS-01, HISTORY-02: rights, areas, shares, readiness, checks and revisions per building.',
  },
  {
    method: 'GET', path: '/api/v1/areas', mode: 'local',
    reason: 'No area is installed in the running API. Answers with Lake View and the areas derived from retained official sources (NYC OTI Bronx crop; Swiss Dwellings site 127).',
  },
  {
    method: 'GET', path: '/api/v1/areas/:areaId/context', mode: 'local',
    reason: 'Derived NYC OTI and Swiss Dwellings areas; unknown area IDs fall through to the live API.',
  },
  {
    method: 'GET', path: '/api/v1/buildings/:buildingId/register', mode: 'local',
    reason: 'Registers for the derived buildings: the Swiss floor with its units and rooms, NYC footprints with no floors.',
  },
  {
    method: 'GET', path: '/api/v1/sources/:sourceId/file', mode: 'local',
    reason: 'Serves the retained original bytes behind the derived records, for the evidence viewer.',
  },
];

export const localRoutes = () => ROUTES.filter((route) => route.mode === 'local');

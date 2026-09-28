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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
    method: 'GET', path: '/api/v1/buildings/:buildingId/residents', mode: 'local', draft: true,
    reason: 'REGISTER-02: registered holders and occupants of each unit.',
  },
  {
    method: 'GET', path: '/api/v1/buildings/:buildingId/levels/:levelId/review', mode: 'local', draft: true,
    reason: 'EXTRACT-02: room candidates from a plan page, or the level question to confirm.',
  },
  {
    method: 'GET', path: '/api/v1/import-batches/:batchId', mode: 'local', draft: true,
    reason: 'INGEST-03: a saved import batch with detection, CRS, mapping state and open questions.',
  },
  {
    method: 'GET', path: '/api/v1/sources/:sourceId/pages', mode: 'local', draft: true,
    reason: 'DOC-01: page list, locator anchors and plan calibration of a retained document.',
  },
  {
    method: 'GET', path: '/api/v1/sources/:sourceId/pages/:page', mode: 'local', draft: true,
    reason: 'DOC-01: preview render of one page of a retained document.',
  },
  {
    method: 'GET', path: '/api/v1/public/records', mode: 'local', draft: true,
    reason: 'PUBLIC-01: search over released records only.',
  },
  {
    method: 'GET', path: '/api/v1/public/records/:recordId', mode: 'local', draft: true,
    reason: 'PUBLIC-01: the released facts of one record.',
  },
  {
    method: 'GET', path: '/api/v1/public/buildings/:buildingId', mode: 'local', draft: true,
    reason: 'PUBLIC-01: released massing and records of one building.',
  },
  {
    method: 'GET', path: '/api/v1/public/areas', mode: 'local', draft: true,
    reason: 'PUBLIC-01: areas with released records.',
  },
  {
    method: 'GET', path: '/api/v1/public/areas/:areaId/map', mode: 'local', draft: true,
    reason: 'PUBLIC-01: the public base map of an area (no utilities).',
  },
  {
    method: 'GET', path: '/api/v1/public/codes/:code', mode: 'local', draft: true,
    reason: 'PUBLIC-01: resolves a printed 3D ULPIN to its building or released unit.',
  },
  {
    method: 'POST', path: '/api/v1/public/requests', mode: 'local', draft: true,
    reason: 'REQUEST-01: a citizen asks for a building register or a record correction.',
  },
  {
    method: 'POST', path: '/api/v1/public/requests/track', mode: 'local', draft: true,
    reason: 'REQUEST-01: the applicant tracks a request by reference and mobile number.',
  },
  {
    method: 'GET', path: '/api/v1/register-requests', mode: 'local', draft: true,
    reason: 'REQUEST-01: requests from the public for officer review.',
  },
  {
    method: 'GET', path: '/api/v1/register-requests/:ref', mode: 'local', draft: true,
    reason: 'REQUEST-01: one request with the applicant\'s contact and files.',
  },
  {
    method: 'PATCH', path: '/api/v1/register-requests/:ref', mode: 'local', draft: true,
    reason: 'REQUEST-01: the officer takes up, accepts or rejects a request.',
  },
  {
    method: 'DELETE', path: '/api/v1/buildings/:buildingId', mode: 'local', draft: true,
    reason: 'Removes a building and its register from the area; the public map follows.',
  },
  {
    method: 'DELETE', path: '/api/v1/areas/:areaId', mode: 'local', draft: true,
    reason: 'Removes an imported area with its buildings; the public map follows.',
  },
  {
    method: 'POST', path: '/api/v1/import-packages/inspect', mode: 'local',
    reason: 'Reads the uploaded GIS file in the browser (count, fields, CRS) while the import worker is not linked.',
  },
  {
    method: 'POST', path: '/api/v1/import-packages', mode: 'local',
    reason: 'Starts the area import and streams its records into the area context.',
  },
  {
    method: 'GET', path: '/api/v1/import-packages/:packageId', mode: 'local',
    reason: 'Progress of the area import started here.',
  },
  {
    method: 'POST', path: '/api/v1/buildings/:buildingId/imports/inspect', mode: 'local', draft: true,
    reason: 'INGEST-04: recognises building documents (plans, level schedules, inventories, deeds).',
  },
  {
    method: 'POST', path: '/api/v1/buildings/:buildingId/imports', mode: 'local', draft: true,
    reason: 'INGEST-04: imports a building\'s documents; its levels and units stream into the register.',
  },
  {
    method: 'GET', path: '/api/v1/building-imports/:importId', mode: 'local', draft: true,
    reason: 'INGEST-04: progress of a building import.',
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

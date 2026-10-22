import { ApiError, type Schemas } from '@ulpin/api-client';
import { TABLE_PLACEMENT_UTF16 } from '@ulpin/contracts/usp';
import { layerCrsCode } from './layer-crs-command';

export type TablePlacementBody =
  Schemas['POST_ingestion_cases_caseId_intake_items_itemId_table_placement_Request_application_json'];
type Coordinates = TablePlacementBody['coordinates'];
type Choice = Pick<TablePlacementBody, 'coordinates' | 'crs'>;

/** What the officer picked: each column as its header position, '' while none is chosen, and the code as typed. */
export interface TablePlacementForm { kind: Coordinates['kind']; x: string; y: string; column: string; crs: string }
export interface TablePlacementState { busy: boolean; uncertain: boolean; error: string; started: boolean }

export const emptyTablePlacement: TablePlacementForm = { kind: 'columns', x: '', y: '', column: '', crs: '' };
export const UNSTATED_CRS = 'Which coordinate system are these coordinates in? State its EPSG code, for example '
  + 'EPSG:4326 for longitude and latitude; none is assumed.';

/** The officer's choice as the route takes it, or words naming what is still missing; nothing is filled in. */
export function tablePlacementChoice(form: TablePlacementForm): Choice | string {
  const position = (value: string) => value === '' ? null : Number(value);
  let coordinates: Coordinates;
  if (form.kind === 'columns') {
    const x = position(form.x);
    const y = position(form.y);
    if (x === null || y === null) return 'Choose the column of x or longitude and the column of y or latitude.';
    if (x === y) return 'Choose two different columns for x and y.';
    coordinates = { kind: 'columns', x, y };
  } else {
    const column = position(form.column);
    if (column === null) return 'Choose the column that holds the WKT text.';
    coordinates = { kind: 'wkt', column };
  }
  if (!form.crs.trim()) return UNSTATED_CRS;
  const crs = layerCrsCode(form.crs);
  return crs ? { coordinates, crs } : 'Write the code as EPSG and its number, for example EPSG:32643.';
}

/** TB2: words that stop placement before any press. A UTF-16 table is read as a table, but its rows are not placed. */
export function placementRefusal(selection: { format: string; encoding?: string }): string | null {
  return selection.format === 'csv' && selection.encoding?.startsWith('utf-16') ? TABLE_PLACEMENT_UTF16 : null;
}

export function tablePlacementPress(state: TablePlacementState): string {
  if (state.busy) return 'Placing…';
  if (state.uncertain) return 'Send the same answer again';
  return 'Place on the map';
}

/**
 * One request key per choice until its outcome is known, so a lost answer resends the same request; another
 * choice of columns or code is a new request with a new key.
 */
export function createTablePlacementCommand(send: (body: TablePlacementBody) => Promise<unknown>,
  changed: (state: TablePlacementState) => void, refresh: () => void,
  key: () => string = () => crypto.randomUUID()) {
  let pending: TablePlacementBody | null = null;
  let state: TablePlacementState = { busy: false, uncertain: false, error: '', started: false };
  const publish = (update: Partial<TablePlacementState>) => {
    state = { ...state, ...update };
    changed(state);
  };
  return async (form: TablePlacementForm) => {
    if (state.busy) return;
    const choice = tablePlacementChoice(form);
    if (typeof choice === 'string') {
      publish({ error: choice });
      return;
    }
    const same = pending && JSON.stringify([pending.coordinates, pending.crs])
      === JSON.stringify([choice.coordinates, choice.crs]);
    const body: TablePlacementBody = same && pending ? pending : { requestKey: key(), ...choice };
    pending = body;
    publish({ busy: true, error: '' });
    try {
      await send(body);
      pending = null;
      publish({ uncertain: false, started: true });
      refresh();
    } catch (error) {
      const definite = error instanceof ApiError && error.status < 500;
      if (definite) pending = null;
      publish({ uncertain: !definite,
        error: error instanceof Error ? error.message : 'The server gave no answer. Send the same answer again.' });
    } finally {
      publish({ busy: false });
    }
  };
}

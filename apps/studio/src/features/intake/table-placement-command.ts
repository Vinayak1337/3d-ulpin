import { ApiError, type Schemas } from '@ulpin/api-client';
import { layerCrsCode } from './layer-crs-command';

export type TablePlacementBody =
  Schemas['POST_ingestion_cases_caseId_intake_items_itemId_table_placement_Request_application_json'];
type Coordinates = TablePlacementBody['coordinates'];
type Choice = Pick<TablePlacementBody, 'coordinates' | 'crs' | 'decimalMark'>;

/**
 * What the officer picked: each column as its header position, '' while none is chosen, the code as typed and the
 * decimal mark of the x and y cells as stated, never read from the cells.
 */
export interface TablePlacementForm {
  kind: Coordinates['kind']; x: string; y: string; column: string; crs: string;
  decimalMark: TablePlacementBody['decimalMark'];
}
export interface TablePlacementState { busy: boolean; uncertain: boolean; error: string; started: boolean }

export const emptyTablePlacement: TablePlacementForm = { kind: 'columns', x: '', y: '', column: '', crs: '',
  decimalMark: 'point' };
export const UNSTATED_CRS = 'Which coordinate system are these coordinates in? State its EPSG code, for example '
  + 'EPSG:4326 for longitude and latitude; none is assumed.';

/** The officer's choice as the route takes it, or words naming what is still missing; nothing is filled in. */
export function tablePlacementChoice(form: TablePlacementForm): Choice | string {
  const position = (value: string) => value === '' ? null : Number(value);
  let coordinates: Coordinates;
  let decimalMark: Choice['decimalMark'] = 'point';
  if (form.kind === 'columns') {
    const x = position(form.x);
    const y = position(form.y);
    if (x === null || y === null) return 'Choose the column of x or longitude and the column of y or latitude.';
    if (x === y) return 'Choose two different columns for x and y.';
    coordinates = { kind: 'columns', x, y };
    decimalMark = form.decimalMark;
  } else {
    // WKT text is read with a decimal point only.
    const column = position(form.column);
    if (column === null) return 'Choose the column that holds the WKT text.';
    coordinates = { kind: 'wkt', column };
  }
  if (!form.crs.trim()) return UNSTATED_CRS;
  const crs = layerCrsCode(form.crs);
  return crs ? { coordinates, crs, decimalMark } : 'Write the code as EPSG and its number, for example EPSG:32643.';
}

export function tablePlacementPress(state: TablePlacementState): string {
  if (state.busy) return 'Placing…';
  if (state.uncertain) return 'Send the same answer again';
  return 'Place on the map';
}

/**
 * One request key per choice until its outcome is known, so a lost answer resends the same request; another
 * choice of columns, code or decimal mark is a new request with a new key.
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
    const same = pending && JSON.stringify([pending.coordinates, pending.crs, pending.decimalMark])
      === JSON.stringify([choice.coordinates, choice.crs, choice.decimalMark]);
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

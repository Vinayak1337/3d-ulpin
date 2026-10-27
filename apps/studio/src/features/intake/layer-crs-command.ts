import { ApiError, type Schemas } from '@ulpin/api-client';
import type { IntakeItem } from './batch-model';

export type LayerCrsBody =
  Schemas['POST_ingestion_cases_caseId_intake_items_itemId_layer_crs_Request_application_json'];
export type LayerCrsEntry = NonNullable<IntakeItem['layerCrs']>[number];
export interface LayerCrsState {
  busy: boolean;
  uncertain: boolean;
  error: string;
}

/** The code exactly as the route takes it; anything else is named here, never sent or guessed at. */
export function layerCrsCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^EPSG:[1-9][0-9]{0,8}$/.test(code) ? code : null;
}

export function layerCrsWords(state: LayerCrsState): string {
  if (state.busy) return 'Stating…';
  if (state.uncertain) return 'Send the same answer again';
  return 'Submit';
}

/**
 * One request key per answer until its outcome is known, so a lost answer resends the same request. A changed
 * code is a new answer with a new key.
 */
export function createLayerCrsCommand(layer: string, send: (body: LayerCrsBody) => Promise<unknown>,
  changed: (state: LayerCrsState) => void, refresh: () => void, key: () => string = () => crypto.randomUUID()) {
  let pending: LayerCrsBody | null = null;
  let state: LayerCrsState = { busy: false, uncertain: false, error: '' };
  const publish = (update: Partial<LayerCrsState>) => {
    state = { ...state, ...update };
    changed(state);
  };
  return async (value: string) => {
    if (state.busy) return;
    const crs = layerCrsCode(value);
    if (!crs) {
      publish({ error: 'Write the code as EPSG and its number, for example EPSG:32643.' });
      return;
    }
    if (pending?.crs !== crs) pending = { requestKey: key(), layer, crs };
    publish({ busy: true, error: '' });
    try {
      await send(pending);
      pending = null;
      publish({ uncertain: false });
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

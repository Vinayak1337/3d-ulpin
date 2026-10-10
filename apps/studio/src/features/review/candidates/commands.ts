import { api, ApiError, unwrap } from '@ulpin/api-client';
import type { AttachLevelBody, FootprintDraftBody } from './decisions';

/** Accepted and rejected roofprints of one image: the same command K2c used. It creates a draft, never a record. */
export async function recordRoofprintDecisions(itemId: string, body: FootprintDraftBody) {
  return unwrap(await api.POST('/api/v1/spatial-ml/items/{itemId}/footprint-drafts', {
    params: { path: { itemId } },
    body,
  }));
}

/** Attach a room candidate to an existing reviewed level. The key travels as the idempotency header too. */
export async function attachRoomToLevel(buildingId: string, body: AttachLevelBody) {
  return unwrap(await api.POST('/api/v1/buildings/{buildingId}/candidates', {
    params: { path: { buildingId }, header: { 'Idempotency-Key': body.requestKey } },
    body,
  }));
}

/**
 * Ask the registry to review a roofprint draft. Registry admission of model roofprints is deferred until after
 * the demo (docs/evidence/gf-backend/k2f/admission-decision.md), so the review refuses the unqualified payload
 * and the refusal is shown as it is.
 */
export async function reviewDraftForRegistry(packageId: string, expectedRevision: number) {
  return unwrap(await api.POST('/api/v1/import-packages/{packageId}/review', {
    params: { path: { packageId } },
    body: { expectedRevision },
  }));
}

export interface Refusal {
  code: string | null;
  message: string;
}

/** The server's own words for a refused command: `{ error: { code, message } }` or a validation message. */
export function refusalOf(error: unknown): Refusal {
  if (!(error instanceof ApiError)) {
    return { code: null, message: error instanceof Error ? error.message : 'The request failed.' };
  }
  const wrapped = (error.body as { error?: { code?: unknown } } | null)?.error;
  return { code: typeof wrapped?.code === 'string' ? wrapped.code : null, message: error.message };
}

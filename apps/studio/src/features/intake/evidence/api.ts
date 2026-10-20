import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import type { EvidencePage, KeyProfile, KeyProfileBody, KeyProfileInput, Outcome } from './model';

/**
 * Under the batch's own key: every refresh the batch takes from its live updates (or its five-second check while
 * they are disconnected) reads the evidence again. There is no timer of its own.
 */
export const evidenceKey = (caseId: string) => ['intake', caseId, 'evidence'];

// Readable<T> and Writable<T> drop selection.table:null, although it is present on the wire.
export async function readEvidence(caseId: string, outcome?: Outcome, cursor?: string): Promise<EvidencePage> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake/evidence', {
    params: { path: { caseId }, query: { ...(outcome ? { outcome } : {}), ...(cursor ? { cursor } : {}) } },
  })) as EvidencePage;
}

export function useEvidencePage(caseId: string, outcome: Outcome | '', cursor: string | null) {
  return useQuery({ queryKey: [...evidenceKey(caseId), outcome, cursor], retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => readEvidence(caseId, outcome || undefined, cursor ?? undefined) });
}

export async function declareKeyProfile(caseId: string, body: KeyProfileBody): Promise<KeyProfile> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/evidence/key-profiles', {
    params: { path: { caseId } }, body: body as never,
  })) as KeyProfile;
}

function sentInput({ requestKey: _requestKey, ...input }: KeyProfileBody): KeyProfileInput {
  return input;
}

/**
 * One press of "Declare the key": a new request key. A lost answer for the same profile is sent again with the same
 * key; a refusal or another profile makes the next press a new request.
 */
export function createDeclaration(caseId: string, send = declareKeyProfile) {
  let body: KeyProfileBody | null = null;
  return async (input: KeyProfileInput): Promise<KeyProfile> => {
    if (body && JSON.stringify(sentInput(body)) !== JSON.stringify(input)) body = null;
    body ??= { ...input, requestKey: crypto.randomUUID() };
    try {
      return await send(caseId, body);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) body = null;
      throw error;
    }
  };
}

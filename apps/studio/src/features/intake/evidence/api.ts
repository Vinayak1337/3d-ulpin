import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { readTargets } from '../run/api';
import { INTAKE_TARGET_LIMITS, PACKAGE_PAGE, type Package } from '../run/model';
import type { ConfirmBody, ConfirmInput, EvidenceConfirmation } from './confirm-model';
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

/**
 * One press sends one body under a fresh request key. A lost answer for the same input is sent again with the same
 * key; a refusal or another input makes the next press a new request.
 */
function keyedRequest<Input, Body extends Input & { requestKey: string }, Answer>(caseId: string,
  send: (caseId: string, body: Body) => Promise<Answer>) {
  let body: Body | null = null;
  return async (input: Input): Promise<Answer> => {
    if (body) {
      const { requestKey: _requestKey, ...sent } = body;
      if (JSON.stringify(sent) !== JSON.stringify(input)) body = null;
    }
    body ??= { ...input, requestKey: crypto.randomUUID() } as Body;
    try {
      return await send(caseId, body);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) body = null;
      throw error;
    }
  };
}

/** One press of "Declare the key", under the request key rule above. */
export function createDeclaration(caseId: string, send = declareKeyProfile) {
  return keyedRequest<KeyProfileInput, KeyProfileBody, KeyProfile>(caseId, send);
}

export async function confirmEvidence(caseId: string, body: ConfirmBody): Promise<EvidenceConfirmation> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/evidence/confirmations', {
    params: { path: { caseId } }, body: body as never,
  })) as EvidenceConfirmation;
}

/** One press of "Confirm the evidence", under the same request key rule as a declaration. */
export function createEvidenceConfirmation(caseId: string, send = confirmEvidence) {
  return keyedRequest<ConfirmInput, ConfirmBody, EvidenceConfirmation>(caseId, send);
}

/**
 * The packages of the targets read with these ids, read when the officer presses: its first package page, then each
 * later page until every one is found, at most the pages its stated package total spans.
 */
export async function readPackagePins(caseId: string, packageIds: readonly string[],
  read: typeof readTargets = readTargets): Promise<Map<string, Package>> {
  const wanted = new Set(packageIds), found = new Map<string, Package>();
  let cursor: string | undefined;
  for (let pages = 1; wanted.size; pages++) {
    const page = await read(caseId, undefined, undefined, cursor);
    for (const pkg of page.packages) if (wanted.has(pkg.packageId)) found.set(pkg.packageId, pkg);
    const bound = Math.ceil((page.packagesTotal ?? INTAKE_TARGET_LIMITS.draftTargets) / PACKAGE_PAGE);
    if (found.size === wanted.size || !page.packagesNextCursor || pages >= bound) break;
    cursor = page.packagesNextCursor;
  }
  return found;
}

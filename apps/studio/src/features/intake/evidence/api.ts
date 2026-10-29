import { keepPreviousData, queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { INTAKE_EVIDENCE_LIMITS } from '../../../../../../packages/contracts/src/usp/intake';
import type { IntakeItem } from '../batch-model';
import { readTargets } from '../run/api';
import { tableKey } from '../table/queries';
import { INTAKE_TARGET_LIMITS, PACKAGE_PAGE, type Package } from '../run/model';
import { singleMatch, type ConfirmBody, type ConfirmInput, type EvidenceConfirmation,
  type FileMatches } from './confirm-model';
import type { Candidate, EvidencePage, KeyProfile, KeyProfileBody, KeyProfileInput, Outcome, ReadTable,
  Selection } from './model';

/**
 * Under the batch's own key: every refresh the batch takes from its live updates (or its five-second check while
 * they are disconnected) reads the evidence again. There is no timer of its own.
 */
export const evidenceKey = (caseId: string) => ['intake', caseId, 'evidence'];

/** EVS3: the candidates of one file read under one key; the read's counts stay case-wide. */
export interface EvidenceFilter { profileId: string; itemId: string }

// Readable<T> and Writable<T> drop selection.table:null, although it is present on the wire.
export async function readEvidence(caseId: string, outcome?: Outcome, cursor?: string,
  filter?: EvidenceFilter): Promise<EvidencePage> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake/evidence', {
    params: { path: { caseId }, query: { ...(outcome ? { outcome } : {}), ...(cursor ? { cursor } : {}),
      ...filter } },
  })) as EvidencePage;
}

/**
 * EVS3: every exact single match of one file under one key, read page after page along the cursor. The read stops
 * at the server's page bound times the decision limit; `more` says candidates remain past it.
 */
export async function readFileMatches(caseId: string, filter: EvidenceFilter,
  read: typeof readEvidence = readEvidence): Promise<FileMatches> {
  const file = await readFileCandidates(caseId, filter, 'matched', read);
  return { itemId: filter.itemId, matches: file.candidates.filter(singleMatch), more: file.more };
}

/** Refreshing decisions reads every outcome: a formerly matched row may now be a question or gone. */
export async function readFileCandidates(caseId: string, filter: EvidenceFilter, outcome?: Outcome,
  read: typeof readEvidence = readEvidence) {
  const most = INTAKE_EVIDENCE_LIMITS.page * INTAKE_EVIDENCE_LIMITS.decisions;
  const candidates: Candidate[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined, seen = 0;
  for (;;) {
    const page = await read(caseId, outcome, cursor, filter);
    seen += page.candidates.length;
    candidates.push(...page.candidates.filter((candidate) => candidate.key.profileId === filter.profileId
      && candidate.evidence.itemId === filter.itemId));
    if (!page.nextCursor || seen >= most) return { candidates, more: page.nextCursor !== null };
    if (cursors.has(page.nextCursor)) throw new Error('The evidence pages did not advance. Read them again.');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function evidencePageOptions(caseId: string, outcome: Outcome | '' = '', cursor: string | null = null) {
  return queryOptions({ queryKey: [...evidenceKey(caseId), outcome, cursor], retry: false,
    queryFn: () => readEvidence(caseId, outcome || undefined, cursor ?? undefined) });
}

export function useEvidencePage(caseId: string, outcome: Outcome | '', cursor: string | null) {
  return useQuery({ ...evidencePageOptions(caseId, outcome, cursor), placeholderData: keepPreviousData });
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

/**
 * TJ1, D3: the table profile of each kept CSV or workbook of the batch, under the key N01B's table section reads it
 * by. The server refuses a source not read as a table yet; it stays out of the map, never as empty headers. Read
 * only while a key is being declared.
 */
export function useReadTables(caseId: string, items: readonly IntakeItem[], enabled: boolean) {
  const sources = [...new Set(items.filter((item) => item.family === 'table' && item.sourceId
    && ['csv', 'xlsx', 'ods'].includes(item.format ?? '')).map((item) => item.sourceId!))];
  return useQueries({ queries: sources.map((sourceId) => ({ queryKey: [...tableKey(caseId, sourceId), 'profile'],
    retry: false, enabled, queryFn: async () => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile', { params: { path: { caseId, sourceId } } })),
  })), combine: (results) => readTables(sources, results.map((result) => result.data)) });
}

/** The read tables by source: a table profile states its headers and the selection it was read with. */
export function readTables(sources: readonly string[], profiles: readonly unknown[]) {
  const read = new Map<string, ReadTable>();
  for (const [index, profile] of profiles.entries()) {
    const table = profile as { version?: string; headers?: string[]; tabular?: { selection?: Selection } } | undefined;
    if (table?.version !== 'manual-tabular/1' || !table.headers || !table.tabular?.selection) continue;
    read.set(sources[index]!, { headers: table.headers, selection: table.tabular.selection });
  }
  return read;
}

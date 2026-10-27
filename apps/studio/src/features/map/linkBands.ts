import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CheckCircle, Question, Warning, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ApiError } from '@ulpin/api-client';
import type { FootprintInput } from '@ulpin/scene';
import type { AreaFeature } from '../../api/queries';
import { evidenceKey, readEvidence } from '../intake/evidence/api';
import type { Candidate, EvidencePage, Outcome } from '../intake/evidence/model';
import { readTargetByFeature } from '../intake/run/api';
import { buildingTargetKey } from './inspector/BuildingCard';
import { linkOutcomeWords } from './inspector/evidence';
import { tokenColour } from './ledger';

/**
 * Colour by link: each building by the outcome of the candidate links naming it, in the record panel's tones (S6.1b).
 * Amber, not red, for a conflict: it needs the officer's review and is not a blocking finding. An unmatched row or
 * page names no building, so it colours none; a building no candidate names keeps the default colour.
 */
export const LINK_BANDS: readonly { outcome: Outcome; color: string | null; icon: PhosphorIcon }[] = [
  { outcome: 'matched', color: 'var(--ui-mark-good)', icon: CheckCircle },
  { outcome: 'several', color: 'var(--ui-seq-400)', icon: Warning },
  { outcome: 'conflicting', color: 'var(--ui-mark-warning)', icon: Warning },
  { outcome: 'no_match', color: null, icon: Question },
];

/** The evidence pages the map reads along the cursor, 200 candidates each; the key says when more remain. */
export const LINK_PAGES = 10;

/** A building named by several candidates takes the one most in need of review. */
const RANK: Record<Outcome, number> = { no_match: 0, matched: 1, several: 2, conflicting: 3 };

/** The outcome each building takes from the candidates whose anchors name it. */
export function linkOutcomes(candidates: readonly Candidate[]): Map<string, Outcome> {
  const outcomes = new Map<string, Outcome>();
  for (const candidate of candidates) {
    for (const anchor of candidate.anchors) {
      const held = outcomes.get(anchor.featureId);
      if (!held || RANK[candidate.outcome] > RANK[held]) outcomes.set(anchor.featureId, candidate.outcome);
    }
  }
  return outcomes;
}

export function linkColour(outcome: Outcome, resolve: (token: string) => string = tokenColour): string | null {
  const color = LINK_BANDS.find((band) => band.outcome === outcome)?.color;
  return color ? resolve(color.slice(4, -1)) : null;
}

/** The footprints filled by their link outcome; the others are drawn as usual. */
export function linkFootprints(footprints: FootprintInput[], outcomes: ReadonlyMap<string, Outcome>,
  resolve: (token: string) => string = tokenColour): FootprintInput[] {
  return footprints.map((f) => {
    const outcome = outcomes.get(f.id);
    const color = outcome ? linkColour(outcome, resolve) : null;
    return color ? { ...f, color } : f;
  });
}

export type LinkRead =
  | { state: 'reading' } | { state: 'none' } | { state: 'failed'; message: string }
  | { state: 'read'; counts: EvidencePage['counts']; candidates: Candidate[]; reading: boolean; more: boolean };

export interface LinkKey {
  title: string;
  items: { label: string; count?: number; color?: string; icon?: PhosphorIcon }[];
  note: string;
}

const n = (value: number) => value.toLocaleString('en-IN');

/**
 * The key of Colour by link: the case's candidates by outcome as the page counts them, and how many of the drawn
 * buildings the candidates read so far colour. While pages remain unread it says how many candidates were read.
 */
export function linkKey(read: LinkRead, coloured: number): LinkKey {
  const title = 'Links to register rows and pages';
  if (read.state === 'reading') return { title, items: [], note: 'Reading links…' };
  if (read.state === 'none') return { title, items: [], note: 'No links.' };
  if (read.state === 'failed') return { title, items: [], note: `Links could not be read. ${read.message}` };
  const total = read.counts.matched + read.counts.several + read.counts.conflicting + read.counts.no_match;
  const buildings = `${n(coloured)} ${coloured === 1 ? 'building' : 'buildings'} coloured`;
  const note = read.reading || read.more
    ? `${buildings} from ${n(read.candidates.length)} of ${n(total)} candidates read.`
    : `${buildings} from ${n(total)} candidates.`;
  return { title, note, items: [
    ...LINK_BANDS.map((band) => ({ label: linkOutcomeWords[band.outcome], count: read.counts[band.outcome],
      ...(band.color ? { color: band.color } : {}), icon: band.icon })),
    { label: 'No link', color: 'var(--ui-map-building)' },
  ] };
}

const failure = (error: unknown) => error instanceof ApiError ? error.message : 'The server gave no answer.';

/**
 * Read only, while Colour by link is on: the case is the batch of the intake target naming one building of the area
 * (the opened package's, else any proposed building's, else the selected or first one), and its evidence pages are
 * read along the cursor under the batch's evidence key, at most LINK_PAGES pages. Each page read colours its buildings.
 */
export function useLinkRead(buildings: readonly AreaFeature[], packageId: string | null,
  selected: AreaFeature | null, enabled: boolean): { read: LinkRead; outcomes?: ReadonlyMap<string, Outcome> } {
  const probe = (packageId ? buildings.find((b) => b.proposalPackageId === packageId) : undefined)
    ?? buildings.find((b) => b.proposalPackageId) ?? selected ?? buildings[0];
  const target = useQuery({ queryKey: buildingTargetKey(probe?.id ?? '', probe?.proposalPackageId), retry: false,
    enabled: enabled && Boolean(probe), queryFn: () => readTargetByFeature(probe!.id, probe!.proposalPackageId) });
  const caseId = target.data?.caseId;
  const pages = useInfiniteQuery({ queryKey: [...evidenceKey(caseId ?? ''), 'map'], retry: false,
    enabled: enabled && Boolean(caseId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => readEvidence(caseId!, undefined, pageParam),
    getNextPageParam: (last, all) => last.nextCursor && all.length < LINK_PAGES
      && !all.slice(0, -1).some((page) => page.nextCursor === last.nextCursor) ? last.nextCursor : undefined });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const candidates = useMemo(() => pages.data?.pages.flatMap((page) => page.candidates), [pages.data]);
  const outcomes = useMemo(() => candidates && linkOutcomes(candidates), [candidates]);
  if (!probe) return { read: { state: 'none' } };
  if (target.error) return { read: { state: 'failed', message: failure(target.error) } };
  if (target.isPending) return { read: { state: 'reading' } };
  if (!caseId) return { read: { state: 'none' } };
  if (pages.error) return { read: { state: 'failed', message: failure(pages.error) } };
  if (!pages.data || !candidates) return { read: { state: 'reading' } };
  const last = pages.data.pages[pages.data.pages.length - 1]!;
  return { outcomes, read: { state: 'read', counts: last.counts, candidates, reading: hasNextPage,
    more: !hasNextPage && last.nextCursor !== null } };
}

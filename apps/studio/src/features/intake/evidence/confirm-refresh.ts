import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { evidenceKey, readEvidence, readFileCandidates, readPackagePins } from './api';
import { decidable, namedBuildings, reconcileChoices } from './confirm-model';
import type { ConfirmDraft, ConfirmRead } from './ConfirmEvidence';
import type { Candidate, KeyProfile } from './model';

/** Refresh all selected pages, not just the displayed page or the first page of exact matches. */
export async function refreshConfirmation(caseId: string, profile: KeyProfile, draft: ConfirmDraft,
  previous: ConfirmRead, read = readEvidence, readPins = readPackagePins) {
  const page = await read(caseId, previous.query?.outcome || undefined, previous.query?.cursor ?? undefined);
  const current = page.profiles.find(entry => entry.profileId === profile.profileId);
  if (!current) throw new Error('This key is no longer listed. Close this form and choose a current key.');
  const candidates: Candidate[] = [];
  const items = new Set(Object.values(draft.choices).map(choice => choice.candidate.evidence.itemId));
  for (const itemId of items) {
    const file = await readFileCandidates(caseId, { profileId: current.profileId, itemId }, undefined, read);
    if (file.more) throw new Error('Not all selected evidence could be read. Narrow the selection and read again.');
    candidates.push(...decidable({ ...page, candidates: file.candidates }, current));
  }
  const selection = reconcileChoices(draft.choices, candidates);
  const buildings = namedBuildings(selection.choices, decidable(page, current));
  const packages = await readPins(caseId, [...new Set(buildings.map(building => building.packageId))]);
  const words = [selection.words];
  if (JSON.stringify(page.sources) !== JSON.stringify(previous.page.sources)) {
    const names = page.sources.filter(source => source.profileId === current.profileId)
      .map(source => previous.items.find(item => item.itemId === source.itemId)?.name ?? 'a file no longer listed');
    words.push(`The evidence reading changed for: ${names.join(', ')}.`);
  }
  return { page, profile: current, packages, before: draft.choices,
    choices: selection.choices, words: words.filter(Boolean).join(' ') };
}

/** The batch stream invalidates this read with the other evidence queries; no independent polling timer. */
export function useConfirmRefresh(caseId: string, profile: KeyProfile, read: ConfirmRead, draft: ConfirmDraft,
  change: (draft: ConfirmDraft) => void, finished: boolean) {
  const formId = useId();
  const latest = useRef({ draft, read, change });
  latest.current = { draft, read, change };
  const applied = useRef<Awaited<ReturnType<typeof refreshConfirmation>> | undefined>(undefined);
  const refused = useRef(false);
  const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: [...evidenceKey(caseId), 'confirmation', profile.profileId, formId,
    read.query?.outcome ?? '', read.query?.cursor ?? null],
    retry: false, gcTime: 0, refetchOnWindowFocus: false, enabled: !finished, structuralSharing: false,
    queryFn: () => refreshConfirmation(caseId, profile, latest.current.draft,
      { ...latest.current.read, page: applied.current?.page ?? latest.current.read.page }) });
  useEffect(() => {
    if (!query.data || query.data === applied.current) return;
    const words = refreshWords(applied.current, query.data);
    const changed = refused.current || Boolean(words);
    applied.current = query.data;
    refused.current = false;
    const current = latest.current;
    const choices = Object.fromEntries(Object.entries(current.draft.choices).flatMap(([id, choice]) => {
      if (!(id in query.data.before)) return [[id, choice]];
      const refreshed = query.data.choices[id];
      return refreshed ? [[id, refreshed]] : [];
    }));
    current.change({ ...current.draft, choices,
      acknowledgement: changed ? '' : current.draft.acknowledgement });
    if (changed) setNotice([words,
      'Check your selections and confirm again.'].filter(Boolean).join(' '));
  }, [query.data]);
  return { query, notice, refused: () => { refused.current = true; },
    pending: query.isPending || query.isFetching || query.data !== applied.current };
}

type FreshRead = Awaited<ReturnType<typeof refreshConfirmation>>;

function refreshWords(before: FreshRead | undefined, after: FreshRead): string {
  const words = [after.words];
  if (before?.profile.profileSha256 !== undefined && before.profile.profileSha256 !== after.profile.profileSha256) {
    words.push('The declared key changed.');
  }
  for (const [id, pkg] of after.packages) {
    const old = before?.packages.get(id);
    if (old && (old.revision !== pkg.revision || old.reviewFingerprint !== pkg.reviewFingerprint)) {
      const building = Object.values(after.choices).flatMap(choice => choice.candidate.anchors)
        .find(anchor => anchor.packageId === id)?.locator ?? 'a building of this key';
      words.push(`The package review changed for ${building} (revision ${pkg.revision}).`);
    }
  }
  return words.filter(Boolean).join(' ');
}

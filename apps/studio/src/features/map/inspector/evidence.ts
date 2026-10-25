import type { AreaFeature, RegisterRecord } from '../../../api/queries';
import { parseLocator, type EvidenceRef } from '../../evidence/refs';
import type { Candidate, EvidencePage, Outcome } from '../../intake/evidence/model';
import type { Target } from '../../intake/run/model';

/** Evidence refs for an area feature's geometry and its height, from the record's own pointers. */
export function featureEvidence(feature: AreaFeature): { geometry: EvidenceRef[]; height: EvidenceRef[] } {
  const subject = { id: feature.id, name: feature.name };
  const geometry = feature.evidence.map((e) => ({
    sourceId: e.sourceRevisionId, label: feature.datasetNamespace, subject,
    locator: parseLocator({ jsonPointer: e.jsonPointer, row: e.row }),
  }));
  const height = (feature.height.evidence ?? []).map((e) => ({
    sourceId: e.sourceRevisionId, label: 'Roof height', subject,
    locator: parseLocator({ jsonPointer: e.jsonPointer, row: e.row }),
  }));
  return { geometry, height };
}

export function recordEvidence(record: RegisterRecord, sourceName: (id: string) => string, subjectName: string): EvidenceRef[] {
  return record.evidence.map((e) => ({
    sourceId: e.sourceId, label: sourceName(e.sourceId), subject: { id: record.id, name: subjectName },
    locator: parseLocator({ locator: e.locator }),
  }));
}

/** The row or page a link names, as the native reader words it: 'CSV logical row 444', 'Sheet S, row 9', 'Page 3'. */
export function linkPlaceWords(evidence: Candidate['evidence']): string {
  if (evidence.kind === 'document_part') return evidence.page === null ? 'Page not stated' : `Page ${evidence.page}`;
  return evidence.selection.format === 'csv' ? `CSV logical row ${evidence.sourceRow}`
    : `Sheet ${evidence.window?.sheet ?? evidence.selection.sheet}, `
      + `row ${evidence.window?.physicalRow ?? evidence.sourceRow}`;
}

/** The key as written: a table's column header and its cell, or the officer's name for the key and the literal. */
export function linkKeyWords(candidate: Candidate): string {
  const evidence = candidate.evidence;
  const name = evidence.kind === 'table_row' && evidence.columnHeader.trim() ? evidence.columnHeader
    : candidate.key.namespace;
  return `${name} ${candidate.key.literal}`;
}

export const linkOutcomeWords: Record<Outcome, string> = {
  matched: 'Matched', several: 'Several buildings', conflicting: 'Conflicting', no_match: 'Unmatched',
};

/**
 * Where an officer's review leaves a link: cited on the record revision the building's target names, accepted by a
 * confirmation that still stands, accepted before its file was read again, or a candidate no confirmation accepted.
 */
export type LinkReview = { state: 'cited'; revision: number } | { state: 'confirmed' | 'reread' | 'candidate' };

export function linkReview(candidate: Candidate, confirmations: EvidencePage['confirmations'],
  target: Target | null): LinkReview {
  const accepting = confirmations.filter((c) => c.accepted?.includes(candidate.candidateId));
  const cited = target?.artefacts.evidence;
  if (cited && accepting.some((c) => c.additions === 'citations' && cited.confirmationIds.includes(c.confirmationId))) {
    return { state: 'cited', revision: cited.record.revision };
  }
  if (accepting.some((c) => !c.superseded)) return { state: 'confirmed' };
  return { state: accepting.length ? 'reread' : 'candidate' };
}

export function linkReviewWords(review: LinkReview): string {
  switch (review.state) {
    case 'cited': return `Confirmed by the officer and cited on the record, revision ${review.revision}.`;
    case 'confirmed': return 'Confirmed by the officer. The record does not cite it yet.';
    case 'reread': return 'Confirmed by the officer before its file was read again. It must be confirmed again.';
    case 'candidate': return 'Not confirmed. It stays a candidate until the officer confirms it.';
  }
}

import type { GetResponse } from '@ulpin/api-client';
import type { BuildingLedger } from '@ulpin/api-client/draft';

export type PublishedLedger = GetResponse<'/api/v1/buildings/{buildingId}/ledger'>;
type Source = BuildingLedger['sources'][number];
type Revision = BuildingLedger['revisions'][number];

/** The parcel ULPIN as one value, only when the record states exactly one. */
function parcelUlpin(published: PublishedLedger): string | null {
  const values = [...new Set(published.parcelUlpin.assertions.map((assertion) => assertion.value))];
  return published.parcelUlpin.state === 'recorded' && values.length === 1 ? (values[0] ?? null) : null;
}

/** What kind of retained source a locator points into. */
function sourceKind(locator: string | undefined): Source['kind'] {
  if (locator?.startsWith('feature:')) return 'feature';
  return locator?.startsWith('row:') || locator?.startsWith('cell:') ? 'table' : 'document';
}

function sourceOf(source: PublishedLedger['sources'][number]): Source {
  const locator = source.locators.find((candidate) => !candidate.startsWith('{'));
  return {
    sourceId: source.id,
    kind: sourceKind(locator),
    name: source.name,
    file: source.name,
    summary: locator ?? '',
  };
}

/** The published history carries revision numbers and times only: no actor, no hashes. */
function revisionsOf(history: PublishedLedger['history']): Revision[] {
  const feature = history.feature.map((entry) => ({
    kind: 'draft' as const, title: `Source feature, revision ${entry.revision}`, at: entry.recordedAt,
  }));
  const registry = history.registry.map((entry) => ({
    kind: 'recorded' as const, title: `Registry record, revision ${entry.revision}`, at: entry.recordedAt,
  }));
  return [...feature, ...registry].map((entry) => ({ ...entry, actor: null, hash: null, previousHash: null }));
}

/**
 * The published `building-ledger/1` in the shape the screens read. A field the published shape lacks (rights,
 * shares, readiness, checks, deviation) stays empty or null, which the screens show as Unknown or Not assessed.
 */
export function ledgerFromPublished(published: PublishedLedger): BuildingLedger {
  return {
    buildingId: published.building.id,
    revision: published.building.revision,
    status: published.building.recordState === 'recorded' ? 'reviewed' : 'draft',
    address: null,
    parcelUlpin: parcelUlpin(published),
    declaration: null,
    siteDatum: published.building.frame.benchmark,
    groundElevationM: null,
    shareBasis: null,
    shareTotalPct: null,
    shareEvidence: null,
    spaces: [],
    readiness: { task: 'Record', dimensions: [] },
    checks: [],
    checkMethod: published.assessment.reason,
    findingDetails: [],
    deviation: null,
    revisions: revisionsOf(published.history),
    sources: published.sources.map(sourceOf),
  };
}

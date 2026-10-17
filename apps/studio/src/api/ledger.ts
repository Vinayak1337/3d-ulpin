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

/** A registry entry of the history keeps the id of the record it revises: the building, a floor or a space. */
type PublishedRevision = Revision & { publishedActor?: string | null };
type RecordedRevision = PublishedRevision & { recordId: string };
type RegistryEntry = PublishedLedger['history']['registry'][number];

const RECORD_KINDS = { parcel: 'Parcel', building: 'Building', floor: 'Floor', space: 'Space' };

/** Optional fields are an older read, whereas null explicitly states that the record holds none. */
export function registryEntryTitle(entry: RegistryEntry, fallback: string): string {
  const words: string[] = [];
  if (entry.recordKind !== undefined) {
    words.push(entry.recordKind === null ? 'Kind not recorded' : RECORD_KINDS[entry.recordKind]);
  }
  if (entry.recordName !== undefined) words.push(entry.recordName ?? 'Name not recorded');
  if (!words.length) return `${fallback}, revision ${entry.revision}`;
  return [...words, `revision ${entry.revision}`].join(' · ');
}

/** The published read's absence is not a statement that the stored actor is null. */
export function historyActor(revision: Revision): string | null {
  if ('publishedActor' in revision) {
    if (revision.publishedActor === undefined) return null;
    return revision.publishedActor === null ? 'Actor not recorded' : String(revision.publishedActor);
  }
  return revision.actor ?? 'Actor not recorded';
}

/** The id of the registry record a history entry revises; null for an entry that names none. */
export function revisedRecordId(revision: Revision): string | null {
  return 'recordId' in revision && typeof revision.recordId === 'string' ? revision.recordId : null;
}

/** Which record a registry entry revises, as far as this read names it: the building or one of its spaces. */
function recordWords(published: PublishedLedger, recordId: string): string {
  if (recordId === published.building.id) return 'Building record';
  const space = published.spaces.records.find((record) => record.id === recordId);
  return space ? `Space ${space.name}` : 'Registry record';
}

/**
 * The published history carries optional record words and actors, but no hashes. Its registry entries are
 * one per record and revision, so two records revised at the same time are two entries, each with its record id.
 */
function revisionsOf(published: PublishedLedger): Revision[] {
  const unsigned = { actor: null, hash: null, previousHash: null };
  const feature = published.history.feature.map((entry): PublishedRevision => ({
    ...unsigned, publishedActor: undefined, kind: 'draft',
    title: `Source feature, revision ${entry.revision}`, at: entry.recordedAt,
  }));
  const registry = published.history.registry.map((entry): RecordedRevision => ({
    ...unsigned, kind: 'recorded', at: entry.recordedAt, recordId: entry.recordId,
    actor: entry.actor ?? null, publishedActor: entry.actor,
    title: registryEntryTitle(entry, recordWords(published, entry.recordId)),
  }));
  return [...feature, ...registry];
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
    revisions: revisionsOf(published),
    sources: published.sources.map(sourceOf),
  };
}

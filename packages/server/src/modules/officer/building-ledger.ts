import type { BuildingLedger, RegistryRecord, SourceLocator } from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { AppError, notFound } from '../../infrastructure/errors';
import { registrySourceTx } from '../registry/registry-metadata';
import { assertPackageDocumentAuthority } from '../areas/package-authority';
import { relatedRegistryRecords } from './officer';

const iso = (value: Date | string) => new Date(value).toISOString();

/** A revision-zero feature is readable only while its exact source package is current. */
export function currentSourceProposal(root: { identifier: string; site_id: string; body: { sourceRevisionId: string } },
  pkg: { archived: boolean; site_id: string; state: string; body: {
    sourceWorkspace?: unknown; sourceRevisionIds?: string[]; parts?: unknown[];
    features?: Array<{ id: string; revision: number; identifier: string; sourceRevisionId: string }>;
  } } | null, buildingId: string): boolean {
  const feature = pkg?.body.features?.find(item => item.id === buildingId);
  return !!pkg && !pkg.archived && pkg.site_id === root.site_id &&
    ['NEEDS_INPUT', 'READY_FOR_REVIEW', 'REVIEWED'].includes(pkg.state) && !pkg.body.sourceWorkspace &&
    pkg.body.sourceRevisionIds?.length === 1 && !pkg.body.parts?.length && !!feature &&
    feature.revision === 0 && feature.identifier === root.identifier &&
    feature.sourceRevisionId === root.body.sourceRevisionId &&
    pkg.body.sourceRevisionIds[0] === root.body.sourceRevisionId;
}

export function parcelUlpinCoverage(parcels: Array<{ id: string }>, assertions: Array<{ parcelId: string; value: string }>):
  { state: 'unknown' | 'partial' | 'recorded' | 'conflicting'; missingParcelIds: string[] } {
  const valuesByParcel = new Map<string, Set<string>>();
  for (const item of assertions) {
    if (!valuesByParcel.has(item.parcelId)) valuesByParcel.set(item.parcelId, new Set());
    valuesByParcel.get(item.parcelId)!.add(item.value);
  }
  const missingParcelIds = parcels.filter(parcel => !valuesByParcel.has(parcel.id)).map(parcel => parcel.id);
  const state = [...valuesByParcel.values()].some(values => values.size > 1) ? 'conflicting'
    : !assertions.length ? 'unknown' : missingParcelIds.length ? 'partial' : 'recorded';
  return { state, missingParcelIds };
}

type Edge = { evidence?: SourceLocator[] };
type ParcelEvidence = { body: { sourceRevisionId: string; evidence?: SourceLocator[] }; association: Edge };
type IdentifierEvidence = { source_id: string; evidence: { sourceRevisionId?: string; locator?: string } };
/** Every source supporting a projected edge or assertion must pass registrySourceTx. */
export function ledgerSourceLocators(root: { sourceRevisionId: string; sourceKey?: string; evidence?: SourceLocator[] },
  records: Array<Pick<RegistryRecord, 'evidence'>>, detailEdges: Edge[], parcels: ParcelEvidence[],
  identifiers: IdentifierEvidence[]): Map<string, Set<string>> {
  const locators = new Map<string, Set<string>>();
  const cite = (sourceId: string | undefined, locator: string) => {
    if (!sourceId) throw new AppError(409, 'LEDGER_SOURCE_EVIDENCE', 'A projected fact has no source revision.');
    if (!locators.has(sourceId)) locators.set(sourceId, new Set());
    locators.get(sourceId)!.add(locator);
  };
  const featureLocator = (item: SourceLocator) => JSON.stringify(item);
  const citeEdge = (edge: Edge) => {
    if (!Array.isArray(edge.evidence) || !edge.evidence.length)
      throw new AppError(409, 'LEDGER_RELATIONSHIP_EVIDENCE', 'A current relationship lacks source evidence.');
    for (const item of edge.evidence) cite(item.sourceRevisionId, featureLocator(item));
  };
  cite(root.sourceRevisionId, root.sourceKey ? `feature:${root.sourceKey}` : 'source');
  for (const item of root.evidence ?? []) cite(item.sourceRevisionId, featureLocator(item));
  for (const record of records) for (const item of record.evidence) cite(item.sourceId, item.locator);
  for (const edge of detailEdges) citeEdge(edge);
  for (const parcel of parcels) {
    citeEdge(parcel.association);
    cite(parcel.body.sourceRevisionId, 'parcel source');
    for (const item of parcel.body.evidence ?? []) cite(item.sourceRevisionId, featureLocator(item));
  }
  for (const item of identifiers) {
    if (!item.evidence || item.evidence.sourceRevisionId !== item.source_id ||
      typeof item.evidence.locator !== 'string' || !item.evidence.locator.trim())
      throw new AppError(409, 'LEDGER_IDENTIFIER_EVIDENCE', 'An official parcel identifier lacks its exact source locator.');
    cite(item.source_id, item.evidence.locator);
  }
  return locators;
}

export function boundedLedgerRows<T>(rows: T[], label: string): T[] {
  if (rows.length > 200) throw new AppError(422, 'BUILDING_LEDGER_LIMIT', `Too many current ${label} for one ledger read.`);
  return rows;
}

export async function authorizeLedgerSources<T>(sourceIds: Iterable<string>, authorize: (id: string) => Promise<T>):
  Promise<Array<{ id: string; source: T }>> {
  const sources: Array<{ id: string; source: T }> = [];
  for (const id of [...sourceIds].sort()) sources.push({ id, source: await authorize(id) });
  return sources;
}

export const currentParcelSql = `SELECT p.id,p.revision,p.body,a.body association FROM property_associations a
  JOIN physical_features p ON p.id=a.to_id WHERE a.from_id=$1 AND a.relationship='occupies_parcel'
  AND a.status='confirmed' AND p.revision>0 AND p.area_id=$2 AND p.body->>'kind'='parcel'
  AND a.body->>'fromRevision'=$3::text AND a.body->>'toRevision'=p.revision::text
  ORDER BY p.id LIMIT 201`;

/** Reads only the canonical current building and its explicit record graph. */
export async function buildingLedger(buildingId: string): Promise<BuildingLedger> {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const root = (await client.query(`SELECT f.id,f.identifier,f.revision,f.body,a.id area_id,a.site_id,
      a.reference,s.frame FROM physical_features f JOIN map_areas a ON a.id=f.area_id
      JOIN registry_sites s ON s.id=a.site_id
      WHERE f.id=$1 AND f.revision>=0 AND f.body->>'kind'='building' AND a.archived_at IS NULL`,
      [buildingId])).rows[0] ?? notFound('Building not found.');
    if (root.revision === 0) {
      const pkg = (await client.query(`SELECT p.body,p.state,c.archived,c.site_id FROM import_packages p
        JOIN cases c ON c.id=p.case_id WHERE p.area_id=$1 AND p.body->'features' @> $2::jsonb
        ORDER BY p.created_at DESC LIMIT 1`, [root.area_id, JSON.stringify([{ id: buildingId }])])).rows[0];
      if (!currentSourceProposal(root, pkg, buildingId)) notFound('Current building source proposal not found.');
      await assertPackageDocumentAuthority(client, pkg.body);
    }
    const records = root.revision > 0
      ? await relatedRegistryRecords(buildingId, root.revision, root.site_id, client, 2000) : [];
    const spaces = records.filter((record: RegistryRecord) => record.kind === 'space');
    const detailEdges = records.length ? (await client.query(`SELECT a.body FROM property_associations a
      JOIN registry_records r ON r.id=a.to_id WHERE a.from_id=$1
      AND a.relationship IN ('detailed_record','shared_space') AND a.status='confirmed'
      AND a.body->>'fromRevision'=$2::text AND a.body->>'toRevision'=r.revision::text
      AND r.id=ANY($3::uuid[]) ORDER BY a.id LIMIT 2001`,
      [buildingId, root.revision, records.map(record => record.id)])).rows.map(row => row.body as Edge) : [];
    if (detailEdges.length > 2000) throw new AppError(422, 'BUILDING_LEDGER_LIMIT', 'Too many current detailed relationships for one ledger read.');
    const parcelRows = boundedLedgerRows((await client.query(currentParcelSql,
      [buildingId, root.area_id, root.revision])).rows, 'parcels');
    const parcelIds = parcelRows.map(row => row.id as string);
    const identifiers = parcelIds.length ? boundedLedgerRows((await client.query(`SELECT feature_id parcel_id,normalized_value value,issuer,source_id,evidence
      FROM external_identifiers WHERE feature_id=ANY($1::uuid[]) AND scheme='official_ulpin'
      AND verification_state='validated' AND valid_to IS NULL AND source_id IS NOT NULL
      ORDER BY feature_id,normalized_value LIMIT 201`, [parcelIds])).rows, 'official parcel assertions') : [];
    const featureRevisions = (await client.query(`SELECT revision,created_at FROM physical_feature_revisions
      WHERE feature_id=$1 AND revision<=$2 ORDER BY revision DESC LIMIT 101`, [buildingId, root.revision])).rows;
    const registryRevisions = records.length ? (await client.query(`SELECT record_id,revision,created_at
      FROM registry_revisions WHERE record_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 201`,
      [records.map(record => record.id)])).rows : [];
    const lastCheck = root.revision > 0 ? (await client.query(`SELECT id FROM area_check_runs WHERE area_id=$1
      AND status='completed' ORDER BY created_at DESC LIMIT 1`, [root.area_id])).rows[0]
      : null;

    const locatorMap = ledgerSourceLocators(root.body, records, detailEdges, parcelRows, identifiers);
    if (locatorMap.size > 1000) throw new AppError(422, 'BUILDING_LEDGER_LIMIT', 'Too many cited sources for one ledger read.');
    const authorized = await authorizeLedgerSources(locatorMap.keys(), id => registrySourceTx(client, root.site_id, id));
    const sources: BuildingLedger['sources'] = authorized.map(({ id, source }) => ({
      id, revision: source.revision, name: source.name, sha256: source.sha256,
      fileUrl: `/api/v1/sources/${id}/file`, locators: [...locatorMap.get(id)!].sort(),
    }));
    const assertions = identifiers.map(row => ({ parcelId: row.parcel_id as string, value: row.value as string,
      issuer: row.issuer as string, sourceId: row.source_id as string, locator: row.evidence.locator as string }));
    const parcels = parcelRows.map(row => ({ id: row.id as string, revision: row.revision as number }));
    const coverage = parcelUlpinCoverage(parcels, assertions);
    const missing = [
      ...(spaces.length ? [] : ['No detailed spaces are recorded for this building.']),
      ...(root.revision === 0 ? ['This building remains an unrecorded source proposal awaiting canonical review.'] : []),
      ...(coverage.missingParcelIds.length ? [`Current parcels without a validated official ULPIN: ${coverage.missingParcelIds.join(', ')}.`] : []),
      ...(!parcels.length ? ['No current confirmed parcel association is recorded.'] : []),
      ...(!root.reference ? ['Global placement is unavailable; local-frame records remain inspectable.'] : []),
      'Technical readiness, rights and deviation are not assessed by this ledger.',
    ];
    return {
      schemaVersion: 'building-ledger/1',
      building: { id: root.id, applicationId: root.identifier, revision: root.revision,
        recordState: root.revision === 0 ? 'unrecorded' : 'recorded',
        name: root.body.name, frame: { id: root.frame.id, benchmark: root.frame.benchmark },
        placement: root.reference ? 'geographic' : 'local_only' },
      parcelUlpin: { state: coverage.state, parcels, missingParcelIds: coverage.missingParcelIds, assertions },
      spaces: { state: spaces.length ? 'recorded' : 'absent', records: spaces.map((record: RegistryRecord) => ({
        id: record.id, applicationId: record.identifier, revision: record.revision, name: record.name,
        use: record.use ?? null, evidence: record.evidence.map(item => ({ sourceId: item.sourceId, locator: item.locator })),
      })) },
      sources,
      history: { feature: featureRevisions.slice(0, 100).map(row => ({ revision: row.revision, recordedAt: iso(row.created_at) })),
        registry: registryRevisions.slice(0, 200).map(row => ({ recordId: row.record_id, revision: row.revision,
          recordedAt: iso(row.created_at) })), featureHasMore: featureRevisions.length > 100,
        registryHasMore: registryRevisions.length > 200 },
      assessment: { state: 'not_assessed', latestCheck: lastCheck ? 'historical' : 'absent',
        reason: 'This projection does not qualify current checks or technical readiness.' },
      missing,
    };
  });
}

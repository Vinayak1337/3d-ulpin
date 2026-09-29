import type { BuildingLedger, RegistryRecord, SourceLocator } from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { notFound } from '../../infrastructure/errors';
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

export function parcelUlpinState(assertions: Array<{ parcelId: string; value: string }>):
  'unknown' | 'recorded' | 'conflicting' {
  if (!assertions.length) return 'unknown';
  const valuesByParcel = new Map<string, Set<string>>();
  for (const item of assertions) {
    if (!valuesByParcel.has(item.parcelId)) valuesByParcel.set(item.parcelId, new Set());
    valuesByParcel.get(item.parcelId)!.add(item.value);
  }
  return [...valuesByParcel.values()].some(values => values.size > 1) ? 'conflicting' : 'recorded';
}

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
      ? await relatedRegistryRecords(buildingId, root.revision, root.site_id, client) : [];
    const spaces = records.filter((record: RegistryRecord) => record.kind === 'space');
    const parcelRows = (await client.query(`SELECT p.id,p.revision,a.body association FROM property_associations a
      JOIN physical_features p ON p.id=a.to_id WHERE a.from_id=$1 AND a.relationship='occupies_parcel'
      AND a.status='confirmed' AND p.revision>0 AND p.area_id=$2 AND p.body->>'kind'='parcel'
      ORDER BY p.id LIMIT 201`, [buildingId, root.area_id])).rows;
    const currentParcels = parcelRows.filter(row => row.association.fromRevision === root.revision
      && row.association.toRevision === row.revision);
    const parcelIds = currentParcels.map(row => row.id as string);
    const identifiers = parcelIds.length ? (await client.query(`SELECT feature_id parcel_id,normalized_value value,issuer,source_id
      FROM external_identifiers WHERE feature_id=ANY($1::uuid[]) AND scheme='official_ulpin'
      AND verification_state='validated' AND valid_to IS NULL AND source_id IS NOT NULL
      ORDER BY feature_id,normalized_value LIMIT 201`, [parcelIds])).rows : [];
    const featureRevisions = (await client.query(`SELECT revision,created_at FROM physical_feature_revisions
      WHERE feature_id=$1 AND revision<=$2 ORDER BY revision DESC LIMIT 101`, [buildingId, root.revision])).rows;
    const registryRevisions = records.length ? (await client.query(`SELECT record_id,revision,created_at
      FROM registry_revisions WHERE record_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 201`,
      [records.map(record => record.id)])).rows : [];
    const lastCheck = root.revision > 0 ? (await client.query(`SELECT id FROM area_check_runs WHERE area_id=$1
      AND status='completed' ORDER BY created_at DESC LIMIT 1`, [root.area_id])).rows[0]
      : null;

    const locatorMap = new Map<string, Set<string>>();
    const cite = (sourceId: string | undefined, locator: string) => {
      if (!sourceId) return;
      if (!locatorMap.has(sourceId)) locatorMap.set(sourceId, new Set());
      locatorMap.get(sourceId)!.add(locator);
    };
    const featureLocator = (item: SourceLocator) => {
      const parts = [item.featureId && `feature:${item.featureId}`, item.partId && `part:${item.partId}`,
        item.page !== undefined && `page:${item.page}`, item.row !== undefined && `row:${item.row}`,
        item.jsonPointer && `pointer:${item.jsonPointer}`].filter(Boolean);
      return parts.length ? parts.join(';') : 'source';
    };
    cite(root.body.sourceRevisionId, root.body.sourceKey ? `feature:${root.body.sourceKey}` : 'source');
    for (const item of root.body.evidence ?? [] as SourceLocator[]) cite(item.sourceRevisionId, featureLocator(item));
    for (const record of records) for (const item of record.evidence) cite(item.sourceId, item.locator);
    for (const row of identifiers) cite(row.source_id, 'validated official_ulpin assertion');
    const sources: BuildingLedger['sources'] = [];
    for (const id of [...locatorMap.keys()].sort()) {
      const source = await registrySourceTx(client, root.site_id, id);
      sources.push({ id, revision: source.revision, name: source.name, sha256: source.sha256,
        fileUrl: `/api/v1/sources/${id}/file`, locators: [...locatorMap.get(id)!].sort() });
    }
    const assertions = identifiers.map(row => ({ parcelId: row.parcel_id as string, value: row.value as string,
      issuer: row.issuer as string, sourceId: row.source_id as string }));
    const missing = [
      ...(spaces.length ? [] : ['No detailed spaces are recorded for this building.']),
      ...(root.revision === 0 ? ['This building remains an unrecorded source proposal awaiting canonical review.'] : []),
      ...(assertions.length ? [] : ['No current validated official parcel ULPIN is linked through a confirmed parcel association.']),
      ...(!root.reference ? ['Global placement is unavailable; local-frame records remain inspectable.'] : []),
      'Technical readiness, rights and deviation are not assessed by this ledger.',
    ];
    return {
      schemaVersion: 'building-ledger/1',
      building: { id: root.id, applicationId: root.identifier, revision: root.revision,
        recordState: root.revision === 0 ? 'unrecorded' : 'recorded',
        name: root.body.name, frame: { id: root.frame.id, benchmark: root.frame.benchmark },
        placement: root.reference ? 'geographic' : 'local_only' },
      parcelUlpin: { state: parcelUlpinState(assertions), assertions },
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

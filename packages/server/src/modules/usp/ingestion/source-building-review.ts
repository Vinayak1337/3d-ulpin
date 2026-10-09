import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AreaFinding, SourceBuildingPackage } from '@ulpin/contracts';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { documentAuthorityTx } from './document-authority';
import { documentSourceTx } from './document-context';
import { SOURCE_BUILDING_GAP, assertGeometryFreeFeatures } from './source-building-values';
import { recordSourceBuildingTx } from './source-building-records';

export function isGeometryFreePackage(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'geometryFree' in value && value.geometryFree === true);
}

/** Original-only citations: no extracted text or staged parts gain admission. */
export async function sourceBuildingOriginalAccessTx(client: PoolClient, siteId: string, sourceId: string) {
  const row = (await client.query('SELECT case_id FROM sources WHERE id=$1', [sourceId])).rows[0] ?? notFound();
  const context = await documentSourceTx(client, row.case_id, sourceId);
  if (context.current.site_id !== siteId || !context.latest) {
    throw new AppError(403, 'SOURCE_BUILDING_DENIED', 'This source building original is outside its current site.');
  }
  await documentAuthorityTx(client, context.source, 'original');
  return context.source;
}

export async function assertSourceBuildingPinsTx(client: PoolClient, pkg: SourceBuildingPackage, siteId: string) {
  assertGeometryFreeFeatures(pkg.features);
  if (!pkg.documentPins.length || pkg.parts.length) {
    throw new AppError(422, 'SOURCE_BUILDING_PINS', 'Source review needs original pins, not staged extraction parts.');
  }
  const pins = new Map(pkg.documentPins.map(pin => [pin.sourceId, pin]));
  const evidence = [
    ...pkg.features.flatMap(feature => feature.evidence), ...pkg.factCandidates.flatMap(claim => claim.evidence),
  ];
  if (evidence.some(entry => !pins.has(entry.sourceRevisionId))) {
    throw new AppError(422, 'SOURCE_BUILDING_CITATION', 'Every claim must cite a pinned attached original.');
  }
  for (const pin of pkg.documentPins) {
    const source = await sourceBuildingOriginalAccessTx(client, siteId, pin.sourceId);
    if (source.sha256 !== pin.sourceSha256 || Number(source.revision) !== pin.sourceRevision) {
      conflict('A source building original revision changed.');
    }
  }
}

export function sourceReviewFingerprint(pkg: SourceBuildingPackage, areaRevision: number): string {
  return sha256(Buffer.from(JSON.stringify({
    validator: 'document-buildings-source-review/1', features: pkg.features, claims: pkg.factCandidates,
    documentPins: pkg.documentPins, sourceMetadata: pkg.sourceMetadata,
    areaRevision, packageRevision: pkg.revision,
  })));
}

function sourceFindings(pkg: SourceBuildingPackage): AreaFinding[] {
  const findings: AreaFinding[] = [{
    id: randomUUID(), category: 'coverage', code: 'GEOMETRY_FREE_BUILDINGS_NOT_ASSESSED',
    message: SOURCE_BUILDING_GAP, featureIds: pkg.features.map(feature => feature.id),
  }];
  const groups = new Map<string, Set<string>>();
  for (const claim of pkg.factCandidates) {
    const key = `${claim.entityId}:${claim.property}`;
    const values = groups.get(key) ?? new Set<string>();
    values.add(JSON.stringify(claim.value));
    groups.set(key, values);
  }
  for (const [key, values] of groups) {
    if (values.size < 2) continue;
    findings.push({ id: randomUUID(), category: 'document', code: 'UNRESOLVED_DOCUMENT_CLAIMS',
      message: `${key}: conflicting source literals retained without selection.`, featureIds: [key.split(':')[0]] });
  }
  return findings;
}

async function saveSourcePackageTx(client: PoolClient, pkg: SourceBuildingPackage): Promise<void> {
  await client.query('UPDATE import_packages SET revision=$2,state=$3,body=$4 WHERE id=$1', [
    pkg.id, pkg.revision, pkg.state, pkg,
  ]);
  await client.query('INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,$2,$3)', [
    pkg.id, pkg.revision, pkg,
  ]);
}

export async function reviewSourceBuildings(id: string, expectedRevision: number): Promise<SourceBuildingPackage> {
  return transaction(async client => {
    const pkg: SourceBuildingPackage = (await client.query(
      'SELECT body FROM import_packages WHERE id=$1 FOR UPDATE', [id],
    )).rows[0]?.body ?? notFound();
    if (!isGeometryFreePackage(pkg) || pkg.revision !== expectedRevision || pkg.state === 'COMMITTED') {
      conflict('Refresh the current source building package before review.');
    }
    const area = (await client.query('SELECT * FROM map_areas WHERE id=$1 FOR UPDATE', [pkg.areaId])).rows[0];
    await assertSourceBuildingPinsTx(client, pkg, area.site_id);
    pkg.revision++;
    pkg.state = 'REVIEWED';
    pkg.review = {
      areaRevision: area.revision, packageRevision: pkg.revision,
      inputFingerprint: sourceReviewFingerprint(pkg, area.revision), findings: sourceFindings(pkg),
      coverage: [SOURCE_BUILDING_GAP, 'Source-only review; neighbouring geometry and analytical checks not assessed.'],
    };
    await saveSourcePackageTx(client, pkg);
    return pkg;
  });
}

/** Called only inside the existing package commit transaction and recording lock. */
export async function commitSourceBuildingsTx(
  client: PoolClient, pkg: SourceBuildingPackage, expectedRevision: number, acknowledgement: string,
): Promise<SourceBuildingPackage> {
  if (pkg.state === 'COMMITTED') return pkg;
  if (!isGeometryFreePackage(pkg) || pkg.state !== 'REVIEWED' || pkg.revision !== expectedRevision
    || pkg.review?.packageRevision !== pkg.revision) conflict('Review the current source package before recording.');
  if (!acknowledgement.trim()) {
    throw new AppError(422, 'ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge source gaps and conflicts.');
  }
  const area = (await client.query('SELECT * FROM map_areas WHERE id=$1 FOR UPDATE', [pkg.areaId])).rows[0];
  await assertSourceBuildingPinsTx(client, pkg, area.site_id);
  if (area.revision !== pkg.review!.areaRevision
    || sourceReviewFingerprint(pkg, area.revision) !== pkg.review!.inputFingerprint) {
    conflict('The source review fingerprint changed.');
  }
  const site = (await client.query(
    'SELECT revision FROM registry_sites WHERE id=$1 FOR UPDATE', [area.site_id],
  )).rows[0];
  for (const feature of pkg.features) {
    await recordSourceBuildingTx(client, pkg, feature, area.revision + 1, site.revision + 1);
  }
  await client.query('UPDATE registry_sites SET revision=revision+1 WHERE id=$1', [area.site_id]);
  await client.query('UPDATE map_areas SET revision=revision+1 WHERE id=$1', [pkg.areaId]);
  pkg.revision++;
  pkg.state = 'COMMITTED';
  pkg.acknowledgement = acknowledgement.trim();
  await saveSourcePackageTx(client, pkg);
  return pkg;
}

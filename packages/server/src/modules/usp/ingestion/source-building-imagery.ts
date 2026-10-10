import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import type { PoolClient } from 'pg';
import {
  ImageryAreaImportSchema, RetainedImagerySchema,
  type AreaReference, type ImageryAreaImport, type ImportPackage, type RetainedImagery,
} from '@ulpin/contracts';
import { RasterOriginalSchema } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { putOriginal, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { originalAttempt } from '../../cases/original-attempt';
import { localOperatorSubject } from '../principal';
import { sourceImportDestinationTx, type SourceBuildingFile } from './source-building-import';

export type ImageryPackage = ImportPackage & { imagery: RetainedImagery; sourceImportSha256: string };
type Chip = RetainedImagery['chips'][number];
type PublisherChip = {
  id: string; cluster_id: string; source_crs: string; affine: Chip['affine']; width: number; height: number;
  source_image: { sha256: string; url: string; acquired_at: string; licence: string; attribution: string };
};
type Context = { package: ImageryPackage; caseId: string };

function frozenChips(clusterId: string): PublisherChip[] {
  const root = settings.repositoryRoot;
  const preregistration = JSON.parse(readFileSync(join(root, 'docs/evidence/gf-ai/preregistration.json'), 'utf8'));
  if (!preregistration.building_mask.holdout.cluster_ids.includes(clusterId)) {
    throw new AppError(422, 'IMAGERY_CLUSTER', 'Choose a frozen Karnataka display cluster, not evaluation truth.');
  }
  const split = JSON.parse(readFileSync(join(root, 'docs/evidence/gf-ai/building/split/split.json'), 'utf8'));
  const bytes = readFileSync(split.source_index.path);
  if (sha256(bytes) !== split.source_index.sha256) {
    throw new AppError(422, 'IMAGERY_INDEX', 'The retained publisher image index changed.');
  }
  const chips = (JSON.parse(bytes.toString('utf8')).items as PublisherChip[])
    .filter(chip => chip.cluster_id === clusterId);
  if (chips.length < 20 || chips.length > 64) {
    throw new AppError(422, 'IMAGERY_CLUSTER_SIZE', 'Use a bounded cluster with at least twenty retained image chips.');
  }
  return chips;
}

async function inspectChip(chip: PublisherChip, file: SourceBuildingFile): Promise<Chip> {
  if (file.name !== `${chip.id}.tif` || sha256(file.bytes) !== chip.source_image.sha256) {
    throw new AppError(422, 'IMAGERY_ORIGINAL', 'A chip differs from its unchanged publisher image pin.');
  }
  const tiff = await fromArrayBuffer(Uint8Array.from(file.bytes).buffer);
  const image = await tiff.getImage();
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const affine: Chip['affine'] = [resolution[0], 0, origin[0], 0, resolution[1], origin[1]];
  if (await tiff.getImageCount() !== 1 || image.getGeoKeys()?.GeographicTypeGeoKey !== 4326
    || image.getWidth() !== chip.width || image.getHeight() !== chip.height || image.getSamplesPerPixel() !== 3
    || affine.some((value, index) => Math.abs(value - chip.affine[index]) > 1e-12)
    || image.getFileDirectory().hasTag('ModelTransformation')) {
    throw new AppError(422, 'IMAGERY_FRAME', 'Only the exact retained single-grid RGB Karnataka chip is supported.');
  }
  return RetainedImagerySchema.shape.chips.element.parse({
    chipId: chip.id, sourceId: randomUUID(), sourceSha256: chip.source_image.sha256,
    sourceCrs: chip.source_crs, affine, width: chip.width, height: chip.height,
    originalUrl: chip.source_image.url, acquiredAt: chip.source_image.acquired_at,
    licence: chip.source_image.licence, upstreamConditions: chip.source_image.attribution,
  });
}

async function inspectFiles(input: ImageryAreaImport, files: SourceBuildingFile[]): Promise<RetainedImagery> {
  const selected = frozenChips(input.clusterId);
  if (files.length !== selected.length || files.reduce((total, file) => total + file.bytes.length, 0) > 16 * 1024**2) {
    throw new AppError(413, 'IMAGERY_FILES', 'Attach the complete image cluster once within the existing intake bound.');
  }
  const chips: Chip[] = [];
  for (const selectedChip of selected) {
    const matches = files.filter(file => file.key === selectedChip.id);
    if (matches.length !== 1) throw new AppError(422, 'IMAGERY_FILES', 'Attach each publisher chip exactly once.');
    chips.push(await inspectChip(selectedChip, matches[0]));
  }
  return { clusterId: input.clusterId, chips, classification: 'test_only', analyticalEligibility: 'not_assessed' };
}

async function imageryReference(client: PoolClient, imagery: RetainedImagery): Promise<AreaReference> {
  const centers = imagery.chips.map(chip => [
    chip.affine[2] + chip.width * chip.affine[0] / 2,
    chip.affine[5] + chip.height * chip.affine[4] / 2,
  ]);
  const anchor: [number, number] = [
    centers.reduce((sum, point) => sum + point[0], 0) / centers.length,
    centers.reduce((sum, point) => sum + point[1], 0) / centers.length,
  ];
  const projected = (await client.query<{ x: number; y: number }>(
    'SELECT ST_X(p) x,ST_Y(p) y FROM (SELECT ST_Transform(ST_SetSRID(ST_Point($1,$2),4326),6933) p) projection',
    anchor,
  )).rows[0];
  return { sourceCrs: 'EPSG:4326', analysisCrs: 'EPSG:6933', origin: [projected.x, projected.y], anchor,
    verticalReference: 'unknown', transformVersion: 'source-geotiff-display-context/1' };
}

async function contextTx(client: PoolClient, input: ImageryAreaImport, imagery: RetainedImagery): Promise<Context> {
  const key = `imagery-area:${localOperatorSubject()}:${input.requestKey}`;
  const digest = fingerprint({ input, chips: imagery.chips.map(chip => [chip.chipId, chip.sourceSha256]) });
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const prior = (await client.query('SELECT body,case_id FROM import_packages WHERE operation_key=$1', [key])).rows[0];
  if (prior) {
    if (prior.body.sourceImportSha256 !== digest) conflict('This image import key names different originals.');
    return { package: prior.body, caseId: prior.case_id };
  }
  const name = `RAMP Karnataka imagery ${input.clusterId} (test_only)`;
  const reference = await imageryReference(client, imagery);
  const areaId = await sourceImportDestinationTx(client, { name }, reference);
  const site = (await client.query('SELECT frame FROM registry_sites WHERE id=$1', [areaId])).rows[0];
  const caseId = randomUUID();
  await client.query('INSERT INTO cases(id,name,description,frame,site_id) VALUES($1,$2,$3,$4,$5)', [
    caseId, name, 'Image-only display and candidate generation; no publisher truth geometries.', site.frame, areaId,
  ]);
  const pkg: ImageryPackage = { id: randomUUID(), areaId, name, schemaVersion: 'ulpin-canonical/2',
    datasetNamespace: `ramp-imagery:${input.clusterId}`, revision: 1, state: 'RECEIVED', imagery,
    sourceRevisionIds: [], features: [], questions: [], factCandidates: [], parts: [],
    sourceWorkspace: { caseId, frame: site.frame, worldStatus: 'observed',
      areaReferenceFingerprint: fingerprint(reference) }, sourceImportSha256: digest,
    warnings: ['CC BY-NC 4.0 and Maxar upstream conditions; test_only. No evaluation or registry truth imported.'],
    createdAt: new Date().toISOString() };
  await client.query('INSERT INTO import_packages(id,area_id,case_id,state,body,operation_key) VALUES($1,$2,$3,$4,$5,$6)',
    [pkg.id, areaId, caseId, pkg.state, pkg, key]);
  await client.query('INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)', [pkg.id, pkg]);
  return { package: pkg, caseId };
}

async function retainChip(context: Context, chip: Chip, file: SourceBuildingFile): Promise<void> {
  const key = `sources/${chip.sourceId}/${chip.sourceSha256}`;
  if ((await query('SELECT id FROM sources WHERE id=$1 AND sha256=$2', [chip.sourceId, chip.sourceSha256])).rowCount) {
    return;
  }
  await originalAttempt('sources', chip.sourceId, async remember => {
    remember(key);
    await putOriginal(key, file.bytes, 'image/tiff');
    const original = RasterOriginalSchema.parse({ version: 'raster-window/1', subject: localOperatorSubject(),
      sha256: chip.sourceSha256, bytes: file.bytes.length, receivedAt: new Date().toISOString(),
      lineageState: 'caller_declared', lineage: { kind: 'original', issuer: 'DevGlobal / Radiant Earth MLHub',
        originalUrl: chip.originalUrl, acquiredAt: new Date(chip.acquiredAt).toISOString(),
        permissionReference: 'https://creativecommons.org/licenses/by-nc/4.0/', geography: 'India/Karnataka',
        upstreamBytes: null, upstreamRetained: null, parentSha256: null,
        limitations: ['test_only', 'Maxar upstream imagery conditions retained', 'No surveyed footprint or rights'],
        note: chip.upstreamConditions } });
    await query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,
      status,inspection) VALUES($1,$2,$1,1,$3,'geotiff-raster-v1','image/tiff',$4,$5,$6,'received',$7)`, [
      chip.sourceId, context.caseId, file.name, file.bytes.length, chip.sourceSha256, key,
      { profile: 'geotiff-raster-v1', rasterOriginal: original, status: 'needs_input', issues: [],
        summary: 'Original TIFF header verified; no native window scored.' },
    ]);
  });
}

async function completeTx(client: PoolClient, context: Context): Promise<ImageryPackage> {
  const pkg: ImageryPackage = (await client.query(
    'SELECT body FROM import_packages WHERE id=$1 FOR UPDATE', [context.package.id],
  )).rows[0].body;
  if (pkg.state !== 'RECEIVED') return pkg;
  pkg.sourceRevisionIds = pkg.imagery.chips.map(chip => chip.sourceId);
  pkg.parts = pkg.imagery.chips.map(chip => ({ id: chip.sourceId, sourceRevisionId: chip.sourceId, entityIds: [],
    locator: `original GeoTIFF chip ${chip.chipId}`, text: 'Retained imagery; no property or evaluation truth.' }));
  pkg.state = 'READY_FOR_REVIEW';
  pkg.revision++;
  await client.query('UPDATE import_packages SET revision=$2,state=$3,body=$4 WHERE id=$1', [
    pkg.id, pkg.revision, pkg.state, pkg,
  ]);
  await client.query('INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,$2,$3)', [
    pkg.id, pkg.revision, pkg,
  ]);
  return pkg;
}

/** Extend existing multipart import with original-only imagery, never truth polygons or physical features. */
export async function importSourceImagery(raw: unknown, files: SourceBuildingFile[]): Promise<ImageryPackage> {
  const input = ImageryAreaImportSchema.parse(raw);
  const imagery = await inspectFiles(input, files);
  const context = await transaction(client => contextTx(client, input, imagery));
  if (context.package.state !== 'RECEIVED') return context.package;
  for (const chip of context.package.imagery.chips) {
    await retainChip(context, chip, files.find(file => file.key === chip.chipId)!);
  }
  return transaction(client => completeTx(client, context));
}

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SourceBuildingImportSchema, type SourceBuildingImport, type SourceBuildingPackage } from '@ulpin/contracts';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { propertyIdentifier } from '../../../shared/identifiers';
import { getArea } from '../../areas/areas';
import { assertCanonicalAreaScope } from '../../registry/canonical-building';
import { localOperatorSubject } from '../principal';
import { DocumentIngestionService } from './documents';
import { assertSourceBuildingPinsTx } from './source-building-review';
import { reserveSourceBuildingTx } from './source-building-records';
import { sourceAdministrativeContext } from './source-administrative-context';
import {
  SOURCE_BUILDING_GAP, sourceBuildingClaims, sourceRequestKey, type DocumentPins,
} from './source-building-values';

export type SourceBuildingFile = { key: string; name: string; bytes: Uint8Array };
type ImportContext = { packageId: string; areaId: string; caseId: string; complete: boolean };

function validateFiles(input: SourceBuildingImport, files: SourceBuildingFile[]): void {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (files.length !== input.documents.length || totalBytes > 16 * 1024 * 1024) {
    throw new AppError(413, 'SOURCE_BUILDING_FILES', 'Attach each original once, within the 16 MiB total limit.');
  }
  for (const document of input.documents) {
    const matches = files.filter(file => file.key === document.key);
    const file = matches[0];
    if (matches.length !== 1 || !file.bytes.length || file.name !== document.filename
      || sha256(file.bytes) !== document.sourceSha256
      || (input.format === 'document_buildings' && Buffer.from(file.bytes.subarray(0, 5)).toString() !== '%PDF-')) {
      throw new AppError(422, 'SOURCE_BUILDING_ORIGINAL',
        'An attached original differs from its declared original pin.');
    }
  }
  if (input.administrativeContext) {
    const pin = { sourceId: input.requestKey, sourceRevision: 1, sourceSha256: input.documents[0].sourceSha256 };
    sourceAdministrativeContext(input, files[0].bytes, new Map([[input.documents[0].key, pin]]));
  }
}

async function destinationTx(client: PoolClient, input: SourceBuildingImport): Promise<string> {
  if (input.areaId) {
    const area = await getArea(input.areaId, client);
    if (area.revision !== input.expectedAreaRevision) conflict('Destination area changed before import.');
    return area.id;
  }
  const areaId = randomUUID();
  const frame = { id: `AREA-${areaId}`, horizontalUnit: 'm', verticalUnit: 'm', benchmark: 'unknown' };
  await client.query(
    'INSERT INTO registry_sites(id,identifier,name,frame,synthetic) VALUES($1,$2,$3,$4,false)',
    [areaId, propertyIdentifier(areaId), input.name, frame],
  );
  await client.query('INSERT INTO map_areas(id,site_id,name) VALUES($1,$1,$2)', [areaId, input.name]);
  return areaId;
}

function emptyPackage(input: SourceBuildingImport, packageId: string, areaId: string): SourceBuildingPackage {
  return {
    id: packageId, areaId, schemaVersion: 'ulpin-canonical/2', geometryFree: true,
    name: input.name, datasetNamespace: input.namespace, revision: 1, state: 'RECEIVED',
    sourceRevisionIds: [], features: [], questions: [], factCandidates: [], parts: [],
    warnings: [SOURCE_BUILDING_GAP, 'Local development test_only; no rights or operational acceptance.'],
    createdAt: new Date().toISOString(), documentPins: [], sourceMetadata: input.documents,
  };
}

async function createContextTx(client: PoolClient, input: SourceBuildingImport): Promise<ImportContext> {
  const key = `document-buildings:${localOperatorSubject()}:${input.requestKey}`;
  const digest = sha256(Buffer.from(JSON.stringify(input)));
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const prior = (await client.query(
    'SELECT id,area_id,case_id,body FROM import_packages WHERE operation_key=$1', [key],
  )).rows[0];
  if (prior) {
    if (prior.body.sourceImportSha256 !== digest) conflict('This import key names different source declarations.');
    return {
      packageId: prior.id, areaId: prior.area_id, caseId: prior.case_id, complete: prior.body.state !== 'RECEIVED',
    };
  }
  const areaId = await destinationTx(client, input);
  const site = (await client.query(
    'SELECT s.* FROM registry_sites s JOIN map_areas a ON a.site_id=s.id WHERE a.id=$1 FOR UPDATE OF s', [areaId],
  )).rows[0];
  const caseId = randomUUID();
  const packageId = randomUUID();
  await client.query('INSERT INTO cases(id,name,description,frame,site_id) VALUES($1,$2,$3,$4,$5)', [
    caseId, input.name, 'Document-backed source declarations. No footprint, placement, rights or measured geometry.',
    site.frame, site.id,
  ]);
  const body = { ...emptyPackage(input, packageId, areaId), sourceImportSha256: digest };
  await client.query(
    "INSERT INTO import_packages(id,area_id,case_id,state,body,operation_key) VALUES($1,$2,$3,'RECEIVED',$4,$5)",
    [packageId, areaId, caseId, body, key],
  );
  await client.query('INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)', [
    packageId, body,
  ]);
  return { packageId, areaId, caseId, complete: false };
}

async function retainDocuments(
  context: ImportContext, input: SourceBuildingImport, files: SourceBuildingFile[],
): Promise<DocumentPins> {
  const pins: DocumentPins = new Map();
  const documents = new DocumentIngestionService();
  for (const document of input.documents) {
    const file = files.find(item => item.key === document.key)!;
    const receipt = await documents.retain(context.caseId, {
      requestKey: sourceRequestKey(context.packageId, document.key), mode: 'native_only',
    }, file);
    pins.set(document.key, {
      sourceId: receipt.sourceId, sourceRevision: receipt.sourceRevision, sourceSha256: receipt.sourceSha256,
    });
  }
  return pins;
}

async function completePackageTx(
  client: PoolClient, context: ImportContext, input: SourceBuildingImport, pins: DocumentPins,
  originalBytes: Uint8Array,
): Promise<SourceBuildingPackage> {
  const row = (await client.query(
    'SELECT body FROM import_packages WHERE id=$1 FOR UPDATE', [context.packageId],
  )).rows[0];
  const pkg: SourceBuildingPackage = row.body;
  if (pkg.state !== 'RECEIVED') return pkg;
  const area = await getArea(context.areaId, client);
  if (input.areaId && area.revision !== input.expectedAreaRevision) {
    conflict('Destination area changed during receipt.');
  }
  for (const building of input.buildings) {
    const feature = await reserveSourceBuildingTx(client, context.areaId, input, building, pins);
    pkg.features.push(feature);
    pkg.factCandidates.push(...sourceBuildingClaims(building, feature.id, pins));
  }
  pkg.documentPins = [...pins.values()];
  pkg.sourceRevisionIds = pkg.documentPins.map(pin => pin.sourceId);
  if (input.administrativeContext) {
    pkg.administrativeContext = sourceAdministrativeContext(input, originalBytes, pins);
  }
  await assertSourceBuildingPinsTx(client, pkg, area.siteId);
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

/** Same package/source/identity authorities as GIS intake; only normalization is geometry-free. */
export async function importSourceBuildings(raw: unknown, files: SourceBuildingFile[]): Promise<SourceBuildingPackage> {
  const input = SourceBuildingImportSchema.parse(raw);
  validateFiles(input, files);
  if (input.areaId) await assertCanonicalAreaScope(await getArea(input.areaId));
  const context = await transaction(client => createContextTx(client, input));
  if (context.complete) {
    return transaction(async client => {
      const pkg: SourceBuildingPackage = (await client.query(
        'SELECT body FROM import_packages WHERE id=$1', [context.packageId],
      )).rows[0].body;
      const area = await getArea(context.areaId, client);
      await assertSourceBuildingPinsTx(client, pkg, area.siteId);
      return pkg;
    });
  }
  const pins = await retainDocuments(context, input, files);
  return transaction(client => completePackageTx(client, context, input, pins, files[0].bytes));
}

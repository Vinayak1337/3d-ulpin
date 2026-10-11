import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AnyMappingReceiptSchema, AnySourceProfileSchema, IntakeConfirmationSchema, IntakeItemSchema,
  IntakeManifestSchema, IntakeTargetPageSchema, type MappingReceipt, type SourceProfile } from
  '../../../../packages/contracts/src/usp';
import { caseDetail, importPackage, sourceCase } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { intakeHttp } from '../kn2/http';
import { idle, waitFor } from './jobs';

export const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
export const layers = [
  { name: 'buildings-original.geojson', kind: 'building', identifier: '/features/*/properties/doitt_id' },
  { name: 'parks.geojson', kind: 'public_land', identifier: '/features/*/id' },
  { name: 'roadbed.geojson', kind: 'road', identifier: '/features/*/id' },
];
export type Layer = typeof layers[number];

export async function makeCase() {
  const created = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name: 'ZB1 NYC sequential layers test_only' }, 201);
  return created.caseId;
}

export async function manifest(caseId: string) {
  return intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/intake`,
    '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
}

export async function targets(caseId: string) {
  return intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
}

export async function packageRead(id: string) {
  return intakeHttp('GET', `/api/v1/import-packages/${id}`,
    '/api/v1/import-packages/{packageId}', importPackage);
}

async function retain(caseId: string, layer: Layer) {
  const current = await intakeHttp('GET', `/api/v1/cases/${caseId}`, '/api/v1/cases/{caseId}', caseDetail);
  const form = new FormData();
  form.set('file', new File([readFileSync(folder + layer.name)], layer.name, { type: 'application/geo+json' }));
  form.set('format', 'geojson');
  form.set('requestKey', randomUUID());
  form.set('expectedWorkspaceRevision', String(current.case.revision));
  const profile = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/sources`,
    '/api/v1/ingestion/cases/{caseId}/sources', AnySourceProfileSchema, form, 201) as SourceProfile;
  const item = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
    { requestKey: randomUUID(), sourceId: profile.source.sourceId }, 201);
  await idle(caseId);
  return { profile, item };
}

async function answer(caseId: string, profile: SourceProfile, layer: Layer) {
  const plan = { version: profile.version, mode: 'manual_mapping', source: profile.source, caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    kind: layer.kind, operations: [
      { target: 'feature.sourceKey', sourcePath: layer.identifier, conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] };
  const authored = await intakeHttp('POST',
    `/api/v1/ingestion/cases/${caseId}/sources/${profile.source.sourceId}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan }, 201) as MappingReceipt;
  const approved = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/recipes/${authored.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 200);
  return { authored, approved };
}

export async function drop(caseId: string, layer: Layer) {
  const droppedAt = new Date().toISOString();
  const { profile, item } = await retain(caseId, layer);
  const layouts = await answer(caseId, profile, layer);
  const drafted = await waitFor(async () => (await manifest(caseId)).items.find(row => row.itemId === item.itemId)!,
    row => Boolean(row.plan?.packageId));
  const draftedAt = new Date().toISOString();
  return { layer, droppedAt, draftedAt, itemId: item.itemId, packageId: drafted.plan!.packageId!, layouts };
}

export async function confirm(caseId: string, packageId: string, buildingCount: number) {
  const page = await targets(caseId);
  const named = page.packages.find(pkg => pkg.packageId === packageId)!;
  assert(named.reviewFingerprint, 'Cannot confirm without a current review.');
  const pressedAt = new Date().toISOString();
  const created = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/confirmations`,
    '/api/v1/ingestion/cases/{caseId}/confirmations', IntakeConfirmationSchema,
    { requestKey: randomUUID(), acknowledgement: 'ZB1 test_only: observations, no rights or height claim.',
      packages: [{ packageId, revision: named.revision, reviewFingerprint: named.reviewFingerprint }],
      targets: page.items.filter(row => row.packageId === packageId && row.readiness === 'ready')
        .slice(0, buildingCount).map(row => row.targetId) });
  const completed = await waitFor(() => intakeHttp('GET',
    `/api/v1/ingestion/cases/${caseId}/confirmations/${created.confirmationId}`,
    '/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', IntakeConfirmationSchema),
  row => buildingCount ? row.counts.carded === buildingCount : row.packages.length === 1 &&
    row.counts.stopped === 0 && row.counts.recorded === 0);
  await idle(caseId);
  const pkg = await packageRead(packageId);
  assert.equal(pkg.state, 'COMMITTED');
  return { pressedAt, completedAt: new Date().toISOString(), confirmation: completed,
    observedPackageFeatures: pkg.features.length, recordedFeatures: pkg.features.filter(row => row.revision > 0).length };
}

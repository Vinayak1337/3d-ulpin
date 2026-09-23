/** Explicit, isolated D0 import through the existing area, preparation and registry authorities. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaContext, commitPackage, getArea, ingestArea, reviewPackage } from '../../../apps/web/lib/server/areas';
import { pool, query } from '../../../apps/web/lib/server/db';
import type { ImportPackage } from '../../../packages/contracts/src';
import { assertUspIsolation } from '../local-isolation.mjs';
import { verifyD0 } from './verify-d0';

const root = path.resolve('fixtures/usp/D0/golden-v1');
const namespace = 'usp-d0-golden-v1';
const name = 'USP D0 Golden · synthetic';
const reason = 'Reviewed against the byte-pinned synthetic D0 originals. Technical demonstration only; no survey, approval, title or official issuance claim.';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (name: string) => readFile(path.join(root, name));
const apiBase = new URL(process.env.ULPIN_TEST_BASE_URL || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost', '::1'].includes(apiBase.hostname)) throw Error('D0 import requires a loopback API');
const api = async <T = any>(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> => {
  const response = await fetch(new URL(`/api/v1${route}`, apiBase), {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${route} returned ${response.status}: ${JSON.stringify(data)}`);
  return data as T;
};

async function importLayer(kind: 'building' | 'parcel', areaId?: string): Promise<ImportPackage> {
  const filename = `${kind}s.arcgis.json`;
  const original = await bytes(filename);
  const sourceNamespace = `${namespace}:${kind}`;
  const previous = (await query(
    "SELECT p.body FROM import_packages p WHERE p.body->>'datasetNamespace'=$1 AND NOT EXISTS (SELECT 1 FROM building_preparations b WHERE b.package_id=p.id) ORDER BY p.created_at DESC LIMIT 2",
    [sourceNamespace],
  )).rows;
  if (previous.length > 1) throw Error(`${sourceNamespace}: multiple packages require manual review`);
  if (previous[0]) {
    const pkg = previous[0].body as ImportPackage;
    if (pkg.state !== 'COMMITTED' || pkg.sourceRevisionIds.length !== 1) throw Error(`${sourceNamespace}: unfinished package requires manual review`);
    const stored = (await query('SELECT sha256 FROM sources WHERE id=$1', [pkg.sourceRevisionIds[0]])).rows[0];
    if (stored?.sha256 !== sha256(original)) throw Error(`${sourceNamespace}: existing original differs; preserving it`);
    return pkg;
  }
  let pkg = await ingestArea({
    bytes: original, filename, format: 'arcgis', namespace: sourceNamespace, name,
    worldStatus: 'synthetic', areaId,
    expectedAreaRevision: areaId ? (await getArea(areaId)).revision : undefined,
    mapping: {
      idField: 'id', nameField: 'name', kind, geometryRole: 'unknown',
      ...(kind === 'building' ? {
        heightField: 'height', heightUnit: 'm' as const,
        heightMeaning: 'Authored top of the supplied D0 level schedule; synthetic, not observed height.',
        levelReference: 'BM-D0-SYNTHETIC',
      } : {}),
    },
  });
  pkg = await reviewPackage(pkg.id, pkg.revision);
  return commitPackage(pkg.id, pkg.revision, reason);
}

async function attach(pkg: ImportPackage, buildingId: string, filename: string, format: 'text' | 'csv', options: { referenceOnly?: boolean; familyId?: string } = {}) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(await bytes(filename))]), filename);
  form.set('format', format);
  form.set('expectedRevision', String(pkg.revision));
  form.set('entityIds', JSON.stringify([buildingId]));
  if (options.referenceOnly) form.set('referenceOnly', 'true');
  if (options.familyId) form.set('familyId', options.familyId);
  const response = await fetch(new URL(`/api/v1/import-packages/${pkg.id}/documents`, apiBase), { method: 'POST', body: form });
  const result = await response.json();
  if (!response.ok) throw Error(`Attach ${filename}: ${response.status} ${JSON.stringify(result)}`);
  return result as ImportPackage;
}

async function sourceIdByHash(pkg: ImportPackage, filename: string): Promise<string> {
  const digest = sha256(await bytes(filename));
  const matches = (await query('SELECT id FROM sources WHERE id=ANY($1::uuid[]) AND sha256=$2', [pkg.sourceRevisionIds, digest])).rows;
  if (matches.length !== 1) throw Error(`${filename}: expected one retained original by SHA-256`);
  return matches[0].id;
}

function bodyOnly(record: any) {
  const { id: _id, siteId: _siteId, identifier: _identifier, revision: _revision, ...body } = record;
  if (body.geometry) {
    const { area: _area, height: _height, volume: _volume, ...editableGeometry } = body.geometry;
    body.geometry = editableGeometry;
  }
  return body;
}

function retainRecordIds(records: any[], buildingAlias: string, output: Record<string, string>) {
  const buildingRecords = records.filter(record => record.kind === 'building');
  if (buildingRecords.length !== 1) throw Error(`${buildingAlias}: expected one recorded building identity`);
  output[buildingAlias] = buildingRecords[0].id;
  for (const record of records) if (record.kind === 'space' || record.kind === 'floor') output[record.alias] = record.id;
}

async function sourcePart(pkg: ImportPackage, filename: string, locator: string, token: string) {
  const sourceRevisionId = await sourceIdByHash(pkg, filename);
  const part = pkg.parts.find(p => p.sourceRevisionId === sourceRevisionId && p.locator === locator && p.text.includes(token));
  if (!part) throw Error(`${filename} ${locator}: exact extracted part missing`);
  return { sourceRevisionId, sourceId: sourceRevisionId, partId: part.id, locator };
}

async function exactMixedBindings(pkg: ImportPackage) {
  return {
    'U-A101': [
      await sourcePart(pkg, 'mixed-page-r2.txt', 'line 3', 'ONLY_A101'),
      await sourcePart(pkg, 'mixed-page-r2.txt', 'line 5', 'SHARED_STAIR_CONTEXT'),
      await sourcePart(pkg, 'mixed-rows-r2.csv', 'CSV row 2', 'ONLY_A101'),
      await sourcePart(pkg, 'mixed-rows-r2.csv', 'CSV row 4', 'SHARED_STAIR_CONTEXT'),
    ],
    'U-A102': [
      await sourcePart(pkg, 'mixed-page-r2.txt', 'line 4', 'NEVER_A102'),
      await sourcePart(pkg, 'mixed-page-r2.txt', 'line 5', 'SHARED_STAIR_CONTEXT'),
      await sourcePart(pkg, 'mixed-rows-r2.csv', 'CSV row 3', 'NEVER_A102'),
      await sourcePart(pkg, 'mixed-rows-r2.csv', 'CSV row 4', 'SHARED_STAIR_CONTEXT'),
    ],
  };
}

async function apply() {
  assertUspIsolation(process.env);
  if (apiBase.href !== new URL(process.env.ULPIN_TEST_URL!).href) throw Error('D0 API URL differs from the isolated runner endpoint');
  const lock = await pool().connect();
  try {
    const claimed = (await lock.query("SELECT pg_try_advisory_lock(hashtext('usp-d0-golden-v1-import')) ok")).rows[0]?.ok;
    if (!claimed) throw Error('Another D0 import is active');
    const scenario = JSON.parse(await readFile(path.join(root, 'scenario.json'), 'utf8'));
    const buildings = await importLayer('building');
    const parcels = await importLayer('parcel', buildings.areaId);
    if (parcels.areaId !== buildings.areaId) throw Error('Building and parcel layers were installed in different areas');
    const areaId = buildings.areaId;
    let context = await areaContext(areaId);
    const physicalFeatures: Record<string, string> = {};
    for (const feature of context.features) if (scenario.buildings.some((b: any) => b.alias === feature.sourceKey) || scenario.parcels.some((p: any) => p.alias === feature.sourceKey)) physicalFeatures[feature.sourceKey] = feature.id;
    for (const alias of [...scenario.buildings, ...scenario.parcels].map((value: any) => value.alias)) if (!physicalFeatures[alias]) throw Error(`Missing physical feature ${alias}`);
    for (const building of scenario.buildings) for (const parcelAlias of building.parcels) {
      const fromId = physicalFeatures[building.alias], toId = physicalFeatures[parcelAlias];
      const existing = (await query("SELECT id FROM property_associations WHERE from_id=$1 AND to_id=$2 AND relationship='occupies_parcel' AND status='confirmed'", [fromId, toId])).rows[0];
      if (existing) continue;
      const b = context.features.find(f => f.id === fromId)!, p = context.features.find(f => f.id === toId)!;
      await api('/property-associations', { fromId, toId, relationship: 'occupies_parcel', status: 'confirmed',
        expectedRevision: 0, expectedFromRevision: b.revision, expectedToRevision: p.revision,
        evidence: [...b.evidence, ...p.evidence], reason });
    }
    const records: Record<string, string> = {};
    const sourceParts: Record<string, { sourceRevisionId: string; locator: string; partId: string }[]> = {};
    const retainedSourceIds = new Set<string>([...buildings.sourceRevisionIds, ...parcels.sourceRevisionIds]);
    for (const building of scenario.buildings) {
      const feature = context.features.find(f => f.id === physicalFeatures[building.alias])!;
      const dossier = await api<any>(`/buildings/${feature.id}/dossier`);
      if (dossier.records.some((record: any) => record.kind === 'space')) {
        retainRecordIds(dossier.records, building.alias, records);
        const existing = (await query('SELECT body FROM building_preparations WHERE building_id=$1', [feature.id])).rows[0]?.body;
        if (existing?.packageId) {
          const prior = await api<ImportPackage>(`/import-packages/${existing.packageId}`);
          for (const id of prior.sourceRevisionIds) retainedSourceIds.add(id);
          if (building.alias === 'B-A') {
            const expected = await exactMixedBindings(prior);
            for (const [alias, parts] of Object.entries(expected)) {
              const recorded = dossier.records.find((record: any) => record.alias === alias);
              sourceParts[alias] = recorded ? parts.filter(part => recorded.evidence.some((binding: any) =>
                binding.sourceId === part.sourceId && binding.locator === part.locator))
                .map(({ sourceRevisionId, locator, partId }) => ({ sourceRevisionId, locator, partId })) : [];
            }
          }
        }
        continue; // Keep every previous user edit, identity, source and recorded revision.
      }
      const prep = await api<any>(`/buildings/${feature.id}/preparation-cases`, { expectedRevision: feature.revision, requestKey: randomUUID() });
      let pkg = await api<ImportPackage>(`/import-packages/${prep.packageId}`);
      if (pkg.sourceRevisionIds.length !== 1) throw Error(`${building.alias}: preparation already has documents; inspect it before resuming`);
      pkg = await attach(pkg, feature.id, `spaces-${building.alias}.csv`, 'csv');
      if (building.alias === 'B-A') {
        pkg = await attach(pkg, feature.id, 'mixed-page-r1.txt', 'text');
        const pageFamilyId = await sourceIdByHash(pkg, 'mixed-page-r1.txt');
        pkg = await attach(pkg, feature.id, 'mixed-page-r2.txt', 'text', { familyId: pageFamilyId });
        pkg = await attach(pkg, feature.id, 'mixed-rows-r1.csv', 'csv', { referenceOnly: true });
        const tableFamilyId = await sourceIdByHash(pkg, 'mixed-rows-r1.csv');
        pkg = await attach(pkg, feature.id, 'mixed-rows-r2.csv', 'csv', { referenceOnly: true, familyId: tableFamilyId });
      }
      for (const fact of [...pkg.factCandidates]) if (!pkg.selectedClaimIds?.includes(fact.id)) {
        pkg = await api(`/import-packages/${pkg.id}/resolve-fact`, { expectedRevision: pkg.revision, claimId: fact.id, reason });
      }
      context = await areaContext(areaId);
      const latest = context.features.find(f => f.id === feature.id)!;
      if (latest.geometry.type !== 'Polygon') throw Error(`${building.alias}: expected polygon exterior`);
      const source = building.outer;
      const current = latest.geometry.coordinates[0];
      const sourceMin = [Math.min(...source.map((p: number[]) => p[0])), Math.min(...source.map((p: number[]) => p[1]))];
      const targetMin = [Math.min(...current.map(p => p[0])), Math.min(...current.map(p => p[1]))];
      await api(`/import-packages/${pkg.id}/placement`, {
        expectedRevision: prep.revision, sourceFrame: scenario.frame.id,
        verticalReference: scenario.frame.verticalBenchmark,
        sourceVerticalReference: scenario.frame.verticalBenchmark, verticalOffset: 0,
        controlPoints: [
          { source: sourceMin, target: targetMin },
          { source: [sourceMin[0] + 10, sourceMin[1]], target: [targetMin[0] + 10, targetMin[1]] },
        ], evidence: pkg.factCandidates[0].evidence, reason,
      });
      pkg = await api(`/import-packages/${pkg.id}`);
      for (const id of pkg.sourceRevisionIds) retainedSourceIds.add(id);
      await api(`/import-packages/${pkg.id}/prepare-details`, { expectedRevision: pkg.revision });
      let detail: any;
      for (let i = 0; i < 180; i++) {
        detail = await api(`/cases/${prep.caseId}`);
        if (detail.model?.revision === detail.case.revision) break;
        if (detail.jobs[0]?.status === 'failed') throw Error(`${building.alias}: build failed: ${JSON.stringify(detail.jobs[0])}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (detail.model?.revision !== detail.case.revision) throw Error(`${building.alias}: build timed out; caseRevision=${detail.case.revision} modelRevision=${detail.model?.revision ?? 'none'} jobStates=${JSON.stringify(detail.jobs.map((job: any) => ({ operation: job.operation, status: job.status, error: job.error?.code ?? null })))}`);
      const expectedComponents = scenario.spaces.filter((space: any) => space.building === building.alias && space.type === 'unit')
        .reduce((sum: number, space: any) => sum + space.components.length, 0);
      if (detail.model.units.length !== expectedComponents) throw Error(`${building.alias}: built ${detail.model.units.length}, expected ${expectedComponents} native schedule components`);
      const firstReview = await api<any>(`/buildings/${feature.id}/detail-review`, { expectedRevision: detail.case.revision });
      let finalReview = firstReview;
      if (building.alias === 'B-A') {
        const bindings = await exactMixedBindings(pkg);
        let draft = await api<any>(`/registry-drafts/${firstReview.draftId}`);
        for (const [alias, refs] of Object.entries(bindings)) {
          const record = draft.records.find((item: any) => item.alias === alias);
          if (!record) throw Error(`Draft missing ${alias}`);
          const body = bodyOnly(record);
          body.evidence = [...body.evidence, ...refs.map(({ sourceId, locator }) => ({ sourceId, locator }))];
          draft = await api(`/registry-drafts/${draft.id}`, { expectedRevision: draft.revision, recordId: record.id, body }, 'PATCH');
          sourceParts[alias] = refs.map(({ sourceRevisionId, locator, partId }) => ({ sourceRevisionId, locator, partId }));
        }
        finalReview = await api(`/registry-drafts/${draft.id}/review`, {
          expectedRevision: draft.revision, expectedSiteRevision: firstReview.siteRevision,
        });
      }
      await api(`/registry-reviews/${finalReview.id}/commit`, { acknowledgement: reason });
      const recorded = await api<any>(`/buildings/${feature.id}/dossier`);
      // Recording adds the reviewed detail derivative to this preparation.
      // First apply and replay must describe the same final retained history.
      const committedPackage = await api<ImportPackage>(`/import-packages/${pkg.id}`);
      for (const id of committedPackage.sourceRevisionIds) retainedSourceIds.add(id);
      retainRecordIds(recorded.records, building.alias, records);
      if (building.alias === 'B-A') {
        for (const alias of ['U-A101', 'U-A102']) {
          const record = recorded.records.find((item: any) => item.alias === alias);
          const expected = sourceParts[alias];
          if (!record || expected.length !== 4 || expected.some(part => !record.evidence.some((binding: any) => binding.sourceId === part.sourceRevisionId && binding.locator === part.locator)))
            throw Error(`${alias}: reviewed exact source bindings missing after commit`);
        }
        const a101 = recorded.records.find((item: any) => item.alias === 'U-A101');
        if (a101.evidence.some((binding: any) => sourceParts['U-A102'].some(part => part.sourceRevisionId === binding.sourceId && ['line 4', 'CSV row 3'].includes(binding.locator))))
          throw Error('U-A101 has A102-only evidence after commit');
      }
    }
    const area = await getArea(areaId);
    const originalHashes = Object.fromEntries((await Promise.all(['scenario.json','buildings.arcgis.json',
      'scenario-courtyard-draft.json','buildings-courtyard-draft.arcgis.json','parcels.arcgis.json',
      'spaces-B-A.csv','spaces-B-B.csv','spaces-B-C.csv','mixed-page-r1.txt','mixed-page-r2.txt',
      'mixed-rows-r1.csv','mixed-rows-r2.csv'].map(async filename => [filename, sha256(await bytes(filename))]))));
    const sourceRows = (await query('SELECT id,name,sha256,family_id,revision FROM sources WHERE id=ANY($1::uuid[]) ORDER BY name,revision', [[...retainedSourceIds]])).rows;
    if (sourceRows.length !== retainedSourceIds.size) throw Error('A retained D0 source revision is missing');
    const sourceHashesByRevisionId = Object.fromEntries(sourceRows.map(row => [row.id, row.sha256]));
    return { schemaVersion: 'usp-d0-import-receipt/1', packProfile: 'golden-v1', areaId, siteId: area.siteId,
      physicalFeatures, records, sourceParts, originalHashes, sourceHashesByRevisionId,
      sources: sourceRows.map(row => ({ sourceRevisionId: row.id, familyId: row.family_id, revision: row.revision, name: row.name, sha256: row.sha256 })),
      limitations: ['Synthetic source only', 'Courtyard source retained as an unrecorded draft because the registry accepts one simple ring',
        'Compound duplex and shared stair remain authored source truth; native preparation currently records separate schedule components'],
    };
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext('usp-d0-golden-v1-import'))").catch(() => {});
    lock.release(); await pool().end();
  }
}

const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const receiptFlag = args.indexOf('--receipt');
if (args.some((arg, index) => !['--apply', '--receipt'].includes(arg) && index !== receiptFlag + 1) || (receiptFlag >= 0 && (!applyMode || !args[receiptFlag + 1]))) {
  throw Error('Usage: tsx scripts/usp/data/import-d0.ts [--apply [--receipt /tmp/receipt.json]]');
}
const verification = await verifyD0();
if (!applyMode) console.log(JSON.stringify({ ...verification, action: 'plan-only; no service or database writes' }, null, 2));
else {
  const receipt = await apply();
  if (receiptFlag >= 0) await writeFile(args[receiptFlag + 1], JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
}

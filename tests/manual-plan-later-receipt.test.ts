import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AnyStreamingInputSchema, ChunkMappingInputSchema, MappingReceiptSchema, type MappingPlan } from
  '../packages/contracts/src/usp';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { localOperatorSubject } from '../packages/server/src/modules/usp/principal';
import { ingestionBinding } from '../packages/server/src/modules/usp/ingestion/events';
import { geojsonInventory, inspectedProfile } from '../packages/server/src/modules/usp/ingestion/registry';
import { validateAdaptiveMapping } from '../packages/server/src/modules/usp/ingestion/adaptive-mapping';
import { proposeAdaptiveMapping } from '../packages/server/src/modules/usp/ingestion/adaptive-mapping-service';
import { streamingReaderSha } from '../packages/server/src/modules/usp/ingestion/streaming-vector';
import { assertChunkMappingInputTx, ChunkMappingService } from
  '../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { ManualIngestionService, manualProfileForLockedSourceTx } from
  '../packages/server/src/modules/usp/ingestion/service';
import { sufficiencyCaseTx, sufficiencySourceTx } from
  '../packages/server/src/modules/usp/ingestion/sufficiency-context';
import { localReaderControl, ManualCaseControl, servicePoolControl } from './reader-pin-control';

// The public single-feature NYC original in fixtures, read only; case, jobs and later receipts are protocol controls.
const bytes = readFileSync(new URL('../fixtures/real-nyc/original.geojson', import.meta.url));
const stale = (error: any) => error?.status === 409;
const proposal = { decision: 'propose', reason: 'none', operations: [
  { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id', conversionId: 'literal_identifier@1' },
  { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
] };

function inventory() {
  const rows = geojsonInventory(bytes);
  const raw = JSON.parse(bytes.toString('utf8'));
  const inspection = { format: 'geojson' as const, sourceSha256: sha256(bytes), bytes: bytes.length, layers: [],
    layer: null, sourceCrs: 'EPSG:4326', crsEvidence: raw.crs.properties.name, featureCount: rows.length,
    geometryTypes: [...new Set(rows.map(row => (row.geometry as { type: string }).type))],
    fields: Object.keys(rows[0].properties!).map(name => ({ name, complete: false, unique: false, idEligible: false })),
    featureIdEligible: false, suggestedIdField: null, suggestedNameField: null };
  return { inspection, manualProfile: inspectedProfile(bytes, { ...inspection, suggestedTitle: 'control',
    suggestedNamespace: 'control' }) };
}

/** The sufficiency projection reads the case's sources, the destination area and no geometry. */
class SufficiencyCaseControl extends ManualCaseControl {
  area = { id: randomUUID(), revision: 3, site_id: randomUUID(), actual_reference: null,
    reference_sha: fingerprint(null), site_revision: 1, frame_sha: fingerprint(null) };

  protected read(sql: string, args: any[]) {
    if (sql.includes('LIMIT 257')) {
      return this.all().map(row => ({ ...row, owner: row.inspection?.actor ?? null, inspection_sha: 'i',
        object_sha: 'o' }));
    }
    if (sql.includes('has_parts')) return [{ ...this.source, manual: this.source.inspection.manualProfile,
      projected: null, document_original: null, has_parts: false }];
    if (sql.includes('FROM map_areas')) return [{ ...this.area }];
    if (sql.includes('FROM physical_features')) return [];
    return super.read(sql, args);
  }
}

function geojsonCase() {
  const id = randomUUID();
  const hash = sha256(bytes);
  const { inspection, manualProfile } = inventory();
  return new SufficiencyCaseControl({ id, family_id: id, revision: 1, sha256: hash, bytes: bytes.length,
    object_key: `sources/${id}/${hash}`, profile: 'geojson-manual-v1', inspection: { actor: localOperatorSubject(),
      gis: inspection, manualProfile } });
}

async function approvedPlan(c: SufficiencyCaseControl) {
  const profile = await manualProfileForLockedSourceTx(c.client, c.caseId, c.revision, c.source);
  const checked = validateAdaptiveMapping(proposal, profile);
  assert.equal(checked.status, 'proposed');
  approve(c, checked.plan!);
  return profile;
}

function approve(c: SufficiencyCaseControl, plan: MappingPlan) {
  const subject = localOperatorSubject();
  const destination = { kind: 'existing_area' as const, areaId: c.area.id, expectedAreaRevision: c.area.revision,
    referenceFingerprint: fingerprint(null), namespace: 'k15-control', name: 'protocol' };
  const planHash = fingerprint({ plan, destination });
  const at = new Date().toISOString();
  c.recipe = MappingReceiptSchema.parse({ id: randomUUID(), revision: 2, state: 'approved', plan, destination,
    planHash, authoredBy: subject, authoredAt: at,
    approval: { subject, at, planHash, provenance: 'server_configured_local_operator' }, execution: null });
}

function queueRaw(c: SufficiencyCaseControl) {
  const binding = ingestionBinding(c.caseId);
  const base = { version: 'geojson-stream/2', jobId: randomUUID(), caseId: c.caseId, caseRevision: c.revision,
    sourceId: c.source.id, sourceRevision: 1, sourceFamilyId: c.source.family_id, sourceSha256: c.source.sha256,
    sourceBytes: c.source.bytes, objectKey: c.source.object_key, framing: 'feature-collection',
    subject: binding.subject, accessBinding: binding.access, readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...base, inputFingerprint: fingerprint(base) });
  c.enroll(raw, 'streaming-vector');
  return raw;
}

async function exactRecipe(c: SufficiencyCaseControl) {
  const scope = await sufficiencyCaseTx(c.client, c.caseId);
  return (await sufficiencySourceTx(c.client, scope, c.source.id)).exactRecipe;
}

test('a GeoJSON plan approved at revision n is the route of a mapping admitted at n+2, destination unchanged', () =>
  localReaderControl(() => {
    const c = geojsonCase();
    return servicePoolControl(c, bytes, async () => {
      await approvedPlan(c);
      c.receive();
      c.receive();
      const status = await new ChunkMappingService().enqueue(c.caseId, c.source.id, { requestKey: randomUUID(),
        rawJobId: queueRaw(c).jobId, expectedCaseRevision: c.revision, expectedSourceRevision: 1,
        sourceSha256: c.source.sha256 });
      assert.equal(status.route, 'approved_recipe');
      const input = ChunkMappingInputSchema.parse(c.jobs.get(status.jobId)!.payload);
      assert.equal(input.planHash, c.recipe!.planHash);
      c.receive();
      assert.equal((await assertChunkMappingInputTx(c.client, input)).approved?.receipt.planHash, input.planHash);
      c.receive(true);
      await assert.rejects(() => assertChunkMappingInputTx(c.client, input), stale);
    });
  }));

test('a proposal requested with the pair of revision n is answered at n+1, and refused once superseded', () =>
  localReaderControl(() => {
    const c = geojsonCase();
    return servicePoolControl(c, bytes, async () => {
      const manual = new ManualIngestionService();
      const profile = await manual.inspect(c.caseId, c.source.id);
      const request = { requestKey: randomUUID(), source: profile.source, workspaceRevision: profile.workspaceRevision,
        workspaceFingerprint: profile.workspaceFingerprint };
      const deps = { readProfile: (caseId: string, sourceId: string) => manual.inspect(caseId, sourceId),
        assertCaseActive: async () => {}, policyHash: () => undefined,
        gatewayFactory: async () => { throw new Error('No provider is called while the gateway is off.'); } };
      c.receive();
      const answer = await proposeAdaptiveMapping(c.caseId, c.source.id, request, deps);
      assert.equal(answer.status, 'disabled');
      assert.equal(answer.workspaceRevision, 2);
      c.receive(true);
      await assert.rejects(() => proposeAdaptiveMapping(c.caseId, c.source.id, request, deps), stale);
    });
  }));

test('sufficiency keeps an exact recipe after an unrelated file, not after a moved destination or new revision', () =>
  localReaderControl(() => {
    const c = geojsonCase();
    return servicePoolControl(c, bytes, async () => {
      await approvedPlan(c);
      assert.equal(await exactRecipe(c), true);
      c.receive();
      assert.equal(await exactRecipe(c), true);
      c.area.revision++;
      assert.equal(await exactRecipe(c), false);
      c.area.revision--;
      c.receive(true);
      assert.equal(await exactRecipe(c), false);
    });
  }));

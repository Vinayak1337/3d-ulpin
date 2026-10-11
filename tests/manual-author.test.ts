import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { GisInspection } from '@ulpin/contracts';
import { ManualCaseControl, localReaderControl, servicePoolControl } from './reader-pin-control';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { localOperatorSubject } from '../packages/server/src/modules/usp/principal';
import { ManualIngestionService } from '../packages/server/src/modules/usp/ingestion/service';
import { geojsonInventory, inspectedProfile } from '../packages/server/src/modules/usp/ingestion/registry';
import { intakeDraftKey, queueIntakeDraftTx } from '../packages/server/src/modules/usp/ingestion/intake-draft';
import type { IntakeSourceRow } from '../packages/server/src/modules/usp/ingestion/intake-context';
import { inspectTabularSource } from '../packages/server/src/modules/usp/ingestion/tabular-source';
import { manualTeacherPlan } from '../packages/server/src/modules/usp/ingestion/mapping-teacher';

// SQL protocol checks call the actual author and queue using a retained public original, not a runtime database.
class AuthorControl extends ManualCaseControl {
  registered = true;
  tray = { item_id: '', source_id: '', case_id: '', parent_item_id: null, state: 'probed', family: 'vector',
    plan_ref: null, card: { crs: { state: 'stated' } } };
  projection: Record<string, unknown> = {};
  events: string[] = [];
  operations = new Map<string, { payload_hash: string; result: unknown }>();

  constructor(bytes: Uint8Array, manualProfile: unknown, profile = 'geojson-manual-v1') {
    const id = randomUUID();
    super({ id, family_id: id, revision: 1, sha256: sha256(bytes), bytes: bytes.length,
      object_key: `sources/${id}/original`, name: 'Public original protocol', profile, status: 'needs_input',
      inspection: { actor: localOperatorSubject(), manualProfile } });
    Object.assign(this.tray, { item_id: id, source_id: id, case_id: this.caseId });
  }

  protected read(sql: string, args: any[]) {
    if (sql.includes("kind='manual-mapping'")) {
      const prior = this.operations.get(args[1]);
      return prior ? [prior] : [];
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return this.registered ? [this.tray] : [];
    if (sql.startsWith('SELECT revision FROM usp_mapping_recipes'))
      return this.recipe ? [{ revision: this.recipe.revision }] : [];
    if (sql.includes('FROM jobs') && sql.includes('status IN'))
      return [...this.jobs.values()].filter(job => ['queued', 'running'].includes(job.status));
    if (sql.startsWith('SELECT state,placement,plan_ref')) return [this.projection];
    if (sql.startsWith('SELECT item_id AS')) return [{ itemId: this.tray.item_id, state: this.tray.state,
      family: 'vector', format: 'geojson', sizeClass: 'S', wave: 1, pinnedByOfficer: false }];
    if (sql.includes('FROM map_areas WHERE seed_key')) return [];
    return super.read(sql, args);
  }

  protected write(sql: string, args: any[]) {
    if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(args[1], { payload_hash: args[2], result: structuredClone(args[3]) });
      return [];
    }
    if (sql.startsWith('INSERT INTO jobs(')) {
      this.jobs.set(args[0], { id: args[0], status: 'queued', operation: 'intake-draft', payload: args[5],
        case_id: args[1], source_id: args[2], case_revision: args[3], input_fingerprint: args[4] });
      return [];
    }
    if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
      this.projection = { state: args[2], placement: args[3], plan_ref: args[4],
        records_seen: args[5], limit_reason: args[6] };
      this.tray.state = args[2];
      return [];
    }
    if (sql.startsWith('INSERT INTO usp_outbox(')) {
      this.events.push(args[2].change.kind);
      return [];
    }
    return super.write(sql, args);
  }
}

const bytes = readFileSync('fixtures/real-nyc/original.geojson');
function geoControl() {
  const rows = geojsonInventory(bytes);
  const raw = JSON.parse(bytes.toString());
  const inspection = { format: 'geojson', sourceSha256: sha256(bytes), featureCount: rows.length,
    sourceCrs: 'EPSG:4326', crsEvidence: raw.crs.properties.name, geometryTypes: ['MultiPolygon'],
    fields: Object.keys(rows[0].properties!).map(name => ({ name })) } as GisInspection;
  return new AuthorControl(bytes, inspectedProfile(bytes, inspection));
}
async function request(control: AuthorControl) {
  const profile = await new ManualIngestionService().inspect(control.caseId, control.source.id);
  return { requestKey: String(randomUUID()), expectedRecipeRevision: 0, plan: { version: profile.version,
    mode: 'manual_mapping', source: profile.source, caseId: profile.caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    kind: 'building', operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/doitt_id',
        conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] }, destination: { kind: 'new_area', namespace: 'protocol-author', name: 'Protocol author' } };
}
function check(run: (control: AuthorControl) => Promise<void>) {
  return localReaderControl(async () => {
    const control = geoControl();
    await servicePoolControl(control, bytes, () => run(control));
  });
}

test('map author saves/publishes then enrolls; reauthor revision moves its job and replay adds nothing', () =>
  check(async control => {
    const service = new ManualIngestionService();
    const input = await request(control);
    const first = await service.author(control.caseId, control.source.id, input);
    assert.deepEqual(control.events, ['recipe.changed']);
    assert.equal(control.jobs.size, 1);
    assert.equal([...control.jobs.values()][0].payload.recipeRevision, 1);
    [...control.jobs.values()][0].status = 'succeeded';
    const second = await service.author(control.caseId, control.source.id,
      { ...input, requestKey: randomUUID(), expectedRecipeRevision: 1 });
    assert.equal(second.revision, 2);
    assert.equal(control.jobs.size, 2);
    assert.deepEqual([...control.jobs.values()].map(job => job.payload.recipeRevision), [1, 2]);
    const eventCount = control.events.length;
    assert.deepEqual(await service.author(control.caseId, control.source.id, input), first);
    assert.equal(control.jobs.size, 2);
    assert.equal(control.events.length, eventCount);
  }));

test('memory-path author finds the running draft job and does not enroll another', () =>
  check(async control => {
    const jobId = await queueIntakeDraftTx(control.client, control.source as IntakeSourceRow);
    control.jobs.get(jobId!)!.status = 'running';
    const input = await request(control);
    input.requestKey = intakeDraftKey(control.tray.item_id, 0, 'author');
    await new ManualIngestionService().author(control.caseId, control.source.id, input);
    assert.equal(control.jobs.size, 1);
    assert.equal(control.jobs.get(jobId!)!.status, 'running');
    // The actual worker's origin projection is proved separately by the HTTP memory walk.
  }));

test('over-limit author leaves the queue-written waiting reason and emits the item after recipe.changed', () =>
  check(async control => {
    control.source.inspection.manualProfile.featureCount = 2001; // Deliberate protocol limit control.
    const receipt = await new ManualIngestionService().author(control.caseId, control.source.id,
      await request(control));
    assert.equal(receipt.state, 'proposed');
    assert.equal(control.jobs.size, 0);
    assert.equal(control.projection.placement, 'needs_answer');
    assert.equal(control.projection.limit_reason,
      'Drafting accepts at most 2000 features; this receipt has 2001 features.');
    assert.deepEqual(control.events, ['recipe.changed', 'intake.item']);
  }));

test('a map source outside a batch is untouched by draft enrollment', () => check(async control => {
  control.registered = false;
  await new ManualIngestionService().author(control.caseId, control.source.id, await request(control));
  assert.equal(control.jobs.size, 0);
  assert.deepEqual(control.events, ['recipe.changed']);
}));

test('an authored table layout with null destination enrolls no draft job', () => localReaderControl(async () => {
  const tableBytes = readFileSync(
    'E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f/opf-d06/edmonton-heritage.csv');
  const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
  const inventory = inspectTabularSource(tableBytes, selection);
  const control = new AuthorControl(tableBytes, { version: 'manual-tabular/1', ...inventory }, 'tabular-manual-v1');
  await servicePoolControl(control, tableBytes, async () => {
    const service = new ManualIngestionService();
    const profile = await service.inspectAny(control.caseId, control.source.id);
    assert.equal(profile.version, 'manual-tabular/1');
    if (profile.version !== 'manual-tabular/1') throw new Error('Expected the retained table profile.');
    const mapping = manualTeacherPlan(profile.profile, 'MAPPING_REVIEW_REQUIRED').plan;
    const plan = { version: profile.version, mode: 'manual_mapping', source: profile.source,
      caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
      workspaceFingerprint: profile.workspaceFingerprint, tabular: profile.tabular, mapping,
      decisions: mapping.fields.map(field => ({ sourceField: field.sourceField, reason: 'Keep this column unknown.' })) };
    const receipt = await service.author(control.caseId, control.source.id,
      { requestKey: randomUUID(), expectedRecipeRevision: 0, plan, destination: null });
    assert.equal(receipt.destination, null);
    assert.equal(control.jobs.size, 0);
    assert.deepEqual(control.events, ['recipe.changed']);
  });
}));

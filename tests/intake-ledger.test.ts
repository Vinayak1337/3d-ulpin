import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { zipSync } from 'fflate';
import { IntakeService } from '../packages/server/src/modules/usp/ingestion/intake-service';
import { IntakeProbeBudget, IntakeTableProbeError, INTAKE_PROBE_REASONS, probeOriginal }
  from '../packages/server/src/modules/usp/ingestion/intake-probe';
import { readingOf } from '../packages/server/src/modules/usp/ingestion/intake-reading';
import { IntakeManifestSchema, IntakeItemSchema } from '../packages/contracts/src/usp/intake';
import { citeIntakeReceipt } from '../packages/server/src/modules/usp/ingestion/intake-ledger';
import { inspectGeojsonExtent, INTAKE_WIDE_GEOJSON_REASON }
  from '../packages/server/src/modules/usp/ingestion/intake-package-extent';

test('kept GeoJSON cites stored bounds regardless of width; missing bounds and CRS conflicts stay empty', async () => {
  const bytes = readFileSync('fixtures/real-nyc/original.geojson');
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'original.geojson');
  const extent = inspectGeojsonExtent(bytes)!;
  assert.equal(extent.fitsOneArea, true);
  assert.equal(card.extent.epsg4326, null);
  const source = new LedgerControl().source;
  // Width flags below are receipt-envelope controls over unchanged real bounds, not source assertions.
  for (const fitsOneArea of [true, false]) {
    const cited = citeIntakeReceipt(structuredClone(card), { ...source,
      inspection: { intakeExtent: { ...extent, fitsOneArea } } });
    assert.deepEqual(cited.extent.epsg4326, extent.bounds);
    assert.ok(cited.citations.some(citation => citation.sha256 === source.sha256
      && citation.locator === 'source.inspection.intakeExtent:measured_bounds'));
    assert.equal(cited.limits.includes(INTAKE_WIDE_GEOJSON_REASON), !fitsOneArea);
  }
  for (const intakeExtent of [undefined, null, {}, { bounds: [1, 2] },
    { bounds: [NaN, 0, 1, 1] }, { bounds: [1, 0, 0, 1] }, { bounds: [-181, 0, 1, 1] }]) {
    const cited = citeIntakeReceipt(structuredClone(card), { ...source, inspection: { intakeExtent } });
    assert.equal(cited.extent.epsg4326, null);
    assert.ok(!cited.citations.some(citation => citation.locator.endsWith(':measured_bounds')));
  }
  const conflicting = structuredClone(card);
  conflicting.crs.code = 'EPSG:3857'; // CRS disagreement protocol control, not a source assertion.
  const cited = citeIntakeReceipt(conflicting, { ...source,
    inspection: { intakeExtent: extent, gis: { sourceCrs: 'EPSG:4326' } } });
  assert.equal(cited.crs.state, 'conflicting');
  assert.equal(cited.extent.epsg4326, null);
});

// In-memory protocol controls, not dataset records. No database, object store or runtime is opened.
class LedgerControl {
  readonly caseId = randomUUID();
  readonly sourceId = randomUUID();
  readonly source = { id: this.sourceId, case_id: this.caseId, family_id: this.sourceId,
    revision: 1, name: 'control.csv', profile: 'document-original-v1', bytes: 18,
    sha256: 'a'.repeat(64), object_key: 'sources/control', status: 'received',
    inspection: { actor: 'intake-protocol-control', documentOriginal: {
      version: 'source-document/1', subject: 'intake-protocol-control', format: 'csv', sha256: 'a'.repeat(64),
      bytes: 18, receivedAt: new Date().toISOString(),
    } } };
  readonly current = { id: this.caseId, revision: 12, archived: false };
  readonly rows = new Map<string, any>();
  readonly operations = new Map<string, any>();
  readonly queries: string[] = [];
  readonly events: unknown[] = [];
  readonly jobs: any[] = [];
  private eventSequence = 0;

  async query(sql: string, values: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push(sql);
    if (sql.startsWith('SET TRANSACTION')) return { rows: [] };
    if (sql.includes('FROM cases')) return { rows: values[0] === this.caseId ? [this.current] : [] };
    if (sql.includes('FROM sources')) return this.sources(sql, values);
    if (sql.startsWith('SELECT payload_hash')) {
      const prior = this.operations.get(values[1]);
      return { rows: prior ? [prior] : [] };
    }
    if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(values[1], { payload_hash: values[2], result: values[3] });
      return { rows: [] };
    }
    if (sql.includes('usp_outbox')) return this.outbox(sql, values);
    // No exact key is declared in these cases, so a kept table or document queues no evidence reading.
    if (sql.includes('FROM usp_intake_key_profiles')) return { rows: [] };
    if (/jobs|usp_job_metadata|^SELECT pg_advisory/.test(sql)) return this.job(sql, values);
    if (sql.startsWith('INSERT INTO usp_intake_items')) return this.insert(sql, values);
    if (sql.startsWith('UPDATE usp_intake_items')) return this.update(sql, values);
    if (sql.startsWith('SELECT item_id AS')) {
      const row = this.rows.get(values[1]);
      return { rows: row ? [{ itemId: row.item_id, state: row.state, family: row.family, format: row.format,
        sizeClass: row.size_class, wave: row.wave, pinnedByOfficer: row.pinned_by_officer }] : [] };
    }
    if (sql.startsWith('SELECT state,placement,plan_ref')) {
      const row = this.rows.get(values[1]);
      return { rows: [{ state: row.state, placement: row.placement, plan_ref: row.plan_ref ?? null,
        records_seen: row.records_seen, limit_reason: row.limit_reason }] };
    }
    if (/^SELECT (?:\*|card) FROM usp_intake_items/.test(sql)) return { rows: [this.rows.get(this.sourceId)] };
    if (sql.startsWith('SELECT source_id FROM usp_intake_items')) return { rows: [this.rows.get(values[0])] };
    if (sql.startsWith('SELECT item_id,member_path')) {
      return { rows: [...this.rows.values()].filter(row => row.parent_item_id === values[1]) };
    }
    if (sql.startsWith('SELECT i.*')) {
      const matching = [...this.rows.values()].filter(row => !values[1] || row.item_id === values[1]);
      matching.sort((left, right) => left.wave - right.wave || left.name.localeCompare(right.name));
      return { rows: values[0] === this.caseId ? matching : [] };
    }
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  }

  // MF1 reads every listed source at once with id=ANY($2) and only the receipt keys of `inspection`.
  private sources(sql: string, values: any[]) {
    if (values[0] !== this.caseId) return { rows: [] };
    if (!sql.includes('id=ANY($2::uuid[])')) return { rows: values[1] === this.sourceId ? [this.source] : [] };
    if (!values[1].includes(this.sourceId)) return { rows: [] };
    const receiptKeys = Object.entries(this.source.inspection)
      .filter(([key]) => key.endsWith('Original') || key === 'actor');
    return { rows: [{ ...this.source, inspection: Object.fromEntries(receiptKeys) }] };
  }

  private outbox(sql: string, values: any[]) {
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: String(++this.eventSequence) }] };
    if (sql.startsWith('INSERT INTO usp_outbox(')) this.events.push(values[2]);
    return { rows: [] };
  }

  private job(sql: string, values: any[]) {
    if (sql.startsWith('SELECT status FROM jobs')) return { rows: this.jobs.filter(job =>
      job.source_id === values[0] && job.operation === 'intake-zip-layers') };
    if (sql.startsWith('SELECT id,status FROM jobs')) {
      return { rows: this.jobs.filter(job => job.source_id === values[0]
        && job.operation === 'intake-native-derivative') };
    }
    if (sql.startsWith('SELECT * FROM jobs')) return { rows: this.jobs.filter(job => job.id === values[0]) };
    if (sql.startsWith('INSERT INTO jobs')) {
      const operation = /VALUES\(\$1,\$2,\$3,'([a-z-]+)'/.exec(sql)![1];
      this.jobs.push({ id: values[0], case_id: values[1], source_id: values[2], operation,
        status: 'queued', case_revision: values[3], input_fingerprint: values[4], payload: values[5] });
    }
    return { rows: [] };
  }

  private insert(sql: string, values: any[]) {
    const child = sql.includes('parent_item_id,member_path');
    const existing = [...this.rows.values()].find(row => child
      ? row.parent_item_id === values[2] && row.member_path === values[3] : row.source_id === this.sourceId);
    if (existing) return { rows: [] };
    const row = { item_id: values[0], source_id: this.sourceId, case_id: this.caseId,
      parent_item_id: null, member_path: null, family: 'unknown', format: null, size_bytes: this.source.bytes,
      size_class: 'S', wave: 4, state: 'received', placement: 'undecided', card: null, card_sha256: null,
      probe_version: null, parts_planned: null, parts_done: 0, records_seen: '0', limit_reason: null,
      pinned_by_officer: false, created_at: new Date(), updated_at: new Date(), name: this.source.name };
    if (child) Object.assign(row, { source_id: null, parent_item_id: values[2], member_path: values[3],
      name: values[3], size_bytes: values[4], size_class: values[5], family: values[6], format: values[7],
      wave: values[8], state: values[9], card: values[10], card_sha256: values[11],
      probe_version: values[12], limit_reason: values[13] });
    this.rows.set(row.item_id, row);
    return { rows: [row] };
  }

  private update(sql: string, values: any[]) {
    if (sql.startsWith('UPDATE usp_intake_items SET card')) {
      const row = this.rows.get(values[0]);
      Object.assign(row, { card: values[1], card_sha256: values[2], probe_version: values[3], family: values[4],
        format: values[5], state: 'probed', limit_reason: null });
      if (!row.pinned_by_officer) row.wave = values[6];
    } else if (sql.startsWith('UPDATE usp_intake_items SET state=$3')) {
      Object.assign(this.rows.get(values[1]), { state: values[2], placement: values[3], plan_ref: values[4],
        records_seen: String(values[5]), limit_reason: values[6] });
    } else if (sql.startsWith('UPDATE usp_intake_items SET state')) {
      const row = this.rows.get(values[0]);
      if (!row.card) Object.assign(row, { state: values[1], limit_reason: values[2] });
    } else if (sql.startsWith('UPDATE usp_intake_items SET wave')) {
      Object.assign(this.rows.get(values[1]), { wave: values[2], pinned_by_officer: true });
    } else throw new Error(`Unexpected protocol update: ${sql}`);
    return { rows: [] };
  }
}

function fixture() {
  const control = new LedgerControl();
  const client = { query: control.query.bind(control) } as unknown as PoolClient;
  let probes = 0;
  let budgetOnce = false;
  let mutate: (() => void) | null = null;
  let cardOverride: Awaited<ReturnType<typeof probeOriginal>> | null = null;
  let probed = Buffer.from('key,value\n1,2\n');
  const service = new IntakeService({
    transaction: async action => action(client), read: async () => Buffer.alloc(18),
    probe: async () => {
      probes++;
      if (budgetOnce) {
        budgetOnce = false;
        throw new IntakeProbeBudget();
      }
      mutate?.();
      if (cardOverride) return structuredClone(cardOverride);
      return probeOriginal(async (start, end) => probed.subarray(start, end), probed.length, control.source.name);
    },
  });
  return { service, ...control, probes: () => probes, exhaustOnce: () => { budgetOnce = true; },
    duringProbe: (action: () => void) => { mutate = action; },
    useCard: (card: Awaited<ReturnType<typeof probeOriginal>>) => { cardOverride = card; },
    useBytes: (bytes: Buffer) => { probed = bytes; } };
}

async function configured(action: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'intake-protocol-control';
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

test('register twice with same/different request keys gives one item and changes no case revision', async () => {
  await configured(async () => {
    const f = fixture();
    const input = { sourceId: f.sourceId, requestKey: randomUUID() };
    const first = await f.service.register(f.caseId, input);
    const repeat = await f.service.register(f.caseId, input);
    const another = await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    assert.equal(first.itemId, repeat.itemId);
    assert.equal(first.itemId, another.itemId);
    assert.equal(f.rows.size, 1);
    assert.equal(f.probes(), 2);
    assert.equal(f.current.revision, 12);
    assert.ok(!f.queries.some(sql => sql.includes('UPDATE cases') || sql.includes('INSERT INTO jobs')));
    assert.ok(IntakeItemSchema.safeParse(first).success);
    assert.ok(IntakeManifestSchema.safeParse(await f.service.manifest(f.caseId)).success);
  });
});

test('budget expiry stays received and a second same-key call continues', async () => {
  await configured(async () => {
    const f = fixture();
    f.exhaustOnce();
    const input = { sourceId: f.sourceId, requestKey: randomUUID() };
    const first = await f.service.register(f.caseId, input);
    assert.equal(first.state, 'received');
    assert.equal(f.rows.get(first.itemId).limit_reason, 'INTAKE_PROBE_BUDGET');
    assert.match(first.limitReason!, /initial check reached its time limit; the original is kept/);
    assert.equal((await f.service.register(f.caseId, input)).state, 'probed');
  });
});

test('an officer pin survives a new probe and unknown planned parts stay null', async () => {
  await configured(async () => {
    const f = fixture();
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    await f.service.pin(f.caseId, f.sourceId, { wave: 1, requestKey: randomUUID() });
    const next = await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    assert.equal(next.wave, 1);
    assert.equal(next.pinnedByOfficer, true);
    assert.equal(next.partsPlanned, null);
  });
});

test('archived, cross-case and cross-operator sources are refused before any range read', async () => {
  await configured(async () => {
    const f = fixture();
    const input = { sourceId: f.sourceId, requestKey: randomUUID() };
    f.current.archived = true;
    await assert.rejects(f.service.register(f.caseId, input), (error: any) => error.code === 'INGESTION_CASE_ARCHIVED');
    f.current.archived = false;
    await assert.rejects(f.service.register(randomUUID(), input));
    f.source.inspection.actor = 'different-protocol-control';
    await assert.rejects(f.service.register(f.caseId, input), (error: any) => error.code === 'INTAKE_SOURCE_DENIED');
    assert.equal(f.probes(), 0);
    assert.equal(f.events.length, 0);
  });
});

test('a later budget refusal cannot erase an already written card or pin', async () => {
  await configured(async () => {
    const f = fixture();
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    const pinned = await f.service.pin(f.caseId, f.sourceId, { wave: 1, requestKey: randomUUID() });
    f.exhaustOnce();
    const next = await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    assert.equal(next.state, 'probed');
    assert.equal(next.cardSha256, pinned.cardSha256);
    assert.equal(next.wave, 1);
  });
});

test('existing source notifications contain no source payload and publish only a truthful status', async () => {
  await configured(async () => {
    const f = fixture();
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    assert.equal(f.events.filter((event: any) => event.change.kind === 'source.retained').length, 0);
    f.source.status = 'needs_input';
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    const retained = f.events.filter((event: any) => event.change.kind === 'source.retained');
    assert.equal(retained.length, 1);
    const event = retained[0] as any;
    assert.deepEqual(event.change, { kind: 'source.retained', sourceId: f.sourceId,
      sourceRevision: 1, status: 'needs_input' });
    assert.ok(!JSON.stringify(event).includes('control.csv'));
    assert.ok(!JSON.stringify(event).includes('sources/control'));
    assert.equal(event.caseRevision, 12);
  });
});

test('member and sheet cards keep parent authority, idempotency and unknown sheet sizes', async () => {
  await configured(async () => {
    const f = fixture();
    const bytes = Buffer.from('key,value\n1,2\n');
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'control.csv');
    const { members, ...header } = card;
    assert.equal(members.length, 0);
    f.useCard({ ...card, format: 'zip', family: 'archive', members: [{ name: 'folder/control.csv',
      sizeBytes: bytes.length, compressedBytes: bytes.length, family: 'table', format: 'csv', refusalCode: null,
      companions: [], card: header }] });
    const input = { sourceId: f.sourceId, requestKey: randomUUID() };
    await f.service.register(f.caseId, input);
    await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    const member = [...f.rows.values()].find(row => row.parent_item_id);
    assert.equal(f.rows.size, 2);
    assert.equal(member.source_id, null);
    assert.deepEqual([f.rows.get(f.sourceId).state, f.rows.get(f.sourceId).placement], ['read', 'undecided']);
    assert.equal(f.rows.get(f.sourceId).limit_reason,
      '1 member. 1 file being taken out as their own items: folder/control.csv.');
    assert.equal((await f.service.one(f.caseId, member.item_id)).sizeBytes, bytes.length);
    await f.service.pin(f.caseId, member.item_id, { wave: 1, requestKey: randomUUID() });
    await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    assert.equal((await f.service.one(f.caseId, member.item_id)).wave, 1);
    f.useCard({ ...card, format: 'xlsx', sheets: [{ name: 'Control sheet', count: null }] });
    await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    const sheet = [...f.rows.values()].find(row => row.member_path === 'Control sheet');
    const result = await f.service.one(f.caseId, sheet.item_id);
    assert.equal(result.sourceId, null);
    assert.equal(result.sizeBytes, null);
    assert.equal(result.sizeClass, null);
    assert.equal(result.partsPlanned, null);
  });
});

test('original receipt validation and a source mutation between probe transactions fail closed', async () => {
  await configured(async () => {
    const f = fixture();
    const input = { sourceId: f.sourceId, requestKey: randomUUID() };
    f.source.inspection.documentOriginal.version = 'invalid';
    await assert.rejects(f.service.register(f.caseId, input), (error: any) => error.code === 'INTAKE_SOURCE_DENIED');
    f.source.inspection.documentOriginal.version = 'source-document/1';
    f.source.inspection.documentOriginal.sha256 = 'b'.repeat(64);
    await assert.rejects(f.service.register(f.caseId, input), (error: any) => error.code === 'INTAKE_SOURCE_INTEGRITY');
    f.source.inspection.documentOriginal.sha256 = f.source.sha256;
    f.duringProbe(() => { f.source.revision++; });
    await assert.rejects(f.service.register(f.caseId, input), /changed during the probe/);
    assert.equal(f.rows.get(f.sourceId).card, null);
    assert.equal(f.current.revision, 12);
  });
});

test('request-key conflicts and retained byte changes on replay fail closed', async () => {
  await configured(async () => {
    const f = fixture();
    const requestKey = randomUUID();
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey });
    f.source.sha256 = 'b'.repeat(64);
    f.source.inspection.documentOriginal.sha256 = f.source.sha256;
    await assert.rejects(f.service.register(f.caseId, { sourceId: f.sourceId, requestKey }), /changed/);
    const pinned = randomUUID();
    await f.service.pin(f.caseId, f.sourceId, { wave: 1, requestKey: pinned });
    await assert.rejects(f.service.pin(f.caseId, f.sourceId, { wave: 2, requestKey: pinned }), /different inputs/);
  });
});

test('register, probe and pin append persisted intake fields once each; replay adds nothing', async () => {
  await configured(async () => {
    const f = fixture();
    f.duringProbe(() => { f.rows.get(f.sourceId).size_class = 'M'; });
    const request = { sourceId: f.sourceId, requestKey: randomUUID() };
    await f.service.register(f.caseId, request);
    const pin = { wave: 1, requestKey: randomUUID() };
    await f.service.pin(f.caseId, f.sourceId, pin);
    await f.service.register(f.caseId, request);
    await f.service.pin(f.caseId, f.sourceId, pin);
    const changes = f.events.map((event: any) => event.change);
    assert.deepEqual(changes, [
      { kind: 'intake.item', itemId: f.sourceId, state: 'received', family: 'unknown', format: null,
        sizeClass: 'S', wave: 4, pinnedByOfficer: false },
      { kind: 'intake.item', itemId: f.sourceId, state: 'probed', family: 'table', format: 'csv',
        sizeClass: 'M', wave: 3, pinnedByOfficer: false },
      { kind: 'intake.item', itemId: f.sourceId, state: 'probed', family: 'table', format: 'csv',
        sizeClass: 'M', wave: 1, pinnedByOfficer: true },
    ]);
    const before = f.events.length;
    await assert.rejects(f.service.pin(f.caseId, f.sourceId, { ...pin, wave: 2 }));
    await assert.rejects(f.service.register(f.caseId, { ...request, unexpected: true }));
    assert.equal(f.events.length, before);
  });
});

test('probe failures store closed reasons beside the failure code, never parser text or cell values', async () => {
  await configured(async () => {
    for (const reason of [...INTAKE_PROBE_REASONS, 'untrusted'] as const) {
      const f = fixture();
      f.duringProbe(() => {
        const error = reason === 'untrusted' ? new Error() : new IntakeTableProbeError(reason);
        error.message = 'PRIVATE_PARSER_CELL_SENTINEL';
        throw error;
      });
      const item = await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
      const row = f.rows.get(item.itemId);
      assert.equal(row.limit_reason, `INTAKE_PROBE_FAILED:${reason === 'untrusted' ? 'read_failed' : reason}`);
      assert.equal(item.state, 'probe_failed');
      assert.doesNotMatch(item.limitReason!, /INTAKE_/);
      const manifest = await f.service.manifest(f.caseId);
      assert.equal(manifest.items[0].limitReason, item.limitReason);
      assert.match(readingOf(row, row.card).drawing.words, /original is kept unchanged with its SHA-256/);
      for (const output of [row, item, f.events, [...f.operations], readingOf(row, row.card)]) {
        assert.ok(!JSON.stringify(output).includes('PRIVATE_PARSER_CELL_SENTINEL'));
      }
      assert.equal(f.source.sha256, 'a'.repeat(64));
      assert.equal(f.current.revision, 12);
      assert.equal(f.jobs.length, 0);
    }
  });
});

test('a failed or budget-limited probe publishes the state stored in its write transaction', async () => {
  await configured(async () => {
    for (const budget of [false, true]) {
      const f = fixture();
      if (budget) f.exhaustOnce();
      else f.duringProbe(() => { throw new Error('Protocol parser refusal'); });
      await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
      assert.equal(f.events.length, 2);
      const event = f.events[1] as any;
      assert.equal(event.change.kind, 'intake.item');
      assert.equal(event.change.state, budget ? 'received' : 'probe_failed');
      assert.equal(event.change.sizeClass, f.rows.get(f.sourceId).size_class);
      assert.equal(event.change.wave, f.rows.get(f.sourceId).wave);
      assert.ok(!JSON.stringify(event).includes('Protocol parser refusal'));
    }
  });
});

test('the manifest names a large item\'s streamed profile job from its one item read; others name none', async () => {
  await configured(async () => {
    const f = fixture();
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    const large = f.rows.get(f.sourceId);
    const member = { ...large, item_id: randomUUID(), source_id: null, parent_item_id: f.sourceId,
      member_path: 'member.geojson', name: 'member.geojson' };
    f.rows.set(member.item_id, member);
    // The fake stands in for the joined column the item read returns; it decides nothing itself.
    large.streamed_profile_job_id = randomUUID();
    f.queries.length = 0;
    const manifest = await f.service.manifest(f.caseId);
    assert.deepEqual(Object.fromEntries(manifest.items.map(item => [item.itemId, item.streamedProfileJobId])),
      { [f.sourceId]: large.streamed_profile_job_id, [member.item_id]: null });
    const reads = f.queries.filter(sql => sql.includes('usp_streamed_profile_imports'));
    assert.equal(reads.length, 1);
    assert.ok(reads[0].startsWith('SELECT i.*'));
    delete large.streamed_profile_job_id;
    assert.equal((await f.service.one(f.caseId, f.sourceId)).streamedProfileJobId, null);
  });
});

test('the one-item read answers each listed row exactly as the manifest lists it; a member hidden stays out', async () => {
  await configured(async () => {
    const f = fixture();
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    const kept = f.rows.get(f.sourceId);
    // The fake stands in for the archive columns joined by the item read.
    kept.taken_out_of = 'layers.zip';
    kept.archive_item_id = randomUUID();
    const member = (memberPath: string, sourceId: string | null) => ({ ...kept, item_id: randomUUID(),
      source_id: sourceId, parent_item_id: f.sourceId, member_path: memberPath, name: memberPath,
      taken_out_of: null, archive_item_id: null });
    const waiting = member('c.csv', null);
    const hidden = member('b.csv', f.sourceId);
    for (const row of [waiting, hidden]) f.rows.set(row.item_id, row);
    const manifest = await f.service.manifest(f.caseId);
    assert.deepEqual(manifest.items.map(item => item.itemId).sort(), [f.sourceId, waiting.item_id].sort());
    for (const listed of manifest.items) assert.deepEqual(await f.service.one(f.caseId, listed.itemId), listed);
    const keptItem = manifest.items.find(item => item.itemId === f.sourceId)!;
    assert.match(keptItem.limitReason!, /^Taken out of layers\.zip\./);
    assert.equal(keptItem.archiveItemId, kept.archive_item_id);
    assert.equal(manifest.items.find(item => item.itemId === waiting.item_id)!.archiveItemId, null);
    const read = f.queries.find(sql => sql.startsWith('SELECT i.*'))!;
    assert.match(read, /archive_item\.item_id archive_item_id/);
    assert.match(read, /archive_item\.case_id=i\.case_id/);
    assert.match(read, /archive_item\.source_id=archive\.id AND archive_item\.parent_item_id IS NULL/);
    // The route still answers the hidden member; the tray merges only an item its manifest holds.
    assert.equal((await f.service.one(f.caseId, hidden.item_id)).parentItemId, f.sourceId);
  });
});

// Real public layers kept in the repository (OSM / Google Open Buildings, test_only); zipped here, never committed.
async function layerZipCard() {
  const pack = zipSync(Object.fromEntries(['01-google-building-footprints.geojson', 'block-boundary.geojson',
    'README.md'].map(name => [`uttam/${name}`, readFileSync(`fixtures/google-uttam/${name}`)])));
  return probeOriginal(async (start, end) => pack.subarray(start, end), pack.length, 'layers.zip');
}

const layerWords = (being: string) => `3 members. 3 files ${being ? 'being' : 'waiting to be'} `
  + 'taken out as their own items: uttam/01-google-building-footprints.geojson, '
  + 'uttam/block-boundary.geojson, uttam/README.md.';

test('enrolling a ZIP of GeoJSON layers queues one layer job and keeps no layer during the request', async () => {
  await configured(async () => {
    const f = fixture();
    f.useCard(await layerZipCard());
    const input = { sourceId: f.sourceId, requestKey: randomUUID() };
    const item = await f.service.register(f.caseId, input);
    assert.equal(f.jobs.length, 1);
    assert.deepEqual([f.jobs[0].operation, f.jobs[0].payload.version, f.jobs[0].payload.itemId,
      f.jobs[0].payload.caseRevision], ['intake-zip-layers', 'intake-zip-layers/1', item.itemId, 12]);
    const members = [...f.rows.values()].filter(row => row.parent_item_id);
    assert.equal(members.length, 3);
    assert.ok(members.every(row => row.source_id === null));
    assert.ok(!f.queries.some(sql => sql.includes('INSERT INTO sources') || sql.includes('UPDATE cases')));
    // ZW1: the queued job's layers are being taken in, not yet taken in.
    const words = () => f.rows.get(f.sourceId).limit_reason;
    assert.equal(words(), layerWords(' being'));
    // A replay, and a second enrolment while the job is queued, queue none.
    await f.service.register(f.caseId, input);
    await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    assert.equal(f.jobs.length, 1);
    assert.equal(words(), layerWords(' being'));
    // After a failed job with an unkept layer, enrolling again queues a fresh job under a new id.
    f.jobs[0].status = 'failed';
    await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    assert.equal(f.jobs.length, 2);
    assert.notEqual(f.jobs[1].id, f.jobs[0].id);
    assert.equal(words(), layerWords(' being'));
    // Once every layer is kept and enrolled, a finished job leaves nothing to retry.
    f.jobs[1].status = 'succeeded';
    for (const row of members) row.source_id = randomUUID();
    await f.service.register(f.caseId, { ...input, requestKey: randomUUID() });
    assert.equal(f.jobs.length, 2);
    // With no layer waiting and no job queued, ZF2's words stand as they are.
    assert.equal(words(), '3 members. 2 GeoJSON layers, 1 unknown file taken out as their own items: '
      + 'uttam/01-google-building-footprints.geojson, uttam/block-boundary.geojson, uttam/README.md. '
      + '1 file kept, not read: uttam/README.md (own item; no batch reader).');
  });
});

test('enrolling a shapefile ZIP also queues independent members without blocking its conversion', async () => {
  await configured(async () => {
    const f = fixture();
    const card = await layerZipCard();
    f.useCard({ ...card, members: [...card.members, { name: 'uttam/roads.shp', sizeBytes: 100,
      compressedBytes: 100, family: 'vector', format: 'shapefile', refusalCode: null, companions: [], card: null }] });
    await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
    assert.deepEqual(f.jobs.map(job => job.operation), ['intake-native-derivative', 'intake-zip-layers']);
  });
});

test('a probed GLB and an unreadable named table keep their reason when probed again', async () => {
  await configured(async () => {
    for (const [bytes, expected, state, placement] of [
      [Buffer.from('glTF\x02\0\0\0\x0c\0\0\0', 'latin1'), 'Named .csv, read as GLB. '
        + 'Kept as a GLB 3D model (18 bytes). No reader in a batch takes this kind of file yet, so it is not on '
        + 'the map; the original is kept with its SHA-256.', 'probed', 'not_understood'],
      [Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]), 'The table text could not be decoded; '
        + 'the original is kept unchanged with its SHA-256.', 'probe_failed', 'undecided'],
    ] as const) {
      const f = fixture();
      f.useBytes(bytes);
      const first = await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
      assert.deepEqual([first.state, first.placement, first.limitReason], [state, placement, expected]);
      const again = await f.service.register(f.caseId, { sourceId: f.sourceId, requestKey: randomUUID() });
      assert.deepEqual([again.state, again.placement, again.limitReason], [state, placement, expected]);
      assert.equal(f.jobs.length, 0);
    }
  });
});

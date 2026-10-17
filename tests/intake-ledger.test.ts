import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { IntakeService } from '../packages/server/src/modules/usp/ingestion/intake-service';
import { IntakeProbeBudget, probeOriginal } from '../packages/server/src/modules/usp/ingestion/intake-probe';
import { IntakeManifestSchema, IntakeItemSchema } from '../packages/contracts/src/usp/intake';

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
  private eventSequence = 0;

  async query(sql: string, values: any[] = []): Promise<{ rows: any[] }> {
    this.queries.push(sql);
    if (sql.startsWith('SET TRANSACTION')) return { rows: [] };
    if (sql.includes('FROM cases')) return { rows: values[0] === this.caseId ? [this.current] : [] };
    if (sql.includes('FROM sources')) {
      return { rows: values[0] === this.caseId && values[1] === this.sourceId ? [this.source] : [] };
    }
    if (sql.startsWith('SELECT payload_hash')) {
      const prior = this.operations.get(values[1]);
      return { rows: prior ? [prior] : [] };
    }
    if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(values[1], { payload_hash: values[2], result: values[3] });
      return { rows: [] };
    }
    if (sql.includes('usp_outbox')) return this.outbox(sql, values);
    if (sql.startsWith('INSERT INTO usp_intake_items')) return this.insert(sql, values);
    if (sql.startsWith('UPDATE usp_intake_items')) return this.update(sql, values);
    if (sql.startsWith('SELECT item_id AS')) {
      const row = this.rows.get(values[1]);
      return { rows: row ? [{ itemId: row.item_id, state: row.state, family: row.family, format: row.format,
        sizeClass: row.size_class, wave: row.wave, pinnedByOfficer: row.pinned_by_officer }] : [] };
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [this.rows.get(this.sourceId)] };
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

  private outbox(sql: string, values: any[]) {
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: String(++this.eventSequence) }] };
    if (sql.startsWith('INSERT INTO usp_outbox(')) this.events.push(values[2]);
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
    } else if (sql.startsWith('UPDATE usp_intake_items SET state')) {
      const row = this.rows.get(values[0]);
      if (!row.card) Object.assign(row, { state: values[1], limit_reason: values[2] });
    } else if (sql.startsWith('UPDATE usp_intake_items SET limit_reason')) {
      // ZF2: a fanned-out ZIP's own row and each member left inside carry fixed words.
      const row = this.rows.get(values[1]);
      if ((sql.includes('source_id IS NULL') && row.source_id) || row.limit_reason === values[2]) return { rows: [] };
      row.limit_reason = values[2];
      return { rows: [], rowCount: 1 };
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
      const bytes = Buffer.from('key,value\n1,2\n');
      return probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, control.source.name);
    },
  });
  return { service, ...control, probes: () => probes, exhaustOnce: () => { budgetOnce = true; },
    duringProbe: (action: () => void) => { mutate = action; },
    useCard: (card: Awaited<ReturnType<typeof probeOriginal>>) => { cardOverride = card; } };
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
    assert.equal(first.limitReason, 'INTAKE_PROBE_BUDGET');
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
    assert.match(member.limit_reason, /^ZIP_MEMBER_INSIDE: /);
    assert.equal(f.rows.get(f.sourceId).limit_reason, 'ZIP_NO_LAYERS: none of the 1 member became its own file; '
      + 'only GeoJSON members do. 1 stays inside the archive: 1 table.');
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

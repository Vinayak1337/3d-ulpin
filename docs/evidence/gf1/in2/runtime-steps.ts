import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { IntakeService } from '../../../../packages/server/src/modules/usp/ingestion/intake-service';
import { ingestionBinding } from '../../../../packages/server/src/modules/usp/ingestion/events';
import { CaseIngestionOutboxSchema, DOCUMENT_VERSION } from '../../../../packages/contracts/src/usp';

type Input = { path: string; sha256: string; issuer: string; originalUrl: string; geography: string;
  receiptFormat: 'unsupported' | 'archive' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function assertOwned() {
  const nonce = process.env.ULPIN_IN2_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_IN2_CONTAINER!;
  assert.equal(container, `ulpin-in2-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'in2_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/in2_${nonce}`);
  const label = execFileSync('docker', ['inspect', '--format',
    '{{ index .Config.Labels "io.ulpin.nonce" }}', container], { encoding: 'utf8' }).trim();
  assert.equal(label, nonce);
}

function inputs(): Input[] {
  const catalogue = JSON.parse(readFileSync('docs/api/datasets.json', 'utf8'));
  const sources = catalogue.retainedExternalSources;
  const pack = sources.find((source: any) => source.content?.externalPath?.endsWith('nyc-10013-official-context.zip'));
  const district = sources.find((source: any) => source.content?.externalPath?.endsWith('/District.zip'));
  const profile = JSON.parse(readFileSync('scripts/demo-import/nyc-profile.json', 'utf8'));
  const building = profile.layers.find((layer: any) => layer.name === 'buildings-original.geojson');
  assert.ok(pack && district && building, 'Inputs must resolve from the existing catalogue and upload profile.');
  return [
    { path: join(dirname(pack.content.externalPath), 'layers', building.name), sha256: building.sha256,
      issuer: profile.issuer, originalUrl: building.url, geography: pack.geography, receiptFormat: 'unsupported' },
    { path: district.content.externalPath, sha256: district.content.sha256, issuer: district.issuer,
      originalUrl: district.originalUrl, geography: district.geography, receiptFormat: 'archive' },
  ];
}

async function fileHash(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function catalogueSnapshot() {
  const columns = (await query(`SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
  const constraints = (await query(`SELECT conrelid::regclass::text AS table_name,conname,
    pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace
    ORDER BY table_name,conname`)).rows;
  const indexes = (await query(`SELECT indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' ORDER BY indexname`)).rows;
  const markers = (await query('SELECT name FROM usp_migration_ledger ORDER BY name')).rows;
  const tables = (await query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
  const ledger = tables.filter(row => /^(usp_intake_|usp_holding_)/.test(row.tablename));
  assert.equal(ledger.length, 4);
  const rows: Record<string, number> = {};
  for (const table of ledger) rows[table.tablename] =
    (await query(`SELECT count(*)::int AS n FROM ${table.tablename}`)).rows[0].n;
  return { sha256: hash(JSON.stringify({ columns, constraints, indexes, markers })), rows,
    tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length };
}

async function migrations() {
  const notices: string[] = [];
  pool().on('connect', client => client.on('notice', notice => notices.push(notice.message ?? '')));
  await query(sql('bootstrap.postgis'));
  await migrate();
  const first = await catalogueSnapshot();
  notices.length = 0;
  await migrate();
  const second = await catalogueSnapshot();
  assert.deepEqual(second, first, 'Second migration must change neither catalogue nor ledger rows.');
  const ledgerNotices = notices.filter(message => /usp_intake_|usp_holding_/.test(message));
  assert.equal(ledgerNotices.length, 9);
  const verifier = execFileSync('python', ['-B', 'scripts/db/verify_extraction.py'], { encoding: 'utf8' }).trim();
  return { runner: 'bootstrap.postgis once, infrastructure/db.migrate() twice (full server migration)',
    first, second, secondChangedNothing: true, ledgerNotices, verifier };
}

async function retainInPlace(input: Input) {
  assert.equal(await fileHash(input.path), input.sha256);
  const bytes = (await stat(input.path)).size;
  const caseId = randomUUID();
  const sourceId = randomUUID();
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT!;
  const inspection = { actor: subject, documentOriginal: { version: DOCUMENT_VERSION, subject,
    format: input.receiptFormat, sha256: input.sha256, bytes, receivedAt: new Date().toISOString() },
    provenance: { issuer: input.issuer, originalUrl: input.originalUrl, geography: input.geography,
      licence: 'unconfirmed', use: 'test_only', method: 'read_in_place_protocol' } };
  await query(`INSERT INTO cases(id,name,description,frame)
    VALUES($1,$2,'IN2 test-only source-case protocol shell; no surveyed frame','{}')`, [caseId, basename(input.path)]);
  await query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
    object_key,status,inspection) VALUES($1,$2,$1,1,$3,'document-original-v1','application/octet-stream',
    $4,$5,$6,'received',$7)`, [sourceId, caseId, basename(input.path), bytes, input.sha256, input.path, inspection]);
  return { caseId, sourceId, bytes };
}

async function itemEvents(caseId: string, itemId: string) {
  const streamId = ingestionBinding(caseId).streamId;
  const rows = (await query('SELECT body FROM usp_outbox WHERE stream_id=$1 ORDER BY sequence', [streamId])).rows;
  return rows.map(row => CaseIngestionOutboxSchema.parse(row.body).change)
    .filter(change => change.kind === 'intake.item' && change.itemId === itemId);
}

async function journey(input: Input) {
  const retained = await retainInPlace(input);
  const file = await open(input.path, 'r');
  const service = new IntakeService({ read: async (key, start, end) => {
    assert.equal(key, input.path);
    const buffer = Buffer.alloc(end - start);
    const result = await file.read(buffer, 0, buffer.length, start);
    assert.equal(result.bytesRead, buffer.length);
    return buffer;
  } });
  try {
    const request = { sourceId: retained.sourceId, requestKey: randomUUID() };
    const probed = await service.register(retained.caseId, request);
    const pin = { wave: 1, requestKey: randomUUID() };
    const pinned = await service.pin(retained.caseId, probed.itemId, pin);
    const events = await itemEvents(retained.caseId, probed.itemId);
    verifyEvents(events, probed, pinned);
    await service.register(retained.caseId, request);
    await service.pin(retained.caseId, probed.itemId, pin);
    assert.deepEqual(await itemEvents(retained.caseId, probed.itemId), events);
    await assert.rejects(service.pin(retained.caseId, probed.itemId, { ...pin, wave: 2 }));
    assert.deepEqual(await itemEvents(retained.caseId, probed.itemId), events);
    assert.equal(await fileHash(input.path), input.sha256);
    const revision = (await query('SELECT revision FROM cases WHERE id=$1', [retained.caseId])).rows[0].revision;
    assert.equal(revision, 0);
    return { ...input, ...retained, use: 'test_only', events, originalHashUnchanged: true, caseRevision: revision,
      probe: { state: probed.state, limitReason: probed.limitReason, family: probed.family, format: probed.format,
        wave: probed.wave, counts: probed.card?.counts, members: probed.card?.members.map(member => ({
          name: member.name, format: member.format, family: member.family, companions: member.companions,
          refusalCode: member.refusalCode })) } };
  } finally {
    await file.close();
  }
}

function verifyEvents(events: any[], probed: any, pinned: any) {
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], { kind: 'intake.item', itemId: probed.itemId, state: 'received', family: 'unknown',
    format: null, sizeClass: probed.sizeClass, wave: 4, pinnedByOfficer: false });
  for (const [index, item] of [[1, probed], [2, pinned]] as const) {
    assert.deepEqual(events[index], { kind: 'intake.item', itemId: item.itemId, state: item.state,
      family: item.family, format: item.format, sizeClass: item.sizeClass, wave: item.wave,
      pinnedByOfficer: item.pinnedByOfficer });
  }
  assert.equal(events[2].pinnedByOfficer, true);
}

async function main() {
  assertOwned();
  try {
    const schema = await migrations();
    const journeys = [];
    for (const input of inputs()) journeys.push(await journey(input));
    console.log(JSON.stringify({ schema, journeys,
      limitations: 'Real SQL/service; SQL source setup and injected local ranges, not HTTP/object storage.' }));
  } finally {
    await closePool();
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code ?? null, message: error.message }));
  process.exitCode = 1;
});

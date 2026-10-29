import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { odsWorkbook, xlsxWorkbook } from '../../../../../../tests/fixtures/ods-control';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding } from './events';
import { intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { IntakeDraftInputSchema, intakeDraftKey, certainTableSelection } from './intake-draft';
import { deriveWorkbookSheets, exportSheetCsv, type WorkbookDerivativeDependencies }
  from './intake-workbook-derivative';
import { receiveSheetDerivative } from './intake-native-derivative';
import { publishWorkbookTablesTx, workbookSheetWords, workbookReadingCard } from './intake-workbook-table';
import { AppError } from '../../../infrastructure/errors';
import { readingOf } from './intake-reading';
import { probeOriginal } from './intake-probe';
import { readTabularWindows, profileWorkbook } from './tabular-stream';
import { workbookTable } from './tabular-workbook';
import { localOperatorSubject } from '../principal';

process.env.ULPIN_PROFILE_PYTHON ??= 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'workbook-protocol';
const enabled = existsSync(process.env.ULPIN_PROFILE_PYTHON) && Boolean(process.env.S13X_PGLITE_MODULE);
const cells = [['key', 'name', 'count'], ['a', ' a, "quoted"\nvalue ', '001.20'], ['b', 'हिन्दी', '0']];

test('sheet receipts wait for a slot and recover an aborted receipt without consuming bytes', async () => {
  let calls = 0, waits = 0, notices = 0, consumed = 0;
  const requests: unknown[] = [], sourceId = randomUUID();
  async function* parts() { consumed++; yield Buffer.from('a,b\r\n'); }
  const result = await receiveSheetDerivative(randomUUID(), { sourceId: randomUUID(),
    acquiredAt: '2026-10-25T00:00:00.000Z' }, { name: 'workbook · sheet.csv', bytes: 5,
    sha256: sha256('a,b\r\n') }, parts, randomUUID(), { large: { create: async (_case: string, raw: unknown) => {
      requests.push(raw);
      if (++calls === 1) throw new AppError(429, 'UPLOAD_QUOTA', 'test_only full slot',
        { limit: 'open_receipts', freesAt: null });
      if (calls === 2) return { state: 'aborted' };
      return { state: 'retained', source: { sourceId } };
    } } as any, waitForSlot: async (_version, _freesAt, deadline) => {
      assert(deadline <= Date.now() + 30 * 60 * 1000);
      waits++;
    } }, async () => { notices++; });
  assert.equal(result, sourceId);
  assert.equal(waits, 1);
  assert.equal(notices, 1);
  assert.equal(consumed, 0);
  assert.deepEqual(requests[0], requests[1]);
  assert.notEqual((requests[0] as any).requestKey, (requests[2] as any).requestKey);
});

test('the data-row ceiling excludes the header and physical blank gaps', {
  skip: !existsSync(process.env.ULPIN_PROFILE_PYTHON),
}, async () => {
  const code = `import sys
from argparse import Namespace
from pathlib import Path
sys.path.insert(0, 'scripts/agent')
from profile_workbook import HeaderRows
from export_workbook_sheet import CsvRows
from read_workbook_windows import Refused
limits = Namespace(rows=2, record_bytes=1024, bytes=4096, header=1)
for used in (None, {1}):
    profile = HeaderRows(limits, used)
    for number in range(1, 4):
        profile.take_typed(number, {1: ('literal', None)}, {1})
    if used is not None:
        assert profile.result('Test')['rows'] == 2
        try:
            profile.take_typed(4, {1: ('literal', None)}, {1})
            raise AssertionError('body row ceiling not enforced')
        except Refused as refusal:
            assert refusal.code == 'TABULAR_STREAM_ROWS'
rows = CsvRows(Path(sys.argv[1]), limits)
try:
    for number in (1, 4, 6):
        rows.take(number, {1: ('literal', None)})
    assert rows.records == 2
    try:
        rows.take(7, {1: ('literal', None)})
        raise AssertionError('CSV row ceiling not enforced')
    except Refused as refusal:
        assert refusal.code == 'TABULAR_STREAM_ROWS'
finally:
    rows.target.close()
    Path(sys.argv[1]).unlink()
print('ok')`;
  await mkdir('E:/ulpin-tmp/s9-1b', { recursive: true });
  const result = await promisify(execFile)(process.env.ULPIN_PROFILE_PYTHON!, ['-c', code,
    `E:/ulpin-tmp/s9-1b/boundary-${randomUUID()}.csv`],
  { timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.stdout.trim(), 'ok');
});

test('one over-budget sheet stays named and kept, without blocking the next sheet', {
  skip: !existsSync(process.env.ULPIN_PROFILE_PYTHON),
}, async t => {
  const previous = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  process.env.ULPIN_DOCUMENT_OCR_SCRATCH = 'E:/ulpin-tmp/s9-1b';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = previous;
  });
  const bytes = odsWorkbook('Wide record', [Array.from({ length: 33 }, (_, index) => `column${index}`),
    Array(33).fill('x'.repeat(32767))], [['Good', cells]]).bytes;
  const read = await profileWorkbook(Readable.from([bytes]), bytes.length);
  const sheets = read.sheets as any[];
  assert.equal(sheets[0].skip, 'TABULAR_RECORD_BUDGET');
  assert.match(workbookSheetWords(sheets[0]), /record exceeds 1048576 bytes.*kept/);
  assert.equal(sheets[1].headerRow, 1);
  assert.equal(read.sha256, sha256(bytes));
});

test('public ODS rows export unchanged; a real calculator keeps named missing-header questions', {
  skip: !existsSync(process.env.ULPIN_PROFILE_PYTHON),
}, async t => {
  const previous = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  process.env.ULPIN_DOCUMENT_OCR_SCRATCH = 'E:/ulpin-tmp/s9-1b';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = previous;
  });
  const manifest = JSON.parse(readFileSync('docs/evidence/usp/native-ods/sources.json', 'utf8'));
  const original = manifest.sources[0].content, bytes = readFileSync(original.externalPath);
  assert.equal(sha256(bytes), original.sha256);
  await profileWorkbook(Readable.from([bytes]), bytes.length, async (read, path) => {
    const sheet = (read.sheets as any[])[0];
    assert.equal(sheet.headerRow, 1);
    const output = join(dirname(path), 'real.csv');
    try {
      const receipt = await exportSheetCsv(path, output, sheet);
      assert(!('skip' in receipt), 'The public ODS must produce a CSV');
      const csv = readFileSync(output), rows: string[][] = [];
      const read = await readTabularWindows(Readable.from([csv]),
        async window => { rows.push(...window.rows.map(row => row.cells)); }, { delimiter: ',', encoding: 'utf-8' });
      const expected = workbookTable(bytes, { format: 'ods', sheet: sheet.name, table: null,
        headerRows: [1] }, 'ods');
      assert.equal(read.records, expected.rows.length);
      assert(fingerprint(rows) === fingerprint(expected.rows.map(row => row.map(cell => cell ?? ''))));
    } finally {
      await rm(output, { force: true });
    }
  });
  const workbooks = JSON.parse(readFileSync('docs/evidence/usp/native-xlsx/sources.json', 'utf8'));
  const calculator = workbooks.sources.find((entry: any) => entry.id === 'dfe-discharge-coefficient-calculator');
  const difficult = readFileSync(calculator.privateOriginal);
  assert.equal(sha256(difficult), calculator.sha256);
  const read = await profileWorkbook(Readable.from([difficult]), difficult.length);
  for (const sheet of read.sheets as any[]) {
    assert.equal(sheet.headerRow, null);
    assert.match(workbookSheetWords(sheet), new RegExp(`Which header row.*${sheet.name}`));
  }
});

for (const format of ['ods', 'xlsx'] as const) test(`${format} sheet CSVs obey UNIQUE object_key and replay receipts`, {
  skip: !enabled,
}, async t => {
  const previous = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  process.env.ULPIN_DOCUMENT_OCR_SCRATCH = 'E:/ulpin-tmp/s9-1b';
  t.after(() => {
    if (previous === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = previous;
  });
  const bytes = format === 'ods' ? odsWorkbook('First', cells,
    [['Titled', [['Title'], ['Subtitle'], ...cells]], ['__proto__', cells], ['Empty', []],
      ['Numbers', [['1', '2'], ['3', '4']]],
      ['Marked', [cells[0], [{ formula: 'of:=1+1', stored: '2' }, 'text', '2'], cells[2]]]]).bytes
    : xlsxWorkbook('First', cells).bytes;
  const { PGlite } = await import(process.env.S13X_PGLITE_MODULE!);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE cases(id uuid PRIMARY KEY,revision int,archived bool DEFAULT false);
    CREATE TABLE sources(id uuid PRIMARY KEY,case_id uuid,family_id uuid,revision int,name text,profile text,
      mime_type text,bytes bigint,sha256 text,object_key text NOT NULL UNIQUE,status text,inspection jsonb);
    CREATE TABLE jobs(id uuid PRIMARY KEY);
    CREATE TABLE usp_outbox_streams(stream_id text PRIMARY KEY,last_sequence bigint DEFAULT 0);
    CREATE TABLE usp_outbox(stream_id text,sequence bigint,body jsonb);`);
  const ledger = readFileSync(new URL('../../../../../../database/sql/95-ingestion/intake-ledger.sql',
    import.meta.url), 'utf8');
  await db.exec(ledger.split('CREATE TABLE IF NOT EXISTS usp_holding_extent')[0]);
  let interrupt = true;
  const client = { query: async (sql: string, args?: unknown[]) => {
    assert(!/registry_|approval|DELETE/.test(sql), 'Candidates must not write registry or delete history');
    if (interrupt && sql.includes("jsonb_build_object('workbookSheet'")) {
      interrupt = false;
      throw new AppError(409, 'STALE_REVISION', 'test_only interruption after retention, before lineage');
    }
    const result = await db.query(sql, args);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  }, release() {} } as PoolClient;
  const caseId = randomUUID(), sourceId = randomUUID(), itemId = randomUUID();
  const source: IntakeSourceRow = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
    name: `test_only.${format}`, profile: 'large-original-v1', bytes: bytes.length, sha256: sha256(bytes),
    object_key: `original/${sourceId}`, status: 'needs_input', inspection: { largeOriginal: {
      uploadId: randomUUID(), operatorSubject: localOperatorSubject(), objectEtag: 'test_only',
      verifiedSha256: sha256(bytes), verifiedBytes: bytes.length, conversion: 'unsupported',
      bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
      provenance: { origin: 'not_stated', acquiredAt: '2026-10-25T00:00:00.000Z', state: 'not_stated' },
    } } };
  await db.query('INSERT INTO cases VALUES($1,0,false)', [caseId]);
  await db.query(`INSERT INTO sources VALUES($1,$2,$1,1,$3,$4,'application/octet-stream',$5,$6,$7,$8,$9)`,
    [sourceId, caseId, source.name, source.profile, bytes.length, source.sha256,
      source.object_key, source.status, source.inspection]);
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, source.name);
  await db.query(`INSERT INTO usp_intake_items(item_id,case_id,source_id,state,size_bytes,size_class,card,
    card_sha256) VALUES($1,$2,$3,'reading',$4,'S',$5,$6)`, [itemId, caseId, sourceId, bytes.length, card,
    fingerprint(card)]);
  const binding = ingestionBinding(caseId);
  const input = IntakeDraftInputSchema.parse({ version: 'intake-draft/1', jobId: randomUUID(), itemId, caseId,
    caseRevision: 0, sourceId, sourceRevision: 1, sourceSha256: source.sha256, workbook: true,
    sourcePin: intakeSourcePin(source, binding), recipeRevision: 0, subject: binding.subject,
    accessSha256: binding.access, workbookHeaderPin: fingerprint({}) });
  const objects = new Map<string, Buffer>(), uploads = new Map<string, any>();
  let enrolments = 0;
  const dependencies: WorkbookDerivativeDependencies = {
    transaction: async work => work(client),
    open: async () => ({ body: Readable.from([bytes]) }) as any,
    large: {
      create: async (_case, raw: any) => {
        const saved = uploads.get(raw.requestKey);
        if (saved) {
          assert.equal(saved.digest, fingerprint(raw), 'The immutable replay input stays identical');
          return saved.status;
        }
        const status = { id: randomUUID(), revision: 1, currentCaseRevision: 0, parts: [] };
        uploads.set(raw.requestKey, { raw, digest: fingerprint(raw), status, chunks: [] });
        return status as any;
      },
      claimPart: async (_case, id, raw: any) => ({ uploadId: id, ...raw }) as any,
      receivePart: async (claim: any, part) => {
        const upload = [...uploads.values()].find(value => value.status.id === claim.uploadId);
        assert.equal(sha256(part), claim.sha256);
        upload.chunks.push(Buffer.from(part));
        return upload.status;
      },
      failPart: async () => {}, abort: async () => ({}) as any, findDerived: async () => null,
      finalize: async (_case, id) => {
        const upload = [...uploads.values()].find(value => value.status.id === id);
        const csv = Buffer.concat(upload.chunks), childId = randomUUID();
        assert.equal(sha256(csv), upload.raw.sha256);
        assert.equal(csv.length, upload.raw.bytes);
        const key = `large-originals/${childId}/${sha256(csv)}`;
        await db.query(`INSERT INTO sources VALUES($1,$2,$1,1,$3,'large-original-v1','text/csv',$4,$5,$6,
          'needs_input','{}')`, [childId, caseId, upload.raw.filename, csv.length, sha256(csv), key]);
        objects.set(childId, csv);
        upload.status.source = { sourceId: childId };
        return upload.status;
      },
    },
    register: async (_case, raw: any) => {
      const csv = objects.get(raw.sourceId)!;
      const child = (await db.query('SELECT * FROM sources WHERE id=$1', [raw.sourceId])).rows[0];
      const childCard = workbookReadingCard(await probeOriginal(async (start, end) => csv.subarray(start, end),
        csv.length, 'sheet.csv'), child);
      const reading = readingOf({ state: 'probed', family: 'table', format: 'csv' }, childCard);
      assert(reading.holds.some(line =>
        /Workbook: test_only.*(?:candidate|officer-stated) header row/.test(line.words)));
      assert.deepEqual(certainTableSelection(childCard), { format: 'csv', sheet: 'csv', table: null,
        headerRows: [1], delimiter: ',', encoding: 'utf-8' });
      const result = await db.query(`INSERT INTO usp_intake_items(item_id,case_id,source_id,state,family,format,
        size_bytes,size_class,card,card_sha256) VALUES($1,$2,$3,'probed','table','csv',$4,'S',$5,$6)
        ON CONFLICT DO NOTHING RETURNING item_id`, [intakeDraftKey(raw.sourceId, 0, 'item'), caseId,
        raw.sourceId, csv.length, childCard, fingerprint(childCard)]);
      enrolments += result.rows.length;
    },
  };
  await assert.rejects(deriveWorkbookSheets(input, source, dependencies, async () => {}),
    (error: any) => error.code === 'STALE_REVISION');
  assert.equal(enrolments, 0, 'A crash before lineage enrols nothing');
  assert.equal((await db.query('SELECT id FROM sources')).rows.length, 2, 'The retained child is kept');
  const sheets = await deriveWorkbookSheets(input, source, dependencies, async () => {});
  const taken = sheets.filter(sheet => sheet.sourceId);
  assert.equal(taken.length, format === 'ods' ? 3 : 1);
  await publishWorkbookTablesTx(client, input, source, card, sheets);
  const retained = (await db.query('SELECT * FROM sources WHERE id=$1', [sourceId])).rows[0];
  const reprobed = workbookReadingCard({ ...card, limits: [] }, retained);
  assert.deepEqual(reprobed.limits, sheets.map(workbookSheetWords), 'Re-enrolment keeps every sheet outcome');
  for (const [ordinal, sheet] of taken.entries()) {
    const child = (await db.query('SELECT * FROM sources WHERE id=$1', [sheet.sourceId])).rows[0];
    assert.equal(child.inspection.workbookSheet.parentSourceId, sourceId);
    assert.equal(child.inspection.workbookSheet.parentSha256, source.sha256);
    assert.equal(child.inspection.workbookSheet.sheet, sheet.name);
    assert.equal(child.inspection.workbookSheet.sheetIndex, ordinal);
    assert.equal(child.inspection.workbookSheet.headerRow, ordinal === 1 ? 3 : 1);
    assert.equal(child.inspection.workbookSheet.headerState, 'candidate');
    assert.match(child.name, /test_only.*First|test_only.*Titled|test_only.*__proto__/);
    const csv = objects.get(sheet.sourceId!)!;
    const rows: string[][] = [];
    const read = await readTabularWindows(Readable.from([csv]),
      async window => { rows.push(...window.rows.map(row => row.cells)); }, { delimiter: ',', encoding: 'utf-8' });
    assert.deepEqual(read.headers, cells[0]);
    assert.deepEqual(rows, cells.slice(1));
    assert.equal(child.sha256, sha256(csv));
    assert.equal(Number(child.bytes), csv.length);
  }
  const keys = (await db.query('SELECT object_key FROM sources')).rows.map((row: any) => row.object_key);
  assert.equal(new Set(keys).size, taken.length + 1);
  assert.equal(enrolments, taken.length);
  await deriveWorkbookSheets(input, source, dependencies, async () => {});
  assert.equal(enrolments, taken.length, 'Retry enrols nothing new');
  assert.equal(uploads.size, taken.length, 'Retry retains nothing new');
  if (format === 'ods') {
    assert.match(workbookSheetWords(sheets[3]), /skipped \(empty\)/);
    assert.match(workbookSheetWords(sheets[4]), /Which header row.*Numbers/);
    assert.equal(sheets[5].skip, 'WORKBOOK_MARKED_CELLS_NOT_CSV');
    assert.match(workbookSheetWords(sheets[5]), /CSV cannot preserve.*kept/);
  }
  if (format === 'ods') {
    source.inspection!.workbookHeaders = { First: 2 };
    await db.query("UPDATE sources SET inspection=jsonb_set(inspection,'{workbookHeaders}',$2::jsonb) WHERE id=$1",
      [sourceId, JSON.stringify({ First: 2 })]);
    await assert.rejects(deriveWorkbookSheets(input, source, dependencies, async () => {}),
      (error: any) => error.code === 'STALE_REVISION');
    const changed = await deriveWorkbookSheets({ ...input, workbookHeaderPin: fingerprint({ First: 2 }) },
      source, dependencies, async () => {});
    assert.notEqual(changed[0].sourceId, taken[0].sourceId, 'Header edits append a derivative, not overwrite');
    assert.equal(changed.filter(sheet => sheet.sourceId).length, 3, 'Sheet names never inherit a header override');
    assert.equal(enrolments, taken.length + 1);
    const newChild = (await db.query('SELECT * FROM sources WHERE id=$1', [changed[0].sourceId])).rows[0];
    assert.equal(newChild.inspection.workbookSheet.headerState, 'officer_stated');
    const oldChild = (await db.query('SELECT * FROM sources WHERE id=$1', [taken[0].sourceId])).rows[0];
    assert.equal(oldChild.sha256, sha256(objects.get(taken[0].sourceId!)!));
  }
  assert.equal(sha256(bytes), source.sha256);
});

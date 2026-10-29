import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { intakeDraftKey } from './intake-draft';
import { Readable } from 'node:stream';
import test from 'node:test';
import { profileWorkbook } from './tabular-stream';
import { TabularSelectionSchema } from '@ulpin/contracts/usp';
import { readingOf } from './intake-reading';
import { workbookSheetWords, type WorkbookSheet } from './intake-workbook-table';
import { probeOriginal } from './intake-probe';
import { workbookTable } from './tabular-workbook';
import { odsWorkbook } from '../../../../../../tests/fixtures/ods-control';
import { zipMembers } from '../../../../../../tests/fixtures/xlsx-control';
import { readZipMember } from './intake-zip';

process.env.ULPIN_PROFILE_PYTHON ??= 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
const python = { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON) ? false : 'needs ULPIN_PROFILE_PYTHON' };

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rels = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const data = [['key', 'name', 'total'], ['a', 'first', '1'], ['b', 'second', '2']];
const titled = [['A title'], ['Another title'], ...data];

function workbook(sheets: { name: string; rows: string[][]; state?: string; chart?: boolean }[]) {
  return zipMembers([
    ['[Content_Types].xml', '<Types/>'],
    ['xl/workbook.xml', `<workbook xmlns="${main}" xmlns:r="${rels}"><sheets>`
      + sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" `
        + `r:id="r${index}" state="${sheet.state ?? 'visible'}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + 'relationships">' + sheets.map((sheet, index) => `<Relationship Id="r${index}" `
        + `Type="${rels}/${sheet.chart ? 'chartsheet' : 'worksheet'}" Target="worksheets/s${index}.xml"/>`)
        .join('') + '</Relationships>'],
    ...sheets.map((sheet, index): [string, string] => [`xl/worksheets/s${index}.xml`,
      `<worksheet xmlns="${main}"><sheetData>` + sheet.rows.map((row, at) => `<row r="${at + 1}">`
        + row.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${at + 1}"`
          + (/^\d+$/.test(value) ? `><v>${value}</v></c>` : ` t="inlineStr"><is><t>${value}</t></is></c>`))
          .join('') + '</row>').join('') + '</sheetData></worksheet>']),
  ]).bytes;
}

async function profile(bytes: Buffer) {
  const previous = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  process.env.ULPIN_DOCUMENT_OCR_SCRATCH = 'E:/ulpin-tmp/s9-1b';
  try {
    const read = await profileWorkbook(Readable.from([bytes]), bytes.length);
    assert.equal(read.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(read.bytes, bytes.length);
    return read.sheets as WorkbookSheet[];
  } finally {
    if (previous === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = previous;
  }
}

test('three data sheets choose independent headers; empty, hidden and chart-only sheets are skipped', python,
  async () => {
  const bytes = workbook([{ name: 'First', rows: data }, { name: 'Titled', rows: titled },
    { name: 'Third', rows: data }, { name: 'Empty', rows: [] },
    { name: 'Hidden', rows: data, state: 'hidden' }, { name: 'Chart', rows: [], chart: true }]);
  const sheets = await profile(bytes);
  assert.deepEqual(sheets.map(sheet => [sheet.name, sheet.headerRow, sheet.rows, sheet.skip]), [
    ['First', 1, 2, null], ['Titled', 3, 2, null], ['Third', 1, 2, null],
    ['Empty', null, 0, 'empty'], ['Hidden', null, null, 'hidden'],
    ['Chart', null, null, 'chart-only or unsupported sheet'],
  ]);
  for (const sheet of sheets.filter(sheet => !sheet.skip)) {
    const table = workbookTable(bytes, { format: 'xlsx', sheet: sheet.name, table: null,
      headerRows: [sheet.headerRow!] }, 'xlsx');
    assert.deepEqual(table.headers, data[0]);
    assert.equal(table.rows.length, 2);
    assert.match(workbookSheetWords(sheet), /candidate header row.*2 rows read/);
  }
});

test('ODS titles and repeated padding use the same header rule, without inventing rows', python, async () => {
  const bytes = odsWorkbook('First', data, [['Titled', titled], ['Third', data], ['Empty', []]]).bytes;
  const sheets = await profile(bytes);
  assert.deepEqual(sheets.map(sheet => [sheet.headerRow, sheet.rows, sheet.skip]),
    [[1, 2, null], [3, 2, null], [1, 2, null], [null, 0, 'empty']]);
});

test('sheet publication reuses the immutable object and creates three independent candidate table jobs', async () => {
  const source = { id: '10000000-0000-4000-8000-000000000001', case_id: 'case', revision: 1,
    name: 'test.xlsx', sha256: 'a'.repeat(64), bytes: 1200, object_key: 'immutable-original',
    inspection: { largeOriginal: { verifiedSha256: 'a'.repeat(64), verifiedBytes: 1200 } } };
  const code = readFileSync(new URL('./intake-workbook-table.ts', import.meta.url), 'utf8');
  const body = code.slice(code.indexOf('async function sheetSourceTx(')).split('\n}\n')[0] + '\n}';
  const sources = new Map<string, any>(), queued: any[] = [];
  const controls = { intakeDraftKey, TabularSelectionSchema, fingerprint: JSON.stringify,
    workbookSheetWords, citeIntakeReceipt: (card: unknown) => card,
    registerIntakeItemTx: async (_client: unknown, row: any) => ({ item_id: row.id, state: 'received' }),
    saveIntakeCardTx: async () => {}, appendCaseIngestionTx: async () => {}, appendIntakeItemTx: async () => {},
    queueIntakeDraftTx: async (_client: unknown, row: any) => { queued.push(row); } };
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const publish = new Function(...Object.keys(controls), `${js}; return sheetSourceTx;`)(...Object.values(controls));
  const client = { query: async (sql: string, args: any[]) => {
    if (sql.startsWith('INSERT INTO sources')) sources.set(args[0], { ...source, id: args[0],
      family_id: args[0], name: args[1], inspection: args[2] });
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [sources.get(args[1])] };
    assert(!/registry_|approval|UPDATE sources|DELETE/.test(sql));
    return { rows: [] };
  } };
  const input = { itemId: source.id };
  for (const [name, headerRow] of [['First', 1], ['Titled', 3], ['Third', 1]] as const)
    await publish(client, input, source, { format: 'xlsx', counts: {} }, { name, headerRow, rows: 2, skip: null });
  assert.equal(sources.size, 3);
  assert.equal(new Set(queued.map(row => row.id)).size, 3);
  assert.deepEqual(queued.map(row => row.inspection.workbookSheet.selection.headerRows), [[1], [3], [1]]);
  for (const row of queued) {
    assert.equal(row.sha256, source.sha256);
    assert.equal(row.object_key, source.object_key);
    assert.equal(row.bytes, source.bytes);
    assert.equal(row.inspection.workbookSheet.parentSourceId, source.id);
    assert.equal(row.inspection.manualProfile, undefined);
  }
  await publish(client, input, source, { format: 'xlsx', counts: {} },
    { name: 'First', headerRow: 1, rows: 2, skip: null });
  assert.equal(sources.size, 3, 'replay uses the same sheet identity');
});

test('an ODS hidden sheet stays skipped without disclosing its rows', python, async () => {
  const original = odsWorkbook('Visible', data, [['Hidden', data]]).bytes;
  const members: [string, Buffer][] = [];
  for (const path of ['mimetype', 'content.xml', 'META-INF/manifest.xml']) {
    const member = await readZipMember(async (start, end) => original.subarray(start, end),
      original.length, path, 1024 * 1024);
    members.push([path, path === 'content.xml' ? Buffer.from(Buffer.from(member.bytes).toString().replace(
      'table:name="Hidden"', 'table:name="Hidden" table:display="false"')) : Buffer.from(member.bytes)]);
  }
  const sheets = await profile(zipMembers(members).bytes);
  assert.deepEqual(sheets.map(sheet => [sheet.headerRow, sheet.rows, sheet.skip]),
    [[1, 2, null], [null, null, 'hidden']]);
});

test('a header after more than the metadata sample is found; numeric rows still ask, naming the sheet', python,
  async () => {
  const bytes = workbook([{ name: 'Late', rows: [...Array.from({ length: 20 }, () => ['Title']), ...data] },
    { name: 'Numbers', rows: [['1', '2'], ['3', '4'], ['5', '6']] }]);
  const sheets = await profile(bytes);
  assert.equal(sheets[0].headerRow, 21);
  assert.equal(sheets[1].headerRow, null);
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'test.xlsx');
  const reading = readingOf({ state: 'read', placement: 'undecided', plan_ref: { workbookSheets: sheets } }, card);
  assert.equal(reading.question, 'Which header row should be read in sheet Numbers?');
  assert.equal(readingOf({ state: 'read', plan_ref: { workbookSheets: [sheets[0]] } }, card).question, null);
});

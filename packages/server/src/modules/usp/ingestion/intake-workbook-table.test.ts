import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { profileWorkbook } from './tabular-stream';
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
    assert.match(workbookSheetWords(sheet), /candidate header row.*2 rows/);
  }
});

test('ODS titles and repeated padding use the same header rule, without inventing rows', python, async () => {
  const bytes = odsWorkbook('First', data, [['Titled', titled], ['Third', data], ['Empty', []]]).bytes;
  const sheets = await profile(bytes);
  assert.deepEqual(sheets.map(sheet => [sheet.headerRow, sheet.rows, sheet.skip]),
    [[1, 2, null], [3, 2, null], [1, 2, null], [null, 0, 'empty']]);
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

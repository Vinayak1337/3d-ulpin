import { zipMembers } from './xlsx-control';

/**
 * test_only: one-sheet workbooks written in memory from the literal cells a test gives, never source records. The
 * ODS is written as LibreOffice writes one: equal neighbouring cells and equal consecutive rows share one element
 * through their repeat counts, and the sheet ends in a block of repeated empty padding to its last row. The XLSX
 * holds the same cells one element each, so the two read to the same table. An ODS cell may also be a formula with
 * the result the file stores.
 */
const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const MANIFEST = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const ODS_TYPE = 'application/vnd.oasis.opendocument.spreadsheet';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** A typed ODS cell: its text, or a formula and the number the file stores as its result. */
export type OdsCell = string | { formula: string; stored: string };

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** A blank cell ('') is an element with no value, as LibreOffice writes one; in the XLSX it is not written. */
function odsCell(text: OdsCell, repeat: number): string {
  const repeated = repeat > 1 ? ` table:number-columns-repeated="${repeat}"` : '';
  if (typeof text !== 'string') {
    return `<table:table-cell${repeated} table:formula="${escaped(text.formula)}" office:value-type="float" `
      + `office:value="${text.stored}"><text:p>${text.stored}</text:p></table:table-cell>`;
  }
  if (!text) return `<table:table-cell${repeated}/>`;
  const value = NUMBER.test(text) ? `office:value-type="float" office:value="${text}"` : 'office:value-type="string"';
  return `<table:table-cell${repeated} ${value}><text:p>${escaped(text)}</text:p></table:table-cell>`;
}

function odsRow(cells: OdsCell[]): string {
  const elements: string[] = [];
  for (let at = 0; at < cells.length;) {
    let repeat = 1;
    while (cells[at + repeat] === cells[at]) repeat++;
    elements.push(odsCell(cells[at]!, repeat));
    at += repeat;
  }
  return elements.join('');
}

function odsRows(rows: OdsCell[][]): string {
  const elements: string[] = [];
  for (let at = 0; at < rows.length;) {
    let repeat = 1;
    while (rows[at + repeat] && JSON.stringify(rows[at + repeat]) === JSON.stringify(rows[at])) repeat++;
    const repeated = repeat > 1 ? ` table:number-rows-repeated="${repeat}"` : '';
    elements.push(`<table:table-row${repeated}>${odsRow(rows[at]!)}</table:table-row>`);
    at += repeat;
  }
  return elements.join('');
}

function odsTable(sheet: string, rows: OdsCell[][]): string {
  const padding = `<table:table-row table:number-rows-repeated="${1048576 - rows.length}">`
    + '<table:table-cell table:number-columns-repeated="1024"/></table:table-row>';
  return `<table:table table:name="${escaped(sheet)}">${odsRows(rows)}${padding}</table:table>`;
}

/** The sheet, then any further sheets in the order given. */
export function odsWorkbook(sheet: string, rows: OdsCell[][], more: [string, OdsCell[][]][] = [],
  extras: [string, Buffer][] = []) {
  const tables = [[sheet, rows] as const, ...more].map(([name, cells]) => odsTable(name, cells)).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="${OFFICE}" `
    + `xmlns:table="${TABLE}" xmlns:text="${TEXT}" office:version="1.3"><office:body><office:spreadsheet>`
    + `${tables}</office:spreadsheet></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="${MANIFEST}" `
    + `manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODS_TYPE}"/>`
    + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>';
  return zipMembers([['mimetype', ODS_TYPE], ['content.xml', content], ['META-INF/manifest.xml', manifest], ...extras]);
}

function xlsxCell(text: string, row: number, column: number): string {
  if (!text) return '';
  const reference = `${String.fromCharCode(65 + column)}${row}`;
  if (NUMBER.test(text)) return `<c r="${reference}"><v>${text}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t>${escaped(text)}</t></is></c>`;
}

export function xlsxWorkbook(sheet: string, rows: string[][]) {
  const data = rows.map((cells, index) => `<row r="${index + 1}">`
    + cells.map((text, column) => xlsxCell(text, index + 1, column)).join('') + '</row>').join('');
  return zipMembers([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.'
      + 'org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="${escaped(sheet)}" `
      + 'sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
      + `relationships"><Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/>`
      + '</Relationships>'],
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}"><sheetData>${data}</sheetData></worksheet>`],
  ]);
}

import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const CONTROL_SHEET = 'xl/worksheets/sheet2.xml';

/** A ZIP of deflated members, written in memory: local headers, central directory and end record only. */
export function zipMembers(members: [string, string | Buffer][]) {
  const locals: Buffer[] = [], central: Buffer[] = [], ranges = new Map<string, [number, number]>();
  let offset = 0;
  for (const [name, content] of members) {
    const data = Buffer.from(content), stored = deflateRawSync(data, { level: 1 }), path = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0x21, 12); head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(stored.length, 18);
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(path.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    head.copy(entry, 8, 6, 28); entry.writeUInt32LE(offset, 42);
    ranges.set(name, [offset + 30 + path.length, offset + 30 + path.length + stored.length]);
    locals.push(head, path, stored);
    central.push(entry, path);
    offset += 30 + path.length + stored.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return { bytes: Buffer.concat([...locals, directory, end]), ranges };
}

function controlRow(row: number, empty: number) {
  const digest = createHash('sha256').update(String(row)).digest('hex'), area = parseInt(digest.slice(0, 8), 16);
  const note = row % 5 === 0 ? `<c r="F${row}" t="s"><v>${empty}</v></c>` : row % 7 === 0 ? ''
    : `<c r="F${row}" t="inlineStr"><is><t xml:space="preserve"> lot ${row} </t></is></c>`;
  return `<row r="${row}"><c r="A${row}" t="s"><v>${8 + row % 500}</v></c><c r="B${row}"><v>${row}.50</v></c>` +
    `<c r="C${row}"><v>${area}</v></c><c r="D${row}"><f>C${row}*2</f><v>${area * 2}</v></c>` +
    `<c r="E${row}"><f>C${row}*3</f></c>${note}<c r="G${row}" t="inlineStr"><is><t>${digest}</t></is></c></row>`;
}

/** test_only: generated XML controls, never source records. Sheet "Register" has a title row, headers in row 2
 * from shared strings, then per record a shared string, numbers as stored, a formula with a cached value and one
 * without, a note that is an inline string, an empty shared string (every 5th row) or missing (every 7th), and an
 * inline digest. */
export function controlWorkbook(records: number, sheetXml?: string) {
  const shared = ['Ward', 'Plot', 'Area', 'Doubled', 'Tripled', 'Note', 'Hash', '',
    ...Array.from({ length: 500 }, (_, n) => `ward-${String(n).padStart(3, '0')}`)];
  const empty = shared.indexOf('');
  const rows: string[] = [];
  for (let row = 3; row < records + 3; row++) rows.push(controlRow(row, empty));
  const sheet = Buffer.from(sheetXml ?? `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr">` +
    '<is><t>Register of plots</t></is></c></row><row r="2">' + [...'ABCDEFG'].map((letter, n) =>
    `<c r="${letter}2" t="s"><v>${n}</v></c>`).join('') + `</row>${rows.join('')}</sheetData>` +
    '<mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells></worksheet>');
  const zip = zipMembers([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.' +
      'org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="Notes" sheetId="1" ` +
      'r:id="rId1"/><sheet name="Register" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/' +
      'relationships">' + [1, 2].map(n => `<Relationship Id="rId${n}" Type="${RELS}/worksheet" ` +
      `Target="worksheets/sheet${n}.xml"/>`).join('') + `<Relationship Id="rId3" Type="${RELS}/sharedStrings" ` +
      'Target="sharedStrings.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<sst xmlns="${MAIN}">` + shared.map(text => text ? `<si><t>${text}</t></si>`
      : '<si><t/></si>').join('') + '</sst>'],
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is>` +
      '<t>notes</t></is></c></row></sheetData></worksheet>'],
    [CONTROL_SHEET, sheet],
  ]);
  return { ...zip, sheetSha256: createHash('sha256').update(sheet).digest('hex'), ward: (row: number) =>
    shared[8 + row % 500], digest: (row: number) => createHash('sha256').update(String(row)).digest('hex') };
}

import Papa from 'papaparse';
import { TableEncodingSchema, type DelimitedReading, type TableEncoding } from '@ulpin/contracts';

/** Keep stated names literal; reserve all of them before naming blank cells by their 1-based position. */
export function csvHeaderNames(cells: readonly string[]): string[] {
  const used = new Set(cells.filter(name => name.trim()));
  return cells.map((name, index) => {
    if (name.trim()) return name;
    const base = `column_${index + 1}`;
    let candidate = base, suffix = 2;
    while (used.has(candidate)) candidate = `${base}_${suffix++}`;
    used.add(candidate);
    return candidate;
  });
}

export function bomEncoding(bytes: Uint8Array): TableEncoding | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return undefined;
}

export function decodeTableBytes(bytes: Uint8Array, encoding: TableEncoding, partial = false): string {
  if (!TableEncodingSchema.safeParse(encoding).success) {
    throw new Error('Unsupported table encoding. Choose UTF-8, Windows-1252, ISO-8859-1, ' +
      'or UTF-16 LE/BE with a matching BOM.');
  }
  const bom = bomEncoding(bytes);
  if (encoding.startsWith('utf-16') && bom !== encoding) {
    throw new Error('This table needs a matching UTF-16 byte order mark (BOM); the original is unchanged.');
  }
  if (bom && bom !== encoding) throw new Error('This table differs from its stated encoding; check its BOM.');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  // WHATWG TextDecoder aliases ISO-8859-1 to Windows-1252; latin1 preserves the ISO control code points.
  const text = encoding === 'iso-8859-1' ? Buffer.from(bytes).toString('latin1')
    : new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: partial });
  if (text.includes('\0')) throw new Error('COLUMN_ENCODING_UNSUPPORTED');
  return text.replace(/^\uFEFF/, '');
}

export function decodeDelimitedText(bytes: Uint8Array, partial = false, stated?: TableEncoding) {
  if (stated) return { text: decodeTableBytes(bytes, stated, partial), encoding: stated,
    encodingBasis: 'officer_stated' as const };
  const bom = bomEncoding(bytes);
  let encoding: TableEncoding = bom ?? 'utf-8';
  let text: string;
  try {
    text = decodeTableBytes(bytes, encoding, partial);
  } catch (error) {
    if (bom || !(error instanceof TypeError)) throw new Error('COLUMN_ENCODING_UNSUPPORTED');
    encoding = 'windows-1252';
    text = decodeTableBytes(bytes, encoding, partial);
  }
  let encodingBasis: NonNullable<DelimitedReading['encodingBasis']> = 'utf8_valid';
  if (encoding === 'windows-1252') encodingBasis = 'fallback_windows_1252';
  else if (bom || bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encodingBasis = 'bom';
  return { text, encoding, encodingBasis };
}

function* headRecords(text: string) {
  let start = 0, quoted = false;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '"') {
      if (quoted && text[at + 1] === '"') at++;
      else quoted = !quoted;
    }
    if (quoted || text[at] !== '\n' && text[at] !== '\r') continue;
    yield text.slice(start, at);
    if (text[at] === '\r' && text[at + 1] === '\n') at++;
    start = at + 1;
  }
  if (text.slice(start).trim()) yield text.slice(start);
}

function delimiterFields(text: string, delimiter: string) {
  let first = 0, consistent = true, records = 0;
  for (const record of headRecords(text)) {
    const parsed = Papa.parse<string[]>(record, { delimiter });
    const cells = parsed.data[0] ?? [];
    if (!cells.some(cell => cell.trim())) continue;
    if (!records) first = cells.length;
    if (parsed.errors.length || cells.length !== first) consistent = false;
    if (++records === 2) break;
  }
  return { first, consistent };
}

/** The widest consistent candidate wins and candidate order breaks ties; only two non-blank logical records
 * participate, never Papa's guesser. */
export function chooseTableDelimiter(text: string, name = ''): NonNullable<DelimitedReading['delimiter']> {
  const literal = text.replace(/^\uFEFF/, '');
  const candidates = ([',', ';', '\t', '|'] as const).map(delimiter => ({
    delimiter, ...delimiterFields(literal, delimiter),
  }));
  const tab = candidates[2];
  if (/\.tsv$/i.test(name) && tab.first >= 2 && tab.consistent) return '\t';
  const consistent = candidates.filter(candidate => candidate.first >= 2 && candidate.consistent);
  if (!consistent.length) return ',';
  return consistent.reduce((left, right) => right.first > left.first ? right : left).delimiter;
}

export function detectDelimitedReading(bytes: Uint8Array, name = '', stated?: TableEncoding) {
  const decoded = decodeDelimitedText(bytes, false, stated);
  return { ...decoded, delimiter: chooseTableDelimiter(decoded.text, name) };
}

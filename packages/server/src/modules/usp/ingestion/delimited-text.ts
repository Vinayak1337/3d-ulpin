import Papa from 'papaparse';
import type { DelimitedReading, TableEncoding } from '@ulpin/contracts';

export function bomEncoding(bytes: Uint8Array): TableEncoding | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return undefined;
}

export function decodeTableBytes(bytes: Uint8Array, encoding: TableEncoding, partial = false): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: partial });
  if (text.includes('\0')) throw new Error('COLUMN_ENCODING_UNSUPPORTED');
  return text.replace(/^\uFEFF/, '');
}

export function decodeDelimitedText(bytes: Uint8Array, partial = false): { text: string; encoding: TableEncoding } {
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
  return { text, encoding };
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

/** Candidate order breaks ties; only two non-blank logical records participate, never Papa's guesser. */
export function chooseTableDelimiter(text: string, name = ''): NonNullable<DelimitedReading['delimiter']> {
  const literal = text.replace(/^\uFEFF/, '');
  const candidates = ([',', ';', '\t', '|'] as const).map(delimiter => ({
    delimiter, ...delimiterFields(literal, delimiter),
  }));
  const tab = candidates[2];
  if (/\.tsv$/i.test(name) && tab.first >= 2 && tab.consistent) return '\t';
  const best = candidates.reduce((left, right) => right.first > left.first ? right : left);
  return best.first >= 2 && best.consistent ? best.delimiter : ',';
}

export function detectDelimitedReading(bytes: Uint8Array, name = '') {
  const decoded = decodeDelimitedText(bytes);
  return { ...decoded, delimiter: chooseTableDelimiter(decoded.text, name) };
}

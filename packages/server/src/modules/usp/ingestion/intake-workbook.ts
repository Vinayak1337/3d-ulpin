import type { IntakeCard } from '@ulpin/contracts/usp';

const ODS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
// Complete markup only; an unfinished comment/CDATA consumes the remainder of a bounded head.
const XML_MARKUP = new RegExp(String.raw`<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)`
  + String.raw`|<\?[\s\S]*?(?:\?>|$)|<(?:[^>"']|"[^"]*"|'[^']*')*>`, 'g');

function xmlName(value: string): string | null {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  if (/&(?!(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);)/i.test(value)) return null;
  let invalid = false;
  const decoded = value.replace(/&([^;]+);/g, (_match, entity: string) => {
    if (entities[entity]) return entities[entity];
    const hex = entity.startsWith('#x');
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) {
      invalid = true;
      return '';
    }
    return String.fromCodePoint(code);
  });
  return invalid || !decoded || decoded.length > 1024 ? null : decoded;
}

/** Only sheet metadata in workbook.xml, never a worksheet, shared string or cell. */
export function workbookSheets(card: IntakeCard, bytes: Uint8Array, size: number) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const found = [...text.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?\s*>/g)];
  for (const sheet of found) {
    const attribute = /\bname\s*=\s*(["'])(.*?)\1/.exec(sheet[1]);
    const name = attribute ? xmlName(attribute[2]) : null;
    if (!name) {
      card.limits.push('Workbook sheet name unresolved inside the metadata profile; native workbook reader needed.');
      continue;
    }
    card.sheets.push({ name, count: null });
  }
  if (bytes.length < size) {
    card.limits.push('Workbook XML cut at the member-head limit; sheet inventory is a prefix only.');
  }
}

/** An intentionally narrow metadata profile: root-declared namespaces, real start tags on the spreadsheet path.
 * Namespace rebinding or a declaration we cannot resolve leaves all names absent rather than guessing. */
function odsSheetNames(text: string): string[] | null {
  const namespaces = new Map<string, string>(), stack: string[] = [], names: string[] = [];
  const path = [`${ODS_OFFICE}:document-content`, `${ODS_OFFICE}:body`, `${ODS_OFFICE}:spreadsheet`];
  let rootSeen = false;
  for (const [markup] of text.matchAll(XML_MARKUP)) {
    if (markup.startsWith('<!--') || markup.startsWith('<![CDATA[') || markup.startsWith('<?')) continue;
    const tag = /^<(\/?)([\w.:-]+)([\s\S]*?)\/?\s*>$/.exec(markup);
    if (!tag || markup.startsWith('<!')) return null;
    if (tag[1]) {
      if (stack.pop() !== expandedName(tag[2], namespaces)) return null;
      continue;
    }
    const attributes = xmlAttributes(tag[3]);
    if (!attributes) return null;
    for (const [key, value] of attributes) {
      if (key !== 'xmlns' && !key.startsWith('xmlns:')) continue;
      if (rootSeen) return null;
      namespaces.set(key === 'xmlns' ? '' : key.slice(6), value);
    }
    const name = expandedName(tag[2], namespaces);
    if ((!rootSeen && name !== path[0]) || (rootSeen && !stack.length)) return null;
    rootSeen = true;
    if (name === `${ODS_TABLE}:table` && stack.join('|') === path.join('|')) {
      const value = [...attributes].find(([key]) => key.includes(':')
        && expandedName(key, namespaces) === `${ODS_TABLE}:name`)?.[1];
      if (!value || value.length > 128 || names.includes(value)) return null;
      names.push(value);
    }
    if (!markup.endsWith('/>')) stack.push(name);
  }
  return rootSeen ? names : null;
}

function expandedName(name: string, namespaces: ReadonlyMap<string, string>): string {
  const colon = name.indexOf(':');
  const prefix = colon < 0 ? '' : name.slice(0, colon);
  return `${namespaces.get(prefix) ?? '?'}:${name.slice(colon + 1)}`;
}

function xmlAttributes(text: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let rest = text;
  while (rest.trim()) {
    const attribute = /^\s+([\w.:-]+)\s*=\s*(["'])([^]*?)\2/.exec(rest);
    if (!attribute || attributes.has(attribute[1])) return null;
    const value = attribute[3] === '' ? '' : xmlName(attribute[3]);
    if (value === null) return null;
    attributes.set(attribute[1], value);
    rest = rest.slice(attribute[0].length);
  }
  return attributes;
}

/** ODS sheet names from complete table start tags in a bounded content.xml head; no cell values interpreted. */
export function odsSheets(card: IntakeCard, bytes: Uint8Array, size: number) {
  let names: string[] | null = null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: bytes.length < size });
    names = odsSheetNames(text);
  } catch { /* An unsupported encoding leaves sheet names unknown. */ }
  if (names === null) {
    card.limits.push('ODS sheet names unresolved inside the metadata profile; native workbook reader needed.');
    return;
  }
  card.sheets.push(...names.map(name => ({ name, count: null })));
  if (bytes.length < size) {
    card.limits.push(names.length ? 'content.xml was cut at the member-head limit; these are at least its first '
      + 'sheets, and more may follow.' : 'content.xml was cut at the member-head limit before its first sheet; '
      + 'sheet names remain unknown.');
  }
}

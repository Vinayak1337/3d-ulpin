import type { IntakeCard } from '@ulpin/contracts/usp';

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

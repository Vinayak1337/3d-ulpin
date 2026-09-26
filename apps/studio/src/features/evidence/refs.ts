/** One pointer from a value to its exact place in a retained source. */
export interface EvidenceRef {
  sourceId: string;
  /** Short name for the chip ("Roof height", the file name). */
  label: string;
  locator: Locator;
  /** The record the evidence supports (for the viewer's scene still). */
  subject?: { id: string; name: string };
}

export type Locator =
  | { kind: 'row'; row: number; text: string }
  | { kind: 'pointer'; pointer: string; text: string }
  | { kind: 'text'; text: string };

/** Parses the backend's locator forms: "<file> row N", a JSON pointer, or free text. */
export function parseLocator(input: { locator?: string; jsonPointer?: string; row?: number }): Locator {
  if (input.jsonPointer) return { kind: 'pointer', pointer: input.jsonPointer, text: pointerText(input.jsonPointer) };
  if (typeof input.row === 'number') return { kind: 'row', row: input.row, text: `row ${input.row}` };
  const row = input.locator ? /\brow (\d+)\b/.exec(input.locator) : null;
  if (row) return { kind: 'row', row: Number(row[1]), text: `row ${row[1]}` };
  return { kind: 'text', text: input.locator ?? '' };
}

function pointerText(pointer: string): string {
  const feature = /^\/features\/(\d+)(?:\/properties\/(.+))?$/.exec(pointer);
  if (feature) return feature[2] ? `feature ${Number(feature[1]) + 1} · ${feature[2]}` : `feature ${Number(feature[1]) + 1}`;
  return pointer;
}

/** Resolves a JSON pointer (RFC 6901) in a parsed document. */
export function resolvePointer(document: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return document;
  return pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key];
    return undefined;
  }, document);
}

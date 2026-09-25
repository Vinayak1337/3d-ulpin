/** Derivatives only. Never rewrite canonical source bytes, hashes or measurements. */
import { AppError } from '../../errors';
export const REDACTION_VERSION = 'indian-personal-fields/1';
const d = [
  [0,1,2,3,4,5,6,7,8,9], [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6], [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8], [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2], [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4], [9,8,7,6,5,4,3,2,1,0],
];
const p = [
  [0,1,2,3,4,5,6,7,8,9], [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2], [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0], [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5], [7,0,4,6,9,1,3,2,5,8],
];
export function passesVerhoeff(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let checksum = 0;
  for (let i = 0; i < digits.length; i++) checksum = d[checksum][p[i % 8][Number(digits[digits.length - 1 - i])]];
  return checksum === 0;
}
const personalKey = /^(?:(?:owner|father|mother|spouse|applicant|seller|buyer|witness|contact|full)(?:s)?name|name|address|residentialaddress|dateofbirth|dob|signature|email|emailaddress|mobile|mobilenumber|phone|phonenumber|pan|pannumber|vid|virtualid|virtualidentifier)$/i;
const keyName = (key: string) => key.replace(/[\s_'’.-]/g, '');
const unavailable = (value: unknown) => value === null || (typeof value === 'string' && /^(unknown|absent|withheld|conflicting)$/i.test(value));

export function redactPrivateText(text: string): string {
  const masked = text
    .replace(/(?<![\w])\d{4}(?:[\s-]?\d{4}){3}(?![\w])/g, '[redacted VID]')
    .replace(/(?<![\w])\d{4}(?:[\s-]?\d{4}){2}(?![\w])/g, value => {
      const digits = value.replace(/\D/g, '');
      // Invalid/unclassified 12-digit identifiers stay fully masked (legacy protection).
      return passesVerhoeff(digits) ? `[redacted Aadhaar] XXXX XXXX ${digits.slice(-4)}` : '[redacted identifier]';
    })
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[redacted PAN]')
    .replace(/(?<![\w])(?:\+91[\s-]?|91[\s-]|0)?[6-9](?:[\s-]?\d){9}(?![\w])/g, '[redacted phone]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/[A-Z0-9._%+-]+\s*(?:\[at\]|\(at\))\s*[A-Z0-9.-]+(?:\s*(?:\[dot\]|\(dot\)|\.)\s*[A-Z0-9-]+)+/gi, '[redacted email]');
  // Labels are conservative; arbitrary names in prose require a qualified review route.
  return masked.replace(/(^|[\n;|])([^\n;|:=]{1,60})\s*[:=]([^\n;|]*)/g, (line, lead, key, value) => {
    if (personalKey.test(keyName(key.trim()))) return `${lead}${key}: [redacted personal field]`;
    if (/^aadh?aa?r(?:number|no)?$/i.test(keyName(key.trim()))) {
      const lastFour = value.match(/\[redacted Aadhaar\] XXXX XXXX \d{4}/)?.[0];
      return `${lead}${key}: ${lastFour ?? '[redacted personal field]'}`;
    }
    return line;
  });
}

export function redactMessageText(text: string): string {
  try { return JSON.stringify(redactDerivative(JSON.parse(text))); }
  catch { return redactPrivateText(text); }
}

/** Read-time protection for historic document previews, without mutating their revisions. */
export function redactDocumentViews<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactDocumentViews) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    (key === 'parts' || key === 'referenceParts') && Array.isArray(item)
      ? item.map(part => typeof part?.text === 'string' ? {...part, text:redactMessageText(part.text), locator:redactDerivative(part.locator)} : part)
      : redactDocumentViews(item),
  ])) as T;
}

/** JSON derivative boundary, including object keys and structured personal fields. */
export function redactDerivative<T>(value: T): T {
  function visit(input: unknown, depth: number): unknown {
    if (depth > 40) return '[redacted depth limit]';
    if (typeof input === 'string') {
      // Source cells and upstream envelopes sometimes contain JSON encoded as text.
      if (/^[\s]*[\[{]/.test(input)) {
        try { return JSON.stringify(visit(JSON.parse(input), depth + 1)); } catch { /* ordinary text */ }
      }
      return redactPrivateText(input);
    }
    if (Array.isArray(input)) return input.map(item => visit(item, depth + 1));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [
      redactPrivateText(key), /^aadh?aa?r(?:number|no)?$/i.test(keyName(key))
        ? unavailable(item) ? item : redactPrivateText(String(item)).match(/\[redacted Aadhaar\] XXXX XXXX \d{4}/)?.[0] ?? '[redacted personal field]'
        : personalKey.test(keyName(key)) ? (unavailable(item) ? item : '[redacted personal field]') : visit(item, depth + 1),
    ]));
    return input;
  }
  return visit(value, 0) as T;
}

/** No visual PII qualification exists yet. EXIF removal and a checkbox cannot provide it. */
export function assertNoImageEgress(images: readonly unknown[]): void {
  if (images.length) throw new AppError(403, 'AI_IMAGE_PRIVACY', 'AI_IMAGE_PRIVACY: Image egress is unavailable until visual personal-field redaction is qualified. Inspect the retained original locally.');
}

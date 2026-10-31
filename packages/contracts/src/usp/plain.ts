// USP values and rules that build no schema. A browser module that needs only these imports
// @ulpin/contracts/usp/plain, so loading it never evaluates the zod schemas behind @ulpin/contracts/usp.
// Only type imports are allowed here; the old modules re-export each value.
export * from './intake-needs';

export const P3_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const bodyPattern = /^[0-9A-HJKMNP-TV-Z]{20}$/;

export function projectCodeForPayload(payload: string): string {
  if (!bodyPattern.test(payload)) throw new Error('Invalid P3/1 payload');
  let check = 0;
  for (const symbol of `P3${payload}`) check = (33 * check + P3_ALPHABET.indexOf(symbol) + 1) % 1021;
  return `P3-${payload}-${P3_ALPHABET[Math.floor(check / 32)]}${P3_ALPHABET[check % 32]}`;
}

/** Grammar and check only; issuance and authorization require a registry lookup. */
export function normalizeProjectCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.replace(/^ *| *$/g, '').replace(/[a-z]/g, letter => letter.toUpperCase());
  const match = /^(?:P3-([0-9A-HJKMNP-TV-Z]{20})-([0-9A-HJKMNP-TV-Z]{2})|P3([0-9A-HJKMNP-TV-Z]{20})([0-9A-HJKMNP-TV-Z]{2}))$/.exec(normalized);
  if (!match) return null;
  // One of the two forms matched; the empty fallbacks only satisfy the browser's index checks.
  const payload = match[1] ?? match[3] ?? '';
  const actual = match[2] ?? match[4] ?? '';
  const checkValue = P3_ALPHABET.indexOf(actual.charAt(0)) * 32 + P3_ALPHABET.indexOf(actual.charAt(1));
  if (checkValue > 1020) return null;
  const expected = projectCodeForPayload(payload).slice(-2);
  let difference = 0;
  for (let i = 0; i < 2; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0 ? `P3-${payload}-${actual}` : null;
}

export const POINT_BATCH_RECORD_LENGTHS = Object.freeze({ 0: 20, 1: 28, 2: 26, 3: 34, 6: 30, 7: 36, 8: 38 });

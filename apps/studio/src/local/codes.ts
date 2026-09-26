import { P3_ALPHABET, projectCodeForPayload } from '@ulpin/contracts/usp';

/**
 * A building's proposed 3D ULPIN, allotted when the area import commits it. The payload is derived from
 * the building's record ID, so the same building keeps the same code on every read and every device.
 */
export function buildingCode(recordId: string): string {
  // Two 32-bit FNV-1a streams feed a xorshift generator: stable, well spread, no async digest needed.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < recordId.length; i++) {
    a = Math.imul(a ^ recordId.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ recordId.charCodeAt(recordId.length - 1 - i), 0x01000193) >>> 0;
  }
  let x = (a ^ (b << 7)) >>> 0 || 1;
  let payload = '';
  for (let i = 0; i < 20; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    payload += P3_ALPHABET[(x ^ (i % 2 ? b : a)) & 31];
  }
  return projectCodeForPayload(payload);
}

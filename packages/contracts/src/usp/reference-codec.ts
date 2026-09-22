import { CoreRefSchema, coreFail, parseCore, type CoreRef } from '../spatial/core/scalars';

export const USP_REF_MAX_BYTES = 1024;
const maxEncodedLength = Math.ceil(USP_REF_MAX_BYTES * 4 / 3);
function invalid(): never { return coreFail('INVALID_ROUTE_REF', 'Invalid canonical property reference'); }

/** Canonical reference transport, not encryption, authorization, or a URL fetch target. */
export function encodeUspRef(input: CoreRef): string {
  const ref = parseCore(CoreRefSchema, input);
  const bytes = new TextEncoder().encode(JSON.stringify({ namespace: ref.namespace, id: ref.id }));
  if (bytes.length > USP_REF_MAX_BYTES) return invalid();
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function decodeUspRef(input: string): CoreRef {
  if (typeof input !== 'string' || input.length > maxEncodedLength
    || !/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) return invalid();
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), char => char.charCodeAt(0));
    if (bytes.length > USP_REF_MAX_BYTES) return invalid();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const ref = parseCore(CoreRefSchema, JSON.parse(text));
    // Reject padding, duplicate keys, whitespace, alternate key order and noncanonical pad bits.
    if (encodeUspRef(ref) !== input) return invalid();
    return ref;
  } catch { return invalid(); }
}

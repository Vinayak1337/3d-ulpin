import { randomBytes } from 'node:crypto';
import { P3_ALPHABET, projectCodeForPayload } from '@ulpin/contracts/usp';

/** Exactly 100 cryptographically random bits, encoded most significant first. */
export function newProjectCode(): string {
  const bytes = randomBytes(13);
  const bits = BigInt(`0x${bytes.toString('hex')}`) >> 4n;
  let payload = '';
  for (let i = 19; i >= 0; i--) payload += P3_ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return projectCodeForPayload(payload);
}

import { readFileSync } from 'node:fs';

// Reuse CAR's isolated, nonce-owned tmpfs launcher and its exact cleanup checks.
// Only the task label, child entry point and generated context names differ.
const source = readFileSync('docs/evidence/gf1/car/run-runtime.mjs', 'utf8')
  .replaceAll('CAR', 'AU2')
  .replaceAll('car', 'au2')
  .replace('docs/evidence/gf1/au2/steps.ts', 'docs/evidence/gf1/au2/measure-stream.ts');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

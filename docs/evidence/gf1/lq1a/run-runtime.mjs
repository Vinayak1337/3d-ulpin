import { readFileSync } from 'node:fs';

// Reuse the reviewed disposable-stack launcher; all names and writes belong to this task's nonce.
const source = readFileSync('docs/evidence/gf1/e3a/walk-runtime.mjs', 'utf8')
  .replaceAll('e3a', 'lq1a').replaceAll('E3a', 'LQ1a').replaceAll('E3A', 'LQ1A')
  .replace('timeout: 240000', 'timeout: 600000');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

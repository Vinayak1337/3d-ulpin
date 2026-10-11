import { readFileSync } from 'node:fs';

const script = readFileSync('.agents/skills/ui-design-check/scripts/scan-ui-diff.mjs', 'utf8')
  .replace("resolve(import.meta.dirname, '../../../..')", 'process.cwd()')
  .replaceAll('apps/web', 'apps/studio/src/features/intake/run');
await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);

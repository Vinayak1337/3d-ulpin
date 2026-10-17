import { readFileSync } from 'node:fs';

// Reuse the protected skill scanner; only its legacy target and script-relative root need adapting.
const source = readFileSync('.agents/skills/ui-design-check/scripts/scan-ui-diff.mjs', 'utf8')
  .replace("const root = resolve(import.meta.dirname, '../../../..');", 'const root = process.cwd();')
  .replaceAll('apps/web', 'apps/studio');
process.argv[2] ??= 'staging';
await import(`data:text/javascript,${encodeURIComponent(source)}`);

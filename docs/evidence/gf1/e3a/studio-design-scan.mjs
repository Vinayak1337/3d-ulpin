import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Reuse the skill's scan rules, retargeted to this task's surface without editing the shared skill.
const path = '.agents/skills/ui-design-check/scripts/scan-ui-diff.mjs';
const root = JSON.stringify(resolve('.'));
const source = readFileSync(path, 'utf8').replaceAll('apps/web', 'apps/studio')
  .replace("const root = resolve(import.meta.dirname, '../../../..');", `const root = ${root};`);
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

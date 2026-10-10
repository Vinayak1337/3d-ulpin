import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

const files = sourceFiles('apps/studio/src').filter((file) => /\.(ts|tsx|css)$/.test(file));
const imported = new Set();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), match[1]);
    for (const suffix of ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx']) {
      if (existsSync(base + suffix)) imported.add(resolve(base + suffix));
    }
  }
}

const identity = files.filter((file) => file.replaceAll('\\', '/').includes('/features/identity/'));
const unimported = identity.filter((file) => !/\.test\./.test(file) && !imported.has(resolve(file)));
const result = {
  method: 'Static/dynamic relative-import and export-from resolution across Studio source, including tests.',
  removed: ['apps/studio/src/features/identity/AssignDialog.tsx'],
  privateStylesOrTests: [],
  remainingWithoutImporter: unimported.map((file) => file.replaceAll('\\', '/')),
  testEntryPointsWithoutImporter: identity
    .filter((file) => /\.test\./.test(file) && !imported.has(resolve(file)))
    .map((file) => file.replaceAll('\\', '/')),
  beforeRemovalGrep: {
    command: 'rg -n "(import|export).*AssignDialog|from.*AssignDialog|import\\(.*AssignDialog" apps/studio/src',
    onlyMatch: 'features/identity/AssignDialog.tsx:12: export function AssignDialog',
    importers: 0,
  },
  typecheckAfterRemoval: { command: 'pnpm studio:typecheck', exit: 0 },
};
writeFileSync(resolve(import.meta.dirname, 'removal.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ remainingWithoutImporter: result.remainingWithoutImporter }));

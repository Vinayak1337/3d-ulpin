import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCER_DIRECTORIES = ['apps/api/src', 'packages/server/src', 'packages/contracts/src'];
const PRODUCER_FILES = [
  'docs/orchestration/nestjs-operation-ledger.json',
  'docs/api/datasets.json',
  'docs/api/runtime-qualification.json',
];

function isTestFile(path: string): boolean {
  return /(?:^|\/)tests?\//.test(path) || /\.(?:test|spec|test-fixture)\.(?:ts|js|json)$/.test(path);
}

function listFiles(root: string, directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return listFiles(root, path);
    return /\.(?:ts|js|json)$/.test(entry.name) && !isTestFile(path) ? [path] : [];
  });
}

/**
 * The keys of `sourceSha256` in docs/api/source-pins.json: every non-test .ts/.js/.json file under the three
 * producer directories plus the three declared documents, as sorted repository-relative paths.
 * Catalogue generation and the contract refresh both write this one rule.
 */
export function pinnedSourceFiles(root: string): string[] {
  return [...PRODUCER_DIRECTORIES.flatMap(directory => listFiles(root, directory)), ...PRODUCER_FILES].sort();
}

/** Producer text pins are portable across Git autocrlf checkouts; originals and receipts hash their exact bytes. */
function textSha256(file: string): string {
  const text = readFileSync(file).toString('latin1').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'latin1').digest('hex');
}

export function pinnedSourceHashes(root: string): Record<string, string> {
  return Object.fromEntries(pinnedSourceFiles(root).map(path => [path, textSha256(join(root, path))]));
}

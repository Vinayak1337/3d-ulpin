import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApiDocument } from '../../apps/api/src/openapi';

type SourcePins = { sourceSha256: Record<string, string> };

/** Preserve existing pins; new pins cover native non-test producers only, not verification scripts. */
function needsPin(path: string, pins: SourcePins) {
  if (Object.hasOwn(pins.sourceSha256, path)) return true;
  const producer = /^(?:apps\/api\/src|packages\/(?:server|contracts)\/src)\/.*\.(?:ts|js|json)$/.test(path);
  const test = /(?:^|\/)tests?\//.test(path) || /\.(?:test|spec)\.(?:ts|js|json)$/.test(path);
  return producer && !test;
}

function changedPaths(base: string) {
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { stdio: 'pipe' });
  const changed = execFileSync('git', ['diff', base, '--name-only'], { encoding: 'utf8' });
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return [...new Set((changed + '\n' + added).trim().split('\n').filter(Boolean))];
}

function repin(paths: string[]) {
  const pins = JSON.parse(readFileSync('docs/api/source-pins.json', 'utf8')) as SourcePins;
  const selected = paths.filter(path => needsPin(path, pins));
  for (const path of selected) {
    const bytes = readFileSync(path).toString('latin1').replace(/\r\n/g, '\n');
    pins.sourceSha256[path] = createHash('sha256').update(bytes, 'latin1').digest('hex');
  }
  writeFileSync('docs/api/source-pins.json', JSON.stringify(pins, null, 2) + '\n');
  console.log(JSON.stringify({ repinned: selected }));
}

async function main() {
  const [base, ...extras] = process.argv.slice(2);
  if (!base || base.startsWith('-') || extras.length) throw new Error('Usage: refresh-contract.ts <base-ref>');
  const paths = changedPaths(base);
  const requireApi = createRequire(resolve('apps/api/package.json'));
  requireApi('reflect-metadata');
  const { NestFactory } = requireApi('@nestjs/core');
  // Parameter decorators are compiled with apps/api/tsconfig.json by this CLI's caller.
  const { AppModule } = await import(pathToFileURL(resolve('apps/api/src/app.module.ts')).href);
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
  try {
    const document = createApiDocument(app);
    writeFileSync('docs/api/openapi.json', JSON.stringify(document, null, 2) + '\n');
    repin(paths);
  } finally { await app.close(); }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApiDocument } from '../../apps/api/src/openapi';

const requireApi = createRequire(resolve('apps/api/package.json'));
requireApi('reflect-metadata');
const { NestFactory } = requireApi('@nestjs/core');
// API compilation owns decorator typing; this CLI runs with apps/api/tsconfig.json.
const { AppModule } = await import(pathToFileURL(resolve('apps/api/src/app.module.ts')).href);
const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
try {
  const document = createApiDocument(app);
  writeFileSync('docs/api/openapi.json', JSON.stringify(document, null, 2) + '\n');
  const pins = JSON.parse(readFileSync('docs/api/source-pins.json', 'utf8'));
  const paths = execFileSync('git', ['diff', 'f5539916', '--name-only'], { encoding: 'utf8' }).trim().split('\n');
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .trim().split('\n');
  for (const path of new Set([...paths, ...added])) {
    if (!/^(?:apps\/api\/src|packages\/(?:server|contracts)\/src)\/.*\.(?:ts|js|json)$/.test(path)) continue;
    pins.sourceSha256[path] = createHash('sha256').update(readFileSync(path).toString('latin1')
      .replace(/\r\n/g, '\n'), 'latin1').digest('hex');
  }
  writeFileSync('docs/api/source-pins.json', JSON.stringify(pins, null, 2) + '\n');
  console.log('Native catalogue regenerated; only changed producers repinned; no listener or job started.');
} finally { await app.close(); }

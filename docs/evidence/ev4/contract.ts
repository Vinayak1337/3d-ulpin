import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createApiDocument } from '../../../apps/api/src/openapi';

const requireApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
requireApi('reflect-metadata');
const { NestFactory } = requireApi('@nestjs/core');
const { AppModule } = await import('../../../apps/api/src/app.module');

// Reuse the catalogue producer without writing the shared source-pins file outside this task's ownership.
const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
try {
  const path = 'docs/api/openapi.json';
  const text = JSON.stringify(createApiDocument(app), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    assert.equal(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), text);
    console.log('OpenAPI document matches the catalogue producer.');
  } else {
    writeFileSync(path, text);
    console.log('OpenAPI document regenerated; shared source pins were not changed.');
  }
} finally {
  await app.close();
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { settings } from '@ulpin/server/infrastructure/config';
import { AppModule } from '../src/app.module';
import { createApiDocument } from '../src/openapi';
import { pinnedOperations } from './pinned-operations';
import { pinnedSourceHashes } from './pinned-sources';

const root = settings.repositoryRoot;
const check = process.argv.includes('--check');
function emit(path: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (check) {
    if (readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n') !== text) throw new Error(`${path} is stale; regenerate the native OpenAPI catalogue.`);
  } else {
    const destination = join(root, path);
    if (existsSync(destination) && readFileSync(destination, 'utf8') === text) return;
    // Publish complete derived files without truncating the existing catalogue.
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, {flag: 'wx', flush: true});
      renameSync(temporary, destination);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Preserve the publication error. */ }
      throw error;
    }
  }
}
const app = await NestFactory.create(AppModule, {logger: false, bodyParser: false, abortOnError: false});
try {
  const document = createApiDocument(app);
  const pins = pinnedSourceHashes(root);
  const operations = pinnedOperations(document);
  emit('docs/api/openapi.json', document);
  emit('docs/api/source-pins.json', {schemaVersion: 'ulpin-native-openapi-pins/1', producerHashScope: 'crlf-to-lf', sourceSha256: pins,
    operations});
  console.log(`Native API catalogue ${check ? 'matches' : 'generated'}: ${operations.length} operations, ${Object.keys(document.components?.schemas ?? {}).length} named schemas; no listener or domain operation opened.`);
} finally { await app.close(); }

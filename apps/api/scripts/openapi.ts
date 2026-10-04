import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { settings } from '@ulpin/server/infrastructure/config';
import { AppModule } from '../src/app.module';
import { createApiDocument } from '../src/openapi';

const root = settings.repositoryRoot;
const check = process.argv.includes('--check');
function files(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|js|json)$/.test(entry.name) ? [path] : [];
  });
}
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
  const sourceFiles = ['apps/api/src', 'packages/server/src', 'packages/contracts/src'].flatMap(path => files(join(root, path)));
  sourceFiles.push(join(root, 'docs/orchestration/nestjs-operation-ledger.json'), join(root, 'docs/api/datasets.json'));
  sourceFiles.push(join(root, 'docs/api/runtime-qualification.json'));
  // Producer text pins are portable across Git autocrlf checkouts. Source originals
  // and runtime receipts retain their independent, exact-byte hashes.
  const pins = Object.fromEntries(sourceFiles.sort().map(path => [relative(root, path).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(path).toString('latin1').replace(/\r\n/g, '\n'), 'latin1').digest('hex')]));
  const operations = Object.entries(document.paths).flatMap(([path, item]) => Object.keys(item!).filter(method => ['get','post','patch','put','delete','head','options'].includes(method)).map(method => `${method.toUpperCase()} ${path}`)).sort();
  emit('docs/api/openapi.json', document);
  emit('docs/api/source-pins.json', {schemaVersion: 'ulpin-native-openapi-pins/1', producerHashScope: 'crlf-to-lf', sourceSha256: pins,
    operations});
  console.log(`Native API catalogue ${check ? 'matches' : 'generated'}: ${operations.length} operations, ${Object.keys(document.components?.schemas ?? {}).length} named schemas; no listener or domain operation opened.`);
} finally { await app.close(); }

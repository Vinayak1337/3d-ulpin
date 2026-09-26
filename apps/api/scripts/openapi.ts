import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
    if (readFileSync(join(root, path), 'utf8') !== text) throw new Error(`${path} is stale; regenerate the native OpenAPI catalogue.`);
  } else writeFileSync(join(root, path), text);
}
const app = await NestFactory.create(AppModule, {logger: false, bodyParser: false, abortOnError: false});
try {
  const document = createApiDocument(app);
  const sourceFiles = ['apps/api/src', 'packages/server/src', 'packages/contracts/src'].flatMap(path => files(join(root, path)));
  sourceFiles.push(join(root, 'docs/orchestration/nestjs-operation-ledger.json'), join(root, 'docs/api/datasets.json'));
  sourceFiles.push(join(root, 'docs/api/runtime-qualification.json'));
  const pins = Object.fromEntries(sourceFiles.sort().map(path => [relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const operations = Object.entries(document.paths).flatMap(([path, item]) => Object.keys(item!).filter(method => ['get','post','patch','put','delete','head','options'].includes(method)).map(method => `${method.toUpperCase()} ${path}`)).sort();
  emit('docs/api/openapi.json', document);
  emit('docs/api/source-pins.json', {schemaVersion: 'ulpin-native-openapi-pins/1', sourceSha256: pins,
    operations});
  console.log(`Native API catalogue ${check ? 'matches' : 'generated'}: ${operations.length} operations, ${Object.keys(document.components?.schemas ?? {}).length} named schemas; no listener or domain operation opened.`);
} finally { await app.close(); }

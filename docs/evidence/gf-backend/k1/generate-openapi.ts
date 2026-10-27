// Uses the existing native producer. Only the owned OpenAPI output is published;
// the lead must regenerate source-pins.json at integration (outside K1 ownership).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const requireApi = createRequire(new URL('../../../../apps/api/package.json', import.meta.url));
requireApi('reflect-metadata');
const { NestFactory } = requireApi('@nestjs/core');
const { AppModule } = await import('../../../../apps/api/src/app.module');
const { createApiDocument } = await import('../../../../apps/api/src/openapi');
const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
try {
  const document = createApiDocument(app);
  writeFileSync('docs/api/openapi.json', JSON.stringify(document, null, 2) + '\n');
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  const operations = Object.values(document.paths).reduce(
    (count, item) => count + Object.keys(item!).filter(method => methods.includes(method)).length,
    0,
  );
  console.log(`Native OpenAPI generated: ${operations} operations`);
} finally { await app.close(); }

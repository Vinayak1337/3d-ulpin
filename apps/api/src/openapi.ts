import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { settings } from '@ulpin/server/infrastructure/config';

type Json = Record<string, any>;
const root = settings.repositoryRoot;
const readJson = (path: string): Json => JSON.parse(readFileSync(join(root, path), 'utf8'));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const modules = ['intake', 'register', 'evidence', 'spatial', 'ai'];

export function datasetCatalogue(): Json { return readJson('docs/api/datasets.json'); }

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? controllerFiles(path) : entry.name.endsWith('.controller.ts') || entry.name.endsWith('.controllers.ts') ? [path] : [];
  });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Generated from registered controllers and canonical validators; never invokes domain methods. */
export function createApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('3D ULPIN private backend')
    .setDescription('Native NestJS API. Loopback single-operator boundary; not public or multiuser authentication. Source provenance, installed records and runtime qualification are separate. Dataset catalogue: /api/docs/datasets.json. SQL authority: database/manifest.json in the repository. All public-portal work remains full product.')
    .setVersion('1.0.0').addServer('http://127.0.0.1:3188', 'Default local configuration; consult the run receipt for an observed listener.')
    .build()) as OpenAPIObject & Json;
  document.openapi = '3.0.3';
  const baseline = readJson('docs/orchestration/nestjs-operation-ledger.json');
  const manifests = modules.map(name => ({path: `apps/api/src/modules/${name}/operation-manifest.json`, value: readJson(`apps/api/src/modules/${name}/operation-manifest.json`)}));
  const inventory = new Map<string, Json>();
  for (const {path, value} of manifests) for (const operation of value.operations) {
    const key = `${operation.method} ${operation.path}`;
    if (inventory.has(key)) throw new Error(`Duplicate operation manifest: ${key}`);
    inventory.set(key, {...operation, batch: value.batch, manifest: path});
  }
  for (const operation of baseline.operations.filter((o: Json) => o.batch === 'NEST-00')) {
    inventory.set(`${operation.method} ${operation.path}`, {...operation, disposition: 'retained'});
  }
  const expected = new Set<string>(baseline.operations.map((o: Json) => `${o.method} ${o.path}`));
  const sources = controllerFiles(join(root, 'apps/api/src')).map(path => ({path: relative(root, path), text: readFileSync(path, 'utf8')}));
  const seen = new Set<string>();
  const schemas = document.components!.schemas ??= {};
  const schemaNames = new Map<string, string>();
  function model(schema: Json, preferred: string): Json {
    if (schema.$ref || schema.format === 'binary') return schema;
    const key = stable(schema);
    const previous = schemaNames.get(key);
    if (previous) return {$ref: `#/components/schemas/${previous}`};
    let name = preferred.replace(/[^A-Za-z0-9_]/g, '_');
    while (schemas[name]) name += '_';
    schemas[name] = schema;
    schemaNames.set(key, name);
    return {$ref: `#/components/schemas/${name}`};
  }
  for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item!)) {
    if (!methods.has(method)) continue;
    const op = operation as Json;
    const key = `${method.toUpperCase()} ${path}`;
    const entry = inventory.get(key);
    if (!entry || !expected.has(key) || entry.operationId !== op.operationId) throw new Error(`Unreconciled operation: ${key}`);
    seen.add(key);
    const source = sources.filter(s => s.text.includes(`'${op.operationId}'`));
    if (source.length !== 1) throw new Error(`Ambiguous controller source: ${op.operationId}`);
    op['x-source-file'] = source[0].path;
    op['x-batch'] = entry.batch;
    op['x-disposition'] = entry.disposition;
    op['x-code-status'] = entry.disposition === 'retired' ? 'retired-410' : 'implemented-native';
    op['x-runtime-verified'] = false;
    op['x-runtime-qualification'] = 'See pinned integration receipts; route metadata and boundary checks do not qualify stateful workflows.';
    if (entry.manifest) op['x-operation-manifest'] = entry.manifest;
    if (entry.maxBodyBytes !== undefined) op['x-max-body-bytes'] = entry.maxBodyBytes;
    if (entry.transportProfile) op['x-transport-profile'] = entry.transportProfile;
    op['x-dataset-catalogue'] = '/api/docs/datasets.json';
    op.parameters ??= [];
    for (const match of path.matchAll(/\{([^}]+)\}/g)) {
      const name = match[1];
      let param = op.parameters.find((p: Json) => p.in === 'path' && p.name === name);
      if (!param) { param = {name, in: 'path', required: true}; op.parameters.push(param); }
      if (!param.schema || Object.keys(param.schema).length === 0) param.schema = {type: 'string'};
    }
    // Each media type has its own transport shape, rather than a union accepted as both.
    if (key === 'POST /api/v1/import-packages') {
      const content = op.requestBody.content;
      const alternatives = content['application/json'].schema.oneOf;
      content['application/json'].schema = alternatives[0];
      content['multipart/form-data'].schema = alternatives[1];
    }
    const name = op.operationId.replace('_api_v1_', '_').replace('_api', '_Root');
    for (const [mime, media] of Object.entries(op.requestBody?.content ?? {})) {
      const body = media as Json;
      if (body.schema) body.schema = model(body.schema, `${name}_Request_${mime.replace(/[^a-z]/gi, '_')}`);
    }
    for (const [status, response] of Object.entries(op.responses ?? {})) {
      const result = response as Json;
      result.description ||= Number(status) < 400 ? 'Canonical result' : 'Rejected or unavailable operation';
      result.headers ??= {};
      result.headers['X-Request-Id'] ??= {schema: {type: 'string', format: 'uuid'}, description: 'Server request identifier.'};
      const jsonSchema = result.content?.['application/json']?.schema;
      if (jsonSchema?.format === 'binary') {
        result.content = {'application/octet-stream': {schema: jsonSchema}};
        result.description += '; Content-Type follows the retained source or generated artifact format.';
      } else if (jsonSchema?.oneOf?.some((schema: Json) => schema.format === 'binary')) {
        result.content['application/octet-stream'] = {schema: {type: 'string', format: 'binary'}};
        jsonSchema.oneOf = jsonSchema.oneOf.filter((schema: Json) => schema.format !== 'binary');
      }
      for (const [mime, media] of Object.entries(result.content ?? {})) {
        const body = media as Json;
        if (body.schema) body.schema = model(body.schema, `${name}_Response_${status}_${mime.replace(/[^a-z]/gi, '_')}`);
      }
    }
  }
  if (seen.size !== expected.size || [...expected].some(key => !seen.has(key))) throw new Error('Native operation coverage differs from the baseline ledger.');
  document['x-dataset-catalogue'] = {url: '/api/docs/datasets.json', repository: 'docs/api/datasets.json', installedRecords: 'environment-specific; no fixed sample IDs'};
  document['x-sql-authority'] = 'database/manifest.json';
  document['x-runtime-receipts'] = 'docs/evidence/usp/nest-migration';
  return document;
}

export function setupApiDocs(app: INestApplication): void {
  const document = createApiDocument(app);
  app.getHttpAdapter().get('/api/docs/datasets.json', (_request: unknown, response: any) => response.json(datasetCatalogue()));
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/openapi.json',
    swaggerOptions: {supportedSubmitMethods: [], persistAuthorization: false, defaultModelsExpandDepth: 0, validatorUrl: null},
    customSiteTitle: '3D ULPIN API',
  });
}

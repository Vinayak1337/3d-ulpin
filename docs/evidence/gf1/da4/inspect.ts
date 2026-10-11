import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AppError } from '../../../../packages/server/src/infrastructure/errors';

const firstPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const root = 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/';
const secondPath = root + '5zhs-2jue-box-w74.003-s40.732-e73.992-n40.740.geojson';
const registryPath = 'packages/server/src/modules/usp/ingestion/registry.ts';
const contractPath = 'packages/contracts/src/usp/ingestion.ts';
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
type Feature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: any[] } };
type Profile = {
  version: string;
  crs: unknown;
  geometryTypes: string[];
  schemaFingerprint: string;
  paths: { path: string; types: string[] }[];
};

function productProfiler() {
  // Evaluate the unchanged exported pure functions, excluding imports that load .env through storage.ts.
  const source = readFileSync(registryPath, 'utf8');
  const start = source.indexOf('export function geojsonInventory(');
  const end = source.indexOf('\nfunction heightMapping(', start);
  assert(start > 0 && end > start);
  const functions = source.slice(start, end).replaceAll('export function ', 'function ');
  const version = /export const INGESTION_VERSION = '([^']+)'/.exec(readFileSync(contractPath, 'utf8'))![1];
  const script = ts.transpileModule(functions, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const inspect = runInNewContext(script + '\ninspectedProfile;', {
    AppError, sha256, INGESTION_VERSION: version, limitations: [], TextDecoder,
    escape: (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1'),
  });
  return { inspect, sourceSha256: sha256(source), functionSha256: sha256(source.slice(start, end)), version };
}

function fingerprintInputs(bytes: Buffer, source: { crs: unknown; features: Feature[] }) {
  // These are the inspection inputs used by the fingerprint, not a geometry-validity qualification.
  // Follow gis_inspection.py: sorted union of property names/types and its declared CRS84 evidence.
  assert.deepEqual(source.crs, {
    type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
  });
  return {
    format: 'geojson', sourceSha256: sha256(bytes), featureCount: source.features.length,
    sourceCrs: 'EPSG:4326', crsEvidence: 'Declared OGC CRS84',
    geometryTypes: [...new Set(source.features.map(feature => feature.geometry.type))].sort(),
    fields: [...new Set(source.features.flatMap(feature => Object.keys(feature.properties)))].sort()
      .map(name => ({ name })),
  };
}

function bounds(features: Feature[]) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(coordinates: any[]) {
    if (typeof coordinates[0] === 'number') {
      box[0] = Math.min(box[0], coordinates[0]);
      box[1] = Math.min(box[1], coordinates[1]);
      box[2] = Math.max(box[2], coordinates[0]);
      box[3] = Math.max(box[3], coordinates[1]);
    } else {
      for (const child of coordinates) visit(child);
    }
  }
  for (const feature of features) visit(feature.geometry.coordinates);
  return box;
}

function differences(first: Profile, second: Profile) {
  const left = new Map(first.paths.map(item => [item.path, item.types]));
  const right = new Map(second.paths.map(item => [item.path, item.types]));
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  return paths.filter(path => JSON.stringify(left.get(path)) !== JSON.stringify(right.get(path)))
    .map(path => ({ path, firstTypes: left.get(path) ?? null, secondTypes: right.get(path) ?? null }));
}

function heightCounts(features: Feature[]) {
  const counts = { property: 'height_roof', present: 0, null: 0, absent: 0, zero: 0, negative: 0,
    number: 0, string: 0, otherNonNull: 0 };
  for (const feature of features) {
    if (!Object.hasOwn(feature.properties, counts.property)) {
      counts.absent++;
      continue;
    }
    counts.present++;
    const value = feature.properties[counts.property];
    if (value === null) counts.null++;
    else if (typeof value === 'number') {
      counts.number++;
      if (value === 0) counts.zero++;
      if (value < 0) counts.negative++;
    } else if (typeof value === 'string') counts.string++;
    else counts.otherNonNull++;
  }
  return counts;
}

function readInputs() {
  const firstBytes = readFileSync(firstPath);
  const secondBytes = readFileSync(secondPath);
  const first = JSON.parse(firstBytes.toString('utf8'));
  const second = JSON.parse(secondBytes.toString('utf8'));
  const receipt = JSON.parse(readFileSync(secondPath + '.receipt.json', 'utf8'));
  assert.equal(sha256(secondBytes), receipt.sha256);
  assert.equal(secondBytes.length, receipt.bytes);
  assert(secondBytes.length <= 16 * 1024 * 1024);
  assert(second.features.length >= 300 && second.features.length <= 1900);
  assert.equal(second.features.length, Number(receipt.countRequest.answer[0].count));
  return { firstBytes, secondBytes, first, second, receipt };
}

function inspectInputs(inputs: ReturnType<typeof readInputs>) {
  const { firstBytes, secondBytes, first, second, receipt } = inputs;
  const product = productProfiler();
  const firstProfile: Profile = product.inspect(firstBytes, fingerprintInputs(firstBytes, first));
  const secondProfile: Profile = product.inspect(secondBytes, fingerprintInputs(secondBytes, second));
  const firstBox = bounds(first.features);
  const secondBox = bounds(second.features);
  assert(secondBox[1] > firstBox[3]);
  assert(receipt.geography.rectangle[1] > firstBox[3]);
  const firstKeys = new Set(first.features.map((feature: Feature) => feature.properties.doitt_id));
  const secondKeys = new Set(second.features.map((feature: Feature) => feature.properties.doitt_id));
  const common = [...secondKeys].filter(key => firstKeys.has(key)).length;
  const geometryTypes: Record<string, number> = {};
  for (const feature of second.features) {
    geometryTypes[feature.geometry.type] = (geometryTypes[feature.geometry.type] ?? 0) + 1;
  }
  return { product, firstProfile, secondProfile, firstBox, secondBox, firstKeys, secondKeys, common, geometryTypes };
}

function sourceEvidence(inputs: ReturnType<typeof readInputs>, inspected: ReturnType<typeof inspectInputs>) {
  const { firstBytes, secondBytes, first, second, receipt } = inputs;
  const { firstProfile, secondProfile, firstBox, secondBox, firstKeys, secondKeys, common, geometryTypes } = inspected;
  return {
    task: 'DA4', gate: 'GF1 data prerequisite', baseCommit: '6f6a9eb3dd8a6944774b7e62b8cc7e653b14d11b',
    assets: [{ file: secondPath.split('/').at(-1), format: 'GeoJSON', ...receipt }],
    first: { retainedPath: firstPath, bytes: firstBytes.length, sha256: sha256(firstBytes),
      featureCount: first.features.length, boundingBox: firstBox, schemaFingerprint: firstProfile.schemaFingerprint },
    second: { featureCount: second.features.length, boundingBox: secondBox,
      schemaFingerprint: secondProfile.schemaFingerprint, geometryTypes, height: heightCounts(second.features) },
    separation: { side: 'north', coordinateUnits: 'degree',
      queryRectangleGap: receipt.geography.rectangle[1] - firstBox[3], extentGap: secondBox[1] - firstBox[3],
      rectangleSharesNoPointWithFirstExtent: true, secondExtentSharesNoPointWithFirstExtent: true },
    columns: { verdict: firstProfile.schemaFingerprint === secondProfile.schemaFingerprint ? 'same' : 'different',
      differences: differences(firstProfile, secondProfile), firstCrs: firstProfile.crs, secondCrs: secondProfile.crs,
      firstGeometryTypes: firstProfile.geometryTypes, secondGeometryTypes: secondProfile.geometryTypes,
      firstPaths: firstProfile.paths.map(({ path, types }) => ({ path, types })),
      secondPaths: secondProfile.paths.map(({ path, types }) => ({ path, types })) },
    buildingKeys: { property: 'doitt_id', layoutEvidence: 'docs/evidence/gf1/e1b/steps.ts:222',
      firstUnique: firstKeys.size, secondUnique: secondKeys.size, inCommon: common },
  };
}

function executionEvidence(inputs: ReturnType<typeof readInputs>, inspected: ReturnType<typeof inspectInputs>) {
  const { receipt } = inputs;
  const { product } = inspected;
  return {
    fingerprintExecution: { method: 'Unchanged product function bodies evaluated in an isolated VM through tsx.',
      registryPath, sourceSha256: product.sourceSha256, functionSha256: product.functionSha256,
      version: product.version, database: false, server: false, credentialsRead: false,
      inspectionInputs: 'Raw declared CRS84, sorted geometry type and field-name inventories; no validity claim.',
      excludedImports: 'storage.ts transitively loads .env; only its SHA-256 primitive is supplied locally.',
      excludedLimitations: 'Empty limitations supplied; limitations are not a schemaFingerprint input.' },
    access: { account: false, login: false, token: false, upload: false, providerCalls: 0, needsOwner: [],
      metadataUrl: receipt.licence.portalMetadataUrl, portalLicenseId: null,
      discoveryUrls: [receipt.datasetApiDocumentation, receipt.queryDocumentation, receipt.formatDocumentation,
        'https://data.cityofnewyork.us/d/5zhs-2jue'],
      geojsonForm: 'SODA resource GeoJSON retains string-valued numbers and declared CRS84, like the first file.',
      selectedColumns: false, fileFetches: 1, additionalRectangleOrExportFetch: false },
    qualifications: ['Foreign test_only; permission unconfirmed.', 'No conversion, import, upload or runtime gate.',
      'Numeric height counts do not parse strings; no field unit or height meaning inferred.'],
  };
}

function verifyRecorded(result: ReturnType<typeof sourceEvidence>) {
  const recorded = JSON.parse(readFileSync('docs/evidence/gf1/da4/result.json', 'utf8'));
  for (const key of ['first', 'second', 'columns', 'buildingKeys', 'separation'] as const) {
    assert.equal(JSON.stringify(result[key]), JSON.stringify(recorded[key]), `Recorded ${key} differs from bytes.`);
  }
}

function main() {
  const inputs = readInputs();
  const inspected = inspectInputs(inputs);
  const result = { ...sourceEvidence(inputs, inspected), ...executionEvidence(inputs, inspected) };
  if (process.argv.includes('--write')) {
    writeFileSync('docs/evidence/gf1/da4/result.json', JSON.stringify(result, null, 2) + '\n');
  } else {
    verifyRecorded(result);
  }
  console.log(JSON.stringify({ first: result.first.schemaFingerprint, second: result.second.schemaFingerprint,
    differences: result.columns.differences, features: result.second.featureCount,
    common: result.buildingKeys.inCommon, height: result.second.height }));
}

main();

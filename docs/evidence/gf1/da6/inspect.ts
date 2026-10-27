import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AppError } from '../../../../packages/server/src/infrastructure/errors';

const root = 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/';
const file = root + '5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson';
const da4File = root + '5zhs-2jue-box-w74.003-s40.732-e73.992-n40.740.geojson';
const firstFile = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const registryPath = 'packages/server/src/modules/usp/ingestion/registry.ts';
const contractPath = 'packages/contracts/src/usp/ingestion.ts';
const readerPath = 'packages/server/src/modules/usp/ingestion/streaming-vector-reader.ts';
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
type Feature = { type: string; properties: Record<string, unknown>; geometry: { type: string } | null; id?: unknown };
type Column = { types: Set<string>; present: number; explicitNull: number };

function evaluate(source: string, context: Record<string, unknown>) {
  const script = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(script, { ...context, Buffer, TextDecoder, AppError });
}

function boundedProfileRefusal() {
  const source = readFileSync('docs/evidence/gf1/da4/inspect.ts', 'utf8');
  const start = source.indexOf('function productProfiler()');
  const end = source.indexOf('\nfunction fingerprintInputs(', start);
  assert(start > 0 && end > start);
  const product = evaluate(source.slice(start, end) + '\nproductProfiler();', {
    assert, readFileSync, ts, runInNewContext, sha256, registryPath, contractPath,
  });
  try {
    product.inspect(readFileSync(file), {});
    assert.fail('The bounded profile unexpectedly accepted a large original.');
  } catch (error) {
    assert(error instanceof AppError && error.code === 'RECORD_LIMIT');
    return { code: error.code, status: error.status, message: error.message,
      method: 'Reused DA4 productProfiler; unchanged product function rejected the whole original.' };
  }
}

function streamingReader() {
  // Reuse only framing/parsing functions; exclude imports that load credentials or runtime services.
  const source = readFileSync(readerPath, 'utf8');
  const start = source.indexOf('const whitespace=');
  const end = source.indexOf('\n/** Tabular records', start);
  assert(start > 0 && end > start);
  const functions = source.slice(start, end).replace('export async function ', 'async function ')
    .replace('export type SourceFeature=', 'type SourceFeature=');
  const contract = readFileSync('packages/contracts/src/usp/streaming-vector.ts', 'utf8');
  const limitsStart = contract.indexOf('Object.freeze(');
  const limitsEnd = contract.indexOf('\nexport const StreamingVectorFramingSchema', limitsStart);
  const limits = evaluate(contract.slice(limitsStart, limitsEnd), {});
  return evaluate(functions + '\nreadStreamingFeatures;', { createHash, limits });
}

function addColumn(columns: Map<string, Column>, path: string, value: unknown) {
  let column = columns.get(path);
  if (!column) {
    column = { types: new Set(), present: 0, explicitNull: 0 };
    columns.set(path, column);
  }
  column.present++;
  if (value === null) column.explicitNull++;
  else column.types.add(Array.isArray(value) ? 'array' : typeof value);
}

function ownInventory() {
  const columns = new Map<string, Column>();
  const geometryTypes: Record<string, number> = {};
  const positions = new Map<unknown, number[]>();
  const rawIssues: Record<string, number> = {};
  let records = 0;
  let absentKeys = 0;
  const consume = async (item: { index: number; feature: Feature; valueIssueCode: string | null }) => {
    const feature = item.feature;
    assert.equal(feature.type, 'Feature');
    records++;
    if (Object.hasOwn(feature, 'geometry')) addColumn(columns, '/features/*/geometry', feature.geometry);
    if (Object.hasOwn(feature, 'id')) addColumn(columns, '/features/*/id', feature.id);
    for (const [name, value] of Object.entries(feature.properties ?? {})) {
      const escaped = name.replaceAll('~', '~0').replaceAll('/', '~1');
      addColumn(columns, '/features/*/properties/' + escaped, value);
    }
    const geometry = feature.geometry?.type ?? 'null';
    geometryTypes[geometry] = (geometryTypes[geometry] ?? 0) + 1;
    if (!Object.hasOwn(feature.properties ?? {}, 'doitt_id')) absentKeys++;
    else {
      const key = feature.properties.doitt_id;
      const seen = positions.get(key) ?? [];
      seen.push(item.index);
      positions.set(key, seen);
    }
    if (item.valueIssueCode) rawIssues[item.valueIssueCode] = (rawIssues[item.valueIssueCode] ?? 0) + 1;
  };
  return { columns, geometryTypes, positions, rawIssues, consume,
    counts: () => ({ records, absentKeys }) };
}

function ownColumns(inventory: ReturnType<typeof ownInventory>) {
  const rows = inventory.counts().records;
  const paths = [...inventory.columns].sort(([left], [right]) => left.localeCompare(right))
    .map(([path, column]) => ({ path, types: [...column.types].sort(),
      present: column.present, explicitNull: column.explicitNull, absent: rows - column.present }));
  const version = /export const INGESTION_VERSION = '([^']+)'/.exec(readFileSync(contractPath, 'utf8'))![1];
  const crs = { value: 'EPSG:4326', evidence: 'Declared OGC CRS84', unit: 'degree' };
  const geometryTypes = Object.keys(inventory.geometryTypes).filter(type => type !== 'null').sort();
  const fingerprint = sha256(JSON.stringify({ version, crs, geometryTypes,
    paths: paths.map(({ path, types }) => ({ path, types })) }));
  return { method: 'Independent streamed path/type aggregation; comparable hash, NOT the product profile.',
    version, crs, paths, fingerprint, geometryTypes };
}

function keyEvidence(inventory: ReturnType<typeof ownInventory>) {
  const keys = new Set(inventory.positions.keys());
  const repeats = [...inventory.positions].filter(([, positions]) => positions.length > 1);
  const intersection = (path: string) => {
    const features: Feature[] = JSON.parse(readFileSync(path, 'utf8')).features;
    const other = new Set(features.map(feature => feature.properties.doitt_id));
    return [...other].filter(key => keys.has(key)).length;
  };
  return { property: 'doitt_id', layoutLocator: 'docs/evidence/gf1/e1b/steps.ts:222',
    distinctValues: keys.size, valuesOccurringMoreThanOnce: repeats.length,
    extraOccurrences: repeats.reduce((count, [, positions]) => count + positions.length - 1, 0),
    absent: inventory.counts().absentKeys, null: inventory.positions.get(null)?.length ?? 0,
    firstThreeRepeatedKeys: repeats.slice(0, 3).map(([key, positions]) => ({ key,
      firstThreeFeatureIndices: positions.slice(0, 3), occurrences: positions.length })),
    positionConvention: 'Zero-based features array index; /features/<index>/properties/doitt_id.',
    inCommonWithFirstPack: intersection(firstFile), inCommonWithDA4: intersection(da4File) };
}

function literalCrsMember(expected: unknown) {
  const tail = Buffer.alloc(4096);
  const size = statSync(file).size;
  const descriptor = openSync(file, 'r');
  let bytes: number;
  try {
    bytes = readSync(descriptor, tail, 0, tail.length, size - tail.length);
  } finally {
    closeSync(descriptor);
  }
  const match = /("crs"\s*:\s*\{[\s\S]*\})\s*\}\s*$/.exec(tail.subarray(0, bytes).toString('utf8'));
  assert(match, 'The top-level CRS declaration was not found at the end of the original.');
  assert.deepEqual(JSON.parse('{' + match[1] + '}').crs, expected);
  return match[1];
}

async function inspect() {
  const refusal = boundedProfileRefusal();
  const receipt = JSON.parse(readFileSync(file + '.receipt.json', 'utf8'));
  const inventory = ownInventory();
  const streamed = await streamingReader()(createReadStream(file), 'feature-collection', inventory.consume);
  assert.equal(streamed.sha256, receipt.sha256);
  assert.equal(streamed.bytes, receipt.bytes);
  assert(streamed.bytes >= 17 * 1024 * 1024 && streamed.bytes <= 100 * 1024 * 1024);
  assert(streamed.features >= 25000 && streamed.features <= 60000);
  const crs = JSON.parse(JSON.stringify(streamed.metadata.crs));
  assert.deepEqual(crs, { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } });
  const columns = ownColumns(inventory);
  const da4 = JSON.parse(readFileSync('docs/evidence/gf1/da4/result.json', 'utf8'));
  return { task: 'DA6', gate: 'GF1 data prerequisite', baseCommit: '2f605e5a71cd8abb6040fc11bc40384a129b4d02',
    assets: [{ file: file.split('/').at(-1), format: 'GeoJSON', ...receipt }],
    wholeFile: { oneFeatureCollection: true, topLevelType: streamed.metadata.type, crs,
      crsMemberExactlyAsWritten: literalCrsMember(crs),
      featureCount: streamed.features, geometryTypesIncludingNull: { null: 0, ...inventory.geometryTypes },
      noTrailingContent: true, hashMatchesReceipt: true,
      matchesPortalCount: streamed.features === Number(receipt.countRequests.at(-1).answer[0].count) },
    productProfile: { available: false, refusal }, independentColumns: { ...columns,
      da4Fingerprint: da4.second.schemaFingerprint,
      comparisonWithDA4: columns.fingerprint === da4.second.schemaFingerprint ? 'same as' : 'different from' },
    buildingKeys: keyEvidence(inventory), rawJsonIssueCounts: inventory.rawIssues,
    reader: { sourcePath: readerPath, sourceSha256: sha256(readFileSync(readerPath)),
      method: 'Reused product streaming JSON framing, independent column/key aggregation; no import or admission.' },
    access: { account: false, login: false, token: false, upload: false, providerCalls: 0, needsOwner: [] } };
}

async function main() {
  const result = await inspect();
  const path = 'docs/evidence/gf1/da6/result.json';
  if (process.argv.includes('--write')) writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  else {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    for (const key of ['wholeFile', 'independentColumns', 'buildingKeys', 'rawJsonIssueCounts'] as const) {
      assert.equal(JSON.stringify(result[key]), JSON.stringify(saved[key]), `Recorded ${key} changed.`);
    }
  }
  console.log(JSON.stringify({ bytes: result.assets[0].bytes, ...result.wholeFile,
    productProfile: result.productProfile, independentFingerprint: result.independentColumns.fingerprint,
    comparisonWithDA4: result.independentColumns.comparisonWithDA4, buildingKeys: result.buildingKeys }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

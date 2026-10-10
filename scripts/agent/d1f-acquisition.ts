import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeColumnText, readColumnCsv } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { columnProfileHash } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { prepareTable, saveNew, type PreparedColumn } from './t1-profiles';
import { developmentManifest, digest, stableHash, type SourceAsset, type SourceTable } from './t1-sources';

const MANIFEST = 'fixtures/usp/D8-open-property-foreign/manifest.json';
const OUTPUT = 'E:/BhuAayam-data/task-data/d1f';
const RECOVERY_OUTPUT = 'E:/BhuAayam-data/task-data/a5a';
const DATA_ROOT = 'E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f';
type Pin = SourceAsset['original'];
export type Asset = SourceAsset & {
  geography: string;
  profileInput: Pin & { rows: number; sourceSha256: string; sourceLocator: string };
  dictionary: Pin & { url: string };
};
type PublisherColumn = {
  name: string; fieldName: string; position: number; dataTypeName: string; description?: string;
};
type Dictionary = { columns: PublisherColumn[]; description?: string };

function checkedPath(path: string) {
  const location = relative(resolve(DATA_ROOT), resolve(path));
  assert(location && !location.startsWith('..') && !isAbsolute(location), 'D1F_SOURCE_PATH_DENIED');
  assert(!/(?:^|[\\/])(?:\.env|heldout|provisional)(?:[\\/.]|$)/i.test(path), 'D1F_SOURCE_PATH_DENIED');
}

export function checkedPin(pin: Pin) {
  checkedPath(pin.externalPath);
  assert.equal(statSync(pin.externalPath).size, pin.bytes, 'D1F_SOURCE_SIZE_CHANGED');
  assert.equal(digest(pin.externalPath), pin.sha256, 'D1F_SOURCE_HASH_CHANGED');
}

function admittedAssets() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    purpose: string; heldout: unknown[]; families: { id: string; split: string }[]; assets: Asset[];
  };
  assert.equal(manifest.purpose, 'test_only');
  assert.equal(manifest.heldout.length, 0);
  const { heldOut, indianFamilies } = developmentManifest(); // Public aliases only; evaluator material stays closed.
  const families = new Set(manifest.families.filter(row => row.split === 'dev').map(row => row.id));
  for (const asset of manifest.assets) {
    assert(asset.split === 'dev' && families.has(asset.family));
    assert(!heldOut.has(asset.family) && !indianFamilies.has(asset.family), 'D1F_FAMILY_BOUNDARY_CHANGED');
    assert(asset.permission.state !== 'restricted' && !/private|restricted/i.test(asset.privacy ?? ''));
    assert.notEqual(asset.family, 'opf-d01', 'D1F_CLOSED_FAMILY_DENIED');
    assert.equal(asset.profileInput.sourceSha256, asset.original.sha256);
    checkedPin(asset.original);
    checkedPin(asset.dictionary);
    checkedPin(asset.profileInput);
  }
  assert.equal(new Set(manifest.assets.map(asset => asset.id)).size, manifest.assets.length);
  return manifest.assets;
}

export function prefixTable(asset: Asset): SourceTable {
  assert(asset.profileInput.bytes <= 16 * 1024 * 1024 && asset.profileInput.rows <= 2000);
  const parsed = readColumnCsv(decodeColumnText(readFileSync(asset.profileInput.externalPath)));
  assert.equal(parsed.rows.length, asset.profileInput.rows);
  assert(parsed.headers.length <= 256 && parsed.rows.every(row => row.length === parsed.headers.length));
  return {
    name: 'csv', headers: parsed.headers, rows: parsed.rows, headerRows: [1],
    headerLocators: parsed.headers.map((_, index) => [`record 1/${index + 1}`]),
  };
}

export function profileAsset(asset: Asset): SourceAsset {
  const { externalPath, sha256, bytes } = asset.profileInput;
  return {
    id: asset.id.replace(/\.csv$/, '-prefix-128.csv'), family: asset.family, split: 'dev', mediaType: 'text/csv',
    original: { externalPath, sha256, bytes }, permission: asset.permission, privacy: asset.privacy,
    derivedFrom: {
      assetId: asset.id, original: asset.original, sourcePath: asset.original.externalPath,
      sourceSha256: asset.original.sha256, locator: asset.profileInput.sourceLocator, index: MANIFEST,
    },
  };
}

function publisherDefinition(dictionary: Dictionary, header: string) {
  const index = dictionary.columns.findIndex(column => column.name === header && column.position >= 0 &&
    !column.fieldName.startsWith(':@'));
  assert(index >= 0, 'D1F_DICTIONARY_COLUMN_LINK_INVALID');
  const column = dictionary.columns[index];
  if (column.description?.trim()) return { definition: column.description, locator: `/columns/${index}/description` };
  const geometry = dictionary.columns.filter(column => ['polygon', 'multipolygon'].includes(column.dataTypeName));
  // A sole geometry column may cite the dataset's literal geometry description, not an invented expanded definition.
  if (geometry.length === 1 && geometry[0] === column && dictionary.description?.trim()) {
    return { definition: dictionary.description, locator: '/description (sole polygon column; dataset scope)' };
  }
  return undefined;
}

function dictionaryRows(asset: Asset, profiles: PreparedColumn[]) {
  const dictionary = JSON.parse(readFileSync(asset.dictionary.externalPath, 'utf8')) as Dictionary;
  return profiles.flatMap((profile, index) => {
    const documented = publisherDefinition(dictionary, profile.header);
    if (!documented) return [];
    return [{
      profileId: profile.profileId, family: profile.family, sourceField: `column_${index + 1}`,
      ...documented, dictionaryUrl: asset.dictionary.url, dictionarySha256: asset.dictionary.sha256,
    }];
  });
}

function outputRoot() {
  const index = process.argv.indexOf('--output-root');
  const output = index < 0 ? OUTPUT : process.argv[index + 1];
  assert(output && [OUTPUT, RECOVERY_OUTPUT].some(root => resolve(root) === resolve(output)),
    'D1F_OUTPUT_ROOT_DENIED');
  return output;
}

function prepareAssets(assets: Asset[], output: string) {
  const summary = JSON.parse(readFileSync(join(OUTPUT, 'profiles/summary.json'), 'utf8')) as {
    gaps: { file: string; family: string; code: string }[];
  };
  assert(summary.gaps.every(gap => gap.code === 'D1F_T1_MASKED_SAMPLE_LIMIT_UNOWNED'));
  const skipped = new Set(summary.gaps.map(gap => gap.file));
  assert.equal(skipped.size, 3, 'D1F_RECORDED_GAPS_CHANGED');
  assert(summary.gaps.every(gap => assets.some(asset => asset.id === gap.file && asset.family === gap.family)));
  // Prepare every table first: schema failures now surface, never silently become masking gaps.
  const all = assets.map(asset => ({ asset, prepared: prepareTable(profileAsset(asset), prefixTable(asset)) }));
  const recovery = resolve(output) === resolve(RECOVERY_OUTPUT);
  // Historical --check still reproduces all 198 recorded profiles; the recovered set is a separate product.
  const ready = all.filter(row => skipped.has(row.asset.id) === recovery);
  return { ready, recoveredFiles: summary.gaps.map(gap => gap.file), allTablesProfiled: all.length === assets.length };
}

function writeProducts(output: string, profiles: PreparedColumn[], links: unknown[], dictionaries: unknown[],
  prepared: ReturnType<typeof prepareTable>[], summary: unknown) {
  assert.equal(resolve(output), resolve(RECOVERY_OUTPUT), 'D1F_HISTORICAL_PRODUCTS_READ_ONLY');
  saveNew(join(output, 'profiles.jsonl'), profiles, true);
  saveNew(join(output, 'profiles/profiles.jsonl'), profiles, true);
  saveNew(join(output, 'profile-links.jsonl'), links, true);
  saveNew(join(output, 'dictionary.jsonl'), dictionaries, true);
  saveNew(join(output, 'verifier/inventory.json'), prepared.map(table => table.inventory));
  saveNew(join(output, 'profiles/summary.json'), summary);
}

function checkProducts(output: string, profiles: PreparedColumn[], links: unknown[], dictionaries: unknown[],
  prepared: ReturnType<typeof prepareTable>[]) {
  const readRows = (path: string) => readFileSync(join(output, path), 'utf8').trim().split(/\r?\n/).map(line =>
    JSON.parse(line) as unknown);
  assert.deepEqual(readRows('profiles.jsonl'), profiles, 'D1F_RECORDED_PROFILES_CHANGED');
  const profileBytes = profiles.map(profile => JSON.stringify(profile)).join('\n') + '\n';
  assert.equal(readFileSync(join(output, 'profiles.jsonl'), 'utf8'), profileBytes, 'D1F_PROFILE_BYTES_CHANGED');
  assert.deepEqual(readRows('profiles/profiles.jsonl'), profiles, 'D1F_RECORDED_PROFILE_COPY_CHANGED');
  assert.deepEqual(readRows('profile-links.jsonl'), links, 'D1F_RECORDED_LINKS_CHANGED');
  assert.deepEqual(readRows('dictionary.jsonl'), dictionaries, 'D1F_RECORDED_DICTIONARY_ROWS_CHANGED');
  const inventory = JSON.parse(readFileSync(join(output, 'verifier/inventory.json'), 'utf8')) as unknown;
  assert.deepEqual(inventory, prepared.map(table => table.inventory), 'D1F_RECORDED_INVENTORY_CHANGED');
}

function productLinks(prepared: ReturnType<typeof prepareTable>[]) {
  return prepared.flatMap(table => table.profiles.map((column, index) => ({
    profileId: column.profileId, profileHash: columnProfileHash(table.inventory.profile),
    sourceField: table.inventory.profile.columns[index].name, family: column.family, split: column.split,
    header: column.header, neighbourHeaders: column.neighbourHeaders, inferredType: column.inferredType,
    declaredUnit: column.declaredUnit, valueShapes: column.valueShapes,
    cellCount: column.cellCount, emptyCount: column.emptyCount,
  })));
}

function familyCounts(assets: Asset[], profiles: PreparedColumn[], dictionaries: ReturnType<typeof dictionaryRows>) {
  return [...new Set(assets.map(asset => asset.family))].map(family => {
    const columns = profiles.filter(profile => profile.family === family);
    const samples = columns.flatMap(profile => profile.maskedSamples);
    return {
      family, geography: assets.find(asset => asset.family === family)!.geography,
      files: assets.filter(asset => asset.family === family).length, columns: columns.length,
      documentedColumns: dictionaries.filter(row => row.family === family).length,
      shortenedSamples: samples.filter(sample => sample.endsWith('[…]')).length,
      identityStyleSamples: samples.filter(sample => /\[(?:Aadhaar|PAN|phone):/u.test(sample)).length,
    };
  });
}

function main() {
  const output = outputRoot();
  const allAssets = admittedAssets();
  const { ready, recoveredFiles, allTablesProfiled } = prepareAssets(allAssets, output);
  const assets = ready.map(row => row.asset);
  const prepared = ready.map(row => row.prepared);
  const profiles = prepared.flatMap(table => table.profiles);
  assert.equal(new Set(profiles.map(profile => profile.profileId)).size, profiles.length);
  const dictionaries = ready.flatMap(row => dictionaryRows(row.asset, row.prepared.profiles));
  const links = productLinks(prepared);
  const summary = {
    manifestSha256: digest(MANIFEST), files: assets.length, families: new Set(assets.map(asset => asset.family)).size,
    profiledFiles: ready.length, allTablesProfiled, gaps: [], recoveredFiles,
    checkedTables: allAssets.length,
    productScope: resolve(output) === resolve(OUTPUT) ? 'immutable_d1f_products' : 'recovered_d1f_gaps',
    columns: profiles.length, documentedColumns: dictionaries.length,
    perFamily: familyCounts(assets, profiles, dictionaries),
    dictionaryPolicy: 'Verbatim issuer text only; sourceField is the existing positional alias, linked by profileId.',
    profilePolicy: 'T1 preparation; post-mask shortening only when expanded; definitions emitted separately.',
    heldOutFilesOpened: false, teacherCalls: 0, providerCalls: 0, labelsProduced: 0,
    profilesRowsSha256: stableHash(profiles), dictionaryRowsSha256: stableHash(dictionaries),
  };
  assets.forEach(asset => checkedPin(asset.original));
  if (process.argv.includes('--check')) {
    checkProducts(output, profiles, links, dictionaries, prepared);
    console.log(JSON.stringify(summary));
    return;
  }
  writeProducts(output, profiles, links, dictionaries, prepared, summary);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}

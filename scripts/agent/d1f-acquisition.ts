import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { decodeColumnText, readColumnCsv } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { columnProfileHash } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { prepareTable, saveNew, type PreparedColumn } from './t1-profiles';
import { developmentManifest, digest, stableHash, type SourceAsset, type SourceTable } from './t1-sources';

const MANIFEST = 'fixtures/usp/D8-open-property-foreign/manifest.json';
const OUTPUT = 'E:/BhuAayam-data/task-data/d1f';
const DATA_ROOT = 'E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f';
type Pin = SourceAsset['original'];
type Asset = SourceAsset & {
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

function checkedPin(pin: Pin) {
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
  const { heldOut, allFamilies } = developmentManifest(); // Public alias summary only; no evaluator material is opened.
  const families = new Set(manifest.families.filter(row => row.split === 'dev').map(row => row.id));
  for (const asset of manifest.assets) {
    assert(asset.split === 'dev' && families.has(asset.family));
    assert(!heldOut.has(asset.family) && !allFamilies.has(asset.family), 'D1F_FAMILY_BOUNDARY_CHANGED');
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

function prefixTable(asset: Asset): SourceTable {
  assert(asset.profileInput.bytes <= 16 * 1024 * 1024 && asset.profileInput.rows <= 2000);
  const parsed = readColumnCsv(decodeColumnText(readFileSync(asset.profileInput.externalPath)));
  assert.equal(parsed.rows.length, asset.profileInput.rows);
  assert(parsed.headers.length <= 256 && parsed.rows.every(row => row.length === parsed.headers.length));
  return {
    name: 'csv', headers: parsed.headers, rows: parsed.rows, headerRows: [1],
    headerLocators: parsed.headers.map((_, index) => [`record 1/${index + 1}`]),
  };
}

function profileAsset(asset: Asset): SourceAsset {
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

function isMaskLimit(error: unknown) {
  if (!(error instanceof Error) || error.name !== 'ZodError' || !('issues' in error)) return false;
  const issues = error.issues as { code: string; maximum?: number; path: unknown[] }[];
  return Array.isArray(issues) && issues.length > 0 && issues.every(issue => issue.code === 'too_big' &&
    issue.maximum === 256 && issue.path.includes('maskedSamples'));
}

function prepareAssets(assets: Asset[]) {
  const ready: { asset: Asset; prepared: ReturnType<typeof prepareTable> }[] = [];
  const gaps: { file: string; family: string; code: string }[] = [];
  for (const asset of assets) {
    try {
      ready.push({ asset, prepared: prepareTable(profileAsset(asset), prefixTable(asset)) });
    } catch (error) {
      if (!isMaskLimit(error)) throw error;
      gaps.push({ file: asset.id, family: asset.family, code: 'D1F_T1_MASKED_SAMPLE_LIMIT_UNOWNED' });
    }
  }
  return { ready, gaps };
}

function writeProducts(profiles: PreparedColumn[], links: unknown[], dictionaries: unknown[],
  prepared: ReturnType<typeof prepareTable>[], summary: unknown) {
  saveNew(join(OUTPUT, 'profiles.jsonl'), profiles, true);
  saveNew(join(OUTPUT, 'profiles/profiles.jsonl'), profiles, true);
  saveNew(join(OUTPUT, 'profile-links.jsonl'), links, true);
  saveNew(join(OUTPUT, 'dictionary.jsonl'), dictionaries, true);
  saveNew(join(OUTPUT, 'verifier/inventory.json'), prepared.map(table => table.inventory));
  saveNew(join(OUTPUT, 'profiles/summary.json'), summary);
}

function main() {
  const assets = admittedAssets();
  const { ready, gaps } = prepareAssets(assets);
  const prepared = ready.map(row => row.prepared);
  const profiles = prepared.flatMap(table => table.profiles);
  assert.equal(new Set(profiles.map(profile => profile.profileId)).size, profiles.length);
  const dictionaries = ready.flatMap(row => dictionaryRows(row.asset, row.prepared.profiles));
  const links = prepared.flatMap(table => table.profiles.map((column, index) => ({
    profileId: column.profileId, profileHash: columnProfileHash(table.inventory.profile),
    sourceField: table.inventory.profile.columns[index].name, family: column.family, split: column.split,
    header: column.header, neighbourHeaders: column.neighbourHeaders, inferredType: column.inferredType,
    declaredUnit: column.declaredUnit, valueShapes: column.valueShapes,
    cellCount: column.cellCount, emptyCount: column.emptyCount,
  })));
  const summary = {
    manifestSha256: digest(MANIFEST), files: assets.length, families: new Set(assets.map(asset => asset.family)).size,
    profiledFiles: ready.length, allTablesProfiled: gaps.length === 0, gaps,
    columns: profiles.length, documentedColumns: dictionaries.length,
    perFamily: [...new Set(assets.map(asset => asset.family))].map(family => ({
      family, geography: assets.find(asset => asset.family === family)!.geography,
      files: assets.filter(asset => asset.family === family).length,
      columns: profiles.filter(profile => profile.family === family).length,
      documentedColumns: dictionaries.filter(row => row.family === family).length,
    })),
    dictionaryPolicy: 'Verbatim issuer text only; sourceField is the existing positional alias, linked by profileId.',
    profilePolicy: 'Unchanged T1 prepareTable/masking on all prefix columns; definitions are emitted separately.',
    heldOutFilesOpened: false, teacherCalls: 0, providerCalls: 0, labelsProduced: 0,
    profilesRowsSha256: stableHash(profiles), dictionaryRowsSha256: stableHash(dictionaries),
  };
  assets.forEach(asset => checkedPin(asset.original));
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify(summary));
    return;
  }
  writeProducts(profiles, links, dictionaries, prepared, summary);
  console.log(JSON.stringify(summary));
}

main();

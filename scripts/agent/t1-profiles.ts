import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { layoutFingerprint } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import { ColumnProfileDocumentSchema, type ColumnProfileDocument } from '../../packages/contracts/src/index';
import { assertTeacherOutputOutsideGit } from '../../packages/server/src/modules/model-gateway/recordings';
import {
  developmentManifest, preparationAssets, sourceTables, digest, stableHash, T1_ROOT, D8_MANIFEST, POOL_MANIFEST,
  developmentProfileAssets, T1B_ROOT, T1B_FAMILIES, D1C_DERIVATIVES,
  type SourceAsset, type SourceTable,
} from './t1-sources';

export type PreparedColumn = {
  profileId: string;
  family: string;
  split: 'dev' | 'pool';
  file: string;
  sheet: string;
  column: number;
  header: string;
  neighbourHeaders: string[];
  inferredType: string;
  declaredUnit: string | null;
  valueShapes: unknown;
  maskedSamples: string[];
  cellCount: number;
  emptyCount: number;
};
export type TableInventory = {
  asset: SourceAsset;
  sheet: string;
  profileIds: string[];
  profile: ColumnProfileDocument;
};

export function saveNew(path: string, value: unknown, jsonl = false) {
  assertTeacherOutputOutsideGit(path);
  mkdirSync(dirname(path), { recursive: true });
  const text = jsonl
    ? (value as unknown[]).map(line => JSON.stringify(line)).join('\n')
    : JSON.stringify(value, null, 2);
  writeFileSync(path, text + '\n', { flag: 'wx', mode: 0o600 });
}

function prepareColumn(asset: SourceAsset, table: SourceTable, column: number) {
  const header = table.headers[column];
  const name = header.trim() || `column_${column + 1}`;
  const rows = table.rows.map(row => ({ [name]: row[column] }));
  const profile = profileColumns(rows, [{ name }], 'tabular').columns[0];
  const emptyCount = table.rows.filter(row => row[column] === null || row[column] === undefined ||
    (typeof row[column] === 'string' && !(row[column] as string).trim())).length;
  const neighbours = table.headers.slice(Math.max(0, column - 2), column)
    .concat(table.headers.slice(column + 1, column + 3));
  const prepared: PreparedColumn = {
    profileId: stableHash([asset.family, asset.id, table.name, column + 1]),
    family: asset.family, split: asset.split, file: asset.id, sheet: table.name, column: column + 1, header,
    neighbourHeaders: neighbours, inferredType: profile.inferredType, declaredUnit: profile.declaredUnit ?? null,
    valueShapes: profile.valueShapes, maskedSamples: profile.maskedSamples, cellCount: table.rows.length, emptyCount,
  };
  // Positional aliases retain duplicate/blank headers without inventing meanings or collapsing columns.
  return { prepared, profile: { ...profile, name: `column_${column + 1}` } };
}

function publisherMeaning(asset: SourceAsset, table: SourceTable, column: number, profileId: string) {
  const documented = asset.columns?.find(entry => entry.name === table.headers[column]);
  if (documented?.publisherMeaning && documented.evaluationEligible !== false) {
    return { profileId, publisherMeaning: documented.publisherMeaning, dictionaryCitation: {
      url: documented.documentationUrl, locator: documented.documentationLocator,
      sha256: documented.documentationSha256 ?? asset.original.sha256,
      strength: documented.documentationStrength ?? 'publisher_manual',
    } };
  }
  if (!asset.dictionary || !asset.sourceSchema?.headerCellLiterals) return undefined;
  const locators = table.headerLocators[column];
  const literal = asset.sourceSchema.headerCellLiterals.filter(cell => locators.includes(cell.locator)).at(-1);
  if (!literal) return undefined;
  return { profileId, publisherMeaning: literal.literal, dictionaryCitation: {
    url: asset.dictionary.url, locator: `Workbook ${table.name}!${literal.locator}`,
    originalSha256: asset.original.sha256, documentationSha256: asset.dictionary.sha256,
    strength: 'publisher_header_literal_only',
  } };
}

export function prepareTable(asset: SourceAsset, table: SourceTable) {
  const columns = table.headers.map((_, index) => prepareColumn(asset, table, index));
  const fields = columns.map(column => column.profile);
  const profile = ColumnProfileDocumentSchema.parse({
    version: 'column-profile/1', sourceKind: 'tabular', columns: fields,
    layoutFingerprint: layoutFingerprint(fields), sampleShortfall: fields.some(field => field.maskedSamples.length < 5),
  });
  const meanings = columns.map((column, index) => publisherMeaning(asset, table, index, column.prepared.profileId))
    .filter(meaning => meaning !== undefined);
  const inventory: TableInventory = {
    asset, sheet: table.name, profileIds: columns.map(column => column.prepared.profileId), profile,
  };
  return { profiles: columns.map(column => column.prepared), meanings, inventory };
}

export function checkBoundary(profiles: PreparedColumn[]) {
  const { heldOut, development, allFamilies } = developmentManifest();
  for (const profile of profiles) {
    assert(['dev', 'pool'].includes(profile.split));
    assert(!heldOut.has(profile.family));
    assert(profile.split === 'dev' ? development.has(profile.family) : !allFamilies.has(profile.family));
    if (profile.family.startsWith('opf-')) assert(profile.split === 'dev' && development.has(profile.family));
    assert.equal(profile.profileId, stableHash([profile.family, profile.file, profile.sheet, profile.column]));
    assert(profile.maskedSamples.length <= 10 && profile.neighbourHeaders.length <= 4);
    assert(profile.emptyCount >= 0 && profile.emptyCount <= profile.cellCount);
  }
  const serialized = JSON.stringify(profiles);
  assert(![...heldOut].some(id => serialized.includes(id)), 'No blind family ID may appear anywhere in profiles.');
  assert.equal(new Set(profiles.map(profile => profile.profileId)).size, profiles.length);
  return {
    heldOutMatches: 0, heldOutFamiliesExcluded: heldOut.size, heldOutIdSetHash: stableHash([...heldOut].sort()),
  };
}

function splitCounts(profiles: PreparedColumn[], split: 'dev' | 'pool') {
  const selected = profiles.filter(profile => profile.split === split);
  return {
    families: new Set(selected.map(profile => profile.family)).size,
    files: new Set(selected.map(profile => `${profile.family}/${profile.file}`)).size,
    columns: selected.length,
  };
}

function collectProfiles(assets: SourceAsset[]) {
  const profiles: PreparedColumn[] = [];
  const meanings: unknown[] = [];
  const inventory: TableInventory[] = [];
  const gaps: { family: string; file: string; code: string }[] = [];
  for (const asset of assets) {
    try {
      // Commit one asset's derivatives only when every selected table succeeded.
      const prepared = sourceTables(asset).map(table => prepareTable(asset, table));
      profiles.push(...prepared.flatMap(table => table.profiles));
      meanings.push(...prepared.flatMap(table => table.meanings));
      inventory.push(...prepared.map(table => table.inventory));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'T1_READ_FAILED';
      gaps.push({ family: asset.family, file: asset.id, code });
    }
  }
  return { profiles, meanings, inventory, gaps };
}

function runPreparation(output: string, scanOnly = false) {
  const manifest = developmentManifest();
  const assets = preparationAssets();
  const { profiles, meanings, inventory, gaps } = collectProfiles(assets.assets);
  const boundary = checkBoundary(profiles);
  const summary = {
    splits: { dev: splitCounts(profiles, 'dev'), pool: splitCounts(profiles, 'pool') },
    families: new Set(profiles.map(profile => profile.family)).size,
    files: new Set(profiles.map(profile => `${profile.family}/${profile.file}`)).size, tables: inventory.length,
    columns: profiles.length, publisherMeanings: meanings.length, gaps,
  };
  if (scanOnly) return { summary, boundary };
  assert.equal(summary.splits.dev.files, manifest.assets.length, 'All development files must be profiled.');
  assert.equal(summary.splits.dev.families, manifest.development.size);
  assert(summary.splits.pool.families >= 5, 'At least five distinct new families required.');
  saveNew(join(output, 'profiles/profiles.jsonl'), profiles, true);
  saveNew(join(output, 'profiles/summary.json'), summary);
  saveNew(join(output, 'publisher/publisher-meaning.jsonl'), meanings, true);
  saveNew(join(output, 'verifier/inventory.json'), inventory);
  saveNew(join(output, 'verifier/acquisition-gaps.json'), assets.gaps);
  return { summary, boundary };
}

function developmentFamilyCounts(inventory: TableInventory[], profiles: PreparedColumn[]) {
  return T1B_FAMILIES.map(family => {
    const tables = inventory.filter(table => table.asset.family === family);
    const columns = profiles.filter(profile => profile.family === family);
    const layouts = tables.map(table => stableHash(columns.filter(column =>
      column.file === table.asset.id && column.sheet === table.sheet).map(column => column.header)));
    return {
      family, files: new Set(tables.map(table => table.asset.id)).size, tables: tables.length,
      columns: columns.length, distinctLayouts: new Set(layouts).size,
      declaredUnitColumns: columns.filter(column => column.declaredUnit !== null).length,
      tableLayouts: tables.map((table, index) => ({
        file: table.asset.id, sheet: table.sheet, headerLayoutFingerprint: layouts[index],
        profileLayoutFingerprint: table.profile.layoutFingerprint,
      })),
    };
  });
}

export function runDevelopmentPreparation(output = T1B_ROOT) {
  assert.equal(resolve(output), resolve(T1B_ROOT), 'T1B_OUTPUT_DIRECTORY_DENIED');
  const assets = developmentProfileAssets();
  const prepared = assets.flatMap(asset => sourceTables(asset).map(table => prepareTable(asset, table)));
  const profiles = prepared.flatMap(table => table.profiles);
  const inventory = prepared.map(table => table.inventory);
  const boundary = checkBoundary(profiles);
  assert(profiles.every(profile => profile.split === 'dev' && T1B_FAMILIES.includes(profile.family)));
  assert.equal(new Set(profiles.map(profile => profile.file)).size, assets.length, 'T1B_ASSET_UNPROFILED');
  const summary = {
    task: 'T1b-prep', families: T1B_FAMILIES.length, files: assets.length, tables: inventory.length,
    columns: profiles.length, perFamily: developmentFamilyCounts(inventory, profiles), boundary,
    manifestSha256: digest(D8_MANIFEST), derivativeIndexSha256: digest(D1C_DERIVATIVES),
    sources: assets.map(asset => ({
      file: asset.id, family: asset.family, split: asset.split, source: asset.original,
      ...(asset.derivedFrom ? { derivedFrom: asset.derivedFrom } : {}),
    })),
    policy: 'Derivative profile rows name the CSV derivative; derivedFrom retains the native original and locator.',
    layoutPolicy: 'Distinct layouts hash ordered literal headers; profile fingerprints also include inferred types.',
    compoundCellPolicy: 'Recorded JSONL prefix verifies native compound types; T1 masks restored objects as [object].',
    publisherMeanings: 0, heldOutFileOpened: false, teacherCalls: 0, labelsProduced: 0,
  };
  saveNew(join(output, 'profiles/profiles.jsonl'), profiles, true);
  saveNew(join(output, 'profiles/summary.json'), summary);
  saveNew(join(output, 'verifier/inventory.json'), inventory);
  return summary;
}

function writeEvidence(output: string, result: ReturnType<typeof runPreparation>) {
  const evidence = {
    task: 'T1-prep', gate: 'GF-AGENT',
    codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runAt: new Date().toISOString(), checkedWorkingTree: true, ...result,
    manifestSha256: digest(D8_MANIFEST), poolManifestSha256: digest(POOL_MANIFEST),
    profilesSha256: digest(join(output, 'profiles/profiles.jsonl')),
    publisherSha256: digest(join(output, 'publisher/publisher-meaning.jsonl')),
    summarySha256: digest(join(output, 'profiles/summary.json')),
    inventorySha256: digest(join(output, 'verifier/inventory.json')),
    teacherInput: join(output, 'profiles/profiles.jsonl'), publisherInputSeparated: true,
    sourceReadPolicy: 'Authorize exact dev/pool manifest entry before stat, hashing or native-reader dispatch.',
    heldOutFileOpened: false, teacherCalls: 0, labelsProduced: 0, registryWrites: 0,
    policy: 'Public unlabelled development only; positional aliases are not property identifiers.',
  };
  mkdirSync('docs/evidence/gf-agent/t1', { recursive: true });
  writeFileSync('docs/evidence/gf-agent/t1/prep.json', JSON.stringify(evidence, null, 2) + '\n');
}

function main(args: string[]) {
  if (args[0] === '--t1b') {
    console.log(JSON.stringify(runDevelopmentPreparation(args[1] ?? T1B_ROOT)));
    return;
  }
  if (args[0] === '--check') {
    const profiles = readFileSync(args[1] ?? join(T1_ROOT, 'profiles/profiles.jsonl'), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as PreparedColumn);
    console.log(JSON.stringify(checkBoundary(profiles)));
    return;
  }
  if (args[0] === '--scan') {
    console.log(JSON.stringify(runPreparation(T1_ROOT, true)));
    return;
  }
  const output = args[0] ?? T1_ROOT;
  const result = runPreparation(output);
  writeEvidence(output, result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}

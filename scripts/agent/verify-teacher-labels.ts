import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MappingV2FieldSchema, ColumnProfileDocumentSchema, type MappingPlanV2,
} from '../../packages/contracts/src/index';
import { DocumentArchiveInspectionSchema } from '../../packages/contracts/src/usp/document-ingestion';
import {
  ingestTeacherLabels as ingestCanonicalLabels, DEVELOPMENT_TEACHER_METHOD, type TeacherProfileEntry,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import { columnProfileHash } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { assertTeacherOutputOutsideGit } from '../../packages/server/src/modules/model-gateway/recordings';
import { checkBoundary, prepareTable, saveNew, type PreparedColumn, type TableInventory } from './t1-profiles';
import { developmentManifest, sourceTables, stableHash, T1_ROOT, type SourceAsset } from './t1-sources';

export type LinkedColumn = {
  column: PreparedColumn;
  table: TableInventory;
  index: number;
  tableColumns?: PreparedColumn[];
};
export type InputLabelLine = { inputLine: number; value: unknown };
type LabelGroup = {
  profileHash: string;
  entry?: LinkedColumn;
  inputLines: number[];
  fields: Map<string, MappingPlanV2['fields'][number]>;
  seen: Set<string>;
  codes: string[];
};

function readJsonLines(path: string): InputLabelLine[] {
  if (/(?:^|[\\/])\.env(?:\.|$)/i.test(path)) throw new Error('TEACHER_LABEL_PATH_FORBIDDEN');
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error('TEACHER_LABEL_LIMIT');
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [{ inputLine: index + 1, value: JSON.parse(line) as unknown }];
    } catch {
      return [{ inputLine: index + 1, value: null }];
    }
  });
}

function linkedProfiles(profilesPath: string): Map<string, LinkedColumn> {
  const profiles = readJsonLines(profilesPath).map(line => line.value) as PreparedColumn[];
  checkBoundary(profiles);
  const inventoryPath = join(dirname(profilesPath), '../verifier/inventory.json');
  const tables = JSON.parse(readFileSync(inventoryPath, 'utf8')) as TableInventory[];
  const linked = new Map<string, LinkedColumn>();
  for (const table of tables) {
    ColumnProfileDocumentSchema.parse(table.profile);
    const tableColumns = table.profileIds.map(id => profiles.find(profile => profile.profileId === id));
    assert(tableColumns.every(column => column !== undefined), 'T1_PROFILE_LINK_INVALID');
    table.profileIds.forEach((id, index) => {
      const column = profiles.find(profile => profile.profileId === id);
      assert(column && !linked.has(id), 'T1_PROFILE_LINK_INVALID');
      assert.equal(column.family, table.asset.family);
      assert.equal(column.file, table.asset.id);
      assert.equal(column.sheet, table.sheet);
      assert.equal(column.column, index + 1);
      linked.set(id, { column, table, index, tableColumns: tableColumns as PreparedColumn[] });
    });
  }
  assert.equal(linked.size, profiles.length);
  return linked;
}

function sourceRef(entry: LinkedColumn) {
  return `${entry.table.asset.original.externalPath}#sheet=${encodeURIComponent(entry.table.sheet)}`;
}

type SourceReference = { horizontalCrs?: string | null };

/** The native GeoJSON reader's inspection contract owns the identifier; unknown literals never get a default. */
export function sourceCrsFromReference(reference?: SourceReference): string | undefined {
  const recorded = new Map([
    ['GeoJSON WGS84 longitude/latitude', DocumentArchiveInspectionSchema.shape.inspection.shape.sourceCrs.value],
  ]);
  return reference?.horizontalCrs ? recorded.get(reference.horizontalCrs) : undefined;
}

function recordedSourceCrs(asset: SourceAsset): string | undefined {
  const id = asset.derivedFrom?.assetId ?? asset.id;
  const original = asset.derivedFrom?.original ?? asset.original;
  const source = developmentManifest().assets.find(row => row.family === asset.family && row.id === id);
  if (!source || stableHash(source.original) !== stableHash(original)) return undefined;
  return sourceCrsFromReference((source as SourceAsset & { reference?: SourceReference }).reference);
}

function materialize(entry: LinkedColumn): TeacherProfileEntry {
  const table = sourceTables(entry.table.asset).find(table => table.name === entry.table.sheet);
  assert(table, 'T1_PROFILE_SHEET_MISSING');
  const prepared = prepareTable(entry.table.asset, table);
  assert.equal(stableHash(prepared.inventory), stableHash(entry.table), 'T1_PROFILE_INVENTORY_CHANGED');
  for (const expected of entry.tableColumns ?? [entry.column]) {
    const actual = prepared.profiles.find(column => column.profileId === expected.profileId);
    assert(actual, 'T1_PROFILE_CHANGED');
    assert.equal(stableHash(actual), stableHash(expected), 'T1_PROFILE_CHANGED');
  }
  const rows = table.rows.map(row => Object.fromEntries(entry.table.profile.columns.map((column, index) =>
    [column.name, row[index]])));
  return {
    profile: entry.table.profile, rows, sourceRef: sourceRef(entry), sourceCrs: recordedSourceCrs(entry.table.asset),
    dataPolicy: { dataClass: 'public', split: entry.column.split === 'dev' ? 'development' : 'unlabelled' },
  };
}

function labelRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

function addField(group: LabelGroup, label: Record<string, unknown>, entry: LinkedColumn) {
  const id = entry.column.profileId;
  if (group.seen.has(id)) group.codes.push('TEACHER_LABEL_DUPLICATE');
  group.seen.add(id);
  const rawField = labelRecord(label.field);
  if (Object.keys(label).some(key => key !== 'profileId' && key !== 'field') || !rawField ||
      'sourceField' in rawField) {
    group.codes.push('TEACHER_LABEL_SCHEMA_INVALID');
    return;
  }
  const sourceField = entry.table.profile.columns[entry.index].name;
  const field = MappingV2FieldSchema.safeParse({ ...rawField, sourceField });
  if (!field.success) group.codes.push('TEACHER_LABEL_SCHEMA_INVALID');
  else if (!group.fields.has(sourceField)) group.fields.set(sourceField, field.data);
}

/** Group by full table profile hash; source order is preserved independently of input label order. */
export function groupTeacherLabels(lines: InputLabelLine[], linked: ReadonlyMap<string, LinkedColumn>) {
  const groups = new Map<string, LabelGroup>();
  for (const line of lines) {
    const label = labelRecord(line.value);
    const entry = typeof label?.profileId === 'string' ? linked.get(label.profileId) : undefined;
    const profileHash = entry ? columnProfileHash(entry.table.profile) : `invalid-line-${line.inputLine}`;
    if (!groups.has(profileHash)) {
      groups.set(profileHash, { profileHash, entry, inputLines: [], fields: new Map(), seen: new Set(), codes: [] });
    }
    const group = groups.get(profileHash)!;
    group.inputLines.push(line.inputLine);
    if (!entry || !label) group.codes.push('TEACHER_LABEL_PROFILE_DENIED');
    else {
      assert.equal(sourceRef(group.entry!), sourceRef(entry), 'T1_PROFILE_HASH_AMBIGUOUS');
      addField(group, label, entry);
    }
  }
  return [...groups.values()];
}

function normalizedPlan(group: LabelGroup) {
  if (group.codes.length || !group.entry) return null;
  const profile = group.entry.table.profile;
  const fields = profile.columns.flatMap(column => {
    const field = group.fields.get(column.name);
    return field ? [field] : [];
  });
  if (!fields.length) group.codes.push('MAPPING_SOURCE_FIELD_UNMAPPED');
  return { profileHash: group.profileHash, method: DEVELOPMENT_TEACHER_METHOD, plan: {
    version: 'mapping-plan/2', sourceKind: profile.sourceKind, layoutFingerprint: profile.layoutFingerprint,
    method: DEVELOPMENT_TEACHER_METHOD, fields,
  } };
}

export async function verifyLabelGroups(
  groups: LabelGroup[], output: string, load: (entry: LinkedColumn) => TeacherProfileEntry = materialize,
) {
  const inventory = new Map<string, TeacherProfileEntry>();
  const normalized = groups.map(group => {
    const plan = normalizedPlan(group);
    if (plan && group.entry) inventory.set(group.profileHash, load(group.entry));
    return plan;
  });
  const normalizedPath = join(output, 'normalized-labels.jsonl');
  saveNew(normalizedPath, normalized, true);
  const report = await ingestCanonicalLabels(normalizedPath, inventory, join(output, 'pseudo-labels.jsonl'));
  const labels = report.labels.map(label => ({ ...label, inputLines: groups[label.line - 1].inputLines }));
  const rejections = report.rejections.map(rejection => {
    const group = groups[rejection.line - 1];
    return { ...rejection, codes: group.codes.length ? [...new Set(group.codes)] : rejection.codes,
      inputLines: group.inputLines };
  });
  return { ...report, labels, rejections };
}

function saveProfileLinks(linked: Map<string, LinkedColumn>, output: string) {
  saveNew(join(output, 'profile-links.jsonl'), [...linked].map(([profileId, entry]) => ({
    profileId, profileHash: columnProfileHash(entry.table.profile),
    sourceField: entry.table.profile.columns[entry.index].name, family: entry.column.family,
    split: entry.column.split, header: entry.column.header, neighbourHeaders: entry.column.neighbourHeaders,
    inferredType: entry.column.inferredType, declaredUnit: entry.column.declaredUnit,
    valueShapes: entry.column.valueShapes, cellCount: entry.column.cellCount, emptyCount: entry.column.emptyCount,
  })), true);
}

/** Resolve stable column IDs and verify complete table plans through the unchanged canonical A2 verifier. */
export async function ingestTeacherLabels(inputPath: string, profilesPath: string, outputDirectory?: string) {
  const output = outputDirectory ?? join(T1_ROOT, `verifier/labels-${Date.now()}`);
  const location = relative(resolve(T1_ROOT), resolve(output));
  assert(location && !location.startsWith('..') && !isAbsolute(location), 'T1_OUTPUT_DIRECTORY_DENIED');
  assertTeacherOutputOutsideGit(join(output, 'normalized-labels.jsonl'));
  const linked = linkedProfiles(profilesPath);
  const groups = groupTeacherLabels(readJsonLines(inputPath), linked);
  const report = await verifyLabelGroups(groups, output);
  saveProfileLinks(linked, output);
  saveNew(join(output, 'report.json'), {
    ...report, inputPath, profilesPath, method: DEVELOPMENT_TEACHER_METHOD,
    qualification: 'pseudo_label; verified is not correctness or officer approval',
  });
  return { ...report, outputDirectory: output, linkedProfiles: linked.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, profilesPath, output] = process.argv.slice(2);
  if (!inputPath || !profilesPath) {
    throw new Error('Usage: verify-teacher-labels.ts <labels.jsonl> <profiles.jsonl> [new-output-directory]');
  }
  ingestTeacherLabels(inputPath, profilesPath, output).then(report => console.log(JSON.stringify(report)));
}

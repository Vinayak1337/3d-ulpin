import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MappingV2FieldSchema, ColumnProfileDocumentSchema } from '../../packages/contracts/src/index';
import {
  ingestTeacherLabels as ingestCanonicalLabels, DEVELOPMENT_TEACHER_METHOD, type TeacherProfileEntry,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import { columnProfileHash } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { assertTeacherOutputOutsideGit } from '../../packages/server/src/modules/model-gateway/recordings';
import { checkBoundary, prepareTable, saveNew, type PreparedColumn, type TableInventory } from './t1-profiles';
import { sourceTables, stableHash, T1_ROOT } from './t1-sources';

type LinkedColumn = { column: PreparedColumn; table: TableInventory; index: number };

function readJsonLines(path: string): unknown[] {
  if (/(?:^|[\\/])\.env(?:\.|$)/i.test(path)) throw new Error('TEACHER_LABEL_PATH_FORBIDDEN');
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error('TEACHER_LABEL_LIMIT');
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      return null; // The canonical verifier reports this line as rejected, never silently skips it.
    }
  });
}

function linkedProfiles(profilesPath: string): Map<string, LinkedColumn> {
  const profiles = readJsonLines(profilesPath) as PreparedColumn[];
  checkBoundary(profiles);
  const inventoryPath = join(dirname(profilesPath), '../verifier/inventory.json');
  const tables = JSON.parse(readFileSync(inventoryPath, 'utf8')) as TableInventory[];
  const linked = new Map<string, LinkedColumn>();
  for (const table of tables) {
    ColumnProfileDocumentSchema.parse(table.profile);
    table.profileIds.forEach((id, index) => {
      const column = profiles.find(profile => profile.profileId === id);
      assert(column && !linked.has(id), 'T1_PROFILE_LINK_INVALID');
      assert.equal(column.family, table.asset.family);
      assert.equal(column.file, table.asset.id);
      assert.equal(column.sheet, table.sheet);
      assert.equal(column.column, index + 1);
      linked.set(id, { column, table, index });
    });
  }
  assert.equal(linked.size, profiles.length);
  return linked;
}

function materialize(entry: LinkedColumn): TeacherProfileEntry {
  const table = sourceTables(entry.table.asset).find(table => table.name === entry.table.sheet);
  assert(table, 'T1_PROFILE_SHEET_MISSING');
  const prepared = prepareTable(entry.table.asset, table);
  assert.equal(stableHash(prepared.inventory), stableHash(entry.table), 'T1_PROFILE_INVENTORY_CHANGED');
  assert.equal(stableHash(prepared.profiles[entry.index]), stableHash(entry.column), 'T1_PROFILE_CHANGED');
  const rows = table.rows.map(row => Object.fromEntries(entry.table.profile.columns.map((column, index) =>
    [column.name, row[index]])));
  return {
    profile: entry.table.profile, rows, sourceRef: entry.table.asset.original.externalPath,
    dataPolicy: { dataClass: 'public', split: entry.column.split === 'dev' ? 'development' : 'unlabelled' },
  };
}

function normalizeLabel(raw: unknown, linked: Map<string, LinkedColumn>, inventory: Map<string, TeacherProfileEntry>) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const label = raw as Record<string, unknown>;
  if (Object.keys(label).some(key => key !== 'profileId' && key !== 'field')) return null;
  if (typeof label.profileId !== 'string' || !label.field || typeof label.field !== 'object') return null;
  const entry = linked.get(label.profileId);
  if (!entry) return null;
  const sourceField = entry.table.profile.columns[entry.index].name;
  const field = MappingV2FieldSchema.safeParse({ ...label.field, sourceField });
  if (!field.success || 'sourceField' in label.field) return null;
  const profileHash = columnProfileHash(entry.table.profile);
  if (!inventory.has(profileHash)) inventory.set(profileHash, materialize(entry));
  // Duplicate content from a different source must not silently reuse another file's raw rows.
  assert.equal(inventory.get(profileHash)!.sourceRef, entry.table.asset.original.externalPath,
    'T1_PROFILE_HASH_AMBIGUOUS');
  return { profileHash, method: DEVELOPMENT_TEACHER_METHOD, plan: {
    version: 'mapping-plan/2', sourceKind: 'tabular', layoutFingerprint: entry.table.profile.layoutFingerprint,
    method: DEVELOPMENT_TEACHER_METHOD, fields: [field.data],
  } };
}

/** Path-based adapter: resolve stable column IDs, then reuse the existing governed A2 verifier unchanged. */
export async function ingestTeacherLabels(inputPath: string, profilesPath: string, outputDirectory?: string) {
  const output = outputDirectory ?? join(T1_ROOT, `verifier/labels-${Date.now()}`);
  const location = relative(resolve(T1_ROOT), resolve(output));
  assert(location && !location.startsWith('..') && !isAbsolute(location), 'T1_OUTPUT_DIRECTORY_DENIED');
  assertTeacherOutputOutsideGit(join(output, 'normalized-labels.jsonl'));
  const linked = linkedProfiles(profilesPath);
  const inventory = new Map<string, TeacherProfileEntry>();
  const labels = readJsonLines(inputPath);
  const normalized = labels.map(label => normalizeLabel(label, linked, inventory));
  const normalizedPath = join(output, 'normalized-labels.jsonl');
  saveNew(normalizedPath, normalized, true);
  const report = await ingestCanonicalLabels(normalizedPath, inventory, join(output, 'pseudo-labels.jsonl'));
  // Keep the source-header join beside canonical examples; A4 must not treat positional aliases as headers.
  saveNew(join(output, 'profile-links.jsonl'), [...linked].map(([profileId, entry]) => ({
    profileId, profileHash: columnProfileHash(entry.table.profile),
    sourceField: entry.table.profile.columns[entry.index].name, header: entry.column.header,
    neighbourHeaders: entry.column.neighbourHeaders,
  })), true);
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

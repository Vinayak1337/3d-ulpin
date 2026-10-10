import { readFileSync, writeFileSync } from 'node:fs';
import { profileTabularChunk } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { TABULAR_LIMITS } from '../../packages/contracts/src/usp';
import { normalizeMappingHeader } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import { preparationAssets, sourceTables, stableHash, digest } from './t1-sources';

type Label = { profileId: string; field: { target: string; operation: unknown } };
type Table = { file: string; sheet: string; headers: string[]; structure: string; typed: string[];
  labels: (string | null)[]; chunks: number };
const labelPath = 'E:/BhuAayam-data/task-data/t1/labels/teacher-labels.jsonl';
const verifiedPath = 'E:/BhuAayam-data/task-data/t1/verifier/labels-1791597780905/pseudo-labels.jsonl';
const linksPath = 'E:/BhuAayam-data/task-data/t1/verifier/labels-1791597780905/profile-links.jsonl';

function jsonl(path: string) {
  return readFileSync(path, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
}

function collect() {
  const accepted = new Set(jsonl(verifiedPath).filter(item => item.verified)
    .map(item => `${item.profileHash}/${item.columnProfile.name}`));
  const verified = new Set(jsonl(linksPath).filter(item => accepted.has(`${item.profileHash}/${item.sourceField}`))
    .map(item => item.profileId));
  const labels = new Map(jsonl(labelPath).map((item: Label) => [item.profileId, item.field]));
  const tables: Table[] = [];
  const gaps: { file: string; code: string }[] = [];
  for (const asset of preparationAssets().assets) {
    try {
      for (const table of sourceTables(asset)) {
        const width = Math.max(1, Math.min(TABULAR_LIMITS.chunkRows,
          Math.floor(TABULAR_LIMITS.columns / table.headers.length)));
        const typed: string[] = [];
        for (let offset = 0; offset < table.rows.length; offset += width) {
          typed.push(profileTabularChunk({ jobId: 'comparison', chunkIndex: offset / width,
            headers: table.headers, rows: table.rows.slice(offset, offset + width), sourceRef: 'comparison' })
            .profile.layoutFingerprint);
        }
        tables.push({ file: asset.id, sheet: table.name, headers: table.headers, chunks: typed.length, typed,
          structure: stableHash(['tabular-header/2', table.name, table.headerRows,
            table.headers.map((header, index) => normalizeMappingHeader(`${index + 1}|${header}`))]),
          labels: table.headers.map((_, index) => {
            const id = stableHash([asset.family, asset.id, table.name, index + 1]);
            return verified.has(id) && labels.has(id) ? stableHash(labels.get(id)!.target +
              JSON.stringify(labels.get(id)!.operation)) : null;
          }) });
      }
    } catch (error) {
      gaps.push({ file: asset.id, code: error instanceof Error ? error.message : 'READ_FAILED' });
    }
  }
  return { tables, gaps, verifiedColumns: verified.size };
}

function compare(tables: Table[], structural: boolean) {
  const differing: string[][] = [];
  const conflicts: string[][] = [];
  const identity = (table: Table) => structural ? [table.structure] : [...new Set(table.typed)];
  let mergedPairs = 0;
  for (let left = 0; left < tables.length; left++) {
    for (let right = left + 1; right < tables.length; right++) {
      const a = tables[left];
      const b = tables[right];
      if (a.file === b.file) continue;
      const pair = [`${a.file}/${a.sheet}`, `${b.file}/${b.sheet}`];
      if (JSON.stringify(a.headers) === JSON.stringify(b.headers) &&
          JSON.stringify(identity(a)) !== JSON.stringify(identity(b))) differing.push(pair);
      if (!identity(a).some(hash => identity(b).includes(hash))) continue;
      mergedPairs++;
      if (a.labels.some((label, index) => label !== null && b.labels[index] !== null &&
        label !== b.labels[index])) conflicts.push(pair);
    }
  }
  const fileHashes = new Map<string, Set<string>>();
  for (const table of tables) {
    if (!fileHashes.has(table.file)) fileHashes.set(table.file, new Set());
    identity(table).forEach(hash => fileHashes.get(table.file)!.add(hash));
  }
  const multiple = [...fileHashes].filter(([, hashes]) => hashes.size > 1).map(([file]) => file);
  const splitTables = tables.filter(table => new Set(identity(table)).size > 1);
  return { filesWithMultipleChunkFingerprints: multiple.length, multipleFiles: multiple,
    tablesWithMultipleChunkFingerprints: splitTables.length,
    definition: 'File counts include separately selected sheets; table counts isolate within-selection chunk drift.',
    identicalOrderedHeaderPairsDiffering: differing.length, differingPairs: differing,
    mergedPairs, conflictingVerifiedLabelPairs: conflicts.length, conflicts };
}

function main() {
  const { tables, gaps, verifiedColumns } = collect();
  const typeSensitive = compare(tables, false);
  const headerStructure = compare(tables, true);
  const result = { baseCommit: 'a4592e12', scope: 'Only public D8 development and disjoint T1 pool originals.',
    tables: tables.length, files: new Set(tables.map(table => table.file)).size, verifiedColumns,
    labelSha256: digest(labelPath), verificationSha256: digest(verifiedPath), linksSha256: digest(linksPath),
    typeSensitive, headerStructure, gaps,
    decision: headerStructure.conflictingVerifiedLabelPairs === 0 ? 'tabular-header/2' : 'source-profile-types/1',
    qualification: 'Zero observed label harm is limited to verified T1 overlap; unlabelled columns are not truth.' };
  writeFileSync('docs/evidence/gf-agent/a3d/layout-comparison.json', JSON.stringify(result) + '\n');
  console.log(JSON.stringify(result));
}

main();

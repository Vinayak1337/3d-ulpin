import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { layoutFingerprint } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import { columnProfileHash } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import {
  ingestTeacherLabels, type PseudoLabelExample, type TeacherProfileEntry,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import {
  ColumnProfileDocumentSchema, type ColumnProfileDocument, type MappingPlanV2,
} from '../../packages/contracts/src/index';
import { checkBoundary, prepareTable, saveNew, type TableInventory } from './t1-profiles';
import { developmentManifest, digest, sourceTables, stableHash } from './t1-sources';
import { readLines } from './measure-a4b';

export type Seed = {
  seedProfileId: string; round: string; family: string; split: string; target: string; header: string;
  neighbourHeaders: string[]; declaredUnit: string | null; inferredType: string;
};
export type Variant = {
  seedProfileId: string; target: string; headerVariant: string; neighbourVariants: Record<string, string>;
  style: string; labelKind: string; method: string;
};
type Link = {
  profileId: string; profileHash: string; sourceField: string; family: string; split: string; header: string;
  neighbourHeaders: string[]; inferredType: string; declaredUnit: string | null; valueShapes: unknown;
  cellCount: number; emptyCount: number;
};
type Field = MappingPlanV2['fields'][number];
type Plan = { profileHash: string; method: string; plan: MappingPlanV2 };
/** One verified seed column: its link, the verified field of its plan and its real cell values. */
export type SeedRecord = { seed: Seed; link: Link; field: Field; method: string; sourceRef: string; values: unknown[] };
export type Candidate = { line: number; variant: Variant; link: Link; entry: TeacherProfileEntry; plan: Plan };
export type DryRun = { verified: boolean; codes: string[] };
export type Drop = {
  line: number; seedProfileId: string; headerVariant: string; reason: string; codes?: string[]; duplicateOf?: number;
};

const VA1 = 'docs/evidence/gf-agent/va1';
export const OUTPUT = 'E:/BhuAayam-data/task-data/va2';
export const CAP = 20;
export const REASONS = {
  storeyCount: 'seed header names a count; storeyLabel doubtful',
  seedDuplicate: 'equal to its seed header after case, whitespace and punctuation removal',
  keptDuplicate: 'equal to a kept variant header after case, whitespace and punctuation removal',
  dryRun: 'existing verifier refused the plan or its executor dry-run on the re-sampled rows',
  cap: `cap of ${CAP} variants per seed reached`,
};

const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Case folding, then whitespace and Unicode punctuation removed; the near-duplicate key. */
export function foldHeader(header: string): string {
  return header.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');
}

/** The lead's rule on VA1's gap: a storeyLabel seed whose header names a number of floors. */
export function seedNamesFloorCount(seed: Pick<Seed, 'target' | 'header'>): boolean {
  return seed.target === 'building.storeyLabel' &&
    /\b(?:no|nos|num|number|count)\b\.?\s*(?:of\s*)?floors?\b|\bfloors?\s*count\b/i.test(seed.header);
}

/** Variants stay in the fold of their seed family; only manifest development families qualify. */
export function foldOf(seed: Pick<Seed, 'family' | 'split'>, boundary = developmentManifest()) {
  assert(seed.split === 'dev' && boundary.development.has(seed.family) && !boundary.heldOut.has(seed.family),
    'VA2_FOLD_DENIED');
  return { family: seed.family, split: seed.split };
}

/** Deterministic mulberry32 stream seeded by the variant's identity; no value is typed, only rows drawn. */
export function resample(values: readonly unknown[], count: number, key: string): unknown[] {
  assert(values.length > 0 && count > 0, 'VA2_RESAMPLE_EMPTY');
  let state = Number.parseInt(stableHash(key).slice(0, 8), 16) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => values[Math.floor(next() * values.length)]);
}

const isEmpty = (value: unknown) => value === null || value === undefined ||
  (typeof value === 'string' && !value.trim());

export const variantId = (variant: Pick<Variant, 'seedProfileId' | 'headerVariant'>) =>
  stableHash(['va2', variant.seedProfileId, variant.headerVariant]);

/** Values come from every verified column of the seed's target in the seed's own family (its fold). */
export function donorValues(seed: Seed, records: readonly SeedRecord[]): unknown[] {
  const donors = records.filter(record => record.seed.family === seed.family && record.seed.target === seed.target);
  assert(donors.some(record => record.seed.seedProfileId === seed.seedProfileId), 'VA2_SEED_NOT_DONOR');
  return donors.flatMap(record => record.values);
}

export function buildCandidate(line: number, variant: Variant, record: SeedRecord,
  records: readonly SeedRecord[], boundary = developmentManifest()): Candidate {
  const { seed } = record;
  assert.equal(variant.target, seed.target, 'VA2_VARIANT_TARGET_CHANGED');
  assert.equal(variant.labelKind, 'synthetic_variant');
  assert(Object.keys(variant.neighbourVariants).every(header => seed.neighbourHeaders.includes(header)),
    'VA2_NEIGHBOUR_UNKNOWN');
  const fold = foldOf(seed, boundary);
  const id = variantId(variant);
  // A one-column table; the name is the variant's own key so the trainer's (profileHash, sourceField) stays unique.
  const name = `variant_${id.slice(0, 16)}`;
  const cells = resample(donorValues(seed, records), record.link.cellCount, id);
  const rows = cells.map(value => ({ [name]: value }));
  const column = profileColumns(rows, [{ name, literalHeader: variant.headerVariant }], 'tabular').columns[0];
  const profile: ColumnProfileDocument = ColumnProfileDocumentSchema.parse({
    version: 'column-profile/1', sourceKind: 'tabular', columns: [column],
    layoutFingerprint: layoutFingerprint([column]), sampleShortfall: column.maskedSamples.length < 5,
  });
  const profileHash = columnProfileHash(profile);
  const { citations: _citations, ...field } = record.field;
  const plan: Plan = { profileHash, method: record.method, plan: {
    version: 'mapping-plan/2', sourceKind: 'tabular', layoutFingerprint: profile.layoutFingerprint,
    method: record.method as MappingPlanV2['method'],
    fields: [{ ...field, sourceField: name,
      rationale: `Operation of verified seed ${seed.seedProfileId}; header variant over re-sampled real values.` }],
  } };
  const link: Link = {
    profileId: id, profileHash, sourceField: name, ...fold, header: variant.headerVariant,
    neighbourHeaders: seed.neighbourHeaders.map(header => variant.neighbourVariants[header] ?? header),
    inferredType: column.inferredType, declaredUnit: column.declaredUnit ?? null, valueShapes: column.valueShapes,
    cellCount: cells.length, emptyCount: cells.filter(isEmpty).length,
  };
  const entry: TeacherProfileEntry = { profile, rows, sourceRef: `${record.sourceRef}&va2=${id}`,
    dataPolicy: { dataClass: 'public', split: 'development' } };
  return { line, variant, link, entry, plan };
}

/** Run the unchanged canonical verifier (plan validation and executor dry-run) over every candidate. */
export async function dryRun(candidates: readonly Candidate[], output: string): Promise<Map<number, DryRun>> {
  const inventory = new Map<string, TeacherProfileEntry>();
  for (const candidate of candidates) {
    assert(!inventory.has(candidate.plan.profileHash), 'VA2_PROFILE_HASH_COLLISION');
    inventory.set(candidate.plan.profileHash, candidate.entry);
  }
  const normalized = join(output, 'normalized-labels.jsonl');
  saveNew(normalized, candidates.map(candidate => candidate.plan), true);
  const report = await ingestTeacherLabels(normalized, inventory, join(output, 'pseudo-labels.jsonl'));
  const examples = readLines<PseudoLabelExample>(join(output, 'pseudo-labels.jsonl'));
  saveNew(join(output, 'report.json'), report);
  const result = new Map<number, DryRun>();
  report.rejections.forEach(rejection => result.set(candidates[rejection.line - 1].line,
    { verified: false, codes: rejection.codes }));
  let next = 0;
  for (const label of report.labels) {
    const example = examples[next++];
    const candidate = candidates[label.line - 1];
    assert.equal(example.profileHash, candidate.plan.profileHash, 'VA2_VERIFIER_ORDER_CHANGED');
    result.set(candidate.line, { verified: example.verified,
      codes: example.verified ? [] : [`FIELD_UNVERIFIED:${JSON.stringify(example.dryRun)}`] });
  }
  assert.equal(result.size, candidates.length, 'VA2_VERIFIER_RESULT_MISSING');
  return result;
}

/** The filter, in input order: the storeyLabel rule, near-duplicates, the dry-run, then the cap. */
export function decide(variants: readonly Variant[], seeds: ReadonlyMap<string, Seed>,
  checked: ReadonlyMap<number, DryRun>) {
  const kept: number[] = [];
  const drops: Drop[] = [];
  const keys = new Map<string, number>();
  const perSeed = new Map<string, number>();
  variants.forEach((variant, index) => {
    const line = index + 1;
    const seed = seeds.get(variant.seedProfileId);
    assert(seed, 'VA2_SEED_UNKNOWN');
    const drop = (reason: string, extra: Pick<Drop, 'codes' | 'duplicateOf'> = {}) => drops.push({ line,
      seedProfileId: seed.seedProfileId, headerVariant: variant.headerVariant, reason, ...extra });
    const key = foldHeader(variant.headerVariant);
    if (seedNamesFloorCount(seed)) return drop(REASONS.storeyCount);
    if (key === foldHeader(seed.header)) return drop(REASONS.seedDuplicate);
    if (keys.has(key)) return drop(REASONS.keptDuplicate, { duplicateOf: keys.get(key) });
    const result = checked.get(line);
    assert(result, 'VA2_DRY_RUN_MISSING');
    if (!result.verified) return drop(REASONS.dryRun, { codes: result.codes });
    if ((perSeed.get(seed.seedProfileId) ?? 0) >= CAP) return drop(REASONS.cap);
    perSeed.set(seed.seedProfileId, (perSeed.get(seed.seedProfileId) ?? 0) + 1);
    keys.set(key, line);
    kept.push(line);
  });
  return { kept, drops };
}

type VerifierRun = { round: string; command: string[] };
type Inventories = Map<string, { tables: TableInventory[]; native: Map<string, unknown[][]> }>;

function seedValues(round: string, profilesPath: string, seedProfileId: string, cache: Inventories) {
  if (!cache.has(round)) {
    const inventory = join(dirname(profilesPath), '../verifier/inventory.json');
    cache.set(round, { tables: json<TableInventory[]>(inventory), native: new Map() });
  }
  const { tables, native } = cache.get(round)!;
  const table = tables.find(entry => entry.profileIds.includes(seedProfileId));
  assert(table, 'VA2_SEED_TABLE_MISSING');
  const key = `${table.asset.family}/${table.asset.id}/${table.sheet}`;
  if (!native.has(key)) {
    // The existing source authority checks pins and permission before reading bytes.
    const source = sourceTables(table.asset).find(entry => entry.name === table.sheet);
    assert(source, 'VA2_SEED_SHEET_MISSING');
    const prepared = prepareTable(table.asset, source);
    assert.equal(stableHash(prepared.inventory), stableHash(table), 'VA2_SEED_SOURCE_CHANGED');
    checkBoundary(prepared.profiles);
    native.set(key, source.rows);
  }
  const index = table.profileIds.indexOf(seedProfileId);
  return {
    values: native.get(key)!.map(row => row[index]),
    sourceRef: `${table.asset.original.externalPath}#sheet=${encodeURIComponent(table.sheet)}`,
  };
}

/** Join each VA1 seed to its verified link, field and real values, from the VA1 verifier runs. */
export function seedRecords(families?: readonly string[]): SeedRecord[] {
  const evidence = json<{ seeds: Seed[]; verifierRuns: VerifierRun[] }>(join(VA1, 'seeds.json'));
  const cache: Inventories = new Map();
  const selected = evidence.seeds.filter(seed => !families || families.includes(seed.family));
  return selected.map(seed => {
    const run = evidence.verifierRuns.find(entry => entry.round === seed.round);
    assert(run, 'VA2_SEED_ROUND_MISSING');
    const [profilesPath, verified] = run.command.slice(3, 5);
    const link = readLines<Link>(join(verified, 'profile-links.jsonl'))
      .find(entry => entry.profileId === seed.seedProfileId);
    assert(link && link.family === seed.family && link.header === seed.header, 'VA2_SEED_LINK_CHANGED');
    const example = readLines<PseudoLabelExample>(join(verified, 'pseudo-labels.jsonl')).find(entry =>
      entry.profileHash === link.profileHash && entry.columnProfile.name === link.sourceField);
    assert(example?.verified && example.target === seed.target, 'VA2_SEED_NOT_VERIFIED');
    const plan = readLines<Plan | null>(join(verified, 'normalized-labels.jsonl'))
      .find(entry => entry?.profileHash === link.profileHash);
    const field = plan?.plan.fields.find(entry => entry.sourceField === link.sourceField);
    assert(plan && field && field.target === seed.target, 'VA2_SEED_FIELD_MISSING');
    const source = seedValues(seed.round, profilesPath, seed.seedProfileId, cache);
    return { seed, link, field, method: plan.method, ...source };
  });
}

const counted = (rows: string[]) => Object.fromEntries([...new Set(rows)].sort()
  .map(key => [key, rows.filter(row => row === key).length]));

export async function run(output: string) {
  const va1 = json<{ variants: { path: string; sha256: string; lines: number } }>(join(VA1, 'result.json'));
  assert.equal(digest(va1.variants.path), va1.variants.sha256, 'VA2_VARIANTS_PIN_CHANGED');
  const variants = readLines<Variant>(va1.variants.path);
  assert.equal(variants.length, va1.variants.lines);
  const records = seedRecords();
  const seeds = new Map(records.map(record => [record.seed.seedProfileId, record.seed]));
  const boundary = developmentManifest();
  // Variants of a dropped storeyLabel seed are never profiled or verified.
  const candidates = variants.flatMap((variant, index) => {
    const record = records.find(entry => entry.seed.seedProfileId === variant.seedProfileId);
    assert(record, 'VA2_SEED_UNKNOWN');
    return seedNamesFloorCount(record.seed) ? [] : [buildCandidate(index + 1, variant, record, records, boundary)];
  });
  const checked = await dryRun(candidates, join(output, 'verifier'));
  // Storey-rule drops carry no dry-run; decide() never reads one for them.
  const { kept, drops } = decide(variants, seeds, checked);
  const byLine = new Map(candidates.map(candidate => [candidate.line, candidate]));
  const examples = readLines<PseudoLabelExample>(join(output, 'verifier/pseudo-labels.jsonl'));
  const chosen = kept.map(line => byLine.get(line)!);
  const lines = chosen.map(candidate => {
    const example = examples.find(entry => entry.profileHash === candidate.plan.profileHash);
    assert(example?.verified, 'VA2_KEPT_NOT_VERIFIED');
    assert.equal(candidate.link.family, seeds.get(candidate.variant.seedProfileId)!.family, 'VA2_FOLD_CHANGED');
    return { ...example, labelKind: 'synthetic_variant', method: candidate.variant.method,
      seedProfileId: candidate.variant.seedProfileId, style: candidate.variant.style };
  });
  saveNew(join(output, 'variant-examples.jsonl'), lines, true);
  saveNew(join(output, 'profile-links.jsonl'), chosen.map(candidate => ({ ...candidate.link,
    labelKind: 'synthetic_variant', seedProfileId: candidate.variant.seedProfileId })), true);
  saveNew(join(output, 'drops.jsonl'), drops, true);
  const realHeaders = new Map(records.map(record => [foldHeader(record.seed.header), record.seed.family]));
  const summary = {
    input: { path: va1.variants.path, sha256: va1.variants.sha256, lines: variants.length },
    seeds: records.length, candidatesVerified: candidates.length, kept: kept.length, dropped: drops.length,
    dropsByReason: counted(drops.map(drop => drop.reason)),
    dryRunCodes: counted(drops.flatMap(drop => drop.codes ?? [])),
    keptDuplicateScope: counted(drops.flatMap(drop => {
      if (drop.duplicateOf === undefined) return [];
      const other = seeds.get(variants[drop.duplicateOf - 1].seedProfileId)!;
      const own = seeds.get(drop.seedProfileId)!;
      if (other.seedProfileId === own.seedProfileId) return ['same seed'];
      const target = other.target === own.target ? 'same target' : 'other target';
      return [`${other.family === own.family ? 'same family' : 'other family'}, ${target}`];
    })),
    keptByTarget: counted(chosen.map(candidate => candidate.variant.target)),
    keptByFamily: counted(chosen.map(candidate => candidate.link.family)),
    keptPerSeedMax: Math.max(...Object.values(counted(chosen.map(candidate => candidate.variant.seedProfileId)))),
    // Reported, not filtered: a kept header equal to a real seed header of another family (another fold).
    keptEqualToOtherFoldRealHeader: chosen.filter(candidate => {
      const family = realHeaders.get(foldHeader(candidate.variant.headerVariant));
      return family !== undefined && family !== candidate.link.family;
    }).length,
    outputs: Object.fromEntries(['variant-examples.jsonl', 'profile-links.jsonl', 'drops.jsonl']
      .map(name => [name, digest(join(output, name))])),
  };
  saveNew(join(output, 'summary.json'), summary);
  return summary;
}

async function main(args: string[]) {
  if (args[0] === '--check') {
    // Rebuild in a fresh directory and require byte-equal outputs; nothing saved is overwritten.
    const checked = await run(join(OUTPUT, `checks/rebuild-${Date.now()}`));
    const saved = json<{ outputs: Record<string, string> }>(join(OUTPUT, 'summary.json'));
    assert.deepEqual(checked.outputs, saved.outputs, 'VA2_REBUILD_DIFFERS');
    console.log(JSON.stringify({ rebuilt: true, outputs: checked.outputs }));
    return;
  }
  console.log(JSON.stringify(await run(OUTPUT)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : 'VA2_FAILED');
    process.exitCode = 1;
  });
}

// Screens the development inputs the guards admit for text that could act as an instruction to a model.
// Usage: tsx scripts/agent/injection-screen.ts <new directory under E:/BhuAayam-data/task-data/e3>
// Counts go to <out>/screen.json and masked examples to <out>/candidates.jsonl. No raw value is written:
// an example keeps the matched fixed-list phrase and masks every other word with the product's own masker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { storeyPartBatches, type StoreyPageStore } from '../../packages/server/src/modules/ai/document-storey-agent';
import { maskColumnSample } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { mappingTeacherRequest } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { prepareTable, saveNew } from './t1-profiles';
import {
  developmentProfileAssets, digest, preparationAssets, sourceTables, T1B_FAMILIES,
  type SourceAsset, type SourceTable,
} from './t1-sources';

const E3_ROOT = 'E:/BhuAayam-data/task-data/e3';
const SCRIPT = 'scripts/agent/injection-screen.ts';
const FOREIGN_MANIFEST = 'fixtures/usp/D8-open-property-foreign/manifest.json';
const STOREY_TRUTH = 'docs/evidence/usp/finale/GF-DATA/storey-truth';
// The three folders the A5 run read its development and demo page stores from; its holdout folder is not named.
const STOREY_PAGE_DIRECTORIES = ['pages', 'pages-b', 'pages-h'].map((name) => `E:/BhuAayam-data/task-data/a5/${name}`);
const EXAMPLES_PER_GROUP = 5;
const CONTEXT_CHARS = 80;
// What each prompt keeps of one string: maskColumnSample cuts a cell at 256 characters, the profile contract
// refuses a header over 512, storeyPartBatches cuts a line at 240, and the gateway budget is 32768 input bytes.
export const CAPS = { header: 512, cell: 256, sample: 256, line: 240, part: 240 } as const;
const GATEWAY_INPUT_BYTES = 32768;

type Surface = 'table' | 'document';
type Layer = 'teacher' | 'raw';
type Kind = keyof typeof CAPS;
type Span = readonly [number, number];
export type ScreenClass = {
  id: string;
  meaning: string;
  surfaces: readonly Surface[];
  shown: 'phrase' | 'marker';
  find: (text: string, cap: number) => Span[];
};
export type Item = { layer: Layer; kind: Kind; text: string; header: string; where: string; asPrompt: boolean };
export type FamilyTally = {
  family: string;
  split: string;
  surface: Surface;
  n: Record<string, number>;
  candidates: Record<Layer, Record<string, number>>;
};
type Group = {
  family: string;
  layer: Layer;
  kind: Kind;
  where: string;
  class: string;
  count: number;
  examples: string[];
};
type NotScreened = { family: string; file: string; reason: string; code: string };
export type Screen = { tallies: Map<string, FamilyTally>; groups: Map<string, Group>; notScreened: NotScreened[] };
type PromptColumn = { header: string; maskedSamples: string[] };
type PromptTable = { columns: PromptColumn[]; bytes: number };
type StoreySource = { split: 'development' | 'demo'; project: string };

// Entries are regular-expression fragments; a space stands for any run of white space.
const LATIN_PHRASES = [
  // English: drop or replace what the reader was told before.
  'ignore', 'disregard', 'forget', 'override', 'bypass',
  'previous instructions?', 'prior instructions?', 'above instructions?', 'new instructions?',
  // English: address the reader or the model directly, or name its prompt.
  'you are', 'you must', 'you should', 'act as', 'pretend', 'system prompt', 'language model', 'as an ai',
  // English: dictate the answer or forbid an action.
  'respond with', 'reply with', 'answer with', 'return only', 'output only', 'do not', "don['’]t", 'must not',
  // Hindi transliterated: instruction, ignore, pay no attention, answer, do not, you are.
  'nirdesh', 'nirdeshon', 'andekha', 'upeksha', 'nazarandaz', 'dhyan na de', 'uttar de', 'jawab de', 'mat karo',
  'na karen', 'aap hain',
];
const DEVANAGARI_PHRASES = [
  // Hindi in Devanagari: instruction, ignore, pay no attention, answer, do not, you are.
  'निर्देश', 'अनदेखा', 'उपेक्षा', 'नज़रअंदाज़',
  'नजरअंदाज', 'ध्यान न दें', 'उत्तर दें',
  'जवाब दें', 'मत करें', 'न करें', 'आप हैं',
];
const ROLE_MARKERS = [
  // A chat role at the start of a line, a special token, an instruction heading or a template tag.
  String.raw`(?:^|[\r\n])\s*(?:system|assistant|user|human|developer)\s*:`,
  String.raw`<\|[^|<>]{0,40}\|>`,
  String.raw`#{2,}\s*(?:instruction|response|system|input)`,
  String.raw`\[/?INST\]`,
  String.raw`<</?SYS>>`,
];
const MARKUP_TOKENS = [
  // Active HTML, script URLs, template delimiters and code fences.
  '<script', '<img', '<iframe', '<svg', '<object', String.raw`<a\s+href`, 'javascript:',
  String.raw`\{\{`, String.raw`\}\}`, String.raw`\$\{`, String.raw`\{%`, '```',
];
const ADDRESS_TOKENS = [
  // A web address (also in its masked form), an e-mail address, or the masker's own e-mail marker.
  String.raw`https?://`, '://', String.raw`www\.`, String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`,
  String.raw`\[email\]`,
];
// Tab, line feed and carriage return are left out: JSON escapes them and they are ordinary in cells.
const CONTROL = String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]`;
const ZERO_WIDTH = String.raw`[\u200B-\u200D\u2060\uFEFF]`;
const BIDI = String.raw`[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]`;
const INVISIBLE = new RegExp(`${CONTROL}|${ZERO_WIDTH}|${BIDI}`, 'gu');

const spaced = (phrases: readonly string[]) =>
  phrases.map((phrase) => phrase.replace(/ /g, String.raw`\s+`)).join('|');
const latinWords = String.raw`(?<![\p{L}\p{N}])(?:${spaced(LATIN_PHRASES)})(?![\p{L}\p{N}])`;

function spansOf(source: string, flags = 'giu') {
  const pattern = new RegExp(source, flags);
  return (text: string): Span[] =>
    [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length] as const);
}

/** The classes are fixed here before the first run; a match is a candidate, never a case by itself. */
export const SCREEN_CLASSES: readonly ScreenClass[] = [
  {
    id: 'instruction_phrase', surfaces: ['table', 'document'], shown: 'phrase',
    meaning: 'A phrase that tells a reader or a model what to do, in English, Hindi or transliterated Hindi.',
    find: spansOf(`${latinWords}|${spaced(DEVANAGARI_PHRASES)}`),
  },
  {
    id: 'role_marker', surfaces: ['table', 'document'], shown: 'phrase',
    meaning: 'A chat role at a line start, a special token such as <|...|>, or an instruction heading.',
    find: spansOf(ROLE_MARKERS.join('|')),
  },
  {
    id: 'markup_template', surfaces: ['table', 'document'], shown: 'phrase',
    meaning: 'Active HTML, a script URL, a template delimiter or a code fence.',
    find: spansOf(MARKUP_TOKENS.join('|')),
  },
  {
    id: 'url_email', surfaces: ['table', 'document'], shown: 'marker',
    meaning: 'A web address or an e-mail address, raw or in its masked form.',
    find: spansOf(ADDRESS_TOKENS.join('|')),
  },
  {
    id: 'formula_prefix', surfaces: ['table'], shown: 'phrase',
    meaning: 'A cell or header that starts with =, +, - or @ followed by a letter or an opening bracket.',
    find: spansOf(String.raw`^\s*[=+\-@](?=[\p{L}(])`, 'gu'),
  },
  {
    id: 'control_character', surfaces: ['table', 'document'], shown: 'phrase',
    meaning: 'A C0 or C1 control character other than tab, line feed and carriage return.',
    find: spansOf(CONTROL, 'gu'),
  },
  {
    id: 'zero_width_character', surfaces: ['table', 'document'], shown: 'phrase',
    meaning: 'A zero-width space, joiner, non-joiner, word joiner or byte-order mark inside the text.',
    find: spansOf(ZERO_WIDTH, 'gu'),
  },
  {
    id: 'bidi_override', surfaces: ['table', 'document'], shown: 'phrase',
    meaning: 'A bidirectional mark, embedding, override or isolate.',
    find: spansOf(BIDI, 'gu'),
  },
  {
    id: 'over_cap', surfaces: ['table', 'document'], shown: 'marker',
    meaning: 'A raw cell, header or line longer than what its prompt keeps of it.',
    find: (text, cap) => (text.length > cap ? [[cap, text.length]] : []),
  },
];

const visible = (text: string) =>
  text.replace(INVISIBLE, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

function bump(counts: Record<string, number>, key: string, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

/** One match in context: the phrase or a class marker, with every other word masked unless the prompt shows it. */
export function maskedExample(
  item: Pick<Item, 'text' | 'header' | 'asPrompt'>, span: Span, entry: Pick<ScreenClass, 'id' | 'shown'>,
): string {
  const mask = (piece: string) => (item.asPrompt || !piece.trim() ? piece : maskColumnSample(piece, item.header));
  const before = item.text.slice(Math.max(0, span[0] - CONTEXT_CHARS), span[0]);
  const after = item.text.slice(span[1], span[1] + CONTEXT_CHARS);
  const matched = item.text.slice(span[0], span[1]);
  return visible(mask(before) + (entry.shown === 'phrase' ? matched : `[${entry.id}]`) + mask(after));
}

function recordExample(groups: Map<string, Group>, family: string, item: Item, entry: ScreenClass, span: Span) {
  const key = [family, item.layer, item.kind, item.where, entry.id].join('|');
  const group = groups.get(key) ?? {
    family, layer: item.layer, kind: item.kind, where: item.where, class: entry.id, count: 0, examples: [],
  };
  const example = maskedExample(item, span, entry);
  group.count++;
  if (group.examples.length < EXAMPLES_PER_GROUP && !group.examples.includes(example)) group.examples.push(example);
  groups.set(key, group);
}

/** Counts one screened string once per class it matches and keeps a masked example of the first match. */
export function screenItem(tally: FamilyTally, groups: Map<string, Group>, item: Item) {
  for (const entry of SCREEN_CLASSES) {
    if (!entry.surfaces.includes(tally.surface)) continue;
    const found = entry.find(item.text, CAPS[item.kind]);
    if (!found.length) continue;
    bump(tally.candidates[item.layer], entry.id);
    recordExample(groups, tally.family, item, entry, found[0]);
  }
}

export function newScreen(): Screen {
  return { tallies: new Map(), groups: new Map(), notScreened: [] };
}

export function tallyFor(screen: Screen, family: string, split: string, surface: Surface): FamilyTally {
  const existing = screen.tallies.get(family);
  if (existing) return existing;
  const tally: FamilyTally = { family, split, surface, n: {}, candidates: { teacher: {}, raw: {} } };
  screen.tallies.set(family, tally);
  return tally;
}

/** What the mapping prompt carries for each column, read back from the existing builder's own user message. */
function promptTable(prepared: ReturnType<typeof prepareTable>): PromptTable {
  const profile = prepared.inventory.profile;
  const columns = profile.columns.map((column, index) => {
    const header = prepared.profiles[index].header;
    return { ...column, name: header.trim() ? header : column.name };
  });
  const request = mappingTeacherRequest({ ...profile, columns });
  const user = JSON.parse(request.messages[1].content) as { columnProfile: { columns: PromptColumn[] } };
  const bytes = request.messages.reduce((total, message) => total + Buffer.byteLength(message.content), 0);
  return { columns: user.columnProfile.columns, bytes };
}

const columnLocator = (asset: SourceAsset, table: SourceTable, index: number) =>
  `${asset.id}|${table.name}|column ${index + 1}`;

function screenPromptTable(
  screen: Screen, tally: FamilyTally, asset: SourceAsset, table: SourceTable, prompt: PromptTable,
) {
  tally.n.promptBytesMax = Math.max(tally.n.promptBytesMax ?? 0, prompt.bytes);
  if (prompt.bytes > GATEWAY_INPUT_BYTES) bump(tally.n, 'promptsOverInputBudget');
  prompt.columns.forEach((column, index) => {
    const shared = { layer: 'teacher' as const, header: column.header, asPrompt: true };
    const where = columnLocator(asset, table, index);
    bump(tally.n, 'columns');
    screenItem(tally, screen.groups, { ...shared, kind: 'header', text: column.header, where });
    for (const sample of column.maskedSamples) {
      bump(tally.n, 'promptSamples');
      screenItem(tally, screen.groups, { ...shared, kind: 'sample', text: sample, where });
    }
  });
}

function screenRawTable(screen: Screen, tally: FamilyTally, asset: SourceAsset, table: SourceTable) {
  table.headers.forEach((header, index) => {
    const shared = { layer: 'raw' as const, header, asPrompt: false, where: columnLocator(asset, table, index) };
    screenItem(tally, screen.groups, { ...shared, kind: 'header', text: header });
    for (const row of table.rows) {
      const cell = row[index];
      if (typeof cell !== 'string') {
        bump(tally.n, 'cellsNotText');
        continue;
      }
      bump(tally.n, 'cells');
      screenItem(tally, screen.groups, { ...shared, kind: 'cell', text: cell });
    }
  });
}

/** Reads one source under the T1 guards; everything that can refuse runs before the first count. */
function screenAsset(screen: Screen, asset: SourceAsset) {
  const tables = sourceTables(asset).map((table) => ({ table, prompt: promptTable(prepareTable(asset, table)) }));
  const tally = tallyFor(screen, asset.family, asset.split, 'table');
  bump(tally.n, 'files');
  for (const { table, prompt } of tables) {
    bump(tally.n, 'tables');
    screenPromptTable(screen, tally, asset, table, prompt);
    screenRawTable(screen, tally, asset, table);
  }
}

/** Every table source the T1 guards admit today: development and pool entries and the recorded derivatives. */
function admittedAssets(): SourceAsset[] {
  const direct = preparationAssets().assets.filter((asset) => !T1B_FAMILIES.includes(asset.family));
  return [...direct, ...developmentProfileAssets()];
}

/** The foreign development entries; whether they may be read is the guard's decision, not this list's. */
export function foreignAssets(): SourceAsset[] {
  const manifest = JSON.parse(readFileSync(FOREIGN_MANIFEST, 'utf8')) as {
    families: { id: string; split: string }[];
    assets: SourceAsset[];
  };
  const development = new Set(manifest.families.filter((family) => family.split === 'dev').map((family) => family.id));
  return manifest.assets.filter((asset) => asset.split === 'dev' && development.has(asset.family));
}

export function screenTables(screen: Screen, assets: SourceAsset[]) {
  for (const asset of assets) {
    try {
      screenAsset(screen, asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^[A-Z0-9_]+$/.test(message) ? message : 'E3_READ_FAILED';
      const reason = code === 'T1_SOURCE_DENIED' ? 'guard' : 'reader';
      screen.notScreened.push({ family: asset.family, file: asset.id, reason, code });
    }
  }
}

/** Development and demo extraction PDFs only, by the A5 run's own rule; the holdout folder is never listed. */
export function eligibleStoreySources(): Map<string, StoreySource> {
  const eligible = new Map<string, StoreySource>();
  for (const [folder, split] of [['dev', 'development'], ['demo', 'demo']] as const) {
    for (const name of readdirSync(join(STOREY_TRUTH, folder))) {
      const record = JSON.parse(readFileSync(join(STOREY_TRUTH, folder, name), 'utf8')) as {
        projectSourceId: string;
        sources: { role: string; sha256: string }[];
      };
      for (const source of record.sources.filter((item) => item.role === 'extraction_pdf')) {
        eligible.set(source.sha256, { split, project: record.projectSourceId });
      }
    }
  }
  return eligible;
}

/** Screens the parts the storey prompt would carry and, for counts only, every retained line of the store. */
export function screenStore(screen: Screen, tally: FamilyTally, store: StoreyPageStore) {
  const source = store.source.sha256.slice(0, 12);
  const batches = storeyPartBatches(store);
  bump(tally.n, 'sources');
  bump(tally.n, 'batches', batches.length);
  const shared = { header: '', asPrompt: false };
  for (const part of batches.flat()) {
    const where = `${source}|page ${part.page}`;
    bump(tally.n, 'parts');
    screenItem(tally, screen.groups, { ...shared, layer: 'teacher', kind: 'part', text: part.text, where });
  }
  for (const [page, entry] of Object.entries(store.pages)) {
    const where = `${source}|page ${page}`;
    bump(tally.n, 'pages');
    for (const line of entry.lines) {
      bump(tally.n, 'lines');
      screenItem(tally, screen.groups, { ...shared, layer: 'raw', kind: 'line', text: line.text, where });
    }
  }
}

function screenDocuments(screen: Screen) {
  for (const [sha, source] of eligibleStoreySources()) {
    const family = `storey/${source.split}/${source.project}`;
    const path = STOREY_PAGE_DIRECTORIES.map((directory) => join(directory, `${sha}.pages.json`)).find(existsSync);
    const store = path ? (JSON.parse(readFileSync(path, 'utf8')) as StoreyPageStore) : undefined;
    if (!store || store.source.sha256 !== sha) {
      const code = store ? 'E3_PAGE_STORE_MISMATCH' : 'E3_PAGE_STORE_ABSENT';
      screen.notScreened.push({ family, file: sha.slice(0, 12), reason: 'page_store', code });
      continue;
    }
    screenStore(screen, tallyFor(screen, family, source.split, 'document'), store);
  }
}

function totals(tallies: FamilyTally[], surface: Surface) {
  const candidates: FamilyTally['candidates'] = { teacher: {}, raw: {} };
  const total = { families: 0, n: {} as Record<string, number>, candidates };
  for (const tally of tallies.filter((entry) => entry.surface === surface)) {
    total.families++;
    for (const [key, value] of Object.entries(tally.n)) {
      if (key === 'promptBytesMax') total.n[key] = Math.max(total.n[key] ?? 0, value);
      else bump(total.n, key, value);
    }
    for (const layer of ['teacher', 'raw'] as const) {
      for (const [id, value] of Object.entries(tally.candidates[layer])) bump(total.candidates[layer], id, value);
    }
  }
  return total;
}

function summary(screen: Screen) {
  const tallies = [...screen.tallies.values()];
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  return {
    task: 'E3', gate: 'GF-AGENT', runAt: new Date().toISOString(),
    screenCommit: git('rev-parse', 'HEAD'), scriptSha256: digest(SCRIPT),
    scriptCommitted: git('status', '--porcelain', '--', SCRIPT) === '',
    caps: { ...CAPS, gatewayInputBytes: GATEWAY_INPUT_BYTES },
    classes: SCREEN_CLASSES.map(({ id, meaning, surfaces }) => ({ id, meaning, surfaces })),
    totals: { tables: totals(tallies, 'table'), documents: totals(tallies, 'document') },
    families: tallies, notScreened: screen.notScreened,
  };
}

function runScreen(): Screen {
  const screen = newScreen();
  screenTables(screen, [...admittedAssets(), ...foreignAssets()]);
  screenDocuments(screen);
  return screen;
}

function main(args: string[]) {
  const output = resolve(args[0] ?? '');
  const inside = relative(resolve(E3_ROOT), output);
  assert(inside && !inside.startsWith('..') && !isAbsolute(inside), 'E3_OUTPUT_DENIED');
  const screen = runScreen();
  const result = summary(screen);
  saveNew(join(output, 'screen.json'), result);
  saveNew(join(output, 'candidates.jsonl'), [...screen.groups.values()], true);
  console.log(JSON.stringify({ totals: result.totals, notScreened: result.notScreened }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}

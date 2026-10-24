import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const folder = 'docs/evidence/gf5/lv0';
const problems = [];
const citations = new Map();
const countLines = text => text.split(/\r?\n/).length;

async function checkCitation(file, ranges, owner) {
  const key = `${file}:${ranges}`;
  if (citations.has(key)) return;
  citations.set(key, owner);
  try {
    const text = file.startsWith('staging:')
      ? execFileSync('git', ['show', file], { encoding: 'utf8' })
      : await readFile(file, 'utf8');
    const lines = countLines(text);
    for (const range of ranges.split(',')) {
      const [start, end = start] = range.split('-').map(Number);
      if (start < 1 || end < start || end > lines) problems.push(`${owner}: ${key} beyond ${lines}`);
    }
  } catch {
    problems.push(`${owner}: unreadable citation ${key}`);
  }
}

for (const name of await readdir(folder)) {
  const file = path.join(folder, name);
  const text = await readFile(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.length > 120) problems.push(`${file}:${index + 1}: ${line.length} characters`);
  });
  if (!name.endsWith('.json')) continue;
  const body = JSON.parse(text);
  // Accepted Part A has profiler-transformed URL line numbers; do not re-audit or rewrite its receipt.
  if (['lag.json', 'findings.json'].includes(name)) continue;
  const strings = JSON.stringify(body);
  const expression = new RegExp('((?:staging:)?(?:apps|packages|services|scripts|docs)/'
    + '[\\w./-]+\\.(?:ts|tsx|py|json|mjs)):(\\d+(?:-\\d+)?(?:,\\d+(?:-\\d+)?)*)', 'g');
  for (const match of strings.matchAll(expression)) await checkCitation(match[1], match[2], file);
}
const load = async name => JSON.parse(await readFile(path.join(folder, name), 'utf8'));
const [eight, readers, gaps] = await Promise.all(['eight.json', 'readers.json', 'gaps.json'].map(load));
const vectors = eight.members.filter(member => member.reader === 'inspect_gis');
const sum = key => vectors.reduce((total, member) => total + member[key], 0);
if (eight.members.length !== 8 || sum('features') !== readers.nyc.vectorFeatures
  || sum('accepted') !== readers.nyc.nativeAcceptedFeatures || sum('rejected') !== 1) {
  problems.push('Eight native receipts and NYC aggregate claims differ');
}
const profile = JSON.parse(await readFile('scripts/demo-import/nyc-profile.json', 'utf8'));
for (const member of eight.members) {
  if (member.sha256 !== profile.layers.find(layer => layer.name === member.name)?.sha256)
    problems.push(`Original pin differs for ${member.name}`);
}
for (const stage of gaps.architectureSection3Classification) {
  for (const id of stage.gapIds) {
    if (!gaps.gaps.some(gap => gap.id === id)) problems.push(`Unknown stage dependency ${id}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`LV0 JSON, <=120-character lines and ${citations.size} citation ranges: OK`);
}

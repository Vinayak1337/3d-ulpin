import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const folder = 'docs/evidence/gf1/au1';
const problems = [];
const citations = new Map();
const countLines = text => text.split(/\r?\n/).length;
const expression = new RegExp('((?:staging:)?(?:apps|packages|services|scripts|docs)/'
  + '[\\w./-]+\\.(?:ts|tsx|py|json|mjs)):(\\d+(?:-\\d+)?(?:,\\d+(?:-\\d+)?)*)', 'g');

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

function checkLines(file, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.length > 120) problems.push(`${file}:${index + 1}: ${line.length} characters`);
  });
}

async function checkFile(name) {
  const file = path.join(folder, name);
  const text = await readFile(file, 'utf8');
  checkLines(file, text);
  if (!name.endsWith('.json')) return null;
  const body = JSON.parse(text);
  for (const match of JSON.stringify(body).matchAll(expression)) await checkCitation(match[1], match[2], file);
  return body;
}

const bodies = {};
for (const name of await readdir(folder)) bodies[name] = await checkFile(name);

const words = new Set(['automatic today', 'preparable', 'officer only', 'broken']);
for (const step of bodies['result.json']?.steps ?? []) {
  if (!words.has(step.state)) problems.push(`result.json: step ${step.step} has state ${step.state}`);
}
const breakIds = new Set((bodies['breaks.json']?.breaks ?? []).map(item => item.id));
for (const id of bodies['result.json']?.topBreaks ?? []) {
  if (!breakIds.has(id)) problems.push(`result.json: unknown break ${id}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`AU1 JSON, <=120-character lines and ${citations.size} citation ranges: OK`);
}

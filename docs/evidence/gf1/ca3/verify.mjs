import { readFile } from 'node:fs/promises';
import path from 'node:path';

const folder = 'docs/evidence/gf1/ca3';
const problems = [];
const texts = new Map();
const forbidden = /(?:^|\/)(?:heldout|holdout|evaluator|provisional|acquisitions)(?:\/|$)|(?:^|\/)\.env(?:\.|$)/;

async function textOf(file) {
  if (!texts.has(file)) texts.set(file, await readFile(file, 'utf8'));
  return texts.get(file);
}

function checkStyle(file, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.length > 120) problems.push(`${file}:${index + 1}: ${line.length} characters`);
  });
}

async function checkCitation(citation, files) {
  const file = files[citation.file];
  if (!file || forbidden.test(file) || path.isAbsolute(file) || file.split('/').includes('..')) {
    problems.push(`${citation.id}: invalid or forbidden file`);
    return;
  }
  try {
    const count = (await textOf(file)).split(/\r?\n/).length;
    const [start, end] = citation.lines;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > count) {
      problems.push(`${citation.id}: ${file}:${start}-${end} outside 1-${count}`);
    }
  } catch {
    problems.push(`${citation.id}: missing or unreadable ${file}`);
  }
}

function checkReferences(value, ids) {
  if (Array.isArray(value)) {
    for (const item of value) checkReferences(item, ids);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'refs') {
      for (const id of child) if (!ids.has(id)) problems.push(`Unknown citation reference: ${id}`);
    } else {
      checkReferences(child, ids);
    }
  }
}

const evidenceNames = ['result.json', 'citations.json', 'report.md', 'verify.mjs'];
for (const name of evidenceNames) {
  const file = `${folder}/${name}`;
  checkStyle(file, await textOf(file));
}
const result = JSON.parse(await textOf(`${folder}/result.json`));
const index = JSON.parse(await textOf(`${folder}/citations.json`));
const ids = new Set();
for (const citation of index.citations) {
  if (ids.has(citation.id)) problems.push(`Duplicate citation: ${citation.id}`);
  ids.add(citation.id);
  await checkCitation(citation, index.files);
}
checkReferences(result, ids);
const report = await textOf(`${folder}/report.md`);
for (const match of report.matchAll(/\[([A-Z]-[A-Za-z0-9-]+)\]/g)) {
  if (!ids.has(match[1])) problems.push(`Unknown report citation: ${match[1]}`);
}
if (!['building_gets_identity', 'spaces_only', 'silent', 'conflicting'].includes(result.designSays)) {
  problems.push('Invalid designSays');
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`CA3: ${ids.size} citation ranges in ${Object.keys(index.files).length} files; OK`);
}

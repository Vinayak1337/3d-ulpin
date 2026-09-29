/** List added apps/web UI lines that need a design-system check. Usage: scan-ui-diff.mjs [base-ref] */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const base = process.argv[2] ?? git('merge-base', 'HEAD', 'staging').trim();
const uiFile = /\.(?:css|[cm]?[jt]sx?)$/;
const tokenFile = /(?:^|\/)tokens\.css$/;

const rules = [
  ['literal-colour', /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/, 'use a --ui-* colour token'],
  ['literal-font', /font-family\s*:(?!\s*var\()|fontFamily\s*:\s*['"]/, 'use the Noto font tokens'],
  ['icon-set', /['"]lucide-react(?:\/[^'"]*)?['"]/, 'use the shared Phosphor Icon wrapper'],
  ['placeholder-content', /picsum\.photos|unsplash\.com|placehold\.co|placeholder\.com|lorem ipsum|john doe|jane doe|acme corp/i, 'bind the value to a record'],
  ['provenance-label', /\bfictional\b|\bdemo(?:nstration)? data\b|\bsample data\b|\bdummy\b/i, 'show provenance from the record'],
  ['theme-switch', /prefers-color-scheme|setTheme\b|ThemeToggle|theme-?switch|data-theme=["']dark/i, 'desktop light mode only; no theme switch'],
];

const added = [];
let file = '';
let line = 0;
for (const row of git('diff', '--unified=0', '--no-color', base, '--', 'apps/web').split('\n')) {
  if (row.startsWith('+++ ')) { file = row.startsWith('+++ b/') ? row.slice(6) : ''; continue; }
  const hunk = row.match(/^@@ -\S+ \+(\d+)/);
  if (hunk) { line = Number(hunk[1]); continue; }
  if (row.startsWith('+')) added.push([file, line++, row.slice(1)]);
}
for (const name of git('ls-files', '--others', '--exclude-standard', '--', 'apps/web').split('\n')) {
  if (!name) continue;
  readFileSync(resolve(root, name), 'utf8').split('\n').forEach((text, i) => added.push([name, i + 1, text]));
}

const found = [];
let fontFace = '';
for (const [name, number, text] of added) {
  if (/@font-face/.test(text)) fontFace = name;
  else if (fontFace === name && /^\s*}/.test(text)) fontFace = '';
  if (!uiFile.test(name) || /^\s*(?:\/\/|\/?\*)/.test(text)) continue;
  for (const [rule, pattern, fix] of rules) {
    if (rule === 'literal-colour' && tokenFile.test(name)) continue;
    if (rule === 'literal-font' && fontFace === name) continue;
    if (pattern.test(text)) found.push(`${name}:${number}  ${rule}  ${text.trim().slice(0, 120)}  → ${fix}`);
  }
}

console.log(`Base ${base.slice(0, 12)}; ${added.length} added line(s) in apps/web.`);
if (found.length) {
  console.log(`${found.length} candidate(s) for review:`);
  for (const row of found) console.log(row);
  process.exit(1);
}
console.log('No candidates.');

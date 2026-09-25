/** Warn on newly introduced lucide-react imports without flagging existing code. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const base = process.argv[2] ?? git('merge-base', 'HEAD', 'staging').trim();
const diff = git('diff', '--unified=0', base, '--', 'apps/web');
const found = [];
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) file = line.slice(6);
  if (line.startsWith('+') && !line.startsWith('+++') &&
      /\b(?:from\s*['"]lucide-react(?:\/[^'"]*)?['"]|import\s*['"]lucide-react(?:\/[^'"]*)?['"]|require\s*\(\s*['"]lucide-react(?:\/[^'"]*)?['"])/.test(line)) {
    found.push(`${file}: ${line.slice(1).trim()}`);
  }
}
for (const fileName of git('ls-files', '--others', '--exclude-standard', '--', 'apps/web').split('\n')) {
  if (!/\.[cm]?[jt]sx?$/.test(fileName)) continue;
  for (const line of readFileSync(resolve(root, fileName), 'utf8').split('\n')) {
    if (/\b(?:from\s*['"]lucide-react(?:\/[^'"]*)?['"]|import\s*['"]lucide-react(?:\/[^'"]*)?['"]|require\s*\(\s*['"]lucide-react(?:\/[^'"]*)?['"])/.test(line)) {
      found.push(`${fileName}: ${line.trim()}`);
    }
  }
}
if (found.length) {
  console.warn(`Icon warning: ${found.length} new lucide-react import(s); use the shared Phosphor Icon wrapper.`);
  for (const line of found) console.warn(line);
} else {
  console.log('Icon warning check: no new lucide-react imports.');
}

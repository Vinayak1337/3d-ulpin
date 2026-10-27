// Classify the existing profile's exact inventory without changing its integrity policy.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function normalized(path) {
  return path.replaceAll('\\', '/').toLowerCase();
}

function fileClass(file, profile) {
  const path = normalized(file);
  const repo = normalized(profile.repo) + '/';
  const base = normalized(profile.base) + '/';
  const purelib = normalized(profile.purelib) + '/';
  if (path.startsWith(repo)) return 'repo';
  if (path.startsWith(purelib)) {
    if (path.includes('.dist-info/')) return 'package_metadata';
    if (path.endsWith('.pyc')) return 'package_cache';
    if (path.endsWith('.py')) return 'package_source';
    return 'package_assets_and_native';
  }
  if (path.startsWith(base + 'lib/')) {
    if (path.endsWith('.pyc')) return 'stdlib_cache';
    if (path.endsWith('.py')) return 'stdlib_source';
    return 'stdlib_support_and_launchers';
  }
  if (path.startsWith(base + 'dlls/')) return 'base_dlls';
  if (path.startsWith(base)) return 'base_interpreter_and_support';
  if (path.endsWith('/pyvenv.cfg')) return 'venv_config';
  return 'venv_interpreter_and_support';
}

export function profileFiles(file) {
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  const classes = {};
  for (const entry of profile.files) {
    const name = fileClass(entry.path, profile);
    classes[name] ??= { files: 0, bytes: 0 };
    classes[name].files++;
    classes[name].bytes += entry.bytes;
  }
  return {
    files: profile.files.length,
    bytes: profile.files.reduce((sum, entry) => sum + entry.bytes, 0),
    classes,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(profileFiles(process.argv[2]), null, 2));
}

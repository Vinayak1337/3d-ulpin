// R5c owner check after the interpreter switch: where the demo's frozen region profile points and what it pins.
// Run from the demo checkout. It reads the path file through the runtime's own reader and the profile it names,
// and prints paths, counts and classes only: no profile contents, no hash of a pinned file.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const checkout = resolve(process.argv[2] ?? '');
const module = name => import(pathToFileURL(join(checkout, name)).href);
const { readDemoDocumentRuntime } = await module('scripts/platform/demo-config.mjs');
const { profileFiles } = await module('docs/evidence/gf1/k9/profile-files.mjs');
const expected = JSON.parse(readFileSync(join(checkout, 'docs/evidence/gf1/k9/environment.json'), 'utf8'));

const lower = path => path.replaceAll('\\', '/').toLowerCase();
const under = (path, folder) => lower(path).startsWith(lower(folder) + '/');
const paths = readDemoDocumentRuntime();
const profile = JSON.parse(readFileSync(paths.ULPIN_PACKET_REGIONS_PROFILE, 'utf8'));
const environment = expected.environment;
const data = 'E:/BhuAayam-data/ml';
const found = profileFiles(paths.ULPIN_PACKET_REGIONS_PROFILE);
const classNames = [...new Set([...Object.keys(found.classes), ...Object.keys(expected.frozenProfile.classes)])];

console.log(JSON.stringify({
  repo: profile.repo,
  repoIsTheDemoCheckout: lower(profile.repo) === lower(checkout),
  python: profile.python,
  pagesPythonIsTheSame: lower(paths.ULPIN_DOCUMENT_PAGES_PYTHON) === lower(profile.python),
  regionsPythonIsTheSame: lower(paths.ULPIN_PACKET_REGIONS_PYTHON) === lower(profile.python),
  base: profile.base,
  pythonInTheNewEnvironment: under(profile.python, environment),
  baseInTheNewEnvironment: under(profile.base, environment),
  pins: {
    files: found.files,
    bytes: found.bytes,
    underTheCheckout: profile.files.filter(entry => under(entry.path, checkout)).length,
    underDataMl: profile.files.filter(entry => under(entry.path, data)).length,
    elsewhere: profile.files.filter(entry => !under(entry.path, checkout) && !under(entry.path, data)).length,
  },
  classes: Object.fromEntries(classNames.map(name => [name, {
    files: found.classes[name]?.files ?? 0,
    k9Files: expected.frozenProfile.classes[name]?.files ?? 0,
  }])),
}));

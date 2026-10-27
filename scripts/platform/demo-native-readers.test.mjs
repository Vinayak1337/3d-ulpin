// Temporary folders only. Never opens real demo configuration, a runtime folder or a reader environment for writing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { nativeReaderKeys, readDemoNativeReaders, runtimeDefinition } from './demo-config.mjs';
import { buildNativeReaders, checkNativeReaders, defaultPython, defaultIfcPython,
  verifyReader } from './demo-native-readers.mjs';
import { root } from './runtime.mjs';

const marker = 'private-path-marker';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const realPython = process.platform === 'win32' && existsSync(defaultPython);

function temporaryFolder(context) {
  const folder = mkdtempSync(join(tmpdir(), 'demo-native-readers-'));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** Every file under the folder with the hash of its bytes: equal trees mean nothing was written or removed. */
function tree(folder) {
  const files = readdirSync(folder, { recursive: true }).map(name => join(folder, name));
  return Object.fromEntries(files.filter(file => statSync(file).isFile()).map(file => [file, hash(readFileSync(file))]));
}

function pathsFile(folder, paths) {
  const file = join(folder, 'native-reader-paths.json');
  writeFileSync(file, typeof paths === 'string' ? paths : JSON.stringify(paths));
  return file;
}

function refused(folder, paths, expected) {
  assert.throws(() => readDemoNativeReaders(pathsFile(folder, paths)), error => {
    assert.match(error.message, expected);
    for (const value of [marker, folder]) assert.ok(!error.message.includes(value), 'values never reach a message');
    return true;
  });
}

/** A synthetic environment folder whose pyvenv.cfg names the given base, with an empty site-packages. */
function environment(folder, name, home) {
  const env = join(folder, name);
  mkdirSync(join(env, 'Lib', 'site-packages'), { recursive: true });
  writeFileSync(join(env, 'pyvenv.cfg'), `home = ${home}\r\ninclude-system-site-packages = false\r\n`);
  return env;
}

test('every runtime names its own native reader path file beside its other path files', () => {
  assert.equal(runtimeDefinition().nativeReaderFile, join('E:/BhuAayam-data/runtime/ulpin-demo', 'native-reader-paths.json'));
  assert.equal(runtimeDefinition('ulpin-reh-02').nativeReaderFile,
    join('E:/BhuAayam-data/runtime/ulpin-reh-02', 'native-reader-paths.json'));
  assert.deepEqual(nativeReaderKeys('citygml'), ['ULPIN_CITYGML_PROFILE', 'ULPIN_CITYGML_PROFILE_SHA256']);
});

test('the path file is optional, each reader is whole or absent, and refusals name keys only', context => {
  const folder = temporaryFolder(context);
  assert.deepEqual(readDemoNativeReaders(join(folder, 'absent.json')), {});
  const profile = join(folder, `${marker}.json`);
  writeFileSync(profile, '{}');
  const dxf = { ULPIN_DXF_PROFILE: profile, ULPIN_DXF_PROFILE_SHA256: 'a'.repeat(64) };
  assert.deepEqual(readDemoNativeReaders(pathsFile(folder, dxf)), dxf);
  const all = Object.fromEntries(['dxf', 'citygml', 'gltf', 'obj', 'ifc'].flatMap(reader => {
    const [profileKey, hashKey] = nativeReaderKeys(reader);
    return [[profileKey, profile], [hashKey, 'b'.repeat(64)]];
  }));
  assert.deepEqual(readDemoNativeReaders(pathsFile(folder, all)), all);
  assert.deepEqual(readDemoNativeReaders(pathsFile(folder, {})), {});

  refused(folder, '{', /readable valid JSON/);
  refused(folder, [], /unexpected keys/);
  refused(folder, { ...dxf, ULPIN_UNKNOWN_PROFILE: profile }, /unexpected keys/);
  refused(folder, { ULPIN_IFC_PROFILE: profile }, /requires keys: ULPIN_IFC_PROFILE, ULPIN_IFC_PROFILE_SHA256/);
  refused(folder, { ULPIN_IFC_PROFILE: join(root, 'package.json'), ULPIN_IFC_PROFILE_SHA256: 'b'.repeat(64) },
    /inside a checkout: ULPIN_IFC_PROFILE/);
  refused(folder, { ULPIN_DXF_PROFILE: profile }, /requires keys: ULPIN_DXF_PROFILE, ULPIN_DXF_PROFILE_SHA256/);
  refused(folder, { ULPIN_OBJ_PROFILE_SHA256: 'a'.repeat(64) }, /requires keys: ULPIN_OBJ_PROFILE,/);
  refused(folder, { ...dxf, ULPIN_DXF_PROFILE_SHA256: marker }, /hash is invalid: ULPIN_DXF_PROFILE_SHA256/);
  refused(folder, { ...dxf, ULPIN_DXF_PROFILE: `${marker}.json` }, /unavailable or inside a checkout: ULPIN_DXF_PROFILE/);
  refused(folder, { ...dxf, ULPIN_DXF_PROFILE: join(folder, 'missing', marker) }, /ULPIN_DXF_PROFILE\.$/);
  refused(folder, { ...dxf, ULPIN_DXF_PROFILE: folder }, /ULPIN_DXF_PROFILE\.$/);
  refused(folder, { ...dxf, ULPIN_DXF_PROFILE: join(root, 'package.json') }, /inside a checkout: ULPIN_DXF_PROFILE/);
});

test('a normal build is refused in a worker checkout, and a dry run needs an external absolute folder', () => {
  // Supplying --out makes this refusal safe even if tests are run from the real, stopped demo checkout.
  assert.throws(() => buildNativeReaders({ out: marker }), /Normal native reader build requires the demo serving/);
  assert.throws(() => buildNativeReaders({ runtime: 'ulpin-reh-02', out: marker }), /ulpin-reh-02 serving checkout/);
  assert.throws(() => buildNativeReaders({ dryRun: true }), /--out/);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: marker }), /absolute temporary folder/);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: root }), /outside every checkout/);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: 'E:/BhuAayam-data/runtime/ulpin-demo' }),
    /not the shared runtime/);
});

test('an unusable interpreter is refused before anything is written, and the CLI never prints it', context => {
  const folder = temporaryFolder(context);
  const python = join(folder, `${marker}.exe`);
  writeFileSync(python, marker); // A file, but no CPython 3.13 install folder around it.
  const before = tree(folder);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: folder, python }), /interpreter unavailable/);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: folder, python: marker }), /interpreter unavailable/);
  assert.deepEqual(tree(folder), before, 'a refused build writes nothing');
  const child = spawnSync(process.execPath, [join(root, 'scripts/platform/demo-native-readers.mjs'), 'build',
    '--dry-run', '--out', folder, '--python', python], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Native reader interpreter unavailable/);
  for (const value of [marker, folder]) assert.ok(!(child.stdout + child.stderr).includes(value));
  for (const flags of [['check', '--out', folder], ['build', '--paths', folder], ['verify'], ['check', '--dry-run']]) {
    const refusal = spawnSync(process.execPath, [join(root, 'scripts/platform/demo-native-readers.mjs'), ...flags],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(refusal.status, 1);
    assert.match(refusal.stderr, /^Usage: demo-native-readers\.mjs/);
  }
});

test('each reader refuses the other Python version before writing anything', {
  skip: !realPython || !existsSync(defaultIfcPython),
}, context => {
  const folder = temporaryFolder(context);
  const before = tree(folder);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: folder, ifcPython: defaultPython },
    { readers: ['ifc'] }), /ifc requires CPython 3\.12/);
  assert.throws(() => buildNativeReaders({ dryRun: true, out: folder, python: defaultIfcPython },
    { readers: ['obj'] }), /obj requires CPython 3\.13/);
  const child = spawnSync(process.execPath, [join(root, 'scripts/platform/demo-native-readers.mjs'), 'build',
    '--dry-run', '--out', folder, '--ifc-python', defaultPython],
    { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /ifc requires CPython 3\.12/);
  assert.ok(!child.stderr.includes(folder));
  assert.deepEqual(tree(folder), before);
});

test('when no reader can be built, nothing is written to the pointer and each reader says why', {
  skip: !realPython,
}, context => {
  const folder = temporaryFolder(context);
  const result = buildNativeReaders({ dryRun: true, out: join(folder, 'out') },
    { readers: ['dxf', 'citygml'], environments: { dxf: join(folder, 'absent'), citygml: join(folder, 'absent') } });
  assert.equal(result.written, false);
  assert.deepEqual(result.readers.map(reader => [reader.reader, reader.status, reader.reason]), [
    ['dxf', 'unavailable', 'environment missing'], ['citygml', 'unavailable', 'environment missing']]);
  assert.ok(!existsSync(join(folder, 'out', 'native-reader-paths.json')));
});

test('IFC builds from offline wheels on its own base and its unchanged configuration accepts the profile', {
  skip: !existsSync(defaultIfcPython), timeout: 300000,
}, context => {
  const folder = temporaryFolder(context);
  const baseBefore = tree(dirname(defaultIfcPython));
  const result = buildNativeReaders({ dryRun: true, out: folder }, { readers: ['ifc'] });
  assert.deepEqual(tree(dirname(defaultIfcPython)), baseBefore, 'offline setup never changes the base');
  assert.equal(result.written, true);
  assert.equal(result.readers[0].status, 'built');
  const file = join(folder, 'native-reader-paths.json');
  const paths = readDemoNativeReaders(file);
  const profile = JSON.parse(readFileSync(paths.ULPIN_IFC_PROFILE, 'utf8'));
  assert.equal(resolve(profile.python).toLowerCase(), resolve(defaultIfcPython).toLowerCase());
  assert.ok(resolve(profile.environmentRoot).startsWith(resolve(folder)));
  assert.equal(verifyReader('ifc', paths.ULPIN_IFC_PROFILE, paths.ULPIN_IFC_PROFILE_SHA256), null);
  assert.equal(verifyReader('ifc', paths.ULPIN_IFC_PROFILE, 'c'.repeat(64)), 'IFC_TOOL_CHANGED');
  assert.deepEqual(checkNativeReaders({ paths: file }).map(entry => entry.status),
    ['unconfigured', 'unconfigured', 'unconfigured', 'unconfigured', 'verified']);
});

test('one reader that cannot be built is reported and the others still build and verify', {
  skip: !realPython, timeout: 300000,
}, context => {
  const folder = temporaryFolder(context);
  const out = join(folder, 'out');
  const environments = {
    dxf: environment(folder, 'dxf-env', dirname(defaultPython)), // The right base, but no locked package.
    citygml: join(folder, 'absent-env'),
    gltf: environment(folder, 'gltf-env', folder), // Made from another interpreter.
  };
  const result = buildNativeReaders({ dryRun: true, out },
    { environments, readers: ['dxf', 'citygml', 'gltf', 'obj'] });
  assert.equal(result.written, true);
  const [dxf, citygml, gltf, obj] = result.readers;
  assert.equal(dxf.status, 'unavailable');
  assert.match(dxf.reason, /^environment lacks locked packages: ezdxf==1\.4\.3, numpy==2\.3\.2/);
  assert.deepEqual(citygml, { reader: 'citygml', status: 'unavailable', reason: 'environment missing' });
  assert.deepEqual(gltf, { reader: 'gltf', status: 'unavailable', reason: 'environment made from another interpreter' });
  assert.equal(obj.status, 'built');
  assert.ok(obj.files > 0);

  const file = join(out, 'native-reader-paths.json');
  assert.equal(result.pathsSha256, hash(readFileSync(file)));
  const paths = readDemoNativeReaders(file);
  assert.deepEqual(Object.keys(paths), ['ULPIN_OBJ_PROFILE', 'ULPIN_OBJ_PROFILE_SHA256']);
  assert.equal(hash(readFileSync(paths.ULPIN_OBJ_PROFILE)), obj.profileSha256);
  const profile = JSON.parse(readFileSync(paths.ULPIN_OBJ_PROFILE, 'utf8'));
  assert.equal(resolve(profile.repositoryRoot).toLowerCase(), resolve(root).toLowerCase());
  assert.deepEqual(checkNativeReaders({ paths: file }).map(entry => entry.status),
    ['unconfigured', 'unconfigured', 'unconfigured', 'verified', 'unconfigured']);

  // The reader's own configuration still refuses a wrong hash and a profile bound to another checkout.
  assert.equal(verifyReader('obj', paths.ULPIN_OBJ_PROFILE, 'c'.repeat(64)), 'OBJ_TOOL_CHANGED');
  const moved = join(folder, 'moved-profile.json');
  const bytes = Buffer.from(JSON.stringify({ ...profile, repositoryRoot: folder }));
  writeFileSync(moved, bytes);
  assert.equal(verifyReader('obj', moved, hash(bytes)), 'OBJ_TOOL_CHANGED');
  assert.throws(() => buildNativeReaders({ dryRun: true, out }), /already contains native reader keys/);
});

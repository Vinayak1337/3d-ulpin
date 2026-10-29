// Ported from E:/ulpin-tmp/s1-3/scripts/manifest.mjs (size/hash preflight), with closed-kit guards.
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { win32 } from 'node:path';

export function allowedPath(value) {
  if (typeof value !== 'string' || !/^e:[/\\]/i.test(value) || /[:\x00-\x1f]/.test(value.slice(2))) {
    throw new Error('Only absolute E: paths are allowed');
  }
  const path = win32.normalize(value).replaceAll('\\', '/');
  if (path.split('/').some(part => /[. ]$|~[0-9]/.test(part))
    || /(^|\/)(holdout|heldout|evaluator|provisional|acquisitions|runtime|keys|credentials)(\/|$)/i.test(path)
    || /(^|\/)(\.env[^/]*|[^/]*\.env)$/i.test(path)) throw new Error('Protected path refused');
  return path;
}

export async function checkedPath(value) {
  const path = allowedPath(value); // Refuse the closed folder before any filesystem operation.
  return allowedPath(await realpath(path)); // Also refuse aliases/junctions into protected trees.
}

export function runtimePlan(runtime, out) {
  if (!/^ulpin-reh-[0-9]{2}$/.test(runtime ?? '') || runtime.length !== 12 || runtime === 'ulpin-reh-01') {
    throw new Error('Expected ulpin-reh-NN; demo and protected reh-01 are refused');
  }
  out = allowedPath(out);
  if (!out.toLowerCase().startsWith('e:/ulpin-tmp/')) throw new Error('Output must be under E:/ulpin-tmp');
  return { runtime, apiPort: 21006 + Number(runtime.slice(-2)) * 10, studioPort: 5189, out,
    result: `${out}/result.json`, buildLog: `${out}/build.log`, previewLog: `${out}/preview.log` };
}

export async function readAnswers(path, runtime) {
  runtimePlan(runtime, 'E:/ulpin-tmp/answers-guard');
  const body = JSON.parse(await readFile(await checkedPath(win32.resolve(path)), 'utf8'));
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const names = new Set();
  if (body?.version !== 'rehearsal-officer-answers/1' || body.test_only !== true
    || !Array.isArray(body.answers) || !body.answers.length) throw new Error('Invalid rehearsal officer answers');
  for (const answer of body.answers) {
    const byField = text(answer?.identifierField) && answer.identifierBy === undefined;
    const byPosition = answer?.identifierField === null && answer.identifierBy === 'position';
    if (!answer || !text(answer.file) || !text(answer.kind) || !(byField || byPosition)
      || !(answer.nameField === null || text(answer.nameField)) || names.has(answer.file)) {
      throw new Error('Invalid or duplicate rehearsal officer answer fields');
    }
    names.add(answer.file);
  }
  return body;
}

const closedRoot = 'E:/BhuAayam-data/holdout/judge-kit-closed';

function closedPath(value, root) {
  const path = win32.normalize(value).replaceAll('\\', '/');
  const prefix = `${root.toLowerCase()}/`;
  if (!path.toLowerCase().startsWith(prefix)) throw new Error('Protected path refused');
  allowedPath(`E:/closed-kit/${path.slice(prefix.length)}`); // Only the sealed root's holdout segment is exempt.
  return path;
}

async function checkedClosedPath(value, root) {
  const path = closedPath(value, root);
  const canonical = closedPath(await realpath(path), root);
  if (canonical.toLowerCase() !== path.toLowerCase()) throw new Error('Protected path refused');
  return canonical;
}

async function closedAdmission(admission, testSeal) {
  const plan = runtimePlan(admission.runtime, admission.out);
  let ancestor = plan.out;
  while (true) {
    try {
      const canonical = await checkedPath(ancestor);
      runtimePlan(plan.runtime, win32.resolve(canonical, win32.relative(ancestor, plan.out)));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = win32.dirname(ancestor);
    }
  }
  // Injection is an in-process test parameter only, never a CLI option or environment setting.
  const { sealedManifestSha256, fileCount } = testSeal ?? JSON.parse(await readFile(
    new URL('../../docs/evidence/step-2/s2-3/result.json', import.meta.url), 'utf8'));
  return { root: testSeal?.root ?? closedRoot, sealedManifestSha256, fileCount };
}

export async function readKit(manifest, verifyHash = false, admission = {}, testSeal) {
  const closed = admission.closedKit === true;
  try {
    return await readManifest(manifest, verifyHash, closed ? await closedAdmission(admission, testSeal) : null);
  } catch (error) {
    if (closed && (error.code || error instanceof SyntaxError || error instanceof TypeError)) {
      throw new Error('Closed-kit preflight failed; no file names copied');
    }
    throw error;
  }
}

async function readManifest(manifest, verifyHash, seal) {
  const check = seal ? value => checkedClosedPath(value, seal.root) : checkedPath;
  const path = win32.resolve(manifest);
  if (seal && win32.dirname(path).replaceAll('\\', '/').toLowerCase() !== seal.root.toLowerCase()) {
    throw new Error('Protected path refused');
  }
  const manifestPath = await check(path);
  const bytes = await readFile(manifestPath);
  if (seal && createHash('sha256').update(bytes).digest('hex') !== seal.sealedManifestSha256) {
    throw new Error('Sealed manifest hash mismatch');
  }
  const body = JSON.parse(bytes.toString('utf8'));
  const base = win32.resolve(win32.dirname(manifestPath), body.root ?? '.');
  const entries = body.entries ?? body.files;
  if (!Array.isArray(entries) || !entries.length) throw new Error('Expected nonempty entries or files');
  if (seal && entries.length !== seal.fileCount) throw new Error('Sealed manifest entry count mismatch');
  const allow = seal ? value => closedPath(value, seal.root) : allowedPath;
  const files = entries.map(entry => ({ path: allow(win32.resolve(base, entry.path)),
    bytes: entry.bytes, sha256: entry.sha256, family: entry.family }));
  return verifyFiles(files, verifyHash, check, Boolean(seal));
}

async function verifyFiles(files, verifyHash, check, closed) {
  const names = new Set();
  for (const file of files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/i.test(file.sha256 ?? '')
      || file.sha256.length !== 64 || typeof file.family !== 'string' || !file.family.trim()) {
      throw new Error('Invalid manifest entry');
    }
    file.path = await check(file.path);
    const name = win32.basename(file.path).toLowerCase();
    if (names.has(name)) throw new Error('Duplicate file names cannot be correlated safely');
    names.add(name);
    const info = await stat(file.path);
    if (!info.isFile() || info.size !== file.bytes) {
      throw new Error(`Size mismatch: ${closed ? 'closed-kit entry' : file.path}`);
    }
    if (verifyHash) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file.path)) hash.update(chunk);
      if (hash.digest('hex') !== file.sha256.toLowerCase()) {
        throw new Error(`Hash mismatch: ${closed ? 'closed-kit entry' : file.path}`);
      }
    }
  }
  return files;
}

/** Reproducible, source-checked inventory of the seven GF0 shared seams. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Current source inventory is separate from the immutable historical milestone receipt.
export const inventoryPath = 'docs/engineering-plan/contract-inventory.json';
const unit = 'pnpm exec tsx --test tests/usp-*.test.ts';
const live = 'node scripts/usp/local-isolation.mjs --run';

// A declared file is not enough: each marker names the implementation or import
// that makes the producer/consumer relationship observable in current source.
export const seams = [
  {
    id: 'schema', producer: 'packages/contracts/src/usp/domain.ts', producerMarker: 'UspSnapshotManifestSchema',
    consumer: 'apps/web/app/api/v1/usp/[...path]/route.ts', consumerMarker: 'parseUsp(UspCaptureSnapshotRequestSchema',
    contract: 'packages/contracts/src/usp/common.ts', contractMarker: "USP_SCHEMA_VERSION = 'usp/1'",
    test: 'tests/usp-contract-producers.test.ts', testMarker: 'UspJobProjectionSchema',
    testCommand: unit, declaredStatus: 'partial',
    evidence: 'Snapshot, target, job and result DTOs are parsed by current routes/tests.',
    limitation: 'UspPorts still declares upload, model, scanner and delivery operations without live bindings; this row does not qualify every declared port.',
  },
  {
    id: 'registry', producer: 'packages/server/src/modules/usp/snapshots.ts', producerMarker: 'captureRegistrySnapshotTx',
    consumer: 'apps/web/app/api/v1/usp/[...path]/route.ts', consumerMarker: 'captureRegistrySnapshot(ctx',
    contract: 'packages/contracts/src/usp/domain.ts', contractMarker: 'UspScopePageSchema',
    test: 'scripts/usp/verify-live.ts', testMarker: 'snapshot',
    testCommand: live, declaredStatus: 'works',
    evidence: 'Local route captures pinned registry/source membership; live runner checks exact reads, vertical membership and packet scope.',
    limitation: 'Historical D0 result must be rerun at this code revision; this is local operator scope only.',
  },
  {
    id: 'source', producer: 'packages/server/src/modules/usp/snapshots.ts', producerMarker: 'readRegistryEvidenceBytes',
    consumer: 'apps/web/app/api/v1/usp/[...path]/route.ts', consumerMarker: 'readRegistryEvidenceBytes(ctx',
    contract: 'packages/contracts/src/usp/common.ts', contractMarker: 'UspEvidencePointerSchema',
    test: 'scripts/usp/data/verify-pack.ts', testMarker: 'verifyUspPack',
    testCommand: 'pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D4/gf0-context-v1/manifest.json', declaredStatus: 'partial',
    evidence: 'The retained D4 source pack verifies unchanged original bytes against its manifest.',
    limitation: 'The historical D0 exact-part runtime replay was retired with its authored inputs; current endpoint behavior needs a new real-source isolated run.',
  },
  {
    id: 'geometry', producer: 'packages/server/src/modules/usp/external-scene.ts', producerMarker: 'decodeCityJsonRoof',
    consumer: 'apps/web/features/usp/shared/ExternalSceneViewport.tsx', consumerMarker: "kind: 'external_asset'",
    contract: 'packages/server/src/modules/usp/external/external-scene.ts', contractMarker: "schemaVersion: 'usp-external-roof/1'",
    test: 'tests/e2e/usp-d1-journey.spec.ts', testMarker: 'sourceFaceIndex',
    testCommand: live, declaredStatus: 'partial',
    evidence: 'A retained CityJSON exterior is decoded and displayed through the shared MapViewport/Cesium path.',
    limitation: 'This display profile is local-frame only; analytical solids, global placement and wider source coverage are unqualified.',
  },
  {
    id: 'job', producer: 'packages/server/src/modules/usp/jobs.ts', producerMarker: 'claimUspJobAttempt',
    consumer: null, consumerMarker: null,
    contract: 'packages/contracts/src/usp/domain.ts', contractMarker: 'UspJobProjectionSchema',
    test: 'scripts/usp/verify-live.ts', testMarker: 'acceptUspJobAttempt',
    testCommand: live, declaredStatus: 'partial',
    evidence: 'The isolated SQL runner exercises lease, fence, stale completion, idempotent accept and cancel.',
    limitation: 'No production caller of the USP attempt functions was found; the existing dispatcher does not yet consume this USP fence API. Test-only use is not production wiring.',
  },
  {
    id: 'sse', producer: 'packages/server/src/modules/usp/commands.ts', producerMarker: 'appendUspOutboxTx',
    consumer: null, consumerMarker: null,
    contract: 'packages/contracts/src/usp/ports.ts', contractMarker: 'UspOutboxEventSchema',
    test: 'scripts/usp/verify-live.ts', testMarker: 'outbox',
    testCommand: live, declaredStatus: 'missing',
    evidence: 'Commands write an ordered outbox row in the current transaction.',
    limitation: 'No USP outbox delivery/SSE endpoint or production stream consumer was found. The outbox alone does not provide SSE.',
  },
  {
    id: 'ui', producer: 'apps/web/features/usp/shared/Packet0Action.tsx', producerMarker: 'UspSnapshotManifestSchema',
    consumer: 'apps/web/features/studio/product/SavedSceneViewport.tsx', consumerMarker: 'ExternalSceneViewport',
    contract: 'apps/web/features/spatial/MapViewport.tsx', contractMarker: "kind: 'external_asset'",
    test: 'tests/e2e/usp-product-journey.spec.ts', testMarker: 'packet',
    testCommand: live, declaredStatus: 'partial',
    evidence: 'Existing functional Studio route uses scoped PACK0 selection and the one shared viewport for D0/D1.',
    limitation: 'This is the retained functional test UI; formal redesign is deferred. Full selection generation/access cache contract remains unqualified.',
  },
];

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function checkedFile(root, path, marker) {
  if (!path) return null;
  try {
    const bytes = await readFile(resolve(root, path));
    return { path, sha256: sha256(bytes), markerFound: bytes.toString('utf8').includes(marker) };
  } catch (error) {
    if (error.code === 'ENOENT') return { path, sha256: null, markerFound: false };
    throw error;
  }
}

export async function inspectSeam(root, spec) {
  const [producer, consumer, contract, test] = await Promise.all([
    checkedFile(root, spec.producer, spec.producerMarker),
    checkedFile(root, spec.consumer, spec.consumerMarker),
    checkedFile(root, spec.contract, spec.contractMarker),
    checkedFile(root, spec.test, spec.testMarker),
  ]);
  const problems = [];
  for (const [role, file] of Object.entries({ producer, consumer, contract, test })) {
    if (file && !file.sha256) problems.push(`${role}_file_missing`);
    else if (file && !file.markerFound) problems.push(`${role}_marker_missing`);
  }
  if (!spec.consumer) problems.push('production_consumer_not_found');
  if (!spec.test) problems.push('test_not_found');
  return {
    id: spec.id, producer: spec.producer, consumer: spec.consumer, contract: spec.contract,
    test: spec.test, testCommand: spec.testCommand,
    status: problems.some(problem => problem !== 'production_consumer_not_found') ? 'missing'
      : !spec.consumer && spec.declaredStatus === 'works' ? 'partial' : spec.declaredStatus,
    evidence: spec.evidence, limitation: spec.limitation, problems,
    fileEvidence: { producer, consumer, contract, test },
  };
}

export async function buildInventory(root = repositoryRoot, specs = seams) {
  return { schemaVersion: 'gf-contract-inventory/1', rows: await Promise.all(specs.map(spec => inspectSeam(root, spec))) };
}

export async function writeInventory(root = repositoryRoot, path = inventoryPath, specs = seams) {
  const value = JSON.stringify(await buildInventory(root, specs), null, 2) + '\n';
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), value);
  return value;
}

export async function checkInventory(root = repositoryRoot, path = inventoryPath, specs = seams) {
  const expected = JSON.stringify(await buildInventory(root, specs), null, 2) + '\n';
  const actual = await readFile(resolve(root, path), 'utf8');
  if (actual !== expected) throw new Error('GF-CONTRACT inventory is stale or modified; regenerate it from current source');
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--write', '--check'].includes(mode)) {
    console.error('Usage: node scripts/usp/gf/GF-CONTRACT.mjs --write|--check');
    process.exitCode = 2;
  } else {
    try {
      if (mode === '--write') await writeInventory();
      else await checkInventory();
      console.log(`GF-CONTRACT inventory ${mode === '--write' ? 'written' : 'current'}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

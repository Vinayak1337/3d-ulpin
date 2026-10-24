import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import type { RequestContext } from '../../../../packages/contracts/src/usp';
import { UspTextPacketPlanSchema, type PacketPlan } from '../../../../packages/contracts/src/usp/packets';
import type { PropertyCard } from '../../../../packages/contracts/src/usp/property-card';
import { transaction } from '../../../../packages/server/src/infrastructure/db';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { canonical, fingerprint } from '../../../../packages/server/src/modules/cases/domain';
import { renderPropertyCard } from '../../../../packages/server/src/modules/usp/packets/card-render';

const baseline = 'bfc2e45d';
const packetRoot = 'packages/server/src/modules/usp/';
const files = ['packets/plan-authority.ts', 'packets/card-projection.ts', 'packet0.ts', 'packets/card-render.ts'];

function relocateImports(source: string, original: string, scratch: string, destinations: Map<string, string>) {
  const require = createRequire(original);
  return source.replace(/\bfrom (['"])([^'"]+)\1/g, (statement, quote, specifier) => {
    if (specifier.startsWith('node:')) return statement;
    const target = specifier.startsWith('.')
      ? resolve(dirname(original), specifier) : require.resolve(specifier);
    const redirected = destinations.get(`${target}.ts`) ?? target;
    const path = relative(scratch, redirected).replaceAll('\\', '/');
    return `from ${quote}${path.startsWith('.') ? path : `./${path}`}${quote}`;
  });
}

async function loadBefore() {
  const scratch = resolve(`docs/evidence/gf1/cb1/.legacy-${randomUUID()}`);
  mkdirSync(scratch);
  const destinations = new Map(files.map(file =>
    [resolve(packetRoot + file), resolve(scratch, file.replaceAll('/', '-'))]));
  const pins: Record<string, string> = {};
  try {
    for (const [original, destination] of destinations) {
      const key = relative(process.cwd(), original).replaceAll('\\', '/');
      const source = execFileSync('git', ['show', `${baseline}:${key}`]);
      pins[key] = sha256(source);
      writeFileSync(destination, relocateImports(source.toString(), original, scratch, destinations), { flag: 'wx' });
    }
    const modules = await Promise.all([...destinations.values()].map(path => import(pathToFileURL(path).href)));
    return { modules, pins, cleanup: () => rmSync(scratch, { recursive: true }) };
  } catch (error) {
    rmSync(scratch, { recursive: true });
    throw error;
  }
}

function seededPdf(render: typeof renderPropertyCard, card: PropertyCard) {
  const original = Math.random;
  try {
    let seed = 12345;
    Math.random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return Buffer.from(render(card));
  } finally {
    Math.random = original;
  }
}

async function compare(client: PoolClient, ctx: RequestContext, plan: PacketPlan, card: PropertyCard,
  packet: Uint8Array, before: Awaited<ReturnType<typeof loadBefore>>) {
  const [authority, projection, packetRenderer, cardRenderer] = before.modules;
  const assessment = await authority.assessPlanTx(client, ctx, plan.input);
  const { planSha256, ...body } = plan;
  const legacyBody = { ...body, targetBodySha256: assessment.targetBodySha256,
    targetLabel: assessment.targetLabel, entries: assessment.entries, requiredContext: assessment.requiredContext };
  const legacyPlan = UspTextPacketPlanSchema.parse({ ...legacyBody, planSha256: fingerprint(legacyBody) });
  assert.equal(canonical(legacyPlan), canonical(plan));
  const legacyPacket = Buffer.from(packetRenderer.renderPacket0(
    { id: plan.input.target.ref.id, label: legacyPlan.targetLabel }, assessment.lines, plan.input.format));
  assert.deepEqual(legacyPacket, Buffer.from(packet));
  const legacyCard = { ...card, ...await projection.projectCardFactsTx(client, ctx, legacyPlan) };
  assert.equal(canonical(legacyCard), canonical(card));
  const oldPdf = seededPdf(cardRenderer.renderPropertyCard, legacyCard);
  const newPdf = seededPdf(renderPropertyCard, card);
  assert.deepEqual(oldPdf, newPdf);
  return { baseline, baselineModuleSha256: before.pins, planSha256, packetSha256: sha256(packet),
    cardBodySha256: fingerprint(card), pairedPdfSha256: sha256(newPdf), byteIdentical: true,
    qualification: 'Original staging authority, projection and renderers evaluated against the same real '
      + 'PostgreSQL snapshot as the issued current artifacts. Shared issued protocol metadata; '
      + 'seeded paired PDF entropy. '
      + 'This is a baseline-code comparison, not an independently issued pre-edit PostgreSQL card.' };
}

export async function compareNycPostgres(ctx: RequestContext, plan: PacketPlan,
  card: PropertyCard, packet: Uint8Array) {
  const before = await loadBefore();
  try {
    return await transaction(client => compare(client, ctx, plan, card, packet, before));
  } finally {
    before.cleanup();
  }
}

if (process.argv.includes('--load-only')) {
  loadBefore().then(before => {
    before.cleanup();
    console.log(JSON.stringify({ baseline, loadedModules: before.modules.length, scratchRemoved: true }));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

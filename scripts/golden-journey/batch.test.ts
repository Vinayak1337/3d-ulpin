import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBatch } from './batch';
import { Reader } from './read';
import { options } from './run';
import { fixtureCase, fixtureId, fixtureResponses, fixturePdf } from './batch.fixtures';

async function offline(responses: Record<string, unknown>, caseId?: string) {
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, 'GET', 'Every batch request must be GET, including card discovery');
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    requests.push(path);
    assert(path in responses, `No recorded fixture for ${path}`);
    const body = responses[path];
    if (body instanceof Error) throw body;
    if (body instanceof Response) return body;
    if (body instanceof Uint8Array) {
      return new Response(new Uint8Array(body).buffer, { headers: { 'content-type': 'application/pdf' } });
    }
    return Response.json(body);
  };
  const reader = new Reader('http://127.0.0.1:3194', true);
  try {
    const steps = await runBatch(reader, caseId);
    return { steps, requests, reader };
  } finally {
    globalThis.fetch = original;
  }
}

const evidencePath = `/api/v1/ingestion/cases/${fixtureCase}/intake/evidence`;

test('recorded test_only batch walks table, both surface placements, confirmation, card and quoted row', async () => {
  const { steps, reader } = await offline(fixtureResponses());
  assert.deepEqual(steps.map(step => [step.id, step.state]),
    ['batch', 'items', 'table', 'surfaces', 'evidence', 'confirmation', 'card', 'citation']
      .map(id => [id, 'pass']));
  const surfaces = steps.find(step => step.id === 'surfaces')!.observed as {
    surfaces: { placed: number; notPlaced: number }[] };
  assert.deepEqual(surfaces.surfaces.map(surface => [surface.placed, surface.notPlaced]), [[1, 0], [0, 1]]);
  assert(reader.reads.every(read => read.method === 'GET'));
  assert(steps.every(step => step.evidence.length > 0));
});

test('--case bypasses discovery; default ignores newer empty workspaces and archived cases', async () => {
  const explicit = await offline(fixtureResponses(), fixtureCase);
  assert(!explicit.requests.includes('/api/v1/cases'));
  const fixtures = fixtureResponses();
  const empty = fixtureId(40);
  fixtures['/api/v1/cases'] = [
    { id: fixtureId(41), archived: true, createdAt: '2026-10-22T12:00:00Z' },
    { id: empty, archived: false, createdAt: '2026-10-21T12:00:00Z' },
    { id: fixtureCase, archived: false, createdAt: '2026-10-20T12:00:00Z' },
  ];
  fixtures[`/api/v1/ingestion/cases/${empty}/intake`] = { caseId: empty, items: [] };
  const { steps, requests } = await offline(fixtures);
  assert.equal(steps[0].state, 'pass');
  assert(requests.includes(`/api/v1/ingestion/cases/${empty}/intake`));
  assert(!requests.some(path => path.includes(fixtureId(41))));
});

test('empty or offline demo skips without fabricating a failed batch', async () => {
  for (const body of [[], new Error('fixture-only connection refused')]) {
    const { steps } = await offline({ '/api/v1/cases': body });
    assert(steps.every(step => step.state === 'skipped'));
    assert(steps.every(step => /No |nothing|unreadable|readable|manifest/i.test(JSON.stringify(step.observed))));
  }
});

test('partial coverage preserves unknown counts, and missing confirmation and card are skipped', async () => {
  const fixtures = fixtureResponses();
  const evidence = fixtures[evidencePath] as { sources: { coverage: unknown }[]; confirmations: unknown[] };
  evidence.sources[0].coverage = {
    state: 'partial', read: 1, eligible: null, keyless: null, unread: null, failed: null,
  };
  evidence.confirmations = [];
  const targetsPath = `/api/v1/ingestion/cases/${fixtureCase}/targets?readiness=carded`;
  (fixtures[targetsPath] as { items: unknown[] }).items = [];
  const { steps } = await offline(fixtures);
  assert.equal(steps.find(step => step.id === 'evidence')!.state, 'undecidable');
  assert(JSON.stringify(steps.find(step => step.id === 'evidence')!.observed).includes('"unread":null'));
  assert.equal(steps.find(step => step.id === 'confirmation')!.state, 'skipped');
  assert.equal(steps.find(step => step.id === 'card')!.state, 'skipped');
  assert.equal(steps.find(step => step.id === 'citation')!.state, 'skipped');
});

test('inconsistent verification or a PDF quoting another row fails; authorization stays undecidable', async () => {
  const wrongQuote = fixtureResponses();
  wrongQuote[`/api/v1/usp/property-cards/${fixtureId(29)}/revisions/1`] = fixturePdf('fixture_key: ANOTHER-ROW');
  const result = await offline(wrongQuote);
  assert.equal(result.steps.find(step => step.id === 'citation')!.state, 'fail');
  const denied = fixtureResponses();
  denied[evidencePath] = Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  const refused = await offline(denied);
  assert.equal(refused.steps.find(step => step.id === 'evidence')!.state, 'undecidable');
  const inconsistent = fixtureResponses();
  const path = `/api/v1/usp/property-cards/${fixtureId(29)}/revisions/1/verification`;
  const report = inconsistent[path] as {
    data: { result: string; checks: { state: string; reasonCode: string | null }[] },
  };
  report.data.result = 'inconsistent';
  report.data.checks[5] = { ...report.data.checks[5], state: 'fail', reasonCode: 'fixture_packet_changed' };
  const failed = await offline(inconsistent);
  assert.equal(failed.steps.find(step => step.id === 'card')!.state, 'fail');
});

test('carried target pages are followed and the stored card advances to its newest verified revision', async () => {
  const fixtures = fixtureResponses();
  const targetsPath = `/api/v1/ingestion/cases/${fixtureCase}/targets?readiness=carded`;
  const newestPage = structuredClone(fixtures[targetsPath]);
  const firstPage = fixtures[targetsPath] as {
    items: { targetId: string; updatedAt: string; artefacts: { card: { id: string } } }[]; nextCursor: string | null,
  };
  firstPage.items[0].targetId = fixtureId(40);
  firstPage.items[0].updatedAt = '2026-10-19T12:00:00.000Z';
  firstPage.items[0].artefacts.card.id = fixtureId(41);
  firstPage.nextCursor = fixtureId(40);
  fixtures[targetsPath + '&cursor=' + fixtureId(40)] = newestPage;
  const prefix = `/api/v1/usp/property-cards/${fixtureId(29)}/revisions/`;
  const oldReport = fixtures[prefix + '1/verification'] as {
    data: { revision: number; lifecycle: { latestRevision: number; superseded: boolean } },
  };
  oldReport.data.lifecycle = { ...oldReport.data.lifecycle, latestRevision: 2, superseded: true };
  const newestReport = structuredClone(oldReport);
  newestReport.data.revision = 2;
  newestReport.data.lifecycle.superseded = false;
  fixtures[prefix + '2/verification'] = newestReport;
  fixtures[prefix + '2'] = fixturePdf();
  const { steps, requests, reader } = await offline(fixtures);
  assert.equal(steps.find(step => step.id === 'card')!.state, 'pass');
  assert.equal(steps.find(step => step.id === 'citation')!.state, 'pass');
  const pins = reader.reads.filter(read => read.route.at(-1) === 'verification').map(read => read.params.revision);
  assert.deepEqual(pins, [1, 2], 'Advancing a card must not rewrite the earlier read evidence pin');
  assert(requests.includes(prefix + '2/verification'));
  assert(requests.includes(prefix + '2'));
});

test('an older citation without a stored excerpt skips rather than inventing or failing a quote', async () => {
  const fixtures = fixtureResponses();
  const path = `/api/v1/registry-records/${fixtureId(27)}/revisions/2/document-citations`;
  const record = fixtures[path] as { citations: { pin: { excerpt?: string } }[] };
  delete record.citations[0].pin.excerpt;
  const { steps, requests } = await offline(fixtures);
  assert.equal(steps.find(step => step.id === 'citation')!.state, 'skipped');
  assert(!requests.includes(`/api/v1/usp/property-cards/${fixtureId(29)}/revisions/1`));
});

test('GET-only reader and CLI reject writes and invalid selection before any request', async () => {
  assert.throws(() => options(['--write']), /Write mode/);
  assert.throws(() => options(['--case']), /needs a value/);
  assert.throws(() => options(['--case', 'not-a-case']), /UUID/);
  assert.equal(options(['--profile', 'demo', '--case', fixtureCase]).caseId, fixtureCase);
  const reader = new Reader('http://127.0.0.1:3194', true);
  await assert.rejects(reader.postRead('/api/v1/usp/property-cards/list', {}), /GET-only/);
  assert.equal(reader.reads.length, 0);
});

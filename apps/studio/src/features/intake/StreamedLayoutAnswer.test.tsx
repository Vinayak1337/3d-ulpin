import { button, container, elements, propsOf } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import runtime from '../../../../../docs/evidence/gf1/lr3/runtime.json';
import type { IntakeItem } from './batch-model';
import { LayoutQuestion } from './LayoutQuestion';
import { createContractValidator } from '../../local/contract';
import { createLayoutCommand } from './layout-command';
import { layoutLines, type Recipe } from './layout-model';
import { answerSummary, blankChoices, choicesFromRecipe, needsLayoutAnswer, questionBody, type Choices, type Kind,
  type MapProfile } from './question-model';
import { intakeKey } from './batch-queries';
import { readingKey } from './reading-model';
import { tableKey } from './table/queries';
import { LayoutAnswer, type Command } from './LayoutAnswer';
import { StreamedLayoutAnswer } from './StreamedLayoutAnswer';
import { inventoryWords, streamedIdentifierPaths, streamedIdentifierWords, streamedNamePaths, streamedQuestionBody,
  streamedSummary, type Inventory, type ProfileStatus } from './streamed-question-model';
import { useLayoutCommand } from './useLayoutCommand';

// The real body is kept; the spy only records the pin the answer hands it.
vi.mock('./streamed-question-model', async original => {
  const real = await original<typeof import('./streamed-question-model')>();
  return { ...real, streamedQuestionBody: vi.fn(real.streamedQuestionBody) };
});

// The OBJECTID counts and the generation are LR3's sealed Niagara inventory. Every other value below is an
// in-memory test control, not a dataset record.
const niagara = runtime.runtime.evidence.evidence.niagara.layout.profile;
const objectId = niagara.identifier as Inventory['paths'][number];
const hash = 'c'.repeat(64);
const control = (path: string, types: Inventory['paths'][number]['types'], extra = {}) => ({
  path: `/features/*/properties/${path}`, types, values: objectId.values, explicitNull: 0, absent: 0, unknown: 0,
  ...extra });
const inventory: Inventory = {
  version: 'streamed-profile/1', jobId: niagara.jobId, rawJobId: '20000000-0000-4000-8000-000000000002',
  source: { sourceId: '20000000-0000-4000-8000-000000000003', familyId: '20000000-0000-4000-8000-000000000004',
    sourceRevision: 1, sourceSha256: 'a'.repeat(64), schemaFingerprint: hash },
  readerSha256: 'b'.repeat(64), profilerSha256: 'b'.repeat(64), generation: niagara.generation,
  generationHash: hash, previousHash: null, coverage: 'sealed', rawChunkIndex: null, rawResultSha256: null,
  recordsSeen: niagara.recordsSeen, accepted: objectId.values, quarantined: objectId.unknown, unknownRemainder: false,
  paths: [
    { path: '/features/*/geometry', types: ['object'], values: objectId.values, explicitNull: 0, absent: 0,
      unknown: 0 },
    objectId, control('TEXT_CONTROL', ['string']), control('MIXED_CONTROL', ['number', 'string']),
    control('DECIMAL_CONTROL', ['number'], { integers: 3 }), control('UNCOUNTED_CONTROL', ['number']),
  ],
  geometryTypes: ['Polygon', 'MultiPolygon'], quarantineLocators: [],
  reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' },
};
const pin = { caseId: '20000000-0000-4000-8000-000000000005', caseRevision: 7 };
const key = '20000000-0000-4000-8000-000000000006';
const field = (name: string) => `/features/*/properties/${name}`;
const choices: Choices = { ...blankChoices, kind: 'building', identifier: field('OBJECTID') };
const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const ref = (schema: { $ref: string }) => schema.$ref.split('/').at(-1)!;
const authorSchema = ref(openapi.paths[
  '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes']
  .post.requestBody.content['application/json'].schema);
const historySchema = ref(openapi.paths['/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}']
  .get.responses['200'].content['application/json'].schema);
const prefixSchema = ref(openapi.paths[
  '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/prefix-recipes']
  .post.requestBody.content['application/json'].schema);
const statusSchema = ref(openapi.paths[
  '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}']
  .get.responses['200'].content['application/json'].schema);

/** One named function of a repository source file, transpiled as written (the KN2 test's method). */
function sourceFunction<T>(path: string, name: string, end: string): T {
  const source = readFileSync(resolve(root, path), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  const code = ts.transpile(source.slice(start, source.indexOf(end, start)), { target: ts.ScriptTarget.ES2022 });
  return new Function(`${code}; return ${name};`)() as T;
}
const layoutTargetsIssue = sourceFunction<(kind: string | undefined, targets: string[]) => string | null>(
  'packages/contracts/src/usp/ingestion.ts', 'layoutTargetsIssue', 'export const MappingPlanSchema');

it('opens both answers from the NYC reading, keeps edits on a late reading, and sends only on approval', async () => {
  const nyc = captured.profile as MapProfile;
  // Test-only completeness envelopes, not claims about the captured file's absent names or a streamed NYC run.
  const profile = { ...nyc, paths: [...nyc.paths,
    { ...nyc.paths.find(path => path.path === field('bin'))!, path: field('name') }] };
  const streamed = { ...inventory, paths: [inventory.paths[0]!, control('bin', ['string']),
    control('name', ['string'])] };
  const reading = { version: 'intake-reading/1', what: { words: 'NYC footprints.', basis: 'reader' }, holds: [],
    fields: [{ field: field('bin'), target: 'building.sourceKey', words: 'Building source key.', basis: 'rule' },
      { field: field('name'), target: 'building.name', words: 'Building name.', basis: 'memory' }],
    drawing: { as: 'building', words: 'Suggested kind: building.', basis: 'rule' }, links: [], question: null };
  const selected: Choices = { ...blankChoices, kind: 'building', identifier: field('bin'), name: field('name') };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network disabled for this control.'); }));
  for (const large of [false, true]) {
    const item = { ...captured.manifest.items[0], archiveItemId: null,
      streamedProfileJobId: niagara.jobId } as IntakeItem;
    const client = seeded(item);
    client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
    client.setQueryData(intakeKey(item.caseId), { caseId: item.caseId, items: [item] });
    client.setQueryData([...tableKey(item.caseId, item.sourceId!), 'profile'], profile);
    client.setQueryData(['streamed-profile', item.caseId, item.sourceId, niagara.jobId, item.updatedAt],
      { status: 'sealed', latest: streamed, ...pin });
    client.setQueryData(readingKey(item.caseId, item.itemId), { ...reading, fields: [],
      drawing: { ...reading.drawing, as: 'outlines' } });
    const use = vi.fn();
    const command = { state: { busy: false, uncertain: false, error: '', concern: '' }, use } as unknown as Command;
    const root = container(), view = createRoot(root as never);
    const answer = (receipt?: Recipe) => <QueryClientProvider client={client}>{large
      ? <StreamedLayoutAnswer caseId={item.caseId} item={item} receipt={receipt} command={command} />
      : <LayoutAnswer caseId={item.caseId} sourceId={item.sourceId!} receipt={receipt} command={command} />}
    </QueryClientProvider>;
    const controlFor = (label: string) => elements(root).find(node => node.tagName === 'SELECT'
      && node.getAttribute('aria-label') === label)!;
    await act(async () => view.render(answer()));
    expect(elements(root).filter(node => node.tagName === 'SELECT').map(node => propsOf(node).value))
      .toEqual(large ? ['', '', ''] : ['', '', '', '']);
    await act(async () => {
      client.setQueryData(readingKey(item.caseId, item.itemId), reading);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    for (const [label, value] of [['What is each feature in this file?', 'building'],
      ['Which field identifies each one?', field('bin')], ['Which field is its name?', field('name')]]) {
      expect(propsOf(controlFor(label!)).value).toBe(value);
    }
    expect(elements(root).filter(node => node.getAttribute('class')?.includes('ul-badge'))
      .map(node => node.textContent)).toEqual(['rule', 'rule', 'memory']);
    expect(use).not.toHaveBeenCalled();
    await act(async () => propsOf(button(root, 'Use this layout')).onClick?.());
    const expected = large ? streamedQuestionBody(streamed, selected, pin, 0, '')
      : questionBody(profile, selected, 0, '');
    expect(use).toHaveBeenCalledWith({ ...expected, requestKey: expect.any(String) });
    await act(async () => propsOf(controlFor('Which field is its name?')).onChange?.({ target: { value: '' } }));
    await act(async () => client.setQueryData(readingKey(item.caseId, item.itemId), { ...reading,
      fields: reading.fields.map(line => ({ ...line, basis: 'sarvam' })) }));
    expect(propsOf(controlFor('Which field is its name?')).value).toBe('');
    expect(elements(root).filter(node => node.getAttribute('class')?.includes('ul-badge'))).toHaveLength(2);
    const plan = large ? streamedQuestionBody(streamed, { ...selected, kind: 'parcel' }, pin, 0, '')!.plan
      : questionBody(profile, { ...selected, kind: 'parcel' }, 0, '')!.plan;
    await act(async () => view.render(answer({ ...captured.authored, plan } as Recipe)));
    expect(propsOf(controlFor('What is each feature in this file?')).value).toBe('parcel');
    expect(elements(root).filter(node => node.getAttribute('class')?.includes('ul-badge'))).toHaveLength(0);
    await act(async () => { view.unmount(); client.clear(); });
  }
  vi.unstubAllGlobals();
});

it('answers no-identifier map files by position, without offering it alongside qualifying fields', async () => {
  const position = '/features/*/geometry';
  const nyc = captured.profile as MapProfile;
  const profile = { ...nyc, paths: nyc.paths.map(path => ({ ...path, literalIdEligible: false,
    integerIdEligible: false, outlineLiteralIdEligible: false, outlineIntegerIdEligible: false })) };
  // Halifax's first counted part: BL_ID is text in 99 of 100 features, with one explicit null.
  const streamed: Inventory = { ...inventory, accepted: 100, recordsSeen: 100,
    paths: [{ ...inventory.paths[0]!, values: 100 },
      control('BL_ID', ['string'], { values: 99, explicitNull: 1 })] };
  const selected: Choices = { ...blankChoices, kind: 'building', identifier: position };
  for (const large of [false, true]) {
    const item = { ...captured.manifest.items[0], archiveItemId: null,
      streamedProfileJobId: niagara.jobId } as IntakeItem;
    const client = seeded(item);
    client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
    client.setQueryData(intakeKey(item.caseId), { caseId: item.caseId, items: [item] });
    client.setQueryData([...tableKey(item.caseId, item.sourceId!), 'profile'], profile);
    client.setQueryData(['streamed-profile', item.caseId, item.sourceId, niagara.jobId, item.updatedAt],
      { status: 'sealed', latest: streamed, ...pin });
    const use = vi.fn();
    const command = { state: { busy: false, uncertain: false, error: '', concern: '' }, use } as unknown as Command;
    const root = container(), view = createRoot(root as never);
    await act(async () => view.render(<QueryClientProvider client={client}>{large
      ? <StreamedLayoutAnswer caseId={item.caseId} item={item} command={command} />
      : <LayoutAnswer caseId={item.caseId} sourceId={item.sourceId!} command={command} />}
    </QueryClientProvider>));
    expect(elements(root).filter(node => node.tagName === 'OPTION' && node.textContent === 'Position in the file'))
      .toHaveLength(1);
    for (const [label, value] of [['What is each feature in this file?', 'building'],
      ['Which field identifies each one?', position]]) {
      const select = elements(root).find(node => node.tagName === 'SELECT'
        && node.getAttribute('aria-label') === label)!;
      await act(async () => propsOf(select).onChange?.({ target: { value } }));
    }
    await act(async () => propsOf(button(root, 'Use this layout')).onClick?.());
    const body = large ? streamedQuestionBody(streamed, selected, pin, 0, key)
      : questionBody(profile, selected, 0, key);
    expect(body?.plan.operations[0]).toEqual({ target: 'feature.sourceKey', sourcePath: position,
      conversionId: 'feature_position@1' });
    if (large) {
      expect(validate(authorSchema, body)).toEqual([]);
      const prefix = streamedQuestionBody({ ...streamed, coverage: 'provisional', unknownRemainder: true,
        rawChunkIndex: streamed.generation, rawResultSha256: hash }, selected, pin, 0, key);
      expect(validate(prefixSchema, prefix)).toEqual([]);
      expect(prefix?.plan.operations[0]).toEqual(body!.plan.operations[0]);
    }
    expect(use).toHaveBeenCalledWith({ ...body, requestKey: expect.any(String) });
    const receipt = { ...captured.authored, plan: body!.plan } as Recipe;
    expect(choicesFromRecipe(receipt).identifier).toBe(position);
    expect(layoutLines(receipt, 'officer')).toContain('Identified by its position in the file');
    expect((large ? streamedSummary : answerSummary)(selected)).toContain('identified by its position in the file');
    const available = large ? streamedQuestionBody(inventory, selected, pin, 0, key)
      : questionBody(nyc, selected, 0, key);
    expect(available).toBeNull();
    if (large) client.setQueryData(['streamed-profile', item.caseId, item.sourceId, niagara.jobId, item.updatedAt],
      { status: 'sealed', latest: inventory, ...pin });
    else client.setQueryData([...tableKey(item.caseId, item.sourceId!), 'profile'], nyc);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(elements(root).filter(node => node.tagName === 'OPTION' && node.textContent === 'Position in the file'))
      .toHaveLength(0);
    await act(async () => { view.unmount(); client.clear(); });
  }
});

it('offers text or whole-number identifiers and text names; mixed and uncounted fields are not offered', () => {
  expect(objectId).toMatchObject({ types: ['number'], integers: objectId.values });
  expect(streamedIdentifierPaths(inventory).map(path => path.path)).toEqual([field('OBJECTID'), field('TEXT_CONTROL')]);
  expect(streamedNamePaths(inventory).map(path => path.path)).toEqual([field('TEXT_CONTROL')]);
  expect(streamedIdentifierWords(objectId)).toBe('OBJECTID (whole number)');
  expect(streamedIdentifierWords(control('TEXT_CONTROL', ['string']))).toBe('TEXT_CONTROL');
});

it.each([
  ['text with an explicit null', ['string'], { values: 99, explicitNull: 1 }, false],
  ['complete text', ['string'], { values: 100 }, true],
  ['whole numbers with an absent value', ['number'], { values: 99, integers: 99, absent: 1 }, false],
  ['text with fewer values than accepted', ['string'], { values: 99 }, false],
] as const)('offers only complete identifiers: %s', (_label, types, counts, offered) => {
  const path = control('ID_CONTROL', [...types], counts);
  const profile = { ...inventory, accepted: 100, paths: [inventory.paths[0]!, path] };
  expect(streamedIdentifierPaths(profile, 'building')).toEqual(offered ? [path] : []);
  expect(streamedQuestionBody(profile, { ...choices, identifier: path.path }, pin, 0, key) !== null).toBe(offered);
});

it('uses outline identifier counts only for outline kinds in mixed files, with a whole-file fallback', () => {
  const path = control('ID_CONTROL', ['string', 'number'], { values: 3,
    outline: { types: ['number'], values: 2, integers: 2, explicitNull: 0, absent: 0 } });
  const profile = { ...inventory, accepted: 3, geometryTypes: ['Polygon', 'Point'],
    paths: [inventory.paths[0]!, path] } as Inventory;
  for (const kind of ['building', 'parcel', 'public_land'] as const) {
    expect(streamedIdentifierPaths(profile, kind)).toEqual([path]);
    expect(streamedQuestionBody(profile, { ...choices, kind, identifier: path.path }, pin, 0, key)
      ?.plan.operations[0]?.conversionId).toBe('literal_integer_identifier@1');
  }
  for (const kind of ['road', 'utility'] as const) expect(streamedIdentifierPaths(profile, kind)).toEqual([]);
  expect(streamedIdentifierPaths({ ...profile, paths: [{ ...path, outline: undefined }] }, 'building')).toEqual([]);
  expect(streamedIdentifierPaths(inventory, 'building')).toEqual([objectId, inventory.paths[2]]);
});

it('offers streamed names complete over outlines only and refuses a missing outline name', () => {
  // test_only counts: a pin holds a non-text name; two outlines hold text.
  const name = field('TEXT_CONTROL');
  const text = control('TEXT_CONTROL', ['string', 'number'], { values: 3,
    outline: { types: ['string'], values: 2, explicitNull: 0, absent: 0 } });
  const mixed = { ...inventory, accepted: 3, geometryTypes: ['Polygon', 'Point'],
    paths: [{ ...objectId, values: 3, integers: 3 }, inventory.paths[0]!, text] } as Inventory;
  expect(streamedNamePaths(mixed, 'building').map(path => path.path)).toContain(name);
  expect(streamedNamePaths(mixed, 'road').map(path => path.path)).not.toContain(name);
  expect(streamedQuestionBody(mixed, { ...choices, name }, pin, 0, key)?.plan.operations[2]?.sourcePath).toBe(name);
  const missing = { ...mixed, paths: mixed.paths.map(path => path.path === name
    ? { ...path, outline: { types: ['string'] as const, values: 1, explicitNull: 0, absent: 1 } } : path) };
  expect(streamedNamePaths(missing as Inventory, 'building').map(path => path.path)).not.toContain(name);
  expect(streamedQuestionBody(missing as Inventory, { ...choices, name }, pin, 0, key)).toBeNull();
});

it('authors a sealed-inventory plan for a building and a parcel that the contract accepts, with no height', () => {
  for (const kind of ['building', 'parcel'] as const satisfies readonly Kind[]) {
    const body = streamedQuestionBody(inventory, { ...choices, kind }, pin, 0, key)!;
    expect(validate(authorSchema, body)).toEqual([]);
    expect(layoutTargetsIssue(kind, body.plan.operations.map(operation => operation.target))).toBeNull();
    expect(body).toEqual({ requestKey: key, expectedRecipeRevision: 0, plan: {
      version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
      basis: 'officer_stated', source: inventory.source, caseId: pin.caseId, caseRevision: pin.caseRevision,
      rawJobId: inventory.rawJobId, profileJobId: niagara.jobId, profileGeneration: niagara.generation,
      profileHash: hash, semanticEvidence: [], kind, operations: [
        { target: 'feature.sourceKey', sourcePath: field('OBJECTID'), conversionId: 'literal_integer_identifier@1' },
        { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
      ] } });
  }
  const named = streamedQuestionBody(inventory, { ...choices, identifier: field('TEXT_CONTROL'),
    name: field('TEXT_CONTROL') }, pin, 2, key)!;
  expect(named.plan.operations).toEqual([
    { target: 'feature.sourceKey', sourcePath: field('TEXT_CONTROL'), conversionId: 'literal_identifier@1' },
    { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    { target: 'feature.name', sourcePath: field('TEXT_CONTROL'), conversionId: 'literal_text@1' },
  ]);
  expect(named.expectedRecipeRevision).toBe(2);
  const walk = sourceFunction<(caseId: string, revision: number, profile: Inventory) => unknown>(
    'docs/evidence/gf1/lr3/runtime.ts', 'layout', '/** Step 3');
  expect(streamedQuestionBody(inventory, choices, pin, 0, key)?.plan)
    .toEqual(walk(pin.caseId, pin.caseRevision, inventory));
  expect(streamedSummary(choices)).toBe('Each feature is a building, identified by OBJECTID. Name: not stated. '
    + 'Height: not stated.');
});

it('makes no plan from an unoffered field, a refused kind or a missing choice', () => {
  expect(streamedQuestionBody(inventory, blankChoices, pin, 0, key)).toBeNull();
  expect(streamedQuestionBody(inventory, { ...choices, identifier: field('MIXED_CONTROL') }, pin, 0, key)).toBeNull();
  expect(streamedQuestionBody(inventory, { ...choices, identifier: field('DECIMAL_CONTROL') }, pin, 0, key))
    .toBeNull();
  expect(streamedQuestionBody(inventory, { ...choices, name: field('OBJECTID') }, pin, 0, key)).toBeNull();
  expect(streamedQuestionBody({ ...inventory, geometryTypes: ['LineString'] }, choices, pin, 0, key)).toBeNull();
});

it('opens the question only on a sealed inventory and says why otherwise', () => {
  const status = { status: 'sealed', latest: inventory } as ProfileStatus;
  expect(inventoryWords(status)).toBeNull();
  for (const state of ['queued', 'running'] as const) {
    expect(inventoryWords({ ...status, status: state, latest: null })).toMatch(/still being inventoried/);
  }
  expect(inventoryWords({ ...status, latest: null })).toMatch(/still being inventoried/);
  expect(inventoryWords({ ...status, status: 'failed' })).toBe(
    'The fields of this file could not be inventoried, so its layout question cannot be answered.');
  expect(inventoryWords({ ...status, status: 'stale' })).toBe(
    'This file changed after its fields were inventoried, so its layout question cannot be answered.');
});

it('keeps the server\'s words for a refused author and reviews the streamed receipt without a height', async () => {
  const body = streamedQuestionBody(inventory, choices, pin, 0, key)!;
  const words = 'A field required by the layout is not complete text or a whole number in every accepted record.';
  const author = vi.fn(async () => {
    throw new ApiError(422, '', { error: { code: 'STREAMED_MAPPING_COVERAGE', message: words } });
  });
  const states: { error: string; concern: string; uncertain: boolean }[] = [];
  const command = createLayoutCommand({ author, approve: vi.fn() }, state => states.push(state), vi.fn());
  await command.use(body);
  expect(states.at(-1)).toMatchObject({ error: words, concern: '', uncertain: false });
  const receipt = { id: key, revision: 1, state: 'proposed', plan: body.plan, planHash: hash,
    authoredBy: 'test-control', authoredAt: '2026-10-17T00:00:00.000Z', approval: null } as Recipe;
  expect(layoutLines(receipt, 'officer')).toEqual(['Each feature is: a building', 'Identifier: OBJECTID',
    'Name: not stated', 'Height: not stated', 'Area: not supplied by the record', 'Written by an officer']);
  expect(choicesFromRecipe(receipt)).toEqual(choices);
});

it('publishes a streamed receipt in the recipe history and the inventory\'s own case revision', () => {
  const body = streamedQuestionBody(inventory, choices, pin, 0, key)!;
  const receipt = { id: key, revision: 1, state: 'proposed', plan: body.plan, planHash: hash,
    authoredBy: 'test-control', authoredAt: '2026-10-17T00:00:00.000Z', approval: null };
  expect(validate(historySchema, [receipt])).toEqual([]);
  const status = { version: 'streamed-profile/1', jobId: inventory.jobId, rawJobId: inventory.rawJobId,
    caseId: pin.caseId, caseRevision: pin.caseRevision, sourceId: inventory.source.sourceId, sourceRevision: 1,
    sourceSha256: 'a'.repeat(64), status: 'sealed', nextRawIndex: 1, latest: inventory, issueCode: null,
    sourceComplete: true, usableCoverage: true, identityComplete: false };
  expect(validate(statusSchema, status)).toEqual([]);
  const { caseRevision: _, ...unpinned } = status;
  expect(validate(statusSchema, unpinned)).not.toEqual([]);
});

/** A case advanced past the inventory: its current revision is not the one the server accepts. */
const advanced = pin.caseRevision + 2;
function seeded(item: IntakeItem, status?: Partial<ProfileStatus>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['streamed-generation', item.caseId, item.sourceId, item.streamedProfileJobId,
    item.layoutProfile?.generation], firstPart);
  client.setQueryData(['source-case', item.caseId], { case: { revision: advanced } });
  client.setQueryData([...tableKey(item.caseId, item.sourceId!), 'profile'], captured.profile);
  client.setQueryData(['streamed-profile', item.caseId, item.sourceId, item.streamedProfileJobId, item.updatedAt],
    { status: 'sealed', latest: inventory, caseId: pin.caseId, caseRevision: pin.caseRevision, ...status });
  return client;
}

function panel(item: IntakeItem, status?: Partial<ProfileStatus>) {
  return renderToStaticMarkup(<QueryClientProvider client={seeded(item, status)}>
    <LayoutQuestion caseId={item.caseId} item={item} refresh={vi.fn()} />
  </QueryClientProvider>);
}

it('pins the inventory\'s case revision after the case has advanced', () => {
  const item = { ...captured.manifest.items[0], archiveItemId: null,
    streamedProfileJobId: niagara.jobId } as IntakeItem;
  const plan = streamedQuestionBody(inventory, choices, pin, 0, key)!.plan;
  const receipt = { id: key, revision: 1, state: 'proposed', plan, planHash: hash, authoredBy: 'test-control',
    authoredAt: '2026-10-17T00:00:00.000Z', approval: null } as Recipe;
  const command = { state: { busy: false, uncertain: false, error: '', concern: '' } } as unknown as Command;
  const spy = vi.mocked(streamedQuestionBody);
  spy.mockClear();
  const html = renderToStaticMarkup(<QueryClientProvider client={seeded(item)}>
    <StreamedLayoutAnswer caseId={item.caseId} item={item} receipt={receipt} command={command} />
  </QueryClientProvider>);
  expect(html).toContain('Use this layout');
  expect(spy).toHaveBeenCalled();
  for (const result of spy.mock.results) {
    expect(result.value?.plan.caseRevision).toBe(pin.caseRevision);
  }
  expect(spy.mock.results.some(result => result.value)).toBe(true);
});

it('answers a large item from its streamed inventory and leaves a small item on its retained profile', () => {
  const small = { ...captured.manifest.items[0], archiveItemId: null,
    streamedProfileJobId: null, layoutQuestion: true } as IntakeItem;
  const large = { ...small, streamedProfileJobId: niagara.jobId, layoutQuestion: true };
  expect(needsLayoutAnswer(large)).toBe(true);
  const sealed = panel(large);
  expect(sealed).toContain('OBJECTID (whole number)');
  expect(sealed).toContain('Choose what each feature is and which field identifies it.');
  expect(sealed).not.toContain('Does a field give its height?');
  expect(sealed).not.toContain('MIXED_CONTROL');
  const reading = panel(large, { status: 'running', latest: null });
  expect(reading).toMatch(/still being inventoried/);
  expect(reading).not.toContain('<select');
  const failed = panel(large, { status: 'failed' });
  expect(failed).toContain('could not be inventoried');
  expect(failed).not.toContain('<select');
  const retained = panel(small);
  expect(retained).toContain('Does a field give its height?');
  expect(retained).not.toContain('large files');
});

// test_only: the same controls read as the first published part, still open; the remainder is unknown.
const firstPart: Inventory = { ...inventory, coverage: 'provisional', unknownRemainder: true,
  rawChunkIndex: niagara.generation, rawResultSha256: 'd'.repeat(64) };
const asked = (coverage: 'provisional' | 'sealed', source: Inventory) => ({ generation: source.generation,
  generationHash: source.generationHash, coverage, recordsSeen: source.recordsSeen, accepted: source.accepted });

/** Every request the transport sends, answered with the receipt the server would return. */
function recordPosts() {
  const posts: string[] = [];
  let sent: Recipe | undefined;
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    posts.push(`${request.method} ${new URL(request.url).pathname}`);
    const body = await request.json() as { plan?: Recipe['plan'] };
    const plan = body.plan ?? sent!.plan;
    sent = { id: key, revision: 1, state: body.plan ? 'proposed' : 'approved', plan, planHash: hash,
      authoredBy: 'test-control', authoredAt: '2026-10-25T00:00:00.000Z', approval: null } as Recipe;
    return new Response(JSON.stringify(sent), { status: body.plan ? 201 : 200,
      headers: { 'content-type': 'application/json' } });
  }));
  return posts;
}

/** The Studio's own layout command, taken from its hook; each send is recorded with its route. */
function studioCommand() {
  let command: ReturnType<typeof useLayoutCommand> | undefined;
  function Probe() {
    command = useLayoutCommand(pin.caseId, inventory.source.sourceId, vi.fn());
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return command!;
}

async function answer(send: (command: ReturnType<typeof useLayoutCommand>) => Promise<void>) {
  const posts = recordPosts();
  await send(studioCommand());
  vi.unstubAllGlobals();
  return posts;
}

it('authors a first-part question on the prefix route with its pins, then approves it there', async () => {
  const body = streamedQuestionBody(firstPart, choices, pin, 0, key)!;
  expect(validate(prefixSchema, body)).toEqual([]);
  expect(body.plan).toMatchObject({ version: 'streamed-prefix-mapping/1',
    scope: 'observed_prefix_and_later_compatible_features', profileGeneration: niagara.generation,
    prefix: { throughRawChunkIndex: niagara.generation, rawResultSha256: 'd'.repeat(64),
      recordsSeen: niagara.recordsSeen, accepted: inventory.accepted } });
  expect(streamedQuestionBody({ ...firstPart, rawResultSha256: null }, choices, pin, 0, key)).toBeNull();
  const job = `/api/v1/ingestion/cases/${pin.caseId}/sources/${inventory.source.sourceId}/streamed-profile/jobs/`
    + niagara.jobId;
  expect(await answer(command => command.use(body)))
    .toEqual([`POST ${job}/prefix-recipes`, `POST ${job}/prefix-recipes/${key}/approve`]);
  expect(await answer(command => command.use(streamedQuestionBody(inventory, choices, pin, 0, key)!)))
    .toEqual([`POST ${job}/recipes`, `POST ${job}/recipes/${key}/approve`]);
  const receipt = { id: key, revision: 1, state: 'proposed', plan: body.plan, planHash: hash,
    authoredBy: 'test-control', authoredAt: '2026-10-25T00:00:00.000Z', approval: null } as Recipe;
  expect(await answer(command => command.approve(receipt))).toEqual([`POST ${job}/prefix-recipes/${key}/approve`]);
  expect(layoutLines(receipt, 'officer')).toEqual(['Each feature is: a building', 'Identifier: OBJECTID',
    'Name: not stated', `Taken from the first ${niagara.recordsSeen.toLocaleString('en-IN')} features read`,
    'Height: not stated', 'Area: not supplied by the record', 'Written by an officer']);
  expect(choicesFromRecipe(receipt)).toEqual(choices);
});

it('answers a first-part question from its pinned generation and says how many features it covers', () => {
  const item = { ...captured.manifest.items[0], archiveItemId: null,
    streamedProfileJobId: niagara.jobId, layoutQuestion: true,
    layoutProfile: asked('provisional', firstPart) } as IntakeItem;
  const words = `This layout is taken from the first ${niagara.recordsSeen.toLocaleString('en-IN')} features read.`;
  const open = panel(item, { status: 'running', latest: firstPart });
  expect(open).toContain(words);
  expect(open).toContain('OBJECTID (whole number)');
  expect(open).not.toMatch(/still being inventoried/);
  const moved = panel({ ...item, layoutProfile: { ...item.layoutProfile!, generationHash: 'e'.repeat(64) } },
    { status: 'running', latest: firstPart });
  expect(moved).not.toContain('<select');
  expect(panel({ ...item, layoutProfile: asked('sealed', inventory) })).not.toContain('first ');
});

it('asks again over the complete file in the item\'s words when a first-part field changed', () => {
  const changed = 'A field used by the first-part layout changed or could not be read as stated. Nothing was drafted. '
    + 'State the layout again for the complete file.';
  const item = { ...captured.manifest.items[0], archiveItemId: null,
    streamedProfileJobId: niagara.jobId, layoutQuestion: true,
    layoutProfile: asked('sealed', inventory), limitReason: changed } as IntakeItem;
  const html = panel(item);
  expect(html).toContain(changed);
  expect(html).toContain('OBJECTID (whole number)');
  expect(html).not.toContain('features read');
  expect(panel({ ...item, limitReason: 'No approved layout matches this file.' })).not.toContain(changed);
});

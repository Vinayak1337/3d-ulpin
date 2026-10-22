import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeLedgerSources, boundedLedgerRows, currentParcelSql, currentSourceProposal, documentCitationLocators,
  ledgerSourceLocators, parcelUlpinCoverage } from './building-ledger';
import { relatedRegistryRecordQuery } from './officer';

test('revision-zero ledger read requires the exact active site/source/package binding', () => {
  const root = { identifier: 'application-id', site_id: 'site-id', body: { sourceRevisionId: 'source-id' } };
  const pkg = { archived: false, site_id: 'site-id', state: 'NEEDS_INPUT', body: {
    sourceRevisionIds: ['source-id'], parts: [], features: [{ id: 'building-id', revision: 0,
      identifier: 'application-id', sourceRevisionId: 'source-id' }],
  } };
  assert.equal(currentSourceProposal(root, pkg, 'building-id'), true);
  assert.equal(currentSourceProposal(root, { ...pkg, archived: true }, 'building-id'), false);
  assert.equal(currentSourceProposal(root, { ...pkg, site_id: 'other-site' }, 'building-id'), false);
  assert.equal(currentSourceProposal(root, { ...pkg, body: { ...pkg.body, sourceRevisionIds: ['other-source'] } }, 'building-id'), false);
  assert.equal(currentSourceProposal(root, { ...pkg, body: { ...pkg.body,
    features: [{ ...pkg.body.features[0], revision: 1 }] } }, 'building-id'), false);
});

test('current parcel coverage distinguishes partial, conflicting and multiple valid parcel identities', () => {
  const parcels = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(parcelUlpinCoverage(parcels, []), { state: 'unknown', missingParcelIds: ['a', 'b'] });
  assert.deepEqual(parcelUlpinCoverage(parcels, [{ parcelId: 'a', value: 'one' }]),
    { state: 'partial', missingParcelIds: ['b'] });
  assert.deepEqual(parcelUlpinCoverage(parcels, [{ parcelId: 'a', value: 'one' }, { parcelId: 'b', value: 'two' }]),
    { state: 'recorded', missingParcelIds: [] });
  assert.deepEqual(parcelUlpinCoverage(parcels, [{ parcelId: 'a', value: 'one' }, { parcelId: 'a', value: 'two' }]),
    { state: 'conflicting', missingParcelIds: ['b'] });
});

test('projected relationship, parcel and identifier evidence remain exact source references', () => {
  const edge = { evidence: [{ sourceRevisionId: 'edge-source', featureId: 'feature-1' }] };
  const locators = ledgerSourceLocators({ sourceRevisionId: 'root-source', sourceKey: 'building-1' },
    [{ evidence: [{ sourceId: 'space-source', locator: 'page:2' }] }], [edge],
    [{ body: { sourceRevisionId: 'parcel-source', evidence: [{ sourceRevisionId: 'parcel-source', row: 5 }] },
      association: edge }],
    [{ source_id: 'identifier-source', evidence: { sourceRevisionId: 'identifier-source', locator: 'document:7' } }]);
  assert.deepEqual([...locators.keys()], ['root-source', 'space-source', 'edge-source', 'parcel-source', 'identifier-source']);
  assert(locators.get('edge-source')?.has(JSON.stringify(edge.evidence[0])));
  assert(locators.get('identifier-source')?.has('document:7'));
  assert.throws(() => ledgerSourceLocators({ sourceRevisionId: 'root-source' }, [], [{ evidence: [] }], [], []),
    /relationship lacks source evidence/);
  assert.throws(() => ledgerSourceLocators({ sourceRevisionId: 'root-source' }, [], [], [],
    [{ source_id: 'identifier-source', evidence: { sourceRevisionId: 'another-source', locator: 'document:7' } }]),
    /lacks its exact source locator/);
});

test('a recorded revision\'s document citations are cited by their source and locator in words', () => {
  const id = '10000000-0000-4000-8000-000000000001', csv = '10000000-0000-4000-8000-000000000002';
  const pdf = '10000000-0000-4000-8000-000000000003', hash = 'a'.repeat(64), at = '2026-10-22T00:00:00.000Z';
  const base = { target: { recordId: id, revision: 2, bodySha256: hash },
    selection: { subject: 'officer', accessSha256: hash, selectedAt: at },
    associationState: 'operator_selected', qualification: 'not_assessed' };
  // REH13 act 1: the LPC register row 444 of gpmc-yuvp.csv, confirmed by its BIN for building 1084419.
  const row = { version: 'registry-table-row-citation/1', id: hash, ...base,
    row: { kind: 'table_row', itemId: id, caseId: id, sourceId: csv, sourceRevision: 1, sourceSha256: hash,
      rawJobId: id, rawInputSha256: hash, rawResultSha256: hash, acceptedFence: 1,
      selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }, sourceRow: 444, rowSha256: hash,
      columnIndex: 0, columnHeader: 'bin', cell: { state: 'literal', value: '1084419' } },
    key: { profileId: id, profileSha256: hash, namespace: 'bin', kind: 'integer', literal: '1084419' },
    confirmation: { confirmationId: id, candidateId: id, candidateSha256: hash },
    excerpt: 'CSV logical row 444\nbin: 1084419\nborough: MN' };
  const part = { version: 'registry-document-citation/1', id: 'b'.repeat(64), ...base,
    document: { caseId: id, caseRevision: 1, sourceId: pdf, sourceRevision: 1, sourceSha256: hash, jobId: id,
      resultSha256: hash }, inputSha256: hash, readerSha256: hash, acceptedFence: 1, partId: id, partSha256: hash,
    locator: { label: 'Page 3, paragraph 2', page: 3, paragraph: 2, characterStart: 0, characterEnd: 40 } };
  assert.deepEqual(documentCitationLocators([row, part]), { unreadable: 0, cited: [
    { sourceId: csv, locator: 'CSV logical row 444' },
    { sourceId: pdf, locator: 'Page 3, paragraph 2' },
  ] });
  assert.deepEqual(documentCitationLocators(undefined), { cited: [], unreadable: 0 });
  // A stored citation that no longer reads is counted, and its neighbours are still listed.
  assert.deepEqual(documentCitationLocators([{ ...row, version: 'registry-unknown/1' }, row]),
    { cited: [{ sourceId: csv, locator: 'CSV logical row 444' }], unreadable: 1 });
  const locators = ledgerSourceLocators({ sourceRevisionId: 'root-source', sourceKey: '1084419' }, [], [], [], [],
    documentCitationLocators([row]).cited);
  assert.deepEqual([...locators.keys()], ['root-source', csv]);
  assert.deepEqual([...locators.get(csv)!], ['CSV logical row 444']);
});

test('an inaccessible projected edge source rejects the entire authorized ledger source set', async () => {
  const lookedUp: string[] = [];
  await assert.rejects(authorizeLedgerSources(['root-source', 'edge-source'], async id => {
    lookedUp.push(id);
    if (id === 'edge-source') throw new Error('REGISTRY_SOURCE_DENIED');
    return { id };
  }), /REGISTRY_SOURCE_DENIED/);
  assert.deepEqual(lookedUp, ['edge-source']);
});

test('ledger sentinel rejects incomplete parcel and identifier sets; dossier graph remains uncapped', () => {
  assert.equal(boundedLedgerRows(Array.from({ length: 200 }, (_, n) => n), 'parcels').length, 200);
  assert.throws(() => boundedLedgerRows(Array.from({ length: 201 }, (_, n) => n), 'parcels'),
    /Too many current parcels/);
  const dossier = relatedRegistryRecordQuery('building', 1, 'site');
  const ledger = relatedRegistryRecordQuery('building', 1, 'site', 2000);
  assert(!dossier.sql.includes('LIMIT'));
  assert(ledger.sql.includes('LIMIT $4'));
  assert.deepEqual(ledger.values, ['building', 1, 'site', 2001]);
  assert(currentParcelSql.indexOf("a.body->>'fromRevision'=$3::text") < currentParcelSql.indexOf('LIMIT 201'));
  assert(currentParcelSql.indexOf("a.body->>'toRevision'=p.revision::text") < currentParcelSql.indexOf('LIMIT 201'));
});

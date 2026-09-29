import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeLedgerSources, boundedLedgerRows, currentParcelSql, currentSourceProposal, ledgerSourceLocators, parcelUlpinCoverage } from './building-ledger';
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

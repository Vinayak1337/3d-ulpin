import assert from 'node:assert/strict';
import test from 'node:test';
import { UspGeometryMetadataSchema, DataSufficiencyVerdictSchema, UspDeclarationChangeSchema,
  UspPrepareProposalSchema, UspSnapshotManifestSchema } from '../packages/contracts/src/usp';
import { geometryProjection, sameCanonicalGeometryPayload } from '../apps/web/lib/server/usp/geometry';
import { uspFixtures as existing } from './fixtures/usp-common';

// Schema/metadata assertions only. No geometry, operational records or source facts are authored.
const metadata = { representation: 'physical_semantic', geometryClass: 'evidence_linked', analyticEligible: false,
  semanticLod: null, displayLevel: null, qualification: { state: 'unqualified', reasons: ['qualification_missing'] } };
test('evidence-linked label is unqualified until a qualification exists', () => {
  assert.equal(UspGeometryMetadataSchema.parse(metadata).analyticEligible, false);
  assert.equal(UspGeometryMetadataSchema.safeParse({ ...metadata, analyticEligible: true }).success, false);
  assert.equal(UspGeometryMetadataSchema.safeParse({ ...metadata, qualification: undefined }).success, false);
});
test('estimated and illustrative classifications cannot claim analytical eligibility', () => {
  for (const geometryClass of ['estimated','illustrative']) {
    assert.equal(UspGeometryMetadataSchema.parse({ ...metadata, geometryClass }).analyticEligible, false);
    assert.equal(UspGeometryMetadataSchema.safeParse({ ...metadata, geometryClass, analyticEligible:true }).success, false);
  }
});
test('context meshes stay non-analytical; semantic detail and tile refinement are independent', () => {
  const parsed = UspGeometryMetadataSchema.parse({ ...metadata, representation:'context_mesh', semanticLod:'2', displayLevel:7 });
  assert.equal(parsed.semanticLod, '2'); assert.equal(parsed.displayLevel, 7);
  assert.equal(parsed.analyticEligible, false);
  assert.equal(UspGeometryMetadataSchema.safeParse({ ...parsed, analyticEligible:true }).success, false);
  assert.equal(UspGeometryMetadataSchema.safeParse({ ...parsed, lod:2 }).success, false);
});
test('missing legacy metadata produces explicit insufficiency, never inferred eligibility', () => {
  const projection = geometryProjection(existing.pin, undefined, null, false);
  assert.equal(projection.metadata, null);
  assert.equal(projection.sufficiency.outcome, 'insufficient_for_spatial_reconstruction');
  assert.ok(projection.sufficiency.missing.includes('geometry_qualification'));
  assert.equal(geometryProjection(existing.pin, metadata, 1, true).sufficiency.outcome, 'insufficient_for_spatial_reconstruction');
});
test('sufficiency rejects unknown gaps, fake complete results and duplicate requirements', () => {
  const verdict = {task:'spatial_analysis',requirements:['reference','qualification'],outcome:'partial',missing:['qualification']};
  assert.equal(DataSufficiencyVerdictSchema.parse(verdict).outcome,'partial');
  for (const change of [{outcome:'sufficient'}, {missing:['unlisted']}, {missing:['reference','qualification']},
    {requirements:['reference','reference']}]) assert.equal(DataSufficiencyVerdictSchema.safeParse({...verdict,...change}).success,false);
  assert.equal(DataSufficiencyVerdictSchema.parse({...verdict,outcome:'sufficient',missing:[]}).outcome,'sufficient');
});
test('declaration kind requires explicit typed revision pins and a prior amendment revision', () => {
  // Existing reference fixture identities are reused only as schema tokens, not as rights records.
  const declaration = {...existing.pin,ref:{...existing.pin.ref,namespace:'declaration'},revision:2};
  const entry = {...existing.pin,ref:{...existing.pin.ref,namespace:'declaration_entry'}};
  const instrument = {...existing.pin,ref:{...existing.pin.ref,namespace:'source_revision'}};
  const change = {kind:'declaration',action:'amend',declaration,entries:[entry],applicability:[],instrument,
    supersedes:{...declaration,revision:1}};
  assert.equal(UspDeclarationChangeSchema.parse(change).action,'amend');
  for (const mutation of [{supersedes:null},{supersedes:declaration},{entries:[entry,entry]},{instrument:entry}])
    assert.equal(UspDeclarationChangeSchema.safeParse({...change,...mutation}).success,false);
  const proposal = {kind:'declaration',scope:existing.scope,target:existing.pin,changes:[change],evidence:[],guard:existing.create};
  assert.equal(UspPrepareProposalSchema.parse(proposal).kind,'declaration');
  assert.equal(UspPrepareProposalSchema.safeParse({...proposal,kind:'registry'}).success,false);
});
test('declaration snapshot pins require captured membership while legacy snapshots remain readable', () => {
  const manifest = {schemaVersion:'usp/1',id:existing.scope.manifestId,digest:existing.scope.snapshotDigest,
    scope:existing.scope,capturedAt:'2026-09-23T00:00:00.000Z',selection:{kind:'site',pins:[]},members:[],
    frame:{horizontal:null,vertical:null,unit:null,transform:null},policyVersion:existing.scope.scopeId,
    accessViewId:existing.scope.scopeId,validAt:null,asOf:null,coverage:{state:'partial',reasonCodes:['missing_source']}};
  assert.equal(UspSnapshotManifestSchema.safeParse(manifest).success,true);
  const pin={...existing.pin,ref:{...existing.pin.ref,namespace:'declaration'}};
  const declarations={state:'available',declarationRevisions:[pin],entryRevisions:[],applicabilityRevisions:[]};
  assert.equal(UspSnapshotManifestSchema.safeParse({...manifest,declarations}).success,false);
  assert.equal(UspSnapshotManifestSchema.safeParse({...manifest,declarations,members:[{pin,authority:'declaration',
    bodySha256:existing.scope.snapshotDigest,bodyRef:existing.scope.manifestId}]}).success,true);
});
test('a qualified identity cannot be reused with different classification or source metadata', () => {
  assert.equal(sameCanonicalGeometryPayload(metadata,{...metadata,id:existing.pin.ref.id,revision:existing.pin.revision}),true);
  assert.equal(sameCanonicalGeometryPayload(metadata,{...metadata,geometryClass:'illustrative'}),false);
  assert.equal(sameCanonicalGeometryPayload(metadata,{...metadata,representation:'context_mesh'}),false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { assessFindingParticipants, qualifyFindingParticipants, requireQualifiedFindingParticipants,
  projectFindingHistory, type FindingEvidence, type QualifiedParticipantRow } from '../apps/web/lib/server/usp/finding-qualification';
import { uspFixtures as existing } from './fixtures/usp-common';

// Metadata-only boundary assertions: reuse existing contract tokens; no geometry,
// finding quantities, source facts, persisted records or accepted receipts are authored.
const participants = [existing.pin.ref.id, existing.scope.scopeId].map(id =>
  ({id, revision:1, sourceRevisionId:existing.evidence.sourceRevision.ref.id}));
const finding: FindingEvidence = {id:existing.scope.manifestId, featureIds:participants.map(p=>p.id), participants,
  inputRevisions:participants.map(p=>({featureId:p.id,revision:p.revision,sourceRevisionId:p.sourceRevisionId}))};
const metadata = {representation:'physical_semantic',geometryClass:'evidence_linked',analyticEligible:true,
  semanticLod:null,displayLevel:null,qualification:{state:'qualified',receiptId:'00000000-0000-4000-8000-000000000001',
    targetBodySha256:existing.scope.snapshotDigest,sources:[{source:existing.evidence.sourceRevision,sha256:existing.scope.snapshotDigest}]}};
const rows: QualifiedParticipantRow[] = participants.map(body=>({id:body.id,revision:body.revision,body,metadata}));

test('a qualified selected participant cannot qualify an unavailable neighbour', () => {
  assert.equal(assessFindingParticipants([finding],rows).state,'qualified');
  const result=assessFindingParticipants([finding],rows.slice(0,1));
  assert.equal(result.state,'not_assessed');
  assert.ok(result.missing.some(item=>item.participantId===participants[1].id));
});
test('saved findings abstain on removed, superseded or changed participants without substituting latest bodies', () => {
  const saved=JSON.stringify(finding);
  for(const neighbour of [undefined,{...rows[1],revision:2},
    {...rows[1],body:{...rows[1].body,sourceRevisionId:existing.evidence.assetRevision.ref.id}},
    {...rows[1],metadata:{...metadata,analyticEligible:false,qualification:{state:'unqualified',reasons:['revoked']}}}]) {
    assert.equal(assessFindingParticipants([finding],neighbour?[rows[0],neighbour]:[rows[0]]).state,'not_assessed');
  }
  assert.equal(JSON.stringify(finding),saved);
});
test('absent, duplicated or inconsistent participant and source pins cannot qualify legacy findings', () => {
  for(const change of [{participants:undefined},{inputRevisions:undefined},{featureIds:[]},
    {participants:[participants[0],participants[0]]}, {inputRevisions:[finding.inputRevisions![0]]},
    {inputRevisions:finding.inputRevisions!.map(pin=>({...pin,revision:2}))}])
    assert.equal(assessFindingParticipants([{...finding,...change}],rows).state,'not_assessed');
  const missingSource={...metadata,qualification:{...metadata.qualification,
    sources:[{source:{...existing.evidence.sourceRevision,ref:{namespace:'source_revision',id:existing.evidence.assetRevision.ref.id}},sha256:existing.scope.snapshotDigest}]}};
  assert.equal(assessFindingParticipants([finding],rows.map(row=>({...row,metadata:missingSource}))).state,'not_assessed');
});
test('all purposes share the complete participant adapter; saved history is explicit and never mutates', async () => {
  let role='none';
  const requested: string[][]=[];
  // SQL adapter stub exposes metadata availability only. Actual PostgreSQL ACLs and
  // retained investigation exports are exercised by FND-04-sql.ts, separately.
  const client={query:async(sql:string,args?:unknown[])=>{
    if(sql.includes('current_setting'))return {rows:[{role}]};
    if(sql.includes('set_config')){role=String(args![0]);return {rows:[]};}
    assert.ok(sql.includes('usp_analytic_geometry'));
    requested.push(args![0] as string[]);
    return {rows:[rows[0]]};
  }} as unknown as PoolClient;
  for(const purpose of ['FIND','READY','PACK','export'] as const) {
    assert.equal((await qualifyFindingParticipants(purpose,[finding],client)).state,'not_assessed');
    await assert.rejects(requireQualifiedFindingParticipants(purpose,[finding],client),
      (error:unknown)=>(error as {code:string}).code==='USP_FINDING_PARTICIPANTS_NOT_QUALIFIED');
    assert.equal(role,'none');
  }
  assert.ok(requested.every(ids=>ids.includes(participants[0].id)&&ids.includes(participants[1].id)));
  const saved={findings:[finding]};
  const projection=await projectFindingHistory('export',saved,client);
  assert.deepEqual(projection.findings,[]);
  assert.equal(projection.analysisState,'not_assessed');
  assert.equal(projection.historicalFindings?.currentAnalyticalEligibility,false);
  assert.equal(projection.historicalFindings?.findings,saved.findings);
  assert.equal(saved.findings.length,1);
});

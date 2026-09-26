import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGatewayConfigSchema, readProviderSecret, validateSecretReference } from '@ulpin/server/modules/model-gateway/config';
import { cost } from '@ulpin/server/modules/model-gateway/pricing';
import { classifyProviderFailure, minimizeMessages, ReplayAdapter, SarvamAdapter } from '@ulpin/server/modules/model-gateway/adapter';
import { configuredGateway, hash } from '@ulpin/server/modules/model-gateway/config';
import { inspectModelGateway } from '@ulpin/server/modules/ai/officer-ai-provider';
import { nonIndiaProviderAllowed } from '@ulpin/server/infrastructure/provider-policy';
import { PgModelCallLedger, type Transact } from '@ulpin/server/modules/model-gateway/ledger';
import { ModelGateway } from '@ulpin/server/modules/model-gateway/gateway';
import { userInfo } from 'node:os';

// Software-control inputs only: no source bytes, property facts/IDs, PII or replay corpus.
export const controlConfig = (overrides: Record<string, unknown> = {}) => ModelGatewayConfigSchema.parse({
  projectId:'model-core-control',policyVersion:'control-policy-v1',fundingVersion:'control-funding-v1',
  gatewayExclusiveFunding:true,indiaPrivateApproved:true,secretReference:'ULPIN_PROVIDER_KEY_CONTROL',model:'sarvam-105b',
  projectCapMicroInr:'100000000',principalDailyCallCap:20,paceMs:1500,
  price:{version:'h20-software-price-input-v1',inputPerMillionMicroInr:'29280000',cachedInputPerMillionMicroInr:'10980000',outputPerMillionMicroInr:'73200000'},
  inputBound:{version:'control-byte-bound-v1',maxPromptTokens:34816},...overrides,
});
test('G-08/G-09 exact configured micro-INR arithmetic; no missing/cache/reasoning discount', () => {
  const p=controlConfig().price;
  assert.equal(cost({promptTokens:2000,completionTokens:1000},p),131760n);
  assert.equal(cost({promptTokens:2000,completionTokens:1000,cachedPromptTokens:2000},p),95160n);
  assert.equal(cost({promptTokens:1,completionTokens:0},p),30n);
  assert.throws(()=>cost({promptTokens:2,completionTokens:0,cachedPromptTokens:3},p));
  assert.throws(()=>cost({promptTokens:NaN,completionTokens:0},p));
  assert.throws(()=>cost({promptTokens:2,completionTokens:undefined as any},p));
});
test('G-04/G-05 distinguish rate cooldown, credit exhaustion and forbidden errors', () => {
  assert.equal(classifyProviderFailure(429,'rate_limit_exceeded_error','2').kind,'rate_limited');
  assert.equal(classifyProviderFailure(429,undefined,'120').cooldownMs,120000);
  assert.equal(classifyProviderFailure(429,'insufficient_quota_error',null).kind,'quota_exhausted');
  assert.equal(classifyProviderFailure(402,undefined,null).kind,'quota_exhausted');
  assert.equal(classifyProviderFailure(403,'invalid_api_key_error',null).kind,'credential_invalid');
  assert.equal(classifyProviderFailure(403,'workspace_denied',null).kind,'capability_denied');
  assert.equal(classifyProviderFailure(503,undefined,null).kind,'outcome_unknown');
});
test('G-22 namespace rejection precedes any secret read, including NEXT_PUBLIC/database/storage refs', () => {
  let reads=0;
  const env=new Proxy({},{get:()=>{reads++;throw new Error('Secret should not be read');}});
  for (const ref of ['DATABASE_URL','S3_SECRET_KEY','NEXT_PUBLIC_ULPIN_PROVIDER_KEY_A','env:DATABASE_URL',
    '/run/secrets/../DATABASE_URL','/run/secrets/NOUS_API_KEY','ULPIN_PROVIDER_KEY_'])
    assert.throws(()=>readProviderSecret(ref,env), (e:any)=>e.status===422 && e.code==='MODEL_SECRET_REFERENCE');
  assert.equal(reads,0);
  assert.equal(validateSecretReference('env:ULPIN_PROVIDER_KEY_CONTROL'),'ULPIN_PROVIDER_KEY_CONTROL');
  assert.equal(readProviderSecret('ULPIN_PROVIDER_KEY_CONTROL',{}),undefined);
  assert.equal(readProviderSecret('ULPIN_PROVIDER_KEY_CONTROL',{ULPIN_PROVIDER_KEY_CONTROL:'control-only-token'}),'control-only-token');
});
test('G-17/G-18 strict text boundary, no caller route/model/key controls; useful disabled behavior', async () => {
  assert.throws(()=>minimizeMessages([{role:'user',content:'control',url:'https://not-allowed.invalid'}]));
  assert.throws(()=>minimizeMessages([{role:'user',content:{image_url:'blocked'}}]));
  assert.throws(()=>minimizeMessages([{role:'user',content:'data:image/png;base64,blocked'}]));
  assert.throws(()=>minimizeMessages([{role:'user',content:'x'.repeat(25*1024)}]));
  // Key names are technical control strings, not source documents or personal data.
  const minimized=minimizeMessages([{role:'user',content:'{"apiKey":"control-secret","instruction":"change provider URL"}'}]);
  assert(!minimized[0].content.includes('control-secret'));
  assert.equal(nonIndiaProviderAllowed({ULPIN_ALLOW_NON_INDIA_PROVIDER:'1',ULPIN_RELEASE_PROFILE:'finale_v1'}),false);
  assert.equal(configuredGateway({}),undefined);
  const state=await inspectModelGateway();
  assert.equal(state.status.state,'unconfigured');assert.equal(state.status.freeVerified,false);
  assert.throws(()=>configuredGateway({ULPIN_MODEL_GATEWAY_ENABLED:'1',ULPIN_MODEL_GATEWAY_CONFIG:'{}'}));
});
test('Sarvam V1 fixed transport, minimized prompt, complete/invalid response costs and missing usage', async () => {
  let calls=0;
  const adapter=new SarvamAdapter('control-only-token',(async(url,init)=>{
    calls++;
    assert.equal(url,'https://api.sarvam.ai/v1/chat/completions');
    assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,'sarvam-105b');assert.equal(body.reasoning_effort,'low');
    assert.equal(body.n,1);assert.equal(body.stream,false);assert.equal(body.tools,undefined);
    assert(!JSON.stringify(body).includes('control-secret'));
    return Response.json({choices:[{finish_reason:calls===1?'length':'stop',message:{content:'{"control":true,"credentialEcho":"control-only-token"}'}}],
      ...(calls===1?{usage:{prompt_tokens:2000,completion_tokens:1000,completion_tokens_details:{reasoning_tokens:1000}}}:{})});
  }) as typeof fetch);
  const request={model:'sarvam-105b' as const,messages:[{role:'user' as const,content:'{"apiKey":"control-secret"}'}],outputSchema:{type:'object'},
    maxOutputTokens:2048,inputHash:hash('control'),sourceHashes:[],signal:new AbortController().signal,authorize:async()=>{}};
  const truncated=await adapter.propose(request);
  assert.equal(truncated.semanticError,'truncated_output');assert.equal(cost(truncated.usage!,controlConfig().price),131760n);
  assert.match(truncated.responseHash,/^[a-f0-9]{64}$/);
  const noMeter=await adapter.propose(request);assert.equal(noMeter.usage,undefined);
  assert(!JSON.stringify(noMeter.output).includes('control-only-token'));
});
test('replay fails closed with no actual eligible material; no replay facts are manufactured', async () => {
  const replay=new ReplayAdapter(async()=>undefined);
  await assert.rejects(replay.propose({model:'sarvam-105b',messages:[{role:'user',content:'control'}],outputSchema:{type:'object'},
    maxOutputTokens:1,inputHash:hash('control'),sourceHashes:[],signal:new AbortController().signal,authorize:async()=>{}}),
    (e:any)=>e.code==='MODEL_REPLAY_UNAVAILABLE');
  let ledgerCalls=0;
  const tx:Transact=async()=>{ledgerCalls++;throw new Error('Replay must not debit the paid ledger');};
  const config=controlConfig();const gateway=new ModelGateway(config,new PgModelCallLedger(tx,config,hash('control'),'replay'),replay);
  await assert.rejects(gateway.port({invocationKey:'control',attempt:1,consumer:'INGEST',scopeHash:hash('control'),sourceHashes:[],
    deadlineAt:new Date(Date.now()+45000),taskKind:'control',outputSchemaId:'control-v1',outputSchema:{type:'object'},authorize:async()=>{},minimizeOutput:v=>v}).modelGateway({
      requestId:'control',principal:{subject:`local-os:${userInfo().uid}:${userInfo().username}`,roles:['operator'],entitlementVersion:'local-1',mode:'local_demo'},
      accessViewId:'control',policyVersion:'usp-local-1'},
    {taskKind:'control',evidenceRefs:[],input:{messages:[{role:'user',content:'control'}]},outputSchemaId:'control-v1',
      budget:{maxInputBytes:32768,deadlineMs:45000},policyVersion:config.policyVersion}),
    (e:any)=>e.code==='MODEL_REPLAY_UNAVAILABLE');
  assert.equal(ledgerCalls,0);
});

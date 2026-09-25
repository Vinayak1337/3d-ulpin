/** Configuration, checksum arithmetic and transport controls only. No invented source/identity records. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedLoopbackHost } from '../../../apps/web/lib/server/loopback-host';
import { nonIndiaProviderAllowed } from '../../../apps/web/lib/server/provider-policy';
import { workspaceCapabilities } from '../../../apps/web/lib/server/workspace-capabilities';
import { workspacePrivacyCopy } from '../../../apps/web/lib/workspace-capabilities';
import { passesVerhoeff, redactDerivative, redactDocumentViews, assertNoImageEgress } from '../../../apps/web/lib/server/usp/ingest/redact';
import { callNous, inspectNous, extractionMessages } from '../../../apps/web/lib/server/officer-ai-provider';
import { selectedImageCrops } from '../../../apps/web/lib/server/officer-ai-images';

test('only canonical loopback authorities and explicitly configured ports pass', () => {
  for (const host of ['localhost:3108','LOCALHOST:3108','127.0.0.1:3108','[::1]:3108']) assert(allowedLoopbackHost(host,'3108'));
  assert(allowedLoopbackHost('localhost','80'));
  for (const host of [null,'','localhost','localhost:3000','localhost.:3108','localhost.evil:3108','localhost:3108@evil','evil@localhost:3108','127.1:3108','2130706433:3108','0x7f000001:3108','[::ffff:127.0.0.1]:3108','localhost:03108','localhost:65536','localhost:3108/','localhost:3108,evil',' localhost:3108','localhost:3108\n','http://localhost:3108']) assert(!allowedLoopbackHost(host,'3108'));
  for (const config of ['', '3108,', '3108, 3000','*','65536','03108']) assert(!allowedLoopbackHost('localhost:3108',config));
});
test('exact opt-in and finale veto are independent configuration controls', () => {
  for (const value of [undefined,'','0','true','yes',' 1','1 ']) assert(!nonIndiaProviderAllowed({ULPIN_ALLOW_NON_INDIA_PROVIDER:value}));
  assert(nonIndiaProviderAllowed({ULPIN_ALLOW_NON_INDIA_PROVIDER:'1'}));
  assert(!nonIndiaProviderAllowed({ULPIN_ALLOW_NON_INDIA_PROVIDER:'1',ULPIN_RELEASE_PROFILE:'finale_v1'}));
});
test('capabilities do not imply physical location, residency, entitlement or image clearance', () => {
  const disabled = workspaceCapabilities({});
  assert.equal(disabled.provider,'blocked'); assert.equal(disabled.runtime,'unknown');
  const local = workspaceCapabilities({DATABASE_URL:'postgresql://127.0.0.1:25432',S3_ENDPOINT:'http://127.0.0.1:29000',GEO_URL:'http://127.0.0.1:28000',REDIS_URL:'redis://127.0.0.1:26379'});
  assert.equal(local.runtime,'loopback-configured');assert.equal(local.fullResidency,'unverified');assert.equal(local.imageEgress,'blocked');
  assert.match(workspacePrivacyCopy(local).runtime,/unverified/);
  assert.match(workspacePrivacyCopy().provider,/unknown/);
  assert.equal(workspaceCapabilities({GEO_URL:'https://example.invalid'}).runtime,'external-configured');
});
test('Verhoeff arithmetic on short non-identity control inputs and unavailable values', () => {
  assert(!passesVerhoeff(''));assert(!passesVerhoeff('control'));
  // Every one-digit prefix has exactly one valid checksum digit. No 12-digit identifiers generated.
  for (let prefix=0;prefix<10;prefix++) assert.equal(Array.from({length:10},(_,digit)=>passesVerhoeff(`${prefix}${digit}`)).filter(Boolean).length,1);
  const states={ownerName:null,email:'withheld',phone:'unknown',pan:'conflicting'};
  assert.deepEqual(redactDerivative(states),states);
  assert.deepEqual(redactDocumentViews({parts:[],revision:3}),{parts:[],revision:3});
});
test('image denial precedes original storage/processor access and message construction', async () => {
  assert.doesNotThrow(()=>assertNoImageEgress([]));
  assert.throws(()=>assertNoImageEgress([null]),/AI_IMAGE_PRIVACY/);
  // Malformed selection is a transport input, not a document/image fixture.
  await assert.rejects(selectedImageCrops([], [null as never]),/AI_IMAGE_PRIVACY/);
  assert.throws(()=>extractionMessages([],{},undefined,[null as never]),/AI_IMAGE_PRIVACY/);
});
test('provider denial/no-key paths make zero requests; opted-in fake transport remains bounded', async () => {
  process.env.NOUS_API_KEY='transport-control-token';
  delete process.env.ULPIN_ALLOW_NON_INDIA_PROVIDER;
  delete process.env.ULPIN_RELEASE_PROFILE;
  let calls=0;
  const denyFetch=(async()=>{calls++;throw new Error('unexpected request');}) as typeof fetch;
  const blocked=await inspectNous(denyFetch);assert(!blocked.status.configured);
  await assert.rejects(callNous('control',[],denyFetch),/AI_PROVIDER_POLICY/);assert.equal(calls,0);
  process.env.ULPIN_ALLOW_NON_INDIA_PROVIDER='1';process.env.ULPIN_RELEASE_PROFILE='finale_v1';
  assert(!(await inspectNous(denyFetch)).status.configured);
  await assert.rejects(callNous('control',[],denyFetch),/AI_PROVIDER_POLICY/);assert.equal(calls,0);
  delete process.env.ULPIN_RELEASE_PROFILE;delete process.env.NOUS_API_KEY;
  assert.equal((await inspectNous(denyFetch)).status.state,'unconfigured');
  await assert.rejects(callNous('control',[],denyFetch),/not configured/);assert.equal(calls,0);
  process.env.NOUS_API_KEY='transport-control-token';
  await assert.rejects(callNous('control',[{role:'user',content:[]}],denyFetch),/AI_IMAGE_PRIVACY/);assert.equal(calls,0);
  const messages=extractionMessages([], {unapprovedField:'control'});
  assert(!JSON.stringify(messages).includes('unapprovedField'));
  const result=await callNous('control',messages,(async(url,init)=>{
    calls++;assert.equal(url,'https://inference-api.nousresearch.com/v1/chat/completions');assert.equal(init?.redirect,'error');
    const payload=JSON.parse(String(init?.body));assert.equal(payload.tools,undefined);assert(payload.max_tokens<=6000);
    return Response.json({choices:[{message:{content:'{"candidates":[],"questions":[]}'}}],unapprovedEnvelope:'discard',usage:{prompt_tokens:0,completion_tokens:0}});
  }) as typeof fetch);
  assert.equal(calls,1);assert(!JSON.stringify(result.raw).includes('unapprovedEnvelope'));
  assert.equal(result.call.outputHash?.length,64);
  await assert.rejects(callNous('control',[],(async()=>{throw new Error('private upstream detail');}) as typeof fetch),error=>error instanceof Error && !error.message.includes('private upstream detail'));
  assert.equal((await inspectNous((async()=>{throw new Error('Nous returned HTTP private upstream detail');}) as typeof fetch)).status.message.includes('private upstream detail'),false);
  delete process.env.NOUS_API_KEY;delete process.env.ULPIN_ALLOW_NON_INDIA_PROVIDER;
});

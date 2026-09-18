import assert from "node:assert/strict";
import test from "node:test";
import type {QueryResultRow} from "../apps/web/node_modules/@types/pg";
import {LegacySpatialReadError,readLegacySpatialSlice,type LegacyReadClient} from "../apps/web/lib/server/spatial-core-read";
import {handleLegacyCoreRead} from "../apps/web/lib/server/spatial-core-http";
import {legacySliceFixture,LEGACY_IDS} from "./fixtures/core-legacy";

function clientFixture(options:{missing?:boolean;throwRead?:boolean;overflow?:boolean;corruptRecord?:boolean;columnEnvelope?:boolean}={}) {
  const data=legacySliceFixture(),calls:{sql:string;values?:unknown[]}[]=[];let released=false;
  const client:LegacyReadClient={
    async query<R extends QueryResultRow>(sql:string,values?:unknown[]):Promise<{rows:R[]}>{
      calls.push({sql,values});let rows:unknown[]=[];
      if(sql.includes('FROM map_areas'))rows=options.missing?[]:[data.area];
      else if(sql.includes('FROM physical_features')){if(options.throwRead)throw new Error("SECRET_SQL_URL_MUST_NOT_LEAK");rows=options.overflow?Array(513).fill(data.features[0]):[...data.features];}
      else if(sql.includes('FROM registry_sites'))rows=[...data.sites];
      else if(sql.includes('FROM registry_records'))rows=data.records.map(body=>{
        const payload={...body};if(options.columnEnvelope){delete (payload as Partial<typeof payload>).id;delete (payload as Partial<typeof payload>).siteId;delete (payload as Partial<typeof payload>).revision;delete (payload as Partial<typeof payload>).identifier;}
        return {id:body.id,identifier:body.identifier,revision:options.corruptRecord?999:body.revision,siteId:body.siteId,body:payload};
      });
      else if(sql.includes('FROM sources'))rows=[...data.sources];
      return {rows:rows as R[]};
    },
    release(){released=true;},
  };
  return {client,data,calls,get released(){return released;}};
}

test("one read-only repeatable-read connection serves the whole bound area snapshot",async()=>{
  const f=clientFixture();const result=await readLegacySpatialSlice(LEGACY_IDS.area,"synthetic",async()=>f.client);
  assert.equal(f.calls[0].sql,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(f.calls.at(-1)!.sql,"COMMIT");assert(f.released);
  assert(f.calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/i.test(c.sql)));
  const feature=f.calls.find(c=>c.sql.includes("FROM physical_features"))!;
  assert.deepEqual(feature.values,[LEGACY_IDS.area,"synthetic",513]);
  assert(feature.sql.includes("memberAreaIds"));assert(!feature.sql.includes("ST_Transform"));
  assert(feature.sql.includes("f.body-'properties'-'sourceGeometry'"));
  assert(feature.sql.includes("'attribution'")&&feature.sql.includes("'license'")&&feature.sql.includes("jsonb_strip_nulls"));
  const source=f.calls.find(c=>c.sql.includes("FROM sources"))!;
  assert(source.sql.includes('family_id AS "familyId"'));assert(!source.sql.includes("inspection"));assert(!source.sql.includes("object_key"));
  assert.equal(result.sources[0].sha256,"a".repeat(64));assert.equal(result.sources[0].revision,7);
});
for(const [name,options,code] of [
  ["not found",{missing:true},"AREA_NOT_FOUND"],
  ["bounded slice exceeded",{overflow:true},"LEGACY_READ_LIMIT"],
  ["row revision mismatch",{corruptRecord:true},"LEGACY_RECORD_CONFLICT"],
] as const)test(`failed legacy read rolls back and releases: ${name}`,async()=>{
  const f=clientFixture(options);
  await assert.rejects(()=>readLegacySpatialSlice(LEGACY_IDS.area,"synthetic",async()=>f.client),e=>e instanceof LegacySpatialReadError&&e.code===code);
  assert.equal(f.calls.at(-1)!.sql,"ROLLBACK");assert(f.released);
});
test("query failure never commits a partial read",async()=>{
  const f=clientFixture({throwRead:true});await assert.rejects(()=>readLegacySpatialSlice(LEGACY_IDS.area,"synthetic",async()=>f.client));
  assert(!f.calls.some(c=>c.sql==="COMMIT"));assert(f.released);
});
test("invalid selection is rejected before connection allocation",async()=>{
  let connected=false;await assert.rejects(()=>readLegacySpatialSlice("x' OR true;--","synthetic",async()=>{connected=true;return clientFixture().client;}));assert(!connected);
});
test("registry column envelopes need not be duplicated inside the stored body",async()=>{
  const f=clientFixture({columnEnvelope:true});const result=await readLegacySpatialSlice(LEGACY_IDS.area,"synthetic",async()=>f.client);
  assert.deepEqual(result.records,f.data.records);assert(f.released);
});
test("local HTTP read is bounded, uncached and uses the server's scope",async()=>{
  const response=await handleLegacyCoreRead(new Request(`http://localhost:3000/api/v1/spatial/core/areas/${LEGACY_IDS.area}?world=synthetic`),LEGACY_IDS.area,async()=>legacySliceFixture());
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
  const body=await response.json();assert.equal(body.consistency,"repeatable-read-read-only");assert.equal(body.input.context.scope.ceiling,"operator");
  assert(!JSON.stringify(body).includes("NEVER_COPY_RAW_PROPERTIES"));assert.match(body.readDigest,/^[a-f0-9]{64}$/);
});
test("expected digest mismatch reports a coherent reload rather than partial freshness",async()=>{
  const response=await handleLegacyCoreRead(new Request(`http://localhost:3000/x?world=synthetic&expectedDigest=${"0".repeat(64)}`),LEGACY_IDS.area,async()=>legacySliceFixture());
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,"SNAPSHOT_CHANGED");
});
for(const [name,url,headers,status] of [
  ["external host","http://example.org/x?world=synthetic",{},403],
  ["external Host header","http://localhost:3000/x?world=synthetic",{host:"example.org"},403],
  ["cross-origin fetch","http://localhost:3000/x?world=synthetic",{origin:"https://example.org"},403],
  ["scope override","http://localhost:3000/x?world=synthetic&scope=public",{},400],
  ["missing explicit world","http://localhost:3000/x",{},400],
  ["malformed Host header","http://localhost:3000/x?world=synthetic",{host:"[invalid"},403],
  ["repeated world","http://localhost:3000/x?world=synthetic&world=observed",{},400],
] as const)test(`HTTP preflight does not read data: ${name}`,async()=>{
  let read=false;const response=await handleLegacyCoreRead(new Request(url,{headers}),LEGACY_IDS.area,async()=>{read=true;return legacySliceFixture();});assert.equal(response.status,status);assert(!read);
});
test("HTTP failure does not expose connection strings or SQL",async()=>{
  const response=await handleLegacyCoreRead(new Request("http://localhost:3000/x?world=synthetic"),LEGACY_IDS.area,async()=>{throw new Error("postgres://private-host:secret@database");});
  assert.equal(response.status,503);assert(!(await response.text()).includes("private-host"));
});
test("normalization errors retain their stable contract code across the HTTP boundary",async()=>{
  const x=legacySliceFixture();x.features[0].revision=999;
  const response=await handleLegacyCoreRead(new Request("http://localhost:3000/x?world=synthetic"),LEGACY_IDS.area,async()=>x);
  assert.equal(response.status,422);assert.equal((await response.json()).error.code,"LEGACY_RECORD_CONFLICT");
});

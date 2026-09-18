/** Deterministic bundled-schema generation from the contracts package only. */
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {CORE_RELATION_POLICY,CORE_EVIDENCE_POLICY,CoreIdentityCommandSchema,CoreIdentityGraphSchema,CoreNumberValueSchema,CoreSourceCatalogSchema} from "../../packages/contracts/src/spatial/core";
import {identityCases} from "../../tests/fixtures/core-identity";
import {sourceCases} from "../../tests/fixtures/core-sources";
import {CORE_FRAME_POLICY,CoreFrameCatalogSchema,CorePointTransformSchema} from "../../packages/contracts/src/spatial/core/frame-schema";
import {frameCases} from "../../tests/fixtures/core-frames";
import {CORE_GEOMETRY_POLICY,CoreGeometryCatalogSchema,CoreMeasureRequestSchema} from "../../packages/contracts/src/spatial/core/geometry-schema";
import {geometryCases} from "../../tests/fixtures/core-geometry";
import {CORE_SNAPSHOT_POLICY,CoreSnapshotInputSchema,CoreSnapshotManifestSchema,CorePublicationCandidateSchema} from "../../packages/contracts/src/spatial/core/snapshot-schema";
import {buildCoreSnapshot} from "../../packages/contracts/src/spatial/core/snapshot";
import {publicationCases,signatureCases,snapshotCases} from "../../tests/fixtures/core-snapshot";
const require=createRequire(new URL('../../packages/contracts/package.json',import.meta.url));
const {z}=require('zod');
const root=fileURLToPath(new URL('../../',import.meta.url));
const mode=process.argv[2]||'check';assert(['write','check'].includes(mode),'Use write or check');
const exportSchema=(schema:unknown)=>z.toJSONSchema(schema,{target:'draft-2020-12',io:'input',unrepresentable:'throw'});
const graph={...exportSchema(CoreIdentityGraphSchema),'x-ulpin-relation-policy':CORE_RELATION_POLICY};
const artifacts:[string,unknown][]=[];
for(const prefix of ['packages/contracts/schemas','services/geo/geo/contracts']) {
  artifacts.push([`${prefix}/identity-graph.schema.json`,graph],[`${prefix}/identity-command.schema.json`,exportSchema(CoreIdentityCommandSchema)],[`${prefix}/number-value.schema.json`,exportSchema(CoreNumberValueSchema)]);
  artifacts.push([`${prefix}/source-catalog.schema.json`,{...exportSchema(CoreSourceCatalogSchema),'x-ulpin-evidence-policy':CORE_EVIDENCE_POLICY}]);
  artifacts.push([`${prefix}/frame-catalog.schema.json`,{...exportSchema(CoreFrameCatalogSchema),'x-ulpin-frame-policy':CORE_FRAME_POLICY}]);
  artifacts.push([`${prefix}/point-transform.schema.json`,exportSchema(CorePointTransformSchema)]);
  artifacts.push([`${prefix}/geometry-catalog.schema.json`,{...exportSchema(CoreGeometryCatalogSchema),'x-ulpin-geometry-policy':CORE_GEOMETRY_POLICY}]);
  artifacts.push([`${prefix}/measure-request.schema.json`,exportSchema(CoreMeasureRequestSchema)]);
  artifacts.push([`${prefix}/snapshot-input.schema.json`,{...exportSchema(CoreSnapshotInputSchema),'x-ulpin-snapshot-policy':CORE_SNAPSHOT_POLICY}]);
  artifacts.push([`${prefix}/snapshot-manifest.schema.json`,exportSchema(CoreSnapshotManifestSchema)]);
  artifacts.push([`${prefix}/publication-candidate.schema.json`,exportSchema(CorePublicationCandidateSchema)]);
}
artifacts.push(['fixtures/contracts/identity.cases.json',{schemaVersion:'ulpin-identity-conformance/1',cases:identityCases()}]);
artifacts.push(['fixtures/contracts/source.cases.json',{schemaVersion:'ulpin-source-conformance/1',cases:sourceCases()}]);
artifacts.push(['fixtures/contracts/frame.cases.json',{schemaVersion:'ulpin-frame-conformance/1',cases:frameCases()}]);
artifacts.push(['fixtures/contracts/geometry.cases.json',{schemaVersion:'ulpin-geometry-conformance/1',cases:geometryCases()}]);
artifacts.push(['fixtures/contracts/snapshot.cases.json',{schemaVersion:'ulpin-snapshot-conformance/1',cases:await Promise.all(snapshotCases().map(async row=>{
  if(!row.valid)return row;const result=await buildCoreSnapshot(row.input);
  return {...row,expectedDigests:{input:result.manifest.inputDigest,geometry:result.manifest.geometryDigest}};
}))}]);
artifacts.push(['fixtures/contracts/signature.cases.json',{schemaVersion:'ulpin-signature-conformance/1',cases:signatureCases}]);
artifacts.push(['fixtures/contracts/publication.cases.json',{schemaVersion:'ulpin-publication-conformance/1',cases:await publicationCases()}]);
for(const [name,value] of artifacts) {
  const file=path.join(root,name),text=JSON.stringify(value,null,2)+'\n';
  if(mode==='write'){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);}
  else assert.equal(await readFile(file,'utf8'),text,`Generated contract drift: ${name}`);
}
console.log(JSON.stringify({kind:'core-schema-generation',mode,artifacts:artifacts.length,identityCases:identityCases().length,result:'PASS'}));

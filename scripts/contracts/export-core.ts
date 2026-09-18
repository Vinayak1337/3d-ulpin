/** Deterministic bundled-schema generation from the contracts package only. */
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {CORE_RELATION_POLICY,CoreIdentityCommandSchema,CoreIdentityGraphSchema,CoreNumberValueSchema} from "../../packages/contracts/src/spatial/core";
import {identityCases} from "../../tests/fixtures/core-identity";
const require=createRequire(new URL('../../packages/contracts/package.json',import.meta.url));
const {z}=require('zod');
const root=fileURLToPath(new URL('../../',import.meta.url));
const mode=process.argv[2]||'check';assert(['write','check'].includes(mode),'Use write or check');
const exportSchema=(schema:unknown)=>z.toJSONSchema(schema,{target:'draft-2020-12',io:'input',unrepresentable:'throw'});
const graph={...exportSchema(CoreIdentityGraphSchema),'x-ulpin-relation-policy':CORE_RELATION_POLICY};
const artifacts:[string,unknown][]=[];
for(const prefix of ['packages/contracts/schemas','services/geo/geo/contracts']) {
  artifacts.push([`${prefix}/identity-graph.schema.json`,graph],[`${prefix}/identity-command.schema.json`,exportSchema(CoreIdentityCommandSchema)],[`${prefix}/number-value.schema.json`,exportSchema(CoreNumberValueSchema)]);
}
artifacts.push(['fixtures/contracts/identity.cases.json',{schemaVersion:'ulpin-identity-conformance/1',cases:identityCases()}]);
for(const [name,value] of artifacts) {
  const file=path.join(root,name),text=JSON.stringify(value,null,2)+'\n';
  if(mode==='write'){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);}
  else assert.equal(await readFile(file,'utf8'),text,`Generated contract drift: ${name}`);
}
console.log(JSON.stringify({kind:'core-schema-generation',mode,artifacts:artifacts.length,identityCases:identityCases().length,result:'PASS'}));

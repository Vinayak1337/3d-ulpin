import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {executeMappingPlanV2} from '../../../../packages/server/src/modules/usp/ingestion/mapping-executor';
import {validateMappingPlanV2} from '../../../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import {CanonicalMappedValueSchema,type MappingLayoutField} from '../../../../packages/contracts/src/index';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const out=resolve(root,'docs/evidence/gf-agent/a1');
// Reuse the repository's tabular parser dependency/settings; no parallel CSV or GIS conversion service.
const Papa=createRequire(resolve(root,'packages/server/package.json'))('papaparse');
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const save=(name:string,value:unknown)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
const goodPath='fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv';
const difficultPath=process.argv[2]??'E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json';
const goodBytes=readFileSync(resolve(root,goodPath)),difficultBytes=readFileSync(difficultPath);
const manifest=json(resolve(root,'fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json'));
const gmdaAsset=manifest.assets.find((asset:any)=>asset.id==='gmda-sector-boundaries');
const lgdAsset=manifest.assets.find((asset:any)=>asset.id==='lgd-gurugram.csv');
assert.equal(digest(goodBytes),lgdAsset.content.sha256,'Use only the unchanged manifest-pinned LGD fixture.');
assert.equal(digest(difficultBytes),gmdaAsset.provenance.original.sha256,'Use only the unchanged manifest-pinned GMDA original.');
const header=Papa.parse(goodBytes.toString('utf8'),{preview:1}).data[0];
const csv=Papa.parse(goodBytes.toString('utf8'),{header:true,dynamicTyping:false,skipEmptyLines:true});
assert.equal(csv.errors.length,0);assert.equal(new Set(header).size,header.length);
const layer=JSON.parse(difficultBytes.toString('utf8'));
assert.equal(layer.spatialReference.wkid,32643);assert.equal(layer.features.length,2);
// This is the attribute projection of the already retained ArcGIS JSON, not a geometry reader or reprojection.
const rows=layer.features.map((feature:any)=>feature.attributes);
const gisFields:MappingLayoutField[]=layer.fields.map((field:any)=>({name:field.name,
  inferredType:field.type==='esriFieldTypeString'?'text':'number'}));
const inputs=[{name:'lgd',path:goodPath,bytes:goodBytes,rows:csv.data,context:{sourceKind:'tabular' as const,
  fields:header.map((name:string)=>({name,inferredType:'text' as const})),sourceRef:goodPath,rowCount:csv.data.length},
  permission:lgdAsset.permission.state,purpose:lgdAsset.provenance.purpose,sourceCrs:null},
  {name:'gmda',path:difficultPath,bytes:difficultBytes,rows,context:{sourceKind:'gis_attributes' as const,fields:gisFields,
    sourceRef:gmdaAsset.id,rowCount:rows.length,sourceCrs:gmdaAsset.reference.horizontalCrs},
    permission:gmdaAsset.permission.state,purpose:gmdaAsset.provenance.purpose,sourceCrs:gmdaAsset.reference.horizontalCrs}];
const results=[];
for(const input of inputs){
  const plan=json(resolve(out,input.name+'.plan.json'));
  const validated=validateMappingPlanV2(plan,input.context);assert(validated.success,JSON.stringify(validated.errors));
  const executed=executeMappingPlanV2(plan,input.rows,input.context);
  assert.equal(executed.rows.length,input.rows.length);
  assert.equal(executed.counts.cells,input.rows.length*input.context.fields.length);
  for(const row of executed.rows)for(const cell of row.fields){
    const {sourceField,target,...value}=cell;assert(CanonicalMappedValueSchema.safeParse(value).success);
    assert.equal(cell.state,'unknown','These administrative sources must not become building or parcel facts.');
    assert.deepEqual(cell.literal,input.rows[row.row][sourceField]);
  }
  save(input.name+'.output.json',{input:{path:input.path,sha256:digest(input.bytes),bytes:input.bytes.length,
    permission:input.permission,purpose:input.purpose,sourceCrs:input.sourceCrs},validation:validated,execution:executed});
  results.push({input:input.path,sha256:digest(input.bytes),bytes:input.bytes.length,sourceKind:input.context.sourceKind,
    rows:executed.rows.length,...executed.counts,validation:'passed',disposition:'explicit_unknown_no_invented_meaning',sourceCrs:input.sourceCrs});
}
assert.equal(digest(readFileSync(resolve(root,goodPath))),digest(goodBytes));
assert.equal(digest(readFileSync(difficultPath)),digest(difficultBytes));
const context=inputs[0].context,base=json(resolve(out,'lgd.plan.json'));
const rejections=[];
for(const [caseId,injection] of [['literal_epsg',{epsg:'EPSG:4326'}],['literal_factor',{factor:0.09290304}]] as const){
  const raw={...base,fields:[{...base.fields[0],operation:{kind:'copy',...injection}},...base.fields.slice(1)]};
  const result=validateMappingPlanV2(raw,context);assert.equal(result.errors[0]?.code,'MAPPING_LITERAL_FORBIDDEN');
  rejections.push({caseId,code:result.errors[0].code,result:'rejected'});
}
save('result.json',{schemaVersion:'mapping-v2-a1-evidence/1',task:'A1',gates:['GF-CONTRACT','GF-AGENT'],
  scope:'Deterministic contract/executor foundation, not whole-gate qualification or held-out accuracy.',
  codeCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),runAt:new Date().toISOString(),
  environment:{node:process.version,platform:process.platform},command:'pnpm exec tsx docs/evidence/gf-agent/a1/run.ts',exitCode:0,
  inputs:results,literalRejections:rejections,sourceHashesUnchanged:true,
  limitations:['Both Indian inputs are administrative context; all their fields correctly stay unknown. No positive Indian building/unit/parcel mapping accuracy is claimed.',
    'GMDA coordinates stay in the original EPSG:32643 source; no reprojection, geometry role or parcel semantics are inferred.',
    'Gaj lacks a verified Indian-government square-yard definition; gaj/marla/bigha/kanal/cent/guntha return needs_input.',
    'Runtime provider, memory/student routing, persisted v2 review receipts and API activation belong to A2/A3; existing v1 API contracts are unchanged.',
    'Existing manual-ingestion API metadata test has an unrelated operation-ledger count mismatch (288 actual versus 235 expected).'],
  checks:[{command:'pnpm install --frozen-lockfile',exitCode:0},
    {command:'pnpm exec tsx --test packages/contracts/src/canonical/*.test.ts packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts packages/server/src/modules/usp/ingestion/mapping-executor.test.ts packages/server/src/modules/usp/ingestion/unit-table.test.ts tests/adaptive-mapping.test.ts',exitCode:0,result:'13 passed: 9 new tests and 4 existing adaptive tests.'},
    {command:'pnpm exec tsx --tsconfig apps/api/tsconfig.json --test --test-name-pattern=\"manual operation contract\" tests/manual-ingestion.test.ts',exitCode:0,result:'1 existing manual literal-boundary test passed.'},
    {command:'git diff --check',exitCode:0},
    {command:'pnpm --filter @ulpin/server typecheck',exitCode:0},
    {command:'pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler packages/contracts/src/index.ts packages/contracts/src/usp/index.ts',exitCode:0},
    {command:'pnpm exec tsx --test packages/contracts/src/canonical/*.test.ts packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts packages/server/src/modules/usp/ingestion/mapping-executor.test.ts packages/server/src/modules/usp/ingestion/unit-table.test.ts tests/adaptive-mapping.test.ts tests/manual-ingestion.test.ts',exitCode:1,
      result:'Initial run: test fixture URL had one extra parent directory (fixed); API metadata import required decorator tsconfig (fixed invocation).'},
    {command:'pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/contracts/src/canonical/*.test.ts packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts packages/server/src/modules/usp/ingestion/mapping-executor.test.ts packages/server/src/modules/usp/ingestion/unit-table.test.ts tests/adaptive-mapping.test.ts tests/manual-ingestion.test.ts',exitCode:1,
      result:'14 passed; API metadata-count assertion failed: 288 !== 235. No A1 routes added; broader ledger check remains failed.'}]});
console.log(JSON.stringify({inputs:results,literalRejections:rejections},null,2));

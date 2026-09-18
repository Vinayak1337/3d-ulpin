/** Bounded T003 structural-authority experiment; not a second production model. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const {z}=require('zod');
export const MAX_SAFE=9007199254740991;
export const portableId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}(?![\s\S])/);
// A Unicode-mode code-point bound avoids JS UTF-16 .length versus Python's
// code-point length disagreement. Controls are excluded consistently.
export const portableText=z.string().regex(/^[^\u0000-\u001f\u007f]{1,64}(?![\s\S])/u);
export const sampleSchema=z.strictObject({
  id:portableId,
  revision:z.number().int().min(0).max(MAX_SAFE),
  label:portableText,
  sourceRevision:z.number().int().min(1).max(MAX_SAFE).nullable(),
  point:z.tuple([z.number(),z.number()]).readonly(),
  observation:z.discriminatedUnion('state',[
    z.strictObject({state:z.literal('known'),value:z.number(),unit:z.enum(['m','ft','mm'])}),
    z.strictObject({state:z.literal('unknown'),reason:portableText}),
  ]),
  related:z.array(portableId).max(3).readonly(),
});
export function exportedSchema() {
  return z.toJSONSchema(sampleSchema,{target:'draft-2020-12',unrepresentable:'throw',io:'input'});
}
export function corpus() {
  const base={id:'source-0001',revision:0,label:'भवन A',sourceRevision:null,point:[0,-0.25],observation:{state:'known',value:304.8,unit:'mm'},related:[]};
  const row=(id,value,valid)=>({id,value,valid});
  return [
    row('known-zero-document',base,true),
    row('unknown-not-zero',{...base,observation:{state:'unknown',reason:'Height not supplied'}},true),
    row('unicode-code-point-boundary',{...base,label:'😀'.repeat(64)},true),
    row('unicode-over-boundary',{...base,label:'😀'.repeat(65)},false),
    row('unicode-bmp',{...base,label:'उत्तम नगर'},true),
    row('null-must-be-explicit',Object.fromEntries(Object.entries(base).filter(([k])=>k!=='sourceRevision')),false),
    row('invalid-source-zero',{...base,sourceRevision:0},false),
    row('string-revision',{...base,revision:'1'},false),
    row('boolean-revision',{...base,revision:true},false),
    row('fractional-revision',{...base,revision:1.5},false),
    row('unsafe-integer',{...base,revision:MAX_SAFE+1},false),
    row('safe-boundary',{...base,revision:MAX_SAFE},true),
    row('extra-field',{...base,owner:'not-a-core-field'},false),
    row('extra-variant-field',{...base,observation:{...base.observation,inferred:true}},false),
    row('future-variant',{...base,observation:{state:'guessed',value:1}},false),
    row('invalid-unit',{...base,observation:{...base.observation,unit:'pixels'}},false),
    row('tuple-extra-dimension',{...base,point:[0,1,2]},false),
    row('tuple-missing-dimension',{...base,point:[0]},false),
    row('array-bound',{...base,related:['a','b','c','d']},false),
    row('related-identifier-not-label',{...base,related:['😀']},false),
    row('control-character',{...base,label:'line\nbreak'},false),
    row('trailing-control-id',{...base,id:'source\n'},false),
    row('known-zero',{...base,observation:{state:'known',value:0,unit:'m'}},true),
  ];
}
export function assertExperiment() {
  for(const item of corpus())assert.equal(sampleSchema.safeParse(item.value).success,item.valid,item.id);
  assert.throws(()=>z.toJSONSchema(z.string().transform(x=>x.length)),/transform|represent/i);
  for(const n of [NaN,Infinity,-Infinity])assert(!sampleSchema.safeParse({...corpus()[0].value,point:[0,n]}).success);
  // Characterize the installed release, not historical JS-length assumptions.
  // Zod 4.6.2 counts Unicode code points here (verified with fromCodePoint too).
  assert(z.string().max(64).safeParse('😀'.repeat(64)).success);
  assert(!z.string().max(63).safeParse('😀'.repeat(64)).success);
  assert(portableText.safeParse('😀'.repeat(64)).success);
  assert.deepEqual(exportedSchema(),exportedSchema());
}
export async function run(mode='check') {
  assert(['check','write'].includes(mode),'Use check or write');
  assertExperiment();
  const folder=resolve(fileURLToPath(new URL('../../fixtures/contracts',import.meta.url)));
  const outputs=[['authority.schema.json',exportedSchema()],['authority.cases.json',{schemaVersion:'ulpin-authority-experiment/1',cases:corpus()}]];
  if(mode==='write')await mkdir(folder,{recursive:true});
  for(const [name,value] of outputs) {
    const expected=JSON.stringify(value,null,2)+'\n',file=resolve(folder,name);
    if(mode==='write')await writeFile(file,expected);
    else assert.equal(await readFile(file,'utf8'),expected,`Generated schema/corpus drift: ${name}`);
  }
  console.log(JSON.stringify({kind:'structural-authority-experiment',cases:corpus().length,result:'PASS',zod:require('zod/package.json').version,generatedSchemaChecked:mode==='check'}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run(process.argv[2]||'check');

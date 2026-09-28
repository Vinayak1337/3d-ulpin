/** Offline capability check. It never dispatches inference or treats valid JSON as semantic truth.
 * Usage: pnpm exec tsx scripts/usp/adaptive-mapping-check.ts
 *   --original <retained.geojson> --profile <API-profile.json>
 *   --oracle <independently checked source-oracle.json> [--capture <actual-gateway-output.json>]
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {SourcePathSchema,SourceProfileSchema} from '../../packages/contracts/src/usp/ingestion';
import {geojsonInventory,inspectedProfile} from '../../packages/server/src/modules/usp/ingestion/registry';
import {validateAdaptiveMapping} from '../../packages/server/src/modules/usp/ingestion/adaptive-mapping';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nonnegative=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
type Oracle={sourceSha256:string;evidenceFile:string;evidenceSha256:string;evidenceQuote:string;issuerUrl:string;
  expected:{decision:'abstain'}|{decision:'propose';sourceKeyPath:string;geometryPath:string;namePath:string|null}};
function readOracle(value:any):Oracle{
  const expected=value?.expected;
  if(!digest(value?.sourceSha256)||!digest(value?.evidenceSha256)||typeof value?.evidenceFile!=='string'
    ||typeof value?.evidenceQuote!=='string'||value.evidenceQuote.length<10||value.evidenceQuote.length>1000
    ||typeof value?.issuerUrl!=='string'||!/^https:\/\//.test(value.issuerUrl)||!URL.canParse(value.issuerUrl)
    ||expected?.decision!=='abstain'&&!(expected?.decision==='propose'
      &&SourcePathSchema.safeParse(expected.sourceKeyPath).success
      &&SourcePathSchema.safeParse(expected.geometryPath).success
      &&(expected.namePath===null||SourcePathSchema.safeParse(expected.namePath).success)))
    throw Error('The independent oracle is incomplete or malformed.');
  return value as Oracle;
}
type Capture={sourceSha256:string;modelId:string;receipt:{callId:string;responseSha256:string;
  inputTokens:number;outputTokens:number;actualMicroInr:string};output:unknown};
function readCapture(value:any):Capture{
  if(!digest(value?.sourceSha256)||typeof value?.modelId!=='string'||!value.modelId
    ||typeof value?.receipt?.callId!=='string'||!/^[a-f0-9-]{36}$/i.test(value.receipt.callId)
    ||!digest(value.receipt.responseSha256)||!nonnegative(value.receipt.inputTokens)
    ||!nonnegative(value.receipt.outputTokens)||typeof value.receipt.actualMicroInr!=='string'
    ||!/^\d+$/.test(value.receipt.actualMicroInr)||!Object.hasOwn(value,'output'))
    throw Error('The captured gateway output or receipt is incomplete.');
  return value as Capture;
}

async function main(){
  const args=new Map<string,string>();
  for(let i=2;i<process.argv.length;i+=2){
    const option=process.argv[i],value=process.argv[i+1];
    if(!['--original','--profile','--oracle','--capture'].includes(option)||!value||args.has(option))
      throw Error('Use one --original, --profile, --oracle and optional --capture path.');
    args.set(option,value);
  }
  for(const required of ['--original','--profile','--oracle'])if(!args.has(required))throw Error(`Missing ${required}.`);
  const bytes=new Uint8Array(await readFile(args.get('--original')!)),profile=SourceProfileSchema.parse(JSON.parse(await readFile(args.get('--profile')!,'utf8')));
  const oracle=readOracle(JSON.parse(await readFile(args.get('--oracle')!,'utf8')));
  const sourceSha256=hash(bytes),rows=geojsonInventory(bytes);
  if(sourceSha256!==profile.source.sourceSha256||sourceSha256!==oracle.sourceSha256||rows.length!==profile.featureCount)
    throw Error('The retained original, profile and oracle have different source pins.');
  const fieldNames=profile.paths.filter(item=>item.path.startsWith('/features/*/properties/')).map(item=>
    item.path.slice('/features/*/properties/'.length).replaceAll('~1','/').replaceAll('~0','~'));
  const inventory=inspectedProfile(bytes,{format:'geojson',sourceSha256,bytes:bytes.length,layers:[],layer:null,
    sourceCrs:profile.crs.value,crsEvidence:profile.crs.evidence,featureCount:rows.length,
    geometryTypes:[...new Set(rows.map(row=>(row.geometry as {type?:string}|null)?.type??'null'))],
    fields:fieldNames.map(name=>({name,complete:false,unique:false,idEligible:false})),
    featureIdEligible:false,suggestedIdField:null,suggestedNameField:null,
    suggestedTitle:'retained original',suggestedNamespace:'source:'+sourceSha256});
  if(inventory.schemaFingerprint!==profile.source.schemaFingerprint||JSON.stringify(inventory.paths)!==JSON.stringify(profile.paths)
    ||JSON.stringify(inventory.geometryTypes)!==JSON.stringify(profile.geometryTypes))
    throw Error('The retained original no longer reproduces the inspected inventory.');
  const evidence=new Uint8Array(await readFile(oracle.evidenceFile));
  if(hash(evidence)!==oracle.evidenceSha256||!new TextDecoder('utf-8',{fatal:true}).decode(evidence).includes(oracle.evidenceQuote))
    throw Error('The independent expected mapping is not bound to its unchanged issuer evidence.');
  if(!args.has('--capture')){
    process.stdout.write(JSON.stringify({sourceIntegrity:'verified',inventoryMechanics:'verified',
      liveModelAccuracy:'not_run',sourceSha256,issuerUrl:oracle.issuerUrl})+'\n');
    return;
  }
  const capture=readCapture(JSON.parse(await readFile(args.get('--capture')!,'utf8')));
  if(capture.sourceSha256!==sourceSha256)throw Error('Captured model output belongs to a different original.');
  const checked=validateAdaptiveMapping(capture.output,profile);
  const actual=checked.plan?.operations;
  const expected=oracle.expected;
  const semanticMatch=expected.decision==='abstain'
    ? checked.code==='MODEL_ABSTAINED'
    : checked.status==='proposed'&&actual?.find(item=>item.target==='building.sourceKey')?.sourcePath===expected.sourceKeyPath
      &&actual?.find(item=>item.target==='building.geometry')?.sourcePath===expected.geometryPath
      &&(actual?.find(item=>item.target==='building.name')?.sourcePath??null)===expected.namePath;
  const comparison=semanticMatch?'matches_independent_oracle'
    : expected.decision==='propose'&&checked.code==='MODEL_ABSTAINED'?'safe_abstention_no_mapping':'fails_independent_oracle';
  process.stdout.write(JSON.stringify({sourceIntegrity:'verified',inventoryMechanics:'verified',
    proposalMechanics:checked.status,proposalCode:checked.code,
    capturedModelComparison:comparison,
    liveModelAccuracy:'not_established_from_one_supplied_capture',modelId:capture.modelId,
    callId:capture.receipt.callId,responseSha256:capture.receipt.responseSha256,
    inputTokens:capture.receipt.inputTokens,outputTokens:capture.receipt.outputTokens,
    actualMicroInr:capture.receipt.actualMicroInr,sourceSha256,issuerUrl:oracle.issuerUrl})+'\n');
  if(comparison==='fails_independent_oracle')process.exitCode=1;
}
main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Capability check failed.'}\n`);process.exitCode=1;});

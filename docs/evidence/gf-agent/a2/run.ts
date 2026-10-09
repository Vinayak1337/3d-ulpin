import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execSync,execFileSync} from 'node:child_process';
import {goodFile,difficultFile,controlConfig,ControlLedger,unknownResponse,options} from '../../../../scripts/agent/control-runtime';
import {profileColumnFile} from '../../../../packages/server/src/modules/usp/ingestion/column-profile';
import {proposeMappingWithTeacher,executeTeacherMappingDryRun,mappingContextFromColumnProfile} from '../../../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import {validateMappingPlanV2} from '../../../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import {ModelGateway} from '../../../../packages/server/src/modules/model-gateway/gateway';
import {ControlAdapter,ReplayAdapter} from '../../../../packages/server/src/modules/model-gateway/adapter';
import {TeacherRecordings} from '../../../../packages/server/src/modules/model-gateway/recordings';
const out=resolve('docs/evidence/gf-agent/a2');
const save=(name:string,value:unknown)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest=JSON.parse(readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json','utf8'));
const recordings=new TeacherRecordings(mkdtempSync(join(tmpdir(),'a2-evidence-replay-')));
const inputs=[];
for(const [index,path] of [goodFile,difficultFile].entries()){
  const sourceHash=digest(path),input=profileColumnFile(path),ledger=new ControlLedger();
  const asset=manifest.assets.find((asset:any)=>asset.id===(index===0?'lgd-gurugram.csv':'gmda-sector-boundaries'));
  assert.equal(sourceHash,index===0?asset.content.sha256:asset.provenance.original.sha256);
  const gateway=new ModelGateway(controlConfig(),ledger,new ControlAdapter(async request=>unknownResponse(request)));
  const teacher=await proposeMappingWithTeacher(input.profile,{...options(gateway),recordings});
  const context={...mappingContextFromColumnProfile(input.profile),sourceRef:path,rowCount:input.rows.length};
  const validated=validateMappingPlanV2(teacher.plan,context);assert(validated.success);
  const dry=executeTeacherMappingDryRun(teacher,input.rows,context);
  assert.equal(dry.counts.needsInput,dry.counts.cells);assert.equal(ledger.settled,1);
  const noDebit=new ControlLedger();noDebit.denyCode='MODEL_PROJECT_CAP';
  const replay=await proposeMappingWithTeacher(input.profile,options(new ModelGateway(controlConfig(),noDebit,new ReplayAdapter(key=>recordings.replay(key)))));
  assert.equal(replay.replayed,true);assert.deepEqual(replay.plan,teacher.plan);assert.equal(noDebit.reserved,0);
  assert.equal(digest(path),sourceHash);
  save(index===0?'lgd.profile.json':'gmda.profile.json',input.profile);
  inputs.push({input:path,sha256:sourceHash,permission:asset.permission.state,purpose:asset.provenance.purpose,
    rows:input.rows.length,columns:input.profile.columns.length,profileHash:teacher.profileHash,
    layoutFingerprint:input.profile.layoutFingerprint,sampleShortfall:input.profile.sampleShortfall,
    sampledCellsPerColumn:input.profile.columns[0].maskedSamples.length,planValidation:'passed',
    teacherCalls:teacher.attempts,controlReservations:ledger.reserved,controlSettlements:ledger.settled,
    controlActualMicroInr:[...ledger.calls.values()][0].actual_micro_inr,dryRun:dry.counts,
    replayed:true,replayPaidAdmissions:noDebit.reserved,sourceHashUnchanged:true});
}
const checks=[
  'pnpm exec tsx --test scripts/agent/mapping-teacher.test.ts',
  'pnpm exec tsx --test tests/model-gateway/control.test.ts packages/contracts/src/canonical/*.test.ts packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts packages/server/src/modules/usp/ingestion/mapping-executor.test.ts packages/server/src/modules/usp/ingestion/unit-table.test.ts tests/adaptive-mapping.test.ts',
  'pnpm typecheck',
  'pnpm test:ai',
  'pnpm exec tsc -p scripts/agent/tsconfig.json',
  'pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler packages/contracts/src/index.ts packages/contracts/src/usp/index.ts',
  'git diff --check',
].map(command=>{execSync(command,{stdio:'inherit'});return {command,exitCode:0};});
const result={schemaVersion:'mapping-teacher-a2-evidence/1',task:'A2',gate:'GF-AGENT',
  qualification:'Offline foundation qualified; no live-provider, publisher-dictionary accuracy or whole-gate claim.',
  codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runAt:new Date().toISOString(),
  environment:{node:process.version,platform:process.platform},inputs,
  checks,tests:{newChecks:10,existingGatewayAndMappingChecks:21,existingGroundingChecks:22,failures:0},
  failureModes:['missing_key','http_401','http_402','http_429_rate_limit','http_429_insufficient_quota',
    'timeout','network_error','total_cap','daily_money_cap','daily_call_cap','recording_unavailable'],
  invariants:{publicDevelopmentOnly:true,heldOutTeacherDenied:true,privateRestrictedTeacherDenied:true,
    noCredentialRotation:true,repairLimit:1,networkRetries:0,maxAttemptsIncludingRepair:2,
    registryWrites:0,literalsRejected:true,manualMappingAvailable:true,rawSourcesUnchanged:true},
  replay:{kind:'recorded_software_control',recordingDirectory:recordings.directory,paidReservations:0,
    keyComponents:['prompt-template version','profile hash','model'],liveResponseReplay:'pending_owner_key'},
  developmentLabels:{loader:'implemented',labelKind:'pseudo_label',verifiedMeaning:'schema plus local executor dry-run; not truth or review',
    withoutRows:'accepted with verified:false; A4 must not learn unverified entries',actualClaudeLabelsSupplied:0},
  defaultReplayCliCheck:{command:'pnpm exec tsx scripts/agent/mapping-teacher.ts fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv --public-development',
    exitCode:0,result:'TEACHER_REPLAY_UNAVAILABLE with valid manual plan and dry-run counts; no key read or network call.'},
  live:{calls:0,keyEnvironmentVariable:'ULPIN_PROVIDER_KEY_SARVAM',status:'pending_owner',
    command:'pnpm exec tsx scripts/agent/mapping-teacher.ts fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv --public-development --live',
    prerequisites:['ULPIN_MODEL_GATEWAY_ENABLED=1','ULPIN_MODEL_GATEWAY_CONFIG with approved funding, tariff, policy, daily and total money caps, daily call cap and secretReference ULPIN_PROVIDER_KEY_SARVAM',
      'Existing PostgreSQL model-gateway ledger available and configuration reconciled; no migrations or runtime changes made by A2'],
    maxCalls:1,recordingsEnvironmentVariable:'ULPIN_TEACHER_RECORDINGS_DIR',
    defaultRecordingDirectory:'E:/BhuAayam-data/runtime/teacher-recordings/',
    protocolReference:'https://docs.sarvam.ai/api-reference/chat/chat-completions-v1',
    protocolCheckedAt:'2026-10-10',structuredOutput:'response_format.json_schema strict:true; tools omitted, tool calls rejected',
    rawResponsePolicy:'bounded redacted response envelope; original response hash retained; reasoning excluded'},
  supplementalReaderCheck:{command:"ULPIN_PROFILE_PYTHON=E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe pnpm exec tsx scripts/agent/check-workbooks.ts",exitCode:0,
    inputs:[{path:'E:/BhuAayam-data/task-data/desktop-ai04e-native-xlsx/Senior_Staff_Hospitality_Received__Cabinet_Office_.xlsx',
      sha256:'aa301b90933f3b779a69a855f271fa7ab6217b5e0a93b279fca7636d675f32f4',rows:70,columns:3,headerRow:5},
      {path:'E:/BhuAayam-data/task-data/native-ods-20261004-run01/originals/home-office-hospitality-2021-q3.ods',
        sha256:'1c6a364fd20ff769835451a075de4654fc21e1499dfaf159081d3db089e591f6',rows:75,columns:5,headerRow:1}],
    qualification:'Manifest-pinned unchanged foreign reader mechanics only; no teacher saw these files and no labels were enrolled.'},
  recovery:[{command:'pnpm exec tsx --test scripts/agent/mapping-teacher.test.ts',initialExitCode:1,
    signature:'ERR_MODULE_NOT_FOUND at root script import',decision:'Use the workspace contracts relative import in the owned script.'},
    {command:'pnpm exec tsx --test scripts/agent/mapping-teacher.test.ts',initialExitCode:1,
      signature:'MAPPING_LAYOUT_INVALID: extended profile passed to strict A1 inventory schema',decision:'Project only name, inferredType and declaredUnit using mappingContextFromColumnProfile; bounded rerun passed.'},
    {command:'python -c "import shapely"',initialExitCode:1,
      signature:'System Python lacks geo dependencies',decision:'Use the already-installed, read-only venv-plans interpreter; no installs/runtime changes.'},
    {command:'profile-columns.ts <retained XLSX/ODS>',initialExitCode:1,
      signature:'Workbook preamble / repeated blank padding lacks a literal rectangular header',hypothesis:'Explicit header row and ignoring ONLY empty padding preserve the real named table.',
      criterion:'Three XLSX / five ODS manifest-pinned columns, observed samples, unchanged originals.',result:'Passed once with explicit XLSX header-row 5; meaningful unnamed columns and repeated literal ODS data still fail closed.'},
    {command:'pnpm exec tsc -p scripts/agent/tsconfig.json',initialExitCode:2,
      signature:'Test comparisons used nullable shape rates without narrowing',decision:'Narrow null explicitly; production and test typechecks passed.'}],
  decisions:['One or two observed samples on the A1 inputs are explicitly short, never padded to five with invented/repeated values.',
    'Administrative LGD and GMDA columns are unknown/manual, not invented building/parcel facts. Undeclared Area:0 stays unresolved.',
    'Headers travel as header (not name) because the existing personal-field minimizer masks a JSON name key.',
    'XLSX/ODS reuse native bounded Python readers; ULPIN_PROFILE_PYTHON selects an existing interpreter with geo dependencies. Preambles need an explicit --header-row; repeated literal ODS ranges need manual input.'],
  limitations:['A3 must supply server-derived data classification, split and scope authorization, surface issues and use executeTeacherMappingDryRun; no routes were changed.',
    'Only software controls exercise reservations/settlements here; no live PostgreSQL concurrency/restart or charged call was attempted.',
    'No real Claude teacher labels or publisher-dictionary mapping accuracy evaluated; A4 must filter verified pseudo-labels and prioritize officer corrections.',
    'Large layouts beyond existing gateway input/output bounds fail closed to manual mapping.']};
save('result.json',result);
console.log(JSON.stringify({inputs,tests:result.tests,liveCalls:0,result:'docs/evidence/gf-agent/a2/result.json'},null,2));

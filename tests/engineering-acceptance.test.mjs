import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {validateAcceptanceContract} from '../scripts/engineering/acceptance-contract.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../docs/engineering-plan/'+name,import.meta.url),'utf8'));
function inputs(){return [read('references/catalog.json'),read('references/acceptance-contract.json'),read('acceptance_traceability.json'),read('backlog.json')];}
test('all recovered references, original UI gates and fixture families remain covered',()=>{
  const result=validateAcceptanceContract(...inputs());
  assert.deepEqual(result,{kind:'specification-consistency-only',references:32,screenFamilies:19,uiGates:16,fixtures:9,implementationAccepted:false});
});
for(const [name,mutate] of [
  ['reference omission',([c])=>c.references.pop()],
  ['hash duplication',([c])=>c.references[0].sha256=c.references[1].sha256],
  ['wrong anchor',([,c])=>c.primaryAnchors.map='REF-16'],
  ['invented implementation approval',([,c])=>c.userImplementationApproval=true],
  ['static map substitution',([,c])=>c.sourceImageAsRuntimeBackground=true],
  ['unknown screenshot',([,c])=>c.screenFamilies[0].refs=['REF-99']],
  ['crop used as primary state',([,c])=>c.screenFamilies[0].refs=['REF-13']],
  ['orphan UI gate',([,c])=>c.screenFamilies=c.screenFamilies.filter(s=>!s.gates.includes('UI-07'))],
  ['requirement omission',([,c])=>c.requiredRequirementIds.pop()],
  ['unknown task',([,c])=>c.fixtures[0].tasks=['T999']],
  ['missing negative fixture boundary',([,c])=>c.fixtures[0].mustNot=''],
  ['false held-out claim',([,c])=>c.fixtures[8].classification='passed-held-out'],
  ['emulation mistaken for touch',([,c])=>c.viewports[3].evidenceClass='physical-phone'],
  ['missing reverse view',([,c])=>c.cameraCases=c.cameraCases.filter(x=>x.id!=='reverse-oblique')],
  ['forgotten zero-document state',([,c])=>c.universalStates=c.universalStates.filter(x=>x!=='zero-documents')],
  ['averaged-away correctness',([,c])=>c.visualGate.requiresIndependentCorrectness=false],
])test(`rejects ${name}`,()=>{const data=inputs();mutate(data);assert.throws(()=>validateAcceptanceContract(...data));});

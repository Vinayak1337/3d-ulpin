/** Validate reference/fixture coverage only, never mark UI or geometry accepted. */
import assert from 'node:assert/strict';

const nonempty=value=>typeof value==='string'&&value.trim().length>0;
function index(records,label) {
  assert(Array.isArray(records)&&records.length>0,`${label} requires records`);
  const map=new Map();
  for(const value of records){assert(value&&nonempty(value.id),`${label} ID required`);assert(!map.has(value.id),`Duplicate ${label} ID`);map.set(value.id,value);}
  return map;
}
export function validateAcceptanceContract(catalog,contract,trace,backlog) {
  assert.equal(catalog.schemaVersion,'ulpin-reference-catalog/1');
  assert.equal(contract.schemaVersion,'ulpin-visual-acceptance/1');
  const refs=index(catalog.references,'reference'),screens=index(contract.screenFamilies,'screen');
  const tasks=index([...backlog.tasks,...backlog.maintenance],'task'),fixtures=index(contract.fixtures,'fixture');
  const gates=index(trace.ui_gates,'UI gate'),profiles=index(contract.capabilityProfiles,'capability');
  assert.equal(catalog.implementationEvidence,false,'Reference images are not implementation evidence');
  assert.equal(contract.sourceImageAsRuntimeBackground,false,'Reference pixels cannot substitute runtime geometry');
  assert.equal(contract.userImplementationApproval,false,'A specification must not invent user approval');
  assert.equal(refs.size,32,'Retain all original reference records');
  assert.equal(new Set([...refs.values()].map(r=>r.sha256)).size,32,'Reference images must remain distinct by hash');
  assert.equal(catalog.fullScreenOrBoardCount,30);
  assert.equal(catalog.supportingCropCount,2);
  assert.equal([...refs.values()].filter(r=>r.role==='crop').length,2,'Supporting crops are not full-screen anchors');
  for(const ref of refs.values()) {
    assert(/^[a-f0-9]{64}$/.test(ref.sha256),'Invalid reference hash');
    assert(nonempty(ref.archive)&&nonempty(ref.entry)&&nonempty(ref.content),'Reference locator/content required');
    assert(!ref.entry.startsWith('/')&&!ref.entry.split('/').includes('..'),'Unsafe archive locator');
    assert(Number.isSafeInteger(ref.width)&&ref.width>0&&Number.isSafeInteger(ref.height)&&ref.height>0,'Invalid reference size');
  }
  for(const [name,id] of Object.entries(contract.primaryAnchors))assert.equal(refs.get(id)?.role,`primary-${name}`,'Wrong primary anchor role');
  assert.deepEqual(Object.keys(contract.primaryAnchors).sort(),['map','register','workspace']);
  const covered=new Set();
  for(const screen of screens.values()) {
    assert(Array.isArray(screen.refs)&&screen.refs.length>0||nonempty(screen.gap),'Screen needs references or explicit gap');
    for(const id of screen.refs){assert(refs.has(id),'Unknown screen reference');assert.notEqual(refs.get(id).role,'crop','A crop cannot serve as screen coverage');}
    assert(Array.isArray(screen.gates)&&screen.gates.length>0,'Screen must map to a UI gate');
    for(const id of screen.gates){assert(gates.has(id),'Unknown UI gate');covered.add(id);}
  }
  assert.deepEqual([...covered].sort(),[...gates.keys()].sort(),'All 16 original UI gates must be covered');
  assert.deepEqual([...contract.requiredRequirementIds].sort(),trace.requirements.map(r=>r.id).sort(),'All original requirements must remain');
  assert.deepEqual([...fixtures.keys()].sort(),Array.from({length:9},(_,i)=>`F0${i+1}`));
  for(const fixture of fixtures.values()) {
    assert(profiles.has(fixture.visualProfile),'Unknown fixture capability profile');
    assert(nonempty(fixture.geometryOracle)&&nonempty(fixture.mustNot),'Fixture oracle and anti-goal required');
    assert(fixture.tasks.length&&fixture.tasks.every(id=>tasks.has(id)),'Unknown fixture task');
  }
  assert.equal(fixtures.get('F09').classification,'held-out-pending','Do not predeclare a tuned fixture held out');
  const viewports=index(contract.viewports,'viewport'),cameras=index(contract.cameraCases,'camera');
  assert.equal(viewports.get('mobile-emulated').evidenceClass,'emulated-not-physical');
  for(const viewport of viewports.values())assert([viewport.width,viewport.height,viewport.dpr].every(n=>Number.isFinite(n)&&n>0),'Invalid viewport');
  for(const name of ['oblique','reverse-oblique','top-down','building-close','narrow-alley','wide-district','section-underground','boundary-travel'])assert(cameras.has(name),'Missing alternate camera case');
  for(const name of ['loading','empty','partial','error-retry','unknown-height','zero-documents','withheld-evidence','keyboard-focus','zoom-200-percent','reduced-motion'])assert(contract.universalStates.includes(name),'Missing cross-cutting state');
  assert.equal(contract.visualGate.reviewer,'user');
  assert.deepEqual(contract.visualGate.taskIds,['T027','T037','T042']);
  assert.equal(contract.visualGate.criticalMinimum,4);
  assert.equal(contract.visualGate.requiresIndependentCorrectness,true);
  assert(contract.knownContradictions.length>=4,'Preserve known contradictions');
  for(const row of contract.knownContradictions)assert(row.refs.every(id=>refs.has(id))&&nonempty(row.resolution),'Unresolved/mislinked contradiction');
  return {kind:'specification-consistency-only',references:refs.size,screenFamilies:screens.size,uiGates:covered.size,fixtures:fixtures.size,implementationAccepted:false};
}

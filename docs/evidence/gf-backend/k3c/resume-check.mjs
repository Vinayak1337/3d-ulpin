import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3194/api/v1';
const records = [];
for (const [name, buildingId, revision] of [
  ['Tower 3', '6f95d04e-2067-4ac8-a3c2-6cc21ea46325', 4],
  ['Magnolia', 'e8777ffc-9409-4129-bacf-f680160d8795', 5],
]) {
  const response = await fetch(`${base}/buildings/${buildingId}/canonical`);
  assert.equal(response.status, 200);
  const building = await response.json();
  assert.equal(building.inputRevisions.find(pin => pin.namespace === 'registry_record').revision, revision);
  assert.equal(building.levelSchedule.state, name === 'Tower 3' ? 'conflicting' : 'reviewed');
  assert.equal(building.levels.length, name === 'Tower 3' ? 0 : 3);
  records.push({ name, buildingId, recordRevision: revision, scheduleState: building.levelSchedule.state,
    reviewedLevels: building.levels.length });
}
writeFileSync('docs/evidence/gf-backend/k3c/resume.json', JSON.stringify({ observedAt: new Date().toISOString(),
  mode: 'resume_only', create: false, reset: false, reseed: false, doctorExitCode: 0, records,
  engineAttempts: 2, firstAttempt: 'tool timeout; sailor-ingest.sock rename failure confirmed in backend log',
  recovery: 'Documented exact socket-only directory preservation, then bounded normal Desktop start',
  engineRecoveryExitCode: 0, platformResumeExitCode: 0, logs: 'E:/BhuAayam-data/task-data/k3c/',
}) + '\n', { flag: 'wx' });
console.log('Tower revision 4 and Magnolia revision 5 retained their K3b schedules after resume.');

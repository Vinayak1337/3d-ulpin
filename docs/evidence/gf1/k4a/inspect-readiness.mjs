import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const buildings = [];
for (const buildingId of ['e8777ffc-9409-4129-bacf-f680160d8795', '6f95d04e-2067-4ac8-a3c2-6cc21ea46325']) {
  const response = await fetch(`http://127.0.0.1:3194/api/v1/buildings/${buildingId}/canonical`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const rooms = body.candidates.filter(candidate => candidate.kind === 'room');
  buildings.push({ buildingId, revisionId: body.revisionId, inputRevisions: body.inputRevisions,
    scheduleState: body.levelSchedule?.state, levels: body.levels.map(level => ({ levelId: level.levelId,
      label: level.label.value, lowerM: level.lowerM.value, upperM: level.upperM.value,
      registrySpaces: level.spaces.length, attachedRoomCandidates: level.roomCandidateIds?.length ?? 0 })),
    candidateKinds: [...new Set(body.candidates.map(candidate => candidate.kind))], roomCandidates: rooms.length,
    parcelRefs: body.parcelRefs, footprintState: body.footprint.state, heightState: body.heightState,
  });
}
writeFileSync('docs/evidence/gf1/k4a/canonical-readiness.json', JSON.stringify({
  observedAt: new Date().toISOString(), method: 'GET canonical only; no snapshot capture or product write', buildings,
}) + '\n', { flag: 'wx' });
console.log('Captured compact canonical readiness using read-only GETs.');

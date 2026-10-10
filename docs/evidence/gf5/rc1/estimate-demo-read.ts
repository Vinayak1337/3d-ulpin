// RC1: apply the read's estimate to the room candidates the demo serves today (GET only; the demo runs an older
// commit without planEstimate).
// Run: pnpm exec tsx --tsconfig apps/api/tsconfig.json docs/evidence/gf5/rc1/estimate-demo-read.ts
import { NormalizedBuildingSchema } from '../../../../packages/contracts/src/index';
import { addRoomPlanEstimates } from '../../../../packages/server/src/modules/registry/canonical-room-estimate';

const url = 'http://127.0.0.1:3194/api/v1/buildings/e8777ffc-9409-4129-bacf-f680160d8795/canonical';

const building = NormalizedBuildingSchema.parse(await (await fetch(url)).json());
addRoomPlanEstimates(building);
const rooms = building.candidates.map(candidate => ({
  label: candidate.labelLiteral ?? null,
  level: candidate.levelLabelLiteral ?? null,
  state: candidate.planEstimate?.state,
  areaM2: candidate.planEstimate?.areaM2,
  extentM: candidate.planEstimate?.extentM,
}));
console.log(JSON.stringify({ revisionIdServed: building.revisionId, rooms }));

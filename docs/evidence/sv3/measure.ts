import { readFileSync } from 'node:fs';
import { hash } from '../../../packages/server/src/modules/model-gateway/config';
import { profileColumnFile } from '../../../packages/server/src/modules/usp/ingestion/column-profile';
import {
  mappingTeacherRequest, mappingTeacherColumnGroups,
} from '../../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { goodFile, difficultFile } from '../../../scripts/agent/control-runtime';
import { developmentProfileAssets, sourceTables } from '../../../scripts/agent/t1-sources';
import { prepareTable } from '../../../scripts/agent/t1-profiles';

const mapping = [goodFile, difficultFile].map(file => {
  const request = mappingTeacherRequest(profileColumnFile(file).profile);
  return { file, requestHash: hash([request.messages, request.schema]) };
});
const wide = developmentProfileAssets().filter(asset => asset.family === 'mi-d22').map(asset => {
  const prepared = prepareTable(asset, sourceTables(asset)[0]);
  const columns = prepared.inventory.profile.columns.map((column, index) => {
    const header = prepared.profiles[index].header;
    return { ...column, name: header.trim() ? header : column.name };
  });
  const profile = { ...prepared.inventory.profile, columns };
  const request = mappingTeacherRequest(profile);
  const samples = mappingTeacherColumnGroups(profile).groups.map(group => group.request.samplesPerColumn);
  return { id: asset.id, samples,
    size: [columns.length, request.messages[1].content.length, Buffer.byteLength(JSON.stringify(request.messages))] };
});

// Existing retained software-control answer, not an LP6 answer and not evaluation truth.
const control = JSON.parse(readFileSync('docs/evidence/gf-ai/documents/d2/control-output.json', 'utf8'));
let citations = 0;
const wire = JSON.stringify(control, (key, value) => {
  if (key !== 'citations') return value;
  citations += value.length;
  return value.map((citation: { partId: string }) => citation.partId);
});
const fullChars = JSON.stringify(control).length;
const reductionPercent = +(100 * (1 - wire.length / fullChars)).toFixed(1);
console.log(JSON.stringify({ mapping, wide, storeyControl: { fullChars, wireChars: wire.length,
  savedChars: fullChars - wire.length, citations, reductionPercent } }));

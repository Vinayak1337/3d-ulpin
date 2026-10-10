import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TabularSourceProfile } from '../../packages/contracts/src/usp';
import { MappingPlanV2Schema } from '../../packages/contracts/src/canonical/mapping-plan';

type Profile = { profileId: string; file: string; split: string; sheet: string; column: number; header: string };
type Label = { profileId: string; field: { target: string; rationale: string; operation: { kind: string } } };

function lines<T>(path: string): T[] {
  return readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

/** Lead-authorized development labels only; this is neither independent truth nor authenticated officer input. */
export function t1OfficerAnswers(source: TabularSourceProfile) {
  assert.equal(source.tabular.developmentAssetId, 'mi-d10-02.csv', 'A3C_LABEL_SOURCE_DENIED');
  const profiles = lines<Profile>('E:/BhuAayam-data/task-data/t1/profiles/profiles.jsonl')
    .filter(row => row.file === 'mi-d10-02.csv').sort((left, right) => left.column - right.column);
  const labels = lines<Label>('E:/BhuAayam-data/task-data/t1/labels/teacher-labels.jsonl');
  assert.equal(profiles.length, 16, 'A3C_T1_COLUMNS_REQUIRED');
  assert.equal(source.headers.length, 16, 'A3C_SOURCE_COLUMNS_REQUIRED');
  const fields = profiles.map((profile, index) => {
    assert(profile.split === 'dev' && profile.sheet === 'csv' && profile.column === index + 1,
      'A3C_T1_PROFILE_DENIED');
    assert.equal(profile.header, source.headers[index], 'A3C_T1_HEADER_CHANGED');
    const matched = labels.filter(label => label.profileId === profile.profileId);
    assert.equal(matched.length, 1, 'A3C_T1_LABEL_REQUIRED');
    const label = matched[0].field;
    assert(label.target === 'unknown' && label.operation.kind === 'copy' && label.rationale.trim(),
      'A3C_T1_UNKNOWN_REQUIRED');
    return { sourceField: source.profile.columns[index].name, target: 'unknown', operation: { kind: 'copy' },
      confidence: 0.9, rationale: label.rationale };
  });
  const mapping = MappingPlanV2Schema.parse({ version: 'mapping-plan/2', sourceKind: 'tabular',
    layoutFingerprint: source.profile.layoutFingerprint, method: 'model:claude-opus-5-5@dev-2026-10', fields });
  return { mapping, decisions: fields.map(field => ({ sourceField: field.sourceField,
    reason: `Development-teacher label T1 (verified): ${field.rationale}. ` +
      'Entered by the lead for the A3c live check; not an authenticated officer decision.' })) };
}

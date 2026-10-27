import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CITYGML_VERSION, CityGMLInputSchema, CityGMLResultSchema, type CityGMLInput }
  from '../../../../../contracts/src/usp/citygml-ingestion';
import type { SourceFusionSelection } from '../../../../../contracts/src/source-fusion';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { citygmlReaderSha } from './citygml';
import { citygmlSummary } from './citygml-processor';
import { fusionCityGMLSourceProjection } from './source-fusion-citygml';

// The supervised reader needs the CityGML environment (psutil 7.2.2); the outline reader needs the geo Python.
const readerPython = process.env.ULPIN_CITYGML_PYTHON
  ?? 'E:/BhuAayam-data/task-data/desktop-citygml-native/env/Scripts/python.exe';
const geoPython = process.env.ULPIN_GEO_PYTHON ?? 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const ready = process.platform === 'win32' && existsSync(readerPython) && existsSync(geoPython);
const digest = 'a'.repeat(64);

// A test-written test_only control, not a real building: one Building states two envelopes with different systems.
const envelope = (system: string) =>
  `<gml:boundedBy><gml:Envelope srsName="${system}" srsDimension="3"/></gml:boundedBy>`;
const twoEnvelopes = `<CityModel xmlns="http://www.opengis.net/citygml/2.0"
    xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0">
  ${envelope('EPSG:25832')}
  <cityObjectMember><bldg:Building gml:id="envelope-conflict-control">
    ${envelope('EPSG:25832')}${envelope('EPSG:28992')}
    <bldg:lod0FootPrint><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
      <gml:exterior><gml:LinearRing><gml:posList>0 0 7 2 0 7 2 2 7 0 0 7</gml:posList></gml:LinearRing></gml:exterior>
    </gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod0FootPrint>
  </bldg:Building></cityObjectMember>
</CityModel>
`;

const outlineScript = `
import hashlib, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'services/geo')
from geo.native_gis import convert_native_file
path = Path(sys.argv[1])
digest = hashlib.sha256(path.read_bytes()).hexdigest()
print(json.dumps(convert_native_file(path, 'citygml', Path(tempfile.mkdtemp()), digest)))`;

function readControl(folder: string) {
  const original = join(folder, 'two-envelopes.gml');
  writeFileSync(original, twoEnvelopes, 'utf8');
  const output = join(folder, 'reading');
  const receipt = JSON.parse(execFileSync(readerPython,
    ['-B', 'scripts/usp/desktop-citygml-read.py', original, '--out-dir', output], { encoding: 'utf8' }));
  assert.equal(receipt.error, undefined, JSON.stringify(receipt.error));
  return { original, raw: readFileSync(original), native: readFileSync(join(output, 'projection.json')), receipt };
}

function controlInput(raw: Buffer): CityGMLInput {
  const caseId = randomUUID();
  const sourceId = randomUUID();
  const readerSha256 = citygmlReaderSha();
  return CityGMLInputSchema.parse({ version: CITYGML_VERSION, jobId: randomUUID(), caseId, caseRevision: 1,
    caseContextSha256: fingerprint({ frame: null, context: null, siteId: null }), sourceId, sourceFamilyId: sourceId,
    sourceRevision: 1, sourceSha256: sha256(raw), sourceBytes: raw.length,
    objectKey: `sources/${sourceId}/${sha256(raw)}`,
    subject: 'citygml-envelope-control', accessSha256: digest, readerSha256,
    tools: { platform: 'windows-x86_64', pythonSha256: digest, profileSha256: digest, readerSha256,
      supervisorSha256: digest, dependencyLockSha256: digest, codeSha256: digest } });
}

type CityGMLSelection = Extract<SourceFusionSelection, { kind: 'citygml' }>;

function fusionSelection(input: CityGMLInput, resultBytes: Buffer): CityGMLSelection {
  return { kind: 'citygml', buildingOrdinals: [0], pin: { caseId: input.caseId, caseRevision: input.caseRevision,
    sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
    jobId: input.jobId,
    resultSha256: sha256(resultBytes), resultBytes: resultBytes.length, readerSha256: input.readerSha256,
    inputSha256: fingerprint(input), acceptedFence: 1 } };
}

test('a feature with two envelopes is read as ENVELOPE_CONFLICT, accepted, fused, and its outline stays unplaced',
  { skip: !ready }, () => {
    const { original, raw, native, receipt } = readControl(mkdtempSync(join(tmpdir(), 'ulpin-citygml-envelope-')));
    const reading = JSON.parse(native.toString('utf8'));
    const building = reading.buildings[0].element;
    const conflict = reading.findings.find((finding: { code: string }) => finding.code === 'ENVELOPE_CONFLICT');
    assert.deepEqual(conflict.elements, [building]);

    const input = controlInput(raw);
    const summary = citygmlSummary(native, input);
    assert.ok(summary.findingCodes.includes('ENVELOPE_CONFLICT'));
    assert.equal(summary.status, 'partial');
    const result = CityGMLResultSchema.parse({ version: CITYGML_VERSION, input, summary, supervision: receipt.execution,
      artifact: { key: 'citygml-envelope-control', sha256: sha256(native), bytes: native.length,
        mediaType: 'application/json', profile: 'ulpin-native-citygml/1' }, createdAt: new Date().toISOString() });

    const resultBytes = Buffer.from(JSON.stringify(result));
    const fused = fusionCityGMLSourceProjection(fusionSelection(input, resultBytes), { result, native: reading });
    assert.deepEqual(fused.findings.find(finding => finding.code === 'ENVELOPE_CONFLICT'), conflict);

    const [layer] = JSON.parse(execFileSync(geoPython, ['-B', '-c', outlineScript, original],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
    assert.equal(layer.state, 'not_converted');
    assert.match(layer.reason, /more than one envelope/);
    assert.match(layer.reason, /stay unplaced/);
  });

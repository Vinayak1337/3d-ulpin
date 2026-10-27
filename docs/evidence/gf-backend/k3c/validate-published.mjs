import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const root = 'docs/evidence/gf-backend/k3c';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const spec = read('docs/api/openapi.json');
const cases = [];
for (const [kind, path, status] of [
  ['room', '/api/v1/buildings/{buildingId}/candidates', '201'],
  ['roof', '/api/v1/spatial-ml/items/{itemId}/footprint-drafts', '200'],
]) {
  const operation = spec.paths[path].post;
  cases.push({ schema: operation.requestBody.content['application/json'].schema,
    value: read(`${root}/${kind}-request.json`) });
  cases.push({ schema: operation.responses[status].content['application/json'].schema,
    value: read(`${root}/${kind}-receipt.json`).result });
}
const operation = spec.paths['/api/v1/spatial-ml/items/{itemId}/footprint-drafts'].post;
cases.push({ schema: operation.requestBody.content['application/json'].schema,
  value: read('docs/evidence/gf-backend/k2c/roofprint-request.json') });
cases.push({ schema: operation.responses['200'].content['application/json'].schema,
  value: read('docs/evidence/gf-backend/k2c/roofprint-draft.json') });
const python = `import json,sys
from jsonschema import Draft7Validator

def schema(value):
    if isinstance(value,list):
        return [schema(entry) for entry in value]
    if not isinstance(value,dict):
        return value
    result={key:schema(entry) for key,entry in value.items() if key!='nullable'}
    if value.get('nullable'):
        return {'anyOf':[result,{'type':'null'}]}
    return result

payload=json.load(sys.stdin)
components=schema(payload['components'])
for case in payload['cases']:
    root=schema(case['schema'])
    root['components']=components
    Draft7Validator(root).validate(case['value'])
print(json.dumps({'validated':len(payload['cases']),'valid':True}))
`;
const runtime = dockerRuntime();
const geo = inventory(runtime, 'ulpin-demo').containers.find(container => container.service === 'geo');
assert(geo);
const result = JSON.parse(execFileSync('docker', ['--context', runtime.context, 'exec', '-i', geo.id,
  'python', '-c', python], { input: JSON.stringify({ components: spec.components, cases }),
  encoding: 'utf8', timeout: 30000, maxBuffer: 4096 }));
assert.equal(result.validated, 6);
writeFileSync(`${root}/published-validation.json`, JSON.stringify({ ...result, exitCode: 0,
  scope: 'two live requests/responses and unchanged K2c accept-plus-reject request/response',
  method: 'existing geo jsonschema; OpenAPI nullable translated to JSON Schema null alternative',
  installedDependencies: false, newInference: false,
}) + '\n', { flag: 'wx' });
console.log('Both live command pairs and unchanged accepted/rejected K2c pair validate against published schemas.');

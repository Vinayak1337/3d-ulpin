"""Refresh reviewed producers only; never repin runtime receipts or originals."""
import hashlib
import json
from pathlib import Path

PIN_FILE = Path('docs/api/source-pins.json')
pins = json.loads(PIN_FILE.read_text())
# Reviewed integrated changes: K1 routes/projections, D3 HTML, D1b dataset metadata,
# A1 canonical target exports and A2 retained mapping admission helpers.
reviewed = [
    'apps/api/src/modules/intake/import-packages.controller.ts',
    'apps/api/src/modules/intake/wire-schemas.ts',
    'packages/server/src/modules/usp/ingestion/source-building-admission.test.ts',
    'packages/server/src/modules/usp/ingestion/source-building-import.ts',
    'packages/server/src/modules/usp/ingestion/source-building-records.ts',
    'packages/server/src/modules/usp/ingestion/source-building-review.ts',
    'packages/server/src/modules/usp/ingestion/source-building-values.ts',
    'packages/server/src/modules/usp/ingestion/source-administrative-context.ts',
    'apps/api/src/modules/register/operation-manifest.json',
    'apps/api/src/modules/register/register.module.ts',
    'apps/api/src/modules/register/canonical.controller.test.ts',
    'apps/api/src/modules/register/canonical.controller.ts',
    'apps/api/src/modules/register/canonical.service.ts',
    'docs/api/datasets.json',
    'packages/contracts/src/index.ts',
    'packages/contracts/src/usp/document-ingestion.ts',
    'packages/contracts/src/usp/ingestion.ts',
    'packages/contracts/src/canonical/building-scene.ts',
    'packages/contracts/src/canonical/building.ts',
    'packages/contracts/src/canonical/mapping-plan.ts',
    'packages/contracts/src/canonical/targets.test.ts',
    'packages/contracts/src/canonical/targets.ts',
    'packages/server/src/modules/areas/areas.ts',
    'packages/server/src/modules/areas/canonical-area.ts',
    'packages/server/src/modules/registry/canonical-building.ts',
    'packages/server/src/modules/usp/ingestion/adaptive-mapping.ts',
    'packages/server/src/modules/usp/ingestion/chunk-mapping-normalizer.ts',
    'packages/server/src/modules/usp/ingestion/chunk-mapping.ts',
    'packages/server/src/modules/usp/ingestion/mapping-executor.test.ts',
    'packages/server/src/modules/usp/ingestion/mapping-executor.ts',
    'packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts',
    'packages/server/src/modules/usp/ingestion/mapping-plan-v2.ts',
    'packages/server/src/modules/usp/ingestion/unit-table.test.ts',
    'packages/server/src/modules/usp/ingestion/unit-table.ts',
]
# The initial request-schema helper was folded into the assigned K1 building contract.
pins['sourceSha256'].pop('packages/contracts/src/canonical/building-import.ts', None)
for path in reviewed:
    text = Path(path).read_bytes().replace(b'\r\n', b'\n')
    pins['sourceSha256'][path] = hashlib.sha256(text).hexdigest()
pins['sourceSha256'] = dict(sorted(pins['sourceSha256'].items()))
document = json.loads(Path('docs/api/openapi.json').read_text())
methods = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options'}
pins['operations'] = sorted(
    f'{method.upper()} {path}'
    for path, operations in document['paths'].items()
    for method in operations if method in methods
)
PIN_FILE.write_text(json.dumps(pins, indent=2) + '\n', newline='\n')
print(f'Reviewed {len(reviewed)} producer pins; {len(pins["operations"])} operations')

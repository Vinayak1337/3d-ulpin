import { readFileSync } from 'node:fs';
import { readDemo } from '../../../../scripts/platform/demo-config.mjs';

Object.assign(process.env, readDemo());
const { transaction } = await import('../../../../packages/server/src/infrastructure/db');
const { geographicMlComponent, projectedGeographicComponents } = await import(
  '../../../../packages/server/src/modules/spatial/spatial-ml-georeference');
const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k2c/imagery-import.json', 'utf8'));
const items = JSON.parse(readFileSync('docs/evidence/gf-backend/k2c/inference-items.json', 'utf8'));
const item = items.find((value: { id: string }) => value.id === '74d6fc25-1d7e-4f6d-a0d5-6a3291a21aa6');
await transaction(async client => {
  const area = (await client.query('SELECT reference FROM map_areas WHERE id=$1', [pkg.areaId])).rows[0];
  const chip = pkg.imagery.chips.find((value: { sourceId: string }) => value.sourceId === item.sourceRevisionId);
  const geographic = item.result.components.map((component: any) => geographicMlComponent(item, chip, component));
  const projected = await projectedGeographicComponents(client, geographic, area.reference);
  console.log(`Read-only projection succeeded for ${projected.length} retained components.`);
}, { deadlineAt: Date.now() + 15_000 }, 'repeatable_read_only');

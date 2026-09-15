import type { SceneAsset } from "@ulpin/contracts";
import { query } from "./db";

/** Only assets bound to the current geometry revision may decorate a feature. */
export async function areaSceneAssets(areaId: string): Promise<SceneAsset[]> {
  const result = await query<{ body: SceneAsset }>(
    `
    SELECT a.body FROM scene_asset_bindings a
    JOIN physical_features f ON f.id=a.feature_id AND f.revision=a.feature_revision
    WHERE f.area_id=$1 OR EXISTS (SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE m.feature_id=f.id AND g.area_id=$1) ORDER BY f.id`,
    [areaId],
  );
  return result.rows.map((row) => row.body);
}

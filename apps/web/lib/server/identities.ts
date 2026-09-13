import type { PoolClient } from "pg";
import type { PropertyIdentity, UnitSpec } from "@ulpin/contracts";
import { childCode, identityLevel, propertyIdentifier } from "../identifiers";

// The caller holds the case row lock, serializing suffix allocation with edits.
export async function persistIdentity(
  client: PoolClient,
  caseId: string,
  unit: UnitSpec,
) {
  const label = identityLevel(unit.levelLabel);
  await client.query(
    `INSERT INTO identity_floors(case_id,label,ordinal)
    SELECT $1,$2,COALESCE(MAX(ordinal),0)+1 FROM identity_floors WHERE case_id=$1
    ON CONFLICT(case_id,label) DO NOTHING`,
    [caseId, label],
  );
  const floor = (
    await client.query(
      "SELECT ordinal FROM identity_floors WHERE case_id=$1 AND label=$2",
      [caseId, label],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO identity_spaces(case_id,unit_id,ordinal,floor_ordinal)
    SELECT $1,$2,COALESCE(MAX(ordinal),0)+1,$3 FROM identity_spaces WHERE case_id=$1
    ON CONFLICT(unit_id) DO UPDATE SET floor_ordinal=EXCLUDED.floor_ordinal`,
    [caseId, unit.id, floor.ordinal],
  );
}

export async function readIdentity(
  client: PoolClient,
  caseId: string,
): Promise<PropertyIdentity> {
  const rootId = propertyIdentifier(caseId);
  const floors = (
    await client.query(
      `SELECT f.ordinal,f.label FROM identity_floors f
    WHERE f.case_id=$1 AND EXISTS(SELECT 1 FROM identity_spaces s JOIN units u ON u.id=s.unit_id
      WHERE s.case_id=f.case_id AND s.floor_ordinal=f.ordinal AND u.active)
    ORDER BY f.ordinal`,
      [caseId],
    )
  ).rows;
  const spaces = (
    await client.query(
      `SELECT s.ordinal,s.unit_id,s.floor_ordinal FROM identity_spaces s
    JOIN units u ON u.id=s.unit_id WHERE s.case_id=$1 AND u.active ORDER BY s.ordinal`,
      [caseId],
    )
  ).rows;
  return {
    rootId,
    status: "prototype",
    scope: "property-workspace",
    floors: floors.map((f) => {
      const code = childCode("F", f.ordinal);
      return {
        id: `${rootId}:${code}`,
        code,
        label: f.label,
        parentId: rootId,
      };
    }),
    spaces: spaces.map((s) => {
      const code = childCode("S", s.ordinal),
        floor = childCode("F", s.floor_ordinal);
      return {
        id: `${rootId}:${code}`,
        code,
        unitId: s.unit_id,
        parentId: `${rootId}:${floor}`,
        path: `${rootId}:${floor}:${code}`,
      };
    }),
  };
}

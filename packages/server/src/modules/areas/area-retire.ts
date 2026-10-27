import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AreaRetirement } from "@ulpin/contracts";
import { query, transaction } from "../../infrastructure/db";
import { AppError, conflict, notFound } from "../../infrastructure/errors";
import { localOperatorSubject } from "../usp/principal";

export type AreaRetirementInput = { expectedRevision: number; reason: string };
type Change = AreaRetirement["state"];

const retiredError = () =>
  new AppError(404, "AREA_RETIRED", "This area is retired. Its records, originals and history are kept.");

/** A retired area is gone from the area screen's reads; its rows stay. */
export async function assertLiveArea(areaId: string, client?: PoolClient): Promise<void> {
  const sql = "SELECT archived_at FROM map_areas WHERE id=$1";
  const row = (await (client ? client.query(sql, [areaId]) : query(sql, [areaId]))).rows[0];
  if (!row) notFound("Map area not found.");
  if (row.archived_at) throw retiredError();
}

/** Writes into an area stop once it is retired; a restore lets them through again. */
export function assertAreaRowLive(row: { archived_at?: Date | string | null }): void {
  if (row.archived_at) throw new AppError(409, "AREA_RETIRED",
    "This area is retired. Restore it, or add the file in a new case.");
}

/** G20. Retire or restore under the area's row lock at the officer's pinned revision; one event row each. */
async function change(areaId: string, input: AreaRetirementInput, state: Change): Promise<AreaRetirement> {
  const actor = localOperatorSubject(), reason = input.reason.trim();
  return transaction(async client => {
    const row = (await client.query("SELECT id,revision,archived_at FROM map_areas WHERE id=$1 FOR UPDATE",
      [areaId])).rows[0];
    if (!row) notFound("Map area not found.");
    if (row.revision !== input.expectedRevision) conflict("The area changed; refresh before retiring or restoring it.");
    if (state === "retired" && row.archived_at)
      throw new AppError(409, "AREA_RETIRED", "This area is already retired.");
    if (state === "active" && !row.archived_at)
      throw new AppError(409, "AREA_NOT_RETIRED", "This area is not retired.");
    const at = (await client.query(state === "retired"
      ? "UPDATE map_areas SET archived_at=now(),archive_reason=$2,archived_by=$3 WHERE id=$1 RETURNING now() at"
      : "UPDATE map_areas SET archived_at=NULL,archive_reason=NULL,archived_by=NULL WHERE id=$1 RETURNING now() at",
    state === "retired" ? [areaId, reason, actor] : [areaId])).rows[0].at as Date;
    const eventId = randomUUID();
    await client.query(`INSERT INTO map_area_events(id,area_id,area_revision,kind,actor,reason,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [eventId, areaId, row.revision, state === "retired" ? "retired" : "restored",
      actor, reason, at]);
    return { areaId, state, areaRevision: row.revision, eventId, actor, reason, at: at.toISOString() };
  });
}

export const retireArea = (areaId: string, input: AreaRetirementInput) => change(areaId, input, "retired");
export const restoreArea = (areaId: string, input: AreaRetirementInput) => change(areaId, input, "active");

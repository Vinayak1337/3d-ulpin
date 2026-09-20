import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ImportPackage } from "@ulpin/contracts";
import { query, transaction } from "./db";
import { getArea } from "./areas";
import { fingerprint } from "./domain";
import { AppError, conflict, notFound } from "./errors";
import { documentProfileFormats } from "../document-formats";

export const sourceWorkspaceSchema = z.object({
  requestKey: z.string().uuid(), areaId: z.string().uuid(), expectedAreaRevision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(150), worldStatus: z.enum(["observed", "planned", "hypothetical", "synthetic"]),
  caseId: z.string().uuid().optional(),
}).strict();
export function sourceWorkspaceParts(sources: {id: string; profile: string; inspection?: {referenceParts?: ImportPackage["parts"]} | null}[]): ImportPackage["parts"] {
  return sources.filter(s => Object.hasOwn(documentProfileFormats, s.profile)).flatMap(s => s.inspection?.referenceParts?.length ? s.inspection.referenceParts : [{id: randomUUID(), sourceRevisionId:s.id, locator:"original file", text:"Retained original. Read and review source evidence before use.", entityIds:[]}]);
}
export async function sourceWorkspaceForCase(caseId: string) {
  return (await query("SELECT body FROM import_packages WHERE case_id=$1 AND body ? 'sourceWorkspace' ORDER BY created_at DESC LIMIT 1", [caseId])).rows[0]?.body as ImportPackage | undefined || null;
}
export async function createSourceWorkspace(value: unknown): Promise<ImportPackage> {
  const input = sourceWorkspaceSchema.parse(value), digest = fingerprint(input);
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`source-workspace:${input.caseId || input.requestKey}`]);
    const key = `source-workspace:${input.requestKey}`;
    const prior = (await client.query("SELECT body FROM import_packages WHERE operation_key=$1", [key])).rows[0]?.body;
    if (prior) {
      if (prior.datasetNamespace !== `source-workspace:${digest}`) conflict("This request key already names different source workspace inputs.");
      return prior;
    }
    await client.query("SELECT id FROM map_areas WHERE id=$1 FOR SHARE", [input.areaId]);
    const area = await getArea(input.areaId, client);
    if (area.revision !== input.expectedAreaRevision) conflict("The destination changed. Refresh before retaining sources.");
    const frame = (await client.query("SELECT frame FROM registry_sites WHERE id=$1 FOR SHARE", [area.siteId])).rows[0]?.frame;
    if (!frame?.id || frame.horizontalUnit !== "m") throw new AppError(422, "SOURCE_FRAME", "Choose a block with a retained named metre frame.");
    const caseId = input.caseId || randomUUID();
    if (input.caseId) {
      if (!(await client.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [caseId])).rowCount) notFound("Workspace not found.");
      if ((await client.query("SELECT case_id FROM registry_case_feature_mappings WHERE case_id=$1", [caseId])).rowCount) conflict("This case is already associated with a physical record. Open its property workspace.");
      if ((await client.query("SELECT id FROM import_packages WHERE case_id=$1", [caseId])).rowCount) conflict("This case already has a package. Reopen its retained workspace.");
    } else await client.query("INSERT INTO cases(id,name,description,frame,site_id) VALUES($1,$2,$3,$4,$5)", [caseId,input.name,"Source workspace. No physical property assigned.",frame,area.siteId]);
    const sources = (await client.query("SELECT id,name,profile,inspection FROM sources WHERE case_id=$1 ORDER BY created_at", [caseId])).rows;
    const pkg: ImportPackage = {
      id: randomUUID(), schemaVersion: "ulpin-canonical/2", areaId: area.id, name: input.name,
      datasetNamespace: `source-workspace:${digest}`, revision: 1, state: "RECEIVED", features: [],
      sourceRevisionIds: sources.map(s => s.id), questions: [], factCandidates: [],
      parts: sourceWorkspaceParts(sources),
      warnings: [], createdAt: new Date().toISOString(),
      sourceWorkspace: {caseId, frame, worldStatus: input.worldStatus, areaReferenceFingerprint: fingerprint(area.reference || null)},
    };
    await client.query("INSERT INTO import_packages(id,area_id,case_id,revision,state,body,operation_key) VALUES($1,$2,$3,1,$4,$5,$6)",[pkg.id,area.id,caseId,pkg.state,pkg,key]);
    await client.query("INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,1,$2)",[pkg.id,pkg]);
    return pkg;
  });
}

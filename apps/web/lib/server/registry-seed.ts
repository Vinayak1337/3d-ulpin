import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RegistryBody,
  RegistryRecord,
  SourceProfile,
} from "@ulpin/contracts";
import { pool, query, transaction } from "./db";
import { propertyIdentifier } from "../identifiers";
import {
  getCase,
  uploadSource,
  prepareCase,
  requestBuild,
  fingerprint,
} from "./domain";
import { AppError, conflict, notFound } from "./errors";
import {
  contextImportEvidence,
  unitImportEvidence,
} from "./registry-import-evidence";
import { settings } from "./config";
import {
  reserveRecord,
  siteFrom,
  siteDetail,
  prepareRegistryReview,
  commitRegistryReview,
} from "./registry";

export async function importRegistryCase(
  siteId: string,
  caseId: string,
  expectedRevision: number,
) {
  const detail = await getCase(caseId);
  if (
    !detail.model ||
    detail.model.revision !== detail.case.revision ||
    detail.case.revision !== expectedRevision
  )
    conflict("Build the current case before importing.");
  return transaction(async (client) => {
    const site = siteFrom(
      (
        await client.query(
          "SELECT * FROM registry_sites WHERE id=$1 FOR UPDATE",
          [siteId],
        )
      ).rows[0] ?? notFound(),
    );
    if (fingerprint(site.frame) !== fingerprint(detail.case.frame))
      throw new AppError(
        422,
        "FRAME_MISMATCH",
        "Import requires the same declared frame and benchmark.",
      );
    const c = (
      await client.query("SELECT * FROM cases WHERE id=$1 FOR UPDATE", [caseId])
    ).rows[0];
    if (c.revision !== expectedRevision) conflict();
    if (c.site_id && c.site_id !== siteId)
      throw new AppError(
        422,
        "SITE_MISMATCH",
        "This case already belongs to another site.",
      );
    const existing = (
      await client.query(
        "SELECT * FROM registry_drafts WHERE case_id=$1 ORDER BY created_at LIMIT 1",
        [caseId],
      )
    ).rows[0];
    if (existing) return existing.id as string;
    await client.query("UPDATE cases SET site_id=$2 WHERE id=$1", [
      caseId,
      siteId,
    ]);
    const isDemoFixture = Boolean(
      (
        await client.query(
          "SELECT 1 FROM registry_sites WHERE id=$1 AND seed_key='nandan-v1' AND seed_case_id=$2",
          [siteId, caseId],
        )
      ).rowCount,
    );
    const rights = isDemoFixture
      ? detail.sources.find((s) => s.name === "rights.pdf")
      : undefined;
    const records: RegistryRecord[] = [];
    for (const context of detail.context)
      records.push(
        await reserveRecord(client, site, {
          alias: context.alias,
          name: context.name || context.alias,
          kind: context.kind,
          footprint: context.footprint,
          links: [],
          rights: [],
          evidence: [
            contextImportEvidence(context, detail.sources, detail.model!.units),
          ],
          synthetic: site.synthetic,
        }),
      );
    const buildings = records.filter((r) => r.kind === "building"),
      parcels = records.filter((r) => r.kind === "parcel");
    // The demo source has explicit A/B floor labels. Other imports stay unassigned
    // until the operator links them; never infer a building from mere proximity.
    for (const b of buildings) {
      const p = parcels.find((p) => p.alias === `P${b.alias}`);
      if (isDemoFixture && p) b.links = [{ type: "within", targetId: p.id }];
      for (const label of [
        ...new Set(
          detail.units
            .map((u) => u.levelLabel)
            .filter((l) => l.startsWith(`${b.alias} / `)),
        ),
      ]) {
        records.push(
          await reserveRecord(client, site, {
            alias: label,
            name: label,
            kind: "floor",
            footprint: b.footprint,
            links: [{ type: "within", targetId: b.id }],
            rights: [],
            evidence: b.evidence,
            synthetic: site.synthetic,
          }),
        );
      }
    }
    for (const unit of detail.model!.units) {
      const building = buildings.find((b) =>
        unit.levelLabel.startsWith(`${b.alias} / `),
      );
      const floor = records.find(
        (r) => r.kind === "floor" && r.alias === unit.levelLabel,
      );
      const use =
        unit.alias === "UTIL"
          ? "utility"
          : unit.kind === "basement"
            ? "basement"
            : unit.kind === "common"
              ? "common"
              : "apartment";
      const body: RegistryBody = {
        alias: unit.alias,
        name: unit.name,
        kind: "space",
        use,
        footprint: unit.footprint,
        geometry: unit,
        links: [],
        rights: [],
        evidence: unitImportEvidence(unit),
        synthetic: site.synthetic,
      };
      if (building) body.links.push({ type: "within", targetId: building.id });
      if (floor) body.links.push({ type: "floor", targetId: floor.id });
      if (isDemoFixture && unit.alias === "BASE")
        body.links.push(
          ...buildings.map((b) => ({
            type: "serves" as const,
            targetId: b.id,
          })),
        );
      if (isDemoFixture && unit.alias === "UTIL")
        body.links.push(
          ...parcels.map((p) => ({ type: "crosses" as const, targetId: p.id })),
        );
      if (rights && site.synthetic)
        body.rights = [
          {
            party:
              use === "utility"
                ? "Nandan Utility Cooperative"
                : use === "apartment"
                  ? `Household ${unit.alias}`
                  : "Nandan Residents Association",
            type:
              use === "utility"
                ? "easement"
                : use === "apartment"
                  ? "ownership_claim"
                  : "shared_use",
            evidence: { sourceId: rights.id, locator: `page 1, ${unit.alias}` },
          },
        ];
      const record = await reserveRecord(client, site, body);
      records.push(record);
      const legacy = detail.identity.spaces.find((s) => s.unitId === unit.id);
      if (legacy)
        await client.query(
          "INSERT INTO registry_aliases(alias,record_id,site_id,meaning) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [
            legacy.id,
            record.id,
            siteId,
            "Legacy workspace-space identifier; explicit import alias.",
          ],
        );
    }
    // Keep workspace and floor-group meanings even when a legacy group has no
    // equivalent context record (for example an unassigned underground level).
    for (const legacy of [
      { id: detail.identity.rootId, label: null },
      ...detail.identity.floors,
    ]) {
      const target = legacy.label
        ? records.find((r) => r.kind === "floor" && r.alias === legacy.label)
        : undefined;
      await client.query(
        "INSERT INTO registry_aliases(alias,record_id,site_id,meaning,workspace_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          legacy.id,
          target?.id || null,
          siteId,
          legacy.label
            ? `Legacy workspace floor group: ${legacy.label}.`
            : "Legacy workspace namespace; identifies its original preparation workspace, not the entire site.",
          caseId,
        ],
      );
    }
    const draftId = randomUUID();
    await client.query(
      "INSERT INTO registry_drafts(id,site_id,case_id,records) VALUES($1,$2,$3,$4)",
      [draftId, siteId, caseId, JSON.stringify(records)],
    );
    return draftId;
  });
}
async function waitForCase(
  caseId: string,
  predicate: (d: Awaited<ReturnType<typeof getCase>>) => boolean,
) {
  const end = Date.now() + 110000;
  while (Date.now() < end) {
    const d = await getCase(caseId);
    if (predicate(d)) return d;
    const failure = d.jobs.find((j) => j.status === "failed");
    if (failure)
      throw new AppError(
        422,
        "SEED_PROCESSING",
        failure.error || "Source processing failed.",
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new AppError(
    503,
    "SEED_PENDING",
    "Processing is still pending. Retry loading the neighbourhood to resume.",
  );
}
export async function seedRegistry() {
  const guard = await pool().connect();
  try {
    const acquired = (
      await guard.query(
        "SELECT pg_try_advisory_lock(hashtext('registry-demo-seed')) AS locked",
      )
    ).rows[0].locked;
    if (!acquired)
      throw new AppError(
        409,
        "SEED_RUNNING",
        "The neighbourhood is already loading. Refresh shortly.",
      );
    let row = (
      await query("SELECT * FROM registry_sites WHERE seed_key='nandan-v1'")
    ).rows[0];
    if (row?.revision > 0) return siteDetail(row.id);
    if (!row) {
      const frame = {
        id: "LOCAL-NANDAN-DEMO",
        horizontalUnit: "m",
        verticalUnit: "m",
        benchmark: "BM-NANDAN-SYNTHETIC",
      };
      const id = randomUUID(),
        caseId = randomUUID();
      await transaction(async (client) => {
        await client.query(
          "INSERT INTO registry_sites(id,identifier,name,frame,seed_key) VALUES($1,$2,$3,$4,'nandan-v1')",
          [id, propertyIdentifier(id), "Nandan block", frame],
        );
        await client.query(
          "INSERT INTO cases(id,name,description,frame,site_id,archived) VALUES($1,$2,$3,$4,$5,true)",
          [
            caseId,
            "Nandan block · source preparation",
            "Fully synthetic neighbourhood. No surveyed location or legal rights.",
            frame,
            id,
          ],
        );
        await client.query(
          "UPDATE registry_sites SET seed_case_id=$2 WHERE id=$1",
          [id, caseId],
        );
      });
      row = (await query("SELECT * FROM registry_sites WHERE id=$1", [id]))
        .rows[0];
    }
    const sources: { name: string; profile: SourceProfile; mime: string }[] = [
      {
        name: "spatial.json",
        profile: "parcel-local-json-v1",
        mime: "application/json",
      },
      { name: "levels.csv", profile: "levels-csv-v1", mime: "text/csv" },
      { name: "plan.png", profile: "plan-png-v1", mime: "image/png" },
      { name: "plan.pdf", profile: "plan-pdf-v1", mime: "application/pdf" },
      { name: "rights.pdf", profile: "plan-pdf-v1", mime: "application/pdf" },
    ];
    for (const s of sources)
      await uploadSource(row.seed_case_id, {
        name: s.name,
        profile: s.profile,
        mimeType: s.mime,
        bytes: await readFile(
          path.join(settings.fixtureRoot, "registry", s.name),
        ),
        operationKey: `registry-seed:${s.name}`,
      });
    let d = await waitForCase(
      row.seed_case_id,
      (d) =>
        d.sources.length === 5 &&
        d.sources.every(
          (s) => s.inspection && ["ready", "needs_input"].includes(s.status),
        ),
    );
    if (!d.units.length) {
      await prepareCase(row.seed_case_id, {
        spatialSourceId: d.sources.find((s) => s.name === "spatial.json")!.id,
        levelSourceId: d.sources.find((s) => s.name === "levels.csv")!.id,
      });
      d = await getCase(row.seed_case_id);
    }
    if (!d.model || d.model.revision !== d.case.revision) {
      await requestBuild(row.seed_case_id, d.case.revision);
      d = await waitForCase(
        row.seed_case_id,
        (d) => !!d.model && d.model.revision === d.case.revision,
      );
    }
    const draftId = await importRegistryCase(
      row.id,
      row.seed_case_id,
      d.case.revision,
    );
    const draft = (
      await query("SELECT * FROM registry_drafts WHERE id=$1", [draftId])
    ).rows[0];
    const review = await prepareRegistryReview(
      draftId,
      draft.revision,
      row.revision,
    );
    await commitRegistryReview(
      review.id,
      "Synthetic fixture inputs reviewed for the local technical demonstration.",
    );
    return siteDetail(row.id);
  } finally {
    await guard
      .query("SELECT pg_advisory_unlock(hashtext('registry-demo-seed'))")
      .catch(() => {});
    guard.release();
  }
}

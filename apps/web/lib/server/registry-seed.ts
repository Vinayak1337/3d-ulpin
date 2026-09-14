import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RegistryBody,
  SourceBinding,
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
  openRegistryRing,
  siteFrom,
  siteDetail,
  prepareRegistryReview,
  commitRegistryReview,
} from "./registry";

export async function importRegistryCase(
  siteId: string | null,
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
    // Serialize import destinations and retries for a workspace before allocating identities.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `registry-import:${caseId}`,
    ]);
    if (!siteId) {
      const attached = (
        await client.query("SELECT site_id FROM cases WHERE id=$1", [caseId])
      ).rows[0]?.site_id;
      if (attached) siteId = attached;
      else {
        const id = randomUUID();
        const created = await client.query(
          "INSERT INTO registry_sites(id,identifier,name,frame,seed_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(seed_key) DO UPDATE SET seed_key=EXCLUDED.seed_key RETURNING id",
          [
            id,
            propertyIdentifier(id),
            `${detail.case.name} · site`,
            detail.case.frame,
            `workspace-import:${caseId}`,
          ],
        );
        siteId = created.rows[0].id;
      }
    }
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
        `This workspace uses ${detail.case.frame.id} / ${detail.case.frame.benchmark}; the site uses ${site.frame.id} / ${site.frame.benchmark}. Import into a separate site to preserve its coordinates.`,
      );
    const c = (
      await client.query("SELECT * FROM cases WHERE id=$1 FOR UPDATE", [caseId])
    ).rows[0];
    if (
      c.revision !== expectedRevision ||
      c.current_snapshot_id !== detail.model!.id
    )
      conflict("The built case changed. Refresh before importing.");
    if (c.site_id && c.site_id !== siteId)
      throw new AppError(
        422,
        "SITE_MISMATCH",
        "This case already belongs to another site.",
      );
    const transformVersion = "workspace-local-metres-v1";
    const normalizationVersion = "registry-case-import-v2";
    const operationKey = fingerprint({
      caseId,
      siteId,
      caseRevision: expectedRevision,
      inputFingerprint: detail.model!.inputFingerprint,
      transformVersion,
      normalizationVersion,
    });
    const existing = (
      await client.query(
        "SELECT draft_id FROM registry_case_import_operations WHERE operation_key=$1",
        [operationKey],
      )
    ).rows[0];
    if (existing) return existing.draft_id as string;
    const previousDrafts = (
      await client.query(
        "SELECT id,records FROM registry_drafts WHERE case_id=$1 AND site_id=$2 ORDER BY created_at DESC,id DESC",
        [caseId, siteId],
      )
    ).rows;
    const previousOperation = (
      await client.query(
        "SELECT id,draft_id FROM registry_case_import_operations WHERE case_id=$1 AND site_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [caseId, siteId],
      )
    ).rows[0];
    // Retain legacy imports as history and adopt only unambiguous case-owned IDs.
    // Do not infer which old mutable draft represented the current build.
    const historicalRecords = new Map<string, RegistryRecord>();
    for (const draft of previousDrafts)
      for (const record of draft.records as RegistryRecord[])
        if (!historicalRecords.has(record.id))
          historicalRecords.set(record.id, record);
    const sourceFamily = (binding: SourceBinding) => {
      const source = detail.sources.find((s) => s.id === binding.sourceId);
      if (!source)
        throw new AppError(
          422,
          "IMPORT_EVIDENCE",
          "Import evidence is not part of this workspace.",
        );
      return source.familyId;
    };
    const seenFeatures = new Set<string>();
    const importRecord = async (
      featureKey: string,
      body: RegistryBody,
      legacyMatch: (record: RegistryRecord) => boolean,
    ): Promise<RegistryRecord> => {
      if (seenFeatures.has(featureKey))
        throw new AppError(
          422,
          "IMPORT_FEATURE_CONFLICT",
          `Duplicate source feature: ${body.alias}.`,
        );
      seenFeatures.add(featureKey);
      const mapping = (
        await client.query(
          "SELECT record_id FROM registry_case_feature_mappings WHERE case_id=$1 AND site_id=$2 AND feature_key=$3",
          [caseId, siteId, featureKey],
        )
      ).rows[0];
      let recordId = mapping?.record_id as string | undefined;
      if (!recordId) {
        const candidates = [...historicalRecords.values()].filter(legacyMatch);
        if (candidates.length > 1)
          throw new AppError(
            422,
            "IMPORT_IDENTITY_CONFLICT",
            `${body.alias}: multiple historical records match this feature. Resolve its identity before importing.`,
          );
        recordId = candidates[0]?.id;
      }
      let record: RegistryRecord;
      if (recordId) {
        const current = (
          await client.query(
            "SELECT id,site_id,kind,identifier,revision,body FROM registry_records WHERE id=$1 AND site_id=$2",
            [recordId, siteId],
          )
        ).rows[0];
        if (!current || current.kind !== body.kind)
          throw new AppError(
            422,
            "IMPORT_IDENTITY_CONFLICT",
            `${body.alias}: its mapped record is missing or has a different kind.`,
          );
        const previous: RegistryBody = current.revision > 0
          ? current.body
          : historicalRecords.get(recordId) ?? current.body;
        // Reserved physical identities contain an observation-only marker; it
        // does not belong in the detailed registry body being reviewed.
        if (current.revision === 0) delete (previous as any).representation;
        // Preserve independently recorded rights and metadata. Imported relations
        // replace a relation type only when this source explicitly supplies it.
        const replacedLinkTypes = new Set(body.links.map((link) => link.type));
        record = {
          ...previous,
          ...body,
          links: [
            ...previous.links.filter((link) => !replacedLinkTypes.has(link.type)),
            ...body.links,
          ],
          rights: body.rights.length ? body.rights : previous.rights,
          footprint: openRegistryRing(body.footprint),
          geometry: body.geometry
            ? {
                ...body.geometry,
                id: recordId,
                alias: body.alias,
                name: body.name,
                footprint: openRegistryRing(body.geometry.footprint),
              }
            : undefined,
          id: recordId,
          siteId: site.id,
          identifier: current.identifier,
          revision: current.revision,
        };
      } else {
        record = await reserveRecord(client, site, body);
      }
      if (!mapping)
        await client.query(
          "INSERT INTO registry_case_feature_mappings(case_id,site_id,feature_key,record_id) VALUES($1,$2,$3,$4)",
          [caseId, siteId, featureKey, record.id],
        );
      return record;
    };
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
    const canonicalPreparation=Boolean((await client.query('SELECT 1 FROM building_preparations WHERE case_id=$1',[caseId])).rowCount);
    const records: RegistryRecord[] = [];
    for (const context of detail.model!.context) {
      const evidence = contextImportEvidence(
        context,
        detail.sources,
        detail.model!.units,
      );
      const familyId = sourceFamily(evidence);
      records.push(
        await importRecord(
          JSON.stringify(["context", familyId, context.kind, context.alias]),
          {
            alias: context.alias,
            name: context.name || context.alias,
            kind: context.kind,
            footprint: context.footprint,
            links: [],
            rights: [],
            evidence: [evidence],
            synthetic: site.synthetic,
          },
          (record) =>
            record.kind === context.kind &&
            record.alias === context.alias &&
            record.evidence.some((binding) =>
              detail.sources.some((source) =>
                source.id === binding.sourceId && source.familyId === familyId,
              ),
            ),
        ),
      );
    }
    const buildings = records.filter((r) => r.kind === "building"),
      parcels = records.filter((r) => r.kind === "parcel");
    // The demo source has explicit A/B floor labels. Other imports stay unassigned
    // until the operator links them; never infer a building from mere proximity.
    for (const b of buildings) {
      const p = parcels.find((p) => p.alias === `P${b.alias}`);
      if (isDemoFixture && p) b.links = [{ type: "within", targetId: p.id }];
      for (const label of [
        ...new Set(
          detail.model!.units
            .map((u) => u.levelLabel)
            .filter((l) => l.startsWith(`${b.alias} / `)),
        ),
      ]) {
        records.push(
          await importRecord(
            JSON.stringify(["floor", b.id, label]),
            {
              alias: label,
              name: label,
              kind: "floor",
              footprint: b.footprint,
              links: [{ type: "within", targetId: b.id }],
              rights: [],
              evidence: b.evidence,
              synthetic: site.synthetic,
            },
            (record) =>
              record.kind === "floor" &&
              record.alias === label &&
              record.links.some((link) =>
                link.type === "within" && link.targetId === b.id,
              ),
          ),
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
              : canonicalPreparation ? "unspecified" : "apartment";
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
      const legacy = detail.identity.spaces.find((s) => s.unitId === unit.id);
      const legacyTarget = legacy
        ? (
            await client.query(
              "SELECT record_id FROM registry_aliases WHERE alias=$1 AND site_id=$2",
              [legacy.id, siteId],
            )
          ).rows[0]?.record_id
        : undefined;
      const record = await importRecord(
        JSON.stringify(["space", unit.id]),
        body,
        (record) => record.kind === "space" && record.id === legacyTarget,
      );
      if (legacyTarget && legacyTarget !== record.id)
        throw new AppError(
          422,
          "IMPORT_IDENTITY_CONFLICT",
          `${unit.alias}: the legacy alias and source mapping identify different records. Resolve the identity conflict before importing.`,
        );
      records.push(record);
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
    await client.query(
      `INSERT INTO registry_case_import_operations(
        id,case_id,site_id,case_revision,input_fingerprint,transform_version,
        normalization_version,operation_key,draft_id,previous_operation_id,previous_draft_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(), caseId, siteId, expectedRevision,
        detail.model!.inputFingerprint, transformVersion, normalizationVersion,
        operationKey, draftId, previousOperation?.id ?? null,
        previousOperation?.draft_id ?? previousDrafts[0]?.id ?? null,
      ],
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

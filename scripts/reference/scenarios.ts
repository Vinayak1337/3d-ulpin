import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { query } from "../../apps/web/lib/server/db";
import { uploadSource } from "../../apps/web/lib/server/domain";
import {
  ingestArea,
  reviewPackage,
  commitPackage,
  getArea,
  areaContext,
  attachDocument,
  copyCaseDocuments,
  getPackage,
} from "../../apps/web/lib/server/areas";
import { openPreparation } from "../../apps/web/lib/server/officer";
import { createInvestigation } from "../../apps/web/lib/server/officer-investigations";
const root = new URL("../../fixtures/reference-neighborhood/", import.meta.url);
const reason =
  "Authored fictional demonstration evidence; no survey, title or approval claim.";
export async function seedScenarios(areaId: string, base: string) {
  const spec = JSON.parse(await readFile(new URL("spec.json", root), "utf8"));
  let context = await areaContext(areaId);
  if (
    !context.features.some(
      (f) => f.datasetNamespace === "lakeview-demonstration:utility",
    )
  ) {
    const raw = {
      spatialReference: { wkid: 32643 },
      features: [
        {
          attributes: {
            id: "U1",
            name: "Fictional water alignment",
            start_z: -1.8,
            end_z: -2.2,
            diameter_m: 0.45,
          },
          geometry: {
            paths: [
              [
                [520012, 3150049],
                [520124, 3150049],
              ],
            ],
          },
        },
      ],
    };
    let pkg = await ingestArea({
      bytes: Buffer.from(JSON.stringify(raw)),
      filename: "fictional-utility.json",
      format: "arcgis",
      namespace: "lakeview-demonstration:utility",
      name: spec.name,
      areaId,
      expectedAreaRevision: (await getArea(areaId)).revision,
      worldStatus: "synthetic",
      mapping: {
        idField: "id",
        nameField: "name",
        kind: "utility",
        geometryRole: "physical_utility",
        utility: {
          startLevelField: "start_z",
          endLevelField: "end_z",
          levelUnit: "m",
          levelMeaning: "centre",
          verticalReference: spec.benchmark,
          interpolation: "linear_endpoints",
          crossSection: "circular",
          diameterField: "diameter_m",
          dimensionUnit: "m",
        },
      },
    });
    if (pkg.state !== "COMMITTED") {
      pkg = await reviewPackage(pkg.id, pkg.revision);
      await commitPackage(pkg.id, pkg.revision, reason);
    }
  }
  context = await areaContext(areaId);
  const feature = context.features.find(
    (f) => f.kind === "building" && f.sourceKey === "D",
  )!;
  const prep = await openPreparation(feature.id, feature.revision);
  let pkg = await getPackage(prep.packageId);
  if (!pkg.parts.some((p) => p.text.includes("D-DRAFT"))) {
    const geom =
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates[0]
        : [];
    const x = Math.min(...geom.map((p) => p[0])) + 1,
      y = Math.min(...geom.map((p) => p[1])) + 1;
    const csv = `alias,lower,upper,unit,benchmark,label,level,footprint_wkt,frame\nD-DRAFT,0,,m,${spec.benchmark},Entrance lobby,Ground,"POLYGON ((${x} ${y},${x + 4} ${y},${x + 4} ${y + 4},${x} ${y + 4},${x} ${y}))",${prep.placement.targetFrame}\n`;
    pkg = await attachDocument(pkg.id, pkg.revision, {
      bytes: Buffer.from(csv),
      name: "D-incomplete-level-schedule.csv",
      format: "csv",
      entityIds: [feature.id],
    });
  }
  const name = "Lake View · supplied plan revisions (fictional)";
  let packet = (
    await query(
      "SELECT c.id FROM cases c LEFT JOIN operations o ON o.case_id=c.id AND o.operation_key='lakeview-original-plan' AND o.kind='upload' WHERE o.case_id IS NOT NULL OR c.name=$1 ORDER BY (o.case_id IS NOT NULL) DESC,c.created_at LIMIT 1",
      [name],
    )
  ).rows[0];
  if (!packet) {
    const response = await fetch(`${base}/api/v1/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: reason }),
    });
    if (!response.ok) throw Error(await response.text());
    packet = await response.json();
  }
  let sources = (
    await query(
      "SELECT id,family_id,revision FROM sources WHERE case_id=$1 ORDER BY revision",
      [packet.id],
    )
  ).rows;
  if (!sources.length) {
    await uploadSource(packet.id, {
      name: "D-floor-plans.pdf",
      profile: "plan-pdf-v1",
      mimeType: "application/pdf",
      bytes: await readFile(new URL("D-floor-plans.pdf", root)),
      operationKey: "lakeview-original-plan",
    });
    sources = (
      await query(
        "SELECT id,family_id,revision FROM sources WHERE case_id=$1 ORDER BY revision",
        [packet.id],
      )
    ).rows;
  }
  if (!sources.some((s) => s.revision === 2)) {
    await uploadSource(packet.id, {
      name: "D-floor-plans.pdf",
      profile: "plan-pdf-v1",
      mimeType: "application/pdf",
      bytes: await readFile(new URL("D-floor-plans-revision-2.pdf", root)),
      familyId: sources[0].family_id,
      operationKey: "lakeview-plan-revision-2",
    });
    sources = (
      await query(
        "SELECT id,family_id,revision FROM sources WHERE case_id=$1 ORDER BY revision",
        [packet.id],
      )
    ).rows;
  }
  const copied = new Set(pkg.parts.map((p) => p.copiedFrom?.sourceRevisionId));
  const pending = sources.filter((s) => !copied.has(s.id));
  if (pending.length) {
    pkg = await copyCaseDocuments(pkg.id, {
      expectedRevision: pkg.revision,
      caseId: packet.id,
      sourceIds: pending.map((s) => s.id),
      buildingId: feature.id,
      reason,
    });
  }
  if (
    !(
      await query(
        "SELECT id FROM officer_investigations WHERE building_id=$1 AND body->>'reference'='LV-DEMO-001'",
        [feature.id],
      )
    ).rows.length
  )
    await createInvestigation({
      buildingId: feature.id,
      expectedRevision: feature.revision,
      requestKey: randomUUID(),
      reference: "LV-DEMO-001",
      classification: "Missing source level",
      notes:
        "The supplied entrance schedule leaves its upper level blank. Read the two plan revisions and request the missing level before preparing geometry.",
    });
  console.log(
    "Fictional utility, incomplete property draft, two original plan revisions and investigation retained.",
  );
}

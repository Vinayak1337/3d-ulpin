import { preparationContinuation } from "./preparation-continuation";
import { randomUUID } from "node:crypto";
import type {
  FactCandidate,
  ImportPackage,
  PreparationCase,
  PreparationRequirements,
  AreaGeometry,
  SourceLocator,
  UnitSpec,
  Point2,
} from "@ulpin/contracts";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { getPackage } from "./areas";
import { AppError, conflict, notFound } from "./errors";
import { validateLocators } from "./officer";
import { fingerprint, getCase, requestBuild, persistUnit } from "./domain";
import { putOriginal, sha256 } from "./storage";
import { originalAttempt } from "./original-attempt";

export const factProperties = [
  "outline.geometry",
  "outline.role",
  "placement.controls",
  "building.floorCount",
  "building.exteriorHeight",
  "space.geometry",
  "space.lower",
  "space.upper",
  "space.label",
  "space.levelLabel",
  "utility.profile",
  "source.date",
  "source.status",
] as const;
async function locked(
  client: PoolClient,
  id: string,
  revision: number,
): Promise<ImportPackage> {
  const pkg =
    (
      await client.query(
        "SELECT body FROM import_packages WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0]?.body ?? notFound();
  if (pkg.revision !== revision || pkg.state === "COMMITTED")
    conflict("This preparation changed. Refresh the current draft.");
  return pkg;
}
async function save(client: PoolClient, pkg: ImportPackage) {
  pkg.revision++;
  delete pkg.review;
  pkg.state = "NEEDS_INPUT";
  await client.query(
    "UPDATE import_packages SET body=$2,revision=$3,state=$4 WHERE id=$1",
    [pkg.id, pkg, pkg.revision, pkg.state],
  );
  await client.query(
    "INSERT INTO import_package_revisions(package_id,revision,body) VALUES($1,$2,$3)",
    [pkg.id, pkg.revision, pkg],
  );
}
export type PreparationFactInput = Omit<FactCandidate, "id"> & {
  subject?: string;
};
export async function appendPreparationFacts(
  id: string,
  expectedRevision: number,
  facts: PreparationFactInput[],
  externalClient?: PoolClient,
) {
  const action = async (client: PoolClient) => {
    const pkg = await locked(client, id, expectedRevision);
    if (facts.length > 200)
      throw new AppError(
        422,
        "FACT_LIMIT",
        "Review at most 200 candidates at a time.",
      );
    for (const fact of facts) {
      const feature = pkg.features.find((f) => f.id === fact.entityId);
      if (!feature) notFound("Choose an entity from this preparation.");
      if (!factProperties.includes(fact.property as any))
        throw new AppError(
          422,
          "FACT_PROPERTY",
          "This fact is not supported by the preparation profile.",
        );
      if (
        fact.evidence.some(
          (e) => !pkg.sourceRevisionIds.includes(e.sourceRevisionId),
        )
      )
        throw new AppError(
          422,
          "EVIDENCE_REQUIRED",
          "Attach the cited original to this preparation first.",
        );
      await validateLocators(fact.evidence, [fact.entityId], client);
      if (
        ["space.lower", "space.upper", "building.exteriorHeight"].includes(
          fact.property,
        ) &&
        (!(typeof fact.value === "number" && Number.isFinite(fact.value)) ||
          fact.unit !== "m" ||
          !fact.referenceFrameId)
      )
        throw new AppError(
          422,
          "LEVEL_REFERENCE",
          "Provide metres and the actual named level reference.",
        );
      if (fact.property.endsWith(".geometry"))
        await validateGeometry(fact.value, client, false);
      const candidate = {
        ...fact,
        id: randomUUID(),
        worldStatus: feature.worldStatus,
      };
      pkg.factCandidates.push(candidate);
      // A new conflicting claim never silently replaces a reviewed decision.
      const competing = pkg.factCandidates.filter(
        (c) =>
          c.entityId === fact.entityId &&
          c.subject === fact.subject &&
          c.property === fact.property &&
          c.id !== candidate.id &&
          fingerprint([c.value, c.unit ?? null, c.referenceFrameId ?? null]) !==
            fingerprint([
              fact.value,
              fact.unit ?? null,
              fact.referenceFrameId ?? null,
            ]),
      );
      if (competing.length) {
        pkg.selectedClaimIds = (pkg.selectedClaimIds ?? []).filter(
          (id) => !competing.some((c) => c.id === id),
        );
        pkg.questions.push({
          id: randomUUID(),
          entityId: fact.entityId,
          property: fact.property,
          kind: "conflicting_claims",
          message: `Sources disagree about ${fact.subject ?? feature.name}: ${fact.property.split(".").at(-1)}. Choose the supported claim.`,
          blocks: "dependent detailed geometry",
        });
      }
    }
    await save(client, pkg);
    return pkg;
  };
  return externalClient ? action(externalClient) : transaction(action);
}
async function validateGeometry(
  value: unknown,
  client: PoolClient,
  simple: boolean,
): Promise<Point2[]> {
  let g = value as AreaGeometry;
  if (!g || !["Polygon", "MultiPolygon"].includes(g.type))
    throw new AppError(
      422,
      "GEOMETRY_PROFILE",
      "Choose a polygon outline with declared local metre coordinates.",
    );
  // A one-part MultiPolygon has the same exact outline; retain the original
  // claim and unwrap only this derived representation for the prism builder.
  if (simple && g.type === "MultiPolygon" && g.coordinates.length === 1)
    g = { type: "Polygon", coordinates: g.coordinates[0] };
  if (simple && (g.type !== "Polygon" || g.coordinates.length !== 1))
    throw new AppError(
      422,
      "DETAIL_GEOMETRY_PROFILE",
      "Detailed prism conversion requires one simple outline. Courtyards and multipart originals remain preserved; split into evidenced spaces before preparing.",
    );
  const serialized = JSON.stringify(g);
  if (serialized.length > 500000)
    throw new AppError(
      422,
      "GEOMETRY_LIMIT",
      "Choose a smaller bounded outline.",
    );
  const valid = (
    await client.query(
      "SELECT ST_IsValid(g) AND ST_Area(g)>0.00000001 AND ST_NPoints(g)<=500 AND ST_NDims(g)=2 AND ST_XMax(g)-ST_XMin(g)<50000 AND ST_YMax(g)-ST_YMin(g)<50000 valid FROM (SELECT ST_GeomFromGeoJSON($1) g) s",
      [serialized],
    )
  ).rows[0]?.valid;
  if (!valid)
    throw new AppError(
      422,
      "GEOMETRY_INVALID",
      "The outline must be a valid bounded two-dimensional polygon.",
    );
  if (g.type !== "Polygon") return [];
  const ring = g.coordinates[0] as Point2[];
  const first = ring[0],
    last = ring.at(-1)!;
  return first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}
export async function resolvePreparationFact(
  id: string,
  expectedRevision: number,
  claimId: string,
  reason: string,
) {
  return transaction(async (client) => {
    const pkg = await locked(client, id, expectedRevision),
      fact = pkg.factCandidates.find((c) => c.id === claimId);
    if (!fact) notFound("Candidate not found.");
    pkg.selectedClaimIds = [
      ...(pkg.selectedClaimIds ?? []).filter((id) => {
        const c = pkg.factCandidates.find((c) => c.id === id);
        return (
          c?.entityId !== fact.entityId ||
          c?.subject !== fact.subject ||
          c?.property !== fact.property
        );
      }),
      claimId,
    ];
    pkg.factDecisions = [
      ...(pkg.factDecisions ?? []),
      {
        claimId,
        reason,
        time: new Date().toISOString(),
        actor: "local-operator",
      },
    ];
    for (const q of pkg.questions.filter(
      (q) => q.entityId === fact.entityId && q.property === fact.property,
    ))
      q.answer = { choice: "select_claim", claimId, reason };
    await save(client, pkg);
    return pkg;
  });
}
export async function preparationRequirements(
  id: string,
): Promise<PreparationRequirements> {
  const p = await getPackage(id),
    selected = p.factCandidates.filter((f) =>
      p.selectedClaimIds?.includes(f.id),
    );
  const prep = (
    await query("SELECT body FROM building_preparations WHERE package_id=$1", [
      id,
    ])
  ).rows[0]?.body as PreparationCase | undefined;
  const subjects = [
    ...new Set(
      selected
        .filter((c) => c.property.startsWith("space."))
        .map((c) => c.subject ?? "space"),
    ),
  ];
  const detailedSpaces: string[] = [];
  if (!subjects.length)
    detailedSpaces.push(
      "Supply a plan outline and a section or level schedule for at least one space.",
    );
  for (const s of subjects)
    for (const prop of ["geometry", "lower", "upper", "levelLabel"])
      if (
        !selected.some((c) => c.subject === s && c.property === `space.${prop}`)
      )
        detailedSpaces.push(
          `${s}: review its ${prop === "geometry" ? "plan outline" : prop === "levelLabel" ? "floor label" : prop + " level"}.`,
        );
  return {
    footprint: p.features.length ? [] : ["Supply a footprint."],
    exterior: p.features.some((f) => f.height.value !== null)
      ? []
      : ["Supply a supported building height."],
    detailedSpaces,
    placement:
      prep?.placement.status === "reviewed"
        ? []
        : [
            "Confirm the plan coordinate frame and vertical reference with source control evidence.",
          ],
    utility: p.features.some((f) => f.utilityProfile)
      ? []
      : [
          "Supply an alignment, cross section and compatible levels to construct a utility.",
        ],
  };
}
export async function setPreparationPlacement(
  id: string,
  expectedRevision: number,
  input: {
    sourceFrame: string;
    verticalReference: string;
    sourceVerticalReference?: string;
    verticalOffset: number;
    controlPoints?: { source: Point2; target: Point2 }[];
    evidence: SourceLocator[];
    reason: string;
  },
) {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    const initial = (
      await client.query(
        "SELECT body FROM building_preparations WHERE package_id=$1",
        [id],
      )
    ).rows[0]?.body as PreparationCase | undefined;
    if (!initial) notFound();
    const site = (
      await client.query(
        "SELECT s.* FROM registry_sites s JOIN map_areas a ON a.site_id=s.id WHERE a.id=$1 FOR UPDATE OF s",
        [initial.areaId],
      )
    ).rows[0];
    const packageRow = (
      await client.query(
        "SELECT body FROM import_packages WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    const pkg = await locked(client, id, packageRow.body.revision);
    await client.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [
      initial.caseId,
    ]);
    const row =
        (
          await client.query(
            "SELECT * FROM building_preparations WHERE package_id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0] ?? notFound(),
      prep = row.body as PreparationCase;
    if (prep.revision !== expectedRevision) conflict();
    await validateLocators(input.evidence, [prep.buildingId], client);
    // Shared registry cannot acquire a different benchmark by renaming a frame.
    if (
      input.verticalReference !== site.frame.benchmark &&
      /not aligned|unknown|unresolved/i.test(site.frame.benchmark)
    ) {
      const existing = (
        await client.query(
          "SELECT 1 FROM registry_records WHERE site_id=$1 AND revision>0 LIMIT 1",
          [site.id],
        )
      ).rows[0];
      if (existing)
        throw new AppError(
          422,
          "EXISTING_DATUM",
          "Existing detailed records require an explicit supported datum migration.",
        );
      // This establishes the previously empty detailed registry reference. It
      // does not transform or relabel any physical observation or its source.
      site.frame = { ...site.frame, benchmark: input.verticalReference };
      await client.query("UPDATE registry_sites SET frame=$2 WHERE id=$1", [
        site.id,
        site.frame,
      ]);
      await client.query("UPDATE cases SET frame=$2 WHERE id=$1", [
        prep.caseId,
        site.frame,
      ]);
    }
    if (input.verticalReference !== site.frame.benchmark)
      throw new AppError(
        422,
        "VERTICAL_TRANSFORM_REQUIRED",
        `Supply levels transformed to the existing reference (${site.frame.benchmark}) with the documented offset. A different datum cannot be renamed.`,
      );
    await client.query("UPDATE cases SET frame=$2 WHERE id=$1", [
      prep.caseId,
      site.frame,
    ]);
    let matrix: [number, number, number, number, number, number] = [
      1, 0, 0, 1, 0, 0,
    ];
    let method: "canonical_area" | "control_points_similarity" =
      "canonical_area";
    if (input.sourceFrame !== site.frame.id) {
      const p = input.controlPoints;
      if (!p || p.length !== 2)
        throw new AppError(
          422,
          "CONTROL_REQUIRED",
          "Two source and target control points are required to place a local drawing.",
        );
      const dx = p[1].source[0] - p[0].source[0],
        dy = p[1].source[1] - p[0].source[1],
        tx = p[1].target[0] - p[0].target[0],
        ty = p[1].target[1] - p[0].target[1],
        den = dx * dx + dy * dy;
      if (den < 1e-8)
        throw new AppError(
          422,
          "CONTROL_REQUIRED",
          "Choose two distinct control points.",
        );
      const a = (dx * tx + dy * ty) / den,
        b = (dx * ty - dy * tx) / den;
      if (Math.hypot(a, b) < 0.001 || Math.hypot(a, b) > 1000)
        throw new AppError(
          422,
          "CONTROL_SCALE",
          "The control scale is outside the supported range.",
        );
      matrix = [
        a,
        b,
        -b,
        a,
        p[0].target[0] - a * p[0].source[0] + b * p[0].source[1],
        p[0].target[1] - b * p[0].source[0] - a * p[0].source[1],
      ];
      method = "control_points_similarity";
    }
    prep.revision++;
    prep.placement = {
      ...prep.placement,
      revision: prep.placement.revision + 1,
      sourceFrame: input.sourceFrame,
      targetFrame: site.frame.id,
      method,
      matrix,
      verticalReference: input.verticalReference,
      sourceVerticalReference:
        input.sourceVerticalReference ?? input.verticalReference,
      verticalOffset: input.verticalOffset,
      evidence: input.evidence,
      controlPoints: input.controlPoints,
      status: "reviewed",
    };
    await client.query(
      "UPDATE building_preparations SET revision=$2,body=$3 WHERE id=$1",
      [prep.id, prep.revision, prep],
    );
    await client.query(
      "INSERT INTO building_preparation_revisions(preparation_id,revision,body) VALUES($1,$2,$3)",
      [prep.id, prep.revision, prep],
    );
    pkg.warnings.push(`Placement reviewed: ${input.reason}`);
    await save(client, pkg);
    await client.query(
      "UPDATE cases SET revision=revision+1,current_snapshot_id=NULL WHERE id=$1",
      [prep.caseId],
    );
    return prep;
  });
}
export async function prepareDetails(id: string, expectedRevision: number) {
  const prepRow = (
    await query("SELECT body FROM building_preparations WHERE package_id=$1", [
      id,
    ])
  ).rows[0];
  if (!prepRow) notFound("Open this building’s preparation first.");
  const operationKey = `${id}:${expectedRevision}`;
  const retry = (
    await query(
      "SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='canonical.prepare'",
      [prepRow.body.caseId, operationKey],
    )
  ).rows[0]?.result;
  const pkg = await getPackage(id);
  if (retry && retry.packageRevision !== pkg.revision)
    conflict("The source facts or placement changed. Build the current preparation.");
  // Reloads submit the post-derivative revision. Reuse that retained derivative,
  // including failed-job retries, instead of adding another case/source revision.
  const continuation = await preparationContinuation(id);
  if (retry && continuation.status === "needs_build")
    conflict("The prepared geometry or exterior changed. Build the current preparation.");
  if (retry || (pkg.revision === expectedRevision && continuation.status !== "needs_build")) {
    const job = await requestBuild(prepRow.body.caseId, retry?.caseRevision ?? continuation.caseRevision);
    return {
      caseId: prepRow.body.caseId,
      package: await getPackage(id),
      job,
      preparation: prepRow.body,
      cached: true,
    };
  }
  if (pkg.revision !== expectedRevision) conflict();
  const requirements = await preparationRequirements(id);
  if (requirements.detailedSpaces.length || requirements.placement.length)
    throw new AppError(
      422,
      "MISSING_DETAIL_EVIDENCE",
      [...requirements.detailedSpaces, ...requirements.placement].join(" "),
      requirements,
    );
  const prep = (
    await query("SELECT body FROM building_preparations WHERE package_id=$1", [
      id,
    ])
  ).rows[0]?.body as PreparationCase;
  const selected = pkg.factCandidates.filter((c) =>
      pkg.selectedClaimIds?.includes(c.id),
    ),
    subjects = [
      ...new Set(
        selected
          .filter((c) => c.property === "space.geometry")
          .map((c) => c.subject!),
      ),
    ];
  const derived = {
    schemaVersion: "canonical-detail-derivative/1",
    packageId: id,
    packageRevision: pkg.revision,
    placement: prep.placement,
    selected,
    originals: pkg.sourceRevisionIds,
  };
  const bytes = Buffer.from(JSON.stringify(derived)),
    hash = sha256(bytes),
    sourceId = randomUUID(),
    key = `derivatives/${sourceId}/${hash}`;
  return originalAttempt("sources", sourceId, async (remember) => {
    remember(key);
    await putOriginal(key, bytes, "application/json");
    await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
      );
      const current = await locked(client, id, expectedRevision);
      await client.query("SELECT id FROM cases WHERE id=$1 FOR UPDATE", [
        prep.caseId,
      ]);
      const p = (
        await client.query(
          "SELECT body FROM building_preparations WHERE id=$1 FOR UPDATE",
          [prep.id],
        )
      ).rows[0].body as PreparationCase;
      if (p.revision !== prep.revision)
        conflict("Placement changed. Review the current transform.");
      const currentFeature = (
        await client.query(
          "SELECT revision FROM physical_features WHERE id=$1",
          [prep.buildingId],
        )
      ).rows[0];
      if (currentFeature.revision !== prep.buildingRevision)
        conflict(
          "The recorded exterior changed. Rebase this preparation before building details.",
        );
      const caseRow = (
          await client.query("SELECT frame FROM cases WHERE id=$1", [
            prep.caseId,
          ])
        ).rows[0],
        frame = caseRow.frame;
      const building = current.features.find((f) => f.id === prep.buildingId)!;
      const footprint = await validateGeometry(building.geometry, client, true);
      const features: any[] = [
        { alias: "property", name: building.name, kind: "building", footprint },
      ];
      const levels: any[] = [];
      const units: UnitSpec[] = [];
      for (const subject of subjects) {
        const facts = selected.filter((c) => c.subject === subject),
          fact = (property: string) =>
            facts.find((c) => c.property === `space.${property}`)!;
        const geometry = fact("geometry");
        if (geometry.referenceFrameId !== prep.placement.sourceFrame)
          throw new AppError(
            422,
            "PLAN_FRAME",
            "The selected outline and placement use different source coordinate frames.",
          );
        let ring = await validateGeometry(geometry.value, client, true);
        const [a, b, c, d, e, f] = prep.placement.matrix;
        ring = ring.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
        const lo = fact("lower"),
          hi = fact("upper");
        if (
          lo.referenceFrameId !==
            (prep.placement.sourceVerticalReference ??
              prep.placement.verticalReference) ||
          hi.referenceFrameId !==
            (prep.placement.sourceVerticalReference ??
              prep.placement.verticalReference)
        )
          throw new AppError(
            422,
            "LEVEL_REFERENCE",
            "The chosen levels do not use the reviewed vertical reference.",
          );
        const lower = Number(lo.value) + prep.placement.verticalOffset!,
          upper = Number(hi.value) + prep.placement.verticalOffset!;
        if (upper <= lower)
          throw new AppError(
            422,
            "LEVEL_RANGE",
            "Upper level must exceed lower level.",
          );
        const label = String(fact("levelLabel").value),
          alias = subject,
          previous = (
            await client.query(
              "SELECT id,revision FROM units WHERE case_id=$1 AND alias=$2",
              [prep.caseId, alias],
            )
          ).rows[0];
        const locator = `canonical space ${subject}`;
        levels.push({
          alias,
          lower,
          upper,
          benchmark: frame.benchmark,
          unit: "m",
          method: "reviewed source claims and explicit placement",
          locator,
        });
        const unit: UnitSpec = {
          id: previous?.id ?? randomUUID(),
          alias,
          name: String(
            facts.find((c) => c.property === "space.label")?.value ?? subject,
          ),
          kind: "unit",
          footprint: ring,
          lower,
          upper,
          lowerVerified: true,
          upperVerified: true,
          bindings: {
            footprint: { sourceId, locator },
            lower: { sourceId, locator },
            upper: { sourceId, locator },
            alignment: { sourceId, locator: "reviewed placement controls" },
          },
          revision: (previous?.revision ?? 0) + 1,
          levelLabel: `property / ${label}`,
        };
        units.push(unit);
        features.push({
          alias,
          name: unit.name,
          kind: unit.kind,
          footprint: ring,
          levelLabel: unit.levelLabel,
        });
      }
      const prior = (
          await client.query(
            "SELECT family_id,revision FROM sources WHERE case_id=$1 AND profile='canonical-detail-v1' ORDER BY revision DESC LIMIT 1",
            [prep.caseId],
          )
        ).rows[0],
        familyId = prior?.family_id ?? randomUUID();
      await client.query(
        "INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection) VALUES($1,$2,$3,$4,$5,'canonical-detail-v1','application/json',$6,$7,$8,'ready',$9)",
        [
          sourceId,
          prep.caseId,
          familyId,
          (prior?.revision ?? 0) + 1,
          `${building.name} · reviewed detail derivative`,
          bytes.length,
          hash,
          key,
          {
            profile: "parcel-local-json-v1",
            status: "ready",
            issues: [],
            summary:
              "Deterministic derivative of selected source claims; original evidence is preserved.",
            frame,
            features,
            levels,
            lineage: derived,
          },
        ],
      );
      for (const unit of units) await persistUnit(client, prep.caseId, unit);
      // Omitted existing spaces are retained, never deleted by a partial preparation.
      const context = [
        {
          alias: "property",
          name: building.name,
          kind: "building",
          footprint,
          evidence: { sourceId, locator: "feature property" },
        },
      ];
      await client.query(
        "UPDATE cases SET context=$2,revision=revision+1,current_snapshot_id=NULL,updated_at=now() WHERE id=$1",
        [prep.caseId, JSON.stringify(context)],
      );
      await client.query(
        "INSERT INTO registry_case_feature_mappings(case_id,site_id,feature_key,record_id) SELECT $1,site_id,$2,$3 FROM cases WHERE id=$1 ON CONFLICT(case_id,site_id,feature_key) DO NOTHING",
        [
          prep.caseId,
          JSON.stringify(["context", familyId, "building", "property"]),
          prep.buildingId,
        ],
      );
      current.sourceRevisionIds.push(sourceId);
      current.warnings.push(
        "Detailed build inputs prepared from reviewed canonical claims. Publication still requires the existing registry review.",
      );
      await save(client, current);
      const preparedCase = (
        await client.query("SELECT revision FROM cases WHERE id=$1", [
          prep.caseId,
        ])
      ).rows[0];
      await client.query(
        "INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'canonical.prepare',$3,$4)",
        [
          prep.caseId,
          operationKey,
          hash,
          {
            caseId: prep.caseId,
            caseRevision: preparedCase.revision,
            sourceId,
            packageRevision: current.revision,
          },
        ],
      );
    });
    const detail = await getCase(prep.caseId),
      job = await requestBuild(prep.caseId, detail.case.revision);
    return {
      caseId: prep.caseId,
      package: await getPackage(id),
      job,
      preparation: prep,
    };
  });
}

import { randomUUID } from "node:crypto";
import type {
  Investigation,
  SourceLocator,
  BuildingDossier,
  AreaGeometry,
} from "@ulpin/contracts";
import { query, transaction } from "./db";
import { buildingDossier, dossierSources, validateLocators } from "./officer";
import { currentAreaCheckFingerprint } from "./areas";
import { AppError, conflict, notFound } from "./errors";
import { fingerprint } from "./domain";

const now = () => new Date().toISOString();
export async function getInvestigation(id: string): Promise<Investigation> {
  return (
    (await query("SELECT body FROM officer_investigations WHERE id=$1", [id]))
      .rows[0]?.body ?? notFound("Investigation not found.")
  );
}
async function persist(client: any, item: Investigation) {
  await client.query(
    "UPDATE officer_investigations SET revision=$2,body=$3 WHERE id=$1",
    [item.id, item.revision, item],
  );
  await client.query(
    "INSERT INTO officer_investigation_revisions(investigation_id,revision,body) VALUES($1,$2,$3)",
    [item.id, item.revision, item],
  );
}
export async function createInvestigation(input: {
  buildingId: string;
  expectedRevision: number;
  requestKey?: string;
  reference: string;
  classification: string;
  checkId?: string;
  findingIds?: string[];
  notes?: string;
}) {
  const d = await buildingDossier(input.buildingId);
  if (d.building.revision !== input.expectedRevision) conflict();
  const check = input.checkId
    ? (
        await query(
          "SELECT body FROM area_check_runs WHERE id=$1 AND area_id=$2",
          [input.checkId, d.area.id],
        )
      ).rows[0]?.body
    : null;
  if (input.checkId && (!check || check.status !== "completed"))
    throw new AppError(
      422,
      "CHECK_REQUIRED",
      "Choose a completed check for this block.",
    );
  const findings =
    check?.findings.filter(
      (f: any) =>
        f.featureIds.includes(input.buildingId) &&
        (input.findingIds?.includes(f.id) ?? true),
    ) ?? [];
  const key = input.requestKey ?? randomUUID();
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `investigation:${key}`,
    ]);
    const retry = (
      await client.query(
        "SELECT body FROM officer_investigations WHERE request_key=$1",
        [key],
      )
    ).rows[0];
    if (retry) {
      if (retry.body.buildingId !== input.buildingId)
        conflict("This request key belongs to another property.");
      return retry.body as Investigation;
    }
    const fresh = await buildingDossier(input.buildingId);
    if (
      fingerprint({
        building: fresh.building,
        associations: fresh.associations,
        records: fresh.records,
        areaRevision: fresh.area.revision,
      }) !==
      fingerprint({
        building: d.building,
        associations: d.associations,
        records: d.records,
        areaRevision: d.area.revision,
      })
    )
      conflict(
        "Property inputs changed while the investigation was opening. Refresh and retry.",
      );
    if (
      check &&
      (check.areaRevision !== d.area.revision ||
        check.inputFingerprint !==
          (await currentAreaCheckFingerprint(d.area.id)))
    )
      conflict(
        "This check is stale. Run a fresh area check before opening an investigation.",
      );
    const time = now(),
      i: Investigation = {
        id: randomUUID(),
        revision: 1,
        buildingId: d.building.id,
        areaId: d.area.id,
        reference: input.reference,
        status: "OPEN",
        classification: input.classification,
        notes: input.notes ?? "",
        nextAction: "Inspect supporting evidence.",
        inputSnapshot: {
          areaRevision: d.area.revision,
          featureRevision: d.building.revision,
          checkId: input.checkId,
          fingerprint: fingerprint({
            building: d.building,
            associations: d.associations,
            records: d.records,
            check: check?.inputFingerprint,
          }),
        },
        registerSnapshot: {
          building: d.building,
          area: d.area,
          records: d.records,
          detailedScene: d.detailedScene,
          sources: d.sources,
          associations: d.associations,
          parcels: d.parcels,
          missing: d.missing,
        },
        findings,
        evidence: [
          ...d.building.evidence,
          ...findings.flatMap((f: any) => f.evidence ?? []),
        ],
        requests: [],
        history: [
          {
            actor: "local-operator",
            time,
            reason: "Investigation opened.",
            status: "OPEN",
          },
        ],
        createdAt: time,
        updatedAt: time,
      };
    await client.query(
      "INSERT INTO officer_investigations(id,building_id,area_id,request_key,revision,body) VALUES($1,$2,$3,$4,1,$5)",
      [i.id, i.buildingId, i.areaId, key, i],
    );
    await client.query(
      "INSERT INTO officer_investigation_revisions(investigation_id,revision,body) VALUES($1,1,$2)",
      [i.id, i],
    );
    return i;
  });
}
export async function updateInvestigation(
  id: string,
  expectedRevision: number,
  input: {
    status?: Investigation["status"];
    notes?: string;
    nextAction?: string;
    reason: string;
    question?: string;
    requestId?: string;
    response?: string;
    evidence?: SourceLocator[];
  },
) {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))",
    );
    const i: Investigation =
      (
        await client.query(
          "SELECT body FROM officer_investigations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0]?.body ?? notFound();
    if (i.revision !== expectedRevision) conflict();
    if (input.question) {
      i.requests.push({
        id: randomUUID(),
        question: input.question,
        status: "OPEN",
        evidence: [],
        createdAt: now(),
      });
      i.status = "NEEDS_EVIDENCE";
    }
    if (input.requestId) {
      const r = i.requests.find((r) => r.id === input.requestId);
      if (!r) notFound("Request not found.");
      if (!input.response)
        throw new AppError(
          422,
          "RESPONSE_REQUIRED",
          "Describe the supplied information.",
        );
      if (input.evidence?.length)
        await validateLocators(input.evidence, [i.buildingId], client);
      r.status = "ANSWERED";
      r.response = input.response;
      r.evidence = input.evidence ?? [];
      r.answeredAt = now();
    }
    const transitions: Record<
      Investigation["status"],
      Investigation["status"][]
    > = {
      OPEN: ["NEEDS_EVIDENCE", "READY_FOR_REVIEW"],
      NEEDS_EVIDENCE: ["OPEN", "READY_FOR_REVIEW"],
      READY_FOR_REVIEW: ["OPEN", "NEEDS_EVIDENCE", "REVIEWED"],
      REVIEWED: ["OPEN", "CLOSED"],
      CLOSED: ["OPEN"],
    };
    if (input.status && input.status !== i.status) {
      if (!transitions[i.status].includes(input.status))
        throw new AppError(
          422,
          "STATUS_TRANSITION",
          "Complete the preceding review step or reopen the investigation.",
        );
      if (
        ["READY_FOR_REVIEW", "REVIEWED", "CLOSED"].includes(input.status) &&
        i.requests.some((r) => r.status === "OPEN")
      )
        throw new AppError(
          422,
          "EVIDENCE_PENDING",
          "Resolve the pending requests before completing review.",
        );
      const d = await buildingDossier(i.buildingId),
        check = i.inputSnapshot.checkId
          ? (
              await client.query(
                "SELECT body FROM area_check_runs WHERE id=$1",
                [i.inputSnapshot.checkId],
              )
            ).rows[0]?.body
          : null;
      if (
        ["READY_FOR_REVIEW", "REVIEWED", "CLOSED"].includes(input.status) &&
        (d.area.revision !== i.inputSnapshot.areaRevision ||
          (check &&
            check.inputFingerprint !==
              (await currentAreaCheckFingerprint(d.area.id))) ||
          fingerprint({
            building: d.building,
            associations: d.associations,
            records: d.records,
            check: check?.inputFingerprint,
          }) !== i.inputSnapshot.fingerprint)
      )
        conflict(
          "The investigated inputs have changed. Open a new investigation on the current check; this snapshot remains preserved.",
        );
      i.status = input.status;
    }
    if (input.notes !== undefined) i.notes = input.notes;
    if (input.nextAction !== undefined) i.nextAction = input.nextAction;
    i.revision++;
    i.updatedAt = now();
    i.history.push({
      actor: "local-operator",
      time: i.updatedAt,
      reason: input.reason,
      status: i.status,
    });
    await persist(client, i);
    return i;
  });
}
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const csv = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
function sanitizedDossier(d: BuildingDossier) {
  return {
    property: {
      id: d.building.id,
      identifier: d.building.identifier,
      name: d.building.name,
      revision: d.building.revision,
      geometryRole:
        d.building.geometryRole ??
        d.building.semantics?.geometryRole ??
        "unknown",
      worldStatus: d.building.worldStatus,
      geometry: d.building.geometry,
      geographicGeometry: d.building.geographicGeometry,
      height: d.building.height,
    },
    area: d.area,
    associations: d.associations,
    register: d.records.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      name: r.name,
      kind: r.kind,
      revision: r.revision,
      use: r.use,
      footprint: r.footprint,
      geometry: r.geometry,
      links: r.links,
      evidence: r.evidence,
    })),
    sources: d.sources,
    missing: d.missing,
  };
}
function snapshotSvg(d: BuildingDossier, i?: Investigation) {
  const g = [
    { geometry: d.building.geometry, color: "#526b65" },
    ...d.parcels.map((p) => ({
      geometry: p.feature.geometry,
      color: "#658dbe",
    })),
    ...(i?.findings ?? [])
      .filter((f) => f.geometry)
      .map((f) => ({ geometry: f.geometry!, color: "#bd573b" })),
  ];
  const points: number[][] = [];
  function visit(v: any) {
    if (Array.isArray(v) && typeof v[0] === "number") points.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
  }
  function collect(geometry: AreaGeometry) {
    if (geometry.type === "GeometryCollection")
      geometry.geometries.forEach(collect);
    else visit(geometry.coordinates);
  }
  g.forEach((x) => collect(x.geometry));
  if (!points.length) return "";
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    minX = Math.min(...xs) - 3,
    minY = Math.min(...ys) - 3,
    w = Math.max(...xs) - minX + 3,
    h = Math.max(...ys) - minY + 3;
  function path(geometry: AreaGeometry): string {
    const polygon = (rings: number[][][]) =>
      rings
        .map((r) => "M" + r.map((p) => `${p[0]},${-p[1]}`).join("L") + "Z")
        .join("");
    const line = (points: number[][]) =>
      "M" + points.map((p) => `${p[0]},${-p[1]}`).join("L");
    return geometry.type === "GeometryCollection"
      ? geometry.geometries.map(path).join("")
      : geometry.type === "LineString"
        ? line(geometry.coordinates)
        : geometry.type === "MultiLineString"
          ? geometry.coordinates.map(line).join("")
          : geometry.type === "Polygon"
            ? polygon(geometry.coordinates)
            : geometry.type === "MultiPolygon"
              ? geometry.coordinates.map(polygon).join("")
              : "";
  }
  return `<svg role="img" aria-label="Source geometry and exact discrepancy plan" viewBox="${minX} ${-minY - h} ${w} ${h}" style="width:100%;height:300px;background:#eeece4">${g.map((x) => `<path d="${path(x.geometry)}" fill="${x.color}" fill-opacity=".24" fill-rule="evenodd" stroke="${x.color}" stroke-width="${Math.min(w, h) / 220}"/>`).join("")}</svg>`;
}
function sectionSnapshot(d: BuildingDossier) {
  const scene = d.detailedScene.filter(
    (s) =>
      s.record.kind === "space" &&
      s.localGeometry &&
      Number.isFinite(s.lower) &&
      Number.isFinite(s.upper) &&
      s.verticalReference,
  );
  if (!scene.length)
    return "<p>No source-backed detailed section is available in this snapshot.</p>";
  const rings = (g: AreaGeometry): number[][][][] =>
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? g.coordinates
        : [];
  const all = scene.flatMap((s) => rings(s.localGeometry!).flat(2));
  if (!all.length) return "";
  const cutY =
    (Math.min(...all.map((p) => p[1])) + Math.max(...all.map((p) => p[1]))) / 2;
  const references = [...new Set(scene.map((s) => s.verticalReference!))];
  return references
    .map((reference) => {
      const strips = scene
        .filter((s) => s.verticalReference === reference)
        .flatMap((s) =>
          rings(s.localGeometry!).flatMap((polygon) => {
            const intersections: number[] = [];
            for (const ring of polygon)
              for (let j = 0; j < ring.length; j++) {
                const a = ring[j],
                  b = ring[(j + 1) % ring.length];
                if (
                  (a[1] <= cutY && b[1] > cutY) ||
                  (b[1] <= cutY && a[1] > cutY)
                )
                  intersections.push(
                    a[0] + ((cutY - a[1]) * (b[0] - a[0])) / (b[1] - a[1]),
                  );
              }
            intersections.sort((a, b) => a - b);
            const result: {
              x: number;
              width: number;
              lower: number;
              upper: number;
              label: string;
            }[] = [];
            for (let j = 0; j + 1 < intersections.length; j += 2) {
              const width = intersections[j + 1] - intersections[j];
              if (width > 1e-8)
                result.push({
                  x: intersections[j],
                  width,
                  lower: s.lower!,
                  upper: s.upper!,
                  label: `${s.record.name}: ${s.lower}–${s.upper} m`,
                });
            }
            return result;
          }),
        );
      if (!strips.length)
        return `<p>The saved section line does not cross a detailed space in ${escape(reference)}.</p>`;
      const x = Math.min(...strips.map((s) => s.x)) - 1;
      const z = Math.max(...strips.map((s) => s.upper)) + 1;
      const width = Math.max(...strips.map((s) => s.x + s.width)) - x + 1;
      const height = z - Math.min(...strips.map((s) => s.lower)) + 1;
      return `<svg role="img" aria-label="Source-backed detailed section" viewBox="${x} ${-z} ${width} ${height}" style="width:100%;height:240px;background:#f1efe8">${strips.map((s) => `<rect x="${s.x}" y="${-s.upper}" width="${s.width}" height="${s.upper - s.lower}" fill="#658dbe" fill-opacity=".3" stroke="#355b54" stroke-width="${Math.min(width, height) / 150}"><title>${escape(s.label)}</title></rect>`).join("")}</svg><p>East–west cut at local northing ${cutY.toFixed(2)} m. Levels in metres relative to ${escape(reference)}. Both axes use the same scale; separate references are never aligned by assumption.</p>`;
    })
    .join("");
}
export async function exportRegister(
  buildingId: string,
  format: string,
  investigationId?: string,
) {
  const current = await buildingDossier(buildingId),
    i = investigationId ? await getInvestigation(investigationId) : undefined;
  const d = i?.registerSnapshot
    ? {
        ...current,
        ...i.registerSnapshot,
        detailedScene: i.registerSnapshot.detailedScene ?? [],
      }
    : current;
  if (i && i.buildingId !== buildingId) notFound();
  // Older snapshots may cite a parcel/finding original without duplicating its
  // metadata in sources. Resolve those immutable revision IDs, never current
  // participant geometry, so the exported evidence set remains complete.
  const relatedEvidence = [
    ...d.associations.flatMap((a) => a.evidence),
    ...d.parcels.flatMap((p) => p.feature.evidence),
    ...(i?.findings ?? []).flatMap((f) => f.evidence ?? []),
  ];
  const relatedSources = await dossierSources(
    [
      ...relatedEvidence.map((e) => e.sourceRevisionId),
      ...d.parcels.map((p) => p.feature.sourceRevisionId),
    ],
    relatedEvidence,
  );
  d.sources = [
    ...new Map(
      [...d.sources, ...relatedSources].map((s) => [s.id, s]),
    ).values(),
  ];
  const data = {
    schemaVersion: "ulpin-officer-export/1",
    exportedAt: now(),
    ...sanitizedDossier(d),
    // The sanitized register above is the exact saved snapshot. Do not export
    // a second raw copy containing unrelated rights/party fields.
    investigation: i ? { ...i, registerSnapshot: undefined } : undefined,
    scope:
      "Local technical investigation; no official title, certificate or legal order. Sources remain immutable; unresolved conditions are retained.",
  };
  if (format === "json")
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="property-register.json"',
        "Cache-Control": "no-store",
      },
    });
  if (format === "csv") {
    const rows = [
      [
        "record_type",
        "permanent_id",
        "name_or_issue",
        "revision",
        "area_m2",
        "volume_m3",
        "source_locators",
        "status_or_missing",
      ],
      [
        "building",
        d.building.identifier,
        d.building.name,
        d.building.revision,
        d.building.areaM2,
        "",
        JSON.stringify(d.building.evidence),
        d.missing.join("; "),
      ],
      ...data.register.map((r) => [
        r.kind,
        r.identifier,
        r.name,
        r.revision,
        r.geometry?.area ?? "",
        r.geometry?.volume ?? "",
        JSON.stringify(r.evidence),
        "recorded",
      ]),
      ...(i?.findings ?? []).map((f) => [
        "discrepancy",
        f.id,
        f.code,
        i?.revision,
        f.areaM2 ?? "",
        f.volumeM3 ?? "",
        JSON.stringify(f.evidence ?? []),
        f.message,
      ]),
      ...(i?.requests ?? []).map((r) => [
        "request",
        r.id,
        r.question,
        "",
        "",
        "",
        JSON.stringify(r.evidence),
        r.status,
      ]),
    ];
    return new Response(rows.map((r) => r.map(csv).join(",")).join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="property-register.csv"',
        "Cache-Control": "no-store",
      },
    });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(d.building.name)} · property register</title><style>body{font:16px system-ui;color:#262822;max-width:1000px;margin:40px auto;padding:0 24px;line-height:1.5}h1{font:40px Georgia}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{text-align:left;border-bottom:1px solid #ccc;padding:10px}small{color:#555}a{color:#355b54}button{padding:10px}@media print{button{display:none}body{margin:0}} </style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>${escape(d.building.name)}</h1><p>${escape(d.building.identifier)} · revision ${d.building.revision}</p><p>${escape(i?.reference ?? "Property register")} ${escape(i?.status ?? "")}</p>${snapshotSvg(d, i)}<small>Plan in ${escape(d.area.reference?.analysisCrs)} local metres. Blue: parcel; green: property; orange: computed discrepancy. Geometry is tied to the cited revisions.</small><h2>Section</h2>${sectionSnapshot(d)}<h2>Building, floor and unit register</h2>${data.register.length ? `<table><tr><th>ID</th><th>Record</th><th>Level range</th></tr>${data.register.map((r) => `<tr><td>${escape(r.identifier)}</td><td>${escape(r.name)}</td><td>${r.geometry ? escape(`${r.geometry.lower}–${r.geometry.upper} m`) : "—"}</td></tr>`).join("")}</table>` : "<p>No detailed spaces have been recorded.</p>"}<h2>Discrepancies and conditions</h2>${(i?.findings ?? []).map((f) => `<p><b>${escape(f.code)}</b> ${escape(f.message)} ${f.areaM2 !== undefined ? escape(`${f.areaM2} m²`) : ""} ${f.volumeM3 !== undefined ? escape(`${f.volumeM3} m³`) : ""}</p>`).join("") || "<p>No discrepancy is included in this export.</p>"}${d.missing.map((m) => `<p>${escape(m)}</p>`).join("")}${(i?.requests ?? []).map((r) => `<p><b>${escape(r.status)}</b> ${escape(r.question)} ${escape(r.response)}</p>`).join("")}<h2>Evidence</h2>${d.sources.map((s) => `<p><a href="${escape(s.url)}">${escape(s.name)}</a> · revision ${s.revision} · ${escape(s.createdAt)}<br><small>SHA-256 ${escape(s.sha256)}</small></p>`).join("")}<h2>Decision record</h2><p>${escape(i?.notes)} ${escape(i?.nextAction)}</p>${(i?.history ?? []).map((h) => `<p>${escape(h.time)} · ${escape(h.status)} · ${escape(h.reason)}</p>`).join("")}<p><small>${escape(data.scope)}</small></p></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:",
    },
  });
}

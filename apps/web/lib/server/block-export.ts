import type {
  DossierSource,
  PhysicalFeature,
  AreaGeometry,
} from "@ulpin/contracts";
import { areaContext, getArea } from "./areas";
import { query } from "./db";
import { AppError, conflict } from "./errors";
import { dossierSources } from "./officer";
import { exportRegister } from "./officer-investigations";
import { registerPdf } from "./register-pdf";
import { sourceBundle } from "./source-bundle";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function plan(features: PhysicalFeature[]) {
  const points: number[][] = [];
  const path = (g: AreaGeometry): string => {
    if (g.type === "GeometryCollection")
      return g.geometries.map(path).join(" ");
    if (g.type === "Polygon")
      return g.coordinates
        .map((r) => {
          points.push(...r);
          return "M" + r.map((p) => `${p[0]},${-p[1]}`).join("L") + "Z";
        })
        .join(" ");
    if (g.type === "MultiPolygon")
      return g.coordinates
        .map((coordinates) => path({ type: "Polygon", coordinates }))
        .join(" ");
    if (g.type === "LineString") {
      points.push(...g.coordinates);
      return "M" + g.coordinates.map((p) => `${p[0]},${-p[1]}`).join("L");
    }
    if (g.type === "MultiLineString")
      return g.coordinates
        .map((coordinates) => path({ type: "LineString", coordinates }))
        .join(" ");
    return "";
  };
  const shapes = features.map((f) => ({ f, d: path(f.geometry) }));
  if (!points.length) return "";
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - 3,
    y = Math.max(...ys) + 3,
    w = Math.max(...xs) - x + 3,
    h = y - Math.min(...ys) + 3;
  return `<svg viewBox="${x} ${-y} ${w} ${h}" style="width:100%;height:310px;background:#f3f4ef">${shapes.map(({ f, d }) => `<path d="${d}" fill="${f.kind === "building" ? "#779a89" : f.kind === "road" ? "#b7beb6" : "none"}" fill-rule="evenodd" stroke="${f.kind === "parcel" ? "#9b8648" : "#416357"}" stroke-width=".25"/>`).join("")}</svg>`;
}
export async function exportBlock(
  areaId: string,
  format: "json" | "pdf" | "zip",
) {
  const context = await areaContext(areaId);
  const site = (
    await query("SELECT identifier,revision FROM registry_sites WHERE id=$1", [
      context.area.siteId,
    ])
  ).rows[0];
  const buildings = context.features.filter((f) => f.kind === "building");
  if (buildings.length > 250)
    throw new AppError(
      413,
      "EXPORT_SCOPE_LIMIT",
      "This report is limited to 250 buildings. Select a smaller saved block; geographic geometry remains available from Export.",
    );
  const properties = [];
  for (const building of buildings) {
    const response = await exportRegister(building.id, "json");
    properties.push(await response.json());
  }
  const extra = await dossierSources(
    [
      ...new Set([
        ...context.features.map((f) => f.sourceRevisionId),
        ...context.packages.flatMap((p) => p.sourceRevisionIds),
      ]),
    ],
    context.features.flatMap((f) => f.evidence),
  );
  const sources: DossierSource[] = [
    ...new Map(
      [...extra, ...properties.flatMap((p) => p.sources)].map(
        (s: DossierSource) => [s.id, s],
      ),
    ).values(),
  ];
  if (
    (await getArea(areaId)).revision !== context.area.revision ||
    (
      await query("SELECT revision FROM registry_sites WHERE id=$1", [
        context.area.siteId,
      ])
    ).rows[0].revision !== site.revision
  )
    conflict(
      "The block changed while exporting. Retry against the current revision.",
    );
  const data = {
    schemaVersion: "ulpin-block-register/1",
    exportedAt: new Date().toISOString(),
    scope: "block",
    ulpin3d: site.identifier,
    area: context.area,
    parcelIdentifiers: context.parcelIdentifiers || [],
    features: context.features,
    properties,
    sources,
    check: context.latestCheck,
    note: "3D ULPINs are application identifiers. Parcel 2D ULPINs retain their source assertion or fictional demo status. Originals may cover multiple floors.",
  };
  if (format === "json")
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="block-register.json"',
        "Cache-Control": "no-store",
      },
    });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Block register</title><style>body{font:12px system-ui;color:#263d33;padding:12px;line-height:1.5}h1{font:28px Georgia}h2,h3{break-after:avoid}table{width:100%;border-collapse:collapse;margin:12px 0}thead{display:table-header-group}th,td{text-align:left;border-bottom:1px solid #d6dfd7;padding:7px;overflow-wrap:anywhere}tr,p,svg{break-inside:avoid}small{font-size:10px;color:#57685f}</style></head><body><h1>${esc(context.area.name)}</h1><p><b>Block 3D ULPIN / application ID:</b> ${esc(site.identifier)} · revision ${context.area.revision}</p><p>${esc(data.note)}</p>${plan(context.features)}<p>Plan in local metres · ${esc(context.area.reference?.analysisCrs)}. Display assets are not measurements.</p><h2>Block features and parcel identities</h2><table><thead><tr><th>Feature</th><th>3D ULPIN / context ID</th><th>2D ULPIN</th><th>Area m²</th></tr></thead><tbody>${context.features
    .map(
      (f) =>
        `<tr><td>${esc(f.name)}<br><small>${esc(f.kind)} · ${esc(f.worldStatus)}</small></td><td>${esc(f.identifier)}</td><td>${esc(
          (context.parcelIdentifiers || [])
            .filter(
              (p) =>
                p.parcelId === f.id ||
                (context.parcelAssociations || []).some(
                  (a) =>
                    a.fromId === f.id &&
                    a.toId === p.parcelId &&
                    a.relationship === "occupies_parcel" &&
                    a.status === "confirmed",
                ),
            )
            .map(
              (p) =>
                `${p.value} (${p.scheme === "demo_ulpin" ? "Demo" : "Source assertion"})`,
            )
            .join("; ") || "Not supplied",
        )}</td><td>${esc(f.areaM2 ?? "Not supplied")}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table>${properties.map((p) => `<h2>${esc(p.property.name)}</h2><p>Building 3D ULPIN: ${esc(p.property.identifier)}<br>Parcel 2D ULPIN: ${esc(p.parcelIdentifiers.map((x: { value: string }) => x.value).join("; ") || "Not supplied")}</p><table><thead><tr><th>Floor / unit</th><th>3D ULPIN</th><th>Levels m</th><th>Area m²</th></tr></thead><tbody>${p.register.map((r: { name: string; identifier: string; geometry?: { lower: number; upper: number; area: number } }) => `<tr><td>${esc(r.name)}</td><td>${esc(r.identifier)}</td><td>${r.geometry ? esc(`${r.geometry.lower}–${r.geometry.upper}`) : "Not supplied"}</td><td>${esc(r.geometry?.area ?? "Not supplied")}</td></tr>`).join("")}</tbody></table>${p.register.length ? "" : "<p>No detailed floor or unit records supplied.</p>"}`).join("")}<h2>Check status</h2><p>${context.latestCheck?.stale ? "Out of date. Run a current check." : esc(context.latestCheck?.status || "Not run")}</p>${context.latestCheck?.stale ? "" : (context.latestCheck?.findings || []).map((f) => `<p><b>${esc(f.code)}</b> ${esc(f.message)}</p>`).join("")}<h2>Attached source revisions</h2>${sources.map((s) => `<p>${esc(s.name)} · revision ${s.revision}<br><small>${esc(s.id)} · SHA-256 ${esc(s.sha256)}</small></p>`).join("")}</body></html>`;
  return format === "zip"
    ? sourceBundle(data, html, sources, "block-register")
    : registerPdf(html);
}

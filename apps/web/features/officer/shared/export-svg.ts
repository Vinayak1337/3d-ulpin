import type { AreaContext } from "@ulpin/contracts";
import {
  featureBounds,
  featureColor,
  geometryPoints,
  geometryPrimitives,
} from "../block/geometry";
import {
  hasGoogleAttribution,
  hasOsmAttribution,
} from "../../../lib/map-attribution";
import { allExportIncludes, structuredExport } from "./export-model";

const xml = (value: unknown) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

/** Export analytical source geometry, independent of the camera and hidden map layers. */
export function scopedSvg(context: AreaContext, scope: string): string {
  const receipt = structuredExport({
    context,
    scope,
    includes: allExportIncludes,
  });
  const features = scope
    ? context.features.filter((f) => f.id === scope)
    : context.features;
  if (!features.length)
    throw new Error("The selected scope has no geometry to export.");
  const [x, y, width, height] = featureBounds(features);
  const font = Math.max(width, height) / 70;
  const shapes = features
    .map((feature) => {
      const color = featureColor(feature);
      const parts = geometryPrimitives(feature.geometry)
        .map((primitive) =>
          primitive.kind === "point"
            ? `<circle cx="${primitive.point[0]}" cy="${-primitive.point[1]}" r="${font / 3}" fill="${color}"/>`
            : `<path d="${primitive.path}" fill="${primitive.kind === "line" ? "none" : color}" fill-opacity="${feature.kind === "parcel" ? 0.2 : 0.9}" fill-rule="evenodd" stroke="#476855" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
        )
        .join("");
      const point = geometryPoints(feature.geometry)[0];
      const label = point
        ? `<text x="${point[0]}" y="${-point[1] - font * 0.7}" font-size="${font}" fill="#233e31" paint-order="stroke" stroke="#fff" stroke-width="${font * 0.2}">${xml(feature.name)}</text>`
        : "";
      return `<g data-feature-id="${xml(feature.id)}" data-ulpin="${xml(feature.identifier)}" data-source-revision="${xml(feature.sourceRevisionId)}"><title>${xml(feature.name)} · ${xml(feature.kind)}</title>${parts}${label}</g>`;
    })
    .join("\n");
  const credits = [
    hasGoogleAttribution(features) ? "Google Open Buildings V3" : "",
    hasOsmAttribution(features) ? "© OpenStreetMap contributors" : "",
  ].filter(Boolean);
  const note = `Local source coordinates · source revisions in metadata${credits.length ? " · " + credits.join(" · ") + " · ODbL" : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height + font * 3}" width="1200" height="900" role="img" aria-labelledby="title description">
<title id="title">${xml(receipt.preview.name)} — revision ${receipt.preview.revision}</title>
<desc id="description">${features.length} selected spatial features. Y is inverted for display only. Geometry remains in its retained source frame; this is not a surveyed map or an issued title.</desc>
<metadata>${xml(JSON.stringify(receipt))}</metadata>
<rect x="${x}" y="${y}" width="${width}" height="${height + font * 3}" fill="#f4f6f0"/>
${shapes}
<text x="${x + font}" y="${y + height + font}" font-family="sans-serif" font-size="${font * 0.7}" fill="#344a3d">${xml(note)}</text>
</svg>`;
}

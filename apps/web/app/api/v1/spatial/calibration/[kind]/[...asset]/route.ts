export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ kind: string; asset: string[] }> }) {
  const { kind, asset } = await context.params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (kind !== "garden" && kind !== "dense") return Response.json({ error: { code: "CALIBRATION_UNKNOWN", message: "Unknown calibration dataset." } }, { status: 404, headers });
  // Exact retirement of the authored public fixtures; source history and private ML controls are unchanged.
  const known = asset.length === 1 && ["manifest.json", "snapshot.json", "summary.json"].includes(asset[0]);
  if (!known && (asset.length !== 2 || !/^[a-f0-9]{64}$/.test(asset[0]) || !/^(context|[-0-9]+_[-0-9]+-(coarse|detail))\.glb$/.test(asset[1])))
    return Response.json({ error: { code: "CALIBRATION_ASSET", message: "Unknown calibration asset." } }, { status: 404, headers });
  return Response.json({ error: {
    code: "RETIRED_SYNTHETIC_CALIBRATION",
    message: "Public synthetic calibration asset generation is retired.",
    replacement: "Use retained original source assets through the private import-package and spatial ML workflows.",
  } }, { status: 410, headers });
}

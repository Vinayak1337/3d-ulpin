import { calibrationPublication } from "@/features/spatial/data/publications";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ kind: string; asset: string[] }> }) {
  const { kind, asset } = await context.params;
  if (kind !== "garden" && kind !== "dense") return Response.json({ error: { message: "Unknown calibration dataset" } }, { status: 404 });
  // Bounded public synthetic assets only; no arbitrary filenames, source URLs or database writes.
  const known = asset.length === 1 && ["manifest.json", "snapshot.json", "summary.json"].includes(asset[0]);
  if (!known && (asset.length !== 2 || !/^[a-f0-9]{64}$/.test(asset[0]) || !/^(context|[-0-9]+_[-0-9]+-(coarse|detail))\.glb$/.test(asset[1]))) return new Response("Not found", { status: 404 });
  const { snapshot, publication } = calibrationPublication(kind);
  const headers = { "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
  if (asset[0] === "manifest.json") return Response.json(publication.manifest, { headers });
  if (asset[0] === "snapshot.json") return Response.json(snapshot, { headers });
  if (asset[0] === "summary.json") return Response.json({ publicationId: publication.id, ...publication.summary }, { headers });
  const bytes = asset[0] === publication.id ? publication.assets.get(asset[1]) : undefined;
  if (!bytes) return new Response("Unknown immutable asset", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "model/gltf-binary", "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}

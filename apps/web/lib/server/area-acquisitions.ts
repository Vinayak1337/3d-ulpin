import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SOURCE_CATALOG, getSourceCatalogEntry } from "../source-catalog";
import { settings } from "./config";
import { query, transaction } from "./db";
import { AppError, notFound, conflict } from "./errors";
import { sha256, putOriginal, readObject } from "./storage";
import { ingestArea } from "./areas";
import { originalAttempt } from "./original-attempt";

export { SOURCE_CATALOG };
const LIMIT_BYTES = 16 * 1024 * 1024;
async function publicBytes(url: URL) {
  // URLs are constructed from the curated catalog, never supplied by documents or arbitrary imports.
  if (url.protocol !== "https:" || url.hostname !== "data.cityofnewyork.us")
    throw new AppError(
      422,
      "SOURCE_NOT_ALLOWED",
      "This source has no authorized acquisition adapter.",
    );
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  }).catch(() => {
    throw new AppError(503, "SOURCE_UNAVAILABLE", "The source provider could not be reached. Open the saved snapshot, or retry when online.");
  });
  if (!response.ok)
    throw new AppError(
      503,
      "SOURCE_UNAVAILABLE",
      `The provider returned HTTP ${response.status}. Open the saved snapshot or retry.`,
    );
  if (Number(response.headers.get("content-length") || 0) > LIMIT_BYTES)
    throw new AppError(
      413,
      "ACQUISITION_LIMIT",
      "Provider response exceeded the bounded transfer limit.",
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      503,
      "SOURCE_EMPTY",
      "Provider returned no response body.",
    );
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > LIMIT_BYTES)
        throw new AppError(
          413,
          "ACQUISITION_LIMIT",
          "Provider response exceeded 16 MiB.",
        );
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "SOURCE_UNAVAILABLE", "The source download was interrupted. Open the saved snapshot, or retry when online.");
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {
    bytes: Buffer.concat(chunks),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}
function nycQuery() {
  const source = getSourceCatalogEntry("nyc-building-footprints")!,
    bounds = source.snapshot!.bboxWgs84;
  const where = `within_box(the_geom,${bounds[3]},${bounds[0]},${bounds[1]},${bounds[2]}) AND feature_code = '2100'`;
  return { source, where };
}
async function sourceCount() {
  const { source, where } = nycQuery(),
    url = new URL(source.queryUrl.replace(".geojson", ".json"));
  url.searchParams.set("$select", "count(*) AS count");
  url.searchParams.set("$where", where);
  const raw = await publicBytes(url);
  const count = Number(JSON.parse(raw.bytes.toString())[0]?.count);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > source.limits.maxFeatures
  )
    throw new AppError(
      422,
      "AREA_LIMIT",
      `The bounded source has ${count} features; this adapter accepts 1–${source.limits.maxFeatures}.`,
    );
  return { count, url: url.toString(), ...raw };
}
export async function probeAcquisition(sourceId: string) {
  const source =
    getSourceCatalogEntry(sourceId) || notFound("Catalog source not found.");
  if (!source.acquisitionEnabled)
    return {
      sourceId,
      status: "metadata_verified",
      acquisitionEnabled: false,
      reason: source.license.note,
    };
  const result = await sourceCount();
  return {
    sourceId,
    status: "count_verified",
    featureCount: result.count,
    maxFeatures: source.limits.maxFeatures,
    bbox: source.snapshot?.bboxWgs84,
    license: source.license,
    queriedAt: new Date().toISOString(),
  };
}
export async function acquireSource(
  sourceId: string,
  mode: "saved" | "refresh",
  requestKey: string,
) {
  const source =
    getSourceCatalogEntry(sourceId) || notFound("Catalog source not found.");
  if (!source.acquisitionEnabled || source.license.status === "unresolved")
    throw new AppError(422, "SOURCE_GATE", source.license.note);
  const previous = (
    await query("SELECT body FROM area_acquisitions WHERE operation_key=$1", [
      requestKey,
    ])
  ).rows[0]?.body;
  if (previous) {
    if (previous.sourceId !== sourceId || previous.mode !== mode)
      conflict(
        "Acquisition request key was already used for another operation.",
      );
    return previous;
  }
  const id = randomUUID();
  return originalAttempt("area_acquisitions", id, async (remember) => {
    let bytes: Uint8Array, manifest: Record<string, unknown>;
    if (mode === "saved") {
      bytes = await readFile(
        path.join(settings.fixtureRoot, "real-area/original.geojson"),
      );
      manifest = JSON.parse(
        await readFile(
          path.join(settings.fixtureRoot, "real-area/manifest.json"),
          "utf8",
        ),
      );
      if (sha256(bytes) !== source.snapshot!.sha256)
        throw new AppError(
          422,
          "SNAPSHOT_INTEGRITY",
          "The saved snapshot checksum does not match its manifest.",
        );
    } else {
      const before = await sourceCount(),
        { where } = nycQuery(),
        url = new URL(source.queryUrl);
      const parameters = {
        $select: source.privacyAllowlist.join(","),
        $where: where,
        $order: "doitt_id ASC",
        $limit: String(source.limits.maxFeatures),
        $offset: "0",
      };
      for (const [key, value] of Object.entries(parameters))
        url.searchParams.set(key, value);
      const result = await publicBytes(url),
        after = await sourceCount(),
        data = JSON.parse(result.bytes.toString());
      if (
        !Array.isArray(data.features) ||
        data.features.length !== before.count ||
        after.count !== before.count ||
        new Set(data.features.map((f: any) => f.properties?.doitt_id)).size !==
          before.count
      )
        throw new AppError(
          422,
          "PARTIAL_TRANSFER",
          "Provider counts changed or the feature transfer was incomplete. Nothing has been reported as a complete acquisition. Retry.",
        );
      bytes = result.bytes;
      manifest = {
        provider: source.provider,
        datasetId: source.datasetId,
        query: parameters,
        url: url.toString(),
        retrievedAt: new Date().toISOString(),
        countBefore: before.count,
        countAfter: after.count,
        fetchedCount: data.features.length,
        transferStatus: "complete_for_query",
        etag: result.etag,
        lastModified: result.lastModified,
        sourceSha256: sha256(bytes),
        sourceCRS: source.sourceCRS,
        privacyAllowlist: source.privacyAllowlist,
        license: source.license,
        bboxWgs84: source.snapshot!.bboxWgs84,
      };
      // Preserve exact count responses as acquisition evidence as well as the feature payload.
      const evidenceId = randomUUID();
      remember(`acquisitions/${evidenceId}/count-before`);
      remember(`acquisitions/${evidenceId}/count-after`);
      await putOriginal(
        `acquisitions/${evidenceId}/count-before`,
        before.bytes,
        "application/json",
      );
      await putOriginal(
        `acquisitions/${evidenceId}/count-after`,
        after.bytes,
        "application/json",
      );
      manifest.countEvidence = {
        prefix: `acquisitions/${evidenceId}`,
        beforeSha256: sha256(before.bytes),
        afterSha256: sha256(after.bytes),
      };
    }
    const objectKey = `acquisitions/${id}/original`,
      digest = sha256(bytes);
    remember(objectKey);
    await putOriginal(objectKey, bytes, "application/geo+json");
    const body = {
      id,
      sourceId,
      mode,
      status: "complete",
      objectKey,
      sha256: digest,
      bytes: bytes.length,
      manifest,
      openedAt: new Date().toISOString(),
      snapshotLabel:
        mode === "saved" ? "Prior saved snapshot" : "New provider acquisition",
    };
    return transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [requestKey],
      );
      const previous = (
        await client.query(
          "SELECT body FROM area_acquisitions WHERE operation_key=$1",
          [requestKey],
        )
      ).rows[0]?.body;
      if (previous) {
        if (previous.sourceId !== sourceId || previous.mode !== mode)
          conflict("Acquisition request key belongs to another operation.");
        return previous;
      }
      await client.query(
        "INSERT INTO area_acquisitions(id,source_id,operation_key,status,body) VALUES($1,$2,$3,'complete',$4)",
        [id, sourceId, requestKey, body],
      );
      return body;
    });
  });
}
export async function importAcquisition(
  acquisitionId: string,
  areaId?: string,
  expectedAreaRevision?: number,
  name?: string,
) {
  const row =
    (
      await query("SELECT body FROM area_acquisitions WHERE id=$1", [
        acquisitionId,
      ])
    ).rows[0]?.body || notFound("Saved acquisition not found.");
  const source = getSourceCatalogEntry(row.sourceId)!;
  const bytes = await readObject(row.objectKey);
  if (sha256(bytes) !== row.sha256)
    throw new AppError(
      422,
      "SNAPSHOT_INTEGRITY",
      "The acquisition bytes no longer match the saved checksum.",
    );
  return ingestArea({
    bytes,
    filename: "nyc-building-footprints.geojson",
    format: "geojson",
    namespace: source.id,
    name: name || source.snapshot!.name,
    mapping: {
      idField: source.adapter.idField,
      kind: "building",
      heightField: source.adapter.heightField!,
      heightUnit: "ft",
      heightMeaning: source.adapter.heightMeaning,
      identifierFields: ["bin", "base_bbl"],
    },
    areaId,
    expectedAreaRevision,
    acquisitionId,
    administrativeUnits: [
      { kind: "country", name: "United States", source: source.datasetUrl },
      { kind: "state", name: "New York", source: source.datasetUrl },
      { kind: "locality", name: "Bronx", source: source.datasetUrl },
    ],
  });
}

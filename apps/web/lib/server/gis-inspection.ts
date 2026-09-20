import { createHash } from "node:crypto";
import type { GisInspection } from "@ulpin/contracts";
import { AppError } from "./errors";

/** No persistence: the eventual import receives this same File's original bytes. */
export async function inspectGisUpload(
  request: Request,
  inspect: (input: {
    base64: string;
    layer?: string;
  }) => Promise<Omit<GisInspection, "suggestedTitle" | "suggestedNamespace">>,
): Promise<GisInspection> {
  if (Number(request.headers.get("content-length") || 0) > 17 * 1024 * 1024)
    throw new AppError(
      413,
      "FILE_SIZE",
      "Choose a nonempty GIS file up to 16 MiB.",
    );
  // Bound actual bytes too: chunked requests need not declare Content-Length.
  if (!request.body)
    throw new AppError(400, "MISSING_FILE", "Choose a GIS source file.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 17 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError(
          413,
          "FILE_SIZE",
          "Choose a nonempty GIS file up to 16 MiB.",
        );
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Response(new Blob(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new AppError(
      400,
      "INVALID_FORM",
      "Choose a GIS file using the file upload control.",
    );
  }
  const file = form.get("file");
  if (!(file instanceof File))
    throw new AppError(400, "MISSING_FILE", "Choose a GIS source file.");
  if (!file.size || file.size > 16 * 1024 * 1024)
    throw new AppError(
      413,
      "FILE_SIZE",
      "Choose a nonempty GIS file up to 16 MiB.",
    );
  const layer = form.get("layer");
  if (
    layer !== null &&
    (typeof layer !== "string" || !layer.length || layer.length > 256)
  )
    throw new AppError(
      422,
      "INVALID_LAYER",
      "Choose an available source layer.",
    );
  const metadata = await inspect({
    base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    ...(layer ? { layer: String(layer) } : {}),
  });
  return {
    ...metadata,
    suggestedTitle:
      file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim()
        .slice(0, 150) || "GIS source",
    // A retry, reselect or reload of these exact bytes has the same namespace.
    suggestedNamespace: `file:${metadata.layer === null ? metadata.sourceSha256 : createHash("sha256").update(`${metadata.sourceSha256}\0${metadata.layer}`).digest("hex")}`,
  };
}

/** Omitting an attribute ID is allowed only for validated, retained GeoJSON IDs. */
export async function validateUnmappedGisIdentity(
  format: string,
  bytes: Uint8Array,
  inspect: (input: {
    base64: string;
  }) => Promise<{ featureIdEligible: boolean }>,
): Promise<void> {
  if (
    format !== "geojson" ||
    !(await inspect({ base64: Buffer.from(bytes).toString("base64") }))
      .featureIdEligible
  )
    throw new AppError(
      422,
      "SOURCE_ID_REQUIRED",
      "Choose a complete unique ID column, or supply complete unique GeoJSON Feature IDs. Row numbers are not a source identity.",
    );
}

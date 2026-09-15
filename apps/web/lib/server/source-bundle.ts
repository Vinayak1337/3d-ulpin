import { zipSync, strToU8 } from "fflate";
import type { DossierSource } from "@ulpin/contracts";
import { query } from "./db";
import { readObject, sha256 } from "./storage";
import { AppError } from "./errors";
import { registerPdf } from "./register-pdf";
const LIMIT = 128 * 1024 * 1024;
/** Original source revisions are attached byte-for-byte, never regenerated. */
let active = false;
export async function sourceBundle(
  data: unknown,
  html: string,
  sources: DossierSource[],
  filename: string,
) {
  if (active)
    throw new AppError(
      503,
      "BUNDLE_BUSY",
      "Another source bundle is being prepared. Try again shortly.",
    );
  active = true;
  try {
    return await createBundle(data, html, sources, filename);
  } finally {
    active = false;
  }
}
async function createBundle(
  data: unknown,
  html: string,
  sources: DossierSource[],
  filename: string,
) {
  const unique = [...new Map(sources.map((s) => [s.id, s])).values()];
  const stored = (
    await query(
      "SELECT id,object_key,bytes,sha256 FROM sources WHERE id=ANY($1::uuid[])",
      [unique.map((s) => s.id)],
    )
  ).rows;
  if (stored.length !== unique.length)
    throw new AppError(
      503,
      "SOURCE_UNAVAILABLE",
      "An attached original could not be found. No partial bundle was generated.",
    );
  if (stored.reduce((n, s) => n + Number(s.bytes), 0) > LIMIT)
    throw new AppError(
      413,
      "BUNDLE_LIMIT",
      "Attached originals exceed 128 MiB. Download a smaller property scope or individual source files.",
    );
  const files: Record<string, Uint8Array> = {};
  const manifest = [];
  let bytesRead = 0;
  for (const source of unique) {
    const row = stored.find((s) => s.id === source.id)!;
    const bytes = await readObject(row.object_key);
    bytesRead += bytes.length;
    if (bytesRead > LIMIT)
      throw new AppError(
        413,
        "BUNDLE_LIMIT",
        "Attached originals exceed the local export limit.",
      );
    if (sha256(bytes) !== source.sha256 || source.sha256 !== row.sha256)
      throw new AppError(
        503,
        "SOURCE_INTEGRITY",
        "An original failed its checksum check. No partial bundle was generated.",
      );
    const safeName =
      source.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "original";
    const path = `sources/${source.id}/${safeName}`;
    files[path] = bytes;
    manifest.push({ ...source, path, bytes: bytes.length });
  }
  files["register.json"] = strToU8(JSON.stringify(data, null, 2));
  files["sources.json"] = strToU8(
    JSON.stringify(
      {
        scope:
          "Original files may cover multiple floors; their bytes and revisions are unchanged.",
        sources: manifest,
      },
      null,
      2,
    ),
  );
  const pdf = await registerPdf(html);
  files["register.pdf"] = new Uint8Array(await pdf.arrayBuffer());
  files["README.txt"] = strToU8(
    "The register is scoped to the selected block, building, floor or unit. 3D ULPINs are application identifiers, not official national issuance. Read each 2D ULPIN assertion and demo label. Original files can cover additional floors. sources.json lists every attachment, source revision, locator and SHA-256. No source file was cropped or rewritten.",
  );
  return new Response(new Uint8Array(zipSync(files, { level: 1 })), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

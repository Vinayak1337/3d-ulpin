import {GisQuarantineSchema,type ImportPackage} from "@ulpin/contracts";
import type { PoolClient } from "pg";
import { AppError } from "../../infrastructure/errors";

/** Check the retained body, never a filtered projection that a writer could save.
 * Use the caller's client and existing lock order; this check takes no new locks. */
export async function assertPackageDocumentAuthority(client: PoolClient, pkg: ImportPackage): Promise<ImportPackage> {
  const ids = [...new Set([
    ...pkg.sourceRevisionIds,
    ...pkg.parts.flatMap(part => [part.sourceRevisionId, ...(part.copiedFrom ? [part.copiedFrom.sourceRevisionId] : [])]),
  ])];
  const sources = ids.length
    ? (await client.query("SELECT * FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows
    : [];
  // An absent source cannot establish that a historical part is unmarked.
  const found = new Set(sources.map(source => source.id));
  if (ids.some(id => !found.has(id)))
    throw new AppError(403, "DOCUMENT_DENIED", "This source context is unavailable.");
  if(pkg.quarantine){
    const parsed=GisQuarantineSchema.safeParse(pkg.quarantine);
    if(!parsed.success)throw new AppError(409,'GIS_SOURCE_CHANGED','The geometry quarantine receipt is invalid.');
    const pin=parsed.data,source=sources.find(row=>row.id===pin.sourceId);
    if(!source||source.sha256!==pin.sourceSha256||Number(source.revision)!==pin.sourceRevision||pin.accepted!==pkg.features.length)
      throw new AppError(409,'GIS_SOURCE_CHANGED','The exact geometry quarantine source revision changed.');
  }
  const { documentAuthorityTx, assertDocumentPackageParts } = await import("../usp/ingestion/document-authority");
  const marked = new Set<string>();
  for (const source of sources)
    if (await documentAuthorityTx(client, source)) marked.add(source.id);
  assertDocumentPackageParts(pkg, marked);
  return pkg;
}

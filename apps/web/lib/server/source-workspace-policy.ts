import type { AreaReference, CoordinateFrame, ImportPackage } from "@ulpin/contracts";
import { fingerprint } from "./domain";
import { conflict } from "./errors";

/** Names alone do not establish the retained metric or vertical reference. */
export function assertSourceWorkspaceReference(workspace: NonNullable<ImportPackage["sourceWorkspace"]>, frame: CoordinateFrame, reference: AreaReference | undefined) {
  if (fingerprint(workspace.frame) !== fingerprint(frame) || workspace.areaReferenceFingerprint !== fingerprint(reference || null))
    conflict("The source workspace frame changed. Reconcile its retained area reference before applying imagery.");
}

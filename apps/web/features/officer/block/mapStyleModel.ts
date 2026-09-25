import type { PhysicalFeature, RegistryRecord } from "@ulpin/contracts";

export type ColourBy = "none" | "rights" | "readiness" | "findings" | "utilities";
export type DisplayClass = "evidence_linked" | "estimated" | "illustrative" | "unknown";

export function displayClass(feature: PhysicalFeature): DisplayClass {
  const value = feature.properties.geometryClass;
  if (value === "evidence_linked" || value === "estimated" || value === "illustrative") return value;
  if (feature.kind === "building" && feature.height.state === "estimated") return "estimated";
  if (feature.semantics?.evidenceState === "estimated") return "estimated";
  if (feature.semantics?.evidenceState === "source_supported" || feature.semantics?.evidenceState === "reviewed") return "evidence_linked";
  return "unknown";
}

export function recordOutline(feature: PhysicalFeature): "recorded" | "draft" | "retired" | "unknown" {
  const value = feature.properties.recordStatus ?? feature.properties.record_status;
  if (value === "recorded" || value === "draft" || value === "retired") return value;
  return "unknown";
}

export type SavedRightKind = "claim" | "shared_use" | "easement" | "unknown";
export const rightColourToken: Record<Exclude<SavedRightKind, "unknown">, string> = {
  claim: "rights-exclusive", shared_use: "rights-shared", easement: "rights-public",
};

export function rightsClass(record: RegistryRecord): SavedRightKind {
  const types = new Set(record.rights.map(right => right.type));
  if (types.size !== 1) return "unknown";
  if (types.has("ownership_claim")) return "claim";
  if (types.has("shared_use")) return "shared_use";
  if (types.has("easement")) return "easement";
  return "unknown";
}

export function utilityType(feature: PhysicalFeature): "electric" | "gas" | "telecom" | "water" | "reclaimed" | "sewer" | "unknown" {
  if (feature.kind !== "utility") return "unknown";
  const value = String(feature.properties.utility_type ?? feature.properties.network_type ?? "").toLowerCase();
  if (["electric", "gas", "telecom", "water", "reclaimed", "sewer"].includes(value)) return value as ReturnType<typeof utilityType>;
  return "unknown";
}

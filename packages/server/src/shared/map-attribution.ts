import type { PhysicalFeature } from "@ulpin/contracts";

export function hasGoogleAttribution(features: readonly Pick<PhysicalFeature, "properties">[]) {
  return features.some((feature) =>
    /Google.*Open Buildings/i.test(`${feature.properties.attribution || ""} ${feature.properties.source_provider || ""}`),
  );
}

/** Credits follow retained source metadata, including labelled derived scenarios. */
export function hasOsmAttribution(features: readonly Pick<PhysicalFeature, "properties">[]) {
  return features.some((feature) =>
    `${feature.properties.attribution || ""} ${feature.properties.source_provider || ""}`.includes("OpenStreetMap"),
  );
}

import type { BuildingDossier } from "@ulpin/contracts";
/** Select a recorded floor/unit without changing source files or canonical records. */
export function selectRegisterScope(
  dossier: BuildingDossier,
  recordId?: string,
) {
  if (!recordId || recordId === dossier.building.id)
    return {
      dossier,
      selection: {
        id: dossier.building.id,
        kind: "building",
        name: dossier.building.name,
        ulpin3d: dossier.building.identifier,
      },
    };
  const record = dossier.records.find(
    (r) => r.id === recordId && (r.kind === "floor" || r.kind === "space"),
  );
  if (!record) return null;
  const selected = new Set([record.id]);
  if (record.kind === "floor") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of dossier.records)
        if (
          !selected.has(child.id) &&
          child.kind === "space" &&
          child.links.some(
            (l) =>
              (l.type === "floor" || l.type === "within") &&
              selected.has(l.targetId),
          )
        ) {
          selected.add(child.id);
          changed = true;
        }
    }
  }
  return {
    selection: {
      id: record.id,
      kind: record.kind,
      name: record.name,
      ulpin3d: record.identifier,
    },
    dossier: {
      ...dossier,
      records: dossier.records.filter((r) => selected.has(r.id)),
      detailedScene: dossier.detailedScene.filter((r) =>
        selected.has(r.record.id),
      ),
    },
  };
}

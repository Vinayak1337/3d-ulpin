"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BuildingDossier,
  CaseDetail,
  ImportPackage,
  PreparationCase,
} from "@ulpin/contracts";
import { request, useMutation } from "../shared/hooks";
import { routes } from "../shared/routes";
import { Button, Dialog, ErrorState } from "../shared/ui";
import PropertyChooser, { type PropertyChoice } from "./PropertyChooser";
import styles from "./Workspace.module.css";
export default function AssignDialog({
  open,
  onClose,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  detail: CaseDetail | null;
}) {
  const [property, setProperty] = useState<PropertyChoice | null>(null),
    [ids, setIds] = useState<string[] | null>(null);
  const mutation = useMutation(),
    router = useRouter();
  const eligible =
    detail?.sources.filter((s) =>
      ["plan-pdf-v1", "plan-png-v1", "levels-csv-v1"].includes(s.profile),
    ) || [];
  const selected = ids || eligible.map((s) => s.id);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign these sources to a property"
    >
      {!property ? (
        <PropertyChooser onChoose={setProperty} />
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!detail || !selected.length) return;
            const reason = String(
              new FormData(event.currentTarget).get("reason"),
            );
            void mutation.run(async () => {
              const response = await fetch(
                `/api/v1/buildings/${property.buildingId}/dossier`,
                { cache: "no-store" },
              );
              const dossier = (await response.json()) as BuildingDossier;
              if (!response.ok)
                throw new Error("Could not open the target property.");
              const prep = await request<PreparationCase>(
                `/buildings/${property.buildingId}/preparation-cases`,
                {
                  expectedRevision: dossier.building.revision,
                  requestKey: crypto.randomUUID(),
                },
              );
              const packageResponse = await fetch(
                `/api/v1/import-packages/${prep.packageId}`,
                { cache: "no-store" },
              );
              const pkg = (await packageResponse.json()) as ImportPackage;
              if (!packageResponse.ok)
                throw new Error("Could not open the preparation draft.");
              await request<ImportPackage>(
                `/import-packages/${pkg.id}/copy-case-documents`,
                {
                  expectedRevision: pkg.revision,
                  caseId: detail.case.id,
                  sourceIds: selected,
                  buildingId: property.buildingId,
                  reason,
                },
              );
              router.push(
                routes.workspace(property.buildingId, property.areaId),
              );
              onClose();
            });
          }}
        >
          <div className={styles.notice}>
            <strong>{property.name}</strong>
            <p>{property.identifier}</p>
            <Button onClick={() => setProperty(null)}>
              Choose another property
            </Button>
          </div>
          <fieldset>
            <legend>Originals to associate</legend>
            {eligible.map((source) => (
              <label key={source.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  onChange={(event) =>
                    setIds(
                      event.target.checked
                        ? [...selected, source.id]
                        : selected.filter((id) => id !== source.id),
                    )
                  }
                />
                <span>
                  {source.name}
                  <small>Revision {source.revision}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Why do these documents belong to this property?
            <textarea name="reason" required />
          </label>
          <p className={styles.muted}>
            The original draft stays intact. Copied sources retain their
            original receipt, hash and case lineage. Local measurement notes
            remain with this draft.
          </p>
          {mutation.error && <ErrorState message={mutation.error} />}
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.busy || !selected.length}
          >
            Assign {selected.length} source{selected.length === 1 ? "" : "s"}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

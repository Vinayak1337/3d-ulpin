"use client";

import { useEffect, useRef, useState } from "react";
import type { CaseDetail } from "@ulpin/contracts";
import { X } from "@/lib/ui/icons";

export function IdentifierValue({
  value,
  label = "Identifier",
}: {
  value: string;
  label?: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="identifier-value">
      <code>{value}</code>
      <button
        className="button small"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setMessage("Copied");
          } catch {
            setMessage("Select the identifier text to copy it.");
          }
        }}
      >
        Copy
      </button>
      <span role="status">{message}</span>
    </div>
  );
}

function IdentityTree({
  detail,
  onClose,
  onSelect,
}: {
  detail: CaseDetail;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { identity } = detail;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Close identifiers"]',
      )
      ?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: "3d-ulpin-prototype-v1",
            caseId: detail.case.id,
            caseName: detail.case.name,
            caseRevision: detail.case.revision,
            ...identity,
            spaces: identity.spaces.map((space) => ({
              ...space,
              alias: detail.units.find((u) => u.id === space.unitId)?.alias,
            })),
            notes:
              "Prototype workspace identifiers, not government-issued ULPINs. A hierarchy path is a current locator; permanent space IDs do not change when floor membership changes.",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `${identity.rootId}-identifiers.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog
      ref={dialog}
      className="file-preview-dialog identity-dialog"
      aria-labelledby="identity-dialog-title"
      onCancel={onClose}
    >
      <header className="file-preview-header">
        <div>
          <span className="eyebrow">Prototype identifiers</span>
          <h2 id="identity-dialog-title">Property, floors & spaces</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close identifiers"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="identity-tree-content">
        <section className="identity-root">
          <span className="eyebrow">Property parent / super identifier</span>
          <h3>{detail.case.name}</h3>
          <IdentifierValue
            value={identity.rootId}
            label="property identifier"
          />
          <p>
            One fixed-length parent for this workspace. Floors and spaces are
            linked records, so adding them never lengthens the parent ID.
          </p>
        </section>
        {!identity.spaces.length && (
          <p className="identity-empty">
            Your property ID is ready. Prepare or trace spaces to allocate floor
            and space IDs.
          </p>
        )}
        {identity.floors.map((floor) => (
          <section className="identity-floor" key={floor.id}>
            <div className="identity-floor-heading">
              <h3>
                <code>{floor.code}</code> {floor.label}
              </h3>
              <IdentifierValue
                value={floor.id}
                label={`${floor.label} floor identifier`}
              />
            </div>
            {identity.spaces
              .filter((s) => s.parentId === floor.id)
              .map((space) => {
                const unit = detail.units.find((u) => u.id === space.unitId);
                return (
                  <div className="identity-space" key={space.id}>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => {
                          onClose();
                          onSelect(space.unitId);
                        }}
                      >
                        {unit?.alias} · {unit?.name}
                      </button>
                      <span className="subtle-label">
                        {unit?.kind} · {floor.code} / {space.code}
                      </span>
                    </div>
                    <IdentifierValue
                      value={space.id}
                      label={`${unit?.alias} space identifier`}
                    />
                    <details>
                      <summary>Hierarchy path</summary>
                      <IdentifierValue
                        value={space.path}
                        label={`${unit?.alias} hierarchy path`}
                      />
                      <p>
                        This path records the current floor. The permanent space
                        ID above stays the same after reassignment.
                      </p>
                    </details>
                  </div>
                );
              })}
          </section>
        ))}
      </div>
      <footer className="identity-footer">
        <p>
          Prototype IDs for this property workspace. Not government-issued
          ULPINs. A new workspace receives a new parent ID, even if it describes
          the same physical property.
        </p>
        <button className="button small" onClick={download}>
          Download identifier register
        </button>
      </footer>
    </dialog>
  );
}

export default function PropertyIdentity({
  detail,
  onSelect,
}: {
  detail: CaseDetail;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="property-identifier-bar">
        <div>
          <span className="eyebrow">3D ULPIN · prototype</span>
          <IdentifierValue
            value={detail.identity.rootId}
            label="parent 3D ULPIN"
          />
        </div>
        <button className="button small" onClick={() => setOpen(true)}>
          View identifiers{" "}
          <span>
            {
              detail.identity.floors.filter((f) => f.label !== "Unassigned")
                .length
            }{" "}
            named levels · {detail.identity.spaces.length}{" "}
            {detail.identity.spaces.length === 1 ? "space" : "spaces"}
          </span>
        </button>
      </div>
      {open && (
        <IdentityTree
          detail={detail}
          onClose={() => setOpen(false)}
          onSelect={onSelect}
        />
      )}
    </>
  );
}

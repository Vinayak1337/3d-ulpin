"use client";
import { useState } from "react";
import type { PreparationCase, SourceLocator } from "@ulpin/contracts";
import { registryRequest as request } from "@/lib/registry-client";

export default function PreparationPlacement({
  preparation,
  evidence,
  onSaved,
  onBusyChange,
  disabled = false,
}: {
  preparation: PreparationCase;
  evidence: SourceLocator[];
  onSaved: (value: PreparationCase) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [method, setMethod] = useState("block"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reference = preparation.placement.verticalReference;
  const unknown = /unknown|unresolved|not aligned/i.test(reference);
  return (
    <details
      className="preparation-placement"
      open={preparation.placement.status !== "reviewed"}
    >
      <summary>
        Place plans in this block{" "}
        <span>
          {preparation.placement.status === "reviewed"
            ? "Reviewed"
            : "Required for 3D details"}
        </span>
      </summary>
      <form
        className="officer-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          onBusyChange(true);
          setError("");
          void (async () => {
            try {
              const verticalReference = String(data.get("reference"));
              const value = await request<PreparationCase>(
                `/import-packages/${preparation.packageId}/placement`,
                {
                  expectedRevision: preparation.revision,
                  sourceFrame:
                    method === "block"
                      ? preparation.placement.targetFrame
                      : String(data.get("sourceFrame")),
                  verticalReference,
                  sourceVerticalReference: String(
                    data.get("sourceVerticalReference") || verticalReference,
                  ),
                  verticalOffset: Number(data.get("offset") || 0),
                  ...(method === "controls"
                    ? {
                        controlPoints: [0, 1].map((i) => ({
                          source: [
                            Number(data.get(`s${i}x`)),
                            Number(data.get(`s${i}y`)),
                          ],
                          target: [
                            Number(data.get(`t${i}x`)),
                            Number(data.get(`t${i}y`)),
                          ],
                        })),
                      }
                    : {}),
                  evidence,
                  reason: String(data.get("reason")),
                },
              );
              await onSaved(value);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Placement could not be saved.",
              );
            } finally {
              setBusy(false);
              onBusyChange(false);
            }
          })();
        }}
      >
        <label>
          Plan coordinates
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option value="block">Already in this block’s metre frame</option>
            <option value="controls">
              Match two documented control points
            </option>
          </select>
        </label>
        {method === "controls" && (
          <>
            <label>
              Coordinate frame named on the drawing
              <input
                name="sourceFrame"
                required
                placeholder="e.g. Drawing grid A, metres"
              />
            </label>
            {[0, 1].map((i) => (
              <fieldset key={i}>
                <legend>Control point {i + 1} · metres</legend>
                <div className="officer-form-pair">
                  <label>
                    Drawing X
                    <input name={`s${i}x`} type="number" step="any" required />
                  </label>
                  <label>
                    Drawing Y
                    <input name={`s${i}y`} type="number" step="any" required />
                  </label>
                  <label>
                    Block X
                    <input name={`t${i}x`} type="number" step="any" required />
                  </label>
                  <label>
                    Block Y
                    <input name={`t${i}y`} type="number" step="any" required />
                  </label>
                </div>
              </fieldset>
            ))}
          </>
        )}
        <label>
          Level reference on section
          <input
            name="reference"
            required
            defaultValue={unknown ? "" : reference}
            readOnly={!unknown}
            placeholder="e.g. Ground floor datum = 0.00 m"
          />
        </label>
        <details>
          <summary>Levels use another datum</summary>
          <p className="area-note">
            Use only a documented offset to the retained level reference above.
          </p>
          <label>
            Source level reference
            <input
              name="sourceVerticalReference"
              placeholder="Leave blank when the reference is the same"
            />
          </label>
          <label>
            Offset added to source levels (m)
            <input name="offset" type="number" step="any" defaultValue={0} />
          </label>
        </details>
        <label>
          Source support for placement
          <input
            name="reason"
            required
            placeholder="Control schedule or section reference"
          />
        </label>
        <small>
          {evidence.length
            ? "The selected source part will be retained as placement evidence."
            : "Select a source part before reviewing placement."}
        </small>
        {error && (
          <p role="alert" className="area-warning">
            {error}
          </p>
        )}
        <button disabled={busy || disabled || !evidence.length}>
          {busy ? "Saving placement…" : "Review and save placement"}
        </button>
      </form>
    </details>
  );
}

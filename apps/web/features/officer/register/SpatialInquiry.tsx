"use client";
import { useState } from "react";
import type { RegistryDetail, RegistryQuery } from "@ulpin/contracts";
import { request, useMutation } from "../shared/hooks";
import { Button, ErrorState, Panel } from "../shared/ui";
import styles from "./register.module.css";
export default function SpatialInquiry({ detail }: { detail: RegistryDetail }) {
  const [mode, setMode] = useState<"point" | "volume">("point"),
    [result, setResult] = useState<RegistryQuery | null>(null);
  const mutation = useMutation();
  return (
    <Panel title="Spatial inquiry">
      <div style={{ padding: 16 }}>
        <p>
          Coordinates in {detail.site.frame.id} · local metres ·{" "}
          {detail.site.frame.benchmark}
        </p>
        <form
          className={styles.stack}
          onChange={() => setResult(null)}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget),
              number = (key: string) => Number(form.get(key));
            void mutation.run(async () => {
              const x = number("x"),
                y = number("y"),
                right = number("right"),
                top = number("top");
              setResult(
                await request(`/sites/${detail.site.id}/query`, {
                  frame: detail.site.frame,
                  ...(mode === "point"
                    ? { mode, point: [x, y] }
                    : {
                        mode,
                        footprint: [
                          [x, y],
                          [right, y],
                          [right, top],
                          [x, top],
                        ],
                        lower: number("lower"),
                        upper: number("upper"),
                      }),
                }),
              );
            });
          }}
        >
          <label>
            Inquiry type
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              disabled={mutation.busy}
            >
              <option value="point">Vertical stack at a point</option>
              <option value="volume">Excavation rectangle</option>
            </select>
          </label>
          <div className={styles.filters}>
            {(mode === "point"
              ? ["x", "y"]
              : ["x", "y", "right", "top", "lower", "upper"]
            ).map((key) => (
              <label key={key}>
                {
                  {
                    x: "Easting",
                    y: "Northing",
                    right: "East edge",
                    top: "North edge",
                    lower: "Lower level",
                    upper: "Upper level",
                  }[key]
                }
                <input
                  name={key}
                  type="number"
                  step="any"
                  required
                  disabled={mutation.busy}
                />
              </label>
            ))}
          </div>
          <Button type="submit" disabled={mutation.busy}>
            Inspect recorded spaces
          </Button>
        </form>
        {mutation.error && <ErrorState message={mutation.error} />}{" "}
        {result && (
          <div aria-live="polite">
            <p>
              {result.results.length} intersecting records · register revision{" "}
              {result.registryRevision}
            </p>
            {result.results.map((r) => (
              <details key={r.record.id}>
                <summary>
                  {r.record.name} ·{" "}
                  {result.mode === "volume"
                    ? `${r.volume.toFixed(3)} m³`
                    : `${r.record.geometry?.lower}–${r.record.geometry?.upper} m`}
                </summary>
                <p>
                  {r.contact
                    ? "Boundary contact only"
                    : "Interior intersection"}
                </p>
                {r.record.rights.map((right, i) => (
                  <p key={i}>
                    {right.party} · {right.type.replaceAll("_", " ")}
                  </p>
                ))}
              </details>
            ))}
            <p>
              Known records only. This inquiry does not establish underground
              coverage or excavation clearance.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

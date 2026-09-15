"use client";
import { useState } from "react";
import type { Point2 } from "@ulpin/contracts";
import { Badge, Button, formatNumber } from "../shared/ui";
import { distance, makeCalibration } from "./measurement";
import type { Calibration, CanvasSource } from "./types";
import styles from "./Workspace.module.css";
export default function CalibratePanel({
  source,
  page,
  points,
  calibration,
  onSave,
  onReset,
  onClear,
}: {
  source?: CanvasSource;
  page: number;
  points: Point2[];
  calibration?: Calibration;
  onSave: (value: Calibration) => void;
  onReset: () => void;
  onClear: () => void;
}) {
  const [method, setMethod] = useState<"distance" | "controls">("distance"),
    [error, setError] = useState("");
  if (source?.kind === "geometry")
    return (
      <div className={styles.modePanel}>
        <h2>Source coordinates</h2>
        <Badge tone="info">Metres already declared</Badge>
        <p>{source.frame}</p>
        <p className={styles.muted}>
          This retained geometry is already in its named metre frame. Pixel
          calibration applies to a plan image or PDF page.
        </p>
      </div>
    );
  return (
    <div className={styles.modePanel}>
      <div className={styles.panelHeading}>
        <h2>Calibrate plan</h2>
        <Badge tone={calibration ? "success" : "warning"}>
          {calibration ? "Scale set" : "Two points needed"}
        </Badge>
      </div>
      <div className={styles.steps}>
        <span className={points.length > 0 ? styles.complete : ""}>1</span>
        <p>Select two points on the source</p>
        <span className={calibration ? styles.complete : ""}>2</span>
        <p>Enter their supported distance</p>
      </div>
      <div className={styles.metric}>
        <span>Selected source distance</span>
        <strong>
          {points.length === 2
            ? formatNumber(distance(points[0], points[1]))
            : "—"}{" "}
          <small>px</small>
        </strong>
      </div>
      <Button variant="ghost" disabled={!points.length} onClick={onClear}>
        Choose points again
      </Button>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!source) return;
          const data = new FormData(event.currentTarget);
          try {
            const value = makeCalibration(source, page, points, {
              metres: Number(data.get("metres")),
              world:
                method === "controls"
                  ? ([0, 1].map((i) => [
                      Number(data.get(`x${i}`)),
                      Number(data.get(`y${i}`)),
                    ]) as [Point2, Point2])
                  : undefined,
              frame: String(data.get("frame") || ""),
              reason: String(data.get("reason")),
            });
            setError("");
            onSave(value);
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Check the calibration points.",
            );
          }
        }}
      >
        <label>
          Calibration method
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as typeof method)}
          >
            <option value="distance">Known distance</option>
            <option value="controls">Two documented control points</option>
          </select>
        </label>
        {method === "distance" ? (
          <label>
            Known distance · metres
            <input
              name="metres"
              type="number"
              min="0.000001"
              step="any"
              required
              placeholder="e.g. 5.2"
            />
          </label>
        ) : (
          <>
            <label>
              Named metre coordinate frame
              <input
                name="frame"
                required
                placeholder="Frame named on control evidence"
              />
            </label>
            {[0, 1].map((i) => (
              <fieldset key={i}>
                <legend>Control point {i + 1}</legend>
                <div className={styles.pair}>
                  <label>
                    Local X · m
                    <input type="number" step="any" name={`x${i}`} required />
                  </label>
                  <label>
                    Local Y · m
                    <input type="number" step="any" name={`y${i}`} required />
                  </label>
                </div>
              </fieldset>
            ))}
          </>
        )}
        <label>
          Dimension or control evidence
          <textarea
            name="reason"
            required
            placeholder="Identify the dimension label or documented controls."
            defaultValue={calibration?.reason}
          />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={points.length !== 2 || !source}
        >
          Apply calibration
        </Button>
      </form>
      {calibration && (
        <div className={styles.notice}>
          <strong>{formatNumber(calibration.metresPerUnit, 6)} m / px</strong>
          <p>{calibration.frame || "Scale only · no block placement"}</p>
          <small>
            Page {calibration.page} ·{" "}
            {new Date(calibration.savedAt).toLocaleString()}
          </small>
          <Button variant="ghost" onClick={onReset}>
            Reset this page’s calibration
          </Button>
        </div>
      )}
      <p className={styles.muted}>
        Calibration is tied to this original and page. A known distance sets
        scale; it does not establish geographic placement.
      </p>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, formatNumber } from "../shared/ui";
import type { CanvasSource, Measurement, MeasureTool } from "./types";
import styles from "./Workspace.module.css";
export default function MeasurePanel({
  source,
  page,
  tool,
  calibrated,
  points,
  measurements,
  error,
  onCalibrate,
  onFinish,
  onUndo,
  onClear,
  onDelete,
  onNote,
  onHeight,
  onExport,
}: {
  source?: CanvasSource;
  page: number;
  tool: MeasureTool;
  calibrated: boolean;
  points: number;
  measurements: Measurement[];
  error: string;
  onCalibrate: () => void;
  onFinish: () => void;
  onUndo: () => void;
  onClear: () => void;
  onDelete: (id: string) => void;
  onNote: (id: string) => void;
  onHeight: (lower: number, upper: number, reference: string) => void;
  onExport: () => void;
}) {
  const [heightError, setHeightError] = useState("");
  const items = measurements.filter(
    (m) =>
      m.sourceId === source?.id &&
      m.sourceHash === source?.hash &&
      m.page === page,
  );
  return (
    <div className={styles.modePanel}>
      <div className={styles.panelHeading}>
        <h2>Measurements</h2>
        <Badge tone={calibrated ? "success" : "warning"}>
          {calibrated ? "Scale set" : "Uncalibrated"}
        </Badge>
      </div>
      {!calibrated && tool !== "height" && (
        <div className={styles.notice}>
          <strong>Set the scale first</strong>
          <p>
            Metre measurements need a source-supported distance or control
            points.
          </p>
          <Button onClick={onCalibrate}>Calibrate plan</Button>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {tool === "height" ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget),
              lower = Number(data.get("lower")),
              upper = Number(data.get("upper")),
              reference = String(data.get("reference")).trim();
            if (
              !Number.isFinite(lower) ||
              !Number.isFinite(upper) ||
              upper <= lower ||
              !reference
            ) {
              setHeightError(
                "Use finite source levels, upper above lower, and a named reference.",
              );
              return;
            }
            setHeightError("");
            onHeight(lower, upper, reference);
          }}
        >
          <h3>Height from source levels</h3>
          <div className={styles.pair}>
            <label>
              Lower · m<input name="lower" type="number" step="any" required />
            </label>
            <label>
              Upper · m<input name="upper" type="number" step="any" required />
            </label>
          </div>
          <label>
            Level reference
            <input
              name="reference"
              required
              placeholder="Benchmark named on section"
            />
          </label>
          <p className={styles.muted}>
            A plan distance is not a vertical height.
          </p>
          {heightError && (
            <p role="alert" className={styles.error}>
              {heightError}
            </p>
          )}
          <Button type="submit" disabled={!source}>
            Add height note
          </Button>
        </form>
      ) : (
        <div className={styles.measureHelp}>
          <strong>{tool === "pan" ? "Pan the plan" : `Measure ${tool}`}</strong>
          <p>
            {tool === "pan"
              ? "Drag the drawing to reposition it."
              : tool === "angle"
                ? "Select an arm, the corner, then the second arm."
                : ["area", "perimeter"].includes(tool)
                  ? "Select the boundary corners, then finish."
                  : tool === "point"
                    ? "Place a marker on the source."
                    : "Select the two end points."}
          </p>
          <div className={styles.inline}>
            <Button disabled={!points} onClick={onUndo}>
              Undo point
            </Button>
            <Button disabled={!points} onClick={onClear}>
              Clear
            </Button>
            <Button
              variant="primary"
              disabled={!points || tool === "pan"}
              onClick={onFinish}
            >
              Finish
            </Button>
          </div>
        </div>
      )}
      <div className={styles.panelHeading}>
        <h3>Saved on this device</h3>
        <span>{items.length}</span>
      </div>
      {!items.length ? (
        <EmptyState
          title="No measurements yet"
          description="Completed measurements stay with this source page."
          icon="measure"
        />
      ) : (
        <ol className={styles.measurements}>
          {items.map((item, index) => (
            <li key={item.id}>
              <span className={styles.number}>{index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                {item.value !== null && (
                  <b>
                    {formatNumber(item.value)} {item.unit}
                  </b>
                )}
                <small>{item.reference}</small>
                <div className={styles.inline}>
                  <Button variant="ghost" onClick={() => onNote(item.id)}>
                    {item.noted ? "✓ In notes" : "Add to notes"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onDelete(item.id)}
                    aria-label={`Delete ${item.label}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button
        icon="download"
        disabled={!measurements.length}
        onClick={onExport}
      >
        Export measurement notes
      </Button>
      <p className={styles.muted}>
        Local notes do not update registry geometry.
      </p>
    </div>
  );
}

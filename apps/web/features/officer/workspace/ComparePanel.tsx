"use client";
import { Badge, Button, EmptyState } from "../shared/ui";
import type { CanvasSource } from "./types";
import styles from "./Workspace.module.css";
export default function ComparePanel({
  source,
  sources,
  secondaryId,
  onSecondary,
  mode,
  onMode,
  opacity,
  onOpacity,
  swipe,
  onSwipe,
}: {
  source?: CanvasSource;
  sources: CanvasSource[];
  secondaryId: string;
  onSecondary: (id: string) => void;
  mode: "overlay" | "split" | "side_by_side" | "difference";
  onMode: (mode: "overlay" | "split" | "side_by_side" | "difference") => void;
  opacity: number;
  onOpacity: (n: number) => void;
  swipe: number;
  onSwipe: (n: number) => void;
}) {
  const other = sources.find((s) => s.id === secondaryId),
    options = sources.filter((s) => s.id !== source?.id && s.kind !== "text");
  const sharedFrame =
    source?.kind === "geometry" &&
    other?.kind === "geometry" &&
    source.frame &&
    source.frame === other.frame;
  const needsSeparate =
    !!other &&
    (source?.kind === "geometry" || other.kind === "geometry") &&
    !sharedFrame;
  return (
    <div className={styles.modePanel}>
      <h2>Compare sources</h2>
      <div className={styles.legend}>
        <span className={styles.swatchA} />A ·{" "}
        {source?.name || "Choose a source"}
      </div>
      <label className={styles.field}>
        Compare with
        <select
          value={secondaryId}
          onChange={(event) => onSecondary(event.target.value)}
        >
          <option value="">Choose a second source</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {!options.length ? (
        <EmptyState
          title="Add a second plan"
          description="A comparison needs two retained sources."
        />
      ) : !other ? (
        <EmptyState title="Choose the comparison source" />
      ) : (
        <>
          <div className={styles.legend}>
            <span className={styles.swatchB} />B · {other.name}
          </div>
          <div className={styles.segmented}>
            {(["overlay", "split", "side_by_side", "difference"] as const).map(
              (value) => (
                <Button
                  key={value}
                  disabled={
                    (needsSeparate && value !== "side_by_side") ||
                    (value === "difference" &&
                      (source?.kind === "geometry" ||
                        other.kind === "geometry"))
                  }
                  variant={
                    (needsSeparate ? "side_by_side" : mode) === value
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() => onMode(value)}
                >
                  {value === "side_by_side"
                    ? "Side by side"
                    : value === "split"
                      ? "Swipe"
                      : value === "difference"
                        ? "Pixel difference"
                        : "Overlay"}
                </Button>
              ),
            )}
          </div>
          {!needsSeparate && mode === "overlay" && (
            <label className={styles.field}>
              Source B opacity · {opacity}%
              <input
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(e) => onOpacity(Number(e.target.value))}
              />
            </label>
          )}
          {!needsSeparate && mode === "split" && (
            <label className={styles.field}>
              Comparison split · {swipe}%
              <input
                type="range"
                min="0"
                max="100"
                value={swipe}
                onChange={(e) => onSwipe(Number(e.target.value))}
              />
            </label>
          )}
          {mode === "difference" && (
            <p className={styles.muted}>
              Light pixels differ between the fitted images. Dark pixels match.
              This is a visual pixel difference, including text and scan
              changes.
            </p>
          )}
          <Badge tone={sharedFrame ? "info" : "warning"}>
            {sharedFrame
              ? "Same declared metre frame"
              : "Visual comparison only"}
          </Badge>
          <p className={styles.muted}>
            {sharedFrame
              ? "Retained source boundaries are shown in their common coordinate frame."
              : "Documents are fitted for visual inspection. Sources without a common coordinate frame are shown separately. Pixel overlap is not a measured discrepancy."}
          </p>
          <div className={styles.notice}>
            <strong>Differences need review</strong>
            <p>
              No area total or conflict is inferred from these images. Use
              validated geometry checks for an exact finding.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

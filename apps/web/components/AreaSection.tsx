"use client";
import type { PhysicalFeature } from "@ulpin/contracts";
import { utilityScene } from "@/lib/officer-scene";
import type { SceneDetail } from "./AreaViewer";
export default function AreaSection({
  selected,
  details,
  selectedDetailId,
  onSelect,
}: {
  selected: PhysicalFeature | null;
  details: SceneDetail[];
  selectedDetailId?: string;
  onSelect: (id: string) => void;
}) {
  const levels = details.flatMap((detail) => [detail.lower, detail.upper]),
    lower = Math.min(0, ...levels),
    upper = Math.max(5, selected?.height.value || 0, ...levels),
    span = Math.max(5, upper - lower);
  const y = (level: number) => 300 - ((level - lower) / span) * 250;
  if (!selected)
    return (
      <div className="area-section-empty">
        <h2>Choose a property</h2>
        <p>
          Select a building or utility to inspect the supplied vertical
          information.
        </p>
      </div>
    );
  if (selected.kind === "utility") {
    const profile = utilityScene(selected);
    if (!profile)
      return (
        <div className="area-section-empty">
          <span className="area-eyebrow">UTILITY SECTION</span>
          <h2>{selected.name}</h2>
          <p>Alignment only · depth unknown</p>
          <p>
            Supply a cross section, levels and a common vertical reference
            before drawing an underground profile.
          </p>
          {((selected.utilityProfile?.unresolved || []) as string[]).map(
            (item, i) => (
              <p key={i} className="area-note">
                {item}
              </p>
            ),
          )}
        </div>
      );
    const distances = [0];
    for (let i = 1; i < profile.positions.length; i++)
      distances.push(
        distances[i - 1] +
          Math.hypot(
            profile.positions[i][0] - profile.positions[i - 1][0],
            profile.positions[i][1] - profile.positions[i - 1][1],
          ),
      );
    const min =
        Math.min(...profile.positions.map((p) => p[2])) - profile.height,
      max = Math.max(...profile.positions.map((p) => p[2])) + profile.height,
      range = Math.max(1, max - min),
      length = distances.at(-1) || 1;
    const xy = (i: number, z: number) =>
      `${70 + (distances[i] / length) * 390},${280 - ((z - min) / range) * 220}`;
    const top = profile.positions.map((point, i) =>
        xy(i, point[2] + profile.height / 2),
      ),
      bottom = profile.positions
        .map((point, i) => xy(i, point[2] - profile.height / 2))
        .reverse();
    return (
      <div className="area-section">
        <header>
          <span className="area-eyebrow">EVIDENCED UTILITY PROFILE</span>
          <h2>{selected.name}</h2>
          <p>
            {profile.shape} · {profile.width} × {profile.height} m
          </p>
        </header>
        <svg
          viewBox="0 0 520 340"
          aria-label="Utility longitudinal section from supplied source levels"
        >
          {Array.from({ length: 5 }, (_, i) => min + (range * i) / 4).map(
            (level) => (
              <g key={level}>
                <line
                  x1="70"
                  x2="465"
                  y1={280 - ((level - min) / range) * 220}
                  y2={280 - ((level - min) / range) * 220}
                  stroke="#dde3d9"
                />
                <text
                  x="60"
                  y={284 - ((level - min) / range) * 220}
                  textAnchor="end"
                >
                  {level.toFixed(2)} m
                </text>
              </g>
            ),
          )}
          <polygon
            points={[...top, ...bottom].join(" ")}
            fill="#668fa78a"
            stroke="#426e88"
          />
          {profile.positions.map((point, i) => (
            <g key={i}>
              <circle
                cx={70 + (distances[i] / length) * 390}
                cy={280 - ((point[2] - min) / range) * 220}
                r="4"
                fill="#335f78"
              />
              <text
                x={70 + (distances[i] / length) * 390}
                y="307"
                textAnchor="middle"
              >
                {distances[i].toFixed(1)} m
              </text>
            </g>
          ))}
          <text x="265" y="330" textAnchor="middle">
            Distance along retained alignment
          </text>
        </svg>
        <p className="area-note">
          Levels relative to {profile.verticalReference}. Vertical and
          horizontal display scales differ.
        </p>
        <p className="area-note">{profile.method}</p>
        <p className="area-note">
          {profile.limitation || profile.solidMeaning}
        </p>
      </div>
    );
  }
  return (
    <div className="area-section">
      <header>
        <span className="area-eyebrow">SOURCE LEVELS</span>
        <h2>{selected.name}</h2>
        <p>
          {details.length
            ? "Recorded vertical limits · schematic horizontal layout"
            : "Exterior height only · no interior floors inferred"}
        </p>
      </header>
      <svg
        viewBox="0 0 520 340"
        aria-label="Building vertical section from retained levels"
      >
        {Array.from({ length: 6 }, (_, i) => lower + (span * i) / 5).map(
          (level) => (
            <g key={level}>
              <line
                x1="70"
                y1={y(level)}
                x2="490"
                y2={y(level)}
                stroke="#dde3d9"
              />
              <text x="58" y={y(level) + 4} textAnchor="end">
                {level.toFixed(1)} m
              </text>
            </g>
          ),
        )}
        <line
          x1="70"
          y1={y(0)}
          x2="490"
          y2={y(0)}
          stroke="#7c927e"
          strokeDasharray="6 4"
        />
        {details.length ? (
          details.map((detail, index) => (
            <g
              key={detail.id}
              onClick={() => onSelect(detail.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  onSelect(detail.id);
              }}
              aria-label={`${detail.name}: ${detail.lower} to ${detail.upper} metres`}
            >
              <rect
                x={105 + (index % 4) * 83}
                y={y(detail.upper)}
                width="77"
                height={Math.max(2, y(detail.lower) - y(detail.upper))}
                fill={selectedDetailId === detail.id ? "#cb9877" : "#9bb4a8"}
                stroke="#5f8270"
              />
              <text
                x={143 + (index % 4) * 83}
                y={(y(detail.lower) + y(detail.upper)) / 2}
                textAnchor="middle"
              >
                {detail.name.slice(0, 12)}
              </text>
            </g>
          ))
        ) : selected.height.value !== null ? (
          <rect
            x="160"
            y={y(selected.height.value)}
            width="220"
            height={y(0) - y(selected.height.value)}
            fill="#b3c2b3"
            stroke="#6b876b"
          />
        ) : (
          <text x="260" y="165" textAnchor="middle">
            Height not supplied
          </text>
        )}
      </svg>
      <p className="area-note">
        {details[0]?.verticalReference || selected.height.reference}. Zero is
        the retained source reference, not a surveyed global ground level.
      </p>
    </div>
  );
}

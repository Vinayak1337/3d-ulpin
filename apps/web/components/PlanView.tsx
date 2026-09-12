"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ContextFeature,
  Finding,
  Point2,
  UnitSpec,
} from "@ulpin/contracts";
import {
  Check,
  Cursor as MousePointer2,
  PencilSimple as Pencil,
  X,
} from "@/lib/ui/icons";
import { boundsOf, number, unitColor } from "@/lib/ui/geometry";

interface Props {
  units: UnitSpec[];
  context: ContextFeature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  floor: string;
  isolate: boolean;
  finding: Finding | null;
  onSave: (unit: UnitSpec, footprint: Point2[]) => Promise<boolean>;
  busy: boolean;
}

export default function PlanView({
  units,
  context,
  selectedId,
  onSelect,
  floor,
  isolate,
  finding,
  onSave,
  busy,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Point2[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const selected = units.find((u) => u.id === selectedId);
  const bounds = useMemo(
    () =>
      boundsOf([
        ...units.map((u) => u.footprint),
        ...context.map((c) => c.footprint),
      ]),
    [units, context],
  );
  const padding = Math.max(bounds.width, bounds.height) * 0.12;
  const y = (n: number) => bounds.minY + bounds.maxY - n;
  const poly = (ring: Point2[]) =>
    ring.map((p) => `${p[0]},${y(p[1])}`).join(" ");
  const scale = Math.max(bounds.width, bounds.height) / 500;
  useEffect(() => {
    setEditing(false);
    setDraft([]);
  }, [selectedId, selected?.revision]);
  const visible = units.filter(
    (u) =>
      (floor === "all" || (u.levelLabel || "Unassigned") === floor) &&
      (!isolate || u.id === selectedId),
  );
  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (dragging === null || !svg.current) return;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    setDraft((old) =>
      old.map((p, i) =>
        i === dragging
          ? [
              Math.round(point.x * 100) / 100,
              Math.round(y(point.y) * 100) / 100,
            ]
          : p,
      ),
    );
  }
  return (
    <div className="plan-view">
      <div className="plan-tools">
        <span className="eyebrow">Local plan · metres</span>
        {selected && (
          <button
            className={`button small ${editing ? "active" : "ghost"}`}
            onClick={() => {
              setDraft(selected.footprint.map((p) => [...p] as Point2));
              setEditing(!editing);
            }}
          >
            <Pencil size={13} />
            {editing ? "Editing vertices" : "Edit footprint"}
          </button>
        )}
      </div>
      <svg
        ref={svg}
        viewBox={`${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + 2 * padding} ${bounds.height + 2 * padding}`}
        onPointerMove={move}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        role="img"
        aria-label="Linked local metric plan; select a unit to inspect it"
      >
        <defs>
          <pattern
            id="plan-grid"
            width="1"
            height="1"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M1 0H0V1"
              fill="none"
              stroke="#d8d8cf"
              strokeWidth={scale * 0.5}
            />
          </pattern>
        </defs>
        <rect
          x={bounds.minX - padding}
          y={bounds.minY - padding}
          width={bounds.width + 2 * padding}
          height={bounds.height + 2 * padding}
          fill="url(#plan-grid)"
        />
        {context.map((c) => (
          <g key={c.alias}>
            <polygon
              points={poly(c.footprint)}
              fill={c.kind === "parcel" ? "#e4dfd020" : "none"}
              stroke="#aea690"
              strokeDasharray={
                c.kind === "parcel" ? `${scale * 5} ${scale * 4}` : undefined
              }
              strokeWidth={scale}
            />
            {c.kind === "parcel" && (
              <text
                x={c.footprint[0][0] + 0.25}
                y={y(c.footprint[0][1]) - 0.3}
                fontSize={scale * 9}
                fill="#898579"
              >
                {c.alias}
              </text>
            )}
          </g>
        ))}
        {visible
          .sort(
            (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
          )
          .map((u) => {
            const ring = editing && u.id === selectedId ? draft : u.footprint;
            const b = boundsOf([ring]);
            return (
              <g
                key={u.id}
                className="plan-unit"
                tabIndex={0}
                role="button"
                aria-label={`Select ${u.alias}, ${u.name}`}
                onClick={() => onSelect(u.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(u.id);
                  }
                }}
              >
                <polygon
                  points={poly(ring)}
                  fill={u.id === selectedId ? "#68aaa0" : unitColor(u)}
                  fillOpacity={u.id === selectedId ? 0.65 : 0.38}
                  stroke={u.id === selectedId ? "#236b60" : "#71877f"}
                  strokeWidth={scale * (u.id === selectedId ? 2.5 : 1)}
                />
                <text
                  pointerEvents="none"
                  x={b.minX + b.width / 2}
                  y={y(b.minY + b.height / 2)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={scale * 12}
                  fontWeight="600"
                  fill="#35564d"
                >
                  {u.alias}
                </text>
              </g>
            );
          })}
        {finding?.overlap && (
          <polygon
            points={poly(finding.overlap.footprint)}
            fill="#de563b"
            fillOpacity="0.65"
            stroke="#bd3624"
            strokeWidth={scale * 2}
            pointerEvents="none"
          />
        )}
        {editing &&
          draft.map((p, i) => (
            <g key={i}>
              <circle
                cx={p[0]}
                cy={y(p[1])}
                r={scale * 5}
                fill="#fffefa"
                stroke="#166052"
                strokeWidth={scale * 2}
                className="vertex-handle"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(i);
                }}
              />
              <text
                x={p[0] + scale * 8}
                y={y(p[1]) - scale * 7}
                fontSize={scale * 9}
                fill="#375c50"
                pointerEvents="none"
              >
                {i + 1}
              </text>
            </g>
          ))}
      </svg>
      {editing && selected ? (
        <div className="vertex-editor">
          <div>
            <strong>Move a point or enter its coordinates</strong>
            <span>Footprint edits create a new draft revision.</span>
          </div>
          <div className="vertex-fields">
            {draft.map((p, i) => (
              <label key={i}>
                <span>{i + 1}</span>
                {p.map((v, axis) => (
                  <input
                    key={axis}
                    type="number"
                    step="0.01"
                    aria-label={`Vertex ${i + 1} ${axis === 0 ? "X" : "Y"} in metres`}
                    value={v}
                    onChange={(e) =>
                      setDraft((old) =>
                        old.map((point, n) =>
                          n === i
                            ? (point.map((coordinate, a) =>
                                a === axis
                                  ? Number(e.target.value)
                                  : coordinate,
                              ) as Point2)
                            : point,
                        ),
                      )
                    }
                  />
                ))}
              </label>
            ))}
          </div>
          <div className="row">
            <button
              className="button small ghost"
              onClick={() => setEditing(false)}
            >
              <X size={14} />
              Cancel
            </button>
            <button
              className="button small primary"
              disabled={busy}
              onClick={async () => {
                if (await onSave(selected, draft)) setEditing(false);
              }}
            >
              <Check size={14} />
              Save footprint
            </button>
          </div>
        </div>
      ) : (
        <div className="plan-legend">
          <MousePointer2 size={12} />
          <span>
            Select a space · {number(bounds.width)} × {number(bounds.height)} m
            extent
          </span>
        </div>
      )}
    </div>
  );
}

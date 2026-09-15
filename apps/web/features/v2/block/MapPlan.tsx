"use client";
import { useEffect, useRef, useState } from "react";
import type { AreaGeometry, PhysicalFeature } from "@ulpin/contracts";
import type { AreaNavigation, SceneDetail } from "@/components/AreaViewer";
import {
  featureBounds,
  featureColor,
  geometryPath,
  geometryPoints,
  geometryPrimitives,
  type ViewBox,
} from "./geometry";
export default function MapPlan({
  features,
  extent,
  selectedId,
  onSelect,
  navigation,
  issueGeometry,
  highlightedIds = [],
  details = [],
  labels = false,
  interactive = true,
}: {
  features: PhysicalFeature[];
  extent?: [number, number, number, number] | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  navigation?: AreaNavigation;
  issueGeometry?: AreaGeometry;
  highlightedIds?: string[];
  details?: SceneDetail[];
  labels?: boolean;
  interactive?: boolean;
}) {
  const [view, setView] = useState<ViewBox>(() =>
    featureBounds(features, extent),
  );
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<{
    x: number;
    y: number;
    view: ViewBox;
    moved: boolean;
  } | null>(null);
  const prior = useRef<ViewBox | null>(null);
  const live = useRef({ features, extent, selectedId, highlightedIds });
  live.current = { features, extent, selectedId, highlightedIds };
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const observer = new ResizeObserver(([e]) =>
      setWidth(Math.max(1, e.contentRect.width)),
    );
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const state = live.current;
    const action = navigation?.action;
    if (action === "zoom_in" || action === "zoom_out") {
      const scale = action === "zoom_in" ? 0.8 : 1.25;
      setView(([x, y, w, h]) => [
        x + (w * (1 - scale)) / 2,
        y + (h * (1 - scale)) / 2,
        w * scale,
        h * scale,
      ]);
    } else if (action === "focus" || action === "issue") {
      setView((old) => {
        prior.current = old;
        return featureBounds(
          state.features.filter((f) =>
            action === "focus"
              ? f.id === state.selectedId
              : state.highlightedIds.includes(f.id),
          ),
        );
      });
    } else if (action === "return" && prior.current) {
      setView(prior.current);
      prior.current = null;
    } else if (!action || action === "fit")
      setView(featureBounds(state.features, state.extent));
  }, [navigation]);
  const fontSize = (12 * view[2]) / width;
  return (
    <svg
      ref={ref}
      className="v2-plan-svg"
      aria-label="2D block map"
      role={interactive ? "group" : "img"}
      viewBox={view.join(" ")}
      onPointerDown={(e) => {
        if (!interactive) return;
        drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !ref.current) return;
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
        if (d.moved) {
          const scale = d.view[2] / ref.current.clientWidth;
          setView([
            d.view[0] - dx * scale,
            d.view[1] - dy * scale,
            d.view[2],
            d.view[3],
          ]);
        }
      }}
      onPointerUp={() => {
        setTimeout(() => {
          drag.current = null;
        }, 0);
      }}
      onPointerLeave={() => {
        drag.current = null;
      }}
      onWheel={(e) => {
        if (!interactive) return;
        const scale = e.deltaY > 0 ? 1.12 : 0.89;
        setView(([x, y, w, h]) => [
          x + (w * (1 - scale)) / 2,
          y + (h * (1 - scale)) / 2,
          w * scale,
          h * scale,
        ]);
      }}
    >
      <defs>
        <pattern
          id="v2-map-grid"
          width={view[2] / 30}
          height={view[2] / 30}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${view[2] / 30} 0 L 0 0 0 ${view[2] / 30}`}
            fill="none"
            stroke="#b8c9c1"
            strokeOpacity=".24"
            strokeWidth={view[2] / 1500}
          />
        </pattern>
      </defs>
      <rect
        x={view[0]}
        y={view[1]}
        width={view[2]}
        height={view[3]}
        fill="#eaf0ea"
      />
      <rect
        x={view[0]}
        y={view[1]}
        width={view[2]}
        height={view[3]}
        fill="url(#v2-map-grid)"
      />
      {[...features]
        .sort(
          (a, b) =>
            Number(a.kind === "building") - Number(b.kind === "building"),
        )
        .map((feature) => {
          const active = selectedId === feature.id,
            hit = highlightedIds.includes(feature.id);
          const p = geometryPoints(feature.geometry)[0];
          const color = active ? "#cd8068" : featureColor(feature);
          const select = () => {
            if (!drag.current?.moved) onSelect?.(feature.id);
          };
          return (
            <g
              key={feature.id}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={feature.name}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select();
                }
              }}
              style={{ cursor: interactive ? "pointer" : "default" }}
            >
              {geometryPrimitives(feature.geometry).map((primitive, i) =>
                primitive.kind === "point" ? (
                  <circle
                    key={i}
                    cx={primitive.point[0]}
                    cy={-primitive.point[1]}
                    r={view[2] / 170}
                    fill={color}
                  />
                ) : (
                  <path
                    key={i}
                    d={primitive.path}
                    fill={primitive.kind === "line" ? "none" : color}
                    fillOpacity={feature.kind === "parcel" ? 0.15 : 0.78}
                    fillRule="evenodd"
                    stroke={
                      hit
                        ? "#c23c2e"
                        : active
                          ? "#a54c33"
                          : feature.kind === "parcel"
                            ? "#ac944f"
                            : "#768f82"
                    }
                    strokeWidth={active || hit ? 2.5 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {(active || labels) && p && (
                <text
                  x={p[0]}
                  y={-p[1] - fontSize * 0.9}
                  fontSize={fontSize}
                  fontWeight={active ? 650 : 450}
                  fill="#2d4b3e"
                  paintOrder="stroke"
                  stroke="#f6faf7"
                  strokeWidth={fontSize * 0.3}
                >
                  {feature.name}
                </text>
              )}
              <title>
                {feature.name} · {feature.kind}
              </title>
            </g>
          );
        })}
      {details
        .filter((d) => d.localGeometry)
        .map((d) => (
          <path
            key={d.id}
            d={geometryPath(d.localGeometry!)}
            fill="#568e8580"
            stroke="#285c53"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>{d.name}</title>
          </path>
        ))}
      {issueGeometry &&
        geometryPrimitives(issueGeometry).map((primitive, i) =>
          primitive.kind === "point" ? (
            <circle
              key={`finding-${i}`}
              cx={primitive.point[0]}
              cy={-primitive.point[1]}
              r={view[2] / 180}
              fill="#b22c23"
            />
          ) : (
            <path
              key={`finding-${i}`}
              d={primitive.path}
              fill={primitive.kind === "polygon" ? "#db564977" : "none"}
              stroke="#b22c23"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              fillRule="evenodd"
            />
          ),
        )}
    </svg>
  );
}

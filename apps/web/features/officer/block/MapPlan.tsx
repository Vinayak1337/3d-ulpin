"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { AreaGeometry, PhysicalFeature } from "@ulpin/contracts";
import type { AreaNavigation, SceneDetail } from "@/components/AreaViewer";
import { hasGoogleAttribution, hasOsmAttribution } from "@/lib/map-attribution";
import {
  featureBounds,
  geometryPath,
  geometryPoints,
  geometryPrimitives,
  type ViewBox,
} from "./geometry";
import { displayClass, recordOutline, rightColourToken, utilityType, type ColourBy, type SavedRightKind } from "./mapStyleModel";
export default function MapPlan({
  features,
  extent,
  selectedId,
  onSelect,
  navigation,
  issueGeometry,
  highlightedIds = [],
  featureLabels,
  details = [],
  labels = false,
  interactive = true,
  selectedDetailId,onSelectDetail,opacityByKind,
  colourBy = "none", findingFeatureIds = [],
  detailRights = {},
}: {
  features: PhysicalFeature[];
  extent?: [number, number, number, number] | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  navigation?: AreaNavigation;
  issueGeometry?: AreaGeometry;
  highlightedIds?: string[];
  featureLabels?: Record<string, string>;
  details?: SceneDetail[];
  labels?: boolean;
  interactive?: boolean;
  selectedDetailId?:string|null;
  onSelectDetail?:(id:string)=>void;
  opacityByKind?:Readonly<Record<string,number>>;
  colourBy?: ColourBy;
  findingFeatureIds?: string[];
  detailRights?: Record<string, SavedRightKind>;
}) {
  const gridId=useId().replaceAll(':','');
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
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
    <svg
      ref={ref}
      className="ui-plan-svg"
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
          if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);
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
      onPointerLeave={(e) => {
        if(!e.currentTarget.hasPointerCapture(e.pointerId))drag.current = null;
      }}
      onPointerCancel={()=>{drag.current=null;}}
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
        <pattern id={`${gridId}-estimated`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M 0 0 V 8" stroke="var(--ui-map-building-edge)" strokeWidth="2"/></pattern>
        <pattern id={`${gridId}-unknown`} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M 0 0 L 8 8 M 8 0 L 0 8" stroke="var(--ui-map-building-edge)" strokeOpacity=".3" strokeWidth=".8"/></pattern>
        <pattern
          id={gridId}
          width={view[2] / 30}
          height={view[2] / 30}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${view[2] / 30} 0 L 0 0 0 ${view[2] / 30}`}
            fill="none"
            stroke="var(--ui-map-building-edge)"
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
        fill="var(--ui-map-ground)"
      />
      <rect
        x={view[0]}
        y={view[1]}
        width={view[2]}
        height={view[3]}
        fill={`url(#${gridId})`}
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
          const evidence = displayClass(feature), status = recordOutline(feature);
          const selectable = interactive && evidence !== "illustrative";
          const base = feature.kind === "road" ? "var(--ui-map-road)" : feature.kind === "public_land" ? "var(--ui-map-public-land)" : "var(--ui-map-building)";
          const type = utilityType(feature);
          const colour = colourBy === "utilities" && feature.kind === "utility" && type !== "unknown" ? `var(--ui-utility-${type})`
            : colourBy === "findings" && findingFeatureIds.includes(feature.id) ? "var(--ui-mark-warning)"
            : base;
          const color = active ? "var(--ui-map-selected)" : colourBy === "none" || colourBy === "rights" || colourBy === "readiness" ? base : colour;
          const select = () => {
            if (selectable && !drag.current?.moved) onSelect?.(feature.id);
          };
          return (
            <g
              key={feature.id}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              aria-label={feature.name}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select();
                }
              }}
              style={{ cursor: selectable ? "pointer" : "default" }}
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
                  <g key={i}>
                  <path
                    d={primitive.path}
                    fill={primitive.kind === "line" || feature.kind === "parcel" ? "none" : color}
                    fillOpacity={(evidence === "illustrative" ? 0.2 : 0.9)*(opacityByKind?.[feature.kind]??1)}
                    fillRule="evenodd"
                    stroke={
                      hit
                        ? "var(--ui-mark-warning)"
                        : active
                          ? "var(--ui-map-selected)"
                          : feature.kind === "parcel"
                            ? "var(--ui-map-parcel-line)"
                            : "var(--ui-map-building-edge)"
                    }
                    strokeWidth={active || hit ? 2.5 : 1}
                    strokeDasharray={status === "draft" ? "5 3" : status === "retired" ? "1 3" : status === "unknown" ? "3 3" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  {primitive.kind === "polygon" && feature.kind !== "parcel" && (evidence === "estimated" || evidence === "unknown") && <path d={primitive.path} fill={`url(#${gridId}-${evidence})`} fillRule="evenodd" pointerEvents="none"/>}
                  </g>
                ),
              )}
              {(active || labels) && p && (
                <text
                  x={p[0]}
                  y={-p[1] - fontSize * 0.9}
                  fontSize={fontSize}
                  fontWeight={active ? 650 : 450}
                  fill="var(--ui-ink)"
                  paintOrder="stroke"
                  stroke="var(--ui-map-halo)"
                  strokeWidth={fontSize * 0.3}
                >
                  {featureLabels?.[feature.id] || feature.name}{feature.kind === "building" && (feature.height.value == null || feature.height.state === "unknown") ? " · height unknown" : ""}
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
            fill={selectedDetailId===d.id ? "var(--ui-map-selected)" : colourBy === "rights" && detailRights[d.id] && detailRights[d.id] !== "unknown" ? `var(--ui-${rightColourToken[detailRights[d.id] as Exclude<SavedRightKind, "unknown">]})` : "var(--ui-map-building)"}
            stroke="var(--ui-map-building-edge)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            role={interactive?'button':undefined}
            tabIndex={interactive?0:undefined}
            aria-label={d.name}
            onClick={()=>{if(!drag.current?.moved)onSelectDetail?.(d.id);}}
            onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelectDetail?.(d.id);}}}
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
    {(hasGoogleAttribution(features) || hasOsmAttribution(features)) && (
      <span style={{ position: "absolute", left: 8, bottom: interactive ? 92 : 8, padding: "3px 6px", fontSize: 10, background: "#fffffff0", color: "#284e42", borderRadius: 3 }}>
        {hasGoogleAttribution(features) && <>{interactive ? <a href="https://sites.research.google/gr/open-buildings/" target="_blank" rel="noreferrer">Google Open Buildings V3</a> : "Google Open Buildings V3"} · </>}
        {hasOsmAttribution(features) && (interactive ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> : "© OpenStreetMap contributors")}
        {" · ODbL"}
      </span>
    )}
    </div>
  );
}

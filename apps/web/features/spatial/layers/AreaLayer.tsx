"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { orbitCamera, type OrbitDirection } from "@/lib/scene-orbit";
import "@/components/AreaViewer.css";
import { createMapRuntime, type MapRuntime } from "../engine/runtime";
import { validCamera } from "../data/session";
import { useSpatialServices } from "../data/Provider";
import { geometryParts, utilityScene } from "@/lib/officer-scene";
import { hasGoogleAttribution, hasOsmAttribution } from "@/lib/map-attribution";
import type {
  AreaGeometry,
  PhysicalFeature,
  SceneAsset,
} from "@ulpin/contracts";

export type AreaNavigation = {
  action:
    | "fit"
    | "focus"
    | "issue"
    | "return"
    | "north"
    | "angle"
    | "zoom_in"
    | "zoom_out"
    | OrbitDirection;
  sequence: number;
};
export interface SceneDetail {
  id: string;
  name: string;
  geographicGeometry: AreaGeometry;
  localGeometry?: AreaGeometry;
  verticalReference?: string;
  lower: number;
  upper: number;
  kind: "floor" | "space";
}
export interface SceneBoundary {
  id: string;
  name: string;
  geographicGeometry: AreaGeometry;
  localGeometry?: AreaGeometry;
}
export interface AreaViewerProps {
  features: PhysicalFeature[];
  sceneAssets?: SceneAsset[];
  framingFeatureId?: string;
  explode?: number;
  detailStyle?: "volume" | "floorplan";
  geographicExtent?: [number, number, number, number] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  navigation: AreaNavigation;
  sceneKey?: string;
  highlightedIds?: string[];
  issueGeometry?: AreaGeometry | null;
  details?: SceneDetail[];
  boundaries?: SceneBoundary[];
  selectedDetailId?: string | null;
  selectedDetailIds?: string[];
  onSelectDetail?: (id: string) => void;
  underground?: boolean;
  labels?: boolean;
  featureLabels?: Record<string, string>;
  /** Presentation-only camera distance. Canonical geometry is unchanged. */
  frameScale?: number;
}
type CameraState = {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
};
type Model = { signature: string; entities: Cesium.Entity[] };

const positions = (geometry: AreaGeometry): number[][] => {
  const visit = (value: unknown): number[][] =>
    !Array.isArray(value)
      ? []
      : typeof value[0] === "number"
        ? [value as number[]]
        : value.flatMap(visit);
  return geometry.type === "GeometryCollection"
    ? geometry.geometries.flatMap(positions)
    : visit(geometry.coordinates);
};
const baseColor = (feature: PhysicalFeature) =>
  feature.kind === "road"
    ? "#687572"
    : feature.kind === "parcel"
      ? "#c3bd96"
      : feature.kind === "public_land"
        ? "#8fa47c"
        : feature.kind === "utility"
          ? "#527a9f"
          : feature.height.state === "estimated"
            ? "#bfaa82"
            : "#c7cebf";
const snapshot = (v: Cesium.Viewer): CameraState => ({
  longitude: v.camera.positionCartographic.longitude,
  latitude: v.camera.positionCartographic.latitude,
  height: v.camera.positionCartographic.height,
  heading: v.camera.heading,
  pitch: v.camera.pitch,
  roll: v.camera.roll,
});
function restore(v: Cesium.Viewer, state: CameraState) {
  v.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      state.longitude,
      state.latitude,
      state.height,
    ),
    orientation: {
      heading: state.heading,
      pitch: state.pitch,
      roll: state.roll,
    },
  });
}
const hierarchy = (rings: number[][][]) =>
  new Cesium.PolygonHierarchy(
    rings[0].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
    rings
      .slice(1)
      .map(
        (ring) =>
          new Cesium.PolygonHierarchy(
            ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
          ),
      ),
  );

const emptyAssets: SceneAsset[] = [];
const emptyIds: string[] = [];
const emptyDetails: SceneDetail[] = [];
const emptyBoundaries: SceneBoundary[] = [];

export default function AreaLayer(props: AreaViewerProps) {
  const { sessions } = useSpatialServices();
  const {
    features,
    sceneAssets = emptyAssets,
    explode = 0,
    detailStyle = "volume",
    selectedId,
    navigation,
    geographicExtent,
    sceneKey = "area",
    highlightedIds = emptyIds,
    issueGeometry,
    details = emptyDetails,
    boundaries = emptyBoundaries,
    selectedDetailId,
    selectedDetailIds,
    underground = false,
    labels = true,
    featureLabels,
  } = props;
  const host = useRef<HTMLDivElement>(null),
    viewer = useRef<Cesium.Viewer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const models = useRef(new Map<string, Model>()),
    detailModels = useRef<Cesium.Entity[]>([]),
    boundaryModels = useRef<Cesium.Entity[]>([]),
    issueModels = useRef<Cesium.Entity[]>([]);
  const previousBlock = useRef<CameraState | null>(null),
    initialized = useRef<string | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");

  useEffect(() => {
    if (!host.current) return;
    let v: Cesium.Viewer | undefined, runtime: MapRuntime | undefined;
    try {
      runtime = createMapRuntime(host.current, "world", setError);
      v = runtime.viewer;
      v.scene.screenSpaceCameraController.tiltEventTypes = [
        Cesium.CameraEventType.MIDDLE_DRAG,
        Cesium.CameraEventType.PINCH,
        {
          eventType: Cesium.CameraEventType.LEFT_DRAG,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
        {
          eventType: Cesium.CameraEventType.RIGHT_DRAG,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
      ];
      v.screenSpaceEventHandler.setInputAction(
        (event: { position: Cesium.Cartesian2 }) => {
          const entity = (
            v?.scene.pick(event.position) as { id?: Cesium.Entity } | undefined
          )?.id;
          const detailId = entity?.properties?.detailId?.getValue();
          const featureId = entity?.properties?.featureId?.getValue();
          if (typeof detailId === "string")
            latest.current.onSelectDetail?.(detailId);
          else if (typeof featureId === "string")
            latest.current.onSelect(featureId);
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
      const retain = () => {
        if (
          !v ||
          v.isDestroyed() ||
          initialized.current !== (latest.current.sceneKey || "area") ||
          !latest.current.features.length
        )
          return;
        const key = latest.current.sceneKey || "area",
          state = snapshot(v);
        sessions.patch(key, { camera: state });

      };
      v.camera.moveEnd.addEventListener(retain);
      v.scene.postRender.addEventListener(() => {
        if (!host.current || !v || v.isDestroyed()) return;
        const complete = v.dataSourceDisplay.ready;
        host.current.dataset.sceneReady = String(complete);
        // Asynchronous polygon/model construction needs another render until
        // the complete scene snapshot is ready, even in request-render mode.
        if (!complete) v.scene.requestRender();
      });
      viewer.current = v;
      setReady(true);
    } catch (cause) {
      runtime?.destroy();
      setError(
        cause instanceof Error ? cause.message : "3D rendering is unavailable.",
      );
    }
    return () => {

      if (v && !v.isDestroyed()) {
        if (
          initialized.current === (latest.current.sceneKey || "area") &&
          latest.current.features.length
        )
          sessions.patch(latest.current.sceneKey || "area", { camera: snapshot(v) });
        runtime?.destroy();
      }
      viewer.current = null;
      initialized.current = null;
      models.current.clear();
      detailModels.current = [];
      boundaryModels.current = [];
      issueModels.current = [];
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const currentIds = new Set(features.map((f) => f.id));
    for (const [id, model] of models.current)
      if (!currentIds.has(id)) {
        model.entities.forEach((entity) => v.entities.remove(entity));
        models.current.delete(id);
      }
    for (const feature of features) {
      // Selection and dossier responses never rebuild the area's meshes.
      const signature = JSON.stringify([
        feature.geographicGeometry,
        feature.height.value,
        feature.kind,
        feature.name,
        feature.utilityProfile,
        sceneAssets.find((asset) => asset.featureId === feature.id),
      ]);
      if (models.current.get(feature.id)?.signature === signature) continue;
      models.current
        .get(feature.id)
        ?.entities.forEach((entity) => v.entities.remove(entity));
      const utility = utilityScene(feature),
        geometry = feature.geographicGeometry,
        color = Cesium.Color.fromCssColorString(baseColor(feature)),
        entities: Cesium.Entity[] = [];
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      const asset = sceneAssets.find(
        (a) =>
          a.featureId === feature.id && a.featureRevision === feature.revision,
      );
      if (asset) {
        const position = Cesium.Cartesian3.fromDegrees(...asset.position);
        entities.push(
          v.entities.add({
            id: `${feature.id}:asset`,
            properties: { featureId: feature.id },
            position,
            orientation: Cesium.Transforms.headingPitchRollQuaternion(
              position,
              new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(asset.heading),
                0,
                0,
              ),
            ),
            model: { uri: asset.url, shadows: Cesium.ShadowMode.ENABLED },
          }),
        );
      }
      (asset && feature.kind === "building" ? [] : polygons).forEach(
        (rings, index) =>
          entities.push(
            v.entities.add({
              id: `${feature.id}:polygon:${index}`,
              properties: { featureId: feature.id },
              polygon: {
                hierarchy: hierarchy(rings),
                height: 0,
                extrudedHeight:
                  feature.kind === "building" &&
                  feature.height.value !== null &&
                  feature.height.value > 0
                    ? feature.height.value
                    : undefined,
                material: color.withAlpha(
                  feature.kind === "parcel"
                    ? 0.12
                    : feature.kind === "public_land"
                      ? 0.45
                      : 0.94,
                ),
                outline: true,
                outlineColor: color.darken(0.4, new Cesium.Color()),
              },
            }),
          ),
      );
      // Raise display-only parcel strokes above the authored ground mesh.
      // Canonical horizontal geometry and measurements are unchanged.
      if (feature.kind === "parcel")
        polygons.forEach((rings, index) =>
          rings.forEach((ring, r) =>
            entities.push(
              v.entities.add({
                id: `${feature.id}:boundary:${index}:${r}`,
                properties: { featureId: feature.id },
                polyline: {
                  positions: ring.map(([lon, lat]) =>
                    Cesium.Cartesian3.fromDegrees(lon, lat, 0.25),
                  ),
                  width: 2,
                  material: Cesium.Color.fromCssColorString("#f8f7e9"),
                },
              }),
            ),
          ),
        );
      const lines =
        geometry.type === "LineString"
          ? [geometry.coordinates]
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : [];
      lines.forEach((line, index) =>
        entities.push(
          v.entities.add({
            id: `${feature.id}:line:${index}`,
            properties: { featureId: feature.id },
            polyline: {
              positions: line.map(([lon, lat]) =>
                Cesium.Cartesian3.fromDegrees(lon, lat, 0),
              ),
              width: feature.kind === "utility" ? 4 : 3,
              material:
                feature.kind === "utility"
                  ? new Cesium.PolylineDashMaterialProperty({
                      color,
                      dashLength: 12,
                    })
                  : color,
            },
          }),
        ),
      );
      const dots =
        geometry.type === "Point"
          ? [geometry.coordinates]
          : geometry.type === "MultiPoint"
            ? geometry.coordinates
            : [];
      dots.forEach(([lon, lat], index) =>
        entities.push(
          v.entities.add({
            id: `${feature.id}:point:${index}`,
            properties: { featureId: feature.id },
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: { pixelSize: 9, color },
          }),
        ),
      );
      if (utility) {
        const shape =
          utility.shape === "circular"
            ? Array.from(
                { length: 32 },
                (_, i) =>
                  new Cesium.Cartesian2(
                    (Math.cos((i * Math.PI) / 16) * utility.width) / 2,
                    (Math.sin((i * Math.PI) / 16) * utility.height) / 2,
                  ),
              )
            : [
                new Cesium.Cartesian2(-utility.width / 2, -utility.height / 2),
                new Cesium.Cartesian2(utility.width / 2, -utility.height / 2),
                new Cesium.Cartesian2(utility.width / 2, utility.height / 2),
                new Cesium.Cartesian2(-utility.width / 2, utility.height / 2),
              ];
        entities.push(
          v.entities.add({
            id: `${feature.id}:supported-utility`,
            properties: { featureId: feature.id },
            polylineVolume: {
              positions: utility.geographicPositions.map(([lon, lat, z]) =>
                Cesium.Cartesian3.fromDegrees(lon, lat, z),
              ),
              shape,
              material: color.withAlpha(0.85),
              outline: true,
              outlineColor: color.darken(0.3, new Cesium.Color()),
              cornerType: Cesium.CornerType.MITERED,
            },
          }),
        );
      }
      const points = positions(geometry);
      if (points.length) {
        const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length,
          lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
        entities.push(
          v.entities.add({
            id: `${feature.id}:label`,
            properties: { featureId: feature.id },
            position: Cesium.Cartesian3.fromDegrees(
              feature.kind === "parcel" ? points[0][0] : lon,
              feature.kind === "parcel" ? points[0][1] : lat,
              feature.kind === "building" ? (feature.height.value || 0) + 2 : 1,
            ),
            label: {
              text:
                feature.kind === "utility" && feature.name.length > 24
                  ? `${feature.name.slice(0, 23)}…`
                  : featureLabels?.[feature.id] || feature.name,
              font: "12px sans-serif",
              showBackground: true,
              backgroundColor: Cesium.Color.WHITE.withAlpha(0.96),
              backgroundPadding: new Cesium.Cartesian2(7, 4),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              fillColor: Cesium.Color.fromCssColorString("#304036"),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 0,
              style: Cesium.LabelStyle.FILL,
              pixelOffset: new Cesium.Cartesian2(0, -8),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0,
                feature.kind === "building" ? 110 : 160,
              ),
              show: labels,
            },
          }),
        );
      }
      models.current.set(feature.id, { signature, entities });
    }
    v.scene.requestRender();
  }, [features, sceneAssets, ready, labels, featureLabels]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const highlighted = new Set(highlightedIds);
    for (const feature of features) {
      const selected = feature.id === selectedId,
        affected = highlighted.has(feature.id),
        color = Cesium.Color.fromCssColorString(
          affected ? "#c23c2e" : selected ? "#3d745d" : baseColor(feature),
        );
      const alpha =
        feature.kind === "parcel"
          ? 0.1
          : underground && feature.kind === "building"
            ? 0.2
            : details.length && feature.id === selectedId
              ? 0.15
              : details.length
                ? 0.38
                : 0.94;
      for (const entity of models.current.get(feature.id)?.entities || []) {
        if (entity.model) {
          entity.model.show = new Cesium.ConstantProperty(
            !(selected && details.length),
          );
          entity.model.color = new Cesium.ConstantProperty(
            affected
              ? Cesium.Color.fromCssColorString("#ec7365")
              : selected
                ? Cesium.Color.fromCssColorString("#c1dfc5").withAlpha(
                    details.length ? 0.08 : 1,
                  )
                : Cesium.Color.WHITE.withAlpha(details.length ? 0.45 : 1),
          );
          entity.model.colorBlendMode = new Cesium.ConstantProperty(
            Cesium.ColorBlendMode.MIX,
          );
          entity.model.colorBlendAmount = new Cesium.ConstantProperty(
            affected ? 0.65 : selected ? 0.45 : 0,
          );
          entity.model.silhouetteColor = new Cesium.ConstantProperty(
            Cesium.Color.fromCssColorString(affected ? "#c23c2e" : "#41715a"),
          );
          entity.model.silhouetteSize = new Cesium.ConstantProperty(
            affected || (selected && !details.length) ? 2 : 0,
          );
        }
        if (entity.polygon) {
          entity.polygon.material = new Cesium.ColorMaterialProperty(
            color.withAlpha(alpha),
          );
          entity.polygon.outlineColor = new Cesium.ConstantProperty(
            selected || affected
              ? color
              : color.darken(0.4, new Cesium.Color()),
          );
        }
        if (entity.polyline)
          entity.polyline.material =
            feature.kind === "utility"
              ? new Cesium.PolylineDashMaterialProperty({
                  color,
                  dashLength: 12,
                })
              : new Cesium.ColorMaterialProperty(
                  feature.kind === "parcel" && !selected && !affected
                    ? Cesium.Color.fromCssColorString("#f8f7e9")
                    : color,
                );
        if (entity.polylineVolume)
          entity.polylineVolume.material = new Cesium.ColorMaterialProperty(
            color.withAlpha(0.85),
          );
        if (entity.point)
          entity.point.color = new Cesium.ConstantProperty(color);
        if (entity.label) {
          entity.label.show = new Cesium.ConstantProperty(labels || selected);
          entity.label.distanceDisplayCondition = new Cesium.ConstantProperty(
            new Cesium.DistanceDisplayCondition(
              0,
              selected || affected
                ? 1200
                : feature.kind === "parcel"
                  ? 600
                  : feature.kind === "building"
                    ? 110
                    : 100,
            ),
          );
        }
      }
    }
    v.scene.globe.translucency.enabled = underground;
    v.scene.globe.translucency.frontFaceAlpha = underground ? 0.3 : 1;
    v.scene.requestRender();
  }, [
    features,
    sceneAssets,
    selectedId,
    highlightedIds,
    details.length,
    underground,
    labels,
    ready,
  ]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    detailModels.current.forEach((entity) => v.entities.remove(entity));
    detailModels.current = [];
    const levels = [...new Set(details.map((d) => d.lower))].sort(
      (a, b) => a - b,
    );
    for (const detail of details) {
      const geometry = detail.geographicGeometry,
        polygons =
          geometry.type === "Polygon"
            ? [geometry.coordinates]
            : geometry.type === "MultiPolygon"
              ? geometry.coordinates
              : [];
      polygons.forEach((rings, index) =>
        detailModels.current.push(
          v.entities.add({
            id: `detail:${detail.id}:${index}`,
            properties: { detailId: detail.id },
            polygon: {
              hierarchy: hierarchy(rings),
              height: detail.lower + levels.indexOf(detail.lower) * explode,
              extrudedHeight:
                (detailStyle === "floorplan"
                  ? detail.lower + 0.12
                  : detail.upper) +
                levels.indexOf(detail.lower) * explode,
              material: Cesium.Color.fromCssColorString(
                detail.id === selectedDetailId ||
                  selectedDetailIds?.includes(detail.id)
                  ? "#d6ac58"
                  : detail.kind === "space"
                    ? detailStyle === "floorplan"
                      ? "#dcd5c1"
                      : "#b8cfb9"
                    : "#819983",
              ).withAlpha(detailStyle === "floorplan" ? 1 : 0.84),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString("#3e625f"),
            },
          }),
        ),
      );
      if (detailStyle === "floorplan")
        for (const rings of polygons)
          for (const ring of rings) {
            const lower = detail.lower + levels.indexOf(detail.lower) * explode;
            detailModels.current.push(
              v.entities.add({
                id: `detail-wall:${detail.id}:${detailModels.current.length}`,
                properties: { detailId: detail.id },
                wall: {
                  positions: ring.map(([lon, lat]) =>
                    Cesium.Cartesian3.fromDegrees(lon, lat),
                  ),
                  minimumHeights: ring.map(() => lower + 0.12),
                  maximumHeights: ring.map(
                    () => lower + Math.min(2.4, detail.upper - detail.lower),
                  ),
                  material: Cesium.Color.fromCssColorString("#f4f1e7"),
                  outline: true,
                  outlineColor: Cesium.Color.fromCssColorString("#b7c6b6"),
                },
              }),
            );
          }
    }
    v.scene.requestRender();
  }, [
    details,
    selectedDetailId,
    selectedDetailIds,
    explode,
    detailStyle,
    ready,
  ]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    boundaryModels.current.forEach((entity) => v.entities.remove(entity));
    boundaryModels.current = [];
    for (const boundary of boundaries) {
      geometryParts(boundary.geographicGeometry).forEach((geometry, part) => {
        const rings =
          geometry.type === "Polygon"
            ? geometry.coordinates
            : geometry.type === "MultiPolygon"
              ? geometry.coordinates.flat()
              : geometry.type === "LineString"
                ? [geometry.coordinates]
                : geometry.type === "MultiLineString"
                  ? geometry.coordinates
                  : [];
        rings.forEach((ring, index) => {
          if (!ring.length) return;
          boundaryModels.current.push(
            v.entities.add({
              id: `boundary:${boundary.id}:${part}:${index}`,
              name: boundary.name,
              position: Cesium.Cartesian3.fromDegrees(
                ring[0][0],
                ring[0][1],
                0.2,
              ),
              polyline: {
                positions: ring.map(([lon, lat]) =>
                  Cesium.Cartesian3.fromDegrees(lon, lat, 0.2),
                ),
                width: 2,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: Cesium.Color.fromCssColorString("#687c83"),
                  dashLength: 12,
                }),
              },
              label:
                index === 0
                  ? {
                      text: boundary.name,
                      show: labels,
                      font: "11px sans-serif",
                      fillColor: Cesium.Color.fromCssColorString("#52686d"),
                      showBackground: true,
                      backgroundColor: Cesium.Color.WHITE.withAlpha(0.85),
                      pixelOffset: new Cesium.Cartesian2(0, -12),
                      distanceDisplayCondition:
                        new Cesium.DistanceDisplayCondition(0, 280),
                    }
                  : undefined,
            }),
          );
        });
      });
    }
    v.scene.requestRender();
  }, [boundaries, labels, ready]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    issueModels.current.forEach((entity) => v.entities.remove(entity));
    issueModels.current = [];
    if (issueGeometry)
      geometryParts(issueGeometry).forEach((geometry, part) => {
        const polygons =
          geometry.type === "Polygon"
            ? [geometry.coordinates]
            : geometry.type === "MultiPolygon"
              ? geometry.coordinates
              : [];
        polygons.forEach((rings, index) =>
          issueModels.current.push(
            v.entities.add({
              id: `issue:${part}:polygon:${index}`,
              polygon: {
                hierarchy: hierarchy(rings),
                height: 0.3,
                material:
                  Cesium.Color.fromCssColorString("#da6b49").withAlpha(0.78),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString("#9c382e"),
              },
            }),
          ),
        );
        const lines =
          geometry.type === "LineString"
            ? [geometry.coordinates]
            : geometry.type === "MultiLineString"
              ? geometry.coordinates
              : [];
        lines.forEach((line, index) =>
          issueModels.current.push(
            v.entities.add({
              id: `issue:${part}:line:${index}`,
              polyline: {
                positions: line.map(([lon, lat]) =>
                  Cesium.Cartesian3.fromDegrees(lon, lat, 0.4),
                ),
                width: 7,
                material: Cesium.Color.fromCssColorString("#c44732"),
              },
            }),
          ),
        );
        const dots =
          geometry.type === "Point"
            ? [geometry.coordinates]
            : geometry.type === "MultiPoint"
              ? geometry.coordinates
              : [];
        dots.forEach(([lon, lat], index) =>
          issueModels.current.push(
            v.entities.add({
              id: `issue:${part}:point:${index}`,
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.5),
              point: {
                pixelSize: 12,
                color: Cesium.Color.fromCssColorString("#c44732"),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
              },
            }),
          ),
        );
      });
    v.scene.requestRender();
  }, [issueGeometry, ready]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !features.length) return;
    if (initialized.current === sceneKey) return;
    initialized.current = sceneKey;
    previousBlock.current = null;
    let saved = sessions.get(sceneKey).camera;
    try {
      saved ||= JSON.parse(
        sessionStorage.getItem(`ulpin-area-camera:v3:${sceneKey}`) || "null",
      ) as CameraState;
    } catch {
      /* Ignore expired camera storage. */
    }
    if (validCamera(saved)) restore(v, saved);
    else
      frame(
        v,
        latest.current.framingFeatureId
          ? features.filter((f) => f.id === latest.current.framingFeatureId)
          : features,
        latest.current.framingFeatureId ? undefined : geographicExtent,
        undefined,
        true,
        latest.current.frameScale,
      );
  }, [features, geographicExtent, sceneKey, ready]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !navigation.sequence) return;
    const current = latest.current;
    if (navigation.action.startsWith("orbit_")) {
      const feature = current.features.find(
        (f) => f.id === (current.framingFeatureId || current.selectedId),
      );
      const points = feature
        ? positions(feature.geographicGeometry).map(([lon, lat]) =>
            Cesium.Cartesian3.fromDegrees(
              lon,
              lat,
              feature.kind === "building" ? (feature.height.value || 0) / 2 : 0,
            ),
          )
        : [];
      if (points.length)
        orbitCamera(
          v,
          Cesium.BoundingSphere.fromPoints(points).center,
          navigation.action as OrbitDirection,
        );
      return;
    }
    if (navigation.action === "return" && previousBlock.current) {
      restore(v, previousBlock.current);
      previousBlock.current = null;
      return;
    }
    if (navigation.action === "zoom_in" || navigation.action === "zoom_out") {
      const amount = Math.max(5, v.camera.positionCartographic.height * 0.25);
      navigation.action === "zoom_in"
        ? v.camera.zoomIn(amount)
        : v.camera.zoomOut(amount);
      return;
    }
    if (navigation.action === "north" || navigation.action === "angle") {
      const state = snapshot(v);
      restore(v, {
        ...state,
        heading: navigation.action === "north" ? 0 : state.heading,
        pitch: Cesium.Math.toRadians(navigation.action === "angle" ? -48 : -70),
      });
      return;
    }
    const ids =
      navigation.action === "issue"
        ? new Set(current.highlightedIds)
        : new Set([current.selectedId]);
    const shown =
      navigation.action === "focus" || navigation.action === "issue"
        ? current.features.filter((feature) => ids.has(feature.id))
        : current.features;
    if (navigation.action === "focus" || navigation.action === "issue")
      previousBlock.current ||= snapshot(v);
    if (navigation.action === "fit" || navigation.action === "return")
      previousBlock.current = null;
    frame(
      v,
      shown,
      navigation.action === "fit" ? current.geographicExtent : undefined,
      navigation.action === "issue" ? current.issueGeometry : undefined,
      false,
      current.frameScale,
    );
  }, [navigation, ready]);

  return (
    <div className="area-cesium">
      <div
        className="area-cesium-host"
        data-scene-ready="false"
        ref={host}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Shared geographic 3D block; selecting a property preserves the camera"
      />
      {error && (
        <div className="area-view-error" role="alert">
          3D unavailable: {error}. The plan view remains available.
        </div>
      )}
      <span className="area-scene-note">
        {underground
          ? "Translucent context · only evidenced utility levels are underground"
          : "Shared block · relative building heights · no surveyed terrain"}
      </span>
      {(hasGoogleAttribution(features) || hasOsmAttribution(features)) && (
        <span className="area-source-credit">
          {hasGoogleAttribution(features) && <><a href="https://sites.research.google/gr/open-buildings/" target="_blank" rel="noreferrer">Google Open Buildings V3</a> · </>}
          {hasOsmAttribution(features) && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
          {" · ODbL"}
        </span>
      )}
    </div>
  );
}
function frame(
  v: Cesium.Viewer,
  features: PhysicalFeature[],
  extent?: AreaViewerProps["geographicExtent"],
  issue?: AreaGeometry | null,
  instant = false,
  frameScale = 3.2,
) {
  const points = features.flatMap((feature) =>
    positions(feature.geographicGeometry).map(([lon, lat]) =>
      Cesium.Cartesian3.fromDegrees(
        lon,
        lat,
        feature.kind === "building" ? (feature.height.value || 0) / 2 : 0,
      ),
    ),
  );
  if (extent) {
    const [west, south, east, north] = extent;
    points.push(
      ...[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
      ].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
    );
  }
  if (issue)
    points.push(
      ...positions(issue).map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat),
      ),
    );
  if (!points.length) return;
  const sphere = Cesium.BoundingSphere.fromPoints(points);
  if (instant) {
    v.camera.viewBoundingSphere(
      sphere,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-18),
        Cesium.Math.toRadians(-48),
        Math.max(30, sphere.radius * Math.max(1.8, frameScale)),
      ),
    );
    v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    v.scene.requestRender();
    return;
  }
  v.camera.flyToBoundingSphere(sphere, {
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 0.45,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(-18),
      Cesium.Math.toRadians(-48),
      Math.max(30, sphere.radius * Math.max(1.8, frameScale)),
    ),
  });
}

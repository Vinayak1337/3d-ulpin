"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { geometryParts, utilityScene } from "@/lib/officer-scene";
import type { AreaGeometry, PhysicalFeature } from "@ulpin/contracts";

export type AreaNavigation = {
  action:
    | "fit"
    | "focus"
    | "issue"
    | "return"
    | "north"
    | "angle"
    | "zoom_in"
    | "zoom_out";
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
  onSelectDetail?: (id: string) => void;
  underground?: boolean;
  labels?: boolean;
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
const cameraCache = new Map<string, CameraState>();
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
  feature.worldStatus === "synthetic"
    ? "#a88db5"
    : feature.kind === "road"
      ? "#939c9b"
      : feature.kind === "parcel"
        ? "#b59a57"
        : feature.kind === "public_land"
          ? "#80a681"
          : feature.kind === "utility"
            ? "#527a9f"
            : feature.height.state === "estimated"
              ? "#bfaa82"
              : "#aab9ab";
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

export default function AreaViewer(props: AreaViewerProps) {
  const {
    features,
    selectedId,
    navigation,
    geographicExtent,
    sceneKey = "area",
    highlightedIds = [],
    issueGeometry,
    details = [],
    boundaries = [],
    selectedDetailId,
    underground = false,
    labels = true,
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
    let v: Cesium.Viewer | undefined, observer: ResizeObserver | undefined;
    try {
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
        "/cesium/";
      (
        Cesium.buildModuleUrl as typeof Cesium.buildModuleUrl & {
          setBaseUrl: (url: string) => void;
        }
      ).setBaseUrl("/cesium/");
      v = new Cesium.Viewer(host.current, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        baseLayer: false,
        skyBox: false,
        skyAtmosphere: false,
        scene3DOnly: true,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });
      v.scene.globe.baseColor = Cesium.Color.fromCssColorString("#e9e9e1");
      v.scene.backgroundColor = Cesium.Color.fromCssColorString("#f2f2eb");
      v.scene.globe.enableLighting = false;
      v.scene.fog.enabled = false;
      v.scene.screenSpaceCameraController.minimumZoomDistance = 4;
      v.scene.screenSpaceCameraController.maximumZoomDistance = 20000000;
      v.scene.screenSpaceCameraController.enableCollisionDetection = false;
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
        cameraCache.set(key, state);
        try {
          sessionStorage.setItem(
            `ulpin-area-camera:v3:${key}`,
            JSON.stringify(state),
          );
        } catch {
          /* Camera persistence is optional when browser storage is unavailable. */
        }
      };
      v.camera.moveEnd.addEventListener(retain);
      v.scene.renderError.addEventListener((_scene, cause: Error) =>
        setError(cause.message),
      );
      observer = new ResizeObserver(() => {
        v?.resize();
        v?.scene.requestRender();
      });
      observer.observe(host.current);
      viewer.current = v;
      setReady(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "3D rendering is unavailable.",
      );
    }
    return () => {
      observer?.disconnect();
      if (v && !v.isDestroyed()) {
        if (
          initialized.current === (latest.current.sceneKey || "area") &&
          latest.current.features.length
        )
          cameraCache.set(latest.current.sceneKey || "area", snapshot(v));
        v.destroy();
      }
      viewer.current = null;
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
      polygons.forEach((rings, index) =>
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
              lon,
              lat,
              feature.kind === "building" ? (feature.height.value || 0) + 2 : 1,
            ),
            label: {
              text:
                feature.kind === "utility" && feature.name.length > 24
                  ? `${feature.name.slice(0, 23)}…`
                  : feature.name,
              font: "13px sans-serif",
              fillColor: Cesium.Color.fromCssColorString("#304036"),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
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
  }, [features, ready, labels]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const highlighted = new Set(highlightedIds);
    for (const feature of features) {
      const selected = feature.id === selectedId,
        affected = highlighted.has(feature.id),
        color = Cesium.Color.fromCssColorString(
          selected ? "#ba6746" : affected ? "#a45750" : baseColor(feature),
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
              : new Cesium.ColorMaterialProperty(color);
        if (entity.polylineVolume)
          entity.polylineVolume.material = new Cesium.ColorMaterialProperty(
            color.withAlpha(0.85),
          );
        if (entity.point)
          entity.point.color = new Cesium.ConstantProperty(color);
        if (entity.label) {
          entity.label.show = new Cesium.ConstantProperty(labels);
          entity.label.distanceDisplayCondition = new Cesium.ConstantProperty(
            new Cesium.DistanceDisplayCondition(
              0,
              selected || affected
                ? 1200
                : feature.kind === "parcel"
                  ? 45
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
              height: detail.lower,
              extrudedHeight: detail.upper,
              material: Cesium.Color.fromCssColorString(
                detail.id === selectedDetailId
                  ? "#c5734c"
                  : detail.kind === "space"
                    ? "#649697"
                    : "#819983",
              ).withAlpha(0.84),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString("#3e625f"),
            },
          }),
        ),
      );
    }
    v.scene.requestRender();
  }, [details, selectedDetailId, ready]);

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
    let saved = cameraCache.get(sceneKey);
    try {
      saved ||= JSON.parse(
        sessionStorage.getItem(`ulpin-area-camera:v3:${sceneKey}`) || "null",
      ) as CameraState;
    } catch {
      /* Ignore expired camera storage. */
    }
    if (saved && Object.values(saved).every(Number.isFinite)) restore(v, saved);
    else frame(v, features, geographicExtent, undefined, true);
  }, [features, geographicExtent, sceneKey, ready]);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !navigation.sequence) return;
    const current = latest.current;
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
    );
  }, [navigation, ready]);

  return (
    <div className="area-cesium">
      <div
        className="area-cesium-host"
        ref={host}
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
    </div>
  );
}
function frame(
  v: Cesium.Viewer,
  features: PhysicalFeature[],
  extent?: AreaViewerProps["geographicExtent"],
  issue?: AreaGeometry | null,
  instant = false,
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
        Math.max(30, sphere.radius * 3.2),
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
      Math.max(30, sphere.radius * 3.2),
    ),
  });
}

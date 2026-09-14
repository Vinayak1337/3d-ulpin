"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import type { AreaGeometry, PhysicalFeature } from "@ulpin/contracts";

export interface AreaViewerProps {
  features: PhysicalFeature[];
  geographicExtent?: [number, number, number, number] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  navigation: { action: "fit" | "focus"; sequence: number };
}

function coordinates(geometry: AreaGeometry): number[][] {
  const visit = (value: unknown): number[][] => {
    if (!Array.isArray(value)) return [];
    return typeof value[0] === "number"
      ? [value as number[]]
      : value.flatMap(visit);
  };
  return visit(geometry.coordinates);
}

export default function AreaViewer({
  features,
  geographicExtent,
  selectedId,
  onSelect,
  navigation,
}: AreaViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Cesium.Viewer | null>(null);
  const choose = useRef(onSelect);
  const models = useRef(new Map<string, Cesium.Entity[]>());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  choose.current = onSelect;

  useEffect(() => {
    if (!host.current) return;
    let instance: Cesium.Viewer | undefined;
    let observer: ResizeObserver | undefined;
    try {
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
        "/cesium/";
      (
        Cesium.buildModuleUrl as typeof Cesium.buildModuleUrl & {
          setBaseUrl: (url: string) => void;
        }
      ).setBaseUrl("/cesium/");
      instance = new Cesium.Viewer(host.current, {
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
      instance.scene.globe.baseColor =
        Cesium.Color.fromCssColorString("#e9e8df");
      instance.scene.backgroundColor =
        Cesium.Color.fromCssColorString("#f2f0eb");
      instance.scene.globe.enableLighting = false;
      instance.scene.fog.enabled = false;
      instance.scene.screenSpaceCameraController.minimumZoomDistance = 8;
      instance.scene.screenSpaceCameraController.maximumZoomDistance = 20000000;
      instance.scene.screenSpaceCameraController.enableCollisionDetection = false;
      instance.screenSpaceEventHandler.setInputAction(
        (event: { position: Cesium.Cartesian2 }) => {
          const picked = instance?.scene.pick(event.position) as
            { id?: Cesium.Entity } | undefined;
          const id = picked?.id?.properties?.featureId?.getValue();
          if (typeof id === "string") choose.current(id);
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
      instance.scene.renderError.addEventListener((_scene, cause: Error) =>
        setError(cause.message),
      );
      observer = new ResizeObserver(() => {
        instance?.resize();
        instance?.scene.requestRender();
      });
      observer.observe(host.current);
      viewer.current = instance;
      setReady(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "3D rendering is unavailable.",
      );
    }
    return () => {
      observer?.disconnect();
      if (instance && !instance.isDestroyed()) instance.destroy();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    v.entities.removeAll();
    models.current.clear();
    const hierarchy = (rings: number[][][]) =>
      new Cesium.PolygonHierarchy(
        rings[0].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
        rings
          .slice(1)
          .map(
            (ring) =>
              new Cesium.PolygonHierarchy(
                ring.map(([lon, lat]) =>
                  Cesium.Cartesian3.fromDegrees(lon, lat),
                ),
              ),
          ),
      );
    for (const feature of features) {
      const geometry = feature.geographicGeometry;
      const color = Cesium.Color.fromCssColorString(
        feature.worldStatus === "synthetic"
          ? "#a18daf"
          : feature.height.state === "estimated"
            ? "#bb9c6e"
            : "#9ba99a",
      );
      const material = new Cesium.ColorMaterialProperty(color.withAlpha(0.94));
      const entities: Cesium.Entity[] = [];
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      polygons.forEach((rings, index) => {
        entities.push(
          v.entities.add({
            id: `${feature.id}:polygon:${index}`,
            properties: { featureId: feature.id },
            polygon: {
              hierarchy: hierarchy(rings),
              height: 0,
              extrudedHeight:
                feature.height.value !== null && feature.height.value > 0
                  ? feature.height.value
                  : undefined,
              material,
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString("#526357"),
            },
          }),
        );
      });
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
                Cesium.Cartesian3.fromDegrees(lon, lat, 0.2),
              ),
              width: 3,
              material,
            },
          }),
        ),
      );
      if (geometry.type === "Point")
        entities.push(
          v.entities.add({
            id: feature.id,
            properties: { featureId: feature.id },
            position: Cesium.Cartesian3.fromDegrees(
              geometry.coordinates[0],
              geometry.coordinates[1],
              0.2,
            ),
            point: { pixelSize: 9, color },
          }),
        );
      if (geometry.type === "MultiPoint")
        geometry.coordinates.forEach(([longitude, latitude], index) =>
          entities.push(
            v.entities.add({
              id: `${feature.id}:point:${index}`,
              properties: { featureId: feature.id },
              position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0.2),
              point: { pixelSize: 9, color },
            }),
          ),
        );
      models.current.set(feature.id, entities);
    }
    v.scene.requestRender();
  }, [features, ready]);

  // Selection changes material properties without rebuilding geometry or moving the camera.
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    for (const feature of features) {
      const color = Cesium.Color.fromCssColorString(
        feature.id === selectedId
          ? "#c9734d"
          : feature.worldStatus === "synthetic"
            ? "#a18daf"
            : feature.height.state === "estimated"
              ? "#bb9c6e"
              : "#9ba99a",
      );
      for (const entity of models.current.get(feature.id) || []) {
        if (entity.polygon)
          entity.polygon.material = new Cesium.ColorMaterialProperty(
            color.withAlpha(0.94),
          );
        if (entity.polyline)
          entity.polyline.material = new Cesium.ColorMaterialProperty(color);
        if (entity.point)
          entity.point.color = new Cesium.ConstantProperty(color);
      }
    }
    v.scene.requestRender();
  }, [selectedId, features, ready]);

  const latestSelected = useRef(selectedId);
  latestSelected.current = selectedId;
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !features.length) return;
    const shown =
      navigation.action === "focus"
        ? features.filter((f) => f.id === latestSelected.current)
        : features;
    const points = shown.flatMap((f) =>
      coordinates(f.geographicGeometry).map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(
          lon,
          lat,
          Math.max(0, f.height.value || 0) / 2,
        ),
      ),
    );
    if (navigation.action === "fit" && geographicExtent) {
      const [west, south, east, north] = geographicExtent;
      points.push(
        ...[
          [west, south],
          [east, south],
          [east, north],
          [west, north],
        ].map(([longitude, latitude]) =>
          Cesium.Cartesian3.fromDegrees(longitude, latitude),
        ),
      );
    }
    if (!points.length) return;
    const sphere = Cesium.BoundingSphere.fromPoints(points);
    v.camera.flyToBoundingSphere(sphere, {
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 0.55,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-18),
        Cesium.Math.toRadians(-48),
        Math.max(80, sphere.radius * 2.6),
      ),
    });
  }, [features, geographicExtent, navigation, ready]);

  return (
    <div className="area-cesium">
      <div
        className="area-cesium-host"
        ref={host}
        aria-label="Geographic 3D exterior building view"
      />
      {error && (
        <div className="area-view-error" role="alert">
          3D unavailable: {error}. Use the 2D view to inspect this area.
        </div>
      )}
      <span className="area-scene-note">
        Geographic positions · building-relative ground · no terrain survey
      </span>
    </div>
  );
}

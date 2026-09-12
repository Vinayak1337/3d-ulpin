"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import earcut from "earcut";
import type { Finding, ModelSnapshot, Point2 } from "@ulpin/contracts";
import { AlertTriangle, Minus, Plus, RotateCcw } from "lucide-react";
import { boundsOf, unitColor } from "@/lib/ui/geometry";

interface Props {
  model: ModelSnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
  floor: string;
  isolate: boolean;
  explode: number;
  finding: Finding | null;
}

export default function SpatialViewer({
  model,
  selectedId,
  onSelect,
  floor,
  isolate,
  explode,
  finding,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Cesium.Viewer | null>(null);
  const choose = useRef(onSelect);
  choose.current = onSelect;
  const resetCamera = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [heading, setHeading] = useState(32);

  useEffect(() => {
    if (!container.current) return;
    let instance: Cesium.Viewer | undefined;
    try {
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
        "/cesium/";
      (
        Cesium.buildModuleUrl as typeof Cesium.buildModuleUrl & {
          setBaseUrl: (url: string) => void;
        }
      ).setBaseUrl("/cesium/");
      instance = new Cesium.Viewer(container.current, {
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
        globe: false,
        baseLayer: false,
        skyBox: false,
        skyAtmosphere: false,
        scene3DOnly: true,
        requestRenderMode: true,
        contextOptions: { webgl: { alpha: true, antialias: true } },
      });
      instance.scene.backgroundColor =
        Cesium.Color.fromCssColorString("#eeeae2");
      instance.scene.fog.enabled = false;
      instance.scene.light = new Cesium.DirectionalLight({
        direction: new Cesium.Cartesian3(-1, -0.5, -0.7),
        intensity: 2.2,
      });
      if (instance.scene.sun) instance.scene.sun.show = false;
      if (instance.scene.moon) instance.scene.moon.show = false;
      instance.scene.screenSpaceCameraController.minimumZoomDistance = 0.8;
      instance.scene.screenSpaceCameraController.maximumZoomDistance = 400;
      instance.scene.screenSpaceCameraController.enableCollisionDetection = false;
      instance.camera.changed.addEventListener(() => {
        if (instance && !instance.isDestroyed())
          setHeading(-Cesium.Math.toDegrees(instance.camera.heading));
      });
      instance.cesiumWidget.creditContainer.setAttribute(
        "aria-label",
        "Cesium attribution",
      );
      instance.screenSpaceEventHandler.setInputAction(
        (event: { position: Cesium.Cartesian2 }) => {
          const picked = instance?.scene.pick(event.position) as
            | { id?: string }
            | undefined;
          if (
            typeof picked?.id === "string" &&
            !picked.id.startsWith("context:") &&
            !picked.id.startsWith("overlap:")
          )
            choose.current(picked.id);
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
      viewer.current = instance;
      setReady(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "3D graphics could not be initialized.",
      );
      instance?.destroy();
    }
    return () => {
      if (instance && !instance.isDestroyed()) instance.destroy();
      viewer.current = null;
    };
  }, []);

  const didFrame = useRef<string | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const primitives = v.scene.primitives;
    primitives.removeAll();
    const allBounds = boundsOf([
      ...model.units.map((u) => u.footprint),
      ...model.context.map((c) => c.footprint),
    ]);
    const origin = Cesium.Cartesian3.fromDegrees(0, 0, 0);
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const position = (x: number, y: number, z: number) =>
      Cesium.Matrix4.multiplyByPoint(
        transform,
        new Cesium.Cartesian3(x, y, z),
        new Cesium.Cartesian3(),
      );
    const lineCollection = new Cesium.PolylineCollection();
    const line = (
      ring: Point2[],
      z: number,
      color: string,
      width = 1.2,
      close = true,
    ) => {
      const points = close ? [...ring, ring[0]] : ring;
      lineCollection.add({
        positions: points.map(([x, y]) => position(x, y, z)),
        width,
        material: Cesium.Material.fromType("Color", {
          color: Cesium.Color.fromCssColorString(color),
        }),
      });
    };
    const mesh = (
      ring: Point2[],
      lower: number,
      upper: number,
      color: string,
      id: string,
      alpha = 1,
    ) => {
      if (ring.length < 3) return;
      const coordinates: number[] = [];
      const normals: number[] = [];
      const triangles = earcut(ring.flat());
      const count = ring.length;
      const indices: number[] = [];
      const vertex = (
        x: number,
        y: number,
        z: number,
        nx: number,
        ny: number,
        nz: number,
      ) => {
        const p = position(x, y, z);
        const normal = Cesium.Matrix4.multiplyByPointAsVector(
          transform,
          new Cesium.Cartesian3(nx, ny, nz),
          new Cesium.Cartesian3(),
        );
        coordinates.push(p.x, p.y, p.z);
        normals.push(normal.x, normal.y, normal.z);
      };
      for (const [x, y] of ring) vertex(x, y, lower, 0, 0, -1);
      for (const [x, y] of ring) vertex(x, y, upper, 0, 0, 1);
      for (let n = 0; n < triangles.length; n += 3) {
        indices.push(triangles[n + 2], triangles[n + 1], triangles[n]);
        indices.push(
          triangles[n] + count,
          triangles[n + 1] + count,
          triangles[n + 2] + count,
        );
      }
      const orientation = Math.sign(
        ring.reduce(
          (sum, p, n) =>
            sum +
            p[0] * ring[(n + 1) % count][1] -
            ring[(n + 1) % count][0] * p[1],
          0,
        ),
      );
      for (let n = 0; n < count; n++) {
        const next = (n + 1) % count;
        const dx = ring[next][0] - ring[n][0],
          dy = ring[next][1] - ring[n][1];
        const distance = Math.hypot(dx, dy) || 1;
        const nx = (dy / distance) * orientation,
          ny = (-dx / distance) * orientation;
        const first = coordinates.length / 3;
        vertex(ring[n][0], ring[n][1], lower, nx, ny, 0);
        vertex(ring[next][0], ring[next][1], lower, nx, ny, 0);
        vertex(ring[next][0], ring[next][1], upper, nx, ny, 0);
        vertex(ring[n][0], ring[n][1], upper, nx, ny, 0);
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      }
      const attributes = new Cesium.GeometryAttributes();
      attributes.position = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: new Float64Array(coordinates),
      });
      attributes.normal = new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: new Float32Array(normals),
      });
      const geometry = new Cesium.Geometry({
        attributes,
        indices: new Uint32Array(indices),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(coordinates),
      });
      primitives.add(
        new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({
            geometry,
            id,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(color).withAlpha(alpha),
              ),
            },
          }),
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: false,
            translucent: alpha < 1,
            closed: false,
            renderState: {
              depthTest: { enabled: true },
              cull: { enabled: false },
            },
          }),
          asynchronous: false,
        }),
      );
      line(
        ring,
        lower,
        id === selectedId ? "#134e4a" : "#66736e",
        id === selectedId ? 2.2 : 1.2,
      );
      line(
        ring,
        upper,
        id === selectedId ? "#134e4a" : "#66736e",
        id === selectedId ? 2.2 : 1.2,
      );
      for (const [x, y] of ring)
        lineCollection.add({
          positions: [position(x, y, lower), position(x, y, upper)],
          width: id === selectedId ? 2 : 1,
          material: Cesium.Material.fromType("Color", {
            color: Cesium.Color.fromCssColorString(
              id === selectedId ? "#134e4a" : "#66736e",
            ),
          }),
        });
    };
    const bottom = Math.min(0, ...model.units.map((u) => u.lower)) - 0.08;
    const margin = Math.max(allBounds.width, allBounds.height) * 0.18;
    const startX = Math.floor(allBounds.minX - margin),
      endX = Math.ceil(allBounds.maxX + margin);
    const startY = Math.floor(allBounds.minY - margin),
      endY = Math.ceil(allBounds.maxY + margin);
    const step = Math.max(1, Math.ceil((endX - startX) / 70));
    for (let x = startX; x <= endX; x += step)
      line(
        [
          [x, startY],
          [x, endY],
        ],
        bottom,
        "#d9d6ce",
        1,
        false,
      );
    for (let y = startY; y <= endY; y += step)
      line(
        [
          [startX, y],
          [endX, y],
        ],
        bottom,
        "#d9d6ce",
        1,
        false,
      );
    model.context.forEach((c) => {
      line(
        c.footprint,
        c.kind === "parcel" ? bottom + 0.02 : 0.015,
        c.kind === "parcel" ? "#bcb19d" : "#99957e",
        c.kind === "parcel" ? 1.5 : 1,
      );
    });
    const levelOrder = [
      ...new Set(
        model.units
          .filter((u) => u.lower >= 0)
          .sort((a, b) => a.lower - b.lower)
          .map((u) => u.levelLabel),
      ),
    ];
    model.units.forEach((unit) => {
      if (
        (floor !== "all" && (unit.levelLabel || "Unassigned") !== floor) ||
        (isolate && unit.id !== selectedId)
      )
        return;
      const rank = unit.lower < 0 ? -1 : levelOrder.indexOf(unit.levelLabel);
      const offset = rank * explode;
      const involved = finding?.unitIds.includes(unit.id);
      mesh(
        unit.footprint,
        unit.lower + offset,
        unit.upper + offset,
        unit.id === selectedId
          ? "#56a89d"
          : involved
            ? "#bda995"
            : unitColor(unit),
        unit.id,
        finding?.overlap ? 0.32 : 1,
      );
    });
    if (finding?.overlap) {
      const overlap = finding.overlap;
      mesh(
        overlap.footprint,
        overlap.lower - 0.015,
        overlap.upper + 0.015,
        "#da553a",
        `overlap:${finding.id}`,
        0.95,
      );
    }
    primitives.add(lineCollection);
    const unitBounds = boundsOf(model.units.map((u) => u.footprint));
    const maxElevation = Math.max(...model.units.map((u) => u.upper));
    const minElevation = Math.min(...model.units.map((u) => u.lower));
    const center = position(
      unitBounds.minX + unitBounds.width / 2,
      unitBounds.minY + unitBounds.height / 2,
      (maxElevation + minElevation) / 2,
    );
    const range =
      Math.max(
        unitBounds.width,
        unitBounds.height,
        maxElevation - minElevation,
        10,
      ) * 2.7;
    resetCamera.current = () => {
      v.camera.lookAt(
        center,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(328),
          Cesium.Math.toRadians(-32),
          range,
        ),
      );
      v.scene.requestRender();
    };
    if (didFrame.current !== model.caseId) {
      resetCamera.current();
      didFrame.current = model.caseId;
    }
    v.scene.requestRender();
  }, [model, selectedId, floor, isolate, explode, finding, ready]);

  return (
    <div className="spatial-viewer">
      <div
        className="cesium-host"
        ref={container}
        aria-label="Interactive 3D property model"
      />
      {error && (
        <div className="viewer-error">
          <AlertTriangle size={24} />
          <strong>3D graphics unavailable</strong>
          <span>{error}</span>
          <span>Switch to Plan to inspect and edit the geometry.</span>
        </div>
      )}
      {!error && (
        <>
          <div
            className="orientation"
            title="Local Y axis; this is a schematic display frame"
          >
            <span>Y+</span>
            <svg
              style={{ transform: `rotate(${heading}deg)` }}
              width="36"
              height="42"
              viewBox="0 0 36 42"
            >
              <path d="M18 3 28 33 18 27 8 33Z" fill="#566b63" />
              <path d="M18 3v24L8 33Z" fill="#b1bcb4" />
            </svg>
          </div>
          <div className="camera-controls">
            <button
              className="icon-button"
              onClick={() => {
                viewer.current?.camera.zoomIn(4);
                viewer.current?.scene.requestRender();
              }}
              aria-label="Zoom in"
            >
              <Plus size={17} />
            </button>
            <button
              className="icon-button"
              onClick={() => {
                viewer.current?.camera.zoomOut(4);
                viewer.current?.scene.requestRender();
              }}
              aria-label="Zoom out"
            >
              <Minus size={17} />
            </button>
            <button
              className="icon-button"
              onClick={() => resetCamera.current()}
              aria-label="Reset camera"
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="scene-help">
            Drag to orbit <span>·</span> Scroll to zoom <span>·</span> Click a
            space to inspect
          </div>
        </>
      )}
    </div>
  );
}

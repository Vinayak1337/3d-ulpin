"use client";

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import type { Finding, ModelSnapshot, Point2 } from "@ulpin/contracts";
import { ArrowCounterClockwise, Buildings, CubeTransparent, Minus, Plus, StackSimple, Warning } from "@/lib/ui/icons";
import { boundsOf, unitColor } from "@/lib/ui/geometry";
import { buildBuildingScene, createPrismMesh, inferBuildingGrade, type SceneMesh } from "@/lib/ui/building-scene";
import styles from "@/components/SpatialViewer.module.css";
import { createMapRuntime, type MapRuntime } from "../engine/runtime";

export interface LocalModelProps {
  model: ModelSnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
  floor: string;
  isolate: boolean;
  explode: number;
  finding: Finding | null;
  siteView?: boolean;
  initialPresentation?: "building" | "volumes";
  focusTarget?: {footprint: Point2[]; lower?: number; upper?: number; sequence: number};
}

export default function LocalModelLayer({ model, selectedId, onSelect, floor, isolate, explode, finding, initialPresentation = "building", siteView = false, focusTarget }: LocalModelProps) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Cesium.Viewer | null>(null);
  const choose = useRef(onSelect);
  choose.current = onSelect;
  const resetCamera = useRef<() => void>(() => {});
  const lastFocus = useRef<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [preferredPresentation, setPreferredPresentation] = useState<"building" | "volumes">(initialPresentation);
  const [basementSection, setBasementSection] = useState(false);
  const [dismissedFinding, setDismissedFinding] = useState<string | null>(null);
  useEffect(() => { setDismissedFinding(null); }, [finding?.id]);
  const presentation = finding && dismissedFinding !== finding.id ? "volumes" : preferredPresentation;
  const analyticalFinding = presentation === "volumes" ? finding : null;
  const datum = inferBuildingGrade(model.units);
  const selectedUnit = model.units.find(unit => unit.id === selectedId);
  const belowGrade = (unit: ModelSnapshot["units"][number]) => unit.kind === "basement" || unit.upper <= datum;
  const hasBasement = model.units.some(belowGrade);
  const revealBasement = basementSection || !!selectedUnit && belowGrade(selectedUnit) || explode > 0 || model.units.some(unit => belowGrade(unit) && floor !== "all" && unit.levelLabel === floor);
  const visibleUnits = model.units.filter(unit => {
    if (analyticalFinding?.unitIds.includes(unit.id)) return true;
    if (floor !== "all" && (unit.levelLabel || "Unassigned") !== floor) return false;
    if (isolate && unit.id !== selectedId) return false;
    return presentation === "volumes" || revealBasement || !belowGrade(unit);
  });

  useEffect(() => {
    if (!container.current) return;
    let instance: Cesium.Viewer | undefined;
    let runtime: MapRuntime | undefined;
    try {
      runtime = createMapRuntime(container.current, "local", message => setError(message));
      instance = runtime.viewer;
      instance.scene.screenSpaceCameraController.minimumZoomDistance = 1.5;
      instance.scene.screenSpaceCameraController.maximumZoomDistance = 250;
      instance.scene.screenSpaceCameraController.enableCollisionDetection = false;
      instance.camera.frustum.near = 0.15;
      instance.camera.frustum.far = 600;
      instance.screenSpaceEventHandler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
        const picked = instance?.scene.pick(event.position) as { id?: string } | undefined;
        if (typeof picked?.id === "string" && !picked.id.startsWith("context:") && !picked.id.startsWith("overlap:")) choose.current(picked.id);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      viewer.current = instance;
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "3D graphics could not be initialized.");
      runtime?.destroy();
    }
    return () => {
      runtime?.destroy();
      viewer.current = null;
    };
  }, []);

  const didFrame = useRef<string | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const primitives = v.scene.primitives;
    primitives.removeAll();
    const origin = Cesium.Cartesian3.fromDegrees(0, 0, 0);
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const position = (x: number, y: number, z: number) => Cesium.Matrix4.multiplyByPoint(transform, new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3());
    const vector = (x: number, y: number, z: number) => Cesium.Matrix4.multiplyByPointAsVector(transform, new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3());
    const lineCollection = new Cesium.PolylineCollection();
    const line = (ring: Point2[], z: number, color: string, width = 1.2, close = true) => {
      if (ring.length < 2) return;
      lineCollection.add({ positions: (close ? [...ring, ring[0]] : ring).map(([x, y]) => position(x, y, z)), width, material: Cesium.Material.fromType("Color", { color: Cesium.Color.fromCssColorString(color) }) });
    };
    const outline = (ring: Point2[], lower: number, upper: number, color: string, width: number) => {
      line(ring, lower, color, width);
      line(ring, upper, color, width);
      for (const [x, y] of ring) lineCollection.add({ positions: [position(x, y, lower), position(x, y, upper)], width, material: Cesium.Material.fromType("Color", { color: Cesium.Color.fromCssColorString(color) }) });
    };
    const levels = [...new Set(model.units.filter(unit => !belowGrade(unit)).slice().sort((a, b) => a.lower - b.lower).map(unit => unit.levelLabel))];
    // Findings always use measured coordinates. Decorative separation would
    // otherwise move their spaces away from the true intersection region.
    const separation = analyticalFinding ? 0 : explode;
    const offsets = new Map(model.units.map(unit => [unit.id, (belowGrade(unit) ? -1 : Math.max(0, levels.indexOf(unit.levelLabel))) * separation]));
    const building = buildBuildingScene(model, visibleUnits, offsets, revealBasement);
    const meshes: SceneMesh[] = presentation === "building" ? building.meshes : [];
    if (presentation === "volumes") {
      const allBounds = boundsOf([...model.units.map(unit => unit.footprint), ...model.context.map(context => context.footprint)]);
      const bottom = Math.min(datum, ...model.units.map(unit => unit.lower + (offsets.get(unit.id) || 0))) - 0.08;
      const margin = Math.max(allBounds.width, allBounds.height) * 0.13;
      const startX = Math.floor(allBounds.minX - margin), endX = Math.ceil(allBounds.maxX + margin);
      const startY = Math.floor(allBounds.minY - margin), endY = Math.ceil(allBounds.maxY + margin);
      const step = Math.max(1, Math.ceil((endX - startX) / 60));
      for (let x = startX; x <= endX; x += step) line([[x, startY], [x, endY]], bottom, "#dedbd3", 1, false);
      for (let y = startY; y <= endY; y += step) line([[startX, y], [endX, y]], bottom, "#dedbd3", 1, false);
      model.context.forEach(context => line(context.footprint, context.kind === "parcel" ? bottom + 0.02 : datum + 0.015, context.kind === "parcel" ? "#bcb19d" : "#99957e", 1.2));
      if (siteView) {
        const labels = primitives.add(new Cesium.LabelCollection());
        for (const context of model.context.filter(c => c.kind === "building")) {
          const b = boundsOf([context.footprint]);
          const members = visibleUnits.filter(u => { const p = boundsOf([u.footprint]); return p.minX >= b.minX && p.maxX <= b.maxX && p.minY >= b.minY && p.maxY <= b.maxY; });
          if (!members.length) continue;
          const top = Math.max(datum, ...members.map(u => u.upper));
          outline(context.footprint, datum, top, "#505b55", 2);
          labels.add({position: position(b.minX + b.width / 2, b.minY + b.height / 2, top + 1), text: context.name || context.alias, font: "13px Helvetica", fillColor: Cesium.Color.fromCssColorString("#303731"), showBackground: true, backgroundColor: Cesium.Color.fromCssColorString("#fafaf6").withAlpha(0.94), backgroundPadding: new Cesium.Cartesian2(9, 6), disableDepthTestDistance: Number.POSITIVE_INFINITY});
        }
      }
      for (const unit of visibleUnits) {
        const offset = offsets.get(unit.id) || 0;
        const color = unit.id === selectedId ? "#56a89d" : analyticalFinding?.unitIds.includes(unit.id) ? "#bda995" : siteView ? (belowGrade(unit) ? "#a4b2b6" : unit.kind === "common" ? "#d3c29f" : "#b0c0a5") : unitColor(unit);
        meshes.push(createPrismMesh(unit.footprint, unit.lower + offset, unit.upper + offset, color, unit.id, analyticalFinding?.overlap ? 0.32 : 1));
        outline(unit.footprint, unit.lower + offset, unit.upper + offset, unit.id === selectedId ? "#134e4a" : "#66736e", unit.id === selectedId ? 2.2 : 1.2);
      }
      if (analyticalFinding?.overlap) {
        const overlap = analyticalFinding.overlap;
        meshes.push(createPrismMesh(overlap.footprint, overlap.lower, overlap.upper, "#da553a", `overlap:${analyticalFinding.id}`, 0.95));
        outline(overlap.footprint, overlap.lower, overlap.upper, "#a93225", 2.1);
      }
    } else if (selectedUnit && visibleUnits.some(unit => unit.id === selectedUnit.id)) {
      const offset = offsets.get(selectedUnit.id) || 0;
      outline(selectedUnit.footprint, selectedUnit.lower + offset, selectedUnit.upper + offset + 0.055, "#58684e", 2.25);
    }

    // Batch façade elements by material, while instance IDs retain unit picking.
    const materialGroups = new Map<string, { mesh: SceneMesh; instances: Cesium.GeometryInstance[] }>();
    for (const mesh of meshes) {
      if (!mesh.indices.length) continue;
      const coordinates: number[] = [], normals: number[] = [];
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const p = position(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
        const n = vector(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
        coordinates.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
      }
      const attributes = new Cesium.GeometryAttributes();
      attributes.position = new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(coordinates) });
      attributes.normal = new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(normals) });
      const geometry = new Cesium.Geometry({ attributes, indices: new Uint32Array(mesh.indices), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(coordinates) });
      const key = `${mesh.material}:${mesh.color}:${mesh.alpha}`;
      if (!materialGroups.has(key)) materialGroups.set(key, { mesh, instances: [] });
      materialGroups.get(key)!.instances.push(new Cesium.GeometryInstance({ geometry, id: mesh.ownerId, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(mesh.color).withAlpha(mesh.alpha)) } }));
    }
    for (const { mesh, instances } of materialGroups.values()) {
      // Keep cast shadows on the site without self-shadow stripes on thin façades.
      const receivesShadows = ["site", "paving", "soil"].includes(mesh.material);
      const shadows = presentation === "building" && mesh.alpha === 1
        ? receivesShadows ? Cesium.ShadowMode.RECEIVE_ONLY : Cesium.ShadowMode.CAST_ONLY
        : Cesium.ShadowMode.DISABLED;
      primitives.add(new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: mesh.alpha < 1, closed: mesh.alpha === 1, renderState: { depthTest: { enabled: true }, cull: { enabled: mesh.alpha === 1 } } }),
        asynchronous: false,
        shadows,
      }));
    }
    primitives.add(lineCollection);
    v.shadows = presentation === "building";
    const direction = presentation === "building" ? building.lightDirection : [0.55, 0.75, -1.65];
    v.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(vector(direction[0], direction[1], direction[2]), new Cesium.Cartesian3()), intensity: 1.8 });

    const framedUnits = visibleUnits.length ? visibleUnits : model.units;
    const unitBounds = boundsOf(framedUnits.map(unit => unit.footprint));
    const maxElevation = Math.max(...framedUnits.map(unit => unit.upper + (offsets.get(unit.id) || 0))) + (presentation === "building" ? 0.39 : 0);
    const minElevation = presentation === "building" && !revealBasement ? datum : Math.min(datum, ...framedUnits.map(unit => unit.lower + (offsets.get(unit.id) || 0)));
    const center = position(unitBounds.minX + unitBounds.width / 2, unitBounds.minY + unitBounds.height / 2, (maxElevation + minElevation) / 2 - (presentation === "building" ? 0.45 : 0));
    const range = Math.max(unitBounds.width, unitBounds.height, maxElevation - minElevation, 7) * (siteView ? 2.1 : presentation === "building" ? 2.48 : 2.65);
    v.camera.frustum.far = Math.max(600, range * 6);
    v.scene.screenSpaceCameraController.maximumZoomDistance = Math.max(250, range * 3);
    resetCamera.current = () => {
      v.camera.lookAt(center, new Cesium.HeadingPitchRange(building.cameraHeading, Cesium.Math.toRadians(presentation === "building" && !revealBasement ? -25 : -32), range));
      v.scene.requestRender();
    };
    const frameKey = `${model.caseId}:${presentation}:${revealBasement ? "section" : "exterior"}:${floor}:${isolate ? selectedId : "all"}`;
    if (didFrame.current !== frameKey) {
      resetCamera.current();
      didFrame.current = frameKey;
    }
    if (focusTarget && lastFocus.current !== focusTarget.sequence) {
      const bounds = boundsOf([focusTarget.footprint]);
      const lower = focusTarget.lower ?? minElevation, upper = focusTarget.upper ?? maxElevation;
      const target = position(bounds.minX + bounds.width / 2, bounds.minY + bounds.height / 2, (lower + upper) / 2);
      v.camera.lookAt(target, new Cesium.HeadingPitchRange(building.cameraHeading, Cesium.Math.toRadians(-32), Math.max(bounds.width, bounds.height, upper - lower, 7) * (siteView ? 2.1 : 2.65)));
      lastFocus.current = focusTarget.sequence;
    }
    v.scene.requestRender();
  }, [model, selectedId, floor, isolate, explode, finding, ready, presentation, revealBasement, focusTarget, siteView]);

  return <div className={`spatial-viewer ${styles.viewer}`} data-presentation={presentation} data-visible-unit-count={visibleUnits.length} data-basement-revealed={presentation === "volumes" || revealBasement ? "true" : "false"}>
    <div className="cesium-host" ref={container} aria-label="Interactive 3D property model" />
    {error ? <div className={styles.error} role="alert"><Warning size={25} weight="bold" /><strong>3D graphics unavailable</strong><span>{error}</span><span>Switch to Plan to inspect and edit the geometry.</span></div> : <>
      {!siteView && <div className={styles.presentation} role="group" aria-label="3D presentation">
        <button type="button" aria-pressed={presentation === "building"} onClick={() => {
          setPreferredPresentation("building");
          setDismissedFinding(finding?.id || null);
          const returnUnitId = selectedId || finding?.unitIds[0];
          if (finding && returnUnitId) choose.current(returnUnitId);
        }}><Buildings size={16} weight={presentation === "building" ? "fill" : "regular"} />Building</button>
        <button type="button" aria-pressed={presentation === "volumes"} onClick={() => setPreferredPresentation("volumes")}><CubeTransparent size={16} weight={presentation === "volumes" ? "fill" : "regular"} />Property volumes</button>
      </div>}
      {presentation === "building" && hasBasement && <button type="button" className={styles.section} aria-pressed={revealBasement} onClick={() => setBasementSection(value => !value)} title={selectedUnit && belowGrade(selectedUnit) ? "Selected basement is revealed" : "Cut the illustrative site to inspect below grade"}><StackSimple size={16} weight={revealBasement ? "fill" : "regular"} />Reveal basement</button>}
      {!siteView && <div className={styles.frameLabel}>LOCAL FRAME<span>METRES</span></div>}
      <div className={styles.camera} role="group" aria-label="Camera controls">
        <button type="button" onClick={() => { viewer.current?.camera.zoomIn(3); viewer.current?.scene.requestRender(); }} aria-label="Zoom in"><Plus size={17} weight="bold" /></button>
        <button type="button" onClick={() => { viewer.current?.camera.zoomOut(3); viewer.current?.scene.requestRender(); }} aria-label="Zoom out"><Minus size={17} weight="bold" /></button>
        <button type="button" onClick={() => resetCamera.current()} aria-label="Reset camera"><ArrowCounterClockwise size={17} weight="bold" /></button>
      </div>
      {!siteView && <div className={styles.caption}><span className={styles.captionDot} />{presentation === "building" ? "Conceptual façade · measured spaces unchanged" : finding ? "Finding at measured coordinates · exact property volumes" : "Computed property spaces · local metres"}</div>}
      <div className={styles.help}>Drag to orbit<span>·</span>Scroll to zoom<span>·</span>Click a space</div>
    </>}
  </div>;
}

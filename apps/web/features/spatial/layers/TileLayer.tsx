"use client";
import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { createMapRuntime } from "../engine/runtime";
import { useSpatialServices } from "../data/Provider";
import type { MapCamera, MapSelection } from "../data/session";
import "../viewport.css";
import { enuToEcef, transformPoint, type SpatialRepresentation, type SpatialFrame } from "@ulpin/contracts";
import { MeshBuilder } from "../compiler/mesh";
export interface TileNavigation {
    sequence: number;
    action: "fit" | "neighbourhood" | "focus" | "north" | "zoom_in" | "zoom_out";
    /** Already transformed ECEF target; never reinterpret local coordinates as longitude/latitude. */
    target?: readonly [
        number,
        number,
        number
    ];
}
export interface TileTelemetry {
    ready: boolean;
    loadedTiles: number;
    tileBytes: number;
    camera: MapCamera;
}
export interface TileLayerProps {
    manifestUrl: string;
    sessionKey: string;
    selection: MapSelection | null;
    onSelect: (selection: MapSelection | null) => void;
    mode: "3d" | "2d";
    navigation: TileNavigation;
    visibleKinds?: readonly string[];
    inspection?: {
        representation: SpatialRepresentation;
        frame: SpatialFrame;
        parentId?: string;
    };
    onTelemetry?: (state: TileTelemetry) => void;
}
const snapshotCamera = (viewer: Cesium.Viewer): MapCamera => ({
    longitude: viewer.camera.positionCartographic.longitude,
    latitude: viewer.camera.positionCartographic.latitude,
    height: viewer.camera.positionCartographic.height,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
    roll: viewer.camera.roll,
});
const safeExpression = (text: string) => JSON.stringify(text);
/** A geometry-source adapter. The shared runtime owns every WebGL/control lifecycle. */
export default function TileLayer(props: TileLayerProps) {
    const { sessions } = useSpatialServices();
    const host = useRef<HTMLDivElement>(null);
    const active = useRef<{
        viewer: Cesium.Viewer;
        tileset: Cesium.Cesium3DTileset;
    } | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [error, setError] = useState("");
    const [ready, setReady] = useState(false);
    const [retry, setRetry] = useState(0);
    const appliedMode = useRef(props.mode);
    useEffect(() => {
        if (!host.current)
            return;
        const currentHost = host.current;
        setError("");
        setReady(false);
        let disposed = false;
        let runtime: ReturnType<typeof createMapRuntime> | undefined;
        try {
            runtime = createMapRuntime(currentHost, "world", setError);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : "Map engine failed to initialize");
            return;
        }
        const viewer = runtime.viewer;
        viewer.scene.screenSpaceCameraController.tiltEventTypes = [Cesium.CameraEventType.RIGHT_DRAG, Cesium.CameraEventType.PINCH];
        viewer.scene.screenSpaceCameraController.lookEventTypes = [];
        viewer.canvas.tabIndex = 0;
        viewer.canvas.setAttribute("aria-label", "Interactive 3D map. Drag to pan, right-drag to orbit, scroll to zoom.");
        const focus = () => viewer.canvas.focus({ preventScroll: true });
        viewer.canvas.addEventListener("pointerdown", focus);
        runtime.onCleanup(() => viewer.canvas.removeEventListener("pointerdown", focus));
        const keyboard = (event: KeyboardEvent) => {
            if (!event.key.startsWith("Arrow"))
                return;
            event.preventDefault();
            const step = Math.max(2, viewer.camera.positionCartographic.height * .025);
            if (event.key === "ArrowLeft")
                viewer.camera.moveLeft(step);
            if (event.key === "ArrowRight")
                viewer.camera.moveRight(step);
            if (event.key === "ArrowUp")
                viewer.camera.moveUp(step);
            if (event.key === "ArrowDown")
                viewer.camera.moveDown(step);
            viewer.scene.requestRender();
        };
        viewer.canvas.addEventListener("keydown", keyboard);
        runtime.onCleanup(() => viewer.canvas.removeEventListener("keydown", keyboard));
        const retainCamera = () => {
            if (!disposed && active.current?.viewer === viewer)
                sessions.patch(props.sessionKey, { camera: snapshotCamera(viewer) });
        };
        runtime.onCleanup(viewer.camera.moveEnd.addEventListener(retainCamera));
        const loaded = new Set<Cesium.Cesium3DTile>();
        let lastReport = 0;
        let reportedReady = false;
        runtime.onCleanup(viewer.scene.postRender.addEventListener(() => {
            const state = active.current;
            if (disposed || state?.viewer !== viewer)
                return;
            const tileset = state.tileset;
            const now = performance.now();
            if (now - lastReport < 350 && reportedReady === tileset.tilesLoaded)
                return;
            lastReport = now;
            reportedReady = tileset.tilesLoaded;
            currentHost.dataset.sceneReady = String(tileset.tilesLoaded);
            currentHost.dataset.loadedTiles = String(loaded.size);
            const camera = snapshotCamera(viewer);
            currentHost.dataset.camera = JSON.stringify(camera);
            latest.current.onTelemetry?.({ ready: tileset.tilesLoaded, loadedTiles: loaded.size, tileBytes: tileset.totalMemoryUsageInBytes, camera });
        }));
        viewer.screenSpaceEventHandler.setInputAction((event: {
            position: Cesium.Cartesian2;
        }) => {
            const picked = viewer.scene.pick(event.position);
            if (picked && typeof picked.getProperty === "function") {
                const entityId = picked.getProperty("entityId"), representationId = picked.getProperty("representationId");
                if (typeof entityId === "string" && typeof representationId === "string")
                    latest.current.onSelect({ entityId, representationId });
            }
            else if (picked?.id?.entityId) {
                latest.current.onSelect({ entityId: picked.id.entityId, representationId: picked.id.representationId });
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        void Cesium.Cesium3DTileset.fromUrl(props.manifestUrl, {
            maximumScreenSpaceError: 12,
        featureIdLabel: "entity",
            cacheBytes: 128 * 1024 * 1024,
            maximumCacheOverflowBytes: 64 * 1024 * 1024,
            skipLevelOfDetail: false,
            shadows: Cesium.ShadowMode.ENABLED,
            enableShowOutline: false,
        }).then(tileset => {
            if (disposed) {
                tileset.destroy();
                return;
            }
            viewer.scene.primitives.add(tileset);
            tileset.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(.75, .5);
            active.current = { viewer, tileset };
            const center = tileset.boundingSphere.center;
            // A fixed illumination direction in the local frame keeps screenshots and material comparisons reproducible.
            const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
            const direction = Cesium.Matrix4.multiplyByPointAsVector(enu, new Cesium.Cartesian3(.65, -.5, -1), new Cesium.Cartesian3());
            viewer.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(direction, direction), intensity: 2.4 });
            runtime!.onCleanup(tileset.tileLoad.addEventListener(tile => loaded.add(tile)));
            runtime!.onCleanup(tileset.tileUnload.addEventListener(tile => loaded.delete(tile)));
            runtime!.onCleanup(tileset.tileFailed.addEventListener(failure => {
                setError(`A map tile failed to load: ${failure.message}. Loaded records remain unchanged.`);
            }));
            const saved = sessions.get(props.sessionKey).camera;
            appliedMode.current = latest.current.mode;
            viewer.scene.screenSpaceCameraController.enableTilt = latest.current.mode === "3d";
            if (saved)
                viewer.camera.setView({ destination: Cesium.Cartesian3.fromRadians(saved.longitude, saved.latitude, saved.height), orientation: saved });
            else
                viewer.camera.viewBoundingSphere(tileset.boundingSphere, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-22), latest.current.mode === "2d" ? -Math.PI / 2 : Cesium.Math.toRadians(-48), tileset.boundingSphere.radius * 2.55));
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            setReady(true);
            viewer.scene.requestRender();
        }).catch(cause => {
            if (!disposed)
                setError(cause instanceof Error ? cause.message : "Unable to load the map publication");
        });
        return () => {
            retainCamera();
            disposed = true;
            if (active.current?.viewer === viewer)
                active.current = null;
            runtime?.destroy();
        };
    }, [props.manifestUrl, props.sessionKey, sessions, retry]);
    useEffect(() => {
        const state = active.current;
        if (!state || !ready)
            return;
        const { viewer, tileset } = state;
        const selected = props.selection?.entityId;
        const kindVisibility = props.visibleKinds ? props.visibleKinds.map(kind => `\${kind} === ${safeExpression(kind)}`).join(" || ") || "false" : "true";
        const show = props.inspection?.parentId ? `(${kindVisibility}) && \${entityId} !== ${safeExpression(props.inspection.parentId)}` : kindVisibility;
        tileset.style = new Cesium.Cesium3DTileStyle({
            show,
            color: selected ? { conditions: [[`\${entityId} === ${safeExpression(selected)}`, "color('#df9d89')"], ["true", "color('white')"]] } : "color('white')",
        });
        tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
        tileset.colorBlendAmount = .42;
        viewer.scene.requestRender();
    }, [ready, props.selection?.entityId, props.visibleKinds, props.inspection?.parentId]);
    useEffect(() => {
        const state = active.current;
        if (!state || !ready)
            return;
        const { viewer, tileset } = state;
        viewer.scene.screenSpaceCameraController.enableTilt = props.mode === "3d";
        if (appliedMode.current === props.mode)
            return;
        appliedMode.current = props.mode;
        const target = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2)) : undefined;
        viewer.camera.lookAt(target || tileset.boundingSphere.center, new Cesium.HeadingPitchRange(viewer.camera.heading, props.mode === "2d" ? -Math.PI / 2 : Cesium.Math.toRadians(-48), Math.max(35, viewer.camera.positionCartographic.height / .74)));
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        viewer.scene.requestRender();
    }, [ready, props.mode]);
    useEffect(() => {
        const state = active.current;
        if (!state || !ready || !props.navigation.sequence)
            return;
        const { viewer, tileset } = state;
        const command = props.navigation;
        const pitch = props.mode === "2d" ? -Math.PI / 2 : Cesium.Math.toRadians(-48);
        switch (command.action) {
            case "zoom_in":
                viewer.camera.zoomIn(Math.max(8, viewer.camera.positionCartographic.height * .2));
                break;
            case "zoom_out":
                viewer.camera.zoomOut(Math.max(8, viewer.camera.positionCartographic.height * .25));
                break;
            case "north":
                viewer.camera.setView({ orientation: { heading: 0, pitch, roll: 0 } });
                break;
            case "focus":
                if (command.target)
                    viewer.camera.lookAt(new Cesium.Cartesian3(...command.target), new Cesium.HeadingPitchRange(viewer.camera.heading, pitch, 90));
                break;
            default:
                viewer.camera.viewBoundingSphere(tileset.boundingSphere, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-22), pitch, tileset.boundingSphere.radius * (command.action === "fit" ? 2.55 : 1.18)));
        }
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        viewer.scene.requestRender();
    }, [ready, props.navigation.sequence]); // A command is consumed once; selection never issues a hidden camera move.
    useEffect(() => {
        const state = active.current;
        if (!state || !ready || !props.inspection)
            return;
        const { viewer } = state, { representation: rep, frame } = props.inspection;
        if (!rep.vertical || (rep.geometry.type !== "Polygon" && rep.geometry.type !== "MultiPolygon"))
            return;
        const builder = new MeshBuilder();
        const polygons = rep.geometry.type === "Polygon" ? [rep.geometry.coordinates] : rep.geometry.coordinates;
        for (const polygon of polygons)
            builder.prism(polygon, rep.vertical.lower, rep.vertical.upper, 0);
        const positions: number[] = [], matrix = enuToEcef(frame);
        for (let i = 0; i < builder.mesh.positions.length; i += 3) {
            const p = builder.mesh.positions;
            positions.push(...transformPoint(matrix, [p[i], -p[i + 2], p[i + 1]]));
        }
        const attributes = new Cesium.GeometryAttributes();
        attributes.position = new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(positions) });
        const geometry = new Cesium.Geometry({ attributes, indices: new Uint32Array(builder.mesh.indices), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(positions) });
        const primitive = viewer.scene.primitives.add(new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry, id: { entityId: rep.entityId, representationId: rep.id }, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString("#54a994").withAlpha(.65)) } }), appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: true }), asynchronous: false }));
        viewer.scene.requestRender();
        return () => { if (!viewer.isDestroyed()) {
            viewer.scene.primitives.remove(primitive);
            viewer.scene.requestRender();
        } };
    }, [ready, props.inspection]);
    return <div className="spatial-viewport" data-spatial-viewport>
    <div ref={host} className="spatial-canvas"/>
    {!ready && !error && <div className="spatial-loading" role="status">Preparing the shared map…</div>}
    {error && <div className="spatial-error" role="alert"><strong>Map needs attention</strong><span>{error}</span><button type="button" onClick={() => setRetry(n => n + 1)}>Reload map</button></div>}
  </div>;
}

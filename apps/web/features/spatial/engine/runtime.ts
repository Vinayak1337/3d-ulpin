"use client";
import * as Cesium from "cesium";
export type RuntimeProfile = "world" | "local" | "neighbourhood";
export interface MapRuntime {
    viewer: Cesium.Viewer;
    destroy: () => void;
    onCleanup: (cleanup: () => void) => void;
}
const owners = new WeakMap<HTMLElement, MapRuntime>();
let serial = 0;
/** The ONLY Cesium.Viewer factory. Pages and geometry adapters never own engine configuration. */
export function createMapRuntime(host: HTMLElement, profile: RuntimeProfile, onError: (message: string) => void): MapRuntime {
    if (owners.has(host))
        throw new Error("This map host already owns a live runtime");
    (window as unknown as {
        CESIUM_BASE_URL: string;
    }).CESIUM_BASE_URL = "/cesium/";
    (Cesium.buildModuleUrl as typeof Cesium.buildModuleUrl & {
        setBaseUrl: (url: string) => void;
    }).setBaseUrl("/cesium/");
    const viewer = new Cesium.Viewer(host, {
        animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
        ...(profile !== "world" ? { globe: false as const } : {}), baseLayer: false, skyBox: false, skyAtmosphere: false, scene3DOnly: true, requestRenderMode: true, maximumRenderTimeChange: Infinity,
        shadows: true, contextOptions: { webgl: { alpha: profile === "local", antialias: true } },
    });
    const cleanups: Array<() => void> = [];
    let destroyed = false;
    const runtime: MapRuntime = { viewer, onCleanup: fn => cleanups.push(fn), destroy() { if (destroyed)
            return; destroyed = true; for (const cleanup of cleanups.splice(0).reverse()) {
            try {
                cleanup();
            }
            catch { /* Continue releasing all runtime resources. */ }
        } if (!viewer.isDestroyed())
            viewer.destroy(); owners.delete(host); delete host.dataset.mapRuntimeId; } };
    owners.set(host, runtime);
    host.dataset.mapRuntimeId = String(++serial);
    try {
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#eef0e9");
        if (viewer.scene.globe) {
            viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#e5e6dd");
            viewer.scene.globe.enableLighting = false;
        }
        viewer.scene.fog.enabled = false;
        viewer.scene.msaaSamples = 2;
        viewer.scene.postProcessStages.fxaa.enabled = true;
        if (viewer.scene.sun)
            viewer.scene.sun.show = false;
        if (viewer.scene.moon)
            viewer.scene.moon.show = false;
        viewer.scene.shadowMap.softShadows = true;
        viewer.scene.shadowMap.size = profile==="neighbourhood"?4096:2048;
        viewer.scene.shadowMap.darkness = profile==="neighbourhood"?.64:.38;
        viewer.scene.shadowMap.normalOffset = true;
        if(profile==="neighbourhood"){
            // Isolated adapter qualified against the pinned Cesium engine 26.3.0:
            // its globe-oriented default bias stripes these metre-scale surfaces.
            const map=viewer.scene.shadowMap as unknown as {_primitiveBias?:{normalOffsetScale:number;depthBias:number};dirty?:boolean};
            if(map._primitiveBias&&typeof map._primitiveBias.normalOffsetScale==="number"&&typeof map._primitiveBias.depthBias==="number"){
                map._primitiveBias.normalOffsetScale=.8;map._primitiveBias.depthBias=.00012;map.dirty=true;
                host.dataset.shadowProfile="metre-neighbourhood-bias-v1";
            }
        }
        viewer.scene.shadowMap.maximumDistance = profile === "local" ? 150 : 1600;
        // Scene-wide neutral diffuse lighting is independent of the current date,
        // geographic daylight, or a missing skybox. Tile layers share this policy.
        cleanups.push(viewer.scene.primitives.primitiveAdded.addEventListener(primitive => {
            if (!(primitive instanceof Cesium.Cesium3DTileset)) return;
            primitive.environmentMapManager.enabled = false;
            primitive.imageBasedLighting.sphericalHarmonicCoefficients = [
                new Cesium.Cartesian3(1.05, 1.035, 1.0),
                ...Array.from({ length: 8 }, () => new Cesium.Cartesian3(0, 0, 0)),
            ];
        }));
        const controls = viewer.scene.screenSpaceCameraController;
        controls.minimumZoomDistance = profile === "local" ? 1.5 : 4;
        controls.maximumZoomDistance = profile === "local" ? 250 : 20000000;
        controls.enableCollisionDetection = false;
        viewer.cesiumWidget.creditContainer.setAttribute("aria-label", "Cesium attribution");
        cleanups.push(viewer.scene.renderError.addEventListener((_scene, cause: Error) => onError(cause.message || "Map rendering failed")));
        const observer = new ResizeObserver(() => { if (destroyed)
            return; viewer.resize(); viewer.scene.requestRender(); });
        observer.observe(host);
        cleanups.push(() => observer.disconnect());
        let visible = true;
        const visibility = () => { if (destroyed)
            return; viewer.useDefaultRenderLoop = visible && !document.hidden; if (viewer.useDefaultRenderLoop) {
            viewer.resize();
            viewer.scene.requestRender();
        } };
        if (typeof IntersectionObserver !== "undefined") {
            const observer = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); visibility(); });
            observer.observe(host);
            cleanups.push(() => observer.disconnect());
        }
        document.addEventListener("visibilitychange", visibility);
        cleanups.push(() => document.removeEventListener("visibilitychange", visibility));
        const lost = (event: Event) => { event.preventDefault(); onError("Graphics context lost. Reopen the map to recreate its renderer; records are unchanged."); };
        viewer.canvas.addEventListener("webglcontextlost", lost);
        cleanups.push(() => viewer.canvas.removeEventListener("webglcontextlost", lost));
        return runtime;
    }
    catch (error) {
        runtime.destroy();
        throw error;
    }
}

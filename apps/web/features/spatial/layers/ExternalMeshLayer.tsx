'use client';
import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { createMapRuntime } from '../engine/runtime';
import { useSpatialServices } from '../data/Provider';
import type { MapCamera, MapSelection } from '../data/session';
import type { TileNavigation } from './TileLayer';
import type { ExternalSceneResource } from '../../usp/shared/external-resource';
import '../viewport.css';

export type ExternalMeshProps = {
  resource: ExternalSceneResource;
  sessionKey: string;
  selection: MapSelection | null;
  onSelect: (selection: MapSelection) => void;
  navigation: TileNavigation;
  visible: boolean;
  opacity: number;
};
const cameraState = (viewer: Cesium.Viewer): MapCamera => ({
  longitude: viewer.camera.positionCartographic.longitude, latitude: viewer.camera.positionCartographic.latitude,
  height: viewer.camera.positionCartographic.height, heading: viewer.camera.heading,
  pitch: viewer.camera.pitch, roll: viewer.camera.roll,
});
const faceColor = (type: string | null, selected: boolean, opacity: number) => Cesium.Color.fromCssColorString(
  selected ? (type === 'RoofSurface' ? '#769383' : '#b4c7b8') : type === 'RoofSurface' ? '#a8967b' : '#d2d6cb').withAlpha(Math.max(.05, Math.min(1, opacity)));

/** Source surfaces use the shared engine in a labelled local graphics frame. */
export default function ExternalMeshLayer(props: ExternalMeshProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props);
  latest.current = props;
  const { sessions } = useSpatialServices();
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const active = useRef<{ viewer: Cesium.Viewer; primitive: Cesium.Primitive;
    sphere: Cesium.BoundingSphere; ids: object[] } | null>(null);

  useEffect(() => {
    const element = host.current!;
    setError('');
    element.dataset.sceneReady = 'false';
    let runtime: ReturnType<typeof createMapRuntime> | undefined;
    try {
      runtime = createMapRuntime(element, 'local', setError);
      const viewer = runtime.viewer, scene = props.resource.scene;
      // This transform positions local graphics only. It is not an EPSG:7415 → ECEF operation.
      const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(0, 0, 0));
      const instances: Cesium.GeometryInstance[] = [], ids: object[] = [];
      for (const [index, face] of scene.faces.entries()) {
        const vertices: number[] = [], normals: number[] = [];
        for (const vertex of face.triangles) { vertices.push(...scene.vertices[vertex]); normals.push(...face.normal); }
        const attributes = new Cesium.GeometryAttributes();
        attributes.position = new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3, values: new Float64Array(vertices) });
        attributes.normal = new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3, values: new Float32Array(normals) });
        const id = { entityId: props.resource.featureId, sourcePartId: face.partId,
          sourceFaceIndex: face.sourceFaceIndex, semanticIndex: face.semanticIndex, face: index };
        ids.push(id);
        instances.push(new Cesium.GeometryInstance({ id, modelMatrix: matrix,
          geometry: new Cesium.Geometry({ attributes, primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(vertices) }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            faceColor(face.surfaceType, props.selection?.entityId === props.resource.featureId, props.opacity)) } }));
      }
      const primitive = viewer.scene.primitives.add(new Cesium.Primitive({ geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: true, closed: false }),
        asynchronous: false, shadows: Cesium.ShadowMode.DISABLED }));
      const points = scene.faces.flatMap(face => face.indices.map(index => scene.vertices[index])).flat();
      const sphere = Cesium.BoundingSphere.transform(Cesium.BoundingSphere.fromVertices(points), matrix);
      active.current = { viewer, primitive, sphere, ids };
      const direction = Cesium.Matrix4.multiplyByPointAsVector(matrix, new Cesium.Cartesian3(.5, -.7, -1), new Cesium.Cartesian3());
      viewer.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(direction, direction), intensity: 1.5 });
      viewer.camera.frustum.near = .05;
      viewer.camera.frustum.far = 10000;
      const saved = sessions.get(props.sessionKey).camera;
      if (saved) viewer.camera.setView({ destination: Cesium.Cartesian3.fromRadians(saved.longitude, saved.latitude, saved.height), orientation: saved });
      else viewer.camera.viewBoundingSphere(sphere, new Cesium.HeadingPitchRange(-.5, -.65, Math.max(8, sphere.radius * 2.8)));
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      viewer.scene.screenSpaceCameraController.tiltEventTypes = [Cesium.CameraEventType.RIGHT_DRAG, Cesium.CameraEventType.PINCH];
      viewer.scene.screenSpaceCameraController.lookEventTypes = [];
      viewer.canvas.tabIndex = 0;
      viewer.canvas.setAttribute('aria-label', 'Interactive source exterior. Drag to pan, right-drag to orbit, scroll to zoom.');
      const focus = () => viewer.canvas.focus({ preventScroll: true });
      const keyboard = (event: KeyboardEvent) => {
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault();
        const step = Math.max(.3, sphere.radius * .05);
        if (event.key === 'ArrowLeft') viewer.camera.moveLeft(step);
        if (event.key === 'ArrowRight') viewer.camera.moveRight(step);
        if (event.key === 'ArrowUp') viewer.camera.moveUp(step);
        if (event.key === 'ArrowDown') viewer.camera.moveDown(step);
        viewer.scene.requestRender();
      };
      viewer.canvas.addEventListener('pointerdown', focus);
      viewer.canvas.addEventListener('keydown', keyboard);
      runtime.onCleanup(() => { viewer.canvas.removeEventListener('pointerdown', focus); viewer.canvas.removeEventListener('keydown', keyboard); });
      viewer.screenSpaceEventHandler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
        const picked = viewer.scene.pick(event.position);
        if (picked?.id?.entityId === props.resource.featureId) {
          element.dataset.pickedSurface = JSON.stringify(picked.id);
          latest.current.onSelect({ entityId: props.resource.featureId, representationId: picked.id.sourcePartId });
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      let selected: boolean | undefined, opacity: number | undefined;
      runtime.onCleanup(viewer.scene.postRender.addEventListener(() => {
        if (!primitive.ready) return;
        element.dataset.sceneReady = 'true';
        element.dataset.camera = JSON.stringify(cameraState(viewer));
        element.dataset.visible = String(primitive.show);
        const next = latest.current.selection?.entityId === props.resource.featureId;
        if (selected !== next || opacity !== latest.current.opacity) {
          for (const [index, id] of ids.entries()) primitive.getGeometryInstanceAttributes(id).color =
            Cesium.ColorGeometryInstanceAttribute.toValue(faceColor(scene.faces[index].surfaceType, next, latest.current.opacity));
          selected = next;
          opacity = latest.current.opacity;
          element.dataset.opacity = String(primitive.getGeometryInstanceAttributes(ids[0]).color[3] / 255);
          viewer.scene.requestRender();
        }
      }));
      runtime.onCleanup(viewer.camera.moveEnd.addEventListener(() => sessions.patch(props.sessionKey, { camera: cameraState(viewer) })));
      viewer.scene.requestRender();
    } catch (cause) { runtime?.destroy(); active.current = null; setError(cause instanceof Error ? cause.message : 'The source exterior could not be displayed.'); }
    return () => {
      if (active.current && !active.current.viewer.isDestroyed()) sessions.patch(props.sessionKey, { camera: cameraState(active.current.viewer) });
      active.current = null;
      runtime?.destroy();
    };
  }, [props.resource, props.sessionKey, sessions, retry]);

  useEffect(() => { active.current?.viewer.scene.requestRender(); }, [props.selection]);
  useEffect(() => {
    if (!active.current) return;
    active.current.primitive.show = props.visible;
    active.current.viewer.scene.requestRender();
  }, [props.visible, props.opacity, props.resource, retry]);
  useEffect(() => {
    const state = active.current;
    if (!state || !props.navigation.sequence) return;
    const { viewer, sphere } = state, action = props.navigation.action;
    if (action === 'zoom_in') viewer.camera.zoomIn(Math.max(1, sphere.radius * .25));
    else if (action === 'zoom_out') viewer.camera.zoomOut(Math.max(1, sphere.radius * .25));
    else {
      const heading = action === 'north' ? 0 : action === 'reverse' ? viewer.camera.heading + Math.PI : -.5;
      viewer.camera.viewBoundingSphere(sphere, new Cesium.HeadingPitchRange(heading, -.65, Math.max(8, sphere.radius * 2.8)));
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
    viewer.scene.requestRender();
  }, [props.navigation.sequence]); // Consume a command once; inspector/selection changes retain the camera.

  return <div className="spatial-viewport" data-spatial-viewport data-external-roof={props.resource.featureId} data-source-sha256={props.resource.source.sha256}>
    <div ref={host} className="spatial-canvas" data-external-canvas />
    <div className="external-scene-caption"><strong>Source exterior · local metres</strong><span>RD New + NAP · global placement unqualified</span><span>Interior floors and units not supplied</span></div>
    <a className="external-scene-attribution" href="https://docs.3dbag.nl/en/copyright/" target="_blank" rel="noreferrer">© 3DBAG by tudelft3d and 3DGI · CC BY 4.0</a>
    {error && <div className="spatial-error" role="alert"><strong>Source display unavailable</strong><span>{error}</span><button onClick={() => setRetry(value => value + 1)}>Retry display</button></div>}
  </div>;
}

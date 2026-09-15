import * as Cesium from "cesium";
export type OrbitDirection =
  | "orbit_left"
  | "orbit_right"
  | "orbit_up"
  | "orbit_down";
/** Orbit an evidenced target in its local ENU frame; never edit the geometry. */
export function orbitCamera(
  viewer: Cesium.Viewer,
  center: Cesium.Cartesian3,
  direction: OrbitDirection,
) {
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const inverse = Cesium.Matrix4.inverseTransformation(
    frame,
    new Cesium.Matrix4(),
  );
  const offset = Cesium.Matrix4.multiplyByPoint(
    inverse,
    viewer.camera.positionWC,
    new Cesium.Cartesian3(),
  );
  const range = Math.max(4, Cesium.Cartesian3.magnitude(offset));
  const heading =
    Math.atan2(-offset.x, -offset.y) +
    (direction === "orbit_left" ? -1 : direction === "orbit_right" ? 1 : 0) *
      Cesium.Math.toRadians(15);
  const pitch = Cesium.Math.clamp(
    -Math.asin(Cesium.Math.clamp(offset.z / range, -1, 1)) +
      (direction === "orbit_up" ? -1 : direction === "orbit_down" ? 1 : 0) *
        Cesium.Math.toRadians(10),
    Cesium.Math.toRadians(-85),
    Cesium.Math.toRadians(-10),
  );
  viewer.camera.cancelFlight();
  viewer.camera.lookAt(
    center,
    new Cesium.HeadingPitchRange(heading, pitch, range),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

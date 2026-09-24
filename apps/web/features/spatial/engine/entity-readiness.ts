import * as Cesium from 'cesium';

/**
 * Adapter for the locked @cesium/engine 26.3.0 Entity visualizers. Call after render.
 * DataSourceDisplay.ready latches after first load. Its private getBoundingSphere
 * can also return DONE=0 for a newly built batch whose primitive is still hidden:
 * ready flips in afterRender, and the next data-source update sets show=true.
 * Require current Entity commands as well as complete bounds, so readiness means
 * the geometry has entered the render/pick path. Unsupported adapters fail closed.
 * Keep these private reads isolated and covered by the real selected-record pick
 * journey when upgrading Cesium.
 */
export function entityGeometryReady(
  display: Cesium.DataSourceDisplay,
  entities: readonly Cesium.Entity[],
  scene: Cesium.Scene,
): boolean {
  if (!entities.length) return true;
  const displayAdapter = display as unknown as {
    getBoundingSphere?: (entity: Cesium.Entity, allowPartial: boolean, result: Cesium.BoundingSphere) => number;
  };
  const sceneAdapter = scene as unknown as {
    frameState?: { commandList?: readonly { owner?: unknown }[] };
  };
  const commands = sceneAdapter.frameState?.commandList;
  if (typeof displayAdapter.getBoundingSphere !== 'function' || !Array.isArray(commands)) return false;
  const owners = [...new Set(commands.map(command => command.owner))];
  const bounds = new Cesium.BoundingSphere();
  return entities.every(entity => {
    if (displayAdapter.getBoundingSphere!(entity, false, bounds) !== 0) return false;
    return owners.some(owner => {
      if (owner instanceof Cesium.Primitive) {
        return owner.ready && owner.show && !!owner.getGeometryInstanceAttributes(entity);
      }
      if (owner instanceof Cesium.PointPrimitiveCollection && owner.show) {
        for (let index = 0; index < owner.length; index++) {
          const point = owner.get(index);
          if (point.id === entity && point.show) return true;
        }
      }
      return false;
    });
  });
}

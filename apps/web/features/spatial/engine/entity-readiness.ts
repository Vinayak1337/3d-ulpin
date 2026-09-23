import * as Cesium from 'cesium';

/**
 * Adapter for the locked @cesium/engine 26.3.0 Entity visualizers.
 * DataSourceDisplay.ready latches after first load, so it cannot qualify newly
 * selected geometry. This private method returns DONE=0 only once that Entity's
 * primitive is ready; allowPartial=false excludes partially constructed shapes.
 * Keep this dependency isolated and covered by the real selected-record pick
 * journey when upgrading Cesium. An unsupported adapter must not claim ready.
 */
export function entityGeometryReady(display: Cesium.DataSourceDisplay, entities: readonly Cesium.Entity[]): boolean {
  if (!entities.length) return true;
  const adapter = display as unknown as {
    getBoundingSphere?: (entity: Cesium.Entity, allowPartial: boolean, result: Cesium.BoundingSphere) => number;
  };
  if (typeof adapter.getBoundingSphere !== 'function') return false;
  const bounds = new Cesium.BoundingSphere();
  return entities.every(entity => adapter.getBoundingSphere!(entity, false, bounds) === 0);
}

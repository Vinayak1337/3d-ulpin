'use client';
import dynamic from 'next/dynamic';
import type { PhysicalFeature } from '@ulpin/contracts';
import type { BlockController } from '../../officer/block/useBlock';
import { useSharedResource } from '../../spatial/data/useResource';
import type { ExternalSceneResource } from './external-resource';
import type { TileNavigation } from '../../spatial/layers/TileLayer';
const MapViewport = dynamic(() => import('../../spatial/MapViewport').then(module => module.MapViewport), { ssr: false });

export default function ExternalSceneViewport({ feature, block, opacity = 1 }: { feature: PhysicalFeature; block: BlockController; opacity?: number }) {
  const hash = String(feature.properties.external_cityjson_sha256);
  const resource = useSharedResource<ExternalSceneResource>(`/spatial/core/areas/${feature.areaId}/external/${feature.id}?revision=${feature.revision}&sha256=${hash}`);
  if (!resource.data || resource.data.featureId !== feature.id || resource.data.featureRevision !== feature.revision || resource.data.source.sha256 !== hash)
    return <div className="spatial-loading" role={resource.error ? 'alert' : 'status'}><span>{resource.error || 'Reading the retained source exterior…'}</span>{resource.error && <button onClick={() => void resource.reload()}>Retry source</button>}</div>;
  const action = block.navigation.action;
  const navigationAction: TileNavigation['action'] = action === 'return' ? 'fit' : action === 'issue' ? 'focus'
    : action === 'north' || action === 'focus' || action === 'fit' || action === 'zoom_in' || action === 'zoom_out' ? action : 'reverse';
  return <MapViewport source={{ kind: 'external_asset', props: {
    resource: resource.data, sessionKey: `external:${feature.areaId}:${feature.id}:${hash}`,
    visible: !block.preferences.hiddenLayers.includes('building'), opacity,
    selection: block.selectedId === feature.id ? { entityId: feature.id } : null,
    onSelect: selected => { if (selected.entityId === feature.id) block.select(feature.id); },
    navigation: { sequence: block.navigation.sequence,
      action: navigationAction },
  } }} />;
}

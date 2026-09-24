import { MapToolbar } from '@ulpin/design-system';

export const Default = () => <MapToolbar />;

export const VolumesWithImpact = () => <MapToolbar defaultTool="impact" render="Volumes" />;

export const ReadOnlyRole = () => <MapToolbar hiddenTools={['section', 'measure-area']} view="2D" />;

import { LayerPanel } from '@ulpin/design-system';

export const Layers = () => (
  <LayerPanel
    colourBy="Rights"
    groups={[
      {
        label: 'Cadastre',
        layers: [
          { id: 'parcels', label: 'Parcels', outline: true, color: 'var(--map-parcel-line)' },
          { id: 'buildings', label: 'Buildings', color: 'var(--map-building)' },
          { id: 'spaces', label: 'Spaces', color: 'var(--rights-exclusive)' },
        ],
      },
      {
        label: 'Below ground',
        layers: [
          { id: 'basements', label: 'Basements', color: 'var(--soil-top)' },
          { id: 'utilities', label: 'Utilities', color: 'var(--utility-water)', visible: false },
          { id: 'tunnels', label: 'Tunnels', color: 'var(--readiness-unknown)', hatch: true, noData: true, visible: false },
        ],
      },
    ]}
  />
);

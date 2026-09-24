import { ImportStream } from '@ulpin/design-system';

export const Running = () => (
  <ImportStream
    title="Importing Lake View bundle"
    meta="186 spaces saved"
    rows={[
      { file: 'parcels.gpkg', state: 'saved', detail: '214 parcels · CRS EPSG:32643 detected' },
      { file: 'unit_inventory.xlsx', state: 'attention', detail: '11 of 12 columns mapped · carpet_sqft read as ft², converted to m²', action: { label: 'Review 1 mapping' } },
      { file: 'levels.csv', state: 'attention', detail: '9 levels · 2 lower limits missing', action: { label: 'Add levels' } },
      { file: 'plan_F7.pdf', state: 'running', detail: 'reading rooms and dimensions', progress: 62 },
    ]}
  />
);

export const ReaderMissing = () => (
  <ImportStream
    title="Importing survey files"
    meta="0 spaces saved"
    rows={[{ file: 'parcels.shp', state: 'error', detail: 'no CRS · choose the coordinate system to continue', action: { label: 'Choose CRS' } }]}
  />
);

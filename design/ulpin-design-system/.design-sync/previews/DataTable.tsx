import { Badge, DataTable } from '@ulpin/design-system';

type Unit = { level: string; unit: string; code: string; carpet: string; share: string; status: 'Recorded' | 'Needs review' | 'Draft' };

export const FloorsAndUnits = () => (
  <div style={{ width: 640, background: 'var(--surface)' }}>
    <DataTable<Unit>
      columns={[
        { header: 'Level', cell: (r) => r.level },
        { header: 'Unit', cell: (r) => r.unit },
        { header: '3D ULPIN', cell: (r) => r.code, mono: true },
        { header: 'Carpet m²', cell: (r) => r.carpet, numeric: true },
        { header: 'Share %', cell: (r) => r.share, numeric: true },
        { header: 'Status', cell: (r) => <Badge status={r.status} /> },
      ]}
      rows={[
        { level: 'F7', unit: 'Flat 701', code: '…F07-R001-4', carpet: '71.10', share: '1.88', status: 'Recorded' },
        { level: 'F7', unit: 'Flat 702', code: '…F07-R002-Q', carpet: '58.45', share: '1.55', status: 'Recorded' },
        { level: 'F7', unit: 'Flat 704', code: 'P3-7Q4M…-R4', carpet: '69.30', share: '1.84', status: 'Needs review' },
        { level: 'F8', unit: 'Flat 801', code: 'Not assigned', carpet: '71.10', share: '1.88', status: 'Draft' },
      ]}
      more="51 more units"
    />
  </div>
);

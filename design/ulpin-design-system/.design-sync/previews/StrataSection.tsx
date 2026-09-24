import { StrataSection } from '@ulpin/design-system';

export const Flat704 = () => (
  <div style={{ width: 560 }}>
    <StrataSection
      parcel="MH2507A1B3C4D5"
      selected={2}
      roof="239.8 roof"
      ground="212.4 ground"
      airRights="Air-rights envelope to 254.0 m"
      levels={[{}, {}, { label: 'F7 · Flat 704', elevation: '233.8' }, {}, {}, {}, {}, {}]}
      basements={[
        { label: 'B1 · parking', elevation: '209.1' },
        { label: 'B2 · parking (levels estimated)', elevation: '205.8', estimated: true },
      ]}
      utility="Water main (B)"
      corridor="Metro corridor · test fixture"
      corridorRange="194.0 to 198.0"
    />
  </div>
);

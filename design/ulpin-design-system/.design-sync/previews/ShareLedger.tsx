import { ShareLedger } from '@ulpin/design-system';

export const TotalFlagged = () => (
  <ShareLedger
    building="Lake View Residence"
    basis="value"
    totalUnits={55}
    total={99.5}
    moreUnits={52}
    rows={[
      { unit: 'Flat 701', code: '…F07-R001-4', carpet: 71.1, share: 1.88 },
      { unit: 'Flat 702', code: '…F07-R002-Q', carpet: 58.45, share: 1.55 },
      { unit: 'Flat 704', code: 'P3-7Q4M…-R4', carpet: 69.3, share: 1.84 },
    ]}
    evidence={{ source: 'Declaration', locator: 'sch.B', href: '#' }}
  />
);

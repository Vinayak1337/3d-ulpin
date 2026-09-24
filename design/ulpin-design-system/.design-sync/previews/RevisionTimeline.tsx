import { RevisionTimeline } from '@ulpin/design-system';

export const ChainConsistent = () => (
  <RevisionTimeline
    chain="consistent"
    revisions={[
      { kind: 'recorded', title: 'r3 Recorded', byline: 'R. Iyer · 24 Sep 2026, 14:10', summary: 'Flat 201 lower limit 218.70 → 218.90 m from levels-r2.csv', hash: '7f3a…c2e1', previousHash: '91be…04d7' },
      { kind: 'evidence', title: 'r2 Evidence applied', byline: 'R. Iyer · 24 Sep 2026, 13:52', hash: '91be…04d7', previousHash: '2c80…9a13' },
      { kind: 'draft', title: 'r1 Draft from 5 sources', byline: 'Import agent · 24 Sep 2026, 11:05' },
    ]}
  />
);

export const ChainBroken = () => (
  <RevisionTimeline
    chain="broken"
    revisions={[
      { kind: 'evidence', title: 'r2 Evidence applied', byline: 'R. Iyer · 24 Sep 2026, 13:52', summary: 'Previous hash does not match r1', hash: '91be…04d7', previousHash: '0000…0000' },
      { kind: 'draft', title: 'r1 Draft from 5 sources', byline: 'Import agent · 24 Sep 2026, 11:05', hash: '2c80…9a13' },
    ]}
  />
);

import { EVIDENCE_AND_RECORD_KEYS, Legend } from '@ulpin/design-system';

export const Rights = () => (
  <Legend
    sections={[
      {
        title: 'Rights',
        items: [
          { label: 'Exclusive unit · 42', color: 'var(--rights-exclusive)' },
          { label: 'Shared area · 9', color: 'var(--rights-shared)' },
          { label: 'Public or authority · 3', color: 'var(--rights-public)' },
          { label: 'Unknown · 4', color: 'var(--readiness-unknown)', hatch: true },
        ],
      },
    ]}
  />
);

export const EvidenceAndRecord = () => <Legend sections={EVIDENCE_AND_RECORD_KEYS} />;

export const Utilities = () => (
  <Legend
    sections={[
      {
        title: 'Utilities',
        items: [
          { label: 'Water · 1', color: 'var(--utility-water)' },
          { label: 'Sewer · 0', color: 'var(--utility-sewer)' },
          { label: 'Electric · 0', color: 'var(--utility-electric)' },
          { label: 'No survey', color: 'var(--readiness-unknown)', hatch: true },
        ],
      },
    ]}
  />
);

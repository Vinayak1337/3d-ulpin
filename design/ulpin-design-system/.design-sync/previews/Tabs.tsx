import { Tabs } from '@ulpin/design-system';

export const Inspector = () => (
  <div style={{ width: 360, background: 'var(--surface)' }}>
    <Tabs tabs={['Overview', 'Rights', 'Evidence', 'Checks', 'History']} />
  </div>
);

export const Register = () => (
  <div style={{ width: 480, background: 'var(--surface)' }}>
    <Tabs tabs={['Shares', 'Documents', 'Checks', 'History']} defaultValue="Checks" />
  </div>
);

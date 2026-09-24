import { StudioHeader } from '@ulpin/design-system';

export const Studio = () => (
  <div style={{ width: 1200 }}>
    <StudioHeader active="Map" area="Lake View area" status="Live" initials="RI" userName="R. Iyer" />
  </div>
);

export const Snapshot = () => (
  <div style={{ width: 1200 }}>
    <StudioHeader active="Batches" area="Lake View area" status="Snapshot 24 Sep, 14:10" initials="RI" userName="R. Iyer" />
  </div>
);

export const Admin = () => (
  <div style={{ width: 1200 }}>
    <StudioHeader surface="Admin" nav={['Overview', 'Imports', 'Coverage', 'Users', 'Audit', 'Settings']} active="Overview" initials="AD" userName="A. Deshmukh" />
  </div>
);

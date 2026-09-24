import { Badge, Button, Panel } from '@ulpin/design-system';

export const WithHeadAndFooter = () => (
  <Panel
    style={{ maxWidth: 420 }}
    title="Lake View Residence"
    aside={<Badge status="Reviewed" />}
    footer={
      <>
        <Button variant="primary">Open register</Button>
        <Button>Explore floors</Button>
      </>
    }
  >
    <p className="studio-body" style={{ margin: 0 }}>
      12 Lake View Road. Ground plus 8 floors, stilt parking at ground, basements B1 and B2; 55 units.
    </p>
  </Panel>
);

export const Headless = () => (
  <Panel style={{ maxWidth: 420 }}>
    <div className="ul-caption">Scope</div>
    <p className="studio-body" style={{ margin: '4px 0 0' }}>Lake View · Fictional demonstration · revision r3</p>
  </Panel>
);

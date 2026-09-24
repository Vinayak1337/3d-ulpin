import { Button } from '@ulpin/design-system';

export const Variants = () => (
  <div className="ul-row">
    <Button variant="primary" icon="shield-check">Assign code</Button>
    <Button icon="file-arrow-up">Request evidence</Button>
    <Button variant="soft">Apply this level evidence</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Retire code</Button>
  </div>
);

export const PortalSize = () => (
  <div className="ul-row">
    <Button variant="primary" size="lg">Search records</Button>
    <Button size="lg">Track my request</Button>
  </div>
);

export const Blocked = () => (
  <div className="ul-stack" style={{ justifyItems: 'start', gap: 6 }}>
    <Button variant="primary" disabled>Record reviewed details</Button>
    <span className="ul-help">Blocked: 1 finding needs review</span>
  </div>
);

export const IconOnly = () => (
  <div className="ul-row">
    <Button iconOnly icon="arrow-counter-clockwise" aria-label="Reset camera" />
    <Button iconOnly variant="ghost" icon="download-simple" aria-label="Export" />
  </div>
);

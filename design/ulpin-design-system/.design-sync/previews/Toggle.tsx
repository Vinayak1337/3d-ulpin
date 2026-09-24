import { Toggle } from '@ulpin/design-system';

export const Redaction = () => (
  <div style={{ width: 300 }}>
    <div className="ul-layer">
      <span className="ul-grow">Party names (public card)</span>
      <Toggle aria-label="Party names (public card)" />
    </div>
    <div className="ul-layer">
      <span className="ul-grow">Evidence list</span>
      <Toggle aria-label="Evidence list" defaultChecked />
    </div>
    <div className="ul-layer">
      <span className="ul-grow">Local QR</span>
      <Toggle aria-label="Local QR" defaultChecked />
    </div>
  </div>
);

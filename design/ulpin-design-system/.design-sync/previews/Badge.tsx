import { Badge } from '@ulpin/design-system';

export const RecordStates = () => (
  <div className="ul-row">
    <Badge status="Recorded" />
    <Badge status="Assigned" />
    <Badge status="Reviewed" />
    <Badge status="Draft" />
    <Badge status="Retired" />
  </div>
);

export const ReviewStates = () => (
  <div className="ul-row">
    <Badge status="Needs evidence" />
    <Badge status="Needs review" />
    <Badge status="Blocking" />
    <Badge status="Not assessed" />
    <Badge status="Unknown" />
    <Badge status="Test fixture" />
  </div>
);

export const Tones = () => (
  <div className="ul-row">
    <Badge tone="info" icon="info">3 sources</Badge>
    <Badge tone="primary" icon="selection-background">Selected</Badge>
    <Badge icon={null}>Basis: value</Badge>
    <Badge tone="warning" icon={null}>4 of 6</Badge>
  </div>
);

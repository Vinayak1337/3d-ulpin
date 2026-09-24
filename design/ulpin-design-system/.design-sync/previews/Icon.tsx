import { Icon, iconNames } from '@ulpin/design-system';

export const Set = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 120px)', gap: 8 }}>
    {iconNames.map((n) => (
      <div key={n} style={{ display: 'grid', justifyItems: 'center', gap: 6, padding: 8, color: 'var(--ink-soft)' }}>
        <Icon name={n} />
        <span className="ul-caption" style={{ textAlign: 'center' }}>{n}</span>
      </div>
    ))}
  </div>
);

export const StatusColours = () => (
  <div className="ul-row" style={{ gap: 16 }}>
    <span style={{ color: 'var(--success)' }}><Icon name="check-circle" label="Recorded" /></span>
    <span style={{ color: 'var(--warning)' }}><Icon name="warning" label="Needs review" /></span>
    <span style={{ color: 'var(--danger)' }}><Icon name="warning-octagon" label="Blocking" /></span>
    <span style={{ color: 'var(--info)' }}><Icon name="info" label="Information" /></span>
    <span style={{ color: 'var(--ink-muted)' }}><Icon name="file-text" size="sm" label="Document" /></span>
  </div>
);

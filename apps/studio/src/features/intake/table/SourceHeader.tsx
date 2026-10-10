import { useState } from 'react';
import { Button, StatusBadge, formatCount } from '@ulpin/ui';
import type { TableProfile } from './types';
import styles from './Table.module.css';

export function SourceHeader({ profile, name }: { profile: TableProfile; name?: string }) {
  const [copied, setCopied] = useState(false);
  const selection = profile.tabular.selection;
  const copy = async () => {
    await navigator.clipboard.writeText(profile.source.sourceSha256);
    setCopied(true);
  };
  return (
    <section className={`ul-panel ul-pad ${styles.source}`} aria-label="Retained table">
      <div className="ul-row">
        <h1 className="ul-title">{name ?? 'Table import'}</h1>
        <StatusBadge status="Draft" />
        <StatusBadge status="Needs review" />
      </div>
      <div className="ul-row ul-caption">
        <span>{selection.format.toUpperCase()} · Sheet {selection.sheet}</span>
        <span>Header rows {selection.headerRows.join(', ')}</span>
        <span>{formatCount(profile.records)} records · {formatCount(profile.headers.length)} columns</span>
        <span className="ul-mono">SHA-256 {profile.source.sourceSha256.slice(0, 12)}…</span>
        <Button variant="ghost" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy hash'}</Button>
      </div>
      <details open>
        <summary>Source limitations</summary>
        <ul>{profile.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </details>
    </section>
  );
}

import { useState } from 'react';
import { Button, StatusBadge, formatCount } from '@ulpin/ui';
import type { TableProfile } from './types';
import { encodingLabels } from './TableImportFields';
import styles from './Table.module.css';

export function tableReadingWords(reading: Pick<TableProfile['profile'], 'delimiter' | 'encoding' | 'encodingBasis'>) {
  const delimiters = { ',': 'commas', ';': 'semicolons', '\t': 'tabs', '|': 'pipes' };
  if (reading.encodingBasis === 'fallback_windows_1252') {
    return 'The text was not valid UTF-8 and was shown as Windows-1252 as a fallback. ' +
      'Labels may be wrong if the file uses another encoding. The original is kept unchanged.';
  }
  const parts = [];
  if (reading.delimiter) parts.push(delimiters[reading.delimiter]);
  if (reading.encoding) parts.push(encodingLabels[reading.encoding]);
  if (!parts.length) return null;
  const basis = { bom: 'BOM', utf8_valid: 'Valid UTF-8', officer_stated: 'Officer-stated encoding' };
  const words = reading.encodingBasis ? basis[reading.encodingBasis] : 'Encoding choice basis: Unknown';
  return `Read with ${parts.join(', ')} · ${words}`;
}

export function SourceHeader({ profile, name }: { profile: TableProfile; name?: string }) {
  const [copied, setCopied] = useState(false);
  const selection = profile.tabular.selection;
  const reading = tableReadingWords(profile.profile);
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
        {reading ? <span>{reading}</span> : null}
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

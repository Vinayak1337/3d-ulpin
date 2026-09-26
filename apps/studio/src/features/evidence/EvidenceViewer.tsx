import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Button, Dialog, EmptyState, Icon, Skeleton } from '@ulpin/ui';
import { WarningCircle } from '@phosphor-icons/react';
import { resolvePointer, type EvidenceRef } from './refs';
import styles from './EvidenceViewer.module.css';

/**
 * S7 Evidence viewer: the retained original beside a still of the 3D space. The preview is chosen by
 * the locator kind (row → table rows, JSON pointer → the pointed node), so a new file format with an
 * existing locator kind needs no new viewer.
 */
export function EvidenceViewer({ evidence, still, onClose }: { evidence: EvidenceRef; still: string | null; onClose: () => void }) {
  const file = useQuery({
    queryKey: ['source-file', evidence.sourceId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/sources/${evidence.sourceId}/file`);
      if (!response.ok) throw new Error(`The source file could not be read (${response.status}).`);
      return { text: await response.text(), type: response.headers.get('content-type') ?? '', name: fileName(response) };
    },
    staleTime: Infinity,
  });
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.data) return;
    const url = URL.createObjectURL(new Blob([file.data.text], { type: file.data.type || 'text/plain' }));
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file.data]);

  return (
    <Dialog
      title={file.data?.name ?? evidence.label}
      onClose={onClose}
      aside={(
        <span className="ul-row">
          <span className="ul-caption">{evidence.locator.text}</span>
          {originalUrl ? <a className="ul-btn ul-btn--ghost" href={originalUrl} target="_blank" rel="noreferrer"><Icon icon={ArrowSquareOut} />Open original</a> : null}
        </span>
      )}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className={styles.grid}>
        <div className={styles.source}>
          {file.isPending ? <div className="ul-stack">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} />)}</div>
            : file.error ? <EmptyState icon={WarningCircle} title="Source not available">{file.error.message}</EmptyState>
              : <SourcePreview text={file.data.text} type={file.data.type} evidence={evidence} />}
        </div>
        <figure className={styles.still}>
          {still ? <img src={still} alt={evidence.subject ? `${evidence.subject.name} in 3D` : '3D view'} /> : <span className="ul-help">No 3D view open</span>}
          {evidence.subject ? <figcaption className={styles.pill}>{evidence.subject.name}</figcaption> : null}
        </figure>
      </div>
    </Dialog>
  );
}

function SourcePreview({ text, type, evidence }: { text: string; type: string; evidence: EvidenceRef }) {
  const { locator } = evidence;
  const csv = useMemo(() => (type.includes('csv') ? parseCsvRows(text) : null), [text, type]);
  const json = useMemo(() => { try { return type.includes('json') ? JSON.parse(text) : null; } catch { return null; } }, [text, type]);

  if (csv && locator.kind === 'row') {
    const [header, ...rows] = csv;
    const index = locator.row - 2; // row 1 is the header
    const from = Math.max(0, index - 2);
    const shown = rows.slice(from, index + 3);
    const columns = header!.map((name, i) => ({ name, i })).filter((c) => c.name !== 'geometry');
    return (
      <div className={styles.tableWrap}>
        <p className="ul-help">Rows {from + 2}–{from + 1 + shown.length} of {rows.length + 1}. The geometry column is summarised.</p>
        <table className="ul-table">
          <thead><tr><th>Row</th>{columns.map((c) => <th key={c.name}>{c.name}</th>)}<th>geometry</th></tr></thead>
          <tbody>
            {shown.map((row, k) => {
              const rowNumber = from + k + 2;
              return (
                <tr key={rowNumber} aria-selected={rowNumber === locator.row} className={rowNumber === locator.row ? styles.hit : undefined}>
                  <td className="ul-num">{rowNumber}</td>
                  {columns.map((c) => <td key={c.name} className={styles.cell}>{row[c.i]}</td>)}
                  <td className={styles.cell}>{geometrySummary(row[header!.indexOf('geometry')])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  if (json && locator.kind === 'pointer') {
    const featurePointer = /^\/features\/\d+/.exec(locator.pointer)?.[0] ?? locator.pointer;
    const node = resolvePointer(json, featurePointer) as { properties?: Record<string, unknown>; geometry?: { type: string } } | undefined;
    const field = locator.pointer.startsWith(`${featurePointer}/properties/`) ? locator.pointer.slice(`${featurePointer}/properties/`.length) : null;
    if (!node) return <p className="ul-help">The pointer {locator.pointer} does not resolve in this file.</p>;
    return (
      <div className={styles.tableWrap}>
        <p className="ul-help">JSON pointer <code className="ul-mono">{featurePointer}</code> · {node.geometry?.type ?? 'no geometry'}</p>
        <table className="ul-table">
          <tbody>
            {Object.entries(node.properties ?? {}).map(([key, value]) => (
              <tr key={key} aria-selected={key === field} className={key === field ? styles.hit : undefined}>
                <th scope="row" className={styles.key}>{key}</th>
                <td className="ul-mono">{value === null ? 'null' : String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <pre className={styles.raw}>{text.slice(0, 4000)}</pre>;
}

function geometrySummary(wkt: string | undefined): string {
  if (!wkt) return '';
  const points = (wkt.match(/-?\d+\.\d+ -?\d+\.\d+/g) ?? []).length;
  return `${wkt.split(' ')[0]} · ${points} points`;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function fileName(response: Response): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  return /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'Source file';
}

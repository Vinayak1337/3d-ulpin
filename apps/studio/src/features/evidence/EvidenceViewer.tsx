import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import type { DocumentPages } from '@ulpin/api-client/draft';
import { Badge, Button, Dialog, EmptyState, EvidenceChip, Icon, Skeleton } from '@ulpin/ui';
import { useDocumentPages, usePageImage } from '../../api/queries';
import { resolvePointer, type EvidenceRef } from './refs';
import styles from './EvidenceViewer.module.css';

/**
 * S7 Evidence viewer: the retained original beside a still of the 3D space. Paged documents show the
 * page the locator anchors to; files are previewed by locator kind (row → table rows, JSON pointer →
 * the pointed node), so a new format with an existing locator kind needs no new viewer.
 */
export function EvidenceViewer({ evidence, still, onClose }: { evidence: EvidenceRef; still: string | null; onClose: () => void }) {
  const pages = useDocumentPages(evidence.sourceId);
  if (pages.isPending) return <Dialog title={evidence.label} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}><div className="ul-stack">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} />)}</div></Dialog>;
  if (pages.data) return <PagedViewer evidence={evidence} still={still} doc={pages.data} onClose={onClose} />;
  return <FileViewer evidence={evidence} still={still} onClose={onClose} />;
}

/** Documents (plans, deeds, survey reports): the page the locator points to, with the subject drawn on calibrated plans. */
function PagedViewer({ evidence, still, doc, onClose }: { evidence: EvidenceRef; still: string | null; doc: DocumentPages; onClose: () => void }) {
  const locator = evidence.locator.text;
  const anchor = doc.anchors.find((a) => locator === a.locator || locator.startsWith(`${a.locator} `) || locator.startsWith(`${a.locator}·`));
  const anchored = anchor?.page ?? Number(/\bp\.(\d+)/.exec(locator)?.[1] ?? NaN);
  const [whole, setWhole] = useState(false);
  const [pageNo, setPageNo] = useState(Number.isFinite(anchored) ? anchored : doc.pages[0]!.page);
  const page = doc.pages.find((p) => p.page === pageNo) ?? doc.pages[0]!;
  const image = usePageImage(page.url);
  const cal = page.calibration;
  const outline = cal && evidence.subject?.outline?.length
    ? evidence.subject.outline.map(([x, y]) => `${cal.origin[0] + x! * cal.scale},${cal.origin[1] - y! * cal.scale}`).join(' ') : null;
  const title = `${evidence.label} · p.${page.page}`;
  // Open on the part of the page the locator names: the subject on a calibrated plan, or the anchor's region.
  const focus = whole ? null : outline && cal ? regionAround(evidence.subject!.outline!.map(([x, y]) => [cal.origin[0] + x! * cal.scale, cal.origin[1] - y! * cal.scale]))
    : anchor?.page === page.page && anchor.region ? pageRegion(anchor.region) : null;
  const viewBox = focus ? focus.join(' ') : '0 0 842 595';
  return (
    <Dialog
      title={title}
      onClose={onClose}
      aside={(
        <span className="ul-row">
          <Badge icon={null}>{doc.revision}</Badge>
          <span className="ul-caption">{doc.name}</span>
          {image.data ? <a className="ul-btn ul-btn--ghost" href={image.data} target="_blank" rel="noreferrer"><Icon icon={ArrowSquareOut} />Open original</a> : null}
        </span>
      )}
      footer={(
        <>
          {evidence.supports?.length ? (
            <span className={styles.supports}>
              <span className="ul-muted">Supports</span>
              {evidence.supports.map((s) => <EvidenceChip key={s.source} source={s.source} locator={s.locator} />)}
            </span>
          ) : <span className={styles.supports} />}
          <Button onClick={onClose}>Close</Button>
        </>
      )}
    >
      <div className={styles.grid}>
        <div className={styles.pageColumn}>
          <div className={styles.page}>
            {image.isPending ? <Skeleton width="100%" height={320} /> : image.error ? <EmptyState icon={WarningCircle} title="Page not available">{image.error.message}</EmptyState> : (
              <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className={styles.pageSvg} role="img" aria-label={`${doc.name}, page ${page.page}${evidence.subject ? `, ${evidence.subject.name} outlined` : ''}`}>
                <image href={image.data} width="842" height="595" />
                {outline ? <polygon points={outline} className={styles.outline} /> : null}
              </svg>
            )}
          </div>
          {doc.pages.length > 1 ? (
            <div className={styles.pager} role="tablist" aria-label="Pages">
              {doc.pages.map((p) => (
                <button key={p.page} type="button" role="tab" aria-selected={p.page === page.page} onClick={() => setPageNo(p.page)} title={p.label}>p.{p.page}</button>
              ))}
              <span className="ul-caption">{page.label}</span>
            </div>
          ) : null}
          {focus || whole ? <button type="button" className={`ul-btn ul-btn--ghost ${styles.fit}`} onClick={() => setWhole((w) => !w)}>{whole ? 'Zoom to the cited part' : 'Whole page'}</button> : null}
        </div>
        <figure className={styles.still}>
          {still ? <img src={still} alt={evidence.subject ? `${evidence.subject.name} in 3D` : '3D view'} /> : <span className="ul-help">No 3D view open</span>}
          {evidence.subject ? <figcaption className={styles.pill}>{evidence.subject.name}</figcaption> : null}
        </figure>
      </div>
    </Dialog>
  );
}

/** A page region around points, padded and at the page's aspect ratio. */
function regionAround(points: number[][]): [number, number, number, number] {
  const xs = points.map(([x]) => x!), ys = points.map(([, y]) => y!);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = (Math.max(...xs) - Math.min(...xs)) * 2.4, h = (Math.max(...ys) - Math.min(...ys)) * 2.4;
  return pageRegion([cx - w / 2, cy - h / 2, w, h]);
}

/** Grows a region to the page's aspect ratio (about its centre) and keeps it on the page. */
function pageRegion([x, y, w, h]: [number, number, number, number]): [number, number, number, number] {
  const cx = x + w / 2, cy = y + h / 2;
  if (w / h > 842 / 595) h = (w * 595) / 842; else w = (h * 842) / 595;
  const clamp = (v: number, size: number, max: number) => (size >= max ? (max - size) / 2 : Math.min(Math.max(v, 0), max - size));
  return [clamp(cx - w / 2, w, 842), clamp(cy - h / 2, h, 595), w, h];
}

/** Tables and feature files: the rows or node the locator names. */
function FileViewer({ evidence, still, onClose }: { evidence: EvidenceRef; still: string | null; onClose: () => void }) {
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

import { Badge } from './Badge';
import { Icon } from './Icon';

const LOCATION_PARTS = ['Parcel anchor', 'Structure', 'Level', 'Space'];

export interface UlpinCodeProps {
  /** The proposed project code `P3-<20 symbols>-<2 check>`, e.g. "P3-7Q4M2R8T6V0W3X5Y9ZAB-R4". Omit for a draft. */
  code?: string;
  /** Display-only location line `<parcel anchor> / <structure> / <level> / <space>`, e.g. "MH2507A1B3C4D5 / S01 / F07 / R003". Never identity. */
  location?: string;
  /** Assigned (solid), draft (no code yet), retired (struck through, with successor note) or cancelled (struck through, with reason). */
  state?: 'assigned' | 'draft' | 'retired' | 'cancelled';
  /** Full labelled block: "3D ULPIN (proposed) · Assigned" caption, the code, then the location line with its caption. When false, only the code chip (and the location as a muted mono line). */
  labelled?: boolean;
  /** Under the location line, a legend naming each segment (Parcel anchor, Structure, Level, Space). */
  legend?: boolean;
  /** Show the copy action on the code. */
  copyable?: boolean;
  onCopy?: (code: string) => void;
  /** Tooltips for each location segment; defaults to the segment role. */
  locationTitles?: string[];
  /** Retired: "Retired 12 Sep 2026 · merged into P3-9F2K…-RS". Cancelled: the reason. */
  note?: string;
}

function CodeChip({ code, className, copyable, onCopy }: { code: string; className?: string; copyable?: boolean; onCopy?: (c: string) => void }) {
  const parts = code.split('-');
  const check = parts.length > 2 ? parts[parts.length - 1] : undefined;
  const segs = check ? parts.slice(0, -1) : parts;
  return (
    <span className={['ul-code', className].filter(Boolean).join(' ')}>
      {segs.map((s, i) => (
        <span key={i} className="ul-code__seg">
          {s}
        </span>
      ))}
      {check && (
        <span className="ul-code__check" title="Error-detection check, not authentication">
          {check}
        </span>
      )}
      {copyable && (
        <button type="button" className="ul-code__copy" aria-label="Copy code" onClick={() => onCopy?.(code)}>
          <Icon name="selection-background" size="sm" />
        </button>
      )}
    </span>
  );
}

/**
 * A space's identity: the proposed 3D ULPIN as copyable mono segments, and the display-only location line.
 */
export function UlpinCode({
  code,
  location,
  state = code ? 'assigned' : 'draft',
  labelled = true,
  legend = false,
  copyable = true,
  onCopy,
  locationTitles,
  note,
}: UlpinCodeProps) {
  if (state === 'draft' || !code) {
    return (
      <div className="ul-row">
        <span className="ul-code ul-code--provisional">
          <span className="ul-code__seg">Code assigned after review</span>
        </span>
        <Badge status="Draft" icon="clock-counter-clockwise" />
        {location && <span className="ul-help ul-mono">{location}</span>}
      </div>
    );
  }
  if (state === 'retired' || state === 'cancelled') {
    return (
      <div className="ul-row">
        <CodeChip code={code} className="ul-code--retired" />
        {note && <span className="ul-help">{note}</span>}
      </div>
    );
  }
  if (!labelled) {
    return (
      <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
        <CodeChip code={code} copyable={copyable} onCopy={onCopy} />
        {location && <span className="ul-help ul-mono">{location}</span>}
      </div>
    );
  }
  const segs = location ? location.split('/').map((s) => s.trim()) : [];
  return (
    <div>
      <div className="ul-caption">3D ULPIN (proposed) · Assigned</div>
      <CodeChip code={code} copyable={copyable} onCopy={onCopy} />
      {location && (
        <>
          <div className="ul-caption" style={{ marginTop: 8 }}>
            Location (display only)
          </div>
          <span className="ul-code" style={{ background: 'transparent', color: 'var(--ink-soft)' }}>
            {segs.map((s, i) => (
              <span key={i} className="ul-code__seg" title={locationTitles?.[i] ?? LOCATION_PARTS[i]}>
                {s}
              </span>
            ))}
          </span>
          {legend && (
            <div className="ul-code-legend">
              {LOCATION_PARTS.slice(0, segs.length).map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

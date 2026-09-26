import { Copy } from '@phosphor-icons/react';
import { Icon } from './Icon';

export type CodeState = 'assigned' | 'draft' | 'retired' | 'cancelled';

/**
 * Identity: the opaque proposed P3 code (no segment meaning, so no tooltips) and the separate,
 * display-only Location line. Never called official.
 */
export function UlpinCode({ code, location, state = 'assigned', copyable = true, legend }: {
  code?: string | null; location?: string[] | null; state?: CodeState; copyable?: boolean; legend?: boolean;
}) {
  const match = code ? /^(P3)-([0-9A-Z]{20})-([0-9A-Z]{2})$/.exec(code) : null;
  const stateWord = state === 'assigned' ? 'Assigned' : state === 'draft' ? 'Draft' : state === 'retired' ? 'Retired' : 'Cancelled';
  return (
    <div className="ul-idblock">
      <span className="ul-idblock__label">3D ULPIN (proposed) · {stateWord}</span>
      {match ? (
        <span className={`ul-code${state === 'retired' || state === 'cancelled' ? ' ul-code--retired' : ''}`} aria-label={`3D ULPIN (proposed) ${code}`}>
          <span className="ul-code__seg ul-code__prefix">{match[1]}</span>
          <span className="ul-code__seg">{match[2]}</span>
          <span className="ul-code__check">{match[3]}</span>
          {copyable ? (
            <button type="button" className="ul-code__copy" aria-label="Copy code" onClick={() => void navigator.clipboard?.writeText(code!)}>
              <Icon icon={Copy} size={16} />
            </button>
          ) : null}
        </span>
      ) : (
        <span className="ul-code ul-code--provisional"><span className="ul-code__seg">Code assigned after review</span></span>
      )}
      {location?.length ? (
        <>
          <span className="ul-idblock__label">Location (display only)</span>
          <span className="ul-code ul-code--location">
            {location.map((segment, index) => <span key={index} className="ul-code__seg" title={LOCATION_PARTS[index]}>{segment}</span>)}
          </span>
          {legend ? <span className="ul-code-legend">{LOCATION_PARTS.slice(0, location.length).map((part) => <span key={part}>{part}</span>)}</span> : null}
        </>
      ) : null}
    </div>
  );
}

const LOCATION_PARTS = ['Parcel anchor', 'Structure', 'Level', 'Space'];

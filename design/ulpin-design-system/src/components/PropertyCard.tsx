import type { CSSProperties } from 'react';
import { DescriptionList, type DescriptionItem } from './DescriptionList';
import { Icon } from './Icon';
import { Wordmark } from './StudioHeader';
import { UlpinCode } from './UlpinCode';

export interface PropertyCardProps {
  /** "Flat 704, Lake View Residence". */
  title: string;
  /** Proposed 3D ULPIN. */
  code: string;
  /** Display-only location line. */
  location: string;
  /** Released facts only: Parcel ULPIN, level with its vertical reference, areas, share, rights, evidence. Never personal data. */
  facts: DescriptionItem[];
  /** Revision and its shortened hash: "r3", "7f3a…c2e1". */
  revision: string;
  hash: string;
  /** Chain state word for the footer. */
  chain?: string;
  /** QR accessible label, e.g. "QR code: local demonstration link". */
  qrLabel?: string;
  style?: CSSProperties;
}

/**
 * The one-page A4 card for a space: identity, level, areas, share, rights, evidence, revision and a QR. A technical record, not a title document.
 */
export function PropertyCard({
  title,
  code,
  location,
  facts,
  revision,
  hash,
  chain = 'chain consistent',
  qrLabel = 'QR code: local demonstration link',
  style,
}: PropertyCardProps) {
  return (
    <article className="ul-card" style={style}>
      <div className="ul-card__head">
        <div>
          <Wordmark surface="Property Card" size={15} />
          <h3 style={{ margin: '8px 0 6px', font: '600 20px/26px var(--font-sans)' }}>{title}</h3>
          <UlpinCode code={code} location={location} labelled={false} copyable={false} />
        </div>
        <div className="ul-qr" role="img" aria-label={qrLabel}>
          <Icon name="qr-code" />
        </div>
      </div>
      <DescriptionList items={facts} />
      <div className="ul-card__foot">
        <span>Technical record, not a title document.</span>
        <span className="ul-mono">
          {revision} · {hash} · {chain}
        </span>
      </div>
    </article>
  );
}

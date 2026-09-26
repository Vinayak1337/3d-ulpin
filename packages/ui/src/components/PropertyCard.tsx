import type { ReactNode } from 'react';
import { UlpinCode } from './UlpinCode';
import { DescriptionList, type Fact } from './DescriptionList';

/**
 * One-page card for a space. Released fields only; footer says it is a technical record, not a
 * title document, with the revision, hash and chain state. The QR opens the verification page.
 */
export function PropertyCard({ title, code, location, facts, revision, hash, chain, qr }: {
  title: string; code: string | null; location: string[] | null; facts: Fact[];
  revision: string; hash: string; chain: string; qr: ReactNode;
}) {
  return (
    <article className="ul-card">
      <div className="ul-card__head">
        <div className="ul-stack" style={{ gap: 6 }}>
          <span className="ul-wordmark">BhuAayam <small>Property Card</small></span>
          <h2 className="ul-title" style={{ fontSize: 20, lineHeight: '28px' }}>{title}</h2>
        </div>
        <div className="ul-qr">{qr}</div>
      </div>
      <UlpinCode code={code} location={location} copyable={false} />
      <DescriptionList items={facts} />
      <footer className="ul-card__foot">
        <span>Technical record, not a title document.</span>
        <span className="ul-mono">{revision} · {hash} · {chain}</span>
      </footer>
    </article>
  );
}

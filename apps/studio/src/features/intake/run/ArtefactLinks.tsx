import { Link } from 'react-router';
import { cardPdfPath, cardVerificationPath } from '../../identity/registryCard';
import type { Target } from './model';
import styles from './Run.module.css';

export function ArtefactLinks({ target, onOpen }: { target: Target; onOpen?: () => void }) {
  const { record, card, verification } = target.artefacts;
  return <span className={styles.links}>
    {record ? <Link className="ul-btn" to={`/studio/properties/${target.featureId}/register`} onClick={onOpen}>
      Open record
    </Link> : null}
    {card ? <>
      <a className="ul-btn" href={cardPdfPath(card.id, card.revision)} target="_blank" rel="noreferrer"
        onClick={onOpen}>Open card PDF</a>
      <Link className="ul-btn" to={cardVerificationPath(card.id, card.revision)} onClick={onOpen}>
        Verification
      </Link>
    </> : null}
    {verification ? <span className="ul-help">Card consistent</span> : null}
  </span>;
}

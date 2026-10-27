import { Link, useParams } from 'react-router';
import { Badge, Button, DescriptionList, Panel, Skeleton, formatDateTime } from '@ulpin/ui';
import { useCardVerification, type CardVerification } from '../../api/queries';
import { CopyableId } from '../identity/CopyableId';
import { cardPdfPath, isNotFound, readFailure } from '../identity/registryCard';
import { cardAddress, checkRows, recordText, signatureText, verdictOf } from './verification';
import { ResultBanner, VerifyFrame } from './VerifyFrame';
import styles from './VerifyPage.module.css';

// The sentence the registry's card PDF prints under its heading (docs/evidence/runtime/r3, step3.printed.card).
export const CARD_STATEMENT = 'Application summary. No official ULPIN issuance, title or legal approval is implied.';
const NOT_AN_ADDRESS = 'The server was not asked: this address names no card id and revision.';

/** The server's verification report of one registry card revision: what it checked, when, and what it found. */
export function CardVerificationPage() {
  const { cardId, revision } = useParams();
  const address = cardAddress(cardId, revision);
  const report = useCardVerification(address?.cardId ?? null, address?.revision ?? null);
  return <VerifyFrame><Content addressed={Boolean(address)} report={report} /></VerifyFrame>;
}

function Content({ addressed, report }: { addressed: boolean; report: ReturnType<typeof useCardVerification> }) {
  if (!addressed) return <NoCard reason={NOT_AN_ADDRESS} />;
  if (report.data) return <Report report={report.data} />;
  if (isNotFound(report.error)) return <NoCard />;
  if (report.error) {
    const retry = <Button variant="soft" onClick={() => void report.refetch()}>Try again</Button>;
    return (
      <ResultBanner tone="danger" small action={retry}>
        Could not check this card. {readFailure(report.error)}
      </ResultBanner>
    );
  }
  return (
    <div className="ul-panel ul-pad ul-stack">
      <Skeleton height={28} width="55%" />
      <Skeleton width="80%" />
      <Skeleton />
    </div>
  );
}

/** One page for an unknown card and an unknown revision: the server answers both the same way. */
function NoCard({ reason }: { reason?: string }) {
  return (
    <div className="ul-panel ul-pad ul-stack">
      <h1 className="ul-title">No card with this id and revision</h1>
      {reason ? <p className="ul-help">{reason}</p> : null}
      <Link to="/studio/work" className="ul-btn">Back to Studio</Link>
    </div>
  );
}

function Checks({ report }: { report: CardVerification }) {
  return (
    <Panel title="Checks">
      <DescriptionList items={[
        ...checkRows(report).map((check) => ({
          label: check.label,
          value: (
            <span className="ul-row">
              <Badge tone={check.tone} icon={null}>{check.state}</Badge>
              {check.reasonCode ? <span className="ul-mono">{check.reasonCode}</span> : null}
            </span>
          ),
        })),
        { label: 'Signature', value: signatureText(report.signature) },
      ]} />
    </Panel>
  );
}

export function Report({ report }: { report: CardVerification }) {
  const verdict = verdictOf(report);
  const { lifecycle } = report;
  const expires = lifecycle.expiresAt ? formatDateTime(lifecycle.expiresAt) : <em className="ul-unknown">Unknown</em>;
  return (
    <>
      <ResultBanner tone={verdict.tone}>
        {verdict.detail ? `${verdict.text} · ${verdict.detail}` : verdict.text}
      </ResultBanner>
      <p className="ul-help">{CARD_STATEMENT}</p>
      <section className="ul-panel ul-pad ul-stack">
        <h1 className="ul-title">Property card verification</h1>
        <DescriptionList items={[
          { label: 'Card', value: <CopyableId id={report.cardId} name="card id" /> },
          { label: 'Revision', value: `${report.revision} (latest: ${lifecycle.latestRevision})` },
          { label: 'Expires', value: expires },
          { label: 'Unit record', value: recordText(report.snapshot) },
          { label: 'Checked', value: formatDateTime(report.checkedAt) },
        ]} />
        <a className={`ul-btn ${styles.start}`} href={cardPdfPath(report.cardId, report.revision)} target="_blank"
          rel="noreferrer">
          Open card PDF
        </a>
      </section>
      <Checks report={report} />
    </>
  );
}

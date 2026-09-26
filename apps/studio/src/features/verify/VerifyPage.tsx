import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CheckCircle, Warning, WarningOctagon } from '@phosphor-icons/react';
import { Button, DescriptionList, Icon, RevisionTimeline, Skeleton, UlpinCode, formatDate, formatDateTime } from '@ulpin/ui';
import { chainState, shortHash, type SpaceWorkflow } from '../../local/workflow';
import { useResolveCode } from '../workflow/useWorkflow';
import styles from './VerifyPage.module.css';

/**
 * P4L: the Property Card's QR opens this page on the same device. It resolves the exact code and
 * revision locally; public verification is full product.
 */
export function VerifyPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const revision = Number(params.get('rev')) || null;
  const resolved = useResolveCode(code);
  const [chain, setChain] = useState<'consistent' | 'broken' | 'unknown'>('unknown');
  useEffect(() => {
    if (resolved.data) void chainState(resolved.data).then(setChain);
  }, [resolved.data]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className="ul-wordmark">BhuAayam <small>Verify</small></span>
        <Link to="/studio/work" className="ul-btn ul-btn--ghost">Back to Studio</Link>
      </header>
      <main className={styles.main}>
        <p className={styles.note}>Local link on this device. Public verification is planned.</p>
        {resolved.isPending ? (
          <div className="ul-panel ul-pad ul-stack"><Skeleton height={28} width="55%" /><Skeleton width="80%" /><Skeleton /><Skeleton width="40%" /></div>
        ) : resolved.error ? (
          <div className={`${styles.result} ${styles.danger}`} role="alert">
            <Icon icon={WarningOctagon} />
            <span className={styles.resultText}>Could not check this card. {resolved.error.message}</span>
            <Button variant="soft" onClick={() => void resolved.refetch()}>Try again</Button>
          </div>
        ) : !resolved.data ? (
          <div className="ul-panel ul-pad ul-stack">
            <h1 className="ul-heading">No card found for this link</h1>
            <p className="ul-help">This device has no Property Card with this code. Make the card in the Studio first, on this device.</p>
            <Link to="/studio/work" className="ul-btn">Back to Studio</Link>
          </div>
        ) : (
          <Result workflow={resolved.data} revision={revision} chain={chain} />
        )}
      </main>
    </div>
  );
}

function Result({ workflow, revision, chain }: { workflow: SpaceWorkflow; revision: number | null; chain: 'consistent' | 'broken' | 'unknown' }) {
  const head = workflow.events[0]!;
  const superseded = revision !== null && revision < head.revision;
  return (
    <>
      <div className={`${styles.result} ${superseded ? styles.warning : styles.success}`}>
        <Icon icon={superseded ? Warning : CheckCircle} />
        <span className={styles.resultText}>{superseded ? `Superseded by revision r${head.revision}` : `Valid: revision r${head.revision}`}</span>
      </div>
      <section className="ul-panel ul-pad ul-stack">
        <h1 className="ul-heading">{workflow.spaceName}</h1>
        <UlpinCode code={workflow.code} state="assigned" />
        <DescriptionList items={[
          { label: 'Assigned', value: workflow.assignedAt ? formatDate(workflow.assignedAt) : 'Unknown' },
          { label: 'Revision hash', value: <span className="ul-mono">{shortHash(head.hash)}</span> },
          { label: 'Parcel ULPIN', value: <span className="ul-unknown">Official parcel anchor not supplied</span> },
        ]} />
      </section>
      <RevisionTimeline
        chain={chain}
        revisions={workflow.events.map((e) => ({
          id: String(e.revision), title: e.title, byline: `${e.by} · ${formatDateTime(e.at)}`, kind: e.kind,
          hash: shortHash(e.hash), previousHash: e.previousHash ? shortHash(e.previousHash) : null,
        }))}
      />
    </>
  );
}

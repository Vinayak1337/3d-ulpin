import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from '../batch-model';
import { useBatchPackages } from '../batch-queries';
import type { Target } from '../run/model';
import { evidenceKey, useEvidencePage } from './api';
import { DeclareKey, type DeclareChoices } from './DeclareKey';
import { EvidenceRead } from './EvidenceRead';
import { anchorItems, documentChoices, tableChoices, type Outcome } from './model';
import batch from '../Batch.module.css';

/** The batch section "Evidence by key": declare a key, then read what each source matched. */
export function EvidenceByKey({ caseId, items }: { caseId: string; items: readonly IntakeItem[] }) {
  const targets = useBatchPackages(caseId);
  const client = useQueryClient();
  const [declaring, setDeclaring] = useState(false);
  const choices: DeclareChoices = { anchors: anchorItems(items, targets.data?.packages ?? []),
    tables: tableChoices(items), documents: documentChoices(items) };
  return <section className={batch.question} aria-labelledby="evidence-by-key">
    <h2 className="ul-heading" id="evidence-by-key">Evidence by key</h2>
    {declaring ? <DeclareKey caseId={caseId} choices={choices} cancel={() => setDeclaring(false)} done={() => {
      setDeclaring(false);
      void client.invalidateQueries({ queryKey: evidenceKey(caseId) });
    }} /> : <DeclareStart drafted={choices.anchors.length > 0} declare={() => setDeclaring(true)} />}
    <EvidenceSection caseId={caseId} items={items} targets={targets.data?.items ?? []} />
  </section>;
}

function DeclareStart({ drafted, declare }: { drafted: boolean; declare: () => void }) {
  return <div className="ul-row">
    <Button variant="soft" disabled={!drafted} onClick={declare}>Link a register by a key</Button>
    {drafted ? null : <span className="ul-help">A key can be declared once a map item of this batch has drafted
      buildings.</span>}
  </div>;
}

function EvidenceSection({ caseId, items, targets }: {
  caseId: string; items: readonly IntakeItem[]; targets: readonly Target[];
}) {
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useEvidencePage(caseId, outcome, cursor);
  if (page.isPending) return <Skeleton />;
  if (!page.data) return <Banner tone="warning">{page.error?.message}</Banner>;
  const next = page.data.nextCursor;
  return <>
    {page.error ? <Banner tone="warning">{page.error.message} This shows the last successful read.</Banner> : null}
    <EvidenceRead page={page.data} items={items} targets={targets} paging={{ outcome, first: cursor === null,
      loading: page.isPlaceholderData, setOutcome: (value) => {
        setOutcome(value);
        setCursor(null);
      }, firstPage: () => setCursor(null), nextPage: next ? () => setCursor(next) : null }} />
  </>;
}

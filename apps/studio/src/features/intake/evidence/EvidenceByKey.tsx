import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from '../batch-model';
import { DisabledReason } from '../DisabledReason';
import { needsLayoutAnswer } from '../question-model';
import { focusSection } from '../StepStrip';
import { intakeManifestOptions, useBatchPackages } from '../batch-queries';
import { tableKey } from '../table/queries';
import type { Target } from '../run/model';
import { evidenceKey, evidencePageOptions, useEvidencePage, useReadTables } from './api';
import { ConfirmEvidence, type ConfirmRead } from './ConfirmEvidence';
import { confirmedOf, type EvidenceConfirmation } from './confirm-model';
import { DeclareKey, type DeclareChoices } from './DeclareKey';
import { EvidenceRead } from './EvidenceRead';
import { anchorItems, declareFromLink, documentChoices, tableChoices,
  type LinkDeclaration, type Outcome, type ReadingLink, type SourceProfile } from './model';
import batch from '../Batch.module.css';
import styles from './Evidence.module.css';

/** Only the link's two sources are read, under the profile keys the manual form already uses. */
export function DeclareLink({ caseId, link, onDeclare }: {
  caseId: string; link: ReadingLink; onDeclare: (initial: LinkDeclaration) => void;
}) {
  const description = useId();
  const manifest = useQuery({ ...intakeManifestOptions(caseId), enabled: false });
  const items = manifest.data?.items ?? [];
  const pair = items.filter(item => [link.fromItemId, link.itemId].includes(item.itemId));
  const sources = [...new Set(pair.flatMap(item => item.sourceId ? [item.sourceId] : []))];
  const profiles = useQueries({ queries: sources.map(sourceId => ({
    queryKey: [...tableKey(caseId, sourceId), 'profile'], retry: false, enabled: link.by !== 'place',
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile', {
      params: { path: { caseId, sourceId } },
    })) as SourceProfile,
  })) });
  const packages = useBatchPackages(caseId);
  const initial = declareFromLink(link, items, new Map(profiles.flatMap((profile, index) =>
    profile.data ? [[sources[index]!, profile.data] as const] : [])));
  if (!initial) return null;
  const drafted = anchorItems(items, packages.data?.packages ?? [])
    .some(item => item.itemId === initial.anchorItemId);
  const anchor = items.find(item => item.itemId === initial.anchorItemId);
  const layout = anchor && needsLayoutAnswer(anchor) ? `intake-layout-${anchor.itemId}` : null;
  return <>
    {!drafted ? <DisabledReason id={description} action={layout ? { label: 'Answer the layout',
      press: () => focusSection(document.getElementById(layout) ? layout : 'intake-answers') } : undefined}>
      Available once this file is drafted.
    </DisabledReason> : null}
    <Button variant="soft" disabled={!drafted} aria-describedby={!drafted ? description : undefined}
      onClick={() => onDeclare(initial)}>
      Declare
    </Button>
  </>;
}

const CONFIRM_ID = 'confirm-evidence';

/**
 * The batch section "Evidence by key": declare a key, then read what each source matched. It shows only once a map
 * item of this batch has drafted buildings. S7.23a: it starts collapsed under its heading and the count of declared
 * keys, and opens when pressed, when focus is sent to it (a Declare press, Needs you) or while a declaration is open.
 */
export function EvidenceByKey({ caseId, items, requested, clearRequest }: {
  caseId: string; items: readonly IntakeItem[]; requested?: LinkDeclaration | null; clearRequest?: () => void;
}) {
  const targetPage = useBatchPackages(caseId);
  const client = useQueryClient();
  const [form, setForm] = useState<{ initial?: LinkDeclaration; revision: number } | null>(null);
  const [opened, setOpened] = useState<{ refocus: boolean } | null>(null);
  const section = useRef<HTMLElement>(null);
  const anchors = anchorItems(items, targetPage.data?.packages ?? []);
  const declared = useQuery({ ...evidencePageOptions(caseId), enabled: anchors.length > 0 });
  const open = opened !== null || form !== null;
  // A Needs-you press lands on the closed heading; once open, focus moves to the confirmation itself.
  useEffect(() => {
    if (opened?.refocus) focusSection(CONFIRM_ID);
  }, [opened]);
  useEffect(() => {
    if (!requested) return;
    setForm(previous => ({ initial: requested, revision: (previous?.revision ?? 0) + 1 }));
    setOpened(previous => previous ?? { refocus: false });
    clearRequest?.();
    section.current?.focus();
    section.current?.scrollIntoView?.({ block: 'nearest' });
  }, [requested, clearRequest]);
  const close = () => setForm(null);
  const read = useReadTables(caseId, items, form !== null);
  const tables = tableChoices(items, read);
  const choices: DeclareChoices = { anchors,
    tables: tables.map(table => form?.initial?.tables.find(initial => initial.itemId === table.itemId) ?? table),
    documents: documentChoices(items) };
  if (!choices.anchors.length) return null;
  const reveal = (event: FocusEvent<HTMLElement>) => {
    if (!open && event.target.tagName !== 'BUTTON') setOpened({ refocus: event.target.id === CONFIRM_ID });
  };
  const toggle = () => {
    setOpened(open ? null : { refocus: false });
    if (open) close();
  };
  const count = declared.data?.profiles.length;
  return <section ref={section} tabIndex={-1} className={batch.question} aria-labelledby="evidence-by-key"
    onFocus={reveal}>
    <h2 className="ul-heading" id="evidence-by-key">
      <span id={!open && count ? CONFIRM_ID : undefined}>
        <Button variant="ghost" icon={open ? CaretDown : CaretRight} aria-expanded={open} onClick={toggle}>
          Evidence by key{count === undefined ? '' : ` (${count})`}
        </Button>
      </span>
    </h2>
    {open ? <>
      {form ? <DeclareKey key={form.revision} caseId={caseId} choices={choices}
        initial={form.initial} cancel={close} done={() => {
        close();
        void client.invalidateQueries({ queryKey: evidenceKey(caseId) });
      }} /> : <DeclareStart declare={() => setForm({ revision: 0 })} />}
      <EvidenceSection caseId={caseId} items={items} targets={targetPage.data?.items ?? []} />
    </> : null}
  </section>;
}

function DeclareStart({ declare }: { declare: () => void }) {
  return <div className="ul-row">
    <Button variant="soft" onClick={declare}>Link a register by a key</Button>
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
    <ConfirmSection caseId={caseId} read={{ page: page.data, items, targets, query: { outcome, cursor } }} />
  </>;
}

/**
 * D3: each declared key is confirmed on its own, one at a time, from the evidence as read. EVS3: the candidates its
 * stored confirmations accepted, as the read lists them and as each confirmation stored here answers until the read
 * catches up, are not offered again by "Accept every exact single match of this file".
 */
function ConfirmSection({ caseId, read }: { caseId: string; read: ConfirmRead }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<readonly EvidenceConfirmation[]>([]);
  const open = read.page.profiles.find((profile) => profile.profileId === profileId);
  if (!read.page.profiles.length) return null;
  return <section className={batch.stack} aria-labelledby={CONFIRM_ID}>
    <h3 className="ul-heading" id={CONFIRM_ID}>Confirm the evidence of a key</h3>
    {open ? <ConfirmEvidence key={open.profileId} caseId={caseId} profile={open} read={read}
      close={() => setProfileId(null)} confirmed={confirmedOf(read.page, open, confirmed)}
      stored={(confirmation) => setConfirmed((previous) => [...previous, confirmation])} />
      : <ul className={styles.list}>
      {read.page.profiles.map((profile) => <li key={profile.profileId}>
        <Button variant="soft" onClick={() => setProfileId(profile.profileId)}>
          Confirm the evidence of {profile.input.namespace}
        </Button>
      </li>)}
    </ul>}
  </section>;
}

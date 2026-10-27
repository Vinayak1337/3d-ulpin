import { useId } from 'react';
import { Button, Panel } from '@ulpin/ui';
import { DisabledReason } from '../DisabledReason';
import { focusSection } from '../StepStrip';
import { useIntakeManifest } from '../batch-queries';
import { Confirm } from './Confirm';
import { Packages } from './Packages';
import { Progress } from './Progress';
import { TargetList } from './TargetList';
import { failureWords } from './api';
import { beingRecorded, confirmablePackages, countsLine, hasRecordedPackage, INTAKE_TARGET_LIMITS, noCardWords,
  nothingDrafted, nothingDraftedWords, type TargetPage } from './model';
import { useRun } from './useRun';
import styles from './Run.module.css';

type Props = { caseId: string; mapPath?: string | null; primary?: boolean };

/** One batch's private confirmation and cards; its parent owns intake, layout and route selection. */
export function IntakeRunPanel({ caseId, mapPath, primary }: Props) {
  return <Run key={caseId} caseId={caseId} mapPath={mapPath} primary={primary} />;
}

function Run({ caseId, mapPath, primary }: Props) {
  const run = useRun(caseId);
  const manifest = useIntakeManifest(caseId);
  const page = run.targets.summary.data;
  const packagePage = run.targets.packagePage.data;
  const locked = run.command.busy || run.command.uncertain || run.choosing || run.opening;
  return <div className={styles.stack}>
    <Panel title="Ready buildings and packages">
      {run.targets.summary.isPending ? <p role="status">Reading the batch…</p> : null}
      <ReadErrors run={run} />
      {page && nothingDrafted(page) ? <p>{nothingDraftedWords}</p> : <Button onClick={run.refresh} disabled={locked}>
        Refresh batch
      </Button>}
      {page && !nothingDrafted(page) ? <>
        <p>{countsLine(page.counts)}</p>
        {packagePage ? <Packages packages={packagePage.packages} items={manifest.data?.items}
          reasons={run.discovery.reasons} truncated={packagePage.packagesTruncated} />
          : run.targets.packagePage.error ? null : <p role="status">Reading the next packages…</p>}
        <CardsAction run={run} page={page} locked={locked} />
        <ChoiceControls run={run} locked={locked} />
        <TargetList targets={run.targets.targets} choice={run.choice} filter={run.filter} setFilter={run.setFilter}
          toggle={run.toggle} selectable={run.selectable} recording={beingRecorded(packagePage?.packages ?? [])}
          onOpen={run.priority.open}
          showMore={() => void run.targets.showMore()}
          hasMore={Boolean(run.targets.cursor)} loading={run.targets.busy || run.targets.first.isFetching}
          locked={locked} packages={packagePage?.packages} />
      </> : null}
    </Panel>
    {page && packagePage && canConfirm(run, run.command.preview ?? packagePage) ? <Confirm
      page={run.command.preview ?? packagePage} items={manifest.data?.items} choice={run.choice} cards={run.cards}
      closeCards={run.closeCards} acknowledgement={run.acknowledgement}
      setAcknowledgement={run.setAcknowledgement} busy={run.command.busy} uncertain={run.command.uncertain}
      stale={Boolean(run.targets.summary.error || run.targets.packagePage.error)} error={run.command.error}
      next={run.nextPackages} first={run.targets.packageCursor ? run.firstPackages : undefined} primary={primary}
      press={() => void run.command.press(packagePage, run.cards ?? run.choice, run.acknowledgement,
        Boolean(run.cards))} />
      : null}
    {run.confirmations.map((query, index) => <div key={run.confirmationKeys[index]}>
      {query.isPending ? <p role="status">Reading a stored confirmation…</p> : null}
      {query.error ? <p role="alert">{failureWords(query.error)}</p> : null}
      {query.data ? <Progress caseId={caseId} confirmation={query.data} refresh={run.refresh}
        onOpen={run.priority.open} mapPath={mapPath} /> : null}
    </div>)}
  </div>;
}

type RunState = ReturnType<typeof useRun>;

/** The confirmation shows while a package or a cards list can be confirmed, or a press is still unanswered. */
function canConfirm(run: RunState, page: TargetPage): boolean {
  const pressed = run.command.busy || run.command.uncertain || Boolean(run.command.error);
  return Boolean(run.cards) || pressed || confirmablePackages(page).length > 0;
}

/** Once a package is recorded, the buildings it left without a card can be listed for one more confirmation. */
export function CardsAction({ run, page, locked }: { run: RunState; page: TargetPage; locked: boolean }) {
  const reasonId = useId();
  const failed = !locked && Boolean(run.targets.summary.error);
  if (!hasRecordedPackage(page) || page.counts.recorded === 0) return null;
  return <div className={styles.stack}>
    <p role="status">{noCardWords(page.counts)}</p>
    <div className={styles.controls}>
      <Button disabled={locked || Boolean(run.targets.summary.error)} aria-describedby={failed ? reasonId : undefined}
        onClick={() => void run.openCards()}>
        Make cards for the next {INTAKE_TARGET_LIMITS.confirmationTargets}
      </Button>
    </div>
    {failed ? <DisabledReason id={reasonId} action={{ label: 'Try again', press: run.refresh }}>
      {run.targets.summary.error?.message}
    </DisabledReason> : null}
  </div>;
}

function ChoiceControls({ run, locked }: { run: RunState; locked: boolean }) {
  const reasonId = useId();
  const clearId = useId();
  const failed = !locked && Boolean(run.targets.summary.error);
  const chooseLabel = `Choose the first ${INTAKE_TARGET_LIMITS.confirmationTargets} ready`;
  return <div className={styles.stack}>
    <p role="status">{run.choice.length} buildings chosen for a card.</p>
    <div className={styles.controls}>
      <div>
        <Button disabled={locked || Boolean(run.targets.summary.error)} aria-label={chooseLabel}
          aria-describedby={failed ? reasonId : undefined} onClick={() => void run.chooseFirst()}>
          {chooseLabel}
        </Button>
        {failed ? <DisabledReason id={reasonId} action={{ label: 'Try again', press: run.refresh }}>
          {run.targets.summary.error?.message}
        </DisabledReason> : null}
      </div>
      <div>
        <Button disabled={locked || run.choice.length === 0} aria-label="Clear choice"
          aria-describedby={!locked && !run.choice.length ? clearId : undefined} onClick={run.clear}>
          Clear choice
        </Button>
        {!locked && !run.choice.length ? <DisabledReason id={clearId} action={!failed
          ? { label: 'Choose buildings', press: () => focusSection('intake-run-panel', chooseLabel) } : undefined}>
          No buildings chosen.
        </DisabledReason> : null}
      </div>
    </div>
  </div>;
}

function ReadErrors({ run }: { run: RunState }) {
  const errors = [...new Set([run.targets.summary.error, run.targets.packagePage.error, run.targets.first.error,
    run.targets.error, run.discovery.error, run.selectionError, run.cardsError])].filter(Boolean);
  return <>
    {errors.map((error, index) => <p role="alert" key={index}>{failureWords(error)}</p>)}
    {run.priority.error ? <p role="alert">{run.priority.error}</p> : null}
  </>;
}

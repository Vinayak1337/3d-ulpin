import { Button, Panel } from '@ulpin/ui';
import { Confirm } from './Confirm';
import { Packages } from './Packages';
import { Progress } from './Progress';
import { TargetList } from './TargetList';
import { failureWords } from './api';
import { countsLine, hasRecordedPackage, INTAKE_TARGET_LIMITS, noCardWords, type TargetPage } from './model';
import { useRun } from './useRun';
import styles from './Run.module.css';

/** One batch's private confirmation and cards; its parent owns intake, layout and route selection. */
export function IntakeRunPanel({ caseId }: { caseId: string }) {
  return <Run key={caseId} caseId={caseId} />;
}

function Run({ caseId }: { caseId: string }) {
  const run = useRun(caseId);
  const page = run.targets.summary.data;
  const packagePage = run.targets.packagePage.data;
  const locked = run.command.busy || run.command.uncertain || run.choosing || run.opening;
  return <div className={styles.stack}>
    <Panel title="Ready buildings and packages">
      {run.targets.summary.isPending ? <p role="status">Reading the batch…</p> : null}
      <ReadErrors run={run} />
      <Button onClick={run.refresh} disabled={locked}>Refresh batch</Button>
      {page ? <>
        <p>{countsLine(page.counts)}</p>
        {packagePage ? <Packages packages={packagePage.packages} reasons={run.discovery.reasons}
          truncated={packagePage.packagesTruncated} />
          : run.targets.packagePage.error ? null : <p role="status">Reading the next packages…</p>}
        <CardsAction run={run} page={page} locked={locked} />
        <ChoiceControls run={run} locked={locked} />
        <TargetList targets={run.targets.targets} choice={run.choice} filter={run.filter} setFilter={run.setFilter}
          toggle={run.toggle} selectable={run.selectable} onOpen={run.priority.open}
          showMore={() => void run.targets.showMore()}
          hasMore={Boolean(run.targets.cursor)} loading={run.targets.busy || run.targets.first.isFetching}
          locked={locked} />
      </> : null}
    </Panel>
    {page && packagePage ? <Confirm page={run.command.preview ?? packagePage} choice={run.choice} cards={run.cards}
      closeCards={run.closeCards} acknowledgement={run.acknowledgement}
      setAcknowledgement={run.setAcknowledgement} busy={run.command.busy} uncertain={run.command.uncertain}
      stale={Boolean(run.targets.summary.error || run.targets.packagePage.error)} error={run.command.error}
      next={run.nextPackages} first={run.targets.packageCursor ? run.firstPackages : undefined}
      press={() => void run.command.press(packagePage, run.cards ?? run.choice, run.acknowledgement,
        Boolean(run.cards))} />
      : null}
    {run.confirmations.map((query, index) => <div key={run.confirmationKeys[index]}>
      {query.isPending ? <p role="status">Reading a stored confirmation…</p> : null}
      {query.error ? <p role="alert">{failureWords(query.error)}</p> : null}
      {query.data ? <Progress caseId={caseId} confirmation={query.data} refresh={run.refresh}
        onOpen={run.priority.open} /> : null}
    </div>)}
  </div>;
}

type RunState = ReturnType<typeof useRun>;

/** Once a package is recorded, the buildings it left without a card can be listed for one more confirmation. */
export function CardsAction({ run, page, locked }: { run: RunState; page: TargetPage; locked: boolean }) {
  if (!hasRecordedPackage(page) || page.counts.recorded === 0) return null;
  return <div className={styles.stack}>
    <p role="status">{noCardWords(page.counts)}</p>
    <div className={styles.controls}>
      <Button disabled={locked || Boolean(run.targets.summary.error)} onClick={() => void run.openCards()}>
        Make cards for the next {INTAKE_TARGET_LIMITS.confirmationTargets}
      </Button>
    </div>
    <p className="ul-help">This lists them on the confirmation below; nothing is made before you confirm.</p>
  </div>;
}

function ChoiceControls({ run, locked }: { run: RunState; locked: boolean }) {
  return <div className={styles.stack}>
    <p role="status">{run.choice.length} buildings chosen for a card.</p>
    <div className={styles.controls}>
      <Button disabled={locked || Boolean(run.targets.summary.error)} onClick={() => void run.chooseFirst()}>
        Choose the first {INTAKE_TARGET_LIMITS.confirmationTargets} ready
      </Button>
      <Button disabled={locked || run.choice.length === 0} onClick={run.clear}>Clear choice</Button>
    </div>
    <p className="ul-help">Choose ready buildings here or tick their rows below. Other buildings stay listed.</p>
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

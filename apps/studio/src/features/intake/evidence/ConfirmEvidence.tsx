import { useId, useState } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import { Button, DataTable } from '@ulpin/ui';
import type { IntakeItem } from '../batch-model';
import { DisabledReason } from '../DisabledReason';
import { focusSection } from '../StepStrip';
import type { Target } from '../run/model';
import { runKey } from '../run/useTargets';
import { TableRefusal } from '../table/Progress';
import { createEvidenceConfirmation, evidenceKey, readEvidence, readFileMatches, readPackagePins } from './api';
import { acceptFile, closedReading, confirmInput, decidable, namedBuildings, question, retainedSource, setAccept,
  setReject, singleMatch, sourcesOf, type Choices, type EvidenceConfirmation, type EvidenceSource, type Exclusions,
  type FileSelection } from './confirm-model';
import { buildingWords, coverageWords, evidenceWords, outcomeWords, type Candidate, type EvidencePage,
  type KeyProfile, type Outcome } from './model';
import { useConfirmRefresh } from './confirm-refresh';
import batch from '../Batch.module.css';
import styles from './Evidence.module.css';

/** What the officer has chosen in the form; every pin is read from the evidence read and the targets read. */
export interface ConfirmDraft { exclusions: Exclusions; choices: Choices; acknowledgement: string;
  noAdditions: boolean }
export const blankDraft: ConfirmDraft = { exclusions: {}, choices: {}, acknowledgement: '', noAdditions: false };
type Change = (patch: Partial<ConfirmDraft>) => void;
/** A press either stores a confirmation or names, before any request, what is still missing. */
export type PressResult = { confirmation: EvidenceConfirmation } | { missing: string };
export interface ConfirmRead { page: EvidencePage; items: readonly IntakeItem[]; targets: readonly Target[];
  query?: { outcome: Outcome | ''; cursor: string | null } }
/** "Accept every exact single match of this file": the file being read, each file's words and the read's refusal. */
export interface FileAccepts { reading: string | null; words: Readonly<Record<string, string>>; error: Error | null;
  accept: (itemId: string) => void }

const nameOf = (items: readonly IntakeItem[]) => (itemId: string) =>
  items.find((item) => item.itemId === itemId)?.name ?? 'a file no longer listed';

/** One press: the packages of the named buildings are read now, then one body is sent, or nothing is sent and the
 * words say what is missing. */
export async function pressConfirm(caseId: string, profile: KeyProfile, read: ConfirmRead, draft: ConfirmDraft,
  send: ReturnType<typeof createEvidenceConfirmation>, readPins = readPackagePins): Promise<PressResult> {
  const buildings = namedBuildings(draft.choices, decidable(read.page, profile));
  const packages = await readPins(caseId, [...new Set(buildings.map((building) => building.packageId))]);
  const input = confirmInput({ profile, sources: sourcesOf(read.page, profile), ...draft, buildings, packages,
    name: nameOf(read.items) });
  return typeof input === 'string' ? { missing: input } : { confirmation: await send(input) };
}

/** EVS3: one press of "Accept every exact single match of this file" reads every page of the file's matches under
 * the key, then selects them; the candidates a stored confirmation accepted are not offered again. */
export async function pressAcceptFile(caseId: string, profile: KeyProfile, itemId: string, choices: Choices,
  confirmed: ReadonlySet<string>, read = readEvidence): Promise<FileSelection> {
  return acceptFile(choices, await readFileMatches(caseId, { profileId: profile.profileId, itemId }, read),
    confirmed);
}

/** D4: a refusal names a pin that no longer holds, so the evidence and the buildings are read again. */
export function rereadAfterRefusal(client: Pick<QueryClient, 'invalidateQueries'>, caseId: string, error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) return;
  void client.invalidateQueries({ queryKey: evidenceKey(caseId) });
  void client.invalidateQueries({ queryKey: runKey(caseId) });
}

/** D3 and D4. One officer press confirms the evidence of one key: its files, buildings and decisions. */
export function ConfirmEvidence({ caseId, profile, read, close, confirmed, stored }: {
  caseId: string; profile: KeyProfile; read: ConfirmRead; close: () => void;
  /** The candidates the confirmations stored from this section accepted. */
  confirmed: ReadonlySet<string>; stored: (confirmation: EvidenceConfirmation) => void;
}) {
  const [draft, setDraft] = useState(blankDraft);
  const [finished, setFinished] = useState(false);
  const refresh = useConfirmRefresh(caseId, profile, read, draft, setDraft, finished);
  const current = refresh.query.data;
  const freshRead = current ? { ...read, page: current.page } : read;
  const press = useConfirmPress(caseId, current?.profile ?? profile, freshRead, draft, (confirmation) => {
    setFinished(true);
    stored(confirmation);
  }, refresh.refused);
  const files = useFileAccepts(caseId, current?.profile ?? profile, draft, confirmed, setDraft);
  const pending = press.isPending || files.reading !== null || refresh.pending;
  return <>
    {refresh.notice && !finished ? <p role="status">{refresh.notice}</p> : null}
    {refresh.query.error && !finished ? <div role="alert" className={batch.stack}>
      <p>{refresh.query.error.message}</p>
      <Button variant="soft" onClick={() => void refresh.query.refetch()}>Read the current evidence again</Button>
    </div> : null}
    <ConfirmEvidenceForm profile={current?.profile ?? profile} read={freshRead} draft={draft}
      pending={pending} blocked={Boolean(refresh.query.error)}
      change={(patch) => setDraft((value) => ({ ...value, ...patch }))}
      submit={() => { if (!pending && !refresh.query.error) press.mutate(); }} close={close}
      result={press.data ?? null} error={press.error} files={files}
      retry={() => void refresh.query.refetch()}
      pendingWords={refresh.pending ? 'Reading the current evidence and package reviews…' : undefined} />
  </>;
}

function useConfirmPress(caseId: string, profile: KeyProfile, read: ConfirmRead, draft: ConfirmDraft,
  stored: (confirmation: EvidenceConfirmation) => void, refused: () => void) {
  const client = useQueryClient();
  const [send] = useState(() => createEvidenceConfirmation(caseId));
  return useMutation({
    mutationFn: () => pressConfirm(caseId, profile, read, draft, send),
    onSuccess: (result) => {
      if (!('confirmation' in result)) return;
      stored(result.confirmation);
      void client.invalidateQueries({ queryKey: evidenceKey(caseId) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) refused();
      rereadAfterRefusal(client, caseId, error);
    },
  });
}

function useFileAccepts(caseId: string, profile: KeyProfile, draft: ConfirmDraft, confirmed: ReadonlySet<string>,
  change: (update: (draft: ConfirmDraft) => ConfirmDraft) => void): FileAccepts {
  const [words, setWords] = useState<Readonly<Record<string, string>>>({});
  const accept = useMutation({
    mutationFn: (itemId: string) => pressAcceptFile(caseId, profile, itemId, draft.choices, confirmed),
    onSuccess: (selection, itemId) => {
      change((value) => ({ ...value, choices: selection.choices }));
      setWords(({ [itemId]: _, ...rest }) => selection.words === null ? rest
        : { ...rest, [itemId]: selection.words });
    },
  });
  return { reading: accept.isPending ? accept.variables : null, words, error: accept.error,
    accept: (itemId) => accept.mutate(itemId) };
}

export function ConfirmEvidenceForm({ profile, read, draft, change, pending, submit, close, result, error, files,
  pendingWords = 'Confirming the evidence…', blocked = false, retry }: {
  profile: KeyProfile; read: ConfirmRead; draft: ConfirmDraft; change: Change; pending: boolean; submit: () => void;
  close: () => void; result: PressResult | null; error: Error | null; files: FileAccepts; pendingWords?: string;
  blocked?: boolean; retry?: () => void;
}) {
  const reasonId = useId();
  const sourcesId = useId();
  if (result && 'confirmation' in result) return <ConfirmedWords confirmation={result.confirmation} close={close} />;
  const decided = Object.keys(draft.choices).length > 0;
  const unavailable = sourcesOf(read.page, profile).some((source) => !retainedSource(source));
  const name = nameOf(read.items);
  // EV2: a file still being read, and not excluded, would make a press send nothing, so the press waits for it.
  const reading = sourcesOf(read.page, profile).filter((source) => retainedSource(source) && !closedReading(source)
    && draft.exclusions[source.itemId] === undefined).map((source) => name(source.itemId));
  return <form className={batch.stack} aria-label={`Confirm the evidence of the key ${profile.input.namespace}`}
    onSubmit={(event) => {
      event.preventDefault();
      submit();
    }}>
    <fieldset className={batch.fieldset} disabled={pending}>
      <SourceFields id={sourcesId} sources={sourcesOf(read.page, profile)} items={read.items}
        draft={draft} change={change} />
      <DecisionFields profile={profile} read={read} draft={draft} change={change} files={files} />
      <ChosenList draft={draft} items={read.items} change={change} />
      {decided ? null : <label className="ul-row">
        <input type="checkbox" checked={draft.noAdditions}
          onChange={(event) => change({ noAdditions: event.target.checked })} />
        This key adds no citations
      </label>}
      <label className="ul-field">
        <span className="ul-label">Your acknowledgement</span>
        <textarea className="ul-input" value={draft.acknowledgement} maxLength={500} required rows={3}
          onChange={(event) => change({ acknowledgement: event.target.value })} />
      </label>
    </fieldset>
    <span className="ul-row">
      <Button type="submit" variant="primary" disabled={pending || unavailable || blocked || reading.length > 0}
        aria-describedby={!pending && (blocked || unavailable || reading.length > 0) ? reasonId : undefined}>
        Confirm the evidence
      </Button>
      <Button variant="ghost" disabled={pending} onClick={close}>Cancel</Button>
    </span>
    {!pending && blocked ? <DisabledReason id={reasonId}
      action={retry ? { label: 'Try again', press: retry } : undefined}>
      The current evidence could not be read.
    </DisabledReason> : null}
    {!pending && !blocked && unavailable ? <DisabledReason id={reasonId}>
      This key cannot be confirmed while a source is unavailable.
    </DisabledReason> : null}
    {!pending && !blocked && !unavailable && reading.length ? <DisabledReason id={reasonId}
      action={{ label: 'Review files', press: () => focusSection(sourcesId) }}>
      {`${reading.join(', ')} ${reading.length === 1 ? 'is' : 'are'} still being read.`}
    </DisabledReason> : null}
    {pending ? <p role="status">{pendingWords}</p> : null}
    {result && 'missing' in result ? <p className="ul-error" role="alert">{result.missing}</p> : null}
    {error ? <TableRefusal error={error} /> : null}
    {error instanceof ApiError && error.status === 409
      ? <p>Read the current evidence, check your selections and confirm again.</p>
      : null}
  </form>;
}

/** D4: the stored confirmation's own note and id. The registry is written later, by the building's carry. */
function ConfirmedWords({ confirmation, close }: { confirmation: EvidenceConfirmation; close: () => void }) {
  return <div className={batch.stack}>
    <div role="status" className={batch.stack}>
      <p>{confirmation.note}</p>
      <p>Confirmation <span className="ul-mono">{confirmation.confirmationId}</span>.</p>
    </div>
    <span className="ul-row"><Button onClick={close}>Close</Button></span>
  </div>;
}

function SourceFields({ id, sources, items, draft, change }: {
  id: string; sources: readonly EvidenceSource[]; items: readonly IntakeItem[]; draft: ConfirmDraft; change: Change;
}) {
  const name = nameOf(items);
  const exclude = (itemId: string, reason: string | null) => {
    const { [itemId]: _, ...rest } = draft.exclusions;
    change({ exclusions: reason === null ? rest : { ...rest, [itemId]: reason } });
  };
  return <fieldset id={id} className={styles.group}>
    <legend className="ul-label">Files read under this key</legend>
    {sources.length ? null : <p className="ul-help">No file is read under this key yet.</p>}
    {sources.map((source) => {
      if (source.source?.state === 'unavailable') return <div key={source.itemId} className={batch.stack}>
        <p><strong>{name(source.itemId)}</strong>. {coverageWords(source.coverage)} {source.source.reason}</p>
      </div>;
      const reason = draft.exclusions[source.itemId];
      const state = reason !== undefined ? 'Excluded.' : closedReading(source) ? 'Included.' : 'Still being read.';
      return <div key={source.itemId} className={batch.stack}>
        <p><strong>{name(source.itemId)}</strong>. {coverageWords(source.coverage)} {state}</p>
        <label className="ul-row">
          <input type="checkbox" checked={reason !== undefined}
            onChange={(event) => exclude(source.itemId, event.target.checked ? '' : null)} />
          {`Exclude ${name(source.itemId)}`}
        </label>
        {reason !== undefined ? <label className="ul-field">
          <span className="ul-label">{`Reason for excluding ${name(source.itemId)}`}</span>
          <input className="ul-input" value={reason} maxLength={500} required
            onChange={(event) => exclude(source.itemId, event.target.value)} />
        </label> : null}
      </div>;
    })}
  </fieldset>;
}

/** The button reads every page of the file's matches under the key, not only the page shown. */
function FileAccept({ name, reading, open, words, accept }: {
  name: string; reading: boolean; open: boolean; words: string | undefined; accept: () => void;
}) {
  const reasonId = useId();
  return <div className={batch.stack}>
    <span className="ul-row">
      <span>{name}</span>
      <Button variant="soft" aria-describedby={open ? reasonId : undefined}
        aria-label={`Accept every exact single match of this file: ${name}`} disabled={open} onClick={accept}>
        Accept every exact single match of this file
      </Button>
    </span>
    {open ? <DisabledReason id={reasonId}>This file is still being read.</DisabledReason> : null}
    {reading ? <p role="status">{`Reading every exact single match of ${name}…`}</p> : null}
    {words ? <p role="status">{words}</p> : null}
  </div>;
}

function DecisionFields({ profile, read, draft, change, files }: {
  profile: KeyProfile; read: ConfirmRead; draft: ConfirmDraft; change: Change; files: FileAccepts;
}) {
  const candidates = decidable(read.page, profile);
  const name = nameOf(read.items);
  return <fieldset className={styles.group}>
    <legend className="ul-label">Candidates of this key on this page</legend>
    {sourcesOf(read.page, profile).filter(retainedSource).map((source) => <FileAccept key={source.itemId}
      name={name(source.itemId)} reading={files.reading === source.itemId} open={!closedReading(source)}
      words={files.words[source.itemId]}
      accept={() => files.accept(source.itemId)} />)}
    {files.error ? <TableRefusal error={files.error} /> : null}
    {candidates.length ? <div className={styles.scroll}>
      <DataTable caption="Decide each candidate" rows={[...candidates]} rowKey={(row) => row.candidateId} columns={[
        { header: 'Key as written', cell: (row) => <span className="ul-mono">{row.key.literal}</span> },
        { header: 'Evidence', cell: (row) => evidenceWords(row, read.items) },
        { header: 'Outcome', cell: (row) => outcomeWords[row.outcome] },
        { header: 'Decision', cell: (row) => <CandidateDecision candidate={row} building={buildingWords(row,
          read.targets)} draft={draft} change={change} /> },
      ]} />
    </div> : <p className="ul-help">No candidate of this key on this page names a building.</p>}
  </fieldset>;
}

function CandidateDecision({ candidate, building, draft, change }: {
  candidate: Candidate; building: string; draft: ConfirmDraft; change: Change;
}) {
  const choice = draft.choices[candidate.candidateId];
  if (singleMatch(candidate)) {
    return <label className="ul-row">
      <input type="checkbox" checked={choice?.decision === 'accept'}
        onChange={(event) => change({ choices: setAccept(draft.choices, candidate, event.target.checked) })} />
      {`Accept ${candidate.key.literal} for ${building}`}
    </label>;
  }
  if (!question(candidate)) return null;
  const reason = choice?.decision === 'reject' ? choice.reason : null;
  const reject = (value: string | null) => change({ choices: setReject(draft.choices, candidate, value) });
  return <div className={batch.stack}>
    <span>{`Question · ${building}`}</span>
    <label className="ul-row">
      <input type="checkbox" checked={reason !== null} onChange={(event) => reject(event.target.checked ? '' : null)} />
      {`Reject ${candidate.key.literal}`}
    </label>
    {reason !== null ? <label className="ul-field">
      <span className="ul-label">{`Reason for rejecting ${candidate.key.literal}`}</span>
      <input className="ul-input" value={reason} maxLength={500} required
        onChange={(event) => reject(event.target.value)} />
    </label> : null}
  </div>;
}

/** Every decision so far, from any page, each with its own undo. */
function ChosenList({ draft, items, change }: {
  draft: ConfirmDraft; items: readonly IntakeItem[]; change: Change;
}) {
  const chosen = Object.values(draft.choices);
  if (!chosen.length) return null;
  const undo = (candidateId: string) => {
    const { [candidateId]: _, ...rest } = draft.choices;
    change({ choices: rest });
  };
  const accepted = chosen.filter((choice) => choice.decision === 'accept').length;
  return <section className={batch.stack} aria-label="Your decisions">
    <p className="ul-label">{`Your decisions: ${accepted} accepted, ${chosen.length - accepted} rejected`}</p>
    <ul className={styles.list}>
      {chosen.map(({ decision, candidate }) => {
        const words = `${candidate.key.literal}, ${evidenceWords(candidate, items)}`;
        return <li key={candidate.candidateId}>
          {`${decision === 'accept' ? 'Accepted' : 'Rejected'}: ${words} `}
          <Button variant="ghost" aria-label={`Undo the decision on ${words}`}
            onClick={() => undo(candidate.candidateId)}>Undo</Button>
        </li>;
      })}
    </ul>
  </section>;
}

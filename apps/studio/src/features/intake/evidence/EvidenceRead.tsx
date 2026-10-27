import { Button, DataTable } from '@ulpin/ui';
import { familyWords, type IntakeItem } from '../batch-model';
import type { Target } from '../run/model';
import { confirmedOf } from './confirm-model';
import { buildingWords, coverageWords, evidenceWords, outcomeWords, profileWords, type Candidate,
  type EvidencePage, type KeyProfile, type Outcome } from './model';
import batch from '../Batch.module.css';
import styles from './Evidence.module.css';

export interface Paging { outcome: Outcome | ''; setOutcome: (outcome: Outcome | '') => void; first: boolean;
  firstPage: () => void; nextPage: (() => void) | null; loading: boolean }

/** D2. Each key with the coverage of every source read under it, the counts by outcome and a page of candidates. */
export function EvidenceRead({ page, items, targets, paging }: {
  page: EvidencePage; items: readonly IntakeItem[]; targets: readonly Target[]; paging: Paging;
}) {
  if (!page.profiles.length) return <p>No key is declared for this batch yet.</p>;
  return <div className={batch.stack}>
    {page.profiles.map((profile) => <ProfileCoverage key={profile.profileId} profile={profile} page={page}
      items={items} />)}
    <section className={batch.stack} aria-label="Candidates by outcome">
      <h3 className="ul-heading">Candidates by outcome</h3>
      <ul className={styles.list}>
        {(Object.keys(outcomeWords) as Outcome[]).map((outcome) => <li key={outcome}>
          {outcomeWords[outcome]}: {page.counts[outcome].toLocaleString('en-IN')}
        </li>)}
      </ul>
      <Candidates candidates={page.candidates} items={items} targets={targets} paging={paging} />
    </section>
  </div>;
}

function ProfileCoverage({ profile, page, items }: {
  profile: KeyProfile; page: EvidencePage; items: readonly IntakeItem[];
}) {
  const sources = page.sources.filter((source) => source.profileId === profile.profileId);
  const confirmed = confirmedOf(page, profile);
  const needsConfirmation = page.confirmations.some(confirmation => confirmation.profileId === profile.profileId
    && confirmation.superseded && confirmation.accepted?.some(candidateId => !confirmed.has(candidateId)));
  return <section className={batch.stack} aria-label={`Key ${profile.input.namespace}`}>
    <h3 className="ul-heading">Key · {profileWords(profile, items)}</h3>
    {needsConfirmation ? <p>A file has a newer evidence reading; confirm its matches again.</p> : null}
    {sources.length ? <ul className={styles.list}>
      {sources.map((source) => <li key={source.itemId}>
        {items.find((item) => item.itemId === source.itemId)?.name ?? 'A file no longer listed'}
        {' '}({familyWords(source.family)}). {coverageWords(source.coverage)}
        {source.source?.state === 'unavailable' ? ` ${source.source.reason}` : null}
      </li>)}
    </ul> : <p>No source is read under this key yet.</p>}
  </section>;
}

function Candidates({ candidates, items, targets, paging }: {
  candidates: Candidate[]; items: readonly IntakeItem[]; targets: readonly Target[]; paging: Paging;
}) {
  return <>
    <label className="ul-field">
      <span className="ul-label">Show candidates</span>
      <select className="ul-input" value={paging.outcome} disabled={paging.loading}
        onChange={(event) => paging.setOutcome(event.target.value as Outcome | '')}>
        <option value="">Every outcome</option>
        {(Object.keys(outcomeWords) as Outcome[]).map((outcome) =>
          <option key={outcome} value={outcome}>{outcomeWords[outcome]}</option>)}
      </select>
    </label>
    {candidates.length ? <div className={styles.scroll}>
      <DataTable caption="Candidate rows and document parts" rows={candidates} rowKey={(row) => row.candidateId}
        columns={[
          { header: 'Key as written', cell: (row) => <span className="ul-mono">{row.key.literal}</span> },
          { header: 'Evidence', cell: (row) => evidenceWords(row, items) },
          { header: 'Outcome', cell: (row) => outcomeWords[row.outcome] },
          { header: 'Buildings', cell: (row) => buildingWords(row, targets) },
        ]} />
    </div> : <p>No candidates match this read.</p>}
    <span className="ul-row">
      {paging.first ? null : <Button disabled={paging.loading} onClick={paging.firstPage}>First page</Button>}
      {paging.nextPage ? <Button disabled={paging.loading} onClick={paging.nextPage}>Next page</Button> : null}
      {paging.loading ? <span role="status">Reading candidates…</span> : null}
    </span>
  </>;
}

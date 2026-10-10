import { Button } from '@ulpin/ui';
import { targetDefinition } from './model';
import { targetOptions, unansweredColumns } from './recipe';
import type { OfficerAnswer, OfficerAnswers } from './recipe';
import type { ChunkMapping, TableProfile } from './types';
import styles from './Table.module.css';

export function AnswerForm({ profile, mapping, answers, change, record, pending }: {
  profile: TableProfile; mapping: ChunkMapping; answers: OfficerAnswers; pending: boolean;
  change: (sourceField: string, answer: OfficerAnswer) => void; record: () => void;
}) {
  const unanswered = unansweredColumns(profile, answers);
  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      record();
    }}>
      <p className="ul-help">
        Choose a meaning and give a reason for every column, including unknown fields.
        Unchanged targets keep the proposed operation; a changed target copies source literals.
        The server checks the plan, units and types before recording it.
      </p>
      <fieldset className={styles.fieldset} disabled={pending}>
        <div className={`${styles.scroll} ${styles.answers}`} tabIndex={0} aria-label="Column answers, scroll for more">
          <table className="ul-table">
            <thead><tr><th>Column</th><th>Meaning</th><th>Reason for this decision</th></tr></thead>
            <tbody>{profile.profile.columns.map((column, index) => (
              <ColumnAnswer key={column.name} position={index + 1} header={profile.headers[index] ?? ''}
                answer={answers[column.name]!} candidates={mapping.questions.find((question) =>
                  question.sourceField === column.name)?.candidates ?? []}
                change={(answer) => change(column.name, answer)} />
            ))}</tbody>
          </table>
        </div>
      </fieldset>
      {unanswered.length ? <p className="ul-help" role="status">Unanswered: {unanswered.join('; ')}</p> : null}
      <div><Button variant="primary" type="submit" disabled={Boolean(unanswered.length) || pending}>
        Record the mapping
      </Button></div>
    </form>
  );
}

function ColumnAnswer({ position, header, answer, candidates, change }: {
  position: number; header: string; answer: OfficerAnswer;
  candidates: ChunkMapping['questions'][number]['candidates']; change: (answer: OfficerAnswer) => void;
}) {
  const options = targetOptions(candidates);
  return (
    <tr>
      <th scope="row">{position} · {header || 'Empty header'}</th>
      <td>
        <select className="ul-input" aria-label={`Target for column ${position}`} value={answer.target}
          onChange={(event) => change({ ...answer, target: event.target.value as OfficerAnswer['target'] })}>
          <option value="">Choose a meaning</option>
          {options.first.length ? <optgroup label="Question candidates">
            {options.first.map((target) => <option key={target} value={target}>
              {targetDefinition(target).displayLabel}
            </option>)}
          </optgroup> : null}
          <optgroup label="All meanings">{options.all.map((target) => <option key={target} value={target}>
            {targetDefinition(target).displayLabel}
          </option>)}</optgroup>
        </select>
        {answer.target ? <p className="ul-help">{targetDefinition(answer.target).meaning}</p> : null}
      </td>
      <td><textarea className="ul-input" aria-label={`Reason for column ${position}`} required
        value={answer.reason} maxLength={2000} rows={2}
        onChange={(event) => change({ ...answer, reason: event.target.value })} /></td>
    </tr>
  );
}

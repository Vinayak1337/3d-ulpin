import { useId } from 'react';
import type { LevelChoices } from './decisions';
import styles from './CandidateReview.module.css';

/** The building's reviewed levels. With none, it is disabled and says why: a floor title never creates a level. */
export function LevelPicker({ choices, value, onChange }: {
  choices: LevelChoices; value: string; onChange: (levelId: string) => void;
}) {
  const id = useId();
  return (
    <div className={`ul-field ${styles.wide}`}>
      <label className="ul-label" htmlFor={id}>Level</label>
      <select id={id} className={`ul-input ${styles.select}`} value={value} disabled={Boolean(choices.disabledReason)}
        aria-describedby={choices.disabledReason ? `${id}-why` : undefined}
        onChange={(event) => onChange(event.target.value)}>
        <option value="">{choices.disabledReason ? 'No level available' : 'Choose a reviewed level'}</option>
        {choices.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {choices.disabledReason ? <span id={`${id}-why`} className="ul-help">{choices.disabledReason}</span> : null}
    </div>
  );
}

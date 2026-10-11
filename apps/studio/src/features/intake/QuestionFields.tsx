import { useId } from 'react';
import { fieldWords } from './batch-model';
import { heightPaths, kindRefusal, kindWords } from './question-model';
import type { Choices, Kind, MapProfile } from './question-model';
import styles from './Batch.module.css';

interface Props {
  profile: MapProfile;
  choices: Choices;
  choose: (field: keyof Choices, value: string) => void;
  error: string;
  concern: string;
}

export function QuestionFields(props: Props) {
  return <div className={styles.stack}>
    <KindField {...props} />
    <IdentifierField {...props} />
    <FieldChoice label="Which field is its name?" value={props.choices.name}
      paths={props.profile.paths.filter(path => path.literalTextEligible)}
      choose={value => props.choose('name', value)} optional />
    <ChoiceError {...props} field="name" />
    <HeightFields {...props} />
  </div>;
}

function KindField(props: Props) {
  const kinds = Object.keys(kindWords) as Kind[];
  const help = useId();
  return <div className={styles.stack}>
    <label className="ul-field"><span className="ul-label">What is each feature in this file?</span>
      <select className="ul-input" value={props.choices.kind} aria-describedby={help}
        onChange={event => props.choose('kind', event.target.value)}>
        <option value="">Choose what each feature is</option>
        {kinds.map(kind => <option key={kind} value={kind} disabled={Boolean(kindRefusal(kind, props.profile.geometryTypes))}>
          {kindWords[kind]}
        </option>)}
      </select>
    </label>
    <div id={help} className="ul-help">
      {kinds.map(kind => {
        const reason = kindRefusal(kind, props.profile.geometryTypes);
        return reason ? <p key={kind}>{reason}</p> : null;
      })}
    </div>
    <ChoiceError {...props} field="kind" />
  </div>;
}

function IdentifierField(props: Props) {
  const paths = props.profile.paths.filter(path => path.literalIdEligible);
  const refused = props.profile.paths.filter(path => !path.literalIdEligible && path.path !== '/features/*/geometry');
  return <div className={styles.stack}>
    <FieldChoice label="Which field identifies each one?" value={props.choices.identifier} paths={paths}
      choose={value => props.choose('identifier', value)} />
    {!paths.length ? <p>No field of this file can identify its features:
      every feature needs a different, non-empty text value.</p> : null}
    {refused.length ? <details>
      <summary>Fields that cannot identify each feature</summary>
      <ul>{refused.map(path => <li key={path.path}>{fieldWords(path.path)}: repeats, has blanks, or is not text</li>)}</ul>
    </details> : null}
    <ChoiceError {...props} field="identifier" />
  </div>;
}

function HeightFields(props: Props) {
  return <div className={styles.stack}>
    <FieldChoice label="Does a field give its height?" value={props.choices.height} paths={heightPaths(props.profile)}
      choose={value => props.choose('height', value)} optional />
    {props.choices.height ? <>
      <label className="ul-field"><span className="ul-label">Height unit</span>
        <select className="ul-input" value={props.choices.unit} required
          onChange={event => props.choose('unit', event.target.value)}>
          <option value="">Choose the source unit</option>
          <option value="m">Metres</option><option value="ft">Feet</option>
        </select>
      </label>
      <label className="ul-field"><span className="ul-label">What the height means</span>
        <textarea className="ul-input" value={props.choices.meaning} rows={3} required maxLength={500}
          onChange={event => props.choose('meaning', event.target.value)} />
      </label>
    </> : null}
    <p className="ul-help">Say what the height measures and from where, as the publisher states it.
      Without a unit and a meaning no height is recorded.</p>
    <ChoiceError {...props} field="height" />
  </div>;
}

function FieldChoice({ label, value, paths, choose, optional = false }: {
  label: string; value: string; paths: MapProfile['paths']; choose: (value: string) => void; optional?: boolean;
}) {
  return <label className="ul-field"><span className="ul-label">{label}</span>
    <select className="ul-input" value={value} onChange={event => choose(event.target.value)}>
      <option value="">{optional ? 'Not stated' : 'Choose a field'}</option>
      {paths.map(path => <option key={path.path} value={path.path}>{fieldWords(path.path)}</option>)}
    </select>
  </label>;
}

function ChoiceError({ concern, error, field }: Pick<Props, 'concern' | 'error'> & { field: string }) {
  return concern === field && error ? <p role="alert">{error}</p> : null;
}

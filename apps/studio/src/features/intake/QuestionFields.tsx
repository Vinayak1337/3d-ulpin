import { useId } from 'react';
import { Badge } from '@ulpin/ui';
import { fieldWords } from './batch-model';
import { heightPaths, identifierPaths, identifierWords, kindRefusal, kindWords, namePaths, positionPath }
  from './question-model';
import type { ChoiceBasis, Choices, Kind, MapProfile } from './question-model';
import styles from './Batch.module.css';

interface Answers {
  choices: Choices;
  basis?: ChoiceBasis;
  choose: (field: keyof Choices, value: string) => void;
  error: string;
  concern: string;
}
interface Props extends Answers {
  profile: MapProfile;
}

export function QuestionFields(props: Props) {
  return <div className={styles.stack}>
    <KindField {...props} geometryTypes={props.profile.geometryTypes} />
    <IdentifierField {...props} />
    <FieldChoice label="Which field is its name?" value={props.choices.name}
      paths={namePaths(props.profile, props.choices.kind)}
      choose={value => props.choose('name', value)} basis={props.basis?.name} optional />
    <ChoiceError {...props} field="name" />
    <HeightFields {...props} />
  </div>;
}

export function KindField(props: Answers & { geometryTypes: readonly string[] }) {
  const kinds = Object.keys(kindWords) as Kind[];
  const help = useId();
  return <div className={styles.stack}>
    <label className="ul-field"><span className="ul-label">What is each feature in this file?
        {props.basis?.kind ? <> <Badge icon={null}>{props.basis.kind}</Badge></> : null}</span>
      <select className="ul-input" value={props.choices.kind} aria-describedby={help}
        aria-label="What is each feature in this file?"
        onChange={event => props.choose('kind', event.target.value)}>
        <option value="">Choose</option>
        {kinds.map(kind => <option key={kind} value={kind}
          disabled={Boolean(kindRefusal(kind, props.geometryTypes))}>
          {kindWords[kind]}
        </option>)}
      </select>
    </label>
    <div id={help} className="ul-help">
      {kinds.map(kind => {
        const reason = kindRefusal(kind, props.geometryTypes);
        return reason ? <p key={kind}>{reason}</p> : null;
      })}
    </div>
    <ChoiceError {...props} field="kind" />
  </div>;
}

function IdentifierField(props: Props) {
  const paths = identifierPaths(props.profile, props.choices.kind);
  const refused = props.profile.paths.filter(path => !paths.includes(path) && path.path !== '/features/*/geometry');
  return <div className={styles.stack}>
    <FieldChoice label="Which field identifies each one?" value={props.choices.identifier} paths={paths}
      choose={value => props.choose('identifier', value)}
      words={path => identifierWords(path, props.choices.kind)} basis={props.basis?.identifier}
      position={!paths.length} />
    {refused.length ? <details>
      <summary>Fields that cannot identify each feature</summary>
      <ul>{refused.map(path => <li key={path.path}>
        {fieldWords(path.path)}: repeats, has blanks, or is neither text nor a whole number
      </li>)}</ul>
    </details> : null}
    <ChoiceError {...props} field="identifier" />
  </div>;
}

function HeightFields(props: Props) {
  return <div className={styles.stack}>
    <FieldChoice label="Does a field give its height?" value={props.choices.height} paths={heightPaths(props.profile)}
      choose={value => props.choose('height', value)} basis={props.basis?.height} optional />
    {props.choices.height ? <>
      <label className="ul-field"><span className="ul-label">Height unit</span>
        <select className="ul-input" value={props.choices.unit} required aria-label="Height unit"
          onChange={event => props.choose('unit', event.target.value)}>
          <option value="">Choose</option>
          <option value="m">Metres</option><option value="ft">Feet</option>
        </select>
      </label>
      <label className="ul-field"><span className="ul-label">What the height means</span>
        <textarea className="ul-input" value={props.choices.meaning} rows={3} required maxLength={500}
          aria-label="What the height means"
          onChange={event => props.choose('meaning', event.target.value)} />
      </label>
    </> : null}
    <ChoiceError {...props} field="height" />
  </div>;
}

export function FieldChoice<Path extends { path: string }>({ label, value, paths, choose, optional = false,
  words, basis, position = false }: {
  label: string; value: string; paths: readonly Path[]; choose: (value: string) => void; optional?: boolean;
  words?: (path: Path) => string; basis?: ChoiceBasis[keyof Choices]; position?: boolean;
}) {
  return <label className="ul-field"><span className="ul-label">{label}
    {basis ? <> <Badge icon={null}>{basis}</Badge></> : null}</span>
    <select className="ul-input" value={value} aria-label={label} onChange={event => choose(event.target.value)}>
      <option value="">{optional ? 'Not stated' : 'Choose a field'}</option>
      {paths.map(path => <option key={path.path} value={path.path}>
        {words ? words(path) : fieldWords(path.path)}
      </option>)}
      {position ? <option value={positionPath}>Position in the file</option> : null}
    </select>
  </label>;
}

export function ChoiceError({ concern, error, field }: Pick<Answers, 'concern' | 'error'> & { field: string }) {
  return concern === field && error ? <p role="alert">{error}</p> : null;
}

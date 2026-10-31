import { useState, type ReactNode } from 'react';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { useTableProfile } from './table/queries';
import { answerSummary, blankChoices, choicesFromReading, choicesFromRecipe, questionBody } from './question-model';
import type { ChoiceBasis, Choices, MapProfile, ReadingChoices } from './question-model';
import { useIntakeManifest } from './batch-queries';
import { useReading, type Reading } from './reading-model';
import type { Recipe } from './layout-model';
import type { LayoutBody } from './layout-command';
import type { useLayoutCommand } from './useLayoutCommand';
import { QuestionFields } from './QuestionFields';
import styles from './Batch.module.css';

export type Command = ReturnType<typeof useLayoutCommand>;
type Choose = (field: keyof Choices, value: string) => void;

export function LayoutAnswer({ caseId, sourceId, receipt, command, primary = false }: {
  caseId: string; sourceId: string; receipt?: Recipe; command: Command; primary?: boolean;
}) {
  const manifest = useIntakeManifest(caseId);
  const item = manifest.data?.items.find(item => item.sourceId === sourceId);
  const profile = useTableProfile(caseId, sourceId, item?.layoutQuestion === true || Boolean(item?.plan || receipt));
  const itemId = item?.itemId ?? '';
  const reading = useReading(caseId, itemId);
  return <>
    {profile.isFetching && !profile.data ? <Skeleton /> : null}
    {profile.error ? <Banner tone="danger">{profile.error.message}</Banner> : null}
    {profile.data?.version === 'manual-geojson/1' ? <QuestionForm profile={profile.data}
      receipt={receipt} command={command} reading={reading.data} primary={primary} /> : null}
    {profile.data && profile.data.version !== 'manual-geojson/1' ?
      <p>This retained profile does not support the map layout question.</p> : null}
  </>;
}

function QuestionForm({ profile, receipt, command, reading, primary }: {
  profile: MapProfile; receipt?: Recipe; command: Command; reading?: Reading; primary: boolean;
}) {
  return <AnswerForm receipt={receipt} command={command} prefill={choicesFromReading(reading, profile)}
    primary={primary}
    summary={choices => answerSummary(choices, profile.geometryTypes)}
    body={choices => questionBody(profile, choices, receipt?.revision ?? 0, '')}
    fields={(choices, choose, basis) => <QuestionFields profile={profile} choices={choices} choose={choose}
      basis={basis}
      error={command.state.error} concern={command.state.concern} />} />;
}

/**
 * The answer's choices, summary and send button; each file kind supplies its own fields and body. The press is
 * primary unless the caller says the layout is not the batch's current step.
 */
export function AnswerForm({ receipt, command, body, summary, fields, prefill = {}, primary = true }: {
  receipt?: Recipe; command: Command; body: (choices: Choices) => LayoutBody | null;
  summary: (choices: Choices) => string; prefill?: ReadingChoices; primary?: boolean;
  fields: (choices: Choices, choose: Choose, basis: ChoiceBasis) => ReactNode;
}) {
  const [edits, setEdits] = useState<Partial<Choices>>({});
  const { basis: proposedBasis, ...proposed } = prefill;
  const choices = { ...(receipt ? choicesFromRecipe(receipt) : { ...blankChoices, ...proposed }), ...edits };
  const basis = receipt ? {} : Object.fromEntries(Object.entries(proposedBasis ?? {})
    .filter(([field]) => !Object.hasOwn(edits, field)));
  const locked = command.state.busy || command.state.uncertain;
  const answer = body(choices);
  const press = () => {
    if (command.state.uncertain) void command.retry();
    else if (answer) void command.use({ ...answer, requestKey: crypto.randomUUID() });
  };
  const choose = (field: keyof Choices, value: string) => {
    setEdits(current => ({ ...current, [field]: value }));
  };
  return <div className={styles.stack}>
    <fieldset className={styles.fieldset} disabled={locked}>
      <legend className="ul-visually-hidden">Your layout answers</legend>
      {fields(choices, choose, basis)}
    </fieldset>
    <p>{summary(choices)}</p>
    {command.state.phase === 'author' && !command.state.concern && command.state.error ?
      <p role="alert">{command.state.error}</p> : null}
    {command.state.uncertain ? <p role="status">The outcome is not known.</p> : null}
    <Button variant={primary ? 'primary' : 'secondary'} onClick={press}
      disabled={command.state.busy || (!command.state.uncertain && !answer)}>
      {buttonWords(command.state.busy, command.state.uncertain)}
    </Button>
  </div>;
}

function buttonWords(busy: boolean, uncertain: boolean): string {
  if (busy) return 'Using this layout…';
  if (uncertain) return 'Send same layout again';
  return 'Use this layout';
}

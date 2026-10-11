import { useState } from 'react';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { useTableProfile } from './table/queries';
import { answerSummary, blankChoices, choicesFromRecipe, questionBody } from './question-model';
import type { Choices, MapProfile } from './question-model';
import type { Recipe } from './layout-model';
import type { useLayoutCommand } from './useLayoutCommand';
import { QuestionFields } from './QuestionFields';
import styles from './Batch.module.css';

type Command = ReturnType<typeof useLayoutCommand>;

export function LayoutAnswer({ caseId, sourceId, receipt, command }: {
  caseId: string; sourceId: string; receipt?: Recipe; command: Command;
}) {
  const profile = useTableProfile(caseId, sourceId);
  return <>
    {profile.isPending ? <Skeleton /> : null}
    {profile.error ? <Banner tone="danger">{profile.error.message}</Banner> : null}
    {profile.data?.version === 'manual-geojson/1' ? <QuestionForm profile={profile.data}
      receipt={receipt} command={command} /> : null}
    {profile.data && profile.data.version !== 'manual-geojson/1' ?
      <p>This retained profile does not support the map layout question.</p> : null}
  </>;
}

function QuestionForm({ profile, receipt, command }: { profile: MapProfile; receipt?: Recipe; command: Command }) {
  const [choices, setChoices] = useState<Choices>(() => receipt ? choicesFromRecipe(receipt) : { ...blankChoices });
  const locked = command.state.busy || command.state.uncertain;
  const body = questionBody(profile, choices, receipt?.revision ?? 0, '');
  const press = () => {
    if (command.state.uncertain) void command.retry();
    else if (body) void command.use({ ...body, requestKey: crypto.randomUUID() });
  };
  const choose = (field: keyof Choices, value: string) => {
    setChoices(current => ({ ...current, [field]: value }));
  };
  return <div className={styles.stack}>
    <fieldset className={styles.fieldset} disabled={locked}>
      <legend className="ul-visually-hidden">Your layout answers</legend>
      <QuestionFields profile={profile} choices={choices} choose={choose}
        error={command.state.error} concern={command.state.concern} />
    </fieldset>
    <p>{answerSummary(choices)}</p>
    {!choices.height ? <p className="ul-help">No height is stated; heights stay unknown.</p> : null}
    {command.state.phase === 'author' && !command.state.concern && command.state.error ?
      <p role="alert">{command.state.error}</p> : null}
    {command.state.uncertain ? <p>The outcome is not known. Send the same layout again;
      your choices and request stay unchanged.</p> : null}
    <Button variant="primary" disabled={command.state.busy || (!command.state.uncertain && !body)} onClick={press}>
      {buttonWords(command.state.busy, command.state.uncertain)}
    </Button>
  </div>;
}

function buttonWords(busy: boolean, uncertain: boolean): string {
  if (busy) return 'Using this layout…';
  if (uncertain) return 'Send same layout again';
  return 'Use this layout';
}

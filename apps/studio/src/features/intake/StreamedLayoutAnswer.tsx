import { Banner, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import type { Recipe } from './layout-model';
import type { Choices } from './question-model';
import { useSourceCase } from './table/queries';
import { useStreamedProfile } from './streamed-queries';
import { inventoryWords, streamedIdentifierPaths, streamedIdentifierWords, streamedNamePaths, streamedQuestionBody,
  streamedSummary, type Inventory } from './streamed-question-model';
import { AnswerForm, type Command } from './LayoutAnswer';
import { ChoiceError, FieldChoice, KindField } from './QuestionFields';
import styles from './Batch.module.css';

const noHeight = 'A height is not stated for large files yet; heights stay unknown.';

/** A large file's question is answered from its sealed streamed inventory. */
export function StreamedLayoutAnswer({ caseId, item, receipt, command }: {
  caseId: string; item: IntakeItem; receipt?: Recipe; command: Command;
}) {
  const status = useStreamedProfile(caseId, item.sourceId ?? '', item.streamedProfileJobId ?? '', item.updatedAt);
  const sourceCase = useSourceCase(caseId);
  const waiting = status.data ? inventoryWords(status.data) : null;
  const inventory = waiting ? null : status.data?.latest;
  const caseRevision = sourceCase.data?.case.revision;
  return <>
    {status.isPending || sourceCase.isPending ? <Skeleton /> : null}
    {status.error ? <Banner tone="danger">{status.error.message}</Banner> : null}
    {sourceCase.error ? <Banner tone="danger">{sourceCase.error.message}</Banner> : null}
    {waiting ? <p>{waiting}</p> : null}
    {inventory && caseRevision !== undefined ? <AnswerForm receipt={receipt} command={command}
      summary={streamedSummary} help={() => noHeight}
      body={choices => streamedQuestionBody(inventory, choices, { caseId, caseRevision }, receipt?.revision ?? 0, '')}
      fields={(choices, choose) => <StreamedFields inventory={inventory} choices={choices} choose={choose}
        error={command.state.error} concern={command.state.concern} />} /> : null}
  </>;
}

function StreamedFields(props: {
  inventory: Inventory; choices: Choices; choose: (field: keyof Choices, value: string) => void;
  error: string; concern: string;
}) {
  const identifiers = streamedIdentifierPaths(props.inventory);
  return <div className={styles.stack}>
    <KindField {...props} geometryTypes={props.inventory.geometryTypes} />
    <FieldChoice label="Which field identifies each one?" value={props.choices.identifier} paths={identifiers}
      choose={value => props.choose('identifier', value)} words={streamedIdentifierWords} />
    {!identifiers.length ? <p>No field of this file holds only text or only whole numbers,
      so no field can identify its features.</p> : null}
    <ChoiceError {...props} field="identifier" />
    <FieldChoice label="Which field is its name?" value={props.choices.name}
      paths={streamedNamePaths(props.inventory)} choose={value => props.choose('name', value)} optional />
    <ChoiceError {...props} field="name" />
  </div>;
}

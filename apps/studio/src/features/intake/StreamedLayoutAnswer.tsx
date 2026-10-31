import { Banner, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import type { Recipe } from './layout-model';
import { choicesFromReading, type ChoiceBasis, type Choices } from './question-model';
import { useReading } from './reading-model';
import { useStreamedGeneration, useStreamedProfile } from './streamed-queries';
import { changedPrefixWords, inventoryWords, prefixWords, questionInventory, streamedIdentifierPaths,
  streamedIdentifierWords, streamedNamePaths, streamedQuestionBody, streamedSummary,
  type Inventory } from './streamed-question-model';
import { AnswerForm, type Command } from './LayoutAnswer';
import { ChoiceError, FieldChoice, KindField } from './QuestionFields';
import styles from './Batch.module.css';

/** A large file's question is answered from its sealed streamed inventory, or from the provisional generation
 * that covers the first part read when the item's question names one. */
export function StreamedLayoutAnswer({ caseId, item, receipt, command }: {
  caseId: string; item: IntakeItem; receipt?: Recipe; command: Command;
}) {
  const sourceId = item.sourceId ?? '', jobId = item.streamedProfileJobId ?? '';
  const reading = useReading(caseId, item.itemId);
  const firstPart = prefixWords(item);
  const status = useStreamedProfile(caseId, sourceId, jobId, item.updatedAt);
  const generation = useStreamedGeneration(caseId, sourceId, jobId,
    firstPart ? item.layoutProfile?.generation ?? null : null);
  const waiting = status.data ? inventoryWords(status.data, Boolean(firstPart)) : null;
  const inventory = status.data && !waiting ? questionInventory(item, status.data, generation.data) : null;
  // The inventory's own case revision: the case may have advanced since it was queued.
  const pin = status.data;
  const changed = changedPrefixWords(item);
  const error = status.error ?? generation.error;
  return <>
    {status.isPending || firstPart && generation.isPending ? <Skeleton /> : null}
    {error ? <Banner tone="danger">{error.message}</Banner> : null}
    {changed ? <Banner tone="warning">{changed}</Banner> : null}
    {waiting ? <p>{waiting}</p> : null}
    {firstPart && !waiting ? <p>{firstPart}</p> : null}
    {inventory && pin ? <AnswerForm receipt={receipt} command={command}
      prefill={choicesFromReading(reading.data, inventory)}
      summary={choices => streamedSummary(choices, inventory.geometryTypes)}
      body={choices => streamedQuestionBody(inventory, choices, pin, receipt?.revision ?? 0, '')}
      fields={(choices, choose, basis) => <StreamedFields inventory={inventory} choices={choices} choose={choose}
        basis={basis}
        error={command.state.error} concern={command.state.concern} />} /> : null}
  </>;
}

function StreamedFields(props: {
  inventory: Inventory; choices: Choices; choose: (field: keyof Choices, value: string) => void;
  error: string; concern: string; basis: ChoiceBasis;
}) {
  const identifiers = streamedIdentifierPaths(props.inventory, props.choices.kind);
  return <div className={styles.stack}>
    <KindField {...props} geometryTypes={props.inventory.geometryTypes} />
    <FieldChoice label="Which field identifies each one?" value={props.choices.identifier} paths={identifiers}
      choose={value => props.choose('identifier', value)} words={streamedIdentifierWords}
      basis={props.basis.identifier} position={!identifiers.length} />
    <ChoiceError {...props} field="identifier" />
    <FieldChoice label="Which field is its name?" value={props.choices.name}
      paths={streamedNamePaths(props.inventory, props.choices.kind)}
      choose={value => props.choose('name', value)} basis={props.basis.name} optional />
    <ChoiceError {...props} field="name" />
  </div>;
}

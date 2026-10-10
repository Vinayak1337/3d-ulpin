import { Banner, Button, StatusBadge, formatDateTime } from '@ulpin/ui';
import { AnswerForm } from './AnswerForm';
import { TableRefusal } from './Progress';
import { RecipeConfirmation } from './RecipeConfirmation';
import { RecipeHistory } from './RecipeHistory';
import { useRecipeReview } from './useRecipeReview';
import type { ChunkMapping, MappingJob, Recipe, TableProfile } from './types';
import styles from './Table.module.css';

export function RecipeReview({ profile, mapping, job, onApproved }: {
  profile: TableProfile; mapping: ChunkMapping; job: MappingJob; onApproved: () => void;
}) {
  const review = useRecipeReview(profile, mapping, job, onApproved);
  const { current, confirmation, history, record } = review;
  const eligible = job.route === 'proposal_only' && mapping.questions.length > 0 &&
    current?.state !== 'approved' && !review.reading && !history.error;
  return (
    <section className="ul-panel ul-pad" aria-label="Officer mapping review">
      <div className={styles.form}>
        <h2 className="ul-heading">Officer mapping review</h2>
        {current ? <RecipeState recipe={current} waiting={job.route !== 'approved_recipe'} /> : null}
        {review.reading ? <p>Reading recipe revisions…</p> : null}
        {!current && !review.reading && !history.error ? <p>No officer recipe is selected for this source.</p> : null}
        {history.error ? <TableRefusal error={history.error} retry={() => void history.refetch()} /> : null}
        {eligible && !review.open ? <div><Button variant={current ? 'ghost' : 'primary'}
          onClick={() => review.setOpen(true)}>
          Answer mapping questions
        </Button></div> : null}
        {eligible && review.open ? <AnswerForm profile={profile} mapping={mapping} answers={review.answers}
          change={review.change} record={review.propose} pending={record.isPending} /> : null}
        <RecipeActions review={review} job={job} />
        {record.error && !confirmation ? <TableRefusal error={record.error} /> : null}
        {history.data ? <RecipeHistory revisions={history.data} /> : null}
      </div>
      {confirmation ? <RecipeConfirmation confirmation={confirmation} pending={record.isPending} error={record.error}
        confirm={() => record.mutate(confirmation)} close={() => review.setConfirmation(null)} /> : null}
    </section>
  );
}

function RecipeActions({ review, job }: { review: ReturnType<typeof useRecipeReview>; job: MappingJob }) {
  const { current, record } = review;
  const approve = () => {
    if (!current) return;
    record.reset();
    review.setConfirmation({ kind: 'approve', recipeId: current.id, revision: current.revision,
      requestKey: crypto.randomUUID() });
  };
  return <>
    {current?.state === 'proposed' && !review.open ? (
      <div><Button variant="primary" onClick={approve}>Approve mapping</Button></div>
    ) : null}
    {current?.state === 'approved' && job.route !== 'approved_recipe' && review.replay ? (
      <div><Button disabled={record.isPending} onClick={() => record.mutate(review.replay!)}>
        Retry approved mapping job
      </Button></div>
    ) : null}
  </>;
}

function RecipeState({ recipe, waiting }: { recipe: Recipe; waiting: boolean }) {
  return <div className="ul-stack" role="status">
    <div className="ul-row">
      <StatusBadge status={recipe.state === 'approved' ? 'Reviewed' : 'Draft'} />
      <span>Mapping {recipe.state} · revision {recipe.revision}</span>
      <span className="ul-mono">{recipe.id.slice(0, 12)}…</span>
      <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(recipe.id)}>Copy recipe ID</Button>
    </div>
    {recipe.approval ? <p>Approved by {recipe.approval.subject} · {formatDateTime(recipe.approval.at)}</p> : null}
    {recipe.state === 'approved' ? <Banner tone="info">
      {waiting ? 'Approval recorded; waiting for the server’s approved mapping job. ' :
        'Approval recorded; following the approved mapping job. '}
      Busy admission may require replaying the same approval request. No registry execution is available for tables.
    </Banner> : null}
  </div>;
}

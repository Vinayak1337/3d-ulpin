import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { authorRecipe, approveRecipe, readRecipe } from './recipe-api';
import { initialAnswers, recipeBody } from './recipe';
import { tableKey } from './queries';
import type { Confirmation } from './RecipeConfirmation';
import type { OfficerAnswer } from './recipe';
import type { ChunkMapping, MappingJob, Recipe, TableProfile } from './types';

export function useRecipeReview(profile: TableProfile, mapping: ChunkMapping, job: MappingJob,
  onApproved: () => void) {
  const [params, setParams] = useSearchParams();
  const [answers, setAnswers] = useState(() => initialAnswers(profile, mapping));
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [open, setOpen] = useState(false);
  const recipeId = params.get('recipeId') ?? job.recipeId ?? '';
  const history = useQuery({ queryKey: ['table-recipe', profile.caseId, recipeId], enabled: Boolean(recipeId),
    retry: false, queryFn: () => readRecipe(profile.caseId, recipeId, profile.source.sourceId) });
  const current = history.data?.at(-1);
  const record = useRecipeCommands(profile, (receipt, step) => {
    setParams((previous) => recipeParams(previous, receipt, step), { replace: true });
    setConfirmation(null);
    setOpen(false);
    if (receipt.state === 'approved') onApproved();
  });
  const change = (sourceField: string, answer: OfficerAnswer) => {
    setAnswers((previous) => ({ ...previous, [sourceField]: answer }));
  };
  const propose = () => {
    record.reset();
    setConfirmation({ kind: 'propose', body: recipeBody(profile, mapping, answers,
      crypto.randomUUID(), current?.revision ?? 0) });
  };
  const reading = Boolean(recipeId) && history.isPending;
  const replay = approvalReplay(params, recipeId);
  return { answers, confirmation, setConfirmation, open, setOpen, history, current,
    record, change, propose, reading, replay };
}

function useRecipeCommands(profile: TableProfile, saved: (receipt: Recipe, step: Confirmation) => void) {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (step: Confirmation) => {
    if (step.kind === 'propose') return authorRecipe(step.body);
    return approveRecipe(profile.caseId, step.recipeId, {
      requestKey: step.requestKey, expectedRecipeRevision: step.revision,
    });
  }, onSuccess: (receipt, step) => {
    void client.invalidateQueries({ queryKey: ['table-recipe', profile.caseId, receipt.id] });
    void client.invalidateQueries({ queryKey: tableKey(profile.caseId, profile.source.sourceId) });
    saved(receipt, step);
  } });
}

function recipeParams(previous: URLSearchParams, receipt: Recipe, step: Confirmation) {
  const next = new URLSearchParams(previous);
  next.set('recipeId', receipt.id);
  if (step.kind === 'propose') {
    next.delete('approvalKey');
    next.delete('approvalRevision');
  } else {
    next.set('approvalKey', step.requestKey);
    next.set('approvalRevision', String(step.revision));
  }
  return next;
}

function approvalReplay(params: URLSearchParams, recipeId: string): Confirmation | null {
  const requestKey = params.get('approvalKey');
  const revision = Number(params.get('approvalRevision'));
  if (!requestKey || !/^[a-f0-9-]{36}$/i.test(requestKey) || !Number.isInteger(revision) || revision < 1) return null;
  return { kind: 'approve', recipeId, revision, requestKey };
}

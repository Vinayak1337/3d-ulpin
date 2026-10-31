import { countWords, type IntakeItem } from './batch-model';
import { batchStep, isIntakeReading, itemPendingKinds, itemTableSource, needsLayoutAnswer } from '@ulpin/contracts/usp/plain';
import { confirmedOf, decidable, singleMatch } from './evidence/confirm-model';
import type { EvidencePage } from './evidence/model';
import { confirmablePackages, type TargetPage } from './run/model';

export interface PendingAction {
  key: string; item: IntakeItem; label: string; section: string; controlLabel?: string;
}
export interface BatchStep { name: string; count: number | null; section: string; waiting?: boolean }

function itemAnswers(item: IntakeItem, items: readonly IntakeItem[]): PendingAction[] {
  const actions: PendingAction[] = [];
  const add = (kind: string, label: string, section = `intake-${kind}-${item.itemId}`, controlLabel?: string) => {
    actions.push({ key: `${item.itemId}:${kind}:${label}`, item, label, section, controlLabel });
  };
  for (const pending of itemPendingKinds(item, items)) {
    switch (pending.kind) {
      case 'layout':
        add('layout', `Answer the layout of ${item.name}`);
        break;
      case 'layer_crs':
        add('layer-crs', `State the coordinate system of ${pending.layer} in ${item.name}`);
        break;
      case 'page_image':
        add('page-image', `Label the page image ${item.name}`);
        break;
      case 'table_placement':
        add('table', `Place the table ${item.name}`);
        break;
      case 'retry':
        add('retry', `Try ${item.name} again`, 'intake-files', `Try again: ${item.name}`);
        break;
    }
  }
  return actions;
}

function evidenceAnswers(items: readonly IntakeItem[], evidence?: EvidencePage): PendingAction[] {
  return (evidence?.profiles ?? []).flatMap((profile): PendingAction[] => {
    const item = items.find(row => row.itemId === profile.input.map.anchorItemId);
    if (!item || !evidence) return [];
    const confirmations = evidence.confirmations.filter(row => row.profileId === profile.profileId && !row.superseded);
    const accepted = confirmedOf(evidence, profile);
    const remaining = decidable(evidence, profile).some(row => singleMatch(row) && !accepted.has(row.candidateId));
    if (confirmations.some(row => row.additions === 'no_additions') || (confirmations.length && !remaining)) return [];
    return [{ key: profile.profileId, item, section: 'confirm-evidence',
      label: `Confirm the evidence for key ${profile.input.namespace} in ${item.name}` }];
  });
}

/** The one press on the batch page, outside dialogs, that does the current step. */
export type PrimaryPress = 'layout' | 'table' | 'record';

/**
 * S7.23a: the selected item's layout answer or approval while its layout waits, else its Read as a table while it is
 * a kept table, else the run panel's record press. Every other press on the page is secondary.
 */
export function primaryPress(selected: IntakeItem | null | undefined, items: readonly IntakeItem[]): PrimaryPress {
  if (selected && (needsLayoutAnswer(selected) || selected.plan?.recipeState === 'proposed')) return 'layout';
  if (selected && itemTableSource(selected, items)) return 'table';
  return 'record';
}

export function batchNeeds(items: readonly IntakeItem[], page?: TargetPage, evidence?: EvidencePage) {
  const answers = [...items.flatMap(item => itemAnswers(item, items)), ...evidenceAnswers(items, evidence)];
  const packages = page ? confirmablePackages(page) : [];
  const anchors = items.filter(item => packages.some(pkg => pkg.anchorItemId === item.itemId));
  const actions = [...answers];
  if (packages.length && anchors[0]) actions.push({ key: 'packages', item: anchors[0], section: 'intake-run-panel',
    label: `Confirm ${packages.length} ${packages.length === 1 ? 'package' : 'packages'} from `
      + anchors.map(item => item.name).join(', ') });
  const reading = items.filter(isIntakeReading);
  const steps: BatchStep[] = [
    { name: 'Files', count: items.length, section: 'intake-files' },
    { name: 'Reading', count: reading.length, section: 'intake-reading' },
    { name: 'Your answers', count: answers.length, section: 'intake-answers', waiting: true },
    { name: 'Confirm', count: page ? packages.length : null, section: 'intake-run-panel', waiting: true },
    { name: 'Cards', count: page?.counts?.carded ?? null, section: 'intake-run-panel' },
  ];
  const currentStep = batchStep({ items, answers: answers.length, confirmations: packages.length });
  const current = steps.findIndex(step => step.name === currentStep);
  return { steps, current, actions, status: statusWords(items, reading, page) };
}

function statusWords(items: readonly IntakeItem[], reading: readonly IntakeItem[], page?: TargetPage): string {
  let status = `${items.length} ${items.length === 1 ? 'file' : 'files'} kept.`;
  if (reading.length) {
    status = `Reading ${reading.length} ${reading.length === 1 ? 'file' : 'files'}`;
    if (reading.every(item => item.partsPlanned != null && item.partsDone != null)) {
      const done = reading.reduce((sum, item) => sum + item.partsDone!, 0);
      const planned = reading.reduce((sum, item) => sum + item.partsPlanned!, 0);
      status += `, ${countWords(done)} of ${countWords(planned)} parts`;
    }
    status += '.';
  } else if (page?.counts?.confirmed) status = `Recording ${countWords(page.counts.confirmed)} buildings.`;
  else if (page?.counts?.carded) status = `${countWords(page.counts.carded)} cards made.`;
  return `${status} Nothing needs you.`;
}

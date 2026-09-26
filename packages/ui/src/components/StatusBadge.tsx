import {
  CheckCircle, Circle, Clock, FileDashed, Flask, MinusCircle, Question, Warning, XCircle, ArrowCounterClockwise,
  Seal, Prohibit, Scales, PencilSimpleLine, Sparkle,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Icon } from './Icon';

/** The fixed status words (design system content rules). No synonyms. */
export const STATUS_WORDS = [
  'Draft', 'Needs evidence', 'Needs review', 'Reviewed', 'Recorded', 'Assigned', 'Retired', 'Cancelled',
  'Unknown', 'Not assessed', 'Not comparable', 'Test fixture', 'Replayed', 'Estimated', 'Illustrative',
] as const;
export type StatusWord = (typeof STATUS_WORDS)[number];

const LOOK: Record<StatusWord, { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'; icon: PhosphorIcon }> = {
  Draft: { tone: 'neutral', icon: PencilSimpleLine },
  'Needs evidence': { tone: 'warning', icon: FileDashed },
  'Needs review': { tone: 'warning', icon: Warning },
  Reviewed: { tone: 'info', icon: CheckCircle },
  Recorded: { tone: 'success', icon: Seal },
  Assigned: { tone: 'primary', icon: CheckCircle },
  Retired: { tone: 'neutral', icon: MinusCircle },
  Cancelled: { tone: 'neutral', icon: XCircle },
  Unknown: { tone: 'neutral', icon: Question },
  'Not assessed': { tone: 'neutral', icon: Circle },
  'Not comparable': { tone: 'neutral', icon: Scales },
  'Test fixture': { tone: 'info', icon: Flask },
  Replayed: { tone: 'info', icon: ArrowCounterClockwise },
  Estimated: { tone: 'warning', icon: Sparkle },
  Illustrative: { tone: 'neutral', icon: Prohibit },
};

export function StatusBadge({ status }: { status: StatusWord }) {
  const look = LOOK[status];
  const tone = look.tone === 'neutral' ? '' : ` ul-badge--${look.tone}`;
  return (
    <span className={`ul-badge${tone}`}>
      <Icon icon={look.icon} size={16} />
      {status}
    </span>
  );
}

/** A plain badge for recorded values that are not status words (job states, classifications). */
export function Badge({ children, tone = 'neutral', icon = Clock }: {
  children: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'; icon?: PhosphorIcon | null;
}) {
  const toneClass = tone === 'neutral' ? '' : ` ul-badge--${tone}`;
  return (
    <span className={`ul-badge${toneClass}`}>
      {icon ? <Icon icon={icon} size={16} /> : null}
      {children}
    </span>
  );
}

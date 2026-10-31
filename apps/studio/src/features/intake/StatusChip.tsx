import { Archive, CheckCircle, CircleNotch, WarningCircle, XCircle } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Badge } from '@ulpin/ui';
import type { Chip, ChipState } from './status-chip';

const LOOK: Record<ChipState, { word: string; tone: 'info' | 'warning' | 'success' | 'neutral' | 'danger';
  icon: PhosphorIcon }> = {
  reading: { word: 'Reading', tone: 'info', icon: CircleNotch },
  needs_you: { word: 'Needs you', tone: 'warning', icon: WarningCircle },
  ready: { word: 'Ready', tone: 'success', icon: CheckCircle },
  kept_only: { word: 'Kept only', tone: 'neutral', icon: Archive },
  stopped: { word: 'Stopped', tone: 'danger', icon: XCircle },
};

/** One pill per file or batch state: icon, word and tone; the percent follows the word when known. */
export function StatusChip({ chip }: { chip: Chip }) {
  const look = LOOK[chip.state];
  const words = chip.percent === null ? look.word : `${look.word} ${chip.percent}%`;
  return <Badge tone={look.tone} icon={look.icon}>{words}</Badge>;
}

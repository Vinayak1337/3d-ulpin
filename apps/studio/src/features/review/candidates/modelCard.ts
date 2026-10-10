export interface ModelCardSummary {
  /** The recorded claim about what the model's output is. */
  claim: string | null;
  /** Recorded development-split recall and precision, as text; never a statement about this image. */
  development: string | null;
  licence: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function developmentText(quality: Record<string, unknown> | null): string | null {
  const dev = record(quality?.dev);
  if (!dev || typeof dev.recall !== 'number' || typeof dev.precision !== 'number') return null;
  const chips = typeof dev.chips === 'number' ? ` on ${dev.chips.toLocaleString('en-IN')} chips` : '';
  return `recall ${dev.recall.toFixed(2)}, precision ${dev.precision.toFixed(2)}${chips}`;
}

/** What the retained inference receipt says about the model, read defensively: its shape is not published. */
export function modelCardSummary(receipt: unknown): ModelCardSummary {
  const root = record(receipt);
  const quality = record(root?.quality);
  return {
    claim: text(quality?.claim),
    development: developmentText(quality),
    licence: text(record(root?.model)?.license),
  };
}

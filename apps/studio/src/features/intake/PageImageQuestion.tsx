import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import { answerPageImage, readPageImagePreview } from './batch-queries';
import { answerWords, canAnswer, choiceWords, createAnswerCommand, pageImageLabels, previewAlt, shownItem,
  type AnswerState, type PageImageItem, type PageImageLabel } from './page-image-model';
import styles from './Batch.module.css';

export interface PreviewView {
  href: string | null;
  error: string;
}

/** G23S. A page image in the batch: its preview, its words, and the officer's answer to what it shows. */
export function PageImageQuestion({ caseId, item, refresh }: {
  caseId: string; item: PageImageItem; refresh: () => void;
}) {
  const [state, setState] = useState<AnswerState>({ busy: false, uncertain: false, item: null, error: '' });
  const current = useRef(refresh);
  current.current = refresh;
  const command = useRef<ReturnType<typeof createAnswerCommand> | null>(null);
  command.current ??= createAnswerCommand(body => answerPageImage(caseId, item.itemId, body), setState,
    () => current.current());
  const shown = shownItem(item, state.item);
  return <PageImageAnswer item={shown} preview={usePreview(caseId, shown)} state={state}
    choose={label => void command.current?.(label)} />;
}

/** Each mounted view owns and revokes its object URL; a changed preview hash reads the new one. */
function usePreview(caseId: string, item: PageImageItem): PreviewView {
  const preview = item.pageImage.preview;
  const query = useQuery({ queryKey: ['page-image-preview', caseId, item.itemId, preview?.sha256 ?? ''],
    enabled: Boolean(preview), retry: false, staleTime: Infinity, gcTime: 0,
    queryFn: ({ signal }) => readPageImagePreview(caseId, item.itemId, preview!.bytes, signal) });
  const [image, setImage] = useState<{ blob: Blob; href: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const href = URL.createObjectURL(query.data);
    setImage({ blob: query.data, href });
    return () => URL.revokeObjectURL(href);
  }, [query.data]);
  return { href: image && image.blob === query.data ? image.href : null, error: query.error?.message ?? '' };
}

export function PageImageAnswer({ item, preview, state, choose }: {
  item: PageImageItem; preview: PreviewView; state: AnswerState; choose: (label: PageImageLabel) => void;
}) {
  const read = item.pageImage;
  return <section id={`intake-page-image-${item.itemId}`} className={styles.question}
    aria-label={`Page image ${item.name}`}>
    <h2 className="ul-heading">Page image · {item.name}</h2>
    <PreviewFigure item={item} preview={preview} />
    {item.limitReason ? <p>{item.limitReason}</p> : null}
    <p role="status">{answerWords(read)}</p>
    {canAnswer(item) ? <div className="ul-row" role="group" aria-label="What does this page image show?">
      {pageImageLabels.map(label => <Button key={label} variant="soft"
        aria-pressed={read.label?.value === label} disabled={state.busy} onClick={() => choose(label)}>
        {choiceWords[label]}
      </Button>)}
    </div> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.uncertain ? <p role="status">The outcome is not known.</p> : null}
  </section>;
}

function PreviewFigure({ item, preview }: { item: PageImageItem; preview: PreviewView }) {
  const read = item.pageImage;
  if (!read.preview) return <p>No preview: {read.previewLimit ?? 'none was made'}.</p>;
  if (preview.error) return <Banner tone="warning">{preview.error}</Banner>;
  if (!preview.href) return <Skeleton />;
  return <img className={styles.preview} src={preview.href} alt={previewAlt(read)}
    width={read.preview.width} height={read.preview.height} />;
}

import { ApiError, type Schemas } from '@ulpin/api-client';
import { isPageImage } from '@ulpin/contracts/usp/plain';
export { canAnswer, isPageImage } from '@ulpin/contracts/usp/plain';
import { countWords, type IntakeItem } from './batch-model';

export type PageImageBody =
  Schemas['POST_ingestion_cases_caseId_intake_items_itemId_page_image_label_Request_application_json'];
export type PageImageLabel = PageImageBody['label'];
export type PageImageRead = NonNullable<IntakeItem['pageImage']>;
export type PageImageItem = IntakeItem & { pageImage: PageImageRead };
export interface AnswerState {
  busy: boolean;
  uncertain: boolean;
  item: IntakeItem | null;
  error: string;
}

export const pageImageLabels: readonly PageImageLabel[] = ['plan', 'elevation', 'photo', 'other'];
export const choiceWords: Record<PageImageLabel, string> = {
  plan: 'Plan', elevation: 'Elevation', photo: 'Photo', other: 'Something else',
};
const labelWords: Record<PageImageLabel, string> = {
  plan: 'a plan', elevation: 'an elevation', photo: 'a photo', other: 'something else',
};

/** Alt text from the read's format and stated pixel size only. */
export function previewAlt(read: PageImageRead): string {
  const size = read.width && read.height ? `${countWords(read.width)} x ${countWords(read.height)} pixels`
    : 'size not stated';
  return `Preview of a ${read.format.toUpperCase()} page image, ${size}`;
}

export function answerWords(read: PageImageRead): string {
  return read.label ? `Answer: ${labelWords[read.label.value]} (candidate label, not reviewed).`
    : 'Not answered yet.';
}

/** The answer's returned item until the batch's own read is as new; then the batch's read. */
export function shownItem(item: PageImageItem, answered: IntakeItem | null): PageImageItem {
  return isPageImage(answered) && answered.itemId === item.itemId && answered.updatedAt > item.updatedAt
    ? answered : item;
}

/**
 * Each answer is its own request with a fresh key. Only a lost or 5xx answer keeps its key, so choosing the same
 * answer again resends that request; a different answer is a new request.
 */
export function createAnswerCommand(send: (body: PageImageBody) => Promise<IntakeItem>,
  changed: (state: AnswerState) => void, refresh: () => void, key: () => string = () => crypto.randomUUID()) {
  let pending: PageImageBody | null = null;
  let state: AnswerState = { busy: false, uncertain: false, item: null, error: '' };
  const publish = (update: Partial<AnswerState>) => {
    state = { ...state, ...update };
    changed(state);
  };
  return async (label: PageImageLabel) => {
    if (state.busy) return;
    const body: PageImageBody = pending?.label === label ? pending : { requestKey: key(), label };
    pending = body;
    publish({ busy: true, error: '' });
    try {
      const item = await send(body);
      pending = null;
      publish({ item, uncertain: false });
      refresh();
    } catch (error) {
      const definite = error instanceof ApiError && error.status < 500;
      if (definite) pending = null;
      publish({ uncertain: !definite,
        error: error instanceof Error ? error.message : 'The server gave no answer. Choose the same answer again.' });
      if (definite) refresh();
    } finally {
      publish({ busy: false });
    }
  };
}

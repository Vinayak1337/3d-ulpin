import { ApiError } from '@ulpin/api-client';
import { approvalBody, type Recipe } from './layout-model';
import type { AuthorBody } from './question-model';

type Decision = ReturnType<typeof approvalBody>;
export interface LayoutTransport {
  author: (body: AuthorBody) => Promise<Recipe>;
  approve: (receipt: Recipe, body: Decision) => Promise<Recipe>;
}
export interface LayoutCommandState {
  busy: boolean;
  uncertain: boolean;
  phase: 'author' | 'approve';
  receipt: Recipe | null;
  authored: boolean;
  error: string;
  concern: string;
  changed: boolean;
}
interface Pending {
  author: AuthorBody | null;
  receipt: Recipe | null;
  approval: Decision | null;
}

/** Keep immutable request bodies until their outcomes are known; a known 201 is never authored twice. */
export function createLayoutCommand(transport: LayoutTransport, changed: (state: LayoutCommandState) => void,
  refresh: () => void, key: () => string = () => crypto.randomUUID()) {
  let pending: Pending | null = null;
  let state: LayoutCommandState = { busy: false, uncertain: false, phase: 'author', receipt: null,
    authored: false, error: '', concern: '', changed: false };
  const publish = (update: Partial<LayoutCommandState>) => {
    state = { ...state, ...update };
    changed(state);
  };
  const run = async () => {
    if (state.busy || !pending) return;
    publish({ busy: true, error: '', concern: '', changed: false });
    try {
      if (!pending.receipt && pending.author) {
        pending.receipt = await transport.author(pending.author);
        pending.author = null;
        publish({ receipt: pending.receipt, phase: 'approve', authored: true });
        refresh();
      }
      if (!pending.receipt) throw new Error('The authored layout was not supplied by the record.');
      pending.approval ??= approvalBody(pending.receipt, key());
      const receipt = await transport.approve(pending.receipt, pending.approval);
      pending = null;
      publish({ receipt, uncertain: false });
      refresh();
    } catch (error) {
      const failure = commandFailure(error);
      publish(failure);
      if (!failure.uncertain) pending = null;
      if (failure.changed) {
        publish({ receipt: null });
        refresh();
      }
    } finally {
      publish({ busy: false });
    }
  };
  return commandActions(run, () => pending, value => { pending = value; }, () => state, publish);
}

function commandActions(run: () => Promise<void>, pending: () => Pending | null,
  setPending: (value: Pending) => void, state: () => LayoutCommandState,
  publish: (update: Partial<LayoutCommandState>) => void) {
  return {
    use: async (body: AuthorBody) => {
      if (state().busy) return;
      if (!pending()) {
        setPending({ author: structuredClone(body), receipt: null, approval: null });
        publish({ receipt: null, phase: 'author', uncertain: false, authored: false });
      }
      await run();
    },
    approve: async (receipt: Recipe) => {
      if (state().busy) return;
      if (!pending()) {
        setPending({ author: null, receipt: structuredClone(receipt), approval: null });
        publish({ phase: 'approve', uncertain: false });
      }
      await run();
    },
    retry: run,
  };
}

function commandFailure(error: unknown): Partial<LayoutCommandState> {
  const definite = error instanceof ApiError && error.status < 500;
  const wrapped = error instanceof ApiError ? (error.body as { error?: { code?: string } })?.error : undefined;
  const concerns: Record<string, string> = { MAPPING_GEOMETRY_KIND: 'kind', MAPPING_IDENTITY: 'identifier',
    MAPPING_NAME: 'name', MAPPING_HEIGHT: 'height' };
  const concern = concerns[wrapped?.code ?? ''];
  return { uncertain: !definite, changed: error instanceof ApiError && error.status === 409,
    error: error instanceof Error ? error.message : 'The server gave no answer. Send the same layout again.',
    concern: concern ?? '' };
}

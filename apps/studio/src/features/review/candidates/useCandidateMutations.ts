import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queries';
import {
  attachRoomToLevel, recordRoofprintDecisions, reviewDraftForRegistry,
} from './commands';
import type { AttachLevelBody, FootprintDraftBody } from './decisions';

/** After a command, everything that shows the candidates, their draft packages and the work queue is read again. */
function useRefreshRecords() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: ['areas'] }),
    client.invalidateQueries({ queryKey: ['buildings'] }),
    client.invalidateQueries({ queryKey: ['spatial-ml'] }),
    client.invalidateQueries({ queryKey: ['import-packages'] }),
    client.invalidateQueries({ queryKey: ['work-queue'] }),
  ]);
}

export function useRecordRoofprints(itemId: string) {
  const refresh = useRefreshRecords();
  return useMutation({
    mutationFn: (body: FootprintDraftBody) => recordRoofprintDecisions(itemId, body),
    onSuccess: refresh,
  });
}

export function useAttachRoom(buildingId: string) {
  const refresh = useRefreshRecords();
  return useMutation({
    mutationFn: (body: AttachLevelBody) => attachRoomToLevel(buildingId, body),
    onSuccess: refresh,
  });
}

export function useReviewDraft(packageId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (revision: number) => reviewDraftForRegistry(packageId, revision),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.importPackage(packageId) }),
  });
}

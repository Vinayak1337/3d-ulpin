import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignProposedCode, getSpaceWorkflow, listBuildingWorkflow, recordReview, resolveCode } from '../../local/workflow';

const keys = {
  space: (id: string) => ['workflow', 'space', id] as const,
  building: (id: string) => ['workflow', 'building', id] as const,
  code: (code: string) => ['workflow', 'code', code] as const,
};

export function useSpaceWorkflow(spaceId: string | null) {
  return useQuery({ queryKey: keys.space(spaceId ?? ''), enabled: Boolean(spaceId), queryFn: () => getSpaceWorkflow(spaceId!) });
}

export function useBuildingWorkflow(buildingId: string | null) {
  return useQuery({ queryKey: keys.building(buildingId ?? ''), enabled: Boolean(buildingId), queryFn: () => listBuildingWorkflow(buildingId!) });
}

export function useResolveCode(code: string) {
  return useQuery({ queryKey: keys.code(code), queryFn: () => resolveCode(code), retry: false });
}

export function useRecordReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: recordReview,
    onSuccess: (workflow) => {
      void client.invalidateQueries({ queryKey: keys.space(workflow.spaceId) });
      void client.invalidateQueries({ queryKey: keys.building(workflow.buildingId) });
    },
  });
}

export function useAssignCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: assignProposedCode,
    onSuccess: (workflow) => {
      void client.invalidateQueries({ queryKey: keys.space(workflow.spaceId) });
      void client.invalidateQueries({ queryKey: keys.building(workflow.buildingId) });
    },
  });
}

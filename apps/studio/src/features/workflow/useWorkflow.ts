import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignProposedCode, clearAction, getSpaceWorkflow, listBuildingActions, listBuildingWorkflow, recordAction,
  resolveCode, type BuildingAction,
} from '../../local/workflow';

const keys = {
  space: (id: string) => ['workflow', 'space', id] as const,
  building: (id: string) => ['workflow', 'building', id] as const,
  code: (code: string) => ['workflow', 'code', code] as const,
  actions: (id: string) => ['workflow', 'actions', id] as const,
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

export function useBuildingActions(buildingId: string | null) {
  return useQuery({ queryKey: keys.actions(buildingId ?? ''), enabled: Boolean(buildingId), queryFn: () => listBuildingActions(buildingId!) });
}

export function useRecordAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: recordAction,
    onSuccess: (action) => { void client.invalidateQueries({ queryKey: keys.actions(action.buildingId) }); },
  });
}

export function useClearAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ buildingId, kind, subjectId }: { buildingId: string; kind: BuildingAction['kind']; subjectId: string }) => clearAction(buildingId, kind, subjectId),
    onSuccess: (_r, v) => { void client.invalidateQueries({ queryKey: keys.actions(v.buildingId) }); },
  });
}

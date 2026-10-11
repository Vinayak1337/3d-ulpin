import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';

export function useIntakeManifest(caseId: string) {
  return useQuery({ queryKey: ['intake', caseId], retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/intake', {
      params: { path: { caseId } },
    })),
  });
}

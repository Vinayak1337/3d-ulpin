import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Buildings, WarningCircle } from '@phosphor-icons/react';
import { api, unwrap } from '@ulpin/api-client';
import { EmptyState, Panel, Skeleton, formatCount } from '@ulpin/ui';
import { queryKeys, useAreas } from '../../api/queries';
import styles from './RegisterPage.module.css';

/** Register: every building by area, each opening its register. */
export function RegistryIndex() {
  const areas = useAreas();
  const contexts = useQueries({
    queries: (areas.data ?? []).map((area) => ({
      queryKey: queryKeys.areaContext(area.id),
      queryFn: async () => unwrap(await api.GET('/api/v1/areas/{areaId}/context', { params: { path: { areaId: area.id } } })),
      staleTime: 60_000,
    })),
  });
  if (areas.isPending) return <div className={styles.page}><Skeleton height={28} width="30%" /><Skeleton /><Skeleton /></div>;
  if (areas.error) return <div className={styles.page}><EmptyState icon={WarningCircle} title="The register could not be loaded">{areas.error.message}</EmptyState></div>;
  return (
    <div className={styles.page}>
      <h1 className="ul-title">Register</h1>
      {!areas.data.length ? <EmptyState icon={Buildings} title="No buildings recorded yet">Buildings appear here once an import is committed.</EmptyState> : null}
      {areas.data.map((area, i) => {
        const buildings = contexts[i]?.data?.features.filter((f) => f.kind === 'building') ?? [];
        return (
          <Panel key={area.id} title={area.name} aside={<span className="ul-caption">{formatCount(buildings.length)} buildings</span>}>
            {contexts[i]?.isPending ? <Skeleton /> : (
              <ul className={styles.gaps} style={{ listStyle: 'none', paddingLeft: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {buildings.map((b) => <li key={b.id}><Link to={`/studio/properties/${b.id}/register`}>{b.name}</Link></li>)}
              </ul>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

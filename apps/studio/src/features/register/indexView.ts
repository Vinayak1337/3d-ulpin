import { formatCount } from '@ulpin/ui';

type IndexView = 'requests' | 'buildings';

/**
 * Which tab the Register index shows. A tab named in the address wins. With none named it opens on Buildings
 * when the requests read is not served (it answered null), and on Requests otherwise: also while that read has
 * not answered, where the Requests tab shows its own loading state.
 */
export function indexView(tab: string | null, requests: unknown): IndexView {
  if (tab === 'requests' || tab === 'buildings') return tab;
  return requests === null ? 'buildings' : 'requests';
}

/** "1 building", "62 buildings": the count of an area's buildings in words. */
export function buildingCount(count: number): string {
  return `${formatCount(count)} building${count === 1 ? '' : 's'}`;
}

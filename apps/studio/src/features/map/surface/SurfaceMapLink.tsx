import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { placedAreaQuery } from './api';
import { isSurfaceItem, type IntakeItem } from './parts';

/** S9.4d. A surface file on the map opens the area its parts are placed in, with its batch, which may be its own. */
export function SurfaceMapLink({ item }: { item: IntakeItem }) {
  const onMap = isSurfaceItem(item) && item.placement === 'on_map';
  const areaId = useQuery({ ...placedAreaQuery(item), enabled: onMap }).data;
  if (!onMap || !areaId) return null;
  return <Link className="ul-btn ul-btn--soft" aria-label={`Open on the map: ${item.name}`}
    to={`/studio/areas/${encodeURIComponent(areaId)}?case=${encodeURIComponent(item.caseId)}`}>Open on the map</Link>;
}

import { Link } from 'react-router';
import { Banner } from '@ulpin/ui';
import { useAreaCanonical, useBuildingCanonical } from '../../../api/queries';
import { candidateCards } from './model';

/** Where the map points at the review queue: only when the canonical record holds model candidates. */
export function CandidateBanner({ areaId, buildingId, className }: {
  areaId: string; buildingId: string | null; className?: string;
}) {
  const area = useAreaCanonical(areaId).data;
  const building = useBuildingCanonical(buildingId).data;
  const roofprints = candidateCards(area?.candidates, 'roofprint').cards.length;
  const rooms = candidateCards(building?.candidates, 'room').cards.length;
  if (!roofprints && !rooms) return null;
  const to = roofprints ? `/studio/areas/${areaId}/candidates` : `/studio/properties/${buildingId}/candidates`;
  const text = roofprints
    ? `${roofprints} roofprint candidates from a model are waiting for an officer.`
    : `${rooms} room candidates from a plan are waiting for an officer.`;
  const action = <Link className="ul-btn ul-btn--soft" to={to}>Review candidates</Link>;
  return <div className={className}><Banner tone="info" action={action}>{text}</Banner></div>;
}

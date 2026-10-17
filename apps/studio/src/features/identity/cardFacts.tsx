import { useMemo } from 'react';
import { formatDate, type Fact } from '@ulpin/ui';
import { useBuildingLedger, useBuildingRegister } from '../../api/queries';
import type { SpaceWorkflow } from '../../local/workflow';
import { buildingModel } from '../../model/building';
import { ledgerSpace } from '../map/ledger';
import { DRAFT_MADE } from './draft';

/**
 * What a Property Card and its verification page state about one space, read from the building's
 * register and ledger. Values the records do not hold stay Unknown.
 */
export function useCardFacts(workflow: SpaceWorkflow | null | undefined) {
  const register = useBuildingRegister(workflow?.buildingId).data;
  const ledger = useBuildingLedger(workflow?.buildingId).data;
  return useMemo(() => {
    if (!workflow) return null;
    const model = register ? buildingModel(register) : null;
    const space = model?.spaceById.get(workflow.spaceId) ?? null;
    const level = space?.levelId ? model!.levels.find((l) => l.id === space.levelId) ?? null : null;
    const facts = ledgerSpace(ledger, workflow.spaceId);
    const unknown = <span className="ul-unknown">Unknown</span>;
    const parcel = ledger?.parcelUlpin ?? register?.parcelIdentifiers[0]?.value ?? null;
    const list: Fact[] = [
      { label: 'Parcel ULPIN', value: parcel ? <span className="ul-mono">{parcel}</span> : <span className="ul-unknown">Not supplied</span> },
      {
        label: 'Level',
        value: level ? `${level.label}${level.lower !== null && level.upper !== null ? ` · ${level.lower.toFixed(2)} to ${level.upper.toFixed(2)} m` : ''}${ledger?.siteDatum ? ` · site datum ${ledger.siteDatum}` : ''}` : unknown,
      },
      {
        label: 'Carpet area',
        value: facts?.carpetAreaM2
          ? `${facts.carpetAreaM2.value.toFixed(2)} m² (${facts.carpetAreaM2.source ?? 'source'})${facts.declaredAreaM2 ? ` · ${facts.declaredAreaM2.value.toFixed(2)} m² declared` : ''}`
          : unknown,
      },
      { label: 'Undivided share', value: facts?.sharePct ? `${facts.sharePct.value.toFixed(2)} % of the common areas` : unknown },
      { label: DRAFT_MADE, value: workflow.assignedAt ? formatDate(workflow.assignedAt) : unknown },
    ];
    // The proposed 3D ULPIN location path: parcel / structure / floor / space.
    const location = space?.record.ulpin3d ? space.record.ulpin3d.split('/').map((s) => s.replace(/-/g, ' ')) : null;
    return { facts: list, location, buildingName: register?.property.name ?? null, spaceName: space?.name ?? workflow.spaceName };
  }, [workflow, register, ledger]);
}

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Button, DescriptionList, RevisionTimeline, Skeleton, UlpinCode, formatDate, formatDateTime,
} from '@ulpin/ui';
import { chainState, shortHash, type SpaceWorkflow } from '../../local/workflow';
import { useResolveCode } from '../workflow/useWorkflow';
import { useCardFacts } from '../identity/cardFacts';
import { usePublicCode } from '../../portal/queries';
import type { PublicBuildingSummary } from '@ulpin/api-client/draft';
import { ResultBanner, VerifyFrame } from './VerifyFrame';

/**
 * P4L: the Property Card's QR opens this page. It resolves the exact code and revision and shows whether
 * that revision is current, with the record's hash chain.
 */
export function VerifyPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const revision = Number(params.get('rev')) || null;
  const resolved = useResolveCode(code);
  // Not a Property Card on this device: the code may be a building's 3D ULPIN.
  const publicCode = usePublicCode(!resolved.isPending && !resolved.data ? code : '');
  const building = publicCode.data?.kind === 'building' ? publicCode.data.building : null;
  const [chain, setChain] = useState<'consistent' | 'broken' | 'unknown'>('unknown');
  useEffect(() => {
    if (resolved.data) void chainState(resolved.data).then(setChain);
  }, [resolved.data]);
  const retry = <Button variant="soft" onClick={() => void resolved.refetch()}>Try again</Button>;

  return (
    <VerifyFrame>
      {resolved.isPending || (!resolved.data && publicCode.isFetching) ? (
        <div className="ul-panel ul-pad ul-stack">
          <Skeleton height={28} width="55%" /><Skeleton width="80%" /><Skeleton /><Skeleton width="40%" />
        </div>
      ) : resolved.error ? (
        <ResultBanner tone="danger" small action={retry}>
          Could not check this card. {resolved.error.message}
        </ResultBanner>
      ) : !resolved.data && building ? (
        <BuildingResult building={building} />
      ) : !resolved.data ? (
        <div className="ul-panel ul-pad ul-stack">
          <h1 className="ul-heading">No record found for this code</h1>
          <p className="ul-help">No building or Property Card carries this code. Check the code printed on the card.</p>
          <Link to="/studio/work" className="ul-btn">Back to Studio</Link>
        </div>
      ) : (
        <Result workflow={resolved.data} revision={revision} chain={chain} />
      )}
    </VerifyFrame>
  );
}

function Result({ workflow, revision, chain }: { workflow: SpaceWorkflow; revision: number | null; chain: 'consistent' | 'broken' | 'unknown' }) {
  const head = workflow.events[0]!;
  const superseded = revision !== null && revision < head.revision;
  const card = useCardFacts(workflow);
  return (
    <>
      <ResultBanner tone={superseded ? 'warning' : 'success'}>
        {superseded ? `Superseded by revision r${head.revision}` : `Valid: revision r${head.revision}`}
      </ResultBanner>
      <section className="ul-panel ul-pad ul-stack">
        <h1 className="ul-heading">{card?.buildingName ? `${card.spaceName}, ${card.buildingName}` : workflow.spaceName}</h1>
        <UlpinCode code={workflow.code} location={card?.location ?? null} state="assigned" />
        <DescriptionList items={[
          ...(card?.facts ?? [{ label: 'Assigned', value: workflow.assignedAt ? formatDate(workflow.assignedAt) : 'Unknown' }]),
          { label: 'Revision hash', value: <span className="ul-mono">{shortHash(head.hash)}</span> },
        ]} />
      </section>
      <RevisionTimeline
        chain={chain}
        revisions={workflow.events.map((e) => ({
          id: String(e.revision), title: e.title, byline: `${e.by} · ${formatDateTime(e.at)}`, kind: e.kind,
          hash: shortHash(e.hash), previousHash: e.previousHash ? shortHash(e.previousHash) : null,
        }))}
      />
    </>
  );
}

function BuildingResult({ building: b }: { building: PublicBuildingSummary }) {
  return (
    <>
      <ResultBanner tone="success">Valid: building 3D ULPIN on record</ResultBanner>
      <section className="ul-panel ul-pad ul-stack">
        <h1 className="ul-heading">{b.name}, {b.areaName}</h1>
        <UlpinCode code={b.code} location={b.location} state="assigned" />
        <DescriptionList items={[
          { label: 'Parcel ULPIN', value: b.parcelUlpin ? <span className="ul-mono">{b.parcelUlpin}</span> : <span className="ul-unknown">Unknown</span> },
          { label: 'Floors recorded', value: b.levels ? `${b.levels} levels` : 'Not recorded yet' },
          { label: 'Released records', value: String(b.records) },
        ]} />
        <Link to={`/portal/buildings/${b.id}`} className="ul-btn">Open on the public portal</Link>
      </section>
    </>
  );
}

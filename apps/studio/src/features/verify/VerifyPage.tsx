import { Link, useParams, useSearchParams } from 'react-router';
import { CheckCircle, FilePlus, GitCommit } from '@phosphor-icons/react';
import {
  Badge, Button, DescriptionList, Icon, Panel, Skeleton, UlpinCode, formatDate, formatDateTime,
} from '@ulpin/ui';
import { shortHash, type SpaceWorkflow, type WorkflowEvent } from '../../local/workflow';
import { useResolveCode } from '../workflow/useWorkflow';
import { useCardFacts } from '../identity/cardFacts';
import { draftLead } from '../identity/draft';
import { DraftNotice } from '../identity/DraftNotice';
import { LOCAL_CHAIN_TONES, LOCAL_CHAIN_WORDS, useLocalChain, type LocalChain } from '../identity/localChain';
import { usePublicCode } from '../../portal/queries';
import type { PublicBuildingSummary } from '@ulpin/api-client/draft';
import { ResultBanner, VerifyFrame } from './VerifyFrame';

const EVENT_ICONS = { recorded: CheckCircle, evidence: GitCommit, draft: FilePlus };

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
  const chain = useLocalChain(resolved.data);
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

function Result({ workflow, revision, chain }: {
  workflow: SpaceWorkflow; revision: number | null; chain: LocalChain;
}) {
  const head = workflow.events[0]!;
  const lead = draftLead(revision, head.revision);
  const card = useCardFacts(workflow);
  return (
    <>
      <DraftNotice />
      <ResultBanner tone={lead.tone}>{lead.text}</ResultBanner>
      <section className="ul-panel ul-pad ul-stack">
        <h1 className="ul-heading">{card?.buildingName ? `${card.spaceName}, ${card.buildingName}` : workflow.spaceName}</h1>
        <UlpinCode code={workflow.code} location={card?.location ?? null} state="draft" />
        <DescriptionList items={[
          ...(card?.facts ?? [{ label: 'Assigned', value: workflow.assignedAt ? formatDate(workflow.assignedAt) : 'Unknown' }]),
          { label: 'Revision hash', value: <span className="ul-mono">{shortHash(head.hash)}</span> },
        ]} />
      </section>
      <LocalHistory events={workflow.events} chain={chain} />
    </>
  );
}

/**
 * The draft's own revisions. The shared timeline words its badge as "Chain consistent"; this one names the
 * check as this browser's.
 */
function LocalHistory({ events, chain }: { events: WorkflowEvent[]; chain: LocalChain }) {
  const badge = <Badge tone={LOCAL_CHAIN_TONES[chain]} icon={null}>{LOCAL_CHAIN_WORDS[chain]}</Badge>;
  return (
    <Panel title="History" aside={badge}>
      <ol className="ul-timeline">
        {events.map((event) => (
          <li key={event.revision}>
            <span className={`ul-dot${event.kind === 'recorded' ? ' ul-dot--done' : ''}`}>
              <Icon icon={EVENT_ICONS[event.kind]} size={16} />
            </span>
            <span>
              <strong>{event.title}</strong>
              <span className="ul-timeline__by">{event.by} · {formatDateTime(event.at)}</span>
              <span className="ul-timeline__hash ul-mono">
                {shortHash(event.hash)}{event.previousHash ? ` ← ${shortHash(event.previousHash)}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
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

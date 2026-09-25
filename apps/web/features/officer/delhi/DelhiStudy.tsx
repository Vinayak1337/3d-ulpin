'use client';
import Link from 'next/link';
import type { MapArea } from '@ulpin/contracts';
import { areaClassification } from '@/lib/ui/provenance';
import { useResource } from '../shared/hooks';
import { ErrorState, LoadingState } from '../shared/ui';
import './delhi.css';

/** The old source-study URL remains useful with saved area records. */
export default function DelhiStudy() {
  const areas = useResource<MapArea[]>('/areas');
  return <main className="delhi-study">
    <Link href="/studio/datasets" className="delhi-back">← All saved maps</Link>
    <header><span className="delhi-kicker">SAVED SOURCE STUDY</span><h1>Areas and their recorded sources</h1>
      <p>Open a saved area to inspect its map, source revisions and reference information.</p></header>
    {areas.loading && !areas.data && <LoadingState label="Loading saved areas"/>}
    {areas.error && <ErrorState message={areas.error} retry={areas.reload}/>}
    {areas.data && <section className="delhi-options" aria-label="Saved areas">
      {areas.data.map(area => <article key={area.id}>
        <span className="delhi-tag">Classification: {areaClassification(area)}</span>
        <h2>{area.name}</h2>
        <p>{area.featureCount == null ? 'Feature count unknown' : `${area.featureCount} mapped features`} · Revision {area.revision}</p>
        <Link className="delhi-primary" href={`/studio/areas/${area.id}`}>Inspect saved area →</Link>
      </article>)}
      {!areas.data.length && <article><h2>No saved areas</h2><p>Add source files to begin an area review.</p><Link href="/studio/add-files">Add files →</Link></article>}
    </section>}
    <section className="delhi-warning"><h2>Reference scene not assessed</h2><p>Area summaries alone do not establish official source permission, coordinate accuracy or a complete scene. Inspect each source and its frame before making a spatial claim.</p></section>
  </main>;
}

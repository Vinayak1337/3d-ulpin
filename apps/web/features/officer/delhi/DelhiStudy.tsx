"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MapArea } from "@ulpin/contracts";
import "./delhi.css";

type Boundary = { features: { geometry: { type: "Polygon"; coordinates: [number, number][][] } }[] };
const DATA = "/datasets/uttam-nagar/";
const BBOX = [77.0594, 28.6204, 77.0618, 28.6223];
function DelhiMap({ boundary }: { boundary: Boundary }) {
  const ring = boundary.features[0]?.geometry.coordinates[0] || [];
  if (!ring.length) return null;
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
  const scale = Math.min(520 / ((east - west) * Math.cos(28.6 * Math.PI / 180)), 420 / (north - south));
  const project = ([lon, lat]: number[]) => [50 + (lon - west) * Math.cos(28.6 * Math.PI / 180) * scale, 35 + (north - lat) * scale];
  const points = ring.map(p => project(p).join(",")).join(" ");
  const [x, y] = project([(BBOX[0] + BBOX[2]) / 2, (BBOX[1] + BBOX[3]) / 2]);
  return <svg viewBox="0 0 620 510" role="img" aria-label="OpenStreetMap Delhi NCT boundary with the Uttam Nagar study location highlighted">
    <polygon points={points} fill="#dce9df" stroke="#4d7666" strokeWidth="2" />
    <circle cx={x} cy={y} r="10" fill="#c0753c" stroke="white" strokeWidth="3" />
    <path d={`M${x + 10} ${y}h95`} stroke="#996130" strokeWidth="2" />
    <text x={x + 115} y={y - 3} fill="#244d41" fontSize="18" fontWeight="700">Uttam Nagar</text>
    <text x={x + 115} y={y + 20} fill="#60766c" fontSize="13">Selected study window</text>
    <text x="50" y="484" fill="#60766c" fontSize="12">Location marker enlarged for visibility · community boundary, not cadastral evidence</text>
  </svg>;
}
export default function DelhiStudy() {
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([fetch(DATA + "delhi-nct-boundary.geojson", { signal: c.signal }), fetch("/api/v1/areas", { signal: c.signal, cache: "no-store" })])
      .then(async responses => { if (responses.some(r => !r.ok)) throw Error("Study data could not be loaded."); return Promise.all(responses.map(r => r.json())); })
      .then(([b, a]) => { setBoundary(b); setAreas(a); })
      .catch(e => { if (!c.signal.aborted) setError(String(e)); });
    return () => c.abort();
  }, []);
  const reference = areas.find(a => a.name === "Uttam Nagar | OSM reference | no ownership data");
  const demo = areas.find(a => a.name === "Uttam Nagar | FICTIONAL rooms and conflicts | OSM-derived");
  const googleReference = areas.find(a => a.name === "Google Uttam Nagar | public footprints and roads");
  const googleDemo = areas.find(a => a.name === "Google Uttam Nagar | FICTIONAL 3D registry");
  const roadReference = areas.find(a => a.name === "Uttam Nagar - real OSM block");
  const roadDemo = areas.find(a => a.name === "Uttam Nagar - FICTIONAL registry and conflicts");
  return <main className="delhi-study">
    <Link href="/studio/datasets" className="delhi-back">← All saved blocks</Link>
    <header><span className="delhi-kicker">DELHI / LOCAL DATA STUDY</span><h1>From a city boundary<br />to a linked property block.</h1>
      <p>Open map geometry for Uttam Nagar, kept separate from an explicitly invented registry and conflict scenario.</p></header>
    {error && <p role="alert" className="delhi-warning">{error}</p>}
    <section className="delhi-options" aria-label="Google reference and fictional registry">
      <article><span className="delhi-tag">GOOGLE OPEN BUILDINGS + OSM</span><h2>The Google-derived study</h2>
        <p>15 selected Google footprint predictions and 35 OpenStreetMap road segments. Reference heights and interiors remain unknown. The separate fictional copy contains nine floors, 27 spaces, 18 invented occupants and nine common-access groups.</p>
        <p className="delhi-small">These are distinct datasets from the larger OSM window below. Source files and source attribution are retained in the repository.</p>
        {googleReference && <p><Link href={`/studio/areas/${googleReference.id}`}>Open Google source reference →</Link></p>}
        {googleDemo && <Link className="delhi-primary" href={`/studio/areas/${googleDemo.id}`}>Open Google-derived fictional registry →</Link>}
        {!googleReference && !googleDemo && <p>Run <code>pnpm data:uttam:install</code> to load the saved datasets.</p>}
      </article>
      <article><span className="delhi-tag">SMALL ROAD-BOUNDED OSM STUDY</span><h2>A second street block</h2>
        <p>20 mapped building outlines and nine road/path segments. Its separately labelled fictional scenario adds three demo parcels, nine floors and 27 spaces with invented residents.</p>
        {roadReference && <p><Link href={`/studio/areas/${roadReference.id}`}>Open small OSM reference →</Link></p>}
        {roadDemo && <Link className="delhi-primary" href={`/studio/areas/${roadDemo.id}`}>Open small fictional scenario →</Link>}
      </article>
    </section>
    <section className="delhi-top">
      <div className="delhi-map"><div className="delhi-card-heading"><h2>Delhi NCT</h2><span>OpenStreetMap boundary</span></div>{boundary ? <DelhiMap boundary={boundary} /> : <p>Loading the retained boundary…</p>}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></div>
      <div className="delhi-context"><span className="delhi-kicker">THE SELECTED WINDOW</span><h2>Uttam Nagar<br />street-block study</h2><p>A roughly 235 × 210 metre window near the mapped Uttam Nagar locality. It is an analyst-selected study extent, not an official administrative or cadastral block.</p>
        <dl><div><dt>Downloaded outlines</dt><dd>113 buildings</dd></div><div><dt>Retained road segments</dt><dd>35 centrelines</dd></div><div><dt>Study extent</dt><dd>0.0494 km²</dd></div><div><dt>Source snapshot</dt><dd>17 September 2026 IST</dd></div></dl>
        <p className="delhi-small">Nearby mapped street names include Arya Samaj Road, School Road, Street Number 62 and Street Number 63. The download timestamp is not a survey date.</p>
      </div>
    </section>
    <section className="delhi-options" aria-label="Separate reference and fictional datasets">
      <article><span className="delhi-tag">REFERENCE DATA</span><h2>What the map actually supplies</h2><p>Downloaded building outlines and road centrelines. Unknown height, interiors, road-land width and ownership remain unknown. No residents or parcel ownership have been inferred.</p>
        <strong>{reference?.featureCount ?? "—"} loaded features</strong><p className="delhi-small">This reference dataset is not altered to manufacture an overlap.</p>
        {reference ? <Link className="delhi-primary" href={`/studio/areas/${reference.id}`}>Open OSM reference block →</Link> : <p>Reference area not installed in the selected data mode.</p>}</article>
      <article className="delhi-demo"><span className="delhi-tag">FICTIONAL DEMONSTRATION</span><h2>Rooms, people and conflict review</h2><p>A separate copy with invented heights, road widths, three demo parcels, nine floors and 36 spaces. It includes 27 fictional occupants and shared-use corridor groups—not the real people at these coordinates.</p>
        <strong>{demo?.featureCount ?? "—"} scenario features</strong><p className="delhi-small">The widening corridor and overlapping kiosk are deliberately invented test inputs.</p>
        {demo ? <Link className="delhi-primary" href={`/studio/areas/${demo.id}`}>Open fictional 3D scenario →</Link> : <p>Scenario not installed in the selected data mode.</p>}</article>
    </section>
    <section className="delhi-downloads"><div><span className="delhi-kicker">RETAINED INPUTS</span><h2>Download the geographic data</h2><p>Delhi-wide coverage here is the NCT boundary. Detailed building and road data are the selected Uttam Nagar window, not all buildings in Delhi.</p></div>
      <div><a href={DATA + "delhi-nct-boundary.geojson"} download>Delhi boundary · GeoJSON ↓</a><a href={DATA + "uttam-nagar-buildings.geojson"} download>Uttam Nagar buildings · GeoJSON ↓</a><a href={DATA + "uttam-nagar-roads.geojson"} download>Uttam Nagar roads · GeoJSON ↓</a><a href={DATA + "SOURCE_NOTES.md"} download>Sources, limitations and official-record research ↓</a></div>
    </section>
    <section className="delhi-warning"><h2>Official records are a separate evidence requirement</h2><p>No cadastral identifier or authoritative room-level crosswalk was established for these OSM outlines. That does not mean registered records do not exist. The official Delhi land-record and registration portals were checked; this prototype does not substitute a map footprint for a property deed.</p>
      <p><a href="https://dlrc.delhi.gov.in/" target="_blank" rel="noreferrer">Delhi land records</a> · <a href="https://ngdrs.delhi.gov.in/NGDRS_DL/" target="_blank" rel="noreferrer">Delhi NGDRS</a> · <a href="https://esearch.delhigovt.nic.in/" target="_blank" rel="noreferrer">DORIS migration notice</a></p></section>
  </main>;
}

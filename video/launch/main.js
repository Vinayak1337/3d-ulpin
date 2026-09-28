import { City } from './city.js';
import { E, P, inout, clamp, lerp, h, $, $$, splitWords, wordsAt, show, css, fmt, rng } from './lib.js';

/* ───────────── timeline ───────────── */
export const DUR = 196;
const S = {
  open: [0, 14.2], problem: [14, 26.2], upload: [26, 37.2], ai: [37, 53.2], chunks: [53, 78.2], stream: [77.8, 92], nav: [92, 108],
  floors: [108, 122], checks: [122, 134], under: [134, 143.4], studio: [143.2, 157.2], card: [157, 166.2], register: [166, 175.2],
  propose: [175, 188.2], end: [188, 196],
};
const CHAPTERS = [
  [S.problem, '01', 'The problem'], [S.upload, '02', 'Ingest'], [S.ai, '03', 'Understand'], [S.chunks, '04', 'Normalise'],
  [S.stream, '05', 'Stream'], [S.nav, '06', 'Explore'], [S.floors, '07', 'Floors and flats'], [S.checks, '08', 'Check'],
  [S.under, '09', 'Underground'], [S.studio, '10', 'The Studio'], [S.card, '11', 'Property Card'], [S.register, '12', 'Register'],
  [S.propose, '14', 'What we propose'],
];
// [from, to, position, kicker, text]
const CAPTIONS = [
  [0.5, 3.3, 'center', '', 'Land records are <span class=hl>flat</span>.'],
  [5.0, 8.9, 'center', '', 'Cities <span class=hl>aren’t</span>.'],
  [14.5, 19.7, 'top', 'One building', 'Three records. <span class=hr>Three answers.</span>'],
  [20.0, 25.8, 'top', 'Today', 'Officers reconcile deeds, plans and surveys <span class=hl>by hand</span>.'],
  [26.4, 31.6, 'top small', 'Ingest', 'Drop in <span class=hl>anything</span>: GIS, deeds, tables, plans, LiDAR, imagery.'],
  [31.9, 36.8, 'top small', 'Preserve', 'Originals are <span class=hl>sealed first</span>. Every result traces back to them.'],
  [37.4, 42.6, 'top small', 'Unfamiliar data?', 'The backend hands a <span class=hv>small sample</span> to AI, never the whole city.'],
  [42.9, 47.9, 'top small', 'AI reads the structure', 'It proposes <span class=hv>how to split</span> the file and <span class=hv>what each field means</span>.'],
  [48.2, 52.8, 'top small', 'Code converts', 'AI proposes. <span class=hl>Deterministic code</span> converts and checks. Nothing is invented.'],
  [53.4, 57.8, 'top small', 'Chunk by meaning', 'Split into <span class=hl>complete features</span>, never at an arbitrary byte.'],
  [58.1, 62.4, 'top small', 'Normalise', 'AI maps the first chunks into <span class=hv>one unified schema</span>.'],
  [62.7, 67.2, 'top small', 'Learn in parallel', 'Meanwhile a second worker <span class=ht>trains ML</span> on every checked result.'],
  [67.5, 72.4, 'top small', 'Hand over', 'Qualified ML takes the rest, <span class=ht>faster</span>. Unsure? Back to AI.'],
  [72.7, 77.8, 'top small', 'Publish in order', 'Chunks finish in any order. <span class=hl>The map fills in order.</span>'],
  [78.6, 84.9, '', 'Stream', 'Live on the map <span class=hl>while the upload is still running</span>.'],
  [85.2, 91.6, '', 'One city layer', 'Buildings, roads, parks and water, <span class=hl>chunk by chunk</span>.'],
  [92.5, 99.2, '', 'Explore', 'Search any building. <span class=hl>Fly straight to it.</span>'],
  [99.6, 107.6, '', 'Inspect', 'Height, parcel, source: <span class=hl>every value cites its evidence</span>.'],
  [108.5, 114.6, '', 'Floors', 'Every building opens into <span class=hl>its floors</span>.'],
  [115.0, 121.6, '', 'Flats', 'Every flat gets its own <span class=hl>3D ULPIN</span>.'],
  [122.4, 128.0, '', 'Deviation', 'The plan says one thing, the survey another: <span class=hr>+1 storey</span>, in place.'],
  [128.3, 133.6, '', 'Checks', 'Overlaps are <span class=hr>measured in 3D</span> and resolved as a hashed revision.'],
  [134.4, 138.8, '', 'Underground', 'Utilities and metro corridors <span class=hl>below the parcel</span>.'],
  [139.0, 143.0, '', 'Screen before you dig', 'Draw a trench. See <span class=hr>what it crosses</span>.'],
  [143.6, 156.8, 'top small', 'BhuAayam Studio', 'Built for the officer. <span class=hl>Every screen, working.</span>'],
  [157.4, 161.6, 'top small', 'Property Card', 'One card per flat, with a <span class=hl>QR anyone can verify</span>.'],
  [161.9, 165.8, 'top small', 'Verify', 'Same revision. Same hash chain. <span class=hl>Tamper-evident.</span>'],
  [166.4, 170.6, 'top small', 'Register', 'Floors, flats, owners and residents, <span class=hl>floor by floor</span>.'],
  [170.9, 174.8, 'top small', 'Export', 'Human-readable <span class=hl>and</span> machine-usable. One click.'],
  [175.4, 183.4, 'top small', 'What we propose', 'A <span class=hl>3D land registry</span> that builds itself from the evidence.'],
];

/* ───────────── setup ───────────── */
const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
if (RENDER) document.body.classList.add('render');
const stage = $('#stage'), scenes = $('#scenes'), labels = $('#labels'), capLayer = $('#captions');
const canvas = $('#gl');

function fit() {
  if (RENDER) return;
  const vw = innerWidth, vh = innerHeight - 44;
  const k = Math.min(vw / 1920, vh / 1080);
  stage.style.transform = `scale(${k}) translate(-50%, -50%)`;
}
addEventListener('resize', fit); fit();

const data = await (await fetch('data/city.json')).json();
const city = new City(canvas, data);
const B = data.buildings;
const idxB = B.findIndex((b) => b.bin === '1002192');
const hero = city.hero;

const caps = CAPTIONS.map(([a, b, pos, kick, text]) => {
  const el = h(`<div class="cap ${pos}">${kick ? `<div class="kick">${kick}</div>` : ''}<div class="big">${text}</div></div>`);
  capLayer.appendChild(el);
  const words = splitWords($('.big', el));
  const k = $('.kick', el);
  return { a, b, el, words, k };
});

/* label pool for 3D annotations */
const pool = new Map(); let used = new Set();
function label(key, html, cls, x, y, o = 1) {
  let el = pool.get(key);
  if (!el) { el = h(`<div class="lbl ${cls}"></div>`); labels.appendChild(el); pool.set(key, el); }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  used.add(key);
  el.style.display = o > 0.001 ? '' : 'none';
  el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = o.toFixed(3);
  return el;
}

/* ───────────── scene DOM ───────────── */
const sc = {};
const add = (name, html) => { const el = h(`<div class="scene" id="s-${name}">${html}</div>`); scenes.appendChild(el); sc[name] = el; return el; };

// logo
add('logo', `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%, rgba(5,13,11,.55), rgba(5,13,11,.92) 70%)"></div>
<div class="logo"><div class="name">Bhu<b>Aayam</b></div>
<div class="deva"><span>भू</span> land &nbsp;·&nbsp; <span>आयाम</span> dimension</div>
<div class="tag">The 3D property registry. Every floor, every flat, one verifiable record.</div></div>`);

// problem
add('problem', `
<div class="doc" id="d1" style="left:190px;top:340px"><div class="dt">Sale deed · 2019</div><h3>Flat 801, Lake View</h3>
 <div class="row"><span>Storeys</span><b>G + 8</b></div><div class="row"><span>Carpet area</span><b id="bad1">84.20 m²</b></div><div class="row"><span>Share</span><b>2.08 %</b></div>
 <div class="lines"><i style="width:92%"></i><i style="width:76%"></i><i style="width:84%"></i><i style="width:58%"></i></div><div class="stamp">SUB-<br>REGISTRAR</div></div>
<div class="doc" id="d2" style="left:725px;top:340px"><div class="dt">Sanctioned plan · 2016</div><h3>Lake View Residence</h3>
 <div class="row"><span>Storeys</span><b>G + 8</b></div><div class="row"><span>Carpet area</span><b id="bad2">81.60 m²</b></div><div class="row"><span>Built-up</span><b>118 m²</b></div>
 <div class="lines"><i style="width:88%"></i><i style="width:70%"></i><i style="width:80%"></i><i style="width:64%"></i></div><div class="stamp">PLANNING<br>AUTHORITY</div></div>
<div class="doc" id="d3" style="left:1260px;top:340px"><div class="dt">Drone survey · 2026</div><h3>Observed massing</h3>
 <div class="row"><span>Storeys</span><b id="bad3">G + 9</b></div><div class="row"><span>Roof height</span><b>30.8 m</b></div><div class="row"><span>Footprint</span><b>118 m²</b></div>
 <div class="lines"><i style="width:90%"></i><i style="width:66%"></i><i style="width:82%"></i><i style="width:52%"></i></div><div class="stamp">SURVEY<br>RMSE 0.08</div></div>
<svg id="plinks" class="abs" width="1920" height="1080" style="left:0;top:0"></svg>`);

// upload window
const FILES = [
  ['GEO', '#235347', 'buildings.geojson', '1.1 MB', '107561…0d05ac8e'],
  ['GEO', '#235347', 'roadbed.geojson', '1.8 MB', 'caf05f…e203cf7f'],
  ['LAS', '#8a4b0f', 'lidar-2017.laz', '11.1 MB', '8c565f…962bd2d7'],
  ['TIF', '#245e87', 'ortho-2018.tif', '1.0 MB', 'c95ea0…da8716'],
  ['PDF', '#b42318', 'sale_deed_704.pdf', '41 KB', '40d242…396626c'],
  ['PDF', '#b42318', 'plan_F7.pdf', '104 KB', '2b9e11…c07a4f10'],
  ['CSV', '#157347', 'unit_inventory.csv', '1.3 KB', '5d0c7e…18ab33e2'],
];
add('upload', `<div class="win" id="upwin" style="left:330px;top:330px;width:1260px;height:670px">
 <div class="bar"><div class="dots"><i></i><i></i><i></i></div>Add files <span style="font-weight:500;color:#5b6a72;font-size:17px;margin-left:auto" id="upstat">0 of 7 retained</span></div>
 <div class="drop" id="drop">Drop files or a ZIP · any format</div>
 <div id="frows">${FILES.map(([t, c, n, s]) => `<div class="frow"><div class="ftype" style="background:${c}">${t}</div><div class="fname">${n}</div><div class="fsize">${s}</div><div class="fcol"><div class="fbar">${'<i></i>'.repeat(12)}</div><div class="fseal" style="display:none">🔒 sealed · <span></span></div></div></div>`).join('')}</div></div>`);

// ai: bytes + proposal
const RAW = `{ "type": "FeatureCollection", "features": [{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[-73.997764743691,40.715638733525],[-73.997808748356,40.715567686798],[-73.997822106289,40.715572475966],[-73.997833103182,40.715576419508],[-73.997846712884,40.715554447309] … ]]]},"properties":{"@base_bbl@":"1002010030","@ground_elevation@":"35","@feature_code@":"2100","@height_roof@":"64.17","@bin@":"1002421","@last_edited_date@":"2017-08-22T19:01:06.000Z","@geom_source@":"Photogrammetric","doitt_id":"345"}},{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[-73.99461,40.71951],[-73.99458,40.71946] … ]]]},"properties":{"@base_bbl@":"1002330033","@ground_elevation@":"17","@feature_code@":"2100","@height_roof@":"78.67","@bin@":"1003053", …`;
const rawHtml = RAW.replace(/@(\w+)@/g, '<span class="tok f" data-f="$1">$1</span>').replace(/("[A-Za-z]+")/g, '<span class="tok">$1</span>');
const MAPROWS = [
  ['height_roof', 'height', 'feet → metres · 64.17 → 19.56 m'],
  ['ground_elevation', 'base elevation', 'feet → metres'],
  ['bin', 'building identifier', 'issuer: NYC DOB'],
  ['base_bbl', 'parcel reference', 'borough-block-lot'],
  ['geom_source', 'provenance', 'kept with each value'],
];
add('ai', `<div class="panel bytes" id="bytes"><div style="font:700 15px var(--mono);letter-spacing:.14em;color:var(--muted);margin-bottom:18px">BUILDINGS.GEOJSON · RAW BYTES</div><div id="rawtxt">${rawHtml}</div><div class="scan" id="scan"></div></div>
<div class="panel ai" id="aip"><h4><div class="orb"></div>AI · profiling an unfamiliar source</h4>
 <div class="kv" id="kv">
  <span>Format</span><div>GeoJSON FeatureCollection</div>
  <span>Contents</span><div>1,662 building footprints</div>
  <span>Coordinates</span><div>EPSG:4326 · longitude / latitude</div>
  <span>Split by</span><div><b style="color:var(--violet)">complete feature</b> · 64 per chunk</div>
 </div>
 <div class="map"><div class="t">Field meanings → unified schema</div>
 ${MAPROWS.map(([s, d, n]) => `<div class="mrow"><div class="src">${s}</div><div class="arr"></div><div class="dst"><b>${d}</b><em>${n}</em></div></div>`).join('')}
 </div>
 <div style="position:absolute;left:42px;bottom:34px;display:flex;gap:12px" id="aichips"><span class="chip" style="color:var(--violet);border-color:rgba(162,140,255,.4)">proposal</span><span class="chip">→ reviewed</span><span class="chip" style="color:var(--mint);border-color:rgba(67,224,160,.4)">→ code converts</span></div>
</div>`);

// chunk engine
const N = 26;
const slotX = (i) => 100 + i * ((1720 - 56) / (N - 1));
add('chunks', `
<div class="panel" id="srcbar" style="left:100px;top:300px;width:1720px;height:64px;border-radius:14px;display:flex;align-items:center;padding:0 24px;gap:18px;font:600 18px var(--mono)"><span style="color:var(--mint)">buildings.geojson</span><span style="color:var(--muted)">1.1 MB · 1,662 features · sealed</span></div>
<svg id="cuts" class="abs" width="1920" height="1080" style="left:0;top:0"></svg>
<div class="lane" id="laneAI" style="top:410px"><div class="lt" style="color:var(--violet)"><div class="orb" style="width:18px;height:18px"></div>AI normaliser</div><div class="ls">proposes a mapping · code converts · validated</div></div>
<div class="lane" id="laneML" style="top:590px"><div class="lt" style="color:var(--teal)">◆ ML normaliser</div><div class="ls" id="mlstate">waiting for a qualified model</div></div>
<div class="panel trainer" id="trainer"><h4><span style="color:var(--teal)">◆</span> Training worker</h4><div class="sub">learns field mappings from checked chunks</div>
 <div class="ver"><span class="chip" id="ver">no model yet</span></div>
 <svg width="740" height="150" id="loss"><path id="lossp" fill="none" stroke="#35d3ea" stroke-width="3"/><path id="lossv" fill="none" stroke="#a28cff" stroke-width="2" stroke-dasharray="6 6" opacity=".8"/><line x1="0" y1="149" x2="740" y2="149" stroke="rgba(255,255,255,.12)"/></svg>
 <div class="stat"><div>Checked examples<b id="st1">0</b></div><div>AI calls<b id="st2">0</b></div><div>Chunks by ML<b id="st3">0</b></div></div></div>
<svg id="feeds" class="abs" width="1920" height="1080" style="left:0;top:0"></svg>
<div class="slots-label">Unified schema · ordered publication</div>
<div id="tiles"></div>
<div class="pointer" id="ptr"></div><div class="pointer-l" id="ptrl"></div>`);
const tilesEl = $('#tiles');
const tiles = Array.from({ length: N }, (_, i) => { const el = h(`<div class="tile"><div class="ring"></div><span>${i}</span><div class="badge" style="display:none"></div></div>`); tilesEl.appendChild(el); return el; });
for (let i = 0; i < N; i++) { const el = h(`<div class="abs" style="left:${slotX(i)}px;top:900px;width:56px;height:56px;border-radius:12px;border:1px dashed rgba(255,255,255,.12)"></div>`); tilesEl.prepend(el); }

// simulate the chunk engine (deterministic)
const T0 = 56.2, TP = 67.2;
const sim = (() => {
  const ai = [T0, T0, T0], ml = [TP, TP, TP, TP], out = [];
  for (let i = 0; i < N; i++) {
    const w = ai.indexOf(Math.min(...ai));
    if (ai[w] < TP - 0.3) {
      const start = Math.max(ai[w], T0 + i * 0.14), d = i === 5 ? 7.4 : 3.1;
      out.push({ i, route: 'ai', start, end: start + d, cell: ['ai', w], retry: i === 5 }); ai[w] = start + d + 0.15;
    } else {
      const m = ml.indexOf(Math.min(...ml)); const start = Math.max(ml[m], TP + (i - 10) * 0.05);
      if (i === 19) {
        const ab = start + 0.45; const w2 = ai.indexOf(Math.min(...ai)); const s2 = Math.max(ai[w2], ab + 0.5);
        out.push({ i, route: 'ml', start, abstain: ab, cell: ['ml', m], cell2: ['ai', w2], start2: s2, end: s2 + 2.6 }); ml[m] = ab + 0.05; ai[w2] = s2 + 2.7;
      } else { out.push({ i, route: 'ml', start, end: start + 0.62, cell: ['ml', m] }); ml[m] = start + 0.7; }
    }
  }
  let prev = -1;
  for (const c of out) { c.arrive = c.end + 0.5; c.pub = Math.max(c.arrive, prev + 0.09); prev = c.pub; }
  return out;
})();
const cellXY = ([lane, w]) => lane === 'ai' ? [400 + w * 150, 410 + 64] : [400 + w * 130, 590 + 64];

// studio carousel
const SHOTS = [['24-nyc-done', 'Area map · city layer'], ['12-level-F7', 'Floors and flats'], ['10-deviation', 'Deviation check'], ['18-findings', 'Findings in 3D'], ['19-underground', 'Underground screening'], ['09-register', 'Building register'], ['28-portal-search', 'Public portal']];
add('studio', SHOTS.map(([f, l], i) => `<div class="shot" id="shot${i}"><img src="shots/${f}.jpg"></div><div class="shot-cap" id="shotc${i}">${String(i + 1).padStart(2, '0')} · ${l}</div>`).join(''));

// property card + phone
const qr = (() => {
  const n = 25, r = rng(7); let s = '';
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#16272d"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#f3f8f6"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#16272d"/>`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9); if (!inF && r() > 0.52) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#16272d"/>`; }
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">${s}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
})();
add('card', `<div class="pcard" id="pcard" style="left:250px;top:330px"><div class="brand">BhuAayam<span>Property Card</span></div>${qr}
 <h5>Flat 801, Lake View Residence</h5>
 <div style="margin-bottom:14px"><span class="code"><span>P3</span><span>SK3S1B9468241SB6NAT</span><span>13</span></span></div>
 <div class="r"><span>Parcel ULPIN</span><b>MH2507A1B3C4D5</b></div>
 <div class="r"><span>Level</span><b>F8 · 230.8 – 233.8 m</b></div>
 <div class="r"><span>Carpet area</span><b>66.29 m² · share 2.08 %</b></div>
 <div class="foot"><span>Technical record, not a title document</span><span>r3 · f35c…5c01</span></div></div>
<div class="scan" id="qrscan" style="left:1020px;width:0"></div>
<div class="phone" id="phone" style="left:1250px;top:190px"><div class="scr"><div style="font-weight:800;font-size:20px;text-align:center">BhuAayam · Verify</div>
 <div class="ok" id="okc"><svg width="46" height="46" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
 <h6>Valid · revision r3</h6><div class="sm">Flat 801, Lake View Residence</div>
 <div class="chain" id="chain"><div><i></i>r3 · code assigned · f35c…5c01</div><div><i></i>r2 · reviewed details · 9a0e…71b2</div><div><i></i>r1 · draft from sources · 44d1…e09c</div><div style="color:#157347"><i></i>chain consistent</div></div></div></div>`);

// register + exports
const REG = [['F8', [['Flat 801', 'P3-SK3S…-13', '66.29', '2.08', 'A. Kulkarni · HVL-2/4381/2019', 'Owner-occupied'], ['Flat 802', 'P3-7QWD…-41', '66.29', '2.08', 'R. & S. Deshpande', 'Rented · 1 tenant'], ['Flat 803', 'P3-M2KF…-08', '58.74', '1.84', 'N. Iyer', 'Owner-occupied']]],
  ['F7', [['Flat 701', 'P3-C9HX…-22', '66.29', '2.08', 'P. Joshi', 'Owner-occupied'], ['Flat 702', 'P3-BQBT…-46', 'Unknown', 'Unknown', 'Not recorded', 'Unknown'], ['Flat 704', 'P3-4TRN…-19', '72.10', '2.26', 'S. Patil · HVL-2/1127/2021', 'Rented · 2 tenants']]],
  ['F6', [['Flat 601', 'P3-X8LA…-30', '66.29', '2.08', 'M. Gokhale', 'Vacant']]]];
add('register', `<div class="win reg" id="regwin"><div class="bar"><div class="dots"><i></i><i></i><i></i></div>Lake View Residence · Building register <span style="margin-left:auto;font:600 15px var(--mono);color:#5b6a72">G + 8 · 43 units · extract 28 Sep 2026</span></div>
<table><thead><tr><th>Unit</th><th>3D ULPIN</th><th>Carpet m²</th><th>Share %</th><th>Registered owner</th><th>Occupancy</th></tr></thead><tbody>
${REG.map(([f, rows]) => `<tr class="rr"><td class="fl" colspan="6">FLOOR ${f}</td></tr>` + rows.map((r) => `<tr class="rr">${r.map((c, j) => `<td class="${j === 1 || j === 2 || j === 3 ? 'm' : ''}" style="${c === 'Unknown' || c === 'Not recorded' ? 'color:#8a9aa0;font-style:italic' : ''}">${c}</td>`).join('')}</tr>`).join('')).join('')}
</tbody></table></div>
${[['PDF', '#b42318', 'Building register', 'printable · per floor'], ['ZIP', '#235347', 'Data package', 'JSON · CSV · Excel · manifest'], ['XLS', '#157347', 'Register workbook', 'six joined sheets'], ['{ }', '#245e87', 'Consolidated registry', 'building-registry-summary/1'], ['3D', '#8e44ad', 'CityJSON 2.0', 'geometry + semantics'], ['#', '#8a4b0f', 'Manifest', 'SHA-256 per file']].map(([ic, c, t, s], i) => `<div class="panel exp" id="ex${i}" style="left:1260px;top:${300 + i * 110}px"><div class="ic" style="background:${c}">${ic}</div><div><b>${t}</b><small>${s}</small></div></div>`).join('')}`);

// proposal
const PILLARS = [
  ['01', 'A 3D ULPIN for every unit', 'Extends the parcel ULPIN upward: floors, flats and shared spaces get an identity of their own.'],
  ['02', 'Adaptive ingestion', 'Any format in. AI proposes the split and the mapping; code converts and validates.'],
  ['03', 'Learns as it works', 'Checked results train ML in the background, so AI calls fall as coverage grows.'],
  ['04', 'Evidence on every fact', 'Each value cites its source, revision and hash. Unknown stays unknown.'],
  ['05', 'Checks that find conflicts', 'Deviations, overlaps and underground clashes, measured in 3D before anything is recorded.'],
  ['06', 'Officer and citizen', 'Studio for officers; a portal, requests and QR verification for citizens.'],
];
add('propose', `<div style="position:absolute;inset:0;background:rgba(5,13,11,.72)"></div>
${PILLARS.map(([n, t, p], i) => `<div class="panel pillar" id="pl${i}" style="left:${110 + (i % 3) * 580}px;top:${340 + Math.floor(i / 3) * 300}px"><div class="n">${n}</div><h4>${t}</h4><p>${p}</p></div>`).join('')}
${['LADM', 'CityGML', 'CityJSON 2.0', '3D Tiles', 'ULPIN'].map((s, i) => `<div class="std" id="sd${i}" style="left:${110 + i * 250}px;top:960px">${s}</div>`).join('')}
<div class="ipg" id="ipg" style="top:430px">Identify<i>→</i>Prove<i>→</i>Govern</div>`);

// end card
add('end', `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%, rgba(5,13,11,.6), rgba(5,13,11,.95) 70%)"></div>
<div class="logo" style="top:320px"><div class="name">Bhu<b>Aayam</b></div><div class="tag" style="margin-top:34px">Every floor. Every flat. One verifiable record.</div>
<div style="margin-top:70px;font:600 18px var(--mono);letter-spacing:.2em;color:var(--muted);text-transform:uppercase">Identify · Prove · Govern</div>
<div style="margin-top:18px;font:600 16px var(--mono);letter-spacing:.2em;color:#5d7870;text-transform:uppercase">Smart India Hackathon · Grand Finale</div></div>`);

// map HUDs
add('hud', `<div class="hud-search" id="search"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="#5b6a72" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="#5b6a72" stroke-width="2"/></svg><span class="q" id="q"></span><span class="cur" id="cur"></span></div>
<div class="panel hud-stream" id="streamhud"><div style="font:700 15px var(--mono);letter-spacing:.14em;color:var(--mint);margin-bottom:10px">● STREAMING</div>
<div class="row"><span>Chunk</span><b id="h1">0 / 26</b></div><div class="row"><span>Buildings on the map</span><b id="h2">0</b></div><div class="row"><span>Published in order</span><b id="h3">0–0</b></div><div class="pb"><i id="h4"></i></div></div>
<div class="card3d" id="cardB"></div><div class="card3d" id="cardH"></div>`);
const bCard = (b, title) => `<div class="k">Building · official footprint</div><h5>${title}</h5>
<div class="r"><span>Roof height</span><b>${(+b.hf * 0.3048).toFixed(1)} m · ${(+b.hf).toFixed(0)} ft</b></div>
<div class="r"><span>Parcel (BBL)</span><b>${b.bbl}</b></div>
<div class="r"><span>Footprint</span><b>${fmt(b.a)} m²</b></div>
<div class="r"><span>Source</span><b>NYC OTI · ${b.src}</b></div>`;
$('#cardB').innerHTML = bCard(B[idxB], `BIN ${B[idxB].bin}`);
$('#cardH').innerHTML = bCard(B[hero], `BIN ${B[hero].bin}`) + `<div class="r"><span>Floors</span><b>G + 13 · 14 levels</b></div>`;

/* ───────────── per-scene update ───────────── */
const on = (t, [a, b]) => t >= a && t < b;
const fadeIO = (t, [a, b], din = 0.5, dout = 0.5) => inout(t, a, b, din, dout);

function updLogo(t) {
  const el = sc.logo; const r = [8.9, 14.2]; show(el, on(t, r)); if (!on(t, r)) return;
  const o = fadeIO(t, r, 0.8, 0.7); el.style.opacity = o;
  const name = $('.name', el), deva = $('.deva', el), tag = $('.tag', el);
  const p1 = P(t, 9.1, 10.4, E.outExpo);
  css(name, { opacity: p1, transform: `scale(${lerp(1.18, 1, p1)})`, letterSpacing: `${lerp(0.08, -0.045, p1)}em`, filter: `blur(${(1 - p1) * 14}px)` });
  const p2 = P(t, 10.1, 11.0, E.outCubic); css(deva, { opacity: p2, transform: `translateY(${(1 - p2) * 20}px)` });
  const p3 = P(t, 10.8, 11.8, E.outCubic); css(tag, { opacity: p3, transform: `translateY(${(1 - p3) * 20}px)` });
}

function updProblem(t) {
  const el = sc.problem; show(el, on(t, S.problem)); if (!on(t, S.problem)) return;
  el.style.opacity = fadeIO(t, S.problem, 0.3, 0.6);
  ['#d1', '#d2', '#d3'].forEach((id, i) => {
    const d = $(id, el); const p = P(t, 15.0 + i * 0.35, 16.3 + i * 0.35, E.outExpo);
    const drift = Math.sin((t - 14) * 0.6 + i) * 6;
    css(d, { opacity: p, transform: `translateY(${(1 - p) * 160 + drift}px) rotate(${(1 - p) * (i - 1) * 8 + (i - 1) * 1.5}deg)` });
  });
  const pb = P(t, 17.6, 18.2, E.outCubic);
  for (const id of ['#bad1', '#bad2', '#bad3']) { const b = $(id, el); b.classList.toggle('bad', pb > 0); b.style.setProperty('--o', pb); }
  // links between conflicting values
  const pl = P(t, 18.0, 19.0, E.inOutCubic);
  const blink = 0.55 + 0.45 * Math.sin((t - 18) * 6);
  $('#plinks', el).innerHTML = pl > 0 ? `<path d="M${190 + 400} 520 C 700 470, 760 470, ${725 + 330} 520" stroke="#ff5f57" stroke-width="3" fill="none" stroke-dasharray="${900 * pl} 900" opacity="${blink}"/>
    <path d="M${725 + 400} 520 C 1250 440, 1330 440, ${1260 + 330} 462" stroke="#ff5f57" stroke-width="3" fill="none" stroke-dasharray="${900 * pl} 900" opacity="${blink}"/>` : '';
  // push back for the second caption
  const pz = P(t, 19.8, 21.0, E.inOutCubic);
  el.style.transform = `scale(${lerp(1, 0.92, pz)}) translateY(${pz * 30}px)`;
  el.style.filter = `saturate(${lerp(1, 0.5, pz)})`;
}

function updUpload(t) {
  const el = sc.upload; show(el, on(t, S.upload)); if (!on(t, S.upload)) return;
  el.style.opacity = fadeIO(t, S.upload, 0.4, 0.5);
  const w = $('#upwin', el); const pw = P(t, 26.1, 27.0, E.outExpo);
  css(w, { transform: `translateY(${(1 - pw) * 80}px) scale(${lerp(0.94, 1, pw)})`, opacity: pw });
  const rows = $$('.frow', el); let sealed = 0;
  rows.forEach((r, i) => {
    const a = 27.2 + i * 0.32; const p = P(t, a, a + 0.5, E.outBack);
    css(r, { opacity: P(t, a, a + 0.25), transform: `translateX(${(1 - p) * -60}px)` });
    const up = P(t, a + 0.4, a + 2.6 + i * 0.15, E.inOutSine);
    $$('.fbar i', r).forEach((seg, k) => seg.classList.toggle('on', up * 12 > k));
    const done = t > a + 2.8 + i * 0.15 + 1.2;
    const seal = $('.fseal', r), bar = $('.fbar', r);
    if (done) { sealed++; show(seal, true, 'flex'); show(bar, false); $('span', seal).textContent = FILES[i][4]; seal.style.opacity = P(t, a + 4 + i * 0.15, a + 4.4 + i * 0.15); }
    else { show(seal, false); show(bar, true, 'flex'); }
  });
  $('#upstat', el).textContent = `${sealed} of 7 retained · original bytes unchanged`;
  const dz = $('#drop', el); const pulse = P(t, 26.8, 27.2) * (1 - P(t, 29.2, 29.6));
  dz.style.borderColor = pulse > 0.5 ? '#43e0a0' : '#c6d3d7'; dz.style.background = pulse > 0.5 ? '#effaf5' : 'transparent';
}

function updAI(t) {
  const el = sc.ai; show(el, on(t, S.ai)); if (!on(t, S.ai)) return;
  el.style.opacity = fadeIO(t, S.ai, 0.4, 0.5);
  const b = $('#bytes', el), a = $('#aip', el);
  const pb = P(t, 37.1, 38.0, E.outExpo), pa = P(t, 38.4, 39.4, E.outExpo);
  css(b, { opacity: pb, transform: `translateX(${(1 - pb) * -80}px)` });
  css(a, { opacity: pa, transform: `translateX(${(1 - pa) * 80}px)` });
  // scanning beam
  const sy = lerp(-90, 760, P(t, 39.0, 45.5, E.inOutSine)); const scan = $('#scan', el);
  scan.style.top = `${sy}px`; scan.style.opacity = P(t, 38.8, 39.2) * (1 - P(t, 45.3, 45.8));
  // raw text drifts upward slowly
  $('#rawtxt', el).style.transform = `translateY(${-(t - 37) * 5}px)`;
  const fields = $$('.tok.f', el);
  const rawRect = 170 + 34; // top of text area
  fields.forEach((f) => {
    const fy = f.offsetTop - (t - 37) * 5 + 50;
    const hit = sy + 80 > fy && t < 49.5;
    const map = MAPROWS.findIndex((m) => m[0] === f.dataset.f) >= 0;
    f.style.background = hit ? (map ? 'rgba(162,140,255,.35)' : 'rgba(255,255,255,.12)') : 'transparent';
    f.style.color = hit ? '#fff' : '';
  });
  // proposal content
  const kv = $$('#kv > *', el);
  kv.forEach((k, i) => { const p = P(t, 40.0 + Math.floor(i / 2) * 0.55, 40.5 + Math.floor(i / 2) * 0.55, E.outCubic); css(k, { opacity: p, transform: `translateY(${(1 - p) * 12}px)` }); });
  $$('.mrow', el).forEach((r, i) => {
    const s = 43.4 + i * 0.7;
    const p1 = P(t, s, s + 0.4, E.outCubic), p2 = P(t, s + 0.3, s + 0.7, E.inOutCubic), p3 = P(t, s + 0.6, s + 1.0, E.outCubic);
    css($('.src', r), { opacity: p1 }); css($('.arr', r), { transform: `scaleX(${p2})` }); css($('.dst', r), { opacity: p3, transform: `translateX(${(1 - p3) * 16}px)` });
  });
  $$('#aichips .chip', el).forEach((c, i) => { const p = P(t, 48.4 + i * 0.5, 48.9 + i * 0.5, E.outBack); css(c, { opacity: p, transform: `scale(${lerp(0.8, 1, p)})` }); });
  $('.orb', a).style.transform = `scale(${1 + 0.12 * Math.sin(t * 5)})`;
}

function updChunks(t) {
  const el = sc.chunks; show(el, on(t, S.chunks)); if (!on(t, S.chunks)) return;
  el.style.opacity = fadeIO(t, S.chunks, 0.4, 0.5);
  const bar = $('#srcbar', el);
  const pb = P(t, 53.3, 54.0, E.outExpo); const pdis = P(t, 55.0, 55.6);
  css(bar, { opacity: pb * (1 - pdis), transform: `scaleX(${lerp(0.6, 1, pb)})`, transformOrigin: 'left' });
  // cut lines sweeping across the bar
  const pc = P(t, 54.1, 55.1, E.inOutCubic); let cuts = '';
  if (pc > 0 && pdis < 1) for (let i = 1; i < N; i++) { const x = slotX(i) - 5; if ((x - 100) / 1720 < pc) cuts += `<line x1="${x}" y1="290" x2="${x}" y2="374" stroke="#43e0a0" stroke-width="2" opacity="${1 - pdis}"/>`; }
  $('#cuts', el).innerHTML = cuts;
  for (const [id, top] of [['#laneAI', 0], ['#laneML', 1]]) { const p = P(t, 54.4 + top * 0.25, 55.2 + top * 0.25, E.outExpo); css($(id, el), { opacity: p, transform: `translateX(${(1 - p) * -40}px)` }); }
  const ptr = P(t, 55.0, 55.8, E.outExpo); css($('#trainer', el), { opacity: ptr, transform: `translateX(${(1 - ptr) * 60}px)` });
  const mlOn = t >= TP; $('#laneML', el).style.borderColor = mlOn ? 'rgba(53,211,234,.6)' : ''; $('#laneML', el).style.opacity = P(t, 54.65, 55.45, E.outExpo) * (mlOn ? 1 : 0.55);
  $('#mlstate', el).textContent = mlOn ? 'model v2 · promoted · abstains when unsure' : 'waiting for a qualified model';
  // tiles
  let published = 0, aiCalls = 0, byML = 0, examples = 0; let feeds = '';
  sim.forEach((c) => {
    const tile = tiles[c.i]; const x0 = slotX(c.i), y0 = 304, xs = slotX(c.i), ys = 900;
    const appear = P(t, 55.0 + c.i * 0.025, 55.5 + c.i * 0.025, E.outBack);
    let x = x0, y = y0, st = 'pending', prog = 0, badge = '';
    const [cx, cy] = cellXY(c.cell);
    if (t >= c.start - 0.5 && t < c.start) { const p = P(t, c.start - 0.5, c.start, E.inOutCubic); x = lerp(x0, cx, p); y = lerp(y0, cy, p) - Math.sin(p * Math.PI) * 30; st = 'moving'; }
    else if (t >= c.start && t < (c.abstain ?? c.end)) { x = cx; y = cy; st = c.route; prog = (t - c.start) / ((c.abstain ?? c.end) - c.start); if (c.retry && prog > 0.4) { badge = 'retry · smaller batch'; } }
    if (c.abstain !== undefined && t >= c.abstain) {
      const [x2, y2] = cellXY(c.cell2);
      if (t < c.start2) { const p = P(t, c.abstain, c.start2, E.inOutCubic); x = lerp(cx, x2, p); y = lerp(cy, y2, p); st = 'moving'; badge = 'ML unsure → AI'; }
      else if (t < c.end) { x = x2; y = y2; st = 'ai'; prog = (t - c.start2) / (c.end - c.start2); badge = prog < 0.4 ? 'ML unsure → AI' : ''; }
    }
    const [ex, ey] = c.cell2 ? cellXY(c.cell2) : [cx, cy];
    if (t >= c.end && t < c.arrive) { const p = P(t, c.end, c.arrive, E.inOutCubic); x = lerp(ex, xs, p); y = lerp(ey, ys, p); st = 'done'; }
    else if (t >= c.arrive) { x = xs; y = ys; st = t >= c.pub ? 'pub' : 'wait'; }
    if (t >= c.pub) published = c.i + 1;
    if (t >= c.start && (c.route === 'ai')) aiCalls++;
    if (c.cell2 && t >= c.start2) aiCalls++;
    if (c.route === 'ml' && !c.cell2 && t >= c.end) byML++;
    if (c.route === 'ai' && t >= c.end) examples += 64;
    // feed dots AI → trainer
    if (c.route === 'ai' && t >= c.end && t < c.end + 0.9) { const p = P(t, c.end, c.end + 0.9, E.inOutSine); const fx = lerp(ex + 28, 1010, p), fy = lerp(ey + 28, 540, p) - Math.sin(p * Math.PI) * 60; feeds += `<circle cx="${fx}" cy="${fy}" r="6" fill="#a28cff"/><circle cx="${fx}" cy="${fy}" r="14" fill="#a28cff" opacity=".2"/>`; }
    const colors = { pending: ['transparent', 'rgba(255,255,255,.22)', '#cfe0da'], moving: ['rgba(255,255,255,.08)', 'rgba(255,255,255,.5)', '#fff'], ai: ['rgba(162,140,255,.22)', '#a28cff', '#fff'], ml: ['rgba(53,211,234,.2)', '#35d3ea', '#fff'], done: ['rgba(255,255,255,.85)', '#fff', '#0b1916'], wait: ['rgba(255,255,255,.1)', '#fbbd2e', '#fbbd2e'], pub: ['#43e0a0', '#43e0a0', '#05281b'] };
    const [bg, bd, fg] = colors[st];
    const pulse = st === 'pub' ? P(t, c.pub, c.pub + 0.35) : 1;
    css(tile, { left: `${x}px`, top: `${y}px`, background: bg, borderColor: bd, color: fg, opacity: appear, transform: `scale(${appear * (st === 'pub' ? lerp(1.25, 1, pulse) : 1)})`, boxShadow: st === 'pub' && pulse < 1 ? `0 0 ${30 * (1 - pulse)}px #43e0a0` : 'none' });
    const ring = $('.ring', tile);
    ring.style.background = (st === 'ai' || st === 'ml') ? `conic-gradient(${st === 'ai' ? '#a28cff' : '#35d3ea'} ${prog * 360}deg, transparent 0)` : 'none';
    ring.style.webkitMask = 'radial-gradient(circle, transparent 60%, #000 62%)';
    ring.style.opacity = 0.9; ring.style.zIndex = -1;
    const bdg = $('.badge', tile); show(bdg, !!badge); if (badge) { bdg.textContent = badge; css(bdg, { background: badge.startsWith('retry') ? '#fbbd2e' : '#35d3ea', color: '#05281b' }); }
  });
  if (t >= TP) feeds += `<path d="M1010 690 C 985 700, 990 660, 962 665" stroke="#35d3ea" stroke-width="3" fill="none" stroke-dasharray="8 8" stroke-dashoffset="${-t * 40}" opacity="${P(t, TP, TP + 0.5)}"/>`;
  $('#feeds', el).innerHTML = feeds;
  $('#st1', el).textContent = fmt(examples); $('#st2', el).textContent = aiCalls; $('#st3', el).textContent = byML;
  const ver = $('#ver', el);
  if (t < T0 + 4.2) { ver.textContent = 'no model yet'; css(ver, { color: '', borderColor: '' }); }
  else if (t < TP) { ver.textContent = 'v1 · shadow · evaluating'; css(ver, { color: '#fbbd2e', borderColor: 'rgba(251,189,46,.5)' }); }
  else { ver.textContent = 'v2 · promoted'; css(ver, { color: '#35d3ea', borderColor: 'rgba(53,211,234,.6)' }); }
  // loss curves
  const lp = P(t, T0 + 2.8, TP + 5, E.linear); const r = rng(3); let d = '', dv = '';
  const n = 80;
  for (let k = 0; k <= n * lp; k++) {
    const x = (k / n) * 740; const base = Math.exp(-k / 18);
    const y = 145 - (1 - (0.08 + 0.9 * base + (r() - 0.5) * 0.06 * base)) * 135;
    const yv = 145 - (1 - (0.14 + 0.84 * Math.exp(-k / 22) + (r() - 0.5) * 0.04)) * 135;
    d += `${k ? 'L' : 'M'}${x.toFixed(1)} ${(150 - y).toFixed(1)}`; dv += `${k ? 'L' : 'M'}${x.toFixed(1)} ${(150 - yv).toFixed(1)}`;
  }
  $('#lossp', el).setAttribute('d', d); $('#lossv', el).setAttribute('d', dv);
  // pointer
  const px = slotX(Math.min(published, N - 1)) + 28 - 12; const ptrEl = $('#ptr', el), pl = $('#ptrl', el);
  const pOn = P(t, 55.6, 56.2);
  css(ptrEl, { left: `${px}px`, opacity: pOn }); css(pl, { left: `${px + 12}px`, opacity: pOn });
  const waitingFor = sim.find((c) => t < c.pub);
  pl.textContent = published >= N ? 'all 26 published' : published > 0 ? `published 0–${published - 1} · waiting for ${waitingFor?.i}` : 'next: chunk 0';
}

let lastStudio = -1;
function updStudio(t) {
  const el = sc.studio; show(el, on(t, S.studio)); if (!on(t, S.studio)) return;
  el.style.opacity = fadeIO(t, S.studio, 0.4, 0.5);
  const t0 = 144.2, per = 1.8;
  SHOTS.forEach((_, i) => {
    const s = $(`#shot${i}`, el), c = $(`#shotc${i}`, el);
    const u = (t - t0 - i * per) / per; // 0 = centred
    const p = clamp(u, -1.2, 1.2);
    const x = -p * 1150, rot = p * -28, sc_ = 0.6 - Math.abs(p) * 0.12, z = Math.abs(p);
    const eased = Math.sign(u) * E.inOutCubic(clamp(Math.abs(u)));
    const x2 = -eased * 1150;
    css(s, { left: '0px', top: '0px', transform: `translate(${x2}px, ${30}px) perspective(2400px) rotateY(${-eased * 30}deg) scale(${0.6 - Math.abs(eased) * 0.1})`, opacity: clamp(1.3 - Math.abs(u)), zIndex: 10 - Math.round(z * 5) });
    const co = clamp(1 - Math.abs(u) * 2.2);
    css(c, { left: '0px', right: '0px', width: '1920px', textAlign: 'center', top: '900px', opacity: co, color: 'var(--mint)' });
  });
}

function updCard(t) {
  const el = sc.card; show(el, on(t, S.card)); if (!on(t, S.card)) return;
  el.style.opacity = fadeIO(t, S.card, 0.4, 0.5);
  const pc = $('#pcard', el); const p = P(t, 157.2, 158.6, E.outExpo);
  const float = Math.sin((t - 157) * 1.2) * 8;
  css(pc, { opacity: P(t, 157.2, 157.6), transform: `perspective(1800px) rotateY(${(1 - p) * -70 + Math.sin((t - 157) * 0.8) * 4}deg) rotateX(${(1 - p) * 20 + 4}deg) translateY(${float}px)` });
  const ph = $('#phone', el); const pp = P(t, 159.6, 160.8, E.outExpo);
  css(ph, { opacity: pp, transform: `translateY(${(1 - pp) * 300 + Math.sin((t - 157) * 1.1 + 1) * 8}px) rotate(${(1 - pp) * 10 + 3}deg)` });
  // scan beam from QR to phone
  const sb = $('#qrscan', el); const ps = P(t, 160.8, 161.6, E.inOutCubic) * (1 - P(t, 161.9, 162.3));
  css(sb, { left: '800px', top: '360px', width: `${ps * 460}px`, height: '160px', opacity: ps, background: 'linear-gradient(90deg, rgba(67,224,160,.0), rgba(67,224,160,.35))', transform: 'skewY(-6deg)' });
  const ok = $('#okc', el); const po = P(t, 161.9, 162.5, E.outBack); css(ok, { transform: `scale(${po})` });
  $$('.scr h6, .scr .sm', el).forEach((x) => { x.style.opacity = P(t, 162.2, 162.6); });
  $$('#chain div', el).forEach((d, i) => { const q = P(t, 162.7 + i * 0.4, 163.1 + i * 0.4, E.outCubic); css(d, { opacity: q, transform: `translateX(${(1 - q) * 20}px)` }); });
}

function updRegister(t) {
  const el = sc.register; show(el, on(t, S.register)); if (!on(t, S.register)) return;
  el.style.opacity = fadeIO(t, S.register, 0.4, 0.5);
  const w = $('#regwin', el); const p = P(t, 166.1, 167.0, E.outExpo);
  css(w, { opacity: p, transform: `translateY(${(1 - p) * 60}px)` });
  $$('.rr', el).forEach((r, i) => { const q = P(t, 166.8 + i * 0.12, 167.2 + i * 0.12, E.outCubic); css(r, { opacity: q, transform: `translateX(${(1 - q) * -20}px)` }); });
  for (let i = 0; i < 6; i++) { const e = $(`#ex${i}`, el); const q = P(t, 170.9 + i * 0.28, 171.5 + i * 0.28, E.outBack); css(e, { opacity: P(t, 170.9 + i * 0.28, 171.2 + i * 0.28), transform: `translateX(${(1 - q) * 80}px) scale(${lerp(0.9, 1, q)})` }); }
}

function updPropose(t) {
  const el = sc.propose; show(el, on(t, S.propose)); if (!on(t, S.propose)) return;
  el.style.opacity = fadeIO(t, S.propose, 0.5, 0.5);
  const out = P(t, 183.2, 183.8, E.inCubic);
  PILLARS.forEach((_, i) => { const q = P(t, 176.0 + i * 0.4, 176.8 + i * 0.4, E.outExpo); css($(`#pl${i}`, el), { opacity: q * (1 - out), transform: `translateY(${(1 - q) * 60 - out * 30}px)` }); });
  for (let i = 0; i < 5; i++) { const q = P(t, 179.2 + i * 0.2, 179.7 + i * 0.2, E.outBack); css($(`#sd${i}`, el), { opacity: q * (1 - out), transform: `scale(${lerp(0.8, 1, q)})` }); }
  const ipg = $('#ipg', el); const words = ['Identify', 'Prove', 'Govern'];
  const pi = P(t, 183.8, 185.0, E.outExpo);
  css(ipg, { opacity: pi * (1 - P(t, 187.4, 188.1)), transform: `scale(${lerp(1.2, 1, pi)})`, letterSpacing: `${lerp(0.04, -0.04, pi)}em`, filter: `blur(${(1 - pi) * 12}px)` });
}

function updEnd(t) {
  const el = sc.end; show(el, on(t, S.end)); if (!on(t, S.end)) return;
  el.style.opacity = P(t, 188.0, 188.8);
  const name = $('.name', el); const p = P(t, 188.3, 189.6, E.outExpo);
  css(name, { opacity: p, transform: `scale(${lerp(0.9, 1, p)})`, filter: `blur(${(1 - p) * 12}px)` });
  $$('.logo > div:not(.name)', el).forEach((d, i) => { const q = P(t, 189.3 + i * 0.4, 190.0 + i * 0.4, E.outCubic); css(d, { opacity: q, transform: `translateY(${(1 - q) * 16}px)` }); });
}

/* ───────────── 3D world ───────────── */
const mix3 = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
const C0 = [144, 0, 24]; // city centre relative to hero (three coords)
const orbit = (c, r, y, ang) => [c[0] + r * Math.cos(ang), y, c[2] + r * Math.sin(ang)];
const cB = (() => { const [x, n] = city.centerOf(idxB); return [x, 0, -n]; })();

function streamCam(t) {
  const u = P(t, 77.8, 92, E.linear);
  const ang = lerp(0.55, 1.05, E.inOutSine(u));
  return { p: orbit([100, 0, -30], lerp(1350, 950, E.inOutSine(u)), lerp(760, 460, E.inOutSine(u)), ang), q: [lerp(120, 40, u), 0, lerp(-40, -10, u)] };
}
function flight(t, a, b, from, to, arc = 140) {
  const p = P(t, a, b, E.inOutCubic);
  const pos = mix3(from.p, to.p, p); pos[1] += Math.sin(Math.PI * p) * arc;
  return { p: pos, q: mix3(from.q, to.q, p) };
}
const heroCam = (ang, r, y, qy) => ({ p: orbit([0, 0, 0], r, y, ang), q: [0, qy, 0] });
const bPose = (ang) => ({ p: orbit(cB, 330, 210, ang), q: [cB[0], 75, cB[2]] });
const hPose = (ang) => heroCam(ang, 250, 170, 22);

function world(t) {
  const u = city.uni;
  const active = (t >= 3.0 && t < 14.2) || (t >= 77.8 && t < 143.4) || (t >= 174.6);
  canvas.style.display = active ? '' : 'none';
  $('#vignette').style.display = active ? '' : 'none';
  if (!active) return false;
  // defaults
  u.uReveal.value = 1.05; u.uFlat.value = 1; u.uGhost.value = 0; u.uHideSel.value = 0; u.uSel.value = hero; u.uHi1.value = -1; u.uHi2.value = -1; u.uEdge.value = 0.28; u.uWarm.value = 0;
  u.uFogNear.value = 900; u.uFogFar.value = 2600;
  city.cityMat.depthWrite = true; city.heroG.visible = false; city.under.visible = false; city.setGround(1);
  let cam; let cOp = 1;
  if (t >= 174.6) {
    setHideUnrevealed(0);
    cOp = P(t, 174.6, 175.4) * (1 - P(t, 195.2, 196));
    const d = t - 174.6;
    cam = { p: orbit(C0, 1500, 760, 2.2 + d * 0.03), q: [120, 0, 0] };
    u.uFogNear.value = 1400; u.uFogFar.value = 3600;
  } else if (t < 14.2) {
    cOp = P(t, 3.0, 3.8) * (1 - P(t, 13.4, 14.2));
    u.uReveal.value = P(t, 4.4, 8.9, E.inOutSine) * 1.05;
    u.uEdge.value = lerp(0.75, 0.3, P(t, 5, 8.5));
    setHideUnrevealed(0);
    const a0 = Math.atan2(1080 - C0[2], 1100 - C0[0]); const r = Math.hypot(1080 - C0[2], 1100 - C0[0]);
    const endP = orbit(C0, r, 640, a0);
    const pm = P(t, 3.4, 9.6, E.inOutCubic);
    if (t < 9.6) cam = { p: mix3([144, 2300, 25], endP, pm), q: mix3(C0, [60, 30, -40], pm) };
    else cam = { p: orbit(C0, r, 640 - (t - 9.6) * 10, a0 + (t - 9.6) * 0.04), q: [60, 30, -40] };
    city.setGround(lerp(0.35, 1, P(t, 5, 9)));
    u.uFogNear.value = 1400; u.uFogFar.value = 3400;
  } else if (t < 92) {
    cOp = P(t, 77.8, 78.4);
    setHideUnrevealed(1);
    u.uReveal.value = P(t, 79.0, 90.6, E.inOutSine) * 1.05;
    city.setGround(P(t, 77.9, 79.2));
    cam = streamCam(t);
  } else if (t < 108) {
    setHideUnrevealed(0);
    const s0 = streamCam(92), b0 = bPose(0.7), b1 = bPose(1.0), h0 = hPose(3.95), h1 = hPose(4.2);
    if (t < 95.6) cam = { p: mix3(s0.p, streamCam(92).p, 0), q: s0.q };
    if (t >= 92 && t < 95.6) { const d = P(t, 92, 95.6); cam = { p: orbit([100, 0, -30], lerp(950, 900, d), lerp(460, 450, d), 1.05 + d * 0.04), q: s0.q }; }
    const s1 = { p: orbit([100, 0, -30], 900, 450, 1.09), q: s0.q };
    if (t >= 95.6 && t < 98.4) cam = flight(t, 95.6, 98.4, s1, b0, 220);
    if (t >= 98.4 && t < 101.6) { const d = P(t, 98.4, 101.6, E.linear); cam = bPose(lerp(0.7, 1.0, d)); }
    if (t >= 101.6 && t < 104.6) cam = flight(t, 101.6, 104.6, b1, h0, 320);
    if (t >= 104.6) { const d = P(t, 104.6, 108); cam = hPose(lerp(3.95, 4.2, d)); }
    u.uHi1.value = t >= 96.8 && t < 101.8 ? idxB : t >= 103.6 ? hero : -1;
  } else if (t < 122) {
    // floors and flats
    const g = P(t, 108.2, 109.6, E.inOutCubic);
    u.uGhost.value = g; u.uHideSel.value = g > 0.01 ? 1 : 0; city.cityMat.depthWrite = g < 0.5;
    city.heroG.visible = g > 0.01;
    const ex = P(t, 110.0, 112.6, E.inOutCubic) * (1 - P(t, 121.0, 122.2, E.inOutCubic) * 0.0);
    const flat = P(t, 114.6, 115.6, E.outCubic);
    heroFloors(ex, flat, g, t);
    const d = P(t, 108, 122, E.linear);
    const fy = city.flatFloor * city.floorH + city.flatFloor * 3.2 * ex;
    const qy = lerp(lerp(22, 56, ex), fy, P(t, 114.4, 116.4, E.inOutCubic));
    const rr = lerp(lerp(250, 235, P(t, 108, 110.5, E.inOutCubic)), 135, P(t, 114.4, 116.8, E.inOutCubic));
    cam = heroCam(lerp(4.2, 4.8, E.inOutSine(d)), rr, lerp(170, qy + 45, P(t, 108, 116, E.inOutCubic)), qy);
    floorLabels(t, ex, flat);
  } else if (t < 134) {
    u.uGhost.value = 1; u.uHideSel.value = 1; city.cityMat.depthWrite = false; city.heroG.visible = true;
    const back = 1 - P(t, 122.0, 123.4, E.inOutCubic);
    const ex2 = P(t, 128.2, 129.6, E.inOutCubic) * 1.4;
    const ex = Math.max(back, ex2);
    heroFloors(ex, back * (1 - P(t, 122, 122.6)), 1, t);
    const dv = P(t, 123.6, 124.4, E.outCubic) * (1 - P(t, 127.8, 128.4));
    const pulse = 0.75 + 0.25 * Math.sin(t * 5);
    city.extra.material.opacity = 0.55 * dv * pulse; city.extraEdge.material.opacity = dv;
    const ov = P(t, 129.4, 130.2, E.outCubic);
    city.overlap.material.opacity = 0.85 * ov * pulse; city.overlapEdge.material.opacity = ov;
    const top = city.heroH + city.floorH;
    const camA = heroCam(4.8, 125, top + 40, top - 4), camB = heroCam(5.3, 205, 135, 44);
    cam = t < 128 ? (t < 123.6 ? flight(t, 122, 123.6, heroCam(4.8, 125, city.flatFloor * city.floorH + 45, city.flatFloor * city.floorH), camA, 0) : { p: orbit([0, 0, 0], 125, top + 40, 4.8 + (t - 123.6) * 0.03), q: [0, top - 4, 0] })
      : flight(t, 128, 129.8, { p: orbit([0, 0, 0], 125, top + 40, 4.8 + 4.4 * 0.03), q: [0, top - 4, 0] }, camB, 0);
    if (t >= 129.8) cam = heroCam(5.3 + (t - 129.8) * 0.03, 205, 135, 44);
    // labels
    if (dv > 0.01) { const pp = city.project(0, top + 6, 0); if (pp) label('dev', 'Sanctioned G + 13 · Observed G + 14 · <b>+1 storey</b>', 'red', pp[0], pp[1] - 30, dv); }
    if (ov > 0.01) { const k = 6; const y = k * city.floorH + k * 3.2 * ex; const pp = city.project(city.overlapCenter[0], y, city.overlapCenter[1]); if (pp) label('ov', 'Overlap · 16.3 m³ · Flat 601 / Flat 701', 'red', pp[0] + 120, pp[1] - 90, ov); }
  } else {
    // underground
    u.uGhost.value = lerp(0, 0.75, P(t, 134, 135.5)); u.uHideSel.value = 1; city.cityMat.depthWrite = false; city.heroG.visible = true;
    const gnd = 1 - P(t, 134.4, 136, E.inOutCubic) * 0.84; city.setGround(gnd);
    heroFloors(0, 0, 1, t, 1 - P(t, 134.4, 136) * 0.55);
    city.under.visible = true;
    city.pipes.forEach((m, i) => { m.opacity = P(t, 135.2 + i * 0.25, 135.8 + i * 0.25); });
    city.tunnelMat.opacity = 0.55 * P(t, 136.4, 137.2);
    city.soil.material.opacity = 0.1 * P(t, 135, 136); city.soilEdge.material.opacity = 0.5 * P(t, 135, 136);
    const tr = P(t, 139.4, 141.6, E.inOutCubic); city.setTrench(tr * 64, P(t, 139.2, 139.6));
    const d = P(t, 134, 143.4, E.linear);
    cam = { p: orbit([0, 0, 0], lerp(260, 190, E.inOutSine(d)), lerp(150, 70, E.inOutSine(d)), lerp(3.7, 4.3, d)), q: [0, lerp(20, -6, P(t, 134, 137, E.inOutCubic)), 0] };
    // labels
    const [ax, ay] = city.axis; const nx = -ay, ny = ax;
    const lab = (key, txt, off, along, depth, a) => { const x = nx * off + ax * along, n = ny * off + ay * along; const pp = city.project(x, -depth, n); if (pp) label(key, txt, '', pp[0], pp[1] - 16, a); };
    lab('w', '<span style="color:#5aa2ff">●</span> Water main · −2.4 m', -26, -120, 2.4, P(t, 135.6, 136.2));
    lab('s', '<span style="color:#4fc062">●</span> Sewer · −3.6 m', 27, -150, 3.6, P(t, 136.0, 136.6));
    lab('g', '<span style="color:#f2c200">●</span> Gas · −1.6 m', -30, 120, 1.6, P(t, 136.3, 136.9));
    { const x = ax * 70, n = ay * 70; const pp = city.project(x + nx * 90, -19, n + ny * 90); if (pp) label('m', 'Metro corridor · −19 m', 'light', pp[0], pp[1] - 20, P(t, 136.8, 137.4)); }
    if (tr > 0.05 && city.trenchEnd) { const pp = city.project(city.trenchEnd[0], 1, city.trenchEnd[1]); if (pp) label('tr', 'Trench crosses: water main · gas', 'red', pp[0], pp[1] - 24, P(t, 140.6, 141.2)); }
  }
  canvas.style.opacity = cOp;
  city.camera_(cam.p, cam.q, 34);
  return true;
}
function setHideUnrevealed(v) {
  city.uni.uHideUn.value = v;
}

function heroFloors(ex, flat, g, t, alpha = 1) {
  city.floors.forEach((f, i) => {
    f.g.position.y = i * 3.2 * ex;
    const dim = i === city.flatFloor ? 1 : lerp(1, 0.28, flat);
    f.mat.opacity = g * dim * alpha; f.edge.material.opacity = 0.55 * g * dim * alpha;
    f.mat.color.set(i === city.flatFloor && flat > 0.01 ? '#e9f5f0' : '#dfe7e4');
  });
  city.flat.material.opacity = flat * 0.95; city.flatEdge.material.opacity = flat;
  city.extra.material.opacity = 0; city.extraEdge.material.opacity = 0; city.overlap.material.opacity = 0; city.overlapEdge.material.opacity = 0;
}
function floorLabels(t, ex, flat) {
  const o = P(t, 111.4, 112.4) * (1 - flat * 0.8);
  const ring = city.heroRing; const [ox, oy] = city.origin;
  // east-most vertex of the footprint for floor tags
  let best = ring[0]; for (const p of ring) if (p[0] > best[0]) best = p;
  for (let i = 0; i < city.nFloors; i++) {
    const y = i * city.floorH + i * 3.2 * ex + city.floorH * 0.5;
    const pp = city.project(best[0] - ox + 4, y, best[1] - oy);
    if (pp) label(`f${i}`, i === 0 ? 'G' : `F${i}`, '', pp[0] + 70, pp[1] + 14, o * P(t, 111.4 + i * 0.05, 111.9 + i * 0.05));
  }
  if (flat > 0.01) {
    const fy = (city.flatFloor + 1) * city.floorH + city.flatFloor * 3.2 * ex;
    const pp = city.project(city.flatCenter[0], fy, city.flatCenter[1]);
    if (pp) label('flat', `<div style="font:700 13px var(--mono);letter-spacing:.12em;opacity:.8">FLAT 1001 · F${city.flatFloor}</div><div style="font-size:20px;margin-top:4px">P3 · 9C3A69V5SGAN53BYZAPJ · WK</div>`, 'mint', pp[0], pp[1] - 40, flat);
    const q = city.project(city.otherCenter[0], fy, city.otherCenter[1]);
    if (q) label('flat2', 'Flat 1002 · P3 · 4KQ7…', 'light', q[0] + 40, q[1] + 70, P(t, 116.4, 117.0));
  }
}

function updHud(t) {
  const el = sc.hud; const any = on(t, [78.4, 108]); show(el, any); if (!any) return;
  const sh = $('#streamhud', el); const so = inout(t, 78.6, 92.4, 0.6, 0.5); sh.style.opacity = so; sh.style.transform = `translateY(${(1 - P(t, 78.6, 79.4, E.outExpo)) * 40}px)`;
  const rv = clamp(P(t, 79.0, 90.6, E.inOutSine) * 1.05);
  const n = Math.floor(rv * 1662); const ch = Math.min(26, Math.ceil(n / 64));
  $('#h1', el).textContent = `${ch} / 26`; $('#h2', el).textContent = fmt(n); $('#h3', el).textContent = ch ? `0–${ch - 1}` : '—'; $('#h4', el).style.width = `${rv * 100}%`;
  const s = $('#search', el); const so2 = inout(t, 92.8, 108, 0.6, 0.5); s.style.opacity = so2; s.style.transform = `translateY(${(1 - P(t, 92.8, 93.6, E.outExpo)) * -30}px)`;
  const q1 = `BIN ${B[idxB].bin}`, q2 = `BIN ${B[hero].bin}`;
  let q = '';
  if (t < 100.4) q = q1.slice(0, Math.floor(P(t, 93.4, 95.2) * q1.length));
  else q = q2.slice(0, Math.floor(P(t, 100.6, 101.4) * q2.length));
  $('#q', el).textContent = q; $('#cur', el).style.opacity = Math.floor(t * 2.5) % 2 ? 1 : 0.2;
  const cardAt = (id, idx, a, b, ytop) => {
    const c = $(id, el); const o = inout(t, a, b, 0.5, 0.4);
    const [x, n] = city.centerOf(idx); const pp = city.project(x, ytop, n);
    if (!pp || o <= 0) { c.style.opacity = 0; return; }
    css(c, { left: '1290px', top: '222px', opacity: o, transform: `translateX(${(1 - P(t, a, a + 0.5, E.outExpo)) * 40}px)` });
    label(`pin${id}`, '', 'mint', pp[0], pp[1], o).style.cssText += ';width:14px;height:14px;padding:0;border-radius:50%;box-shadow:0 0 0 6px rgba(67,224,160,.25)';
  };
  cardAt('#cardB', idxB, 97.6, 101.6, B[idxB].h);
  cardAt('#cardH', hero, 103.6, 107.8, B[hero].h);
}

function updChrome(t) {
  const ch = CHAPTERS.find(([r]) => t >= r[0] && t < r[1]);
  const vis = t >= 14.3 && t < 187.8;
  const o = vis ? 1 : 0;
  $('#mark').style.opacity = o * 0.95; $('#progress').style.opacity = o * 0.8;
  $('#progress i').style.width = `${clamp((t - 14) / (188 - 14)) * 100}%`;
  const c = $('#chapter');
  if (ch && vis) { $('#chapter-no').textContent = ch[1]; $('#chapter-name').textContent = ch[2]; c.style.opacity = inout(t, ch[0][0], ch[0][1], 0.4, 0.3); }
  else c.style.opacity = 0;
}

function updCaptions(t) {
  for (const c of caps) {
    const vis = t >= c.a - 0.05 && t < c.b + 0.05; c.el.style.display = vis ? '' : 'none'; if (!vis) continue;
    wordsAt(c.words, t, c.a, c.b);
    if (c.k) { const p = P(t, c.a - 0.1, c.a + 0.5, E.outExpo) * (1 - P(t, c.b - 0.4, c.b)); css(c.k, { opacity: p, transform: `translateX(${(1 - p) * -20}px)` }); }
  }
}

/* ───────────── frame ───────────── */
export function seek(t) {
  used = new Set();
  city.uni.uTime.value = t;
  world(t); // first pass places the camera; the second projects labels with it
  const has3D = world(t);
  updLogo(t); updProblem(t); updUpload(t); updAI(t); updChunks(t); updStudio(t); updCard(t); updRegister(t); updPropose(t); updEnd(t); updHud(t);
  updCaptions(t); updChrome(t);
  for (const [k, el] of pool) if (!used.has(k)) el.style.display = 'none';
  // global dip to black at the very start and end
  $('#fade').style.opacity = Math.max(1 - P(t, 0, 0.4), P(t, 195.3, 196));
  if (has3D) city.render();
}
window.__city = city;
await document.fonts.load('700 20px "Noto Sans"'); await document.fonts.load('600 20px "Noto Sans Mono"'); await document.fonts.load('600 20px "Noto Sans Devanagari"', 'भू');
await document.fonts.ready;
const { initFilm } = await import('./film.js');
await initFilm({ seekGfx: seek, sim, FILES, params, RENDER });

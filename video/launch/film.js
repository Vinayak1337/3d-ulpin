// The film: real Studio recordings (rec/) cut together with the motion-graphics scenes (main.js),
// each frame a pure function of film time.
import { E, P, clamp, lerp, h, $, $$, splitWords, wordsAt, css } from './lib.js';

/* ── edit decision list ──
 * gfx: play the graphics timeline from `from` to `to` (its own clock).
 * rec: play recording pieces [r0, r1] at `speed`; zoom keys are [recTime, scale, focusX, focusY] in screen px. */
const EDL = [
  { kind: 'gfx', from: 0, to: 26 },
  { kind: 'rec', chapter: ['02', 'Ingest'], pieces: [[0.4, 12.9, 1]],
    zoom: [[0.4, 1, 960, 540], [3.9, 1, 960, 540], [5.2, 1.55, 900, 470], [9.2, 1.55, 900, 470], [10.4, 1, 960, 540]],
    caps: [[0.6, 5.0, 'Ingest · the real Studio', 'Drop in a whole city pack, <span class=hl>as one ZIP</span>.'], [5.2, 12.8, 'Profiled on arrival', 'Every layer read: format, features, <span class=hl>coordinate system</span>.']] },
  { kind: 'gfx', from: 37, to: 78.2 },
  { kind: 'rec', chapter: ['05', 'Stream'], pieces: [[12.4, 19.4, 0.8]],
    zoom: [[12.4, 1, 960, 540], [15, 1.12, 960, 470], [19.4, 1.2, 960, 460]],
    caps: [[12.6, 19.3, 'Real time', 'Roads first, then <span class=hl>1,662 buildings</span>, streaming in order.']] },
  { kind: 'rec', chapter: ['06', 'Explore'], pieces: [[19.4, 41.6, 1]],
    zoom: [[19.4, 1.2, 1300, 300], [20.3, 1.45, 1500, 260], [21.4, 1, 960, 540], [29.6, 1, 960, 540], [30.7, 1, 960, 540], [37.7, 1, 960, 540], [38.9, 1.6, 1500, 300], [41.6, 1.6, 1500, 300]],
    caps: [[19.5, 24.6, 'Explore', 'Search while it streams. <span class=hl>Fly to any building.</span>'], [24.8, 30.6, 'Floors', 'Open the building into <span class=hl>its floors and flats</span>.'],
      [30.8, 38.4, 'Register', 'Units, shares, owners and residents, <span class=hl>floor by floor</span>.'], [38.6, 41.5, 'Export', 'PDF · Excel · JSON · <span class=hl>CityJSON</span>.']] },
  { kind: 'rec', chapter: ['07', 'Adaptive intake'], pieces: [[42.4, 52, 1], [52, 66.8, 2.5]],
    zoom: [[42.4, 1, 960, 540], [47.2, 1, 960, 540], [48.3, 1.7, 900, 610], [50.4, 1.7, 900, 610], [51.4, 1, 960, 540], [66.8, 1.08, 960, 520]],
    caps: [[42.6, 47.4, 'Unfamiliar fields', 'A survey file with its <span class=hl>own field names</span>.'], [47.6, 51.2, 'Proposed mapping', 'It proposes how to read each field. <span class=hl>The officer confirms.</span>'], [51.4, 66.7, 'Live import', 'Parcels, buildings and roads <span class=hl>stream onto the map</span>.']] },
  { kind: 'rec', chapter: ['08', 'Documents to floors'], pieces: [[67.2, 76.8, 1], [76.8, 89.2, 2]],
    zoom: [[67.2, 1, 960, 540], [71.9, 1, 960, 540], [73.0, 1.5, 820, 470], [75.4, 1.5, 820, 470], [76.6, 1, 960, 540], [89.2, 1.15, 900, 500]],
    caps: [[67.4, 72.2, 'Documents in', 'Deed, declaration, plan and schedules <span class=hl>for one building</span>.'], [72.4, 76.6, 'Recognised', 'Each file recognised by <span class=hl>what it contains</span>.'], [76.8, 89.1, 'Floors out', 'Levels stack live: <span class=hl>G + 3 → G + 8</span>.']] },
  { kind: 'rec', chapter: ['09', 'Check'], pieces: [[89.6, 100, 1]],
    zoom: [[89.6, 1, 960, 540], [93.8, 1, 960, 540], [95, 1.35, 700, 520], [97.2, 1.35, 900, 520], [98.2, 1.5, 1150, 480], [100, 1.5, 1150, 480]],
    caps: [[89.8, 94.8, 'Deviation check', 'Sanctioned plan against drone survey, <span class=hr>side by side</span>.'], [95, 99.9, '+1 storey · 118 m²', 'One click turns the difference into <span class=hl>a finding</span>.']] },
  { kind: 'rec', chapter: ['10', 'Identify'], pieces: [[102.5, 119.4, 1]],
    zoom: [[102.5, 1, 960, 540], [106, 1.3, 1450, 420], [107.3, 1, 960, 540], [110.6, 1, 960, 540], [111.8, 1.3, 1350, 480], [115, 1.3, 1350, 480], [116.3, 1.25, 700, 500], [119.4, 1.35, 640, 460]],
    caps: [[102.7, 107.1, 'Every flat', 'Level, carpet area and share, <span class=hl>each cited to its source</span>.'], [107.3, 111.5, '3D ULPIN', 'Assign a proposed 3D ULPIN, <span class=hl>as a hashed revision</span>.'],
      [111.7, 116, 'Property Card', 'A card per flat, <span class=hl>with a QR code</span>.'], [116.2, 119.3, 'Verify', 'Same revision. Same hash chain. <span class=hl>Valid.</span>']] },
  { kind: 'rec', chapter: ['11', 'Findings'], pieces: [[119.8, 125, 1]],
    zoom: [[119.8, 1, 960, 540], [125, 1.12, 900, 460]],
    caps: [[120, 124.9, 'Findings in 3D', 'Flat 101 and Flat 201 overlap: <span class=hr>16.3 m³</span>, shown where it happens.']] },
  { kind: 'rec', chapter: ['12', 'Underground'], pieces: [[125.3, 134.2, 1]],
    zoom: [[125.3, 1, 960, 540], [128.3, 1, 960, 540], [131.5, 1.2, 950, 620], [134.2, 1.2, 950, 620]],
    caps: [[125.5, 129.4, 'Underground', 'Water mains and metro corridors <span class=hl>below the parcel</span>.'], [129.6, 134.1, 'Screen before you dig', 'Draw a trench. See <span class=hr>what it crosses</span>.']] },
  { kind: 'rec', chapter: ['13', 'Public portal'], pieces: [[134.6, 145.8, 1]],
    zoom: [[134.6, 1, 960, 540], [137.8, 1.35, 800, 420], [140.4, 1, 960, 540], [145.8, 1.1, 800, 560]],
    caps: [[134.8, 140.2, 'For citizens', 'Search by 3D ULPIN or <span class=hl>parcel ULPIN</span>.'], [140.4, 145.7, 'Released records only', 'Floors, flats and codes, <span class=hl>no owner names</span>.']] },
  { kind: 'gfx', from: 175, to: 196 },
];
// film timing
let acc = 0;
for (const s of EDL) {
  s.start = acc;
  if (s.kind === 'gfx') s.dur = s.to - s.from;
  else { s.dur = 0; s.pieces = s.pieces.map(([r0, r1, sp]) => { const p = { r0, r1, sp, f0: s.dur }; s.dur += (r1 - r0) / sp; return p; }); }
  acc += s.dur; s.end = acc;
}
export const FILM = acc;
const recAt = (s, lt) => { let p = s.pieces[0]; for (const q of s.pieces) if (lt >= q.f0) p = q; return { r: Math.min(p.r1, p.r0 + (lt - p.f0) * p.sp), sp: p.sp }; };
const filmOfRec = (s, r) => { for (const p of s.pieces) if (r >= p.r0 && r <= p.r1) return s.start + p.f0 + (r - p.r0) / p.sp; return null; };

export async function initFilm({ seekGfx, sim, FILES, params, RENDER }) {
  const stage = $('#stage');
  const [index, events] = await Promise.all([fetch('rec/index.json').then((r) => r.json()), fetch('rec/events.json').then((r) => r.json())]);
  const moves = events.filter((e) => e.type === 'move'), clicks = events.filter((e) => e.type === 'click'), drops = events.filter((e) => e.type === 'drop');

  const layer = h(`<div id="rec"><div class="rec-bg"></div>
    <div class="screen" id="screen"><div class="sbar"><div class="dots"><i></i><i></i><i></i></div><span>BhuAayam Studio</span><span class="speed" id="speed"></span></div>
      <div class="viewport"><div class="zoom" id="zoom"><img id="imA"><img id="imB"><div id="drops"></div>
        <div class="ripple" id="ripple"></div>
        <svg id="cursor" width="34" height="40" viewBox="0 0 34 40"><path d="M3 2 L3 30 L10.5 23.2 L15.4 34.6 L20.6 32.3 L15.8 21.2 L25.6 21.2 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>
      </div></div></div>
    <div id="rcaps"></div><div class="rchap" id="rchap"><span></span><b></b></div></div>`);
  stage.insertBefore(layer, $('#chrome'));
  const recSegs = EDL.filter((s) => s.kind === 'rec');
  for (const s of recSegs) s.capEls = s.caps.map(([a, b, kick, text]) => {
    const el = h(`<div class="cap rec"><div class="kick">${kick}</div><div class="big">${text}</div></div>`); $('#rcaps').appendChild(el);
    return { a: filmOfRec(s, a) ?? s.start, b: filmOfRec(s, b) ?? s.end, el, words: splitWords($('.big', el)), k: $('.kick', el) };
  });
  const imA = $('#imA'), imB = $('#imB'); let front = imA, back = imB, shown = '';
  const frameUrl = (r) => `rec/raw/${index[clamp(Math.round(r * 30), 0, index.length - 1)]}`;
  async function showFrame(url) {
    if (url === shown) return; shown = url;
    back.src = url;
    try { await back.decode(); } catch { /* keep the previous frame */ }
    if (shown !== url) return;
    back.style.opacity = 1; front.style.opacity = 0; [front, back] = [back, front];
  }

  function zoomAt(s, r) {
    const k = s.zoom; let a = k[0], b = k[k.length - 1];
    for (let i = 0; i < k.length - 1; i++) if (r >= k[i][0] && r <= k[i + 1][0]) { a = k[i]; b = k[i + 1]; break; }
    const p = a === b ? 0 : E.inOutCubic(clamp((r - a[0]) / (b[0] - a[0])));
    const z = lerp(a[1], b[1], p); let fx = lerp(a[2], b[2], p), fy = lerp(a[3], b[3], p);
    fx = clamp(fx, 960 / z, 1920 - 960 / z); fy = clamp(fy, 540 / z, 1080 - 540 / z);
    return [z, fx, fy];
  }
  function cursorAt(r) {
    let m = null; for (const e of moves) if (e.t <= r) m = e; else break;
    if (!m) return null;
    const p = E.inOutCubic(clamp((r - m.t) / m.dur));
    return [lerp(m.x0, m.x, p), lerp(m.y0, m.y, p)];
  }

  async function seekRec(s, t) {
    const lt = t - s.start; const { r, sp } = recAt(s, lt);
    await showFrame(frameUrl(r));
    // screen entrance / exit
    const first = EDL[EDL.indexOf(s) - 1]?.kind !== 'rec', last = EDL[EDL.indexOf(s) + 1]?.kind !== 'rec';
    const pin = first ? P(lt, 0, 0.9, E.outExpo) : 1, pout = last ? P(t, s.end - 0.6, s.end, E.inCubic) : 0;
    const punch = first ? 1 : lerp(1.035, 1, P(lt, 0, 0.45, E.outCubic));
    css($('#screen'), { opacity: pin * (1 - pout), transform: `perspective(2400px) translateY(${(1 - pin) * 120 + pout * -40}px) rotateX(${(1 - pin) * 14}deg) scale(${lerp(0.9, 1, pin) * punch})`, filter: pin < 1 || pout > 0 ? `blur(${(1 - pin) * 12 + pout * 8}px)` : 'none' });
    const [z, fx, fy] = zoomAt(s, r);
    $('#zoom').style.transform = `translate(960px, 540px) scale(${z}) translate(${-fx}px, ${-fy}px)`;
    // cursor, ripple, drops
    const c = cursorAt(r); const cur = $('#cursor');
    if (c) css(cur, { display: 'block', left: `${c[0] - 3}px`, top: `${c[1] - 2}px`, transform: `scale(${1 / Math.max(1, z * 0.8)})` }); else cur.style.display = 'none';
    const ck = clicks.find((e) => r >= e.t && r < e.t + 0.6); const rp = $('#ripple');
    if (ck) { const q = (r - ck.t) / 0.6; css(rp, { display: 'block', left: `${ck.x}px`, top: `${ck.y}px`, transform: `translate(-50%, -50%) scale(${0.3 + q * 1.6})`, opacity: (1 - q) * 0.9 }); if (c) cur.style.transform += ` scale(${q < 0.25 ? 0.85 : 1})`; } else rp.style.display = 'none';
    const dp = drops.find((e) => r >= e.t - 0.9 && r < e.t + 0.7); const dz = $('#drops');
    if (dp) {
      if (dz._for !== dp) { dz.innerHTML = dp.files.map((f) => `<div class="fchip">${f}</div>`).join(''); dz._for = dp; }
      $$('.fchip', dz).forEach((el, i) => { const q = E.outCubic(clamp((r - (dp.t - 0.9) - i * 0.07) / 0.9)); const fade = 1 - P(r, dp.t + 0.35, dp.t + 0.7);
        css(el, { left: `${lerp(dp.x + 520, dp.x - 150 + i * 10, q)}px`, top: `${lerp(dp.y + 420, dp.y - 20 + i * 36, q)}px`, opacity: Math.min(q * 2, 1) * fade, transform: `rotate(${(1 - q) * 12 - 3 + i * 1.5}deg) scale(${lerp(1.1, 0.9, P(r, dp.t, dp.t + 0.5))})` }); });
      dz.style.display = 'block';
    } else dz.style.display = 'none';
    // speed tag and chapter
    $('#speed').textContent = sp === 1 ? '● Real time' : sp < 1 ? `● ${sp}× slow` : `● ${sp}× speed`;
    $('#speed').className = `speed ${sp === 1 ? 'live' : ''}`;
    const ch = $('#rchap'); const co = Math.min(pin, 1 - pout);
    $('span', ch).textContent = s.chapter[0]; $('b', ch).textContent = s.chapter[1]; ch.style.opacity = co;
    for (const seg of recSegs) for (const cp of seg.capEls) {
      const vis = seg === s && t >= cp.a - 0.05 && t < cp.b + 0.05; cp.el.style.display = vis ? 'block' : 'none'; if (!vis) continue;
      wordsAt(cp.words, t, cp.a, cp.b, { rise: 26, blur: 8 });
      const q = P(t, cp.a - 0.1, cp.a + 0.5, E.outExpo) * (1 - P(t, cp.b - 0.4, cp.b)); css(cp.k, { opacity: q, transform: `translateX(${(1 - q) * -16}px)` });
    }
  }

  async function seek(t) {
    t = clamp(t, 0, FILM - 1e-3);
    const s = EDL.find((x) => t >= x.start && t < x.end) ?? EDL[EDL.length - 1];
    const recMode = s.kind === 'rec';
    stage.classList.toggle('rec-mode', recMode);
    layer.style.display = recMode ? 'block' : 'none';
    if (recMode) { $('#fade').style.opacity = 0; await seekRec(s, t); }
    else seekGfx(s.from + (t - s.start));
    // film-wide progress bar
    $('#progress').style.opacity = t > 14.3 && t < FILM - 8 ? 0.8 : 0;
    $('#progress i').style.width = `${clamp((t - 14) / (FILM - 22)) * 100}%`;
  }
  window.seek = seek; window.DUR = FILM;

  window.renderAudio = async () => {
    const { soundtrack } = await import('./audio.js');
    const gfxAt = (old) => { for (const s of EDL) if (s.kind === 'gfx' && old >= s.from && old < s.to) return s.start + old - s.from; return null; };
    const recFilm = (r) => { for (const s of recSegs) { const f = filmOfRec(s, r); if (f !== null) return f; } return null; };
    const hits = [3.2, 9.1, 14, ...EDL.slice(1).map((s) => s.start), gfxAt(183.8), gfxAt(188.3)].filter((x) => x !== null);
    const ticks = [...clicks.map((e) => recFilm(e.t)), ...events.filter((e) => e.type === 'key').map((e) => recFilm(e.t))].filter((x) => x !== null);
    const seals = [...drops.map((e) => recFilm(e.t)), ...FILES.map((_, i) => gfxAt(27.2 + i * 0.32 + 4 + i * 0.15))].filter((x) => x !== null);
    const blips = sim.map((c) => gfxAt(c.pub)).filter((x) => x !== null);
    const end = FILM;
    const ab = await soundtrack({ dur: end, hits, blips, ticks, seals,
      drums: [[gfxAt(53), EDL.at(-1).start - 0.4], [gfxAt(175) + 1, gfxAt(187.6)]], hats: [[EDL[3].start, EDL[8].start], [gfxAt(179), gfxAt(187.6)]],
      arps: [[gfxAt(56), gfxAt(78)], [EDL[3].start, EDL[5].start], [gfxAt(176), gfxAt(187.6)]],
      curve: [[0, 0.15], [3, 0.25], [9, 0.45], [14, 0.3], [26, 0.4], [gfxAt(53), 0.6], [EDL[3].start, 0.8], [EDL[7].start, 0.7], [EDL.at(-1).start, 0.6], [gfxAt(184), 1], [gfxAt(188), 0.45], [end, 0.2]] });
    let bin = ''; const u8 = new Uint8Array(ab); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  // preview player
  if (!RENDER) {
    let t = +(params.get('t') ?? 0), playing = false, last = 0;
    const scrub = $('#scrub'), clock = $('#clock');
    const draw = () => { seek(t); scrub.value = (t / FILM) * 1000; clock.textContent = `${t.toFixed(1)} / ${FILM.toFixed(0)} s`; };
    $('#play').onclick = () => { playing = !playing; last = performance.now(); $('#play').textContent = playing ? 'Pause' : 'Play'; if (playing) requestAnimationFrame(loop); };
    scrub.oninput = () => { t = (scrub.value / 1000) * FILM; draw(); };
    addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); $('#play').click(); } if (e.code === 'ArrowRight') { t = Math.min(FILM, t + 1); draw(); } if (e.code === 'ArrowLeft') { t = Math.max(0, t - 1); draw(); } });
    function loop(now) { if (!playing) return; t += (now - last) / 1000; last = now; if (t >= FILM) { t = FILM; playing = false; } draw(); requestAnimationFrame(loop); }
    draw();
  } else await seek(0);
  window.ready = true;
}

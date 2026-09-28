// BhuAayam launch reel: motion graphics in the Studio's own design language, cut on a 120 BPM grid,
// with real Studio recordings (../launch/rec) in browser frames. Every frame is a pure function of t.
import { World } from './world.js';
import { E, P, clamp, lerp, h, $, $$, css, fmt, rng } from '../launch/lib.js';
import { buildWarp } from './warp.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const SCALE = +(params.get('scale') ?? 1), FPS = +(params.get('fps') ?? 30), VOICE = params.get('voice') ?? 'male';
if (RENDER) document.body.classList.add('render');
const stage = $('#stage'), scenesEl = $('#scenes'), typeEl = $('#type'), labelsEl = $('#labels'), canvas = $('#gl');
function fit() { if (RENDER) return; const k = Math.min(innerWidth / 1920, (innerHeight - 44) / 1080); stage.style.transform = `scale(${k}) translate(-50%, -50%)`; }
addEventListener('resize', fit); fit();

const VOICES = ['male', 'female'];
const [data, index, events, VO, ...VOTS] = await Promise.all(['../launch/data/city.json', '../launch/rec/index.json', '../launch/rec/events.json', 'vo/lines.json', ...VOICES.map((v) => `vo/${v}/timing.json`)].map((u) => fetch(u).then((r) => r.json())));
// one picture for both narrators: the ending holds long enough for the longer read of each line
const VOD = Object.fromEntries(VO.map((l) => [l.id, Math.max(...VOTS.map((d) => d[l.id].dur))]));
const warp = buildWarp(VO, VOD); const W = warp.W;
export const DUR = warp.DUR;
const world = new World(canvas, data, SCALE);
const B = data.buildings, hero = world.hero;
const moves = events.filter((e) => e.type === 'move'), clicks = events.filter((e) => e.type === 'click');

/* ───────── helpers ───────── */
const mix3 = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
const orbit = (c, r, y, ang) => [c[0] + r * Math.cos(ang), y, c[2] + r * Math.sin(ang)];
const on = (t, a, b) => t >= a && t < b;
const vis = (el, v, d = 'block') => { el.style.display = v ? d : 'none'; return v; };

/** The brand mark: three stacked plates (land, floors, dimension). */
function markSVG(color, { fillTop = true, gap = 15, stroke = 3.2, fill = null } = {}) {
  const plate = (dy, i) => `<path d="M8 ${40 + dy}L40 ${24 + dy}L72 ${40 + dy}L40 ${56 + dy}Z" fill="${i === 0 && fillTop ? color : fill ?? 'none'}" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" opacity="${1 - i * 0.18}"/>`;
  return [2, 1, 0].map((i) => plate((i - 1) * gap, i)).join('');
}

/* ───────── kinetic type ───────── */
const TY = [];
/** Headline lines slide up out of a mask. lines: [[html, colourClass], …] */
function head(size, lines, x, y, a, b, { st = 0.11, out = 0.42, align = 'left', w = null, mode = 'mask', inline = size === 's' } = {}) {
  const el = h(`<div class="hd ${size}${inline ? ' inl' : ''}" style="left:${x}px;top:${y}px;${w ? `width:${w}px;` : ''}text-align:${align}">${lines.map(([s, c]) => `<span class="ln"><span class="li ${c ?? ''}">${s}</span></span>`).join('')}</div>`);
  typeEl.appendChild(el); TY.push({ el, a, b, lis: $$('.li', el), st, out, mode });
  return el;
}
function para(html, x, y, a, b, { cls = 'c-muted', w = 700, size = 30, out = 0.35 } = {}) {
  const el = h(`<div class="sub ${cls}" style="left:${x}px;top:${y}px;width:${w}px;font-size:${size}px">${html}</div>`);
  typeEl.appendChild(el); TY.push({ el, a, b, out, mode: 'fade' });
  return el;
}
function kicker(text, x, y, a, b, cls = 'c-forest') {
  const el = h(`<div class="kick ${cls}" style="left:${x}px;top:${y}px">${text}</div>`);
  typeEl.appendChild(el); TY.push({ el, a, b, out: 0.3, mode: 'kick' });
  return el;
}
function updType(t) {
  for (const T of TY) {
    if (!vis(T.el, t >= T.a - 0.02 && t < T.b + 0.02)) continue;
    if (T.mode === 'fade' || T.mode === 'kick') {
      const pin = P(t, T.a, T.a + 0.7, E.outExpo), pout = P(t, T.b - T.out, T.b, E.inCubic);
      css(T.el, { opacity: pin * (1 - pout), transform: T.mode === 'kick' ? `translateX(${(1 - pin) * -24}px)` : `translateY(${(1 - pin) * 26 - pout * 14}px)` });
      continue;
    }
    T.lis.forEach((li, i) => {
      const a = T.a + i * T.st;
      const pin = P(t, a, a + 0.8, E.outExpo), pout = P(t, T.b - T.out + i * 0.04, T.b + i * 0.04, E.inExpo);
      if (T.mode === 'slam') {
        const s = lerp(1.5, 1, P(t, a, a + 0.5, E.outExpo));
        css(li, { transform: `scale(${s}) translateY(${-pout * 105}%)`, opacity: P(t, a, a + 0.12), filter: pin < 0.98 ? `blur(${(1 - pin) * 16}px)` : 'none' });
      } else css(li, { transform: `translateY(${((1 - pin) * 135 - pout * 135).toFixed(2)}%) rotate(${((1 - pin) * 3).toFixed(2)}deg)`, visibility: pin <= 0 || pout >= 1 ? 'hidden' : 'visible' });
    });
  }
}

/* ───────── wipes ───────── */
// cut at `at`: a panel covers the frame just before and uncovers just after.
const WIPES = [
  { at: 8, c: '#d6f478', dir: 'up' }, { at: 12, c: '#235347', dir: 'slats' }, { at: 20, c: '#d6f478', dir: 'left' },
  { at: 34, c: '#d6f478', dir: 'slats' }, { at: 42, c: '#ffffff', dir: 'flash' }, { at: 56, c: '#235347', dir: 'left' }, { at: 60.5, c: '#f4f7f8', dir: 'slats' },
  { at: 64, c: '#235347', dir: 'up' }, { at: 67, c: '#f4f7f8', dir: 'slats' }, { at: 70, c: '#0b1f1a', dir: 'down' }, { at: 73.5, c: '#f4f7f8', dir: 'slats' },
  { at: 76, c: '#d6f478', dir: 'left' }, { at: 80.4, c: '#235347', dir: 'slats' }, { at: 84, c: '#d6f478', dir: 'up' }, { at: 90, c: '#d6f478', dir: 'slats' },
  { at: 96, c: '#235347', dir: 'left' },
];
const wipesEl = $('#wipes');
for (const w of WIPES) {
  w.el = h(`<div class="wp">${w.dir === 'slats' ? Array.from({ length: 8 }, (_, i) => `<i style="position:absolute;top:0;bottom:0;left:${i * 240}px;width:241px;background:${w.c}"></i>`).join('') : ''}</div>`);
  if (w.dir !== 'slats') w.el.style.background = w.c;
  wipesEl.appendChild(w.el); w.d = w.dir === 'flash' ? 0.25 : 0.34;
}
function updWipes(t) {
  for (const w of WIPES) {
    const a = w.at - w.d, b = w.at + w.d + 0.1;
    if (!vis(w.el, t >= a && t < b)) continue;
    const pi = P(t, a, w.at, E.inCubic), po = P(t, w.at, b, E.outCubic);
    if (w.dir === 'flash') { w.el.style.opacity = t < w.at ? pi : 1 - po; continue; }
    if (w.dir === 'slats') {
      $$('i', w.el).forEach((s, i) => { const k = i * 0.028; const qi = P(t, a + k, w.at + k * 0.5, E.inCubic), qo = P(t, w.at + k * 0.5, b + k, E.outCubic); s.style.transform = `translateY(${t < w.at + k * 0.5 ? (1 - qi) * 100 : -qo * 100}%)`; });
      continue;
    }
    const v = t < w.at ? 1 - pi : -po; // 1 → 0 → −1
    const tf = { up: `translateY(${v * 100}%)`, down: `translateY(${-v * 100}%)`, left: `translateX(${v * 100}%)` }[w.dir];
    w.el.style.transform = tf;
  }
}

/* ───────── grain ───────── */
const grainEl = $('#grain'); grainEl.width = 480 * SCALE; grainEl.height = 270 * SCALE;
const grainCtx = grainEl.getContext('2d'); const grainImg = grainCtx.createImageData(480 * SCALE, 270 * SCALE);
function updGrain(T) {
  const r = rng(Math.floor(T * FPS) + 11); const d = grainImg.data;
  for (let i = 0; i < d.length; i += 4) { const v = r() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  grainCtx.putImageData(grainImg, 0, 0);
}

/* ───────── Studio footage in a browser frame ───────── */
const CURSOR = '<svg class="cursor" viewBox="0 0 34 40"><path d="M3 2 L3 30 L10.5 23.2 L15.4 34.6 L20.6 32.3 L15.8 21.2 L25.6 21.2 Z" fill="#fff" stroke="#16272d" stroke-width="2" stroke-linejoin="round"/></svg>';
class Screen {
  constructor(parent, w, { cursor = true } = {}) {
    this.w = w; this.hgt = Math.round(w * 9 / 16);
    this.el = h(`<div class="scr" style="width:${w}px"><div class="sbar"><i></i><i></i><i></i><span class="ttl">BhuAayam Studio</span><span class="tag"></span></div>
      <div class="vp" style="width:${w}px;height:${this.hgt}px"><div class="zm"><img><img>${cursor ? CURSOR : ''}<div class="ripple"></div></div></div></div>`);
    parent.appendChild(this.el);
    [this.front, this.back] = $$('img', this.el); this.shown = '';
    this.zm = $('.zm', this.el); this.cur = $('.cursor', this.el); this.rip = $('.ripple', this.el); this.tag = $('.tag', this.el);
    this.el.style.height = `${this.hgt + 44}px`;
  }
  async frame(r) {
    const url = `../launch/rec/raw/${index[clamp(Math.round(r * 30), 0, index.length - 1)]}`;
    if (url === this.shown) return; this.shown = url;
    this.back.src = url;
    try { await this.back.decode(); } catch { /* keep previous */ }
    if (this.shown !== url) return;
    this.back.style.opacity = 1; this.front.style.opacity = 0; [this.front, this.back] = [this.back, this.front];
  }
  view(z, fx, fy) {
    fx = clamp(fx, 960 / z, 1920 - 960 / z); fy = clamp(fy, 540 / z, 1080 - 540 / z);
    this.zm.style.transform = `scale(${this.w / 1920}) translate(960px, 540px) scale(${z}) translate(${-fx}px, ${-fy}px)`;
    return z;
  }
  pointer(r, z) {
    if (!this.cur) return;
    let m = null; for (const e of moves) if (e.t <= r) m = e; else break;
    if (!m || r - m.t > 6) { this.cur.style.display = 'none'; this.rip.style.display = 'none'; return; }
    const p = E.inOutCubic(clamp((r - m.t) / m.dur));
    const x = lerp(m.x0, m.x, p), y = lerp(m.y0, m.y, p);
    const ck = clicks.find((e) => r >= e.t && r < e.t + 0.55);
    const press = ck && r - ck.t < 0.15 ? 0.82 : 1;
    css(this.cur, { display: 'block', left: `${x - 3}px`, top: `${y - 2}px`, transform: `scale(${(1.25 / z) * press})` });
    if (ck) { const q = (r - ck.t) / 0.55; css(this.rip, { display: 'block', left: `${ck.x}px`, top: `${ck.y}px`, transform: `translate(-50%, -50%) scale(${(0.3 + q * 1.5) / z})`, opacity: (1 - q) * 0.9 }); }
    else this.rip.style.display = 'none';
  }
}
/** A recorded clip over authored [a, b]: pieces [recFrom, recTo, speed] scaled to fill the film window, zoom keys [recTime, scale, fx, fy]. */
function clip(a, b, pieces, zoom) {
  const start = W(a), end = W(b); const k = pieces.reduce((n, [r0, r1, sp]) => n + (r1 - r0) / sp, 0) / (end - start);
  let acc = 0; const ps = pieces.map(([r0, r1, s]) => { const p = { r0, r1, sp: s * k, f0: acc }; acc += (r1 - r0) / p.sp; return p; });
  return { a, b, start, end, ps, zoom };
}
function clipAt(c, T) {
  const lt = T - c.start; let p = c.ps[0]; for (const q of c.ps) if (lt >= q.f0) p = q;
  const r = clamp(p.r0 + (lt - p.f0) * p.sp, p.r0, p.r1);
  const k = c.zoom; let a = k[0], b = k[k.length - 1];
  if (r <= k[0][0]) b = a; else if (r >= b[0]) a = b; else for (let i = 0; i < k.length - 1; i++) if (r >= k[i][0] && r <= k[i + 1][0]) { a = k[i]; b = k[i + 1]; break; }
  const q = a === b ? 0 : E.inOutCubic(clamp((r - a[0]) / (b[0] - a[0])));
  return { r, sp: p.sp, z: lerp(a[1], b[1], q), fx: lerp(a[2], b[2], q), fy: lerp(a[3], b[3], q) };
}
const speedTag = (sp) => (Math.abs(sp - 1) < 0.06 ? 'Real time' : `${sp.toFixed(1)}× speed`);

/* ───────── scenes ───────── */
const SC = [];
function scene(name, a, b, { theme = 'light', bg = '#f4f7f8', grid = 0.8, ch = null, foot = '', brand = true, html = '' } = {}, upd = () => {}) {
  const el = h(`<div class="scene" id="s-${name}">${html}</div>`); scenesEl.appendChild(el);
  const s = { name, a, b, theme, bg, grid, ch, foot, brand, el, upd }; SC.push(s); return s;
}

/* 01 · cold open: the flat plan rises into a city (3D, night) */
scene('open', 0, 8, { theme: 'dark', bg: '#0b1f1a', grid: 0, brand: false });
head('l', [['Land records', 'c-cream'], ['are flat.', 'c-lime']], 96, 380, 0.5, 3.4, { st: 0.25 });
head('xl', [['Cities', 'c-cream'], ['aren’t.', 'c-lime']], 96, 330, 4.0, 7.6, { st: 0.5 });
kicker('NYC · ZCTA 10013 · 1,662 official building footprints', 100, 930, 1.2, 7.6, 'c-sage');

/* 02 · logo */
scene('logo', 8, 12, { theme: 'light', bg: '#f4f7f8', grid: 1, brand: false, html: `
  <svg id="lg-mark" class="abs" viewBox="0 0 80 80" style="left:880px;top:210px;width:160px;height:160px;overflow:visible"></svg>
  <div class="abs" id="lg-name" style="left:0;right:0;top:410px;text-align:center;font-weight:800;font-size:178px;letter-spacing:-.05em;line-height:1"><span class="c-ink">Bhu</span><span class="c-forest">Aayam</span></div>
  <div class="abs" id="lg-deva" style="left:0;right:0;top:640px;text-align:center;font:600 38px 'Noto Sans Devanagari',var(--sans);color:var(--muted)"><b style="color:var(--ink)">भू</b> land&nbsp;&nbsp;·&nbsp;&nbsp;<b style="color:var(--ink)">आयाम</b> dimension</div>
  <div class="abs" id="lg-tag" style="left:0;right:0;top:730px;text-align:center;font-size:32px;font-weight:500;color:var(--forest);letter-spacing:-.01em">The 3D property registry</div>` }, (t) => {
  const m = $('#lg-mark');
  m.innerHTML = [0, 1, 2].map((i) => {
    const p = P(t, 8.12 + i * 0.25, 8.62 + i * 0.25, E.outBack); const dy = (i - 1) * 15 * lerp(1, 1, p);
    const drop = (1 - p) * -90; const op = P(t, 8.12 + i * 0.25, 8.3 + i * 0.25);
    const top = i === 2; const fill = top ? 'var(--forest)' : 'none';
    return `<path transform="translate(0 ${drop})" opacity="${op}" d="M8 ${40 - dy}L40 ${24 - dy}L72 ${40 - dy}L40 ${56 - dy}Z" fill="${fill}" stroke="#235347" stroke-width="3.4" stroke-linejoin="round"/>`;
  }).join('');
  const pn = P(t, 8.85, 9.9, E.outExpo);
  css($('#lg-name'), { opacity: P(t, 8.85, 9.1), transform: `translateY(${(1 - pn) * 60}px)`, letterSpacing: `${lerp(0.02, -0.05, pn)}em`, filter: `blur(${(1 - pn) * 10}px)` });
  const pd = P(t, 9.5, 10.3, E.outExpo); css($('#lg-deva'), { opacity: pd, transform: `translateY(${(1 - pd) * 24}px)` });
  const pt = P(t, 10.0, 10.8, E.outExpo); css($('#lg-tag'), { opacity: pt, transform: `translateY(${(1 - pt) * 24}px)` });
});

/* 03 · the problem: three records, three answers */
const DOCS = [
  ['Sale deed · 2019', 'Flat 801, Lake View', [['Storeys', 'G + 8'], ['Carpet area', '84.20 m²', 'x1'], ['Share', '2.08 %']], 'SUB-<br>REGISTRAR'],
  ['Sanctioned plan · 2016', 'Lake View Residence', [['Storeys', 'G + 8'], ['Carpet area', '81.60 m²', 'x2'], ['Built-up', '118 m²']], 'PLANNING<br>AUTHORITY'],
  ['Drone survey · 2026', 'Observed massing', [['Storeys', 'G + 9', 'x3'], ['Roof height', '30.8 m'], ['Footprint', '118 m²']], 'SURVEY'],
];
scene('problem', 12, 20, { ch: ['01', 'The problem'], foot: 'Deed · Sanctioned plan · Drone survey', html: `
  ${DOCS.map(([k, t, rows, stamp], i) => `<div class="card doc" id="doc${i}" style="left:${820 + i * 355}px;top:300px;width:330px;height:470px;padding:30px 28px">
    <div style="font:700 12px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">${k}</div>
    <div style="font-size:27px;font-weight:750;letter-spacing:-.02em;margin:10px 0 22px">${t}</div>
    ${rows.map(([a, b, id]) => `<div style="display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid var(--divider);font-size:19px"><span style="color:var(--muted)">${a}</span><b ${id ? `id="${id}"` : ''} style="font:650 19px var(--mono);position:relative">${b}</b></div>`).join('')}
    ${[88, 70, 80, 56].map((w) => `<i style="display:block;height:8px;border-radius:4px;background:#e6ecec;margin:11px 0;width:${w}%"></i>`).join('')}
    <div style="position:absolute;right:26px;bottom:24px;width:94px;height:94px;border-radius:50%;border:3px solid rgba(35,83,71,.3);display:grid;place-items:center;text-align:center;font:700 11px var(--mono);color:rgba(35,83,71,.55);transform:rotate(-14deg)">${stamp}</div></div>`).join('')}
  <svg id="plinks" class="abs" width="1920" height="1080" style="left:0;top:0;overflow:visible"></svg>` }, (t) => {
  DOCS.forEach((_, i) => {
    const d = $(`#doc${i}`); const p = P(t, 12.4 + i * 0.25, 13.5 + i * 0.25, E.outExpo);
    const fall = P(t, 19.2 + i * 0.07, 19.95, E.inCubic);
    const float = Math.sin((t - 12) * 1.1 + i * 1.7) * 5;
    css(d, { opacity: P(t, 12.4 + i * 0.25, 12.7 + i * 0.25), transform: `translateY(${(1 - p) * 260 + float + fall * 900}px) rotate(${(1 - p) * (8 + i * 4) + (i - 1) * 2.5 + fall * (i - 1) * 25}deg)` });
  });
  const pb = P(t, 14.9, 15.3, E.outBack);
  for (const id of ['x1', 'x2', 'x3']) { const b = $(`#${id}`); b.style.color = pb > 0 ? '#b42318' : ''; b.style.boxShadow = pb > 0 ? `0 0 0 ${3 * pb}px #d03b3b, 0 0 0 ${10 * pb}px rgba(208,59,59,.14)` : 'none'; b.style.borderRadius = '8px'; b.style.padding = '2px 6px'; b.style.margin = '-2px -6px'; }
  const pl = P(t, 15.2, 16.0, E.inOutCubic); const fall = P(t, 19.2, 19.7);
  $('#plinks').innerHTML = pl > 0 && fall < 1 ? `
    <path d="M1080 454 C 1130 410, 1300 410, 1395 454" stroke="#d03b3b" stroke-width="3" fill="none" stroke-dasharray="${400 * pl} 400" opacity="${1 - fall}"/>
    <path d="M1430 454 C 1500 340, 1680 330, 1790 400" stroke="#d03b3b" stroke-width="3" fill="none" stroke-dasharray="${500 * pl} 500" opacity="${1 - fall}"/>` : '';
});
head('m', [['One flat.', 'c-ink'], ['Three records.', 'c-ink'], ['Three answers.', 'c-red']], 96, 300, 12.35, 19.5, { st: 0.5 });
para('The deed, the plan and the survey disagree. Today an officer reconciles them <b style="color:var(--ink)">by hand</b>.', 100, 650, 16.2, 19.4, { w: 640 });

/* 04 · ingest */
const FILES = [
  ['GEO', '#235347', 'buildings.geojson', '1.1 MB', '107561…0d05ac8e'], ['GEO', '#235347', 'roadbed.geojson', '1.8 MB', 'caf05f…e203cf7f'],
  ['LAZ', '#8a4b0f', 'lidar-2017.laz', '11.1 MB', '8c565f…962bd2d7'], ['TIF', '#245e87', 'ortho-2018.tif', '1.0 MB', 'c95ea0…0da8716'],
  ['PDF', '#b42318', 'sale_deed_704.pdf', '41 KB', '40d242…4396626c'], ['PDF', '#b42318', 'plan_F7.pdf', '104 KB', '2b9e11…c07a4f10'],
  ['CSV', '#157347', 'unit_inventory.csv', '1.3 KB', '5d0c7e…18ab33e2'],
];
const fileLand = (i) => 20.45 + i * 0.22, fileSeal = (i) => 22.5 + i * 0.24;
scene('ingest', 20, 26, { ch: ['02', 'Ingest'], foot: 'GeoJSON · LAZ · GeoTIFF · PDF · CSV · ZIP', html: `
  <div class="card" id="upw" style="left:860px;top:236px;width:980px;height:700px;padding:30px 34px">
    <div style="display:flex;align-items:center;gap:14px"><div style="font-size:26px;font-weight:750;letter-spacing:-.02em">Add files</div><span class="badge b-neutral" id="upstat">0 of 7 retained</span><span style="margin-left:auto" class="btn">Start import</span></div>
    <div id="dz" style="margin:22px 0 14px;height:92px;border:2px dashed var(--border);border-radius:14px;display:grid;place-items:center;color:var(--muted);font-size:19px">Drop files or a ZIP · any format</div>
    <div id="rows">${FILES.map(([ty, c, n, s]) => `<div class="frow" style="display:flex;align-items:center;gap:16px;height:66px;border-bottom:1px solid var(--divider)">
      <div style="width:50px;height:36px;border-radius:8px;background:${c};color:#fff;font:800 13px var(--mono);display:grid;place-items:center">${ty}</div>
      <div style="font:600 19px var(--mono);width:300px">${n}</div><div style="width:90px;color:var(--muted);font-size:17px">${s}</div>
      <div class="fbar" style="flex:1;height:8px;border-radius:4px;background:var(--subtle);overflow:hidden"><i style="display:block;height:100%;width:0;background:var(--forest)"></i></div>
      <div class="fseal" style="flex:1;display:none;align-items:center;gap:10px"><span class="badge b-ok b-dot">Sealed</span><span style="font:600 15px var(--mono);color:var(--muted)">sha256 · ${''}</span></div></div>`).join('')}</div></div>
  <div id="chips">${FILES.map(([ty, c, n]) => `<div class="card fchip" style="padding:10px 16px;display:flex;gap:10px;align-items:center;border-radius:12px;font:600 17px var(--mono)"><b style="width:40px;height:28px;border-radius:6px;background:${c};color:#fff;font:800 11px var(--mono);display:grid;place-items:center">${ty}</b>${n}</div>`).join('')}</div>
  <div id="iris" class="abs" style="background:#0b1f1a;display:none"></div>` }, (t) => {
  const w = $('#upw'); const pw = P(t, 20.05, 20.8, E.outExpo);
  css(w, { opacity: pw, transform: `translateY(${(1 - pw) * 80}px) scale(${lerp(0.96, 1, pw)})` });
  const dz = $('#dz'); const hot = t > 20.35 && t < fileLand(6) + 0.3;
  css(dz, { borderColor: hot ? '#235347' : '', background: hot ? '#e8f2ed' : 'transparent', color: hot ? '#235347' : '' });
  let sealed = 0;
  $$('.fchip').forEach((c, i) => {
    const a = fileLand(i) - 0.55, q = P(t, a, fileLand(i), E.inOutCubic);
    const x0 = 2000 - i * 30, y0 = -80 + i * 40, x1 = 1180, y1 = 300;
    const x = lerp(x0, x1, q), y = lerp(y0, y1, q) - Math.sin(q * Math.PI) * 120;
    vis(c, t >= a && t < fileLand(i) + 0.15, 'flex');
    css(c, { left: `${x}px`, top: `${y}px`, transform: `rotate(${(1 - q) * 18 - 4}deg) scale(${lerp(1.1, 0.8, q)})`, opacity: 1 - P(t, fileLand(i), fileLand(i) + 0.15) });
  });
  $$('.frow').forEach((r, i) => {
    const p = P(t, fileLand(i), fileLand(i) + 0.45, E.outExpo);
    css(r, { opacity: P(t, fileLand(i), fileLand(i) + 0.2), transform: `translateY(${(1 - p) * -30}px)` });
    const up = P(t, fileLand(i) + 0.1, fileSeal(i), E.inOutSine); $('.fbar i', r).style.width = `${up * 100}%`;
    const done = t >= fileSeal(i); if (done) sealed++;
    vis($('.fbar', r), !done, 'block'); const fs = $('.fseal', r); vis(fs, done, 'flex');
    if (done) { $('span:last-child', fs).textContent = `sha256 · ${FILES[i][4]}`; const q = P(t, fileSeal(i), fileSeal(i) + 0.3, E.outBack); fs.style.transform = `scale(${lerp(0.9, 1, q)})`; fs.style.transformOrigin = 'left'; }
  });
  $('#upstat').textContent = sealed ? `${sealed} of 7 sealed · originals unchanged` : `${$$('.frow').filter((_, i) => t >= fileLand(i)).length} of 7 retained`;
  $('#upstat').className = `badge ${sealed === 7 ? 'b-ok' : 'b-neutral'}`;
  // iris from the GeoJSON row into the night of the AI scene
  const ir = P(t, 25.35, 26.0, E.inExpo); const irEl = $('#iris');
  if (vis(irEl, ir > 0)) { const r0 = [896, 236 + 30 + 26 + 22 + 92 + 14 + 8, 1804, 236 + 30 + 26 + 22 + 92 + 14 + 58]; css(irEl, { left: `${lerp(r0[0], 0, ir)}px`, top: `${lerp(r0[1], 0, ir)}px`, width: `${lerp(r0[2] - r0[0], 1920, ir)}px`, height: `${lerp(r0[3] - r0[1], 1080, ir)}px`, borderRadius: `${lerp(10, 0, ir)}px` }); }
});
head('l', [['Drop in', 'c-ink'], ['anything.', 'c-forest']], 96, 300, 20.2, 22.6, { st: 0.2 });
para('GIS layers, deeds, tables, plans, LiDAR, imagery. One place.', 100, 580, 20.8, 22.6, { w: 640 });
head('l', [['Originals', 'c-ink'], ['sealed first.', 'c-forest']], 96, 300, 22.7, 25.4, { st: 0.2 });
para('Hashed on arrival. Every result traces back to unchanged bytes.', 100, 580, 23.2, 25.3, { w: 640 });

/* 05 · AI reads an unfamiliar file */
const RAW = `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[-73.997764743691,40.715638733525],[-73.997808748356,40.715567686798],[-73.997822106289,40.715572475966],[-73.997833103182,40.715576419508]]]]},"properties":{"base_bbl":"1002010030","ground_elevation":"35","feature_code":"2100","height_roof":"64.17","bin":"1002421","last_edited_date":"2017-08-22T19:01:06.000Z","geom_source":"Photogrammetric","doitt_id":"345"}},{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[-73.99461,40.71951],[-73.99458,40.71946],[-73.99452,40.71949]]]]},"properties":{"base_bbl":"1002330033","ground_elevation":"17","feature_code":"2100","height_roof":"78.67","bin":"1003053","geom_source":"Photogrammetric"}},{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[-73.99633,40.71702],[-73.99629,40.71699]]]]},"properties":{"base_bbl":"1002050015","ground_elevation":"26","height_roof":"53.05","bin":"1002735","geom_source":"Photogrammetric"}}]}`;
const FIELDS = ['height_roof', 'ground_elevation', 'bin', 'base_bbl', 'geom_source'];
const hot = new Uint8Array(RAW.length); for (const f of FIELDS) { let k = -1; while ((k = RAW.indexOf(`"${f}"`, k + 1)) >= 0) for (let j = 0; j < f.length + 2; j++) hot[k + j] = 1; }
const HEXROWS = []; for (let o = 0; o < RAW.length; o += 16) HEXROWS.push(o);
const hexRow = (o, scanRow) => {
  let hex = '', asc = '';
  for (let j = 0; j < 16; j++) {
    const i = o + j; if (i >= RAW.length) { hex += '   '; continue; }
    const c = RAW.charCodeAt(i); const hl = hot[i] && scanRow;
    const hh = c.toString(16).padStart(2, '0');
    hex += hl ? `<b>${hh}</b> ` : `${hh} `;
    const ch = RAW[i].replace('&', '&amp;').replace('<', '&lt;');
    asc += hl ? `<b>${ch}</b>` : ch;
  }
  return `<div class="hx"><span class="off">${o.toString(16).padStart(8, '0')}</span>  ${hex} <span class="asc">${asc}</span></div>`;
};
const MAPROWS = [['height_roof', 'height', 'feet → metres'], ['ground_elevation', 'base elevation', 'feet → metres'], ['bin', 'building identifier', 'issuer: NYC DOB'], ['base_bbl', 'parcel reference', 'borough · block · lot'], ['geom_source', 'provenance', 'kept with every value']];
scene('ai', 26, 34, { theme: 'dark', bg: '#0b1f1a', grid: 1, ch: ['03', 'Understand'], foot: 'AI proposes · code converts · validated', html: `
  <style>.hx{white-space:pre;height:30px;line-height:30px}.hx .off{color:#4f6f64}.hx b{color:#0b1f1a;background:#d6f478;font-weight:700;border-radius:3px}.hx .asc{color:#7f9d8f}.hx .asc b{color:#0b1f1a}</style>
  <div class="dcard" id="hexp" style="left:80px;top:290px;width:960px;height:660px;padding:26px 30px;overflow:hidden">
    <div style="font:700 13px var(--mono);letter-spacing:.18em;color:var(--sage-d);margin-bottom:14px;display:flex;justify-content:space-between"><span>BUILDINGS.GEOJSON · RAW BYTES</span><span id="hexoff">0 B read</span></div>
    <div style="position:relative;height:570px;overflow:hidden"><div id="hexin" style="position:absolute;left:0;top:0;font:500 18px var(--mono);color:#cfe0d6"></div>
    <div id="scanb" class="abs" style="left:-30px;right:-30px;height:34px;background:linear-gradient(90deg,rgba(214,244,120,0),rgba(214,244,120,.16),rgba(214,244,120,0));border-top:1px solid rgba(214,244,120,.5);border-bottom:1px solid rgba(214,244,120,.5)"></div></div></div>
  <div class="dcard" id="aip" style="left:1080px;top:290px;width:760px;height:660px;padding:30px 34px">
    <div style="display:flex;align-items:center;gap:14px;font-size:23px;font-weight:750"><div id="orb" style="width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f4ffd0,#d6f478 45%,#6f8f2a)"></div>AI · profiling an unfamiliar source</div>
    <div style="font:600 14px var(--mono);color:var(--sage-d);margin:8px 0 22px 40px">reads a 64 KB sample, never the whole city</div>
    <div id="kv" style="display:grid;grid-template-columns:170px 1fr;row-gap:14px;font-size:20px">
      <span style="color:var(--sage-d)">Format</span><b>GeoJSON FeatureCollection</b>
      <span style="color:var(--sage-d)">Contents</span><b>1,662 building footprints</b>
      <span style="color:var(--sage-d)">Coordinates</span><b>EPSG:4326 · lon / lat</b>
      <span style="color:var(--sage-d)">Split by</span><b style="color:var(--lime)">complete feature · 70 per chunk</b></div>
    <div style="font:700 13px var(--mono);letter-spacing:.18em;color:var(--sage-d);margin:30px 0 12px">FIELD MEANINGS → UNIFIED SCHEMA</div>
    ${MAPROWS.map(([s, d, n]) => `<div class="mrow" style="display:flex;align-items:center;gap:14px;height:44px"><span class="src" style="font:600 17px var(--mono);color:#cfe0d6;width:200px">${s}</span><i class="arr" style="width:50px;height:2px;background:var(--lime);transform-origin:left"></i><span class="dst" style="font-size:19px"><b>${d}</b> <span style="color:var(--sage-d);font-size:16px">· ${n}</span></span></div>`).join('')}
    <div id="aichips" style="position:absolute;left:34px;bottom:28px;display:flex;gap:10px">${['proposal', '→ reviewed', '→ code converts'].map((s, i) => `<span class="badge" style="border:1px solid ${i === 2 ? 'var(--lime)' : 'rgba(173,201,183,.3)'};color:${i === 2 ? 'var(--lime)' : 'var(--sage)'};font:650 15px var(--mono)">${s}</span>`).join('')}</div></div>` }, (t) => {
  const ph = P(t, 26.1, 26.9, E.outExpo), pa = P(t, 26.9, 27.7, E.outExpo);
  css($('#hexp'), { opacity: ph, transform: `translateY(${(1 - ph) * 60}px)` }); css($('#aip'), { opacity: pa, transform: `translateY(${(1 - pa) * 60}px)` });
  const rowsPerSec = 3.2; const lt = Math.max(0, t - 26.4);
  const scroll = lt * rowsPerSec * 30; const first = Math.floor(scroll / 30);
  const scanY = 285; const scanRow = first + Math.round(scanY / 30);
  let html = ''; for (let k = first; k < first + 21 && k < HEXROWS.length * 3; k++) html += hexRow(HEXROWS[k % HEXROWS.length], k === scanRow || k === scanRow - 1);
  const hi = $('#hexin'); hi.innerHTML = html; hi.style.transform = `translateY(${-(scroll % 30)}px)`;
  $('#scanb').style.top = `${scanY - 2}px`;
  $('#hexoff').textContent = `${fmt(Math.min(65536, lt * 8200))} B read`;
  $$('#kv > *').forEach((k, i) => { const p = P(t, 27.6 + Math.floor(i / 2) * 0.45, 28.1 + Math.floor(i / 2) * 0.45, E.outExpo); css(k, { opacity: p, transform: `translateX(${(1 - p) * 16}px)` }); });
  $$('.mrow').forEach((r, i) => {
    const s = 30.1 + i * 0.3;
    css($('.src', r), { opacity: P(t, s, s + 0.3) }); $('.arr', r).style.transform = `scaleX(${P(t, s + 0.15, s + 0.5, E.inOutCubic)})`;
    const q = P(t, s + 0.35, s + 0.8, E.outExpo); css($('.dst', r), { opacity: q, transform: `translateX(${(1 - q) * 16}px)` });
  });
  $$('#aichips .badge').forEach((c, i) => { const q = P(t, 32.1 + i * 0.3, 32.5 + i * 0.3, E.outBack); css(c, { opacity: q, transform: `scale(${lerp(0.8, 1, q)})` }); });
  $('#orb').style.transform = `scale(${1 + 0.14 * Math.sin(t * 7)})`; $('#orb').style.boxShadow = `0 0 ${24 + 10 * Math.sin(t * 7)}px rgba(214,244,120,.55)`;
});
head('s', [['Unfamiliar data?', 'c-cream']], 96, 130, 26.2, 27.95);
head('s', [['AI reads it, ', 'c-cream'], ['byte by byte.', 'c-lime']], 96, 130, 28.0, 29.95, { st: 0.06 });
head('s', [['It proposes the split ', 'c-cream'], ['and what each field means.', 'c-lime']], 96, 130, 30.0, 31.95, { st: 0.06 });
head('s', [['Code converts. ', 'c-cream'], ['Nothing is invented.', 'c-lime']], 96, 130, 32.0, 33.7, { st: 0.06 });

/* 06 · the chunk engine: AI normalises, a model learns, then takes over */
const N = 24, T0 = 35.5, TP = 38.6;
const sim = (() => {
  const ai = [T0, T0, T0], ml = [TP, TP, TP, TP], out = [];
  for (let i = 0; i < N; i++) {
    const w = ai.indexOf(Math.min(...ai));
    if (ai[w] < TP - 0.35) {
      const start = Math.max(ai[w], T0 + i * 0.12), d = i === 4 ? 2.4 : 1.15;
      out.push({ i, route: 'ai', start, end: start + d, cell: ['ai', w], retry: i === 4 }); ai[w] = start + d + 0.1;
    } else {
      const m = ml.indexOf(Math.min(...ml)); const start = Math.max(ml[m], TP + (i - 8) * 0.04);
      if (i === 15) {
        const ab = start + 0.3; const w2 = ai.indexOf(Math.min(...ai)); const s2 = Math.max(ai[w2], ab + 0.35);
        out.push({ i, route: 'ml', start, abstain: ab, cell: ['ml', m], cell2: ['ai', w2], start2: s2, end: s2 + 1.0 }); ml[m] = ab + 0.05; ai[w2] = s2 + 1.05;
      } else { out.push({ i, route: 'ml', start, end: start + 0.34, cell: ['ml', m] }); ml[m] = start + 0.38; }
    }
  }
  let prev = -1; for (const c of out) { c.arrive = c.end + 0.35; c.pub = Math.max(c.arrive, prev + 0.07); prev = c.pub; }
  return out;
})();
const slotX = (i) => 96 + i * 45.4;
const cellXY = ([lane, w]) => (lane === 'ai' ? [420 + w * 110, 470] : [420 + w * 94, 622]);
scene('chunks', 34, 42, { theme: 'dark', bg: '#0b1f1a', grid: 1, ch: ['04', 'Normalise'], foot: 'Chunks finish in any order · the map fills in order', html: `
  <div class="dcard" id="srcbar" style="left:96px;top:318px;width:1090px;height:58px;border-radius:12px;display:flex;align-items:center;gap:16px;padding:0 20px;font:600 17px var(--mono)"><span style="color:var(--lime)">buildings.geojson</span><span style="color:var(--sage-d)">1.1 MB · 1,662 features · sealed</span></div>
  <svg id="cuts" class="abs" width="1920" height="1080" style="left:0;top:0"></svg>
  ${[['laneAI', 440, 'AI normaliser', 'proposes · code converts · validated', 'var(--lime)'], ['laneML', 592, 'Model normaliser', 'waiting for a qualified model', '#86b6ef']].map(([id, y, tt, sub, c]) => `<div class="dcard" id="${id}" style="left:96px;top:${y}px;width:1090px;height:112px;border-radius:16px;padding:22px 24px"><div style="font-size:21px;font-weight:750;color:${c}">${tt}</div><div class="ls" style="font:600 13px var(--mono);color:var(--sage-d);margin-top:6px;width:290px">${sub}</div></div>`).join('')}
  <div class="dcard" id="trainer" style="left:1250px;top:318px;width:590px;height:386px;padding:26px 28px">
    <div style="display:flex;align-items:center;justify-content:space-between"><div style="font-size:21px;font-weight:750"><span style="color:#86b6ef">◆</span> Training worker</div><span class="badge" id="ver" style="border:1px solid rgba(173,201,183,.3);font:650 14px var(--mono)">no model yet</span></div>
    <div style="font:600 13px var(--mono);color:var(--sage-d);margin-top:6px">learns field mappings from every checked chunk</div>
    <svg width="534" height="150" style="margin-top:22px;overflow:visible"><line x1="0" y1="149" x2="534" y2="149" stroke="rgba(173,201,183,.2)"/><path id="lossp" fill="none" stroke="#86b6ef" stroke-width="3"/><path id="lossv" fill="none" stroke="#d6f478" stroke-width="2" stroke-dasharray="6 6" opacity=".8"/></svg>
    <div style="display:flex;gap:26px;margin-top:22px">${[['st1', 'Checked examples'], ['st2', 'AI calls'], ['st3', 'By the model']].map(([id, l]) => `<div style="font:600 12px var(--mono);letter-spacing:.08em;color:var(--sage-d);text-transform:uppercase">${l}<b id="${id}" style="display:block;font:800 34px var(--sans);letter-spacing:-.02em;color:#f4f3eb;margin-top:4px;text-transform:none">0</b></div>`).join('')}</div></div>
  <div class="abs" style="left:96px;top:768px;font:700 13px var(--mono);letter-spacing:.18em;color:var(--sage-d)">UNIFIED SCHEMA · PUBLISHED IN ORDER</div>
  ${Array.from({ length: N }, (_, i) => `<div class="abs" style="left:${slotX(i)}px;top:800px;width:38px;height:38px;border-radius:9px;border:1px dashed rgba(173,201,183,.2)"></div>`).join('')}
  <svg id="feeds" class="abs" width="1920" height="1080" style="left:0;top:0"></svg>
  <div id="tiles">${Array.from({ length: N }, (_, i) => `<div class="tile abs" style="width:38px;height:38px;border-radius:9px;border:2px solid;display:grid;place-items:center;font:700 13px var(--mono)"><span>${i}</span><em style="position:absolute;top:-30px;left:50%;transform:translateX(-50%);white-space:nowrap;font:700 12px var(--mono);font-style:normal;padding:3px 8px;border-radius:6px;display:none"></em></div>`).join('')}</div>
  <div id="ptrl" class="abs" style="top:856px;font:700 14px var(--mono);color:#1baf7a;white-space:nowrap"></div>
  <div id="zoomout" class="abs" style="inset:0;background:#fff;opacity:0"></div>` }, (t) => {
  const pb = P(t, 34.2, 34.8, E.outExpo), pdis = P(t, 35.3, 35.7);
  css($('#srcbar'), { opacity: pb * (1 - pdis), transform: `scaleX(${lerp(0.7, 1, pb)})`, transformOrigin: 'left' });
  const pc = P(t, 34.6, 35.3, E.inOutCubic); let cuts = '';
  if (pc > 0 && pdis < 1) for (let i = 1; i < N; i++) { const x = slotX(i) - 4; if ((x - 96) / 1090 < pc) cuts += `<line x1="${x}" y1="306" x2="${x}" y2="388" stroke="#d6f478" stroke-width="2" opacity="${1 - pdis}"/>`; }
  $('#cuts').innerHTML = cuts;
  for (const [id, k] of [['#laneAI', 0], ['#laneML', 1]]) { const p = P(t, 34.7 + k * 0.2, 35.4 + k * 0.2, E.outExpo); css($(id), { opacity: p * (k && t < TP ? 0.55 : 1), transform: `translateX(${(1 - p) * -40}px)`, borderColor: k && t >= TP ? 'rgba(134,182,239,.7)' : '' }); }
  $('#laneML .ls').textContent = t >= TP ? 'model v2 · promoted · abstains when unsure' : 'waiting for a qualified model';
  const ptr = P(t, 35.0, 35.8, E.outExpo); css($('#trainer'), { opacity: ptr, transform: `translateX(${(1 - ptr) * 60}px)` });
  let published = 0, aiCalls = 0, byML = 0, examples = 0, feeds = '';
  const tiles = $$('.tile');
  const fly = P(t, 41.3, 42.0, E.inExpo);
  sim.forEach((c) => {
    const el = tiles[c.i]; const x0 = slotX(c.i), y0 = 328, xs = slotX(c.i), ys = 800;
    const appear = P(t, 35.3 + c.i * 0.02, 35.7 + c.i * 0.02, E.outBack);
    let x = x0, y = y0, st = 'pending', prog = 0, badge = '';
    const [cx, cy] = cellXY(c.cell);
    if (t >= c.start - 0.4 && t < c.start) { const p = P(t, c.start - 0.4, c.start, E.inOutCubic); x = lerp(x0, cx, p); y = lerp(y0, cy, p) - Math.sin(p * Math.PI) * 26; st = 'moving'; }
    else if (t >= c.start && t < (c.abstain ?? c.end)) { x = cx; y = cy; st = c.route; prog = (t - c.start) / ((c.abstain ?? c.end) - c.start); if (c.retry && prog > 0.35) badge = 'retry · smaller batch'; }
    if (c.abstain !== undefined && t >= c.abstain) {
      const [x2, y2] = cellXY(c.cell2);
      if (t < c.start2) { const p = P(t, c.abstain, c.start2, E.inOutCubic); x = lerp(cx, x2, p); y = lerp(cy, y2, p); st = 'moving'; badge = 'unsure → AI'; }
      else if (t < c.end) { x = x2; y = y2; st = 'ai'; prog = (t - c.start2) / (c.end - c.start2); badge = prog < 0.5 ? 'unsure → AI' : ''; }
    }
    const [ex, ey] = c.cell2 ? cellXY(c.cell2) : [cx, cy];
    if (t >= c.end && t < c.arrive) { const p = P(t, c.end, c.arrive, E.inOutCubic); x = lerp(ex, xs, p); y = lerp(ey, ys, p); st = 'done'; }
    else if (t >= c.arrive) { x = xs; y = ys; st = t >= c.pub ? 'pub' : 'wait'; }
    if (t >= c.pub) published = c.i + 1;
    if (t >= c.start && c.route === 'ai') aiCalls++; if (c.cell2 && t >= c.start2) aiCalls++;
    if (c.route === 'ml' && !c.cell2 && t >= c.end) byML++;
    if (c.route === 'ai' && t >= c.end) examples += 70;
    if (c.route === 'ai' && t >= c.end && t < c.end + 0.7) { const p = P(t, c.end, c.end + 0.7, E.inOutSine); const fx = lerp(ex + 19, 1260, p), fy = lerp(ey + 19, 470, p) - Math.sin(p * Math.PI) * 50; feeds += `<circle cx="${fx}" cy="${fy}" r="6" fill="#d6f478"/><circle cx="${fx}" cy="${fy}" r="14" fill="#d6f478" opacity=".2"/>`; }
    const C = { pending: ['transparent', 'rgba(173,201,183,.35)', '#adc9b7'], moving: ['rgba(255,255,255,.08)', '#f4f3eb', '#f4f3eb'], ai: ['rgba(214,244,120,.18)', '#d6f478', '#f4f3eb'], ml: ['rgba(134,182,239,.2)', '#86b6ef', '#f4f3eb'], done: ['#f4f3eb', '#f4f3eb', '#0b1f1a'], wait: ['transparent', '#fab219', '#fab219'], pub: ['#1baf7a', '#1baf7a', '#062018'] }[st];
    const pulse = st === 'pub' ? P(t, c.pub, c.pub + 0.3) : 1;
    // the drop: every tile flies at the camera
    const fx = (x - 960) * fly * 1.6, fz = 1 + fly * 5;
    css(el, { left: `${x + fx}px`, top: `${y + (y - 540) * fly * 1.6}px`, background: C[0], borderColor: C[1], color: C[2], opacity: appear * (1 - P(t, 41.8, 42)), transform: `scale(${appear * (st === 'pub' ? lerp(1.3, 1, pulse) : 1) * fz})`, boxShadow: st === 'pub' && pulse < 1 ? `0 0 ${26 * (1 - pulse)}px #1baf7a` : 'none', backgroundImage: (st === 'ai' || st === 'ml') ? `conic-gradient(${C[1]}55 ${prog * 360}deg, transparent 0)` : 'none' });
    const bd = $('em', el); if (vis(bd, !!badge)) { bd.textContent = badge; css(bd, { background: badge.startsWith('retry') ? '#fab219' : '#86b6ef', color: '#0b1f1a' }); }
  });
  if (t >= TP) feeds += `<path d="M1250 560 C 1220 600, 1230 640, 1180 648" stroke="#86b6ef" stroke-width="3" fill="none" stroke-dasharray="8 8" stroke-dashoffset="${-t * 40}" opacity="${P(t, TP, TP + 0.4)}"/>`;
  $('#feeds').innerHTML = feeds;
  $('#st1').textContent = fmt(examples); $('#st2').textContent = aiCalls; $('#st3').textContent = byML;
  const ver = $('#ver');
  if (t < T0 + 1.6) { ver.textContent = 'no model yet'; css(ver, { color: '', borderColor: '' }); }
  else if (t < TP) { ver.textContent = 'v1 · shadow · evaluating'; css(ver, { color: '#fab219', borderColor: 'rgba(250,178,25,.5)' }); }
  else { ver.textContent = 'v2 · qualified · promoted'; css(ver, { color: '#86b6ef', borderColor: 'rgba(134,182,239,.6)' }); }
  const lp = P(t, T0 + 1.0, TP + 2.5); const r = rng(3); let d = '', dv = '';
  for (let k = 0; k <= 70 * lp; k++) { const x = (k / 70) * 534; const b = Math.exp(-k / 16); const y = 145 * (0.07 + 0.9 * b + (r() - 0.5) * 0.06 * b); const yv = 145 * (0.13 + 0.84 * Math.exp(-k / 20) + (r() - 0.5) * 0.04); d += `${k ? 'L' : 'M'}${x.toFixed(1)} ${(4 + (145 - (145 - y))).toFixed(1)}`; dv += `${k ? 'L' : 'M'}${x.toFixed(1)} ${(4 + yv).toFixed(1)}`; }
  $('#lossp').setAttribute('d', d); $('#lossv').setAttribute('d', dv);
  const pl = $('#ptrl'); pl.style.left = `${slotX(Math.min(published, N - 1))}px`; pl.style.opacity = P(t, 35.8, 36.2) * (1 - fly);
  const waitFor = sim.find((c) => t < c.pub); pl.textContent = published >= N ? '✓ all 24 published' : published ? `▲ published 0–${published - 1} · waiting for ${waitFor?.i}` : '▲ next: chunk 0';
  $('#zoomout').style.opacity = P(t, 41.75, 42, E.inCubic);
});
head('s', [['Split by meaning, ', 'c-cream'], ['never mid-feature.', 'c-lime']], 96, 130, 34.25, 35.95, { st: 0.06 });
head('s', [['AI normalises ', 'c-cream'], ['the first chunks.', 'c-lime']], 96, 130, 36.0, 37.55, { st: 0.06 });
head('s', [['A second worker ', 'c-cream'], ['trains a model on each result.', 'c-lime']], 96, 130, 37.6, 39.25, { st: 0.06 });
head('s', [['Then the model takes over. ', 'c-cream'], ['Faster.', 'c-lime']], 96, 130, 39.3, 41.4, { st: 0.06 });

/* 07 · stream (3D, Studio map) */
const HUD = `<div class="card" id="shud" style="right:80px;bottom:110px;width:420px;padding:22px 26px">
  <div style="display:flex;align-items:center;gap:10px"><span class="badge b-ok b-dot" id="shud-st">Importing</span><span style="font:600 15px var(--mono);color:var(--muted)">buildings.geojson</span></div>
  <div style="display:grid;grid-template-columns:1fr auto;row-gap:10px;margin-top:18px;font-size:19px"><span style="color:var(--muted)">Chunk</span><b id="h1" style="font-family:var(--mono)">0 of 24</b><span style="color:var(--muted)">Buildings on the map</span><b id="h2" style="font-family:var(--mono)">0</b><span style="color:var(--muted)">Published in order</span><b id="h3" style="font-family:var(--mono)">–</b></div>
  <div style="height:8px;border-radius:4px;background:var(--subtle);margin-top:18px;overflow:hidden"><i id="h4" style="display:block;height:100%;background:var(--forest);width:0"></i></div></div>`;
const cumChunk = []; { let s = 0; for (let c = 0; c < world.nChunks; c++) { s += world.chunkCounts[c]; cumChunk.push(s); } }
const STREAM_REV = [42.35, 47.2];
scene('stream', 42, 48, { theme: 'light', bg: '#eef3f2', grid: 0, ch: ['05', 'Stream'], html: HUD }, (t) => {
  const p = P(t, 42.3, 42.9, E.outExpo) * (1 - P(t, 47.2, 47.5)); css($('#shud'), { opacity: p, transform: `translateY(${(1 - p) * 40}px)` });
  const rev = P(t, ...STREAM_REV, E.linear) * 1.0; const chunk = Math.min(24, Math.floor(rev * 24 + 0.001));
  $('#h1').textContent = `${chunk} of 24`; $('#h2').textContent = fmt(chunk ? cumChunk[chunk - 1] : 0); $('#h3').textContent = chunk ? `0–${chunk - 1}` : '–'; $('#h4').style.width = `${(chunk / 24) * 100}%`;
  $('#shud-st').textContent = chunk >= 24 ? 'Complete' : 'Importing';
});
head('m', [['Live on the map.', 'c-ink'], ['While it uploads.', 'c-forest']], 96, 150, 42.4, 46.9, { st: 0.3 });

/* 08 · explore: real Studio footage */
const MAIN = { x: 80, y: 232, w: 1340 };
const mainScr = new Screen(scenesEl, MAIN.w); mainScr.el.style.display = 'none';
const CLIPS = {
  explore: clip(48, 56, [[13.2, 15.6, 1.2], [16.0, 25.6, 1.6]], [[13.2, 1, 960, 540], [15.6, 1.06, 960, 520], [16.0, 1.0, 960, 540], [16.8, 1.7, 1560, 250], [20.4, 1.7, 1560, 250], [21.4, 1, 960, 540], [24.6, 1.05, 960, 540], [25.6, 1.2, 1350, 620]]),
  floors: clip(60.5, 64, [[78.6, 87.0, 2.4]], [[78.6, 1.18, 1000, 480], [87, 1.3, 1000, 470]]),
  check: clip(67, 70, [[94.4, 99.8, 1.8]], [[94.4, 1.25, 700, 470], [96.9, 1.3, 700, 470], [97.6, 1.25, 1050, 560], [99.8, 1.3, 1050, 560]]),
  under: clip(73.5, 76, [[128.6, 133.6, 2]], [[128.6, 1.1, 960, 620], [133.6, 1.25, 960, 660]]),
  proof: clip(80.4, 84, [[106.3, 113.3, 2.8], [116.3, 119.3, 3]], [[106.3, 1, 960, 540], [107.2, 1.3, 1500, 460], [108.2, 1.1, 1150, 600], [109.6, 1, 960, 540], [113.3, 1.12, 960, 500], [116.3, 1.3, 900, 420], [119.3, 1.35, 900, 400]]),
};
// [clip, steps for the right column, kicker]
const FOOT = {
  explore: [['Search', 49.4], ['Fly to it', 51.8], ['Inspect', 53.8]],
  floors: [['Documents in', 60.6], ['Levels stack', 61.6], ['Flats on each floor', 62.8]],
  check: [['Plan vs survey', 67.1], ['+1 storey found', 67.9], ['Create a finding', 68.9]],
  under: [['Utilities below', 73.6], ['Draw a trench', 74.4], ['See what it crosses', 75.1]],
  proof: [['Assign 3D ULPIN', 80.5], ['Property Card', 81.9], ['Verify', 83.4]],
};
const colEl = h(`<div class="abs" id="fcol" style="left:1470px;top:${MAIN.y + 30}px;width:370px"></div>`); scenesEl.appendChild(colEl);
function footage(name, t, T, { enter = 'right' } = {}) {
  const c = CLIPS[name]; const s = mainScr; vis(s.el, true);
  const lt = T - c.start;
  const pin = P(lt, 0, 0.75, E.outExpo), pout = P(T, c.end - 0.3, c.end, E.inCubic);
  const drift = lt * 0.012;
  const rotY = enter === 'right' ? (1 - pin) * -24 : (1 - pin) * 24;
  css(s.el, { left: `${MAIN.x}px`, top: `${MAIN.y}px`, opacity: Math.min(1, pin * 1.5), transform: `perspective(2600px) translateX(${(1 - pin) * (enter === 'right' ? 420 : -420)}px) rotateY(${rotY}deg) scale(${1 + drift - pout * 0.02})` });
  return (async () => {
    const { r, sp, z, fx, fy } = clipAt(c, T); await s.frame(r); s.view(z, fx, fy); s.pointer(r, z);
    s.tag.textContent = speedTag(sp); s.tag.classList.toggle('live', Math.abs(sp - 1) < 0.06);
    // right column: step list
    const steps = FOOT[name];
    if (colEl._for !== name) { colEl._for = name; colEl.innerHTML = `<div style="font:700 13px var(--mono);letter-spacing:.2em;color:var(--forest);display:flex;gap:10px;align-items:center"><i style="width:10px;height:10px;border-radius:50%;background:#d03b3b"></i>REAL STUDIO</div>${steps.map(([l], i) => `<div class="stp" style="margin-top:${i ? 26 : 40}px;display:flex;gap:18px;align-items:baseline"><b style="font:800 18px var(--mono);color:var(--forest)">${String(i + 1).padStart(2, '0')}</b><span style="font-size:34px;font-weight:750;letter-spacing:-.025em;line-height:1.1">${l}</span></div>`).join('')}`; }
    vis(colEl, true); colEl.style.opacity = P(lt, 0.2, 0.7) * (1 - P(T, c.end - 0.3, c.end));
    $$('.stp', colEl).forEach((el, i) => { const a = steps[i][1]; const active = t >= a && (i === steps.length - 1 || t < steps[i + 1][1]); const q = P(t, a, a + 0.4, E.outExpo); css(el, { opacity: t < a ? 0.22 : active ? 1 : 0.45, transform: `translateX(${(1 - q) * -14}px)`, color: active ? 'var(--ink)' : 'var(--muted)' }); });
  })();
}
scene('explore', 48, 56, { ch: ['06', 'Explore'], bg: '#f4f7f8', grid: 0.8 });
head('s', [['Search any building. ', 'c-ink'], ['Fly straight to it.', 'c-forest']], 96, 118, 48.25, 55.7, { st: 0.25 });

/* 09 · floors and flats (3D, then footage) */
scene('floors', 56, 64, { ch: ['07', 'Floors and flats'], bg: '#eef3f2', grid: 0 });
head('m', [['Every floor.', 'c-ink'], ['Every flat.', 'c-ink'], ['Its own 3D ULPIN.', 'c-forest']], 96, 150, 56.3, 60.3, { st: 0.45 });
head('s', [['From documents ', 'c-ink'], ['to floors, live.', 'c-forest']], 96, 118, 60.6, 63.7, { st: 0.2 });

/* 10 · checks */
scene('check', 64, 70, { ch: ['08', 'Check'], bg: '#eef3f2', grid: 0 });
head('m', [['Plan vs survey.', 'c-ink'], ['Conflicts, in place.', 'c-red']], 96, 150, 64.25, 66.8, { st: 0.35 });
head('s', [['One click. ', 'c-ink'], ['A finding on record.', 'c-forest']], 96, 118, 67.1, 69.7, { st: 0.2 });

/* 11 · underground */
scene('under', 70, 76, { ch: ['09', 'Underground'], bg: '#eef3f2', grid: 0 });
head('m', [['Below the parcel,', 'c-ink'], ['too.', 'c-forest']], 96, 150, 70.25, 73.2, { st: 0.3 });
head('s', [['Screen before ', 'c-ink'], ['you dig.', 'c-red']], 96, 118, 73.6, 75.7, { st: 0.2 });

/* 12 · proof: Property Card and QR verification */
const qr = (() => {
  const n = 25, r = rng(7); let s = '';
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#16272d"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#16272d"/>`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9); if (!inF && r() > 0.52) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#16272d"/>`; }
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" style="width:150px;height:150px">${s}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
})();
scene('proof', 76, 84, { ch: ['10', 'Prove'], foot: 'Same revision · same hash chain · tamper-evident', html: `
  <div class="card" id="pcard" style="left:860px;top:300px;width:600px;padding:32px 36px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div style="display:flex;gap:10px;align-items:center"><svg viewBox="0 0 80 80" style="width:30px;height:30px">${markSVG('#235347', { gap: 13, stroke: 4 })}</svg><b style="font-size:21px;letter-spacing:-.02em">BhuAayam</b><span style="font:700 12px var(--mono);letter-spacing:.14em;color:var(--muted);text-transform:uppercase">Property Card</span></div>
    <div style="font-size:29px;font-weight:750;letter-spacing:-.02em;margin-top:22px">Flat 801, Lake View Residence</div>
    <div style="margin-top:12px;display:inline-flex;gap:8px;font:700 18px var(--mono);padding:8px 12px;border-radius:10px;background:var(--soft);color:var(--forest)"><span style="opacity:.6">P3</span>SK3S1B9468241SB6NAT<span style="opacity:.6">13</span></div></div>${qr}</div>
    ${[['Parcel ULPIN', 'MH2507A1B3C4D5'], ['Level', 'F8 · 230.8 – 233.8 m'], ['Carpet area', '66.29 m² · share 2.08 %']].map(([a, b]) => `<div style="display:flex;justify-content:space-between;padding:13px 0;border-top:1px solid var(--divider);font-size:19px;margin-top:${a === 'Parcel ULPIN' ? 22 : 0}px"><span style="color:var(--muted)">${a}</span><b style="font:650 19px var(--mono)">${b}</b></div>`).join('')}
    <div style="display:flex;justify-content:space-between;margin-top:12px;font:600 13px var(--mono);color:var(--muted)"><span>Technical record, not a title document</span><span>r3 · f35c…5c01</span></div></div>
  <div id="beam" class="abs" style="left:1316px;top:340px;height:170px;transform-origin:left center;background:linear-gradient(90deg,rgba(27,175,122,.35),rgba(27,175,122,0));clip-path:polygon(0 30%,100% 0,100% 100%,0 70%)"></div>
  <div id="phone" class="abs" style="left:1530px;top:210px;width:330px;height:680px;border-radius:52px;background:#16272d;padding:14px;box-shadow:0 50px 120px rgba(16,44,37,.35)">
    <div style="height:100%;border-radius:40px;background:#fff;padding:52px 26px 26px;position:relative;overflow:hidden">
      <div style="text-align:center;font-weight:800;font-size:19px">BhuAayam · Verify</div>
      <div id="okc" style="width:92px;height:92px;border-radius:50%;background:#157347;margin:40px auto 20px;display:grid;place-items:center"><svg width="48" height="48" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="ph" style="text-align:center;font-size:24px;font-weight:800;color:#157347">Valid · revision r3</div>
      <div class="ph" style="text-align:center;font-size:16px;color:var(--muted);margin-top:6px">Flat 801, Lake View Residence</div>
      <div id="chain" style="margin-top:30px;font:600 14px var(--mono);display:grid;gap:12px">${['r3 · code assigned · f35c…5c01', 'r2 · reviewed · 9a0e…71b2', 'r1 · draft from sources · 44d1…e09c', '✓ chain consistent'].map((s, i) => `<div style="padding:10px 12px;border-radius:10px;background:${i === 3 ? '#e8f6ee' : 'var(--subtle)'};color:${i === 3 ? '#157347' : 'var(--ink-soft)'}">${s}</div>`).join('')}</div></div></div>` }, (t) => {
  const pc = $('#pcard'); const p = P(t, 76.2, 77.3, E.outExpo); const fl = Math.sin((t - 76) * 1.2) * 6;
  const out = P(t, 80.0, 80.4, E.inCubic);
  css(pc, { opacity: P(t, 76.2, 76.5) * (1 - out), transform: `perspective(1800px) translateY(${fl}px) rotateY(${(1 - p) * -80 + Math.sin((t - 76) * 0.8) * 3}deg) rotateX(${(1 - p) * 20 + 3}deg) translateX(${-out * 200}px)` });
  const ph = $('#phone'); const pp = P(t, 77.5, 78.4, E.outExpo);
  css(ph, { opacity: pp * (1 - out), transform: `translateY(${(1 - pp) * 400 + Math.sin((t - 76) * 1.1 + 1) * 6 + out * 700}px) rotate(${(1 - pp) * 10 + 3}deg)` });
  const ps = P(t, 78.3, 78.8, E.inOutCubic) * (1 - P(t, 78.9, 79.2)); css($('#beam'), { width: `${ps * 230}px`, opacity: ps });
  const po = P(t, 78.9, 79.3, E.outBack); $('#okc').style.transform = `scale(${po})`;
  $$('.ph').forEach((x) => { x.style.opacity = P(t, 79.1, 79.4); });
  $$('#chain > div').forEach((d, i) => { const q = P(t, 79.3 + i * 0.18, 79.6 + i * 0.18, E.outExpo); css(d, { opacity: q, transform: `translateX(${(1 - q) * 24}px)` }); });
});
head('s', [['One card per flat.', 'c-ink'], ['Anyone can verify it.', 'c-forest']], 96, 150, 76.25, 80.1, { st: 0.35, inline: false });
head('s', [['Assigned, carded, ', 'c-ink'], ['verified.', 'c-forest']], 96, 118, 80.6, 83.7, { st: 0.2 });

/* 13 · montage: the Studio, working */
const WALL = [
  { r: [13.5, 15.7, 0.4], z: [1.05, 960, 540], l: 'City layer' }, { r: [51.5, 63.5, 2], z: [1.1, 960, 520], l: 'Live import' }, { r: [25.4, 31, 0.95], z: [1.2, 900, 480], l: 'Floors' },
  { r: [89.6, 93.4, 0.64], z: [1, 960, 540], l: 'Building register' }, { r: [119.8, 125, 0.87], z: [1.1, 900, 480], l: 'Findings in 3D' }, { r: [135.5, 147, 1.9], z: [1.1, 900, 500], l: 'Public portal' },
];
scene('montage', 84, 90, { theme: 'dark', bg: '#235347', grid: 1, ch: ['11', 'The Studio'], html: `<div id="wall" class="abs" style="left:0;top:0;width:1920px;height:1080px;perspective:2200px"><div id="wallin" class="abs" style="left:0;top:0;width:1920px;height:1080px;transform-style:preserve-3d"></div></div>` }, async (t) => {
  const wi = $('#wallin');
  const lt = t - 84;
  wi.style.transform = `translateZ(${lerp(-250, 60, E.inOutSine(clamp(lt / 5.6)))}px) rotateX(${lerp(14, 6, lt / 6)}deg) rotateZ(${lerp(-6, -2, lt / 6)}deg) translateX(${lerp(40, -40, lt / 6)}px)`;
  const jobs = [];
  WALL.forEach((w, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const a = 84.05 + i * 0.5; const p = P(t, a, a + 0.6, E.outBack);
    const zoomOut = i === 5 ? P(t, 88.4, 89.6, E.inOutCubic) : 0;
    const x = 170 + col * 560, y = 290 + row * 380;
    css(w.scr.el, { display: 'block', left: `${lerp(x, 80, zoomOut)}px`, top: `${lerp(y, 150, zoomOut)}px`, opacity: P(t, a, a + 0.2) * (i === 5 ? 1 : 1 - zoomOut), transform: `translateZ(${(1 - p) * -400 + zoomOut * 200}px) scale(${lerp(0.6, 1, p) * lerp(1, 3.1, zoomOut)})`, transformOrigin: '0 0', zIndex: i === 5 ? 5 : 1 });
    const r = clamp(w.r[0] + Math.max(0, t - a) * w.r[2], w.r[0], w.r[1]);
    jobs.push(w.scr.frame(r).then(() => w.scr.view(w.z[0], w.z[1], w.z[2])));
    w.scr.tag.textContent = w.l;
  });
  await Promise.all(jobs);
});
const wallIn = $('#wallin'); for (const w of WALL) { w.scr = new Screen(wallIn, 520, { cursor: false }); w.scr.el.style.display = 'none'; }
head('s', [['Built for the officer. ', 'c-cream'], ['Open to the citizen.', 'c-lime']], 96, 130, 84.3, 88.3, { st: 1.0 });

/* 14 · Identify → Prove → Govern */
scene('ipg', 90, 96, { theme: 'dark', bg: '#0b1f1a', grid: 1, brand: false, html: `
  ${[['A 3D ULPIN for every floor and flat.', 90.2], ['Every value cited to its evidence, hash-chained.', 91.2], ['Checks and a registry officers can act on.', 92.2]].map(([s, a], i) => `<div class="abs ipgd" data-a="${a}" style="left:1180px;top:${300 + i * 210}px;width:620px;font-size:30px;color:var(--sage);font-weight:500;line-height:1.3">${s}</div>`).join('')}` }, (t) => {
  $$('.ipgd').forEach((d) => { const a = +d.dataset.a; const q = P(t, a, a + 0.6, E.outExpo) * (1 - P(t, 94.8, 95.3)); css(d, { opacity: q, transform: `translateX(${(1 - q) * 30}px)` }); });
});
head('xl', [['Identify.', 'c-cream']], 110, 230, 90.0, 95.4, { mode: 'slam' });
head('xl', [['Prove.', 'c-lime']], 110, 440, 91.0, 95.5, { mode: 'slam' });
head('xl', [['Govern.', 'c-cream']], 110, 650, 92.0, 95.6, { mode: 'slam' });

/* 15 · end card */
scene('end', 96, 104, { theme: 'dark', bg: '#0b1f1a', grid: 1, brand: false, html: `
  <svg id="end-mark" class="abs" viewBox="0 0 80 80" style="left:890px;top:200px;width:140px;height:140px;overflow:visible"></svg>
  <div class="abs" id="end-name" style="left:0;right:0;top:370px;text-align:center;font-weight:800;font-size:176px;letter-spacing:-.05em;line-height:1"><span class="c-cream">Bhu</span><span class="c-lime">Aayam</span></div>
  <div class="abs end-l" style="left:0;right:0;top:600px;text-align:center;font-size:40px;font-weight:500;color:#f4f3eb;letter-spacing:-.015em">Every floor. Every flat. One verifiable record.</div>
  <div class="abs end-l" style="left:760px;right:760px;top:700px;height:1px;background:rgba(173,201,183,.3)"></div>
  <div class="abs end-l" style="left:0;right:0;top:740px;text-align:center;font:700 18px var(--mono);letter-spacing:.3em;color:var(--sage)">IDENTIFY · PROVE · GOVERN</div>
  <div class="abs end-l" style="left:0;right:0;top:790px;text-align:center;font:700 16px var(--mono);letter-spacing:.3em;color:var(--sage-d)">SMART INDIA HACKATHON</div>` }, (t) => {
  $('#end-mark').innerHTML = [0, 1, 2].map((i) => { const p = P(t, 96.25 + i * 0.22, 96.8 + i * 0.22, E.outBack); const dy = (i - 1) * 15; return `<path transform="translate(0 ${(1 - p) * -80})" opacity="${P(t, 96.25 + i * 0.22, 96.45 + i * 0.22)}" d="M8 ${40 - dy}L40 ${24 - dy}L72 ${40 - dy}L40 ${56 - dy}Z" fill="${i === 2 ? '#d6f478' : 'none'}" stroke="#d6f478" stroke-width="3.4" stroke-linejoin="round"/>`; }).join('');
  const pn = P(t, 96.9, 98.0, E.outExpo); css($('#end-name'), { opacity: P(t, 96.9, 97.2), transform: `translateY(${(1 - pn) * 50}px)`, letterSpacing: `${lerp(0.02, -0.05, pn)}em`, filter: `blur(${(1 - pn) * 10}px)` });
  $$('.end-l').forEach((d, i) => { const q = P(t, 97.8 + i * 0.3, 98.5 + i * 0.3, E.outExpo); css(d, { opacity: q, transform: `translateY(${(1 - q) * 20}px)` }); });
  $('#fade').style.opacity = P(t, 102.4, 104, E.inOutSine);
});

/* ───────── 3D choreography ───────── */
const label = (() => { const pool = new Map(); let used = new Set();
  const f = (key, html, cls, x, y, o = 1) => { let el = pool.get(key); if (!el) { el = h(`<div class="lbl ${cls}"></div>`); labelsEl.appendChild(el); pool.set(key, el); }
    if (el._h !== html) { el.innerHTML = html; el._h = html; } used.add(key); el.style.display = o > 0.001 ? '' : 'none'; css(el, { left: `${x}px`, top: `${y}px`, opacity: o.toFixed(3) }); };
  f.begin = () => { used = new Set(); }; f.end = () => { for (const [k, el] of pool) if (!used.has(k)) el.style.display = 'none'; }; return f; })();
const heroCam = (ang, r, y, qy) => ({ p: orbit([0, 0, 0], r, y, ang), q: [0, qy, 0] });
const flight = (t, a, b, from, to, arc = 140) => { const p = P(t, a, b, E.inOutCubic); const pos = mix3(from.p, to.p, p); pos[1] += Math.sin(Math.PI * p) * arc; return { p: pos, q: mix3(from.q, to.q, p) }; };
const streamCam = (t) => { const u = P(t, 42, 48); return { p: orbit([100, 0, -30], lerp(1500, 1050, E.outCubic(u)), lerp(900, 560, E.outCubic(u)), lerp(0.45, 0.9, E.inOutSine(u))), q: [lerp(130, 70, u), 0, lerp(-40, -20, u)] }; };

function heroFloors(ex, flat, g, alpha = 1, drawer = 0) {
  world.floors.forEach((f, i) => {
    f.g.position.y = i * 3.2 * ex;
    const dim = i === world.flatFloor ? 1 : lerp(1, 0.3, flat);
    f.mat.opacity = g * dim * alpha; f.edge.material.opacity = 0.6 * g * dim * alpha;
  });
  world.flat.material.opacity = flat * 0.95; world.flatEdge.material.opacity = flat;
  const [ax, ay] = world.axis; world.flatG.position.set(-ax * drawer, 0, ay * drawer);
  for (const m of [world.extra, world.extraEdge, world.overlap, world.overlapEdge]) m.material.opacity = 0;
}

function world3d(t) {
  const u = world.uni;
  const active = t < 8 || on(t, 42, 48) || on(t, 56, 60.5) || on(t, 64, 67) || on(t, 70, 73.5) || t >= 90;
  vis(canvas, active); if (!active) return;
  u.uReveal.value = 1.1; u.uFlat.value = 1; u.uGhost.value = 0; u.uHideSel.value = 0; u.uSel.value = hero; u.uHi1.value = -1; u.uHi2.value = -1; u.uEdge.value = 0.26; u.uOrdMix.value = 0; u.uDraw.value = 2; u.uHideUn.value = 0;
  u.uFogNear.value = 1400; u.uFogFar.value = 3800; world.setTheme(1); u.uSink.value = 0;
  const shade = $('#shade'); shade.style.opacity = 0; let shift = 0;
  world.cityMat.depthWrite = true; world.heroG.visible = false; world.under.visible = false; world.setGround(1);
  let cam, op = 1, fov = 34; canvas.style.transform = ''; $('#glframe').style.display = 'none';
  if (t < 8) {
    world.setTheme(0); u.uEdge.value = lerp(0.95, 0.55, P(t, 4, 7));
    u.uDraw.value = P(t, 0.2, 3.3, E.inOutSine) * 1.1; u.uReveal.value = P(t, 3.7, 7.0, E.inOutCubic) * 1.08;
    world.setGround(lerp(0.15, 1, P(t, 3.8, 7)));
    u.uFogNear.value = 1800; u.uFogFar.value = 4200;
    const top = { p: [30, 2300, 40], q: [30, 0, -10] }, obl = { p: orbit([80, 0, -20], 1150, 640, 0.5), q: [60, 20, -30] };
    cam = t < 3.6 ? { p: [30 + t * 8, 2300 - t * 60, 40], q: [30 + t * 8, 0, -10] } : flight(t, 3.6, 7.2, { p: [58.8, 2084, 40], q: [58.8, 0, -10] }, obl, 0);
    if (t >= 7.2) cam = { p: orbit([80, 0, -20], 1150 - (t - 7.2) * 30, 640, 0.5 + (t - 7.2) * 0.05), q: [60, 20, -30] };
    fov = lerp(26, 34, P(t, 3.6, 7.2, E.inOutCubic));
    op = P(t, 0, 0.3);
  } else if (t < 48) {
    u.uOrdMix.value = 1; u.uHideUn.value = 1; u.uReveal.value = P(t, ...STREAM_REV, E.linear) * 1.03 + (t > STREAM_REV[1] ? 0.1 : 0);
    world.setGround(P(t, 42, 42.5)); cam = streamCam(t);
    shade.style.background = 'radial-gradient(ellipse 60% 45% at 18% 20%, rgba(238,243,242,.94), rgba(238,243,242,.5) 55%, transparent 80%)'; shade.style.opacity = 1 - P(t, 46.9, 47.3);
    // pull the map into the Studio frame for the cut to real footage
    const k = P(t, 47.25, 48, E.inOutCubic);
    if (k > 0) {
      const W = lerp(1920, MAIN.w, k), Hh = lerp(1080, MAIN.w * 9 / 16, k), X = lerp(0, MAIN.x, k), Y = lerp(0, MAIN.y + 44 * k, k);
      canvas.style.transform = `translate(${X}px, ${Y}px) scale(${W / 1920}, ${Hh / 1080})`;
      const gf = $('#glframe'); vis(gf, true); css(gf, { left: `${X}px`, top: `${Y - 44}px`, width: `${W}px`, height: `${Hh + 44}px`, opacity: k });
    }
  } else if (t < 60.5) {
    // floors and flats
    const g = P(t, 56.7, 57.5, E.inOutCubic);
    u.uHi1.value = t > 56.2 ? hero : -1; u.uSink.value = g; u.uHideSel.value = g > 0.01 ? 1 : 0;
    world.heroG.visible = g > 0.01; shift = 300;
    const ex = P(t, 57.4, 58.5, E.inOutCubic); const flat = P(t, 58.7, 59.2, E.outCubic); const drawer = P(t, 59.1, 59.7, E.outBack) * 9;
    heroFloors(ex, flat, g, 1, drawer);
    const fly = flight(t, 56, 57.4, { p: orbit([0, 0, 0], 900, 640, 3.85), q: [0, 10, 0] }, heroCam(4.05, 250, 150, 30), 80);
    const fy = world.flatFloor * world.floorH + world.flatFloor * 3.2 * ex;
    const hc = heroCam(lerp(4.05, 4.5, P(t, 57.4, 60.5)), lerp(250, 170, P(t, 58.4, 59.6, E.inOutCubic)), lerp(150, fy + 40, P(t, 57.6, 59.4, E.inOutCubic)), lerp(30, fy, P(t, 57.8, 59.4, E.inOutCubic)));
    cam = t < 57.4 ? fly : hc;
    // floor tags and the flat's code
    const ring = world.heroRing; const [ox, oy] = world.origin; let best = ring[0]; for (const p of ring) if (p[0] > best[0]) best = p;
    const tagO = P(t, 57.8, 58.4) * (1 - flat * 0.85);
    for (let i = 0; i < world.nFloors; i++) { const y = i * world.floorH + i * 3.2 * ex + world.floorH * 0.5; const pp = world.project(best[0] - ox + 4, y, best[1] - oy); if (pp) label(`f${i}`, i === 0 ? 'G' : `F${i}`, 'tag plain', pp[0] + 40, pp[1], tagO * P(t, 57.8 + i * 0.03, 58.2 + i * 0.03)); }
    if (flat > 0.01) {
      const fy2 = (world.flatFloor + 1) * world.floorH + world.flatFloor * 3.2 * ex; const [ax, ay] = world.axis;
      const pp = world.project(world.flatCenter[0] - ax * drawer, fy2, world.flatCenter[1] - ay * drawer);
      const code = 'P3 · 9C3A69V5SGAN53BYZAPJ · WK'; const n = Math.floor(P(t, 59.3, 60.1) * code.length);
      if (pp) label('flat', `<small>Flat · F${world.flatFloor} · 3D ULPIN (proposed)</small><span class="code">${code.slice(0, n)}${n < code.length ? '▍' : ''}</span>`, 'forest', pp[0], pp[1] - 50, flat);
    }
  } else if (t < 67) {
    u.uSink.value = 1; u.uHideSel.value = 1; world.heroG.visible = true; u.uHi1.value = hero; shift = 300;
    const ex = P(t, 65.5, 66.3, E.inOutCubic) * 1.3;
    heroFloors(ex, 0, 1);
    const pulse = 0.78 + 0.22 * Math.sin(t * 9);
    const dv = P(t, 64.5, 64.9, E.outCubic) * (1 - P(t, 65.4, 65.7)); world.extra.material.opacity = 0.7 * dv * pulse; world.extraEdge.material.opacity = dv;
    const ov = P(t, 65.9, 66.3, E.outCubic); world.overlap.material.opacity = 0.9 * ov * pulse; world.overlapEdge.material.opacity = ov;
    const top = world.heroH + world.floorH;
    cam = t < 65.4 ? { p: orbit([0, 0, 0], 150, top + 50, 4.7 + (t - 64) * 0.06), q: [0, top - 6, 0] } : flight(t, 65.4, 66.3, { p: orbit([0, 0, 0], 150, top + 50, 4.7 + 1.4 * 0.06), q: [0, top - 6, 0] }, heroCam(5.25, 215, 135, 44), 0);
    if (t >= 66.3) cam = heroCam(5.25 + (t - 66.3) * 0.05, 215, 135, 44);
    if (dv > 0.01) { const pp = world.project(0, top + 6, 0); if (pp) label('dev', '<small>Sanctioned G + 13 · observed G + 14</small>+1 storey', 'red', pp[0], pp[1] - 30, dv); }
    if (ov > 0.01) { const y = 6 * world.floorH + 6 * 3.2 * ex; const pp = world.project(world.overlapCenter[0], y, world.overlapCenter[1]); if (pp) label('ov', '<small>Measured in 3D</small>Overlap · 16.3 m³', 'red', pp[0] + 140, pp[1] - 70, ov); }
  } else if (t < 73.5) {
    u.uSink.value = 1; u.uGhost.value = P(t, 70.2, 71); u.uHideSel.value = 1; world.cityMat.depthWrite = false; world.heroG.visible = true; shift = 260;
    world.setGround(1 - P(t, 70.2, 71.2, E.inOutCubic) * 0.85);
    heroFloors(0, 0, 1, 1 - P(t, 70.2, 71) * 0.5);
    world.under.visible = true;
    world.pipes.forEach((_, i) => world.setPipe(i, P(t, 70.6 + i * 0.18, 71.5 + i * 0.18, E.inOutCubic), P(t, 70.6 + i * 0.18, 70.8 + i * 0.18)));
    world.tunnelMat.opacity = 0.5 * P(t, 71.2, 71.8);
    world.soil.material.opacity = 0.18 * P(t, 70.4, 71.2); world.soilEdge.material.opacity = 0.8 * P(t, 70.4, 71.2);
    const tr = P(t, 72.0, 73.0, E.inOutCubic); world.setTrench(tr * 64, P(t, 71.9, 72.1));
    const d = P(t, 70, 73.5);
    cam = { p: orbit([0, 0, 0], lerp(250, 190, E.inOutSine(d)), lerp(140, 60, E.inOutSine(d)), lerp(3.75, 4.25, d)), q: [0, lerp(18, -6, P(t, 70, 71.6, E.inOutCubic)), 0] };
    const [ax, ay] = world.axis; const nx = -ay, ny = ax;
    const lab = (key, txt, off, along, depth, a) => { const x = nx * off + ax * along, n = ny * off + ay * along; const pp = world.project(x, -depth, n); if (pp) label(key, txt, '', pp[0], pp[1] - 16, a); };
    lab('w', '<span style="color:#1f6fd1">●</span> Water main · −2.4 m', -26, -120, 2.4, P(t, 71.0, 71.4));
    lab('s', '<span style="color:#2e8b3a">●</span> Sewer · −3.6 m', 27, -150, 3.6, P(t, 71.2, 71.6));
    lab('g', '<span style="color:#f2c200">●</span> Gas · −1.6 m', -30, 120, 1.6, P(t, 71.4, 71.8));
    if (tr > 0.05 && world.trenchEnd) { const pp = world.project(world.trenchEnd[0], 1, world.trenchEnd[1]); if (pp) label('tr', 'Trench crosses water main · gas', 'red', pp[0], pp[1] - 24, P(t, 72.7, 73.0)); }
  } else {
    // night city behind the closing words
    world.setTheme(0); u.uEdge.value = 0.5; u.uFogNear.value = 1400; u.uFogFar.value = 3600;
    const d = t - 90; cam = { p: orbit([100, 0, -20], 1500, 700, 2.2 + d * 0.035), q: [100, 0, -20] };
    op = 0.35 * (1 - P(t, 101, 103));
  }
  canvas.style.opacity = op;
  world.camera_(cam.p, cam.q, fov, shift);
  world.render();
}

/* ───────── chrome ───────── */
const brandMk = $('#brand .mk');
function updChrome(t, s) {
  stage.dataset.theme = s.theme;
  $('#bg').style.background = s.bg; $('#bg').style.setProperty('--grid', s.grid);
  $('#bg').style.setProperty('--gridc', s.theme === 'dark' ? 'rgba(173,201,183,.07)' : 'rgba(35,83,71,.06)');
  $('#bg').style.setProperty('--gx', `${(t * 8) % 80}px`);
  const bo = s.brand ? 1 : 0; $('#brand').style.opacity = bo;
  brandMk.innerHTML = markSVG(s.theme === 'dark' ? '#d6f478' : '#235347', { gap: 13, stroke: 4 });
  $('#chapter').style.opacity = s.ch ? 1 : 0; if (s.ch) { $('#ch-no').textContent = s.ch[0]; $('#ch-name').textContent = s.ch[1]; }
  $('#foot').style.opacity = s.foot ? 1 : 0; $('#foot-l').textContent = s.foot;
}

/* ───────── seek ───────── */
const FOOTAGE = [['explore', 48, 56], ['floors', 60.5, 64], ['check', 67, 70], ['under', 73.5, 76], ['proof', 80.4, 84]];
let lastT = -1;
async function seek(T) {
  T = clamp(T, 0, DUR - 1e-3); const t = warp.inv(T);
  const s = SC.find((x) => t >= x.a && t < x.b) ?? SC[SC.length - 1];
  for (const x of SC) vis(x.el, x === s);
  updChrome(t, s);
  label.begin();
  const jobs = [];
  jobs.push(Promise.resolve(s.upd(t)));
  const f = FOOTAGE.find(([, a, b]) => t >= a && t < b);
  if (f) { jobs.push(footage(f[0], t, T, { enter: f[0] === 'explore' ? 'right' : 'left' })); $('#foot').style.opacity = 0; } else { vis(mainScr.el, false); vis(colEl, false); }
  world3d(t);
  label.end();
  updType(t); updWipes(t); updGrain(T);
  if (!(t >= 96)) $('#fade').style.opacity = 0;
  await Promise.all(jobs);
  lastT = t;
}
window.seek = seek; window.DUR = DUR;
const filmOfRec = (r) => { for (const c of Object.values(CLIPS)) for (const p of c.ps) if (r >= p.r0 && r <= p.r1) return c.start + p.f0 + (r - p.r0) / p.sp; return null; };
window.cues = { sim, fileLand, fileSeal, FILES, WALL, events, W, inv: warp.inv, DUR, VO, VOT: VOTS[Math.max(0, VOICES.indexOf(VOICE))], VOICE, filmOfRec };

await document.fonts.load('800 100px "Noto Sans"'); await document.fonts.load('600 20px "Noto Sans Mono"'); await document.fonts.load('600 30px "Noto Sans Devanagari"'); await document.fonts.ready;
window.renderAudio = async () => { const { score } = await import('./score.js'); return score(window.cues); };

if (!RENDER) {
  let t = +(params.get('t') ?? 0), playing = false, last = 0;
  const scrub = $('#scrub'), clock = $('#clock');
  const draw = () => { seek(t); scrub.value = (t / DUR) * 1000; clock.textContent = `${t.toFixed(2)} / ${DUR} s`; };
  $('#play').onclick = () => { playing = !playing; last = performance.now(); $('#play').textContent = playing ? 'Pause' : 'Play'; if (playing) requestAnimationFrame(loop); };
  scrub.oninput = () => { t = (scrub.value / 1000) * DUR; draw(); };
  addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); $('#play').click(); } if (e.code === 'ArrowRight') { t = Math.min(DUR, t + (e.shiftKey ? 0.1 : 1)); draw(); } if (e.code === 'ArrowLeft') { t = Math.max(0, t - (e.shiftKey ? 0.1 : 1)); draw(); } });
  function loop(now) { if (!playing) return; t += (now - last) / 1000; last = now; if (t >= DUR) { t = DUR; playing = false; } draw(); requestAnimationFrame(loop); }
  draw();
} else await seek(0);
window.ready = true;

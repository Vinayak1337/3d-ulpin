/**
 * Page renders of the Lake View documents, as the document service publishes them for preview
 * (GET /api/v1/sources/{id}/pages/{page}, image/svg+xml). Plans carry a calibration so records in
 * local metres can be overlaid on the page.
 */
const PAGE_W = 842, PAGE_H = 595;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const INK = '#2b2f36', MUTED = '#6b7280', LINE = '#9aa1ab', PAPER = '#fbfaf7';

const svg = (body, { w = PAGE_W, h = PAGE_H } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif">`
  + `<rect width="${w}" height="${h}" fill="${PAPER}"/>${body}</svg>`;

const text = (x, y, s, { size = 10, weight = 400, fill = INK, anchor = 'start', mono = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${mono ? ' font-family="Courier New, monospace"' : ''}>${esc(s)}</text>`;

/** Plan sheet calibration: page px = origin + metres × scale (y flipped: north is up). */
export const PLAN_CALIBRATION = { scale: 18, origin: [360, 290] };
const px = ([x, y]) => [PLAN_CALIBRATION.origin[0] + x * PLAN_CALIBRATION.scale, PLAN_CALIBRATION.origin[1] - y * PLAN_CALIBRATION.scale];
const pathOf = (ring) => `M${ring.map((p) => px(p).map((v) => v.toFixed(1)).join(' ')).join('L')}Z`;
const centre = (ring) => {
  const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y);
  return px([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
};

function titleBlock({ drawing, sheet, title, revision, date }) {
  const x = 590, y = 470, w = 232, h = 105;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="1"/>`
    + `<line x1="${x}" y1="${y + 30}" x2="${x + w}" y2="${y + 30}" stroke="${INK}" stroke-width="0.6"/>`
    + `<line x1="${x}" y1="${y + 62}" x2="${x + w}" y2="${y + 62}" stroke="${INK}" stroke-width="0.6"/>`
    + text(x + 10, y + 19, 'LAKE VIEW RESIDENCE', { size: 11, weight: 700 })
    + text(x + 10, y + 45, title, { size: 9 })
    + text(x + 10, y + 56, '12 Lake View Road · Parcel MH2507A1B3C4D5', { size: 7.5, fill: MUTED })
    + text(x + 10, y + 77, `Drg. ${drawing}`, { size: 8, mono: true })
    + text(x + 130, y + 77, `Sheet ${sheet}`, { size: 8, mono: true })
    + text(x + 10, y + 92, `Rev ${revision} · ${date}`, { size: 8, mono: true })
    + text(x + 130, y + 92, 'Scale 1:100', { size: 8, mono: true })
    + text(x + 10, y + 101, 'Sanctioned by the Planning Authority, permit BP/2019/0412', { size: 6, fill: MUTED })
    + '</g>';
}

function northArrow(x = 780, y = 60) {
  return `<g><path d="M${x} ${y - 22}L${x + 8} ${y + 6}L${x} ${y}L${x - 8} ${y + 6}Z" fill="${INK}"/>${text(x, y + 20, 'N', { size: 10, weight: 700, anchor: 'middle' })}</g>`;
}

function grid() {
  let out = '';
  for (let x = 40; x <= PAGE_W - 40; x += 36) out += `<line x1="${x}" y1="40" x2="${x}" y2="${PAGE_H - 40}" stroke="#ecebe6" stroke-width="0.5"/>`;
  for (let y = 40; y <= PAGE_H - 40; y += 36) out += `<line x1="40" y1="${y}" x2="${PAGE_W - 40}" y2="${y}" stroke="#ecebe6" stroke-width="0.5"/>`;
  return out + `<rect x="20" y="20" width="${PAGE_W - 40}" height="${PAGE_H - 40}" fill="none" stroke="${INK}" stroke-width="1.2"/>`;
}

/** Floor plan page: outer wall, spaces with labels, optional room layout of one flat and a carpet note. */
export function planPage({ outline, spaces, rooms = [], carpet = null, title, sheet, date }) {
  let body = grid();
  body += `<path d="${pathOf(outline)}" fill="none" stroke="${INK}" stroke-width="4"/>`;
  for (const s of spaces) {
    body += `<path d="${pathOf(s.ring)}" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
    if (s.hideLabel) continue;
    const [cx, cy] = centre(s.ring);
    body += text(cx, cy + 3, s.label, { size: s.small ? 8 : 11, weight: 600, anchor: 'middle' });
  }
  for (const r of rooms) {
    body += `<path d="${pathOf(r.ring)}" fill="${r.wall ? INK : 'none'}" stroke="${INK}" stroke-width="${r.wall ? 0 : 0.8}"/>`;
    if (r.wall) continue;
    const [cx, cy] = centre(r.ring);
    body += text(r.labelAt ? px(r.labelAt)[0] : cx, cy - 1, r.label.toUpperCase(), { size: 6.5, anchor: 'middle' });
    if (r.labelAt) continue;
    const narrow = r.ring[1][0] - r.ring[0][0] < 2.5;
    body += text(narrow ? cx : cx, cy + 8, narrow ? r.dims.replace(/ /g, '').replace('m', '') : r.dims, { size: narrow ? 5 : 6, fill: MUTED, anchor: 'middle', mono: true });
  }
  if (carpet) {
    const [cx, cy] = px(carpet.at);
    body += `<rect x="${cx - 34}" y="${cy - 9}" width="68" height="13" fill="${PAPER}" stroke="${INK}" stroke-width="0.6"/>`;
    body += text(cx, cy + 1, carpet.text, { size: 6.5, weight: 700, anchor: 'middle', mono: true });
  }
  // Dimension line along the south wall.
  const [x0, y0] = px([outline[0][0], outline[0][1]]), [x1] = px([outline[1][0], outline[0][1]]);
  body += `<g stroke="${MUTED}" stroke-width="0.6"><line x1="${x0}" y1="${y0 + 22}" x2="${x1}" y2="${y0 + 22}"/><line x1="${x0}" y1="${y0 + 16}" x2="${x0}" y2="${y0 + 28}"/><line x1="${x1}" y1="${y0 + 16}" x2="${x1}" y2="${y0 + 28}"/></g>`;
  body += text((x0 + x1) / 2, y0 + 36, `${(outline[1][0] - outline[0][0]).toFixed(2)} m`, { size: 8, fill: MUTED, anchor: 'middle', mono: true });
  body += northArrow() + titleBlock({ drawing: 'LV/SP/07', sheet, title, revision: 'r2', date });
  return svg(body);
}

/** Text page of a registered deed. `lines` are [text, options] pairs; redacted spans are drawn as bars. */
export function textPage({ header, lines, footer }) {
  let body = `<rect x="20" y="20" width="${PAGE_W - 40}" height="${PAGE_H - 40}" fill="none" stroke="${LINE}" stroke-width="0.8"/>`;
  body += text(PAGE_W / 2, 58, header, { size: 13, weight: 700, anchor: 'middle' });
  let y = 92;
  for (const [line, opts = {}] of lines) {
    if (opts.gap) { y += opts.gap; continue; }
    if (opts.redact) {
      body += text(70, y, line, { size: 10 });
      body += `<rect x="${70 + line.length * 5.3}" y="${y - 9}" width="${opts.redact}" height="11" fill="${INK}"/>`;
    } else if (opts.highlight) {
      body += `<rect x="64" y="${y - 12}" width="${PAGE_W - 128}" height="16" fill="#fff1c2"/>` + text(70, y, line, { size: 10, weight: opts.weight ?? 400 });
    } else body += text(opts.indent ? 90 : 70, y, line, { size: opts.size ?? 10, weight: opts.weight ?? 400, mono: opts.mono, fill: opts.muted ? MUTED : INK });
    y += opts.size ? opts.size + 8 : 17;
  }
  body += text(PAGE_W / 2, PAGE_H - 34, footer, { size: 8, fill: MUTED, anchor: 'middle' });
  return svg(body);
}

/** A two-column schedule page (deed of declaration). */
export function schedulePage({ header, subtitle, rows, total, footer }) {
  let body = `<rect x="20" y="20" width="${PAGE_W - 40}" height="${PAGE_H - 40}" fill="none" stroke="${LINE}" stroke-width="0.8"/>`;
  body += text(PAGE_W / 2, 52, header, { size: 13, weight: 700, anchor: 'middle' });
  body += text(PAGE_W / 2, 70, subtitle, { size: 9, fill: MUTED, anchor: 'middle' });
  const perCol = Math.ceil(rows.length / 2);
  rows.forEach(([unit, carpet, share, hit], i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = 70 + col * 370, y = 104 + row * 17.2;
    if (row === 0) {
      body += text(x, 92, 'Unit', { size: 8, weight: 700, fill: MUTED }) + text(x + 170, 92, 'Carpet m²', { size: 8, weight: 700, fill: MUTED, anchor: 'end' })
        + text(x + 280, 92, 'Share %', { size: 8, weight: 700, fill: MUTED, anchor: 'end' });
    }
    if (hit) body += `<rect x="${x - 6}" y="${y - 11}" width="296" height="15" fill="#fff1c2"/>`;
    body += text(x, y, unit, { size: 9 }) + text(x + 170, y, carpet, { size: 9, anchor: 'end', mono: true }) + text(x + 280, y, share, { size: 9, anchor: 'end', mono: true });
  });
  body += `<line x1="70" y1="${PAGE_H - 70}" x2="${PAGE_W - 70}" y2="${PAGE_H - 70}" stroke="${INK}" stroke-width="0.6"/>`;
  body += text(70, PAGE_H - 54, `Total of undivided shares: ${total}`, { size: 10, weight: 700 });
  body += text(PAGE_W / 2, PAGE_H - 34, footer, { size: 8, fill: MUTED, anchor: 'middle' });
  return svg(body);
}

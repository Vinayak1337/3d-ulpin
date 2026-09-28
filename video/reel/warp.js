// Time warp: the reel is authored on a 104 s clock; the film runs slower, and each voice-over line gets the
// room it needs. Knots sit on every cut and every line start; each span stretches by at least MIN (more at the
// end), and each cut-to-cut segment is rounded up to whole beats at 100 BPM so the music can cut with it.
export const BEAT = 0.6;
export const CUTS = [0, 8, 12, 20, 26, 34, 42, 48, 56, 60.5, 64, 67, 70, 73.5, 76, 80.4, 84, 90, 96, 104];
export function buildWarp(lines, durs, { MIN = 1.22, END_MIN = 1.6, PAD = 0.35 } = {}) {
  const knots = [...new Set([...CUTS, ...lines.map((l) => l.a)])].sort((x, y) => x - y);
  const need = new Map(lines.map((l) => [l.a, (durs[l.id] + PAD) / (l.b - l.a)]));
  const spans = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    spans.push({ a, b, s: Math.max(a >= 90 ? END_MIN : MIN, need.get(a) ?? 0) });
  }
  // round each cut-to-cut segment up to whole beats by stretching its last span
  for (let c = 0; c < CUTS.length - 1; c++) {
    const seg = spans.filter((s) => s.a >= CUTS[c] && s.b <= CUTS[c + 1]);
    const len = seg.reduce((n, s) => n + (s.b - s.a) * s.s, 0);
    const target = Math.ceil(len / BEAT - 1e-6) * BEAT; const last = seg[seg.length - 1];
    last.s += (target - len) / (last.b - last.a);
  }
  let F = 0; for (const s of spans) { s.F = F; F += (s.b - s.a) * s.s; }
  const W = (t) => { if (t <= 0) return t; for (const s of spans) if (t < s.b) return s.F + (t - s.a) * s.s; const l = spans[spans.length - 1]; return l.F + (t - l.a) * l.s; };
  const inv = (T) => { if (T <= 0) return T; for (const s of spans) { const e = s.F + (s.b - s.a) * s.s; if (T < e) return s.a + (T - s.F) / s.s; } const l = spans[spans.length - 1]; return l.a + (T - l.F) / l.s; };
  const stretch = (t) => (spans.find((s) => t >= s.a && t < s.b) ?? spans[spans.length - 1]).s;
  return { W, inv, stretch, DUR: F, spans };
}

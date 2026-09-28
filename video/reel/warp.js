// Time warp: the reel is authored on a 104 s clock and plays at that pace up to the Studio montage. From there
// the ending holds longer, so its lines have time to land: each span stretches by the ending minimum or by what
// its voice-over line needs, and each cut-to-cut segment is rounded up to whole beats at 120 BPM.
export const BEAT = 0.5;
export const CUTS = [0, 8, 12, 20, 26, 34, 42, 48, 56, 60.5, 64, 67, 70, 73.5, 76, 80.4, 84, 90, 96, 104];
export const HOLD = [[84, 1.35], [90, 1.7], [96, 1.6]];
export function buildWarp(lines, durs, { PAD = 0.35 } = {}) {
  const from = HOLD[0][0];
  const knots = [...new Set([...CUTS, ...lines.map((l) => l.a).filter((a) => a >= from)])].sort((x, y) => x - y);
  const next = (a) => lines.find((l) => l.a > a)?.a ?? 104;
  const need = new Map(lines.filter((l) => l.a >= from).map((l) => [l.a, (durs[l.id] + PAD) / (next(l.a) - l.a)]));
  const hold = (a) => HOLD.reduce((s, [t, k]) => (a >= t ? k : s), 1);
  const spans = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    spans.push({ a, b, s: Math.max(hold(a), need.get(a) ?? 0) });
  }
  for (let c = 0; c < CUTS.length - 1; c++) {
    if (CUTS[c] < from) continue;
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

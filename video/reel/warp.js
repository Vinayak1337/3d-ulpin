// Time warp: the reel is authored on its own clock, and the film plays it back with three changes.
//   · Animations and transitions keep their authored speed.
//   · Text holds: where a headline or paragraph sits still on screen, that stretch is held until it can be read,
//     and until the narration over it has finished.
//   · Inserts: recorded Studio clips are cut in at authored instants; the authored clock waits while they play.
// Each cut-to-cut segment and each insert is rounded up to whole beats, so the score can cut with the picture.
export const BEAT = 0.5;

/**
 * cuts: authored cut times (must include 0 and end) · holds: [{ a, b, need }] authored spans where text sits still,
 * and the film seconds each needs · lines: narration [{ a | ins, dur }] · inserts: [{ key, at, min }] authored instants ·
 * stops: authored instants a line must also finish before (a section change with no narration of its own).
 */
export function buildWarp({ cuts, holds, lines, inserts, end, stops = [], PAD = 0.45, TAIL = 0.7 }) {
  const knots = [...new Set([...cuts, ...holds.flatMap((h) => [h.a, h.b]), ...lines.filter((l) => l.a != null).map((l) => l.a)])]
    .filter((k) => k >= 0 && k <= end).sort((x, y) => x - y);
  const spans = knots.slice(0, -1).map((a, i) => ({ a, b: knots[i + 1], L: knots[i + 1] - a, hold: false }));
  const inside = (a, b) => spans.filter((s) => s.a >= a - 1e-9 && s.b <= b + 1e-9);
  // text holds: long enough to read
  for (const h of holds) {
    const S = inside(h.a, h.b); S.forEach((s) => { s.hold = true; });
    const cur = S.reduce((n, s) => n + s.L, 0);
    if (cur > 0 && cur < h.need) S.forEach((s) => { s.L *= h.need / cur; });
  }
  // narration: each line finishes before the next line, insert or the end; the extra time goes to text holds
  const ins = inserts.map((x) => ({ ...x, L: x.min }));
  const marks = [...lines.filter((l) => l.a != null).map((l) => l.a), ...ins.map((x) => x.at), ...stops, end].sort((x, y) => x - y);
  for (const l of lines) {
    if (l.ins) { const x = ins.find((i) => i.key === l.ins); x.L = Math.max(x.L, PAD + l.dur + TAIL); continue; }
    const nb = marks.find((m) => m > l.a + 1e-9) ?? end;
    const S = inside(l.a, nb); const cur = S.reduce((n, s) => n + s.L, 0); const need = l.dur + PAD;
    if (cur >= need) continue;
    const H = S.filter((s) => s.hold); const G = H.length ? H : S; const g = G.reduce((n, s) => n + s.L, 0);
    G.forEach((s) => { s.L += (need - cur) * (s.L / g); });
  }
  // whole beats
  const up = (x) => Math.ceil(x / BEAT - 1e-6) * BEAT;
  for (let c = 0; c < cuts.length - 1; c++) {
    const S = inside(cuts[c], cuts[c + 1]); if (!S.length) continue;
    const len = S.reduce((n, s) => n + s.L, 0); const H = S.filter((s) => s.hold);
    const k = (H.length ? H : S).reduce((m, s) => (s.L > m.L ? s : m));
    k.L += up(len) - len;
  }
  ins.forEach((x) => { x.L = up(x.L); });
  // one timeline of spans and inserts
  const seq = [];
  for (const s of spans) { for (const x of ins) if (Math.abs(x.at - s.a) < 1e-9) seq.push({ ...x, insert: true }); seq.push(s); }
  let F = 0; for (const e of seq) { e.F = F; F += e.L; }
  const sp = seq.filter((e) => !e.insert);
  const W = (t) => { if (t <= 0) return t; for (const s of sp) if (t < s.b) return s.F + ((t - s.a) / (s.b - s.a)) * s.L; const l = sp[sp.length - 1]; return l.F + l.L; };
  const at = (T) => {
    for (const e of seq) if (T < e.F + e.L) return e.insert ? { t: e.at - 1e-4, ins: e.key, lt: T - e.F, L: e.L } : { t: e.a + ((T - e.F) / e.L) * (e.b - e.a) };
    return { t: end };
  };
  return { W, at, inv: (T) => at(T).t, DUR: F, spans: sp, inserts: seq.filter((e) => e.insert) };
}

// Original score and voice-over for the reel, rendered offline with Web Audio: 100 BPM in A minor, on the film clock.
// Drums, sidechained bass, pads, arpeggio and a lead hook, sound design cued to what is on screen (wipes, impacts,
// file seals, chunk publications, clicks and typing in the Studio footage) and the narrator (vo/*.wav), with the
// music ducking under every line. Picture cues are authored on the 104 s clock and mapped through W().
const SR = 48000, BEAT = 0.6, BAR = 2.4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const between = (t, a, b) => t >= a && t < b;

// Am9 – Fmaj7 – C – G, one chord per two bars
const CHORDS = [
  { root: 45, pad: [57, 60, 64, 67, 71] }, { root: 41, pad: [57, 60, 64, 65, 69] },
  { root: 48, pad: [55, 60, 64, 67, 71] }, { root: 43, pad: [55, 59, 62, 67, 69] },
];
const chordAt = (T) => CHORDS[Math.floor(T / (2 * BAR) + 1e-6) % 4];

export async function score({ sim, fileLand, fileSeal, WALL, events, W, inv, DUR, VO, VOD, filmOfRec }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(DUR * SR), SR);
  const A = inv; // film → authored
  let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  /* ── buses ── */
  const out = ctx.createGain(); out.gain.value = 0.55;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -14; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.2;
  const limit = ctx.createDynamicsCompressor(); limit.threshold.value = -2.5; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1; limit.knee.value = 0;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 20000; tone.Q.value = 0.5;
  out.connect(tone).connect(glue).connect(limit).connect(ctx.destination);
  // underground: the whole mix goes muffled, then opens again
  tone.frequency.setValueAtTime(20000, W(69.7)); tone.frequency.exponentialRampToValueAtTime(900, W(70.2)); tone.frequency.setValueAtTime(900, W(75.5)); tone.frequency.exponentialRampToValueAtTime(20000, W(76.0));

  // everything but the voice ducks under the narrator
  const bed = ctx.createGain(); bed.connect(out);
  const music = ctx.createGain(); const duck = ctx.createGain(); music.connect(duck).connect(bed);
  const drums = ctx.createGain(); drums.gain.value = 0.85; drums.connect(bed);
  const fx = ctx.createGain(); fx.gain.value = 0.75; fx.connect(bed);

  // reverb: generated stereo impulse
  const ir = ctx.createBuffer(2, SR * 3, SR);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
  const verb = ctx.createConvolver(); verb.buffer = ir; const verbOut = ctx.createGain(); verbOut.gain.value = 0.55; verb.connect(verbOut).connect(bed);
  // ping-pong dotted-eighth delay
  const dIn = ctx.createGain(); const dL = ctx.createDelay(2), dR = ctx.createDelay(2); dL.delayTime.value = BEAT * 0.75; dR.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.38; const dLp = ctx.createBiquadFilter(); dLp.frequency.value = 3200;
  const pL = ctx.createStereoPanner(); pL.pan.value = -0.7; const pR = ctx.createStereoPanner(); pR.pan.value = 0.7;
  dIn.connect(dL); dL.connect(pL).connect(bed); dL.connect(dR); dR.connect(pR).connect(bed); dR.connect(dLp).connect(fb).connect(dL);
  const send = (node, wet, bus = verb) => { const g = ctx.createGain(); g.gain.value = wet; node.connect(g).connect(bus); };

  const noiseBuf = ctx.createBuffer(1, SR * 2, SR); { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const noise = (t, len) => { const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.loopStart = rnd() * 1.5; n.start(t, rnd() * 1.5); n.stop(t + len + 0.05); return n; };
  const env = (g, t, a, peak, d, tail = 0.001) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(tail, t + a + d); };
  const osc = (type, f, t, len) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + len + 0.05); return o; };
  const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };

  /* ── instruments ── */
  const kicks = [];
  function kick(t, v = 1) {
    kicks.push(t);
    const o = osc('sine', 150, t, 0.5); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = ctx.createGain(); env(g, t, 0.003, 0.95 * v, 0.42); o.connect(g).connect(drums);
    const n = noise(t, 0.02); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; const gn = ctx.createGain(); env(gn, t, 0.001, 0.22 * v, 0.02); n.connect(hp).connect(gn).connect(drums);
  }
  function clap(t, v = 1) {
    for (const [d, a] of [[0, 1], [0.011, 0.8], [0.023, 0.9]]) {
      const n = noise(t + d, 0.25); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.9;
      const g = ctx.createGain(); env(g, t + d, 0.001, 0.32 * v * a, d === 0.023 ? 0.2 : 0.03); n.connect(bp).connect(g).connect(drums); if (d === 0.023) send(g, 0.35);
    }
  }
  function snare(t, v = 1) {
    const n = noise(t, 0.2); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const g = ctx.createGain(); env(g, t, 0.001, 0.26 * v, 0.12); n.connect(bp).connect(g).connect(drums); send(g, 0.2);
    const o = osc('triangle', 200, t, 0.12); o.frequency.exponentialRampToValueAtTime(160, t + 0.08); const go = ctx.createGain(); env(go, t, 0.001, 0.18 * v, 0.08); o.connect(go).connect(drums);
  }
  function hat(t, v = 1, open = false, p = 0.25) {
    const n = noise(t, open ? 0.3 : 0.06); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 7000 : 8500;
    const g = ctx.createGain(); env(g, t, 0.001, (open ? 0.1 : 0.085) * v, open ? 0.22 : 0.035); n.connect(hp).connect(g).connect(pan(p)).connect(drums);
  }
  function bass(t, note, len = 0.2, v = 1, cutoff = 900) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6; lp.frequency.setValueAtTime(cutoff * 2.4, t); lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * v, t + 0.008); g.gain.setValueAtTime(0.3 * v, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    for (const [ty, f, a] of [['sawtooth', midi(note), 0.6], ['square', midi(note - 12), 0.35]]) { const o = osc(ty, f, t, len); const ga = ctx.createGain(); ga.gain.value = a; o.connect(ga).connect(lp); }
    const sub = osc('sine', midi(note - 12), t, len); const gs = ctx.createGain(); gs.gain.value = 0.9; sub.connect(gs).connect(g);
    lp.connect(g).connect(music);
  }
  const padBus = ctx.createBiquadFilter(); padBus.type = 'lowpass'; padBus.Q.value = 0.8; const padG = ctx.createGain(); padG.gain.value = 0.05;
  padBus.connect(padG).connect(music); send(padG, 0.7);
  function pad(t0, len, notes, v = 1) {
    notes.forEach((n, i) => {
      for (const det of [-9, 0, 8]) {
        const o = osc('sawtooth', midi(n), t0, len + 1.6); o.detune.value = det + (i % 2 ? 3 : -3);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.45 * v, t0 + 0.6); g.gain.setValueAtTime(0.45 * v, t0 + len); g.gain.linearRampToValueAtTime(0, t0 + len + 1.5);
        o.connect(g).connect(pan((i - 2) / 3)).connect(padBus);
      }
    });
  }
  function pluck(t, note, v = 1, p = 0, dly = 0.3) {
    const g = ctx.createGain(); env(g, t, 0.003, 0.11 * v, 0.34);
    const lp = ctx.createBiquadFilter(); lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    for (const [ty, m, a] of [['sawtooth', 1, 0.5], ['triangle', 2, 0.4]]) { const o = osc(ty, midi(note) * m, t, 0.4); const ga = ctx.createGain(); ga.gain.value = a; o.connect(ga).connect(lp); }
    lp.connect(g).connect(pan(p)).connect(music); send(g, dly, dIn); send(g, 0.25);
  }
  function bell(t, note, v = 1, p = 0, len = 1.8) {
    const car = osc('sine', midi(note), t, len); const mod = osc('sine', midi(note) * 3.5, t, len);
    const mi = ctx.createGain(); mi.gain.setValueAtTime(midi(note) * 2.2, t); mi.gain.exponentialRampToValueAtTime(1, t + len * 0.6); mod.connect(mi).connect(car.frequency);
    const g = ctx.createGain(); env(g, t, 0.004, 0.16 * v, len); car.connect(g).connect(pan(p)).connect(music); send(g, 0.5); send(g, 0.25, dIn);
  }
  function lead(t, note, len = 0.4, v = 1) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1 * v, t + 0.01); g.gain.setValueAtTime(0.1 * v, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.25);
    const lp = ctx.createBiquadFilter(); lp.frequency.setValueAtTime(4500, t); lp.frequency.exponentialRampToValueAtTime(1600, t + len); lp.Q.value = 2;
    for (const det of [-6, 6]) { const o = osc('sawtooth', midi(note), t, len + 0.3); o.detune.value = det; o.connect(lp); }
    const sq = osc('square', midi(note + 12), t, len + 0.3); const gq = ctx.createGain(); gq.gain.value = 0.12; sq.connect(gq).connect(lp);
    lp.connect(g).connect(music); send(g, 0.35, dIn); send(g, 0.3);
  }
  function whoosh(tEnd, len = 0.45, v = 1, up = true) {
    const t = tEnd - len; const n = noise(t, len + 0.2); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(up ? 350 : 5000, t); bp.frequency.exponentialRampToValueAtTime(up ? 6000 : 400, tEnd + 0.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * v, tEnd - 0.03); g.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.22);
    const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-0.8, t); p.pan.linearRampToValueAtTime(0.8, tEnd + 0.2);
    n.connect(bp).connect(g).connect(p).connect(fx); send(g, 0.3);
  }
  function riser(t0, t1, v = 1) {
    const n = noise(t0, t1 - t0); const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.Q.value = 2; hp.frequency.setValueAtTime(300, t0); hp.frequency.exponentialRampToValueAtTime(9000, t1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16 * v, t1 - 0.02); g.gain.linearRampToValueAtTime(0, t1);
    n.connect(hp).connect(g).connect(fx); send(g, 0.4);
    const o = osc('sawtooth', 110, t0, t1 - t0); o.frequency.exponentialRampToValueAtTime(880, t1); const lp = ctx.createBiquadFilter(); lp.frequency.setValueAtTime(400, t0); lp.frequency.exponentialRampToValueAtTime(5000, t1);
    const go = ctx.createGain(); go.gain.setValueAtTime(0.0001, t0); go.gain.exponentialRampToValueAtTime(0.05 * v, t1 - 0.02); go.gain.linearRampToValueAtTime(0, t1); o.connect(lp).connect(go).connect(fx);
  }
  function impact(t, v = 1) {
    const o = osc('sine', 72, t, 1.6); o.frequency.exponentialRampToValueAtTime(28, t + 1.2); const g = ctx.createGain(); env(g, t, 0.004, 0.8 * v, 1.5); o.connect(g).connect(fx);
    const n = noise(t, 1.8); const lp = ctx.createBiquadFilter(); lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
    const gn = ctx.createGain(); env(gn, t, 0.002, 0.3 * v, 0.9); n.connect(lp).connect(gn).connect(fx); send(gn, 0.6);
    const c = noise(t, 2.2); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500; const gc = ctx.createGain(); env(gc, t, 0.002, 0.13 * v, 2.0); c.connect(hp).connect(gc).connect(fx); send(gc, 0.5);
  }
  function revCym(tEnd, len = 1.2, v = 1) {
    const t = tEnd - len; const n = noise(t, len); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * v, tEnd - 0.01); g.gain.linearRampToValueAtTime(0, tEnd); n.connect(hp).connect(g).connect(fx); send(g, 0.4);
  }
  function thunk(t, note = 45, v = 1) {
    const o = osc('sine', midi(note + 12), t, 0.35); o.frequency.exponentialRampToValueAtTime(midi(note), t + 0.08); const g = ctx.createGain(); env(g, t, 0.002, 0.55 * v, 0.3); o.connect(g).connect(fx);
    const n = noise(t, 0.08); const lp = ctx.createBiquadFilter(); lp.frequency.value = 900; const gn = ctx.createGain(); env(gn, t, 0.001, 0.25 * v, 0.06); n.connect(lp).connect(gn).connect(fx); send(g, 0.3);
  }
  function blip(t, note, v = 1, len = 0.1, p = 0) {
    const o = osc('sine', midi(note), t, len); o.frequency.exponentialRampToValueAtTime(midi(note + 7), t + len * 0.4);
    const g = ctx.createGain(); env(g, t, 0.002, 0.09 * v, len); o.connect(g).connect(pan(p)).connect(fx); send(g, 0.3); send(g, 0.15, dIn);
  }
  function click(t, v = 1) {
    const o = osc('square', 2200, t, 0.02); const g = ctx.createGain(); env(g, t, 0.001, 0.05 * v, 0.018); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200; o.connect(hp).connect(g).connect(fx);
    const n = noise(t, 0.012); const gn = ctx.createGain(); env(gn, t, 0.0005, 0.12 * v, 0.01); n.connect(gn).connect(fx);
  }
  function key(t, v = 1) { const n = noise(t, 0.02); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500 + rnd() * 1500; const g = ctx.createGain(); env(g, t, 0.0005, 0.09 * v, 0.018); n.connect(bp).connect(g).connect(pan(rnd() * 0.4 - 0.2)).connect(fx); }
  function alarm(t, v = 1) {
    for (const f of [466.2, 493.9]) { const o = osc('square', f, t, 0.35); const lp = ctx.createBiquadFilter(); lp.frequency.value = 2400; const g = ctx.createGain(); env(g, t, 0.003, 0.045 * v, 0.3); o.connect(lp).connect(g).connect(fx); send(g, 0.3); }
  }
  function chime(t, notes = [76, 81, 84, 88], v = 1) { notes.forEach((n, i) => bell(t + i * 0.07, n, 0.9 * v, (i - 1.5) / 3, 1.4)); }

  /* ── voice-over ── */
  const voLines = await Promise.all(VO.map(async (l) => ({ ...l, T: W(l.a) + 0.08, d: VOD[l.id], buf: await ctx.decodeAudioData(await (await fetch(`vo/${l.id}.wav`)).arrayBuffer()) })));
  const voBus = ctx.createGain(); voBus.gain.value = 1.9;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 75;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.gain.value = 2.5; pres.Q.value = 0.8;
  const warm = ctx.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 180; warm.gain.value = 2;
  const vcomp = ctx.createDynamicsCompressor(); vcomp.threshold.value = -20; vcomp.ratio.value = 3; vcomp.attack.value = 0.005; vcomp.release.value = 0.12;
  hp.connect(warm).connect(pres).connect(vcomp).connect(voBus).connect(out);
  const vSend = ctx.createGain(); vSend.gain.value = 0.07; vcomp.connect(vSend).connect(verb);
  for (const l of voLines) { const src = ctx.createBufferSource(); src.buffer = l.buf; src.connect(hp); src.start(l.T); }
  const speaking = (T, pad = 0.25) => voLines.some((l) => T > l.T - pad && T < l.T + l.d + pad);
  bed.gain.setValueAtTime(1, 0);
  // the closing words ride on the hits, so the bed dips less there
  for (const l of voLines) { const a = l.T - 0.18, b = l.T + l.d + 0.12; const deep = l.a >= 90 ? 0.72 : 0.4; bed.gain.setTargetAtTime(deep, a, 0.06); bed.gain.setTargetAtTime(1, b, 0.35); }

  /* ── arrangement (sections are authored-time windows, tested through A(T)) ── */
  const inA = (T, a, b) => { const u = A(T); return u >= a && u < b; };
  padBus.frequency.setValueAtTime(650, 0);
  [[3.5, 800], [7.8, 1300], [8.2, 2600], [12, 1800], [26, 1100], [34, 1600], [41.9, 2600], [42.1, 3800], [84, 4200], [90, 5000], [96, 3000], [104, 900]].forEach(([t, f]) => padBus.frequency.linearRampToValueAtTime(f, W(t)));
  const CH = 2 * BAR;
  for (let T0 = 0; T0 < DUR; T0 += CH) pad(T0, CH, chordAt(T0).pad, A(T0) < 8 ? 1.7 : inA(T0, 90, 96) ? 2.0 : A(T0) >= 96 ? 1.0 : 1);
  pad(W(96), DUR - W(96) - 1.5, [57, 64, 69, 71, 76], 1.0);

  // intro: heartbeat on the half bar, bells on the words, riser into the logo
  for (let T = 0; T < W(8) - 0.3; T += BEAT * 2) { const o = osc('sine', 55, T, 0.5); o.frequency.exponentialRampToValueAtTime(40, T + 0.2); const g = ctx.createGain(); env(g, T, 0.01, 0.42 * (Math.round(T / BEAT / 2) % 2 ? 0.6 : 1), 0.45); o.connect(g).connect(music); }
  // air: a soft filtered-noise bed under the opening and the closing breath
  for (const [a, b, v] of [[0, W(8), 0.08], [W(92.6), W(96), 0.08]]) { const n = noise(a, b - a); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, a); bp.frequency.linearRampToValueAtTime(1400, b); bp.Q.value = 0.6; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(v, a + 1.5); g.gain.setValueAtTime(v, b - 0.6); g.gain.linearRampToValueAtTime(0.0001, b); n.connect(bp).connect(g).connect(pan(0)).connect(fx); send(g, 0.5); }
  // a sub drone that swells through the breath after "Govern."
  { const a = W(92.6), b = W(96); const o = osc('sine', midi(33), a, b - a); const o2 = osc('triangle', midi(45), a, b - a); const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(0.25, b - 0.2); g.gain.linearRampToValueAtTime(0, b); o.connect(g); const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2).connect(g); g.connect(music); }
  riser(W(94.2), W(96), 0.8);
  [[0.5, 76], [0.75, 72], [4.0, 79], [4.5, 81]].forEach(([t, n]) => bell(W(t), n, 0.9));
  riser(W(5.6), W(8), 1.1); revCym(W(8), 1.6, 1.1);
  impact(W(8), 1.2);
  [8.12, 8.37, 8.62].forEach((t, i) => thunk(W(t), [45, 48, 52][i], 0.9));
  chime(W(8.9), [69, 76, 81, 88], 0.9);
  for (let T = W(8.5); T < W(12); T += BEAT / 2) { const c = chordAt(T).pad; pluck(T, c[[0, 2, 4, 3][Math.round(T / BEAT * 2) % 4]] + 12, 0.85, Math.sin(T * 3) * 0.5, 0.35); }

  const kickOn = (T) => inA(T, 12, 26) || (inA(T, 34, 38.6) && Math.round(T / BEAT) % 2 === 0) || inA(T, 38.6, 41.75) || inA(T, 42, 89.75);
  const stopAt = [W(41.75), W(89.75)];
  for (let i = 0; i * BEAT < DUR; i++) {
    const T = i * BEAT; const b = i % 4; const u = A(T);
    if (stopAt.some((s) => T >= s - 0.01 && T < s + BEAT * 0.5)) continue;
    const under = u >= 70 && u < 76;
    if (kickOn(T)) kick(T, under ? 1.1 : 1);
    const full = inA(T, 42, 89.75) || inA(T, 38.6, 41.75);
    if ((inA(T, 16, 26) || full) && (b === 1 || b === 3)) clap(T, under ? 0.7 : 1);
    if (inA(T, 12, 41.75) || inA(T, 42, 89.75)) {
      hat(T + BEAT / 2, 0.85, full && !under, 0.3);
      if (inA(T, 16, 41.75) || full) { hat(T + BEAT / 4, 0.45, false, -0.3); hat(T + (3 * BEAT) / 4, 0.5, false, -0.2); }
    }
    const c = chordAt(T);
    if (inA(T, 12, 26) || inA(T, 34, 41.75) || inA(T, 42, 89.75)) {
      for (const k of [0, 1]) bass(T + k * BEAT / 2, c.root + (k === 1 && b === 3 ? 12 : 0), 0.26, inA(T, 12, 16) ? 0.7 : 1, full ? 1100 : 700);
    } else if (inA(T, 26, 34)) {
      for (let k = 0; k < 4; k++) bass(T + k * BEAT / 4, c.root + (k === 2 ? 12 : 0), 0.12, 0.55, 380 + 900 * ((u - 26) / 8));
    }
    if (inA(T, 16, 26) || inA(T, 30, 41.75) || inA(T, 42, 90)) {
      for (let k = 0; k < 4; k++) { const tt = T + k * BEAT / 4; const idx = [0, 2, 1, 3, 2, 4, 3, 1][(i * 4 + k) % 8]; pluck(tt, c.pad[idx] + 12, under ? 0.3 : 0.42, (k % 2 ? -1 : 1) * 0.45, 0.2); }
    }
  }
  duck.gain.setValueAtTime(1, 0);
  for (const k of kicks) { duck.gain.setValueAtTime(1, k - 0.002); duck.gain.linearRampToValueAtTime(0.4, k + 0.01); duck.gain.linearRampToValueAtTime(1, k + 0.26); }

  // lead hook between the lines (it never plays over the narrator)
  const HOOK = [[0, 76, 0.4], [0.75, 79, 0.2], [1.0, 81, 0.6], [2.0, 79, 0.25], [2.5, 76, 0.25], [3.0, 74, 0.8], [4.0, 72, 0.4], [4.75, 74, 0.2], [5.0, 76, 0.6], [6.0, 79, 0.25], [6.5, 81, 0.25], [7.0, 84, 0.9]];
  const snap = (T) => Math.round(T / BEAT) * BEAT;
  for (let T0 = snap(W(42)); T0 < W(89.5); T0 += 4 * BAR) for (const [bt, n, l] of HOOK) { const T = T0 + bt * BEAT; if (T < W(89.6) && !speaking(T, 0.4) && !speaking(T + l, 0.2)) lead(T, n, l * 1.2, 0.85); }

  // build into the drop at 42: snare roll, riser, a beat of silence, impact
  for (let T = W(40); T < W(41.75); T += T < W(41) ? BEAT / 4 : BEAT / 8) snare(T, 0.4 + 0.6 * (T - W(40)) / (W(41.75) - W(40)));
  riser(W(38.6), W(42), 1.2); revCym(W(42), 1.2, 1.2); impact(W(42), 1.4);
  for (let T = W(88); T < W(89.75); T += T < W(89) ? BEAT / 4 : BEAT / 8) snare(T, 0.4 + 0.6 * (T - W(88)) / (W(89.75) - W(88)));
  riser(W(86.5), W(89.8), 1.1);
  [90, 91, 92].forEach((t, i) => { impact(W(t), 1.3); [0, 3, 7, 12].forEach((d) => lead(W(t), [57, 60, 64][i] + d, 0.7, 0.6)); });
  revCym(W(96), 1.8, 0.9); impact(W(96), 1.0);
  [96.25, 96.47, 96.69].forEach((t, i) => thunk(W(t), [45, 48, 52][i], 0.8));
  chime(W(96.95), [69, 76, 81, 84, 88], 1.0);
  bell(W(101.6), 81, 0.7); bell(W(102.1), 76, 0.6); bell(W(102.8), 69, 0.8, 0, 4);

  // transitions
  const CUTS = [12, 20, 26, 34, 48, 56, 60.5, 64, 67, 70, 73.5, 76, 80.4, 84];
  for (const c of CUTS) whoosh(W(c), 0.5, 0.9);
  for (const c of [12, 20, 26, 34, 48, 56, 64, 70, 76, 84]) impact(W(c), 0.4);

  // on-screen cues
  [12.4, 12.65, 12.9].forEach((t) => whoosh(W(t + 0.25), 0.3, 0.45, false));
  alarm(W(14.9), 0.8);
  for (let i = 0; i < 7; i++) { click(W(fileLand(i)), 0.9); blip(W(fileSeal(i)), 81 + [0, 3, 5, 7, 10, 12, 15][i], 0.7, 0.14, (i - 3) / 5); }
  for (let T = W(26.4); T < W(33.8); T += BEAT / 4) if (rnd() > 0.55) blip(T, 96 + Math.floor(rnd() * 8), 0.18, 0.03, rnd() - 0.5);
  [27.6, 28.05, 28.5, 28.95].forEach((t) => click(W(t), 0.7));
  for (let i = 0; i < 5; i++) blip(W(30.45 + i * 0.3), 84 + [0, 2, 4, 7, 9][i], 0.5, 0.1);
  for (let i = 1; i < 24; i++) key(W(34.6 + (i / 24) * 0.7), 0.6);
  const PENT = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91];
  sim.forEach((c, i) => blip(W(c.pub), PENT[i % PENT.length], 0.55, 0.12, ((i % 5) - 2) / 3));
  for (let k = 0; k < 24; k++) blip(W(42.35 + (k / 24) * 4.85), PENT[(k + 3) % PENT.length] + 12, 0.25, 0.06, ((k % 3) - 1) / 2);
  for (let t = 59.3; t < 60.1; t += 0.035) key(W(t), 0.7);
  blip(W(59.1), 81, 0.7, 0.2);
  alarm(W(64.5), 0.8); alarm(W(65.9), 0.7);
  whoosh(W(72.1), 0.5, 0.5, false);
  whoosh(W(78.8), 0.5, 0.5);
  chime(W(78.9), [72, 76, 79, 84], 0.9);
  WALL.forEach((_, i) => blip(W(84.05 + i * 0.5), 79 + [0, 2, 5, 7, 9, 12][i], 0.55, 0.12));
  for (const e of events) {
    if (e.type !== 'click' && e.type !== 'key') continue;
    const T = filmOfRec(e.t); if (T === null) continue;
    e.type === 'click' ? click(T, 1.0) : key(T, 0.8);
  }

  // fades
  out.gain.setValueAtTime(0.0001, 0); out.gain.exponentialRampToValueAtTime(0.55, 0.4);
  out.gain.setValueAtTime(0.55, DUR - 3.5); out.gain.linearRampToValueAtTime(0, DUR);

  const buf = await ctx.startRendering();
  return b64(wav(buf));
}

function wav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 2; const ab = new ArrayBuffer(bytes); const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s * 0x7fff, true); o += 2; }
  return ab;
}
function b64(ab) { let bin = ''; const u8 = new Uint8Array(ab); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(bin); }

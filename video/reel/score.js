// Original score for the reel, rendered offline with Web Audio: 120 BPM in A minor, cut to the picture.
// Drums, sidechained bass, pads, arpeggio and a lead hook, plus sound design cued to what is on screen
// (wipes, impacts, file seals, chunk publications, clicks and typing in the Studio footage).
const SR = 48000, DUR = 104, BEAT = 0.5, BAR = 2;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const between = (t, a, b) => t >= a && t < b;

// Am9 – Fmaj7 – C – G, one chord per two bars
const CHORDS = [
  { root: 45, pad: [57, 60, 64, 67, 71] }, { root: 41, pad: [57, 60, 64, 65, 69] },
  { root: 48, pad: [55, 60, 64, 67, 71] }, { root: 43, pad: [55, 59, 62, 67, 69] },
];
const chordAt = (t) => CHORDS[Math.floor(t / 4) % 4];

export async function score({ sim, fileLand, fileSeal, CLIPS, WALL, events }) {
  const ctx = new OfflineAudioContext(2, DUR * SR, SR);
  let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  /* ── buses ── */
  const out = ctx.createGain(); out.gain.value = 0.55;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -14; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.2;
  const limit = ctx.createDynamicsCompressor(); limit.threshold.value = -2.5; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1; limit.knee.value = 0;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 20000; tone.Q.value = 0.5;
  out.connect(tone).connect(glue).connect(limit).connect(ctx.destination);
  // underground: the whole mix goes muffled, then opens again
  tone.frequency.setValueAtTime(20000, 69.6); tone.frequency.exponentialRampToValueAtTime(700, 70.2); tone.frequency.setValueAtTime(700, 75.4); tone.frequency.exponentialRampToValueAtTime(20000, 76.0);

  const music = ctx.createGain(); const duck = ctx.createGain(); music.connect(duck).connect(out);
  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(out);
  const fx = ctx.createGain(); fx.gain.value = 0.8; fx.connect(out);

  // reverb: generated stereo impulse
  const ir = ctx.createBuffer(2, SR * 3, SR);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
  const verb = ctx.createConvolver(); verb.buffer = ir; const verbOut = ctx.createGain(); verbOut.gain.value = 0.55; verb.connect(verbOut).connect(out);
  // ping-pong dotted-eighth delay
  const dIn = ctx.createGain(); const dL = ctx.createDelay(2), dR = ctx.createDelay(2); dL.delayTime.value = 0.375; dR.delayTime.value = 0.375;
  const fb = ctx.createGain(); fb.gain.value = 0.38; const dLp = ctx.createBiquadFilter(); dLp.frequency.value = 3200;
  const pL = ctx.createStereoPanner(); pL.pan.value = -0.7; const pR = ctx.createStereoPanner(); pR.pan.value = 0.7;
  dIn.connect(dL); dL.connect(pL).connect(out); dL.connect(dR); dR.connect(pR).connect(out); dR.connect(dLp).connect(fb).connect(dL);
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

  /* ── arrangement ── */
  // pads throughout, brighter as the film opens up
  const cut = (t) => padBus.frequency.linearRampToValueAtTime(t[1], t[0]);
  padBus.frequency.setValueAtTime(350, 0);
  [[7.8, 900], [8.2, 2600], [12, 1800], [26, 1100], [34, 1600], [41.9, 2600], [42.1, 3800], [84, 4200], [90, 5000], [96, 3000], [104, 900]].forEach(cut);
  for (let t0 = 0; t0 < DUR; t0 += 4) pad(t0, 4, chordAt(t0).pad, t0 < 8 ? 0.5 : t0 >= 90 && t0 < 96 ? 1.25 : 1);
  pad(96, 6.5, [57, 64, 69, 71, 76], 1.1);

  // intro: heartbeat, bells on the words, riser into the logo
  for (let t = 0; t < 8; t += 1) { const o = osc('sine', 55, t, 0.5); o.frequency.exponentialRampToValueAtTime(40, t + 0.2); const g = ctx.createGain(); env(g, t, 0.01, 0.22 * (t % 2 ? 0.6 : 1), 0.4); o.connect(g).connect(music); }
  [[0.5, 76], [0.75, 72], [4.0, 79], [4.5, 81]].forEach(([t, n]) => bell(t, n, 0.9));
  riser(5.4, 8, 1.1); revCym(8, 1.4, 1.1);
  impact(8, 1.2);
  [8.12, 8.37, 8.62].forEach((t, i) => thunk(t, [45, 48, 52][i], 0.9));
  chime(8.9, [69, 76, 81, 88], 0.9);

  // bell arpeggio under the logo
  for (let t = 8.5; t < 12; t += 0.25) { const c = chordAt(t).pad; pluck(t, c[[0, 2, 4, 3][Math.round(t * 4) % 4]] + 12, 0.55, Math.sin(t * 3) * 0.5, 0.35); }

  // drums, bass, arp: section by section
  const kickOn = (t) => between(t, 12, 26) || (between(t, 34, 38.6) && Math.round(t / BEAT) % 2 === 0) || between(t, 38.6, 41.75) || between(t, 42, 89.75) || between(t, 90, 90.01) || between(t, 91, 91.01) || between(t, 92, 92.01) || between(t, 96, 96.01);
  for (let i = 0; i * BEAT < DUR; i++) {
    const t = i * BEAT; const b = i % 4;
    if (kickOn(t)) kick(t, between(t, 70, 76) ? 1.1 : 1);
    const full = between(t, 42, 89.75) || between(t, 38.6, 41.75);
    if ((between(t, 16, 26) || full) && (b === 1 || b === 3)) clap(t, between(t, 70, 76) ? 0.7 : 1);
    // hats
    if (between(t, 12, 26) || between(t, 26, 34) || between(t, 34, 41.75) || between(t, 42, 89.75)) {
      hat(t + BEAT / 2, 0.9, full && !between(t, 70, 76), 0.3);
      if (between(t, 16, 26) || full || between(t, 26, 34)) { hat(t + BEAT / 4, 0.5, false, -0.3); hat(t + (3 * BEAT) / 4, 0.55, false, -0.2); }
    }
    // bass: 8ths, sidechained
    const c = chordAt(t);
    if (between(t, 12, 26) || between(t, 34, 41.75) || between(t, 42, 89.75)) {
      for (const k of [0, 1]) { const tt = t + k * BEAT / 2; bass(tt, c.root + (k === 1 && b === 3 ? 12 : 0), 0.22, between(t, 12, 16) ? 0.7 : 1, between(t, 42, 90) ? 1100 : 700); }
    } else if (between(t, 26, 34)) {
      // AI reading: pulsing filtered sixteenths, "byte by byte"
      for (let k = 0; k < 4; k++) bass(t + k * BEAT / 4, c.root + (k === 2 ? 12 : 0), 0.1, 0.55, 380 + 900 * ((t - 26) / 8));
    }
    // arpeggio
    if (between(t, 16, 26) || between(t, 30, 41.75) || between(t, 42, 90)) {
      for (let k = 0; k < 4; k++) { const tt = t + k * BEAT / 4; const idx = [0, 2, 1, 3, 2, 4, 3, 1][(i * 4 + k) % 8]; pluck(tt, c.pad[idx] + 12, between(t, 70, 76) ? 0.35 : 0.5, (k % 2 ? -1 : 1) * 0.45, 0.22); }
    }
  }
  // sidechain pump on the music bus
  duck.gain.setValueAtTime(1, 0);
  for (const k of kicks) { duck.gain.setValueAtTime(1, k - 0.002); duck.gain.linearRampToValueAtTime(0.35, k + 0.01); duck.gain.linearRampToValueAtTime(1, k + 0.22); }

  // lead hook in the drop sections (A minor pentatonic, chord tones on the downbeats)
  const HOOK = [[0, 76, 0.4], [0.75, 79, 0.2], [1.0, 81, 0.6], [2.0, 79, 0.25], [2.5, 76, 0.25], [3.0, 74, 0.8], [4.0, 72, 0.4], [4.75, 74, 0.2], [5.0, 76, 0.6], [6.0, 79, 0.25], [6.5, 81, 0.25], [7.0, 84, 0.9]];
  for (const s0 of [44, 48, 52, 64, 68, 76, 80, 84, 88]) for (const [b, n, l] of HOOK) { const t = s0 + b * BEAT; if (t < 89.7) lead(t, n, l, s0 >= 84 ? 1.1 : 0.9); }

  // build into the drop at 42: snare roll, riser, silence, impact
  for (let t = 40; t < 41.75; t += t < 41 ? 0.125 : 0.0625) snare(t, 0.4 + 0.6 * (t - 40) / 1.75);
  riser(38.6, 42, 1.2); revCym(42, 1, 1.2); impact(42, 1.4);
  // build into the finale at 90
  for (let t = 88; t < 89.75; t += t < 89 ? 0.125 : 0.0625) snare(t, 0.4 + 0.6 * (t - 88) / 1.75);
  riser(86.5, 89.75, 1.1);
  // Identify · Prove · Govern: three hits, chord stabs
  [90, 91, 92].forEach((t, i) => { impact(t, 1.3); [0, 3, 7, 12].forEach((d) => lead(t, [57, 60, 64][i] + d, 0.5, 0.7)); });
  revCym(96, 1.6, 0.9); impact(96, 1.0);
  [96.25, 96.47, 96.69].forEach((t, i) => thunk(t, [45, 48, 52][i], 0.8));
  chime(96.9, [69, 76, 81, 84, 88], 1.1);
  bell(98.5, 81, 0.8); bell(99.0, 76, 0.7); bell(100.5, 69, 0.8, 0, 3);

  // transitions: a whoosh into every cut, a hit on the section changes
  const CUTS = [12, 20, 26, 34, 48, 56, 60.5, 64, 67, 70, 73.5, 76, 80.4, 84];
  for (const c of CUTS) whoosh(c, 0.42, 1);
  for (const c of [12, 20, 26, 34, 48, 56, 64, 70, 76, 84]) impact(c, 0.45);

  // on-screen cues
  [12.4, 12.65, 12.9].forEach((t) => whoosh(t + 0.25, 0.3, 0.5, false));   // documents fly in
  [12.35, 12.85, 13.35].forEach((t, i) => bell(t, [76, 79, 70][i], 0.7));   // "One flat. Three records. Three answers."
  alarm(14.9, 1);
  for (let i = 0; i < 7; i++) { click(fileLand(i), 0.9); blip(fileSeal(i), 81 + [0, 3, 5, 7, 10, 12, 15][i], 0.8, 0.14, (i - 3) / 5); }
  // AI reading: byte blips
  for (let t = 26.4; t < 33.8; t += 0.125) if (rnd() > 0.55) blip(t, 96 + Math.floor(rnd() * 8), 0.22, 0.03, rnd() - 0.5);
  [27.6, 28.05, 28.5, 28.95].forEach((t) => click(t, 0.8));
  for (let i = 0; i < 5; i++) blip(30.45 + i * 0.3, 84 + [0, 2, 4, 7, 9][i], 0.6, 0.1);
  // chunk engine: cuts, then each publication rings a note of the pentatonic scale
  for (let i = 1; i < 24; i++) key(34.6 + (i / 24) * 0.7, 0.7);
  const PENT = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91];
  sim.forEach((c, i) => blip(c.pub, PENT[i % PENT.length], 0.65, 0.12, ((i % 5) - 2) / 3));
  // stream: buildings arrive in chunks
  for (let k = 0; k < 24; k++) blip(42.35 + (k / 24) * 4.85, PENT[(k + 3) % PENT.length] + 12, 0.28, 0.06, ((k % 3) - 1) / 2);
  // 3D ULPIN code types out; checks; underground; verification
  for (let t = 59.3; t < 60.1; t += 0.035) key(t, 0.8);
  blip(59.1, 81, 0.8, 0.2);
  alarm(64.5, 1); alarm(65.9, 0.9);
  whoosh(72.1, 0.5, 0.6, false);
  whoosh(78.8, 0.5, 0.6);                    // scan beam
  chime(78.9, [72, 76, 79, 84], 1);          // valid
  WALL.forEach((_, i) => blip(84.05 + i * 0.5, 79 + [0, 2, 5, 7, 9, 12][i], 0.6, 0.12));

  // Studio footage: the real clicks and keystrokes, mapped to film time
  const filmOf = (r) => { for (const c of Object.values(CLIPS)) { for (const p of c.ps) if (r >= p.r0 && r <= p.r1) return c.start + p.f0 + (r - p.r0) / p.sp; } return null; };
  for (const e of events) {
    if (e.type !== 'click' && e.type !== 'key') continue;
    const t = filmOf(e.t); if (t === null) continue;
    e.type === 'click' ? click(t, 1.1) : key(t, 0.9);
  }

  // fades
  out.gain.setValueAtTime(0.0001, 0); out.gain.exponentialRampToValueAtTime(0.55, 0.4);
  out.gain.setValueAtTime(0.55, 101.5); out.gain.linearRampToValueAtTime(0, 104);

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

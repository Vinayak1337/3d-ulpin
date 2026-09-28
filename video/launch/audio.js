// Soundtrack rendered offline with Web Audio, cued to the video timeline. Returns a 16-bit stereo WAV.
const SR = 48000;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export async function soundtrack({ dur, hits, blips, ticks, seals }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);
  master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.9, 1.5);
  master.gain.setValueAtTime(0.9, dur - 3); master.gain.linearRampToValueAtTime(0, dur - 0.1);

  // a simple stereo "room": two feedback delays
  const verbIn = ctx.createGain(); verbIn.gain.value = 0.35;
  for (const [d, pan] of [[0.083, -0.6], [0.117, 0.6]]) {
    const dl = ctx.createDelay(1); dl.delayTime.value = d; const fb = ctx.createGain(); fb.gain.value = 0.62; const lp = ctx.createBiquadFilter(); lp.frequency.value = 3200;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    verbIn.connect(dl); dl.connect(lp).connect(fb).connect(dl); lp.connect(p).connect(master);
  }
  const send = (node, wet = 0.3) => { const g = ctx.createGain(); g.gain.value = wet; node.connect(g).connect(verbIn); };

  // intensity over time (0..1)
  const I = [[0, 0.15], [3, 0.25], [9, 0.45], [14, 0.3], [26, 0.35], [37, 0.45], [53, 0.6], [78, 0.8], [92, 0.7], [108, 0.75], [134, 0.6], [143, 0.55], [157, 0.5], [175, 0.8], [184, 1.0], [188, 0.45], [dur, 0.2]];
  const inten = (t) => { for (let i = 1; i < I.length; i++) if (t <= I[i][0]) { const [a, va] = I[i - 1], [b, vb] = I[i]; return va + (vb - va) * (t - a) / (b - a); } return 0.2; };

  // pad: Dm9 – Bbmaj7 – Fmaj7 – C(add9), 10 s per chord
  const chords = [[50, 57, 60, 64, 65], [46, 53, 57, 62, 65], [41, 53, 57, 60, 64], [48, 55, 59, 62, 67]];
  const padBus = ctx.createBiquadFilter(); padBus.type = 'lowpass'; padBus.Q.value = 0.7;
  for (let t = 0; t <= dur; t += 0.5) padBus.frequency.linearRampToValueAtTime(500 + 2600 * inten(t), t);
  const padGain = ctx.createGain(); padGain.gain.value = 0.05; padBus.connect(padGain).connect(master); send(padGain, 0.6);
  const CH = 10;
  for (let k = 0; k * CH < dur; k++) {
    const t0 = k * CH, notes = chords[k % 4];
    for (const n of notes) for (const det of [-7, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n + 12); o.detune.value = det;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 2.2); g.gain.setValueAtTime(0.5, t0 + CH - 0.3); g.gain.linearRampToValueAtTime(0, t0 + CH + 2.2);
      o.connect(g).connect(padBus); o.start(t0); o.stop(Math.min(dur, t0 + CH + 2.3));
    }
    // sub bass on the root, from the problem section on
    if (t0 + CH > 13) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(notes[0] - 12);
      const g = ctx.createGain(); const a = Math.max(t0, 14); g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(0.16, a + 1); g.gain.setValueAtTime(0.16, t0 + CH - 0.2); g.gain.linearRampToValueAtTime(0, t0 + CH + 0.2);
      o.connect(g).connect(master); o.start(a); o.stop(Math.min(dur, t0 + CH + 0.3));
    }
  }

  const noiseBuf = ctx.createBuffer(1, SR * 2, SR); { const d = noiseBuf.getChannelData(0); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } }
  const noise = (t, len) => { const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.start(t); n.stop(t + len); return n; };

  // rhythm: 96 bpm
  const beat = 60 / 96;
  const drumOn = (t) => (t >= 53 && t < 143) || (t >= 175 && t < 187.6);
  const hatOn = (t) => (t >= 78 && t < 134) || (t >= 179 && t < 187.6);
  for (let t = 0; t < dur; t += beat) {
    const bi = Math.round(t / beat);
    if (drumOn(t) && (t < 134 || bi % 2 === 0)) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.55 * (0.6 + 0.4 * inten(t)), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.45);
    }
    if (hatOn(t)) for (const off of [0.5]) {
      const tt = t + off * beat; const n = noise(tt, 0.08); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.07, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.07);
      n.connect(hp).connect(g).connect(master);
    }
  }
  // arpeggio (16ths) on chord tones
  const arpOn = (t) => (t >= 56 && t < 92) || (t >= 108 && t < 122) || (t >= 176 && t < 187.6);
  for (let t = 0, i = 0; t < dur; t += beat / 2, i++) {
    if (!arpOn(t)) continue;
    const notes = chords[Math.floor(t / CH) % 4]; const n = notes[[1, 2, 3, 4, 3, 2][i % 6]] + 12;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midi(n);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    const p = ctx.createStereoPanner(); p.pan.value = Math.sin(i * 0.9) * 0.5;
    o.connect(g).connect(p).connect(master); send(g, 0.4); o.start(t); o.stop(t + 0.3);
  }
  // risers into and impacts on every cut
  for (const t of hits) {
    const r0 = Math.max(0, t - 1.4); const n = noise(r0, 1.45); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, r0); bp.frequency.exponentialRampToValueAtTime(6000, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, r0); g.gain.exponentialRampToValueAtTime(0.09, t - 0.02); g.gain.linearRampToValueAtTime(0, t + 0.03);
    n.connect(bp).connect(g).connect(master); send(g, 0.3);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    const go = ctx.createGain(); go.gain.setValueAtTime(0.5, t); go.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(go).connect(master); o.start(t); o.stop(t + 1.7);
    const nb = noise(t, 0.6); const lp = ctx.createBiquadFilter(); lp.frequency.value = 900; const gn = ctx.createGain(); gn.gain.setValueAtTime(0.12, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    nb.connect(lp).connect(gn).connect(master); send(gn, 0.5);
  }
  // UI blips: chunk publications, seals and typing
  const blip = (t, f, v, len = 0.09) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + len * 0.5); const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + len); o.connect(g).connect(master); send(g, 0.35); o.start(t); o.stop(t + len + 0.02); };
  blips.forEach((t, i) => blip(t, 1320 + (i % 5) * 110, 0.05));
  seals.forEach((t) => blip(t, 990, 0.06, 0.14));
  ticks.forEach((t) => { const n = noise(t, 0.02); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000; const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02); n.connect(hp).connect(g).connect(master); });

  const buf = await ctx.startRendering();
  return wav(buf);
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

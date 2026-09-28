// Deterministic timeline helpers: every visual is a pure function of time t (seconds).
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const E = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
/** 0→1 between a and b with easing. */
export const P = (t, a, b, e = E.linear) => e(clamp((t - a) / (b - a)));
/** In over [a, a+din], out over [b-dout, b]. */
export const inout = (t, a, b, din = 0.6, dout = 0.5, ei = E.outCubic, eo = E.inCubic) =>
  Math.min(P(t, a, a + din, ei), 1 - P(t, b - dout, b, eo));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Wrap each word of the element's text nodes in .w spans, keeping inline markup (e.g. <span class=hl>). */
export function splitWords(el) {
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
          const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.appendChild(s);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === 1 && !child.classList.contains('w')) walk(child);
    }
  };
  walk(el);
  return $$('.w', el);
}

/** Word-by-word reveal (rise + unblur) and exit (lift + fade). */
export function wordsAt(words, t, a, b, { stagger = 0.045, din = 0.7, dout = 0.45, rise = 38, blur = 10 } = {}) {
  words.forEach((w, i) => {
    const pin = P(t, a + i * stagger, a + i * stagger + din, E.outExpo);
    const pout = P(t, b - dout, b, E.inCubic);
    const o = pin * (1 - pout);
    w.style.opacity = o.toFixed(3);
    w.style.transform = `translateY(${((1 - pin) * rise - pout * 20).toFixed(1)}px)`;
    w.style.filter = o < 0.999 ? `blur(${((1 - pin) * blur + pout * 6).toFixed(1)}px)` : 'none';
  });
}

export const show = (el, on, d = 'block') => { el.style.display = on ? d : 'none'; };
export const css = (el, o) => { for (const k in o) el.style[k] = o[k]; };
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Deterministic PRNG. */
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

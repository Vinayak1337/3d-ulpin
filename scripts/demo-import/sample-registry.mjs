/**
 * Registry sample data for the presentation build: registered holders and occupants of each unit, and
 * (for buildings that have no floor records) a floor and unit layout from the footprint and roof height.
 * Deterministic: the same building always yields the same people and layout. Plain JS with no
 * dependencies, so the dev server (Node) and the browser's local data layer share it.
 */

const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/** mulberry32 seeded from a string. */
export function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

const NAMES = {
  IN: {
    male: ['Aarav', 'Rohan', 'Vikram', 'Sanjay', 'Rahul', 'Amit', 'Karan', 'Arjun', 'Nikhil', 'Suresh', 'Manoj', 'Pranav', 'Imran', 'Farhan', 'Joseph', 'Harpreet', 'Gurdeep', 'Venkatesh', 'Srinivas', 'Anil', 'Deepak', 'Rajesh', 'Siddharth', 'Kunal', 'Omkar'],
    female: ['Priya', 'Anjali', 'Sneha', 'Kavya', 'Meera', 'Pooja', 'Neha', 'Aditi', 'Shreya', 'Lakshmi', 'Sunita', 'Farah', 'Ayesha', 'Mary', 'Simran', 'Deepa', 'Radhika', 'Swati', 'Nandini', 'Ishita', 'Rukmini', 'Gauri', 'Tanvi', 'Revathi', 'Madhuri'],
    surname: ['Sharma', 'Patil', 'Kulkarni', 'Deshmukh', 'Joshi', 'Iyer', 'Nair', 'Reddy', 'Gupta', 'Mehta', 'Shah', 'Khan', 'Shaikh', 'Fernandes', "D'Souza", 'Singh', 'Gill', 'Rao', 'Menon', 'Chatterjee', 'Banerjee', 'Pawar', 'Jadhav', 'Bhosale', 'Agarwal'],
  },
  US: {
    male: ['James', 'Michael', 'David', 'Daniel', 'Anthony', 'Kevin', 'Jason', 'Luis', 'Carlos', 'Wei', 'Hiroshi', 'Samuel', 'Marcus', 'Andre', 'Patrick', 'Thomas', 'Jonathan', 'Ethan', 'Noah', 'Raj'],
    female: ['Mary', 'Jennifer', 'Linda', 'Sarah', 'Jessica', 'Emily', 'Maria', 'Sofia', 'Grace', 'Mei', 'Yuki', 'Aisha', 'Olivia', 'Hannah', 'Rachel', 'Nicole', 'Elena', 'Chloe', 'Priya', 'Laura'],
    surname: ['Smith', 'Johnson', 'Williams', 'Brown', 'Garcia', 'Martinez', 'Chen', 'Wong', 'Lee', 'Kim', 'Rodriguez', 'Nguyen', "O'Brien", 'Murphy', 'Cohen', 'Rossi', 'Patel', 'Jackson', 'Rivera', 'Tanaka'],
  },
};

const iso = (r, fromYear, toYear) => {
  const y = fromYear + Math.floor(r() * (toYear - fromYear + 1));
  const m = 1 + Math.floor(r() * 12), d = 1 + Math.floor(r() * 27);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * Holders and occupants of each unit.
 * @param {string} buildingId
 * @param {{ spaceId: string, unit: string, level: string }[]} units
 * @param {{ locale?: 'IN' | 'US', asOf?: string, registrar?: string }} [options]
 */
export function residentsFor(buildingId, units, options = {}) {
  const names = NAMES[options.locale ?? 'IN'];
  const us = options.locale === 'US';
  return {
    buildingId,
    asOf: options.asOf ?? '2026-09-24',
    source: options.registrar ?? (us ? 'Department of Finance · deed records; building resident register' : 'Sub-Registrar deed index; society member and tenant register'),
    units: units.map(({ spaceId, unit, level }) => {
      const r = rng(`${buildingId}:${spaceId}`);
      const surname = pick(r, names.surname);
      const head = { name: `${pick(r, names.male)} ${surname}`, female: false };
      const spouse = { name: `${pick(r, names.female)} ${surname}`, female: true };
      const [first, second] = r() < 0.4 ? [spouse, head] : [head, spouse];
      const joint = r() < 0.55;
      const since = iso(r, 2006, 2025);
      const year = since.slice(0, 4);
      const deedNo = us ? `CRFN ${year}000${String(Math.floor(r() * 900000) + 100000)}` : `${pick(r, ['HVL', 'PNE', 'HVL-2', 'MUL'])}/${String(Math.floor(r() * 90000) + 10000)}/${year}`;
      const holders = joint
        ? [{ name: first.name, sharePct: 50, since, deedNo }, { name: second.name, sharePct: 50, since, deedNo }]
        : [{ name: first.name, sharePct: 100, since, deedNo }];
      const roll = r();
      const occupancy = roll < 0.68 ? 'owner_occupied' : roll < 0.9 ? 'rented' : 'vacant';
      const occupants = [];
      const via = us ? 'Building resident register' : 'Society member register';
      if (occupancy === 'owner_occupied') {
        occupants.push({ name: first.name, relation: 'Holder', since, registeredVia: via });
        occupants.push({ name: second.name, relation: joint ? 'Joint holder' : first.female ? 'Husband' : 'Wife', since, registeredVia: via });
        const kids = Math.floor(r() * 3);
        for (let k = 0; k < kids; k++) {
          const girl = r() < 0.5;
          occupants.push({ name: `${pick(r, girl ? names.female : names.male)} ${surname}`, relation: girl ? 'Daughter' : 'Son', since: iso(r, Number(year), 2025), registeredVia: via });
        }
        if (r() < 0.25) occupants.push({ name: `${pick(r, names.female)} ${surname}`, relation: 'Mother', since, registeredVia: via });
      } else if (occupancy === 'rented') {
        const ts = pick(r, names.surname);
        const start = iso(r, 2023, 2026);
        const tenantVia = us ? 'Lease on file with managing agent' : 'Leave and licence agreement · police tenant verification';
        occupants.push({ name: `${pick(r, names.male)} ${ts}`, relation: 'Tenant', since: start, registeredVia: tenantVia });
        if (r() < 0.7) occupants.push({ name: `${pick(r, names.female)} ${ts}`, relation: 'Tenant family', since: start, registeredVia: tenantVia });
        if (r() < 0.4) occupants.push({ name: `${pick(r, r() < 0.5 ? names.female : names.male)} ${ts}`, relation: 'Tenant family', since: start, registeredVia: tenantVia });
      }
      return { spaceId, unit, level, occupancy, holders, occupants };
    }),
  };
}

// ------------------------------------------------------------------ layout for buildings without floor records

/** Sutherland–Hodgman: clip a ring against a convex clip ring (both counter-clockwise, open or closed). */
function clip(subject, clipRing) {
  let out = subject.slice(0, subject[0][0] === subject.at(-1)[0] && subject[0][1] === subject.at(-1)[1] ? -1 : undefined);
  const c = clipRing.slice(0, -1);
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cross = (p, q) => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      if (inside(q)) { if (!inside(p)) out.push(cross(p, q)); out.push(q); } else if (inside(p)) out.push(cross(p, q));
    }
  }
  if (out.length < 3) return null;
  return [...out.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), [Math.round(out[0][0] * 100) / 100, Math.round(out[0][1] * 100) / 100]];
}
const ringArea = (ring) => { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return s / 2; };
const ccw = (ring) => (ringArea(ring) < 0 ? [...ring].reverse() : ring);

/**
 * Floors and units for a building from its outer ring (local metres) and roof height: storeys of about
 * 3.2 m, units as strips along the footprint's long axis, a core and corridor left as common area.
 * @returns {{ floors: { index: number, label: string, lower: number, upper: number }[], units: { name: string, ring: number[][], areaM2: number }[], unitsPerFloor: number } | null}
 */
export function layoutFor(outer, heightM) {
  if (!outer || outer.length < 4 || !(heightM > 2.5)) return null;
  const ring = ccw(outer);
  const area = Math.abs(ringArea(ring));
  if (area < 30) return null;
  const storeys = Math.max(1, Math.min(60, Math.round(heightM / 3.2)));
  const storey = heightM / storeys;
  const floors = Array.from({ length: storeys }, (_, i) => ({ index: i, label: i === 0 ? 'G' : `F${i}`, lower: i * storey, upper: (i + 1) * storey }));
  // Long axis from the longest edge.
  let best = 0, axis = [1, 0];
  for (let i = 0; i < ring.length - 1; i++) {
    const dx = ring[i + 1][0] - ring[i][0], dy = ring[i + 1][1] - ring[i][1], len = Math.hypot(dx, dy);
    if (len > best) { best = len; axis = [dx / len, dy / len]; }
  }
  const normal = [-axis[1], axis[0]];
  const along = ring.map((p) => p[0] * axis[0] + p[1] * axis[1]), across = ring.map((p) => p[0] * normal[0] + p[1] * normal[1]);
  const a0 = Math.min(...along), a1 = Math.max(...along), n0 = Math.min(...across), n1 = Math.max(...across);
  const count = Math.max(1, Math.min(8, Math.round((area * 0.82) / 85)));
  const width = a1 - a0;
  const inset = 0.15;
  const units = [];
  // Two rows either side of a corridor when the plate is deep enough; otherwise one row.
  const deep = n1 - n0 > 14 && count >= 4;
  const rows = deep ? [[n0 + inset, (n0 + n1) / 2 - 0.9], [(n0 + n1) / 2 + 0.9, n1 - inset]] : [[n0 + inset, n1 - inset]];
  const perRow = Math.ceil(count / rows.length);
  const pt = (s, t) => [s * axis[0] + t * normal[0], s * axis[1] + t * normal[1]];
  rows.forEach(([t0, t1], r) => {
    for (let k = 0; k < perRow && units.length < count; k++) {
      const s0 = a0 + (width * k) / perRow + inset, s1 = a0 + (width * (k + 1)) / perRow - inset;
      const cell = [pt(s0, t0), pt(s1, t0), pt(s1, t1), pt(s0, t1), pt(s0, t0)];
      const piece = clip(ring, ccw(cell));
      if (!piece) continue;
      const a = Math.abs(ringArea(piece));
      if (a < 12) continue;
      units.push({ name: String.fromCharCode(65 + units.length), ring: piece, areaM2: Math.round(a * 100) / 100 });
    }
  });
  return units.length ? { floors, units, unitsPerFloor: units.length } : null;
}

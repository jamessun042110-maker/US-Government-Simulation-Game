// Shared primitives. No dependencies, by design.

// --- The calendar ----------------------------------------------------------
// Twelve months of twenty-eight days, which is a tidy 336 and close enough to a
// year that nobody has ever noticed. Two things make this more than a printing
// detail, and both are why it lives here in the leaf module rather than in
// chronicle.js where it started: the republic is founded on a *date* — the
// twentieth of January — so tick 0 is nineteen days into the calendar, and
// rules.js needs to answer "when is the next inauguration day" without importing
// the Chronicle and closing a cycle.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS_PER_MONTH = 28;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS.length;

/** A date as a day-of-year index. `dayIndex(0, 20)` is the 20th of January. */
export const dayIndex = (month, day) => month * DAYS_PER_MONTH + (day - 1);

/** The republic is founded on the twentieth of January. */
export const FOUNDING_MONTH = 0;
export const FOUNDING_DAY = 20;
export const FOUNDING_DAY_OF_YEAR = dayIndex(FOUNDING_MONTH, FOUNDING_DAY);

const perYear = (world) => world.clock?.ticksPerYear || 240;

/** Days since the first of January of the founding year. */
export const daysAt = (world, tick = world.clock.tick) =>
  FOUNDING_DAY_OF_YEAR + (tick / perYear(world)) * DAYS_PER_YEAR;

export const yearAt = (world, tick = world.clock.tick) =>
  world.clock.foundingYear + Math.floor(daysAt(world, tick) / DAYS_PER_YEAR);

/** Where in its own year a tick falls, 0 on the 1st of January. */
export const dayOfYear = (world, tick = world.clock.tick) => {
  const d = daysAt(world, tick) % DAYS_PER_YEAR;
  return (d + DAYS_PER_YEAR) % DAYS_PER_YEAR;
};

/** The inverse: the tick on which a given day of a given year falls. */
export const tickOf = (world, y, dayIdx) => {
  const days = (y - world.clock.foundingYear) * DAYS_PER_YEAR + dayIdx - FOUNDING_DAY_OF_YEAR;
  return Math.round((days / DAYS_PER_YEAR) * perYear(world));
};

/** The first occurrence of a day-of-year at or after `tick`. */
export const nextDay = (world, tick, dayIdx) => {
  const y = yearAt(world, tick);
  const t = tickOf(world, y, dayIdx);
  return t >= tick ? t : tickOf(world, y + 1, dayIdx);
};

export const canonDate = (world, tick = world.clock.tick) => {
  const inYear = dayOfYear(world, tick);
  const m = MONTHS[Math.min(MONTHS.length - 1, Math.floor(inYear / DAYS_PER_MONTH))];
  const d = 1 + Math.floor(inYear % DAYS_PER_MONTH);
  return `${m} ${d}, Yr ${yearAt(world, tick)}`;
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic per-world RNG. Advances world.rngState so a rehydrated
// world continues the same sequence.
//
// This is the *only* source of chance the simulation is allowed to draw on, and
// that is a load-bearing rule rather than a stylistic one: a world is a value,
// and two runs of the same value must reach the same place. It was quietly
// broken in three places — which officeholder a crisis landed on, whether an
// unsupported story got flagged, and whether a libel suit was won — each of
// them reaching for Math.random(). The visible cost was a test suite that could
// not assert on a long run without becoming a coin toss: tests/econlink.mjs
// failed about one run in ten because twenty simulated years came out
// differently every time it was asked.
//
// If a decision is the simulation's to make, it comes off here: rng, pick,
// range or chance. Math.random() is for identifiers and for the interface.
export function rng(world) {
  world.rngState = (world.rngState + 0x9e3779b9) | 0;
  return mulberry32(world.rngState)();
}
/**
 * A number and its noun, agreeing.
 *
 * The republic said "undertake for 1 years", "it has 1 months to find the
 * money", "there are 1 divisions in the army" and "the Chronicle records 1 acts
 * under her name" — the last of those in the presidential article, which is the
 * one piece of prose this game asks to be read closely. Most counts in the
 * engine already carry a hand-written ternary; this is the same thing, once.
 */
export const count = (n, one, many) => {
  const v = Number(n);
  const shown = Number.isFinite(v) ? v.toLocaleString() : String(n);
  return `${shown} ${Math.abs(v) === 1 ? one : (many || `${one}s`)}`;
};

/**
 * A name with its article, without doubling one it already carries.
 *
 * Three districts and a foreign power are named "The something" — The Terraces,
 * The Pales, The SAB — and every sentence that wrote "the ${name}" around one of
 * them said "the The Terraces Employment Act". The article belongs to the name
 * when the name already has it, and to the sentence when it does not.
 */
export const withThe = (name) => {
  const s = String(name == null ? '' : name);
  return /^The\s/.test(s) ? s : `the ${s}`;
};

export const pick = (world, arr) => arr[Math.floor(rng(world) * arr.length)];
export const range = (world, lo, hi) => lo + rng(world) * (hi - lo);
export const chance = (world, p) => rng(world) < p;

/** A stable 32-bit seed from a string, so the same nation draws the same land. */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + f(b), 0);
export const byId = (arr, id) => arr.find((x) => x.id === id) || null;

// --- Opinion ---------------------------------------------------------------
/**
 * How hard anything at all lands on public opinion.
 *
 * One pair of numbers, applied in two places: the drift in sim.tickOpinion, and
 * every discrete shove — a crisis answered badly, a law struck down, a war
 * declared. Both channels move at the same fraction of their old speed, which
 * is the only way the ratio between "conditions are bad" and "something
 * happened" stays where it was tuned.
 *
 * The republic was outrunning the player: conditions would turn, the public
 * would finish reacting, and the government would still be reading the crisis
 * card about it — so a term was judged on the state of the country rather than
 * on anything the government did in it.
 *
 * These damp *changes*, never assignments. A persona minted at 50 or a seceded
 * district set to 62 is a state of affairs rather than a reaction to one, and
 * is written directly.
 */
export const MOOD_DAMP = 0.9;
export const APPROVAL_DAMP = 0.95;

/** Move one district's mood by `delta`, damped and clamped. */
export const nudgeMood = (d, delta) => {
  if (!d) return;
  d.mood = clamp((d.mood ?? 50) + delta * MOOD_DAMP, 0, 100);
};

/** The same, to every district in the country. */
export const nudgeMoodAll = (world, delta) => {
  for (const d of world.districts || []) nudgeMood(d, delta);
};

/** Move one person's standing by `delta`, damped and clamped. */
export const nudgeApproval = (p, delta) => {
  if (!p) return;
  p.approval = clamp((p.approval ?? 50) + delta * APPROVAL_DAMP, 0, 100);
};

/**
 * A nation's name with its leading article stripped, for the many places that
 * paste it into "The X Ledger" / "The X Chronicle". Most nations are named "The
 * Something", and without this the masthead read "The The Silver Republic
 * Chronicle".
 */
export const bareNation = (nation) => String(nation || '').replace(/^(the|a|an)\s+/i, '');

// --- Age in politics -------------------------------------------------------
// The republic reckons a political life from eighteen — the age at which you
// may first be sworn in as head of government, and the floor every age-based
// calculation measures from. A politician's *youth* is how far above that floor
// they are not: an eighteen-year-old is all youth, and it eases to nothing
// across a working lifetime. What youth buys and what it costs is spelled out
// where each lands — a fresher face at world.makePersona, a keener ear for a
// good headline at media.applyToTarget, and a thinner book of favours in the
// chamber at sim.syntheticBallot.

/** The age of majority for the head office, and the base for every age effect. */
export const POLITICAL_BASE_AGE = 18;
// Youth is spent over this many years: full at the base age, gone a working
// lifetime later (65), so the effects fade smoothly across a normal career.
export const POLITICAL_YOUTH_SPAN = 47;

// How much each effect is worth at the youngest, scaled by youthOf toward zero:
//   approval   — points added to a fresh persona's starting standing.
//   press      — extra fraction a praising story moves their approval.
//   connection — fraction of the usual chamber pull they *lose*.
export const YOUTH_APPROVAL = 4;
export const YOUTH_PRESS = 0.5;
export const YOUTH_CONNECTION = 0.4;

/** How old a persona is right now: their age when the record opened plus what
 *  has since passed. The one reckoning of current age the engine shares. */
export const currentAge = (world, p) =>
  (p?.age ?? 0) + Math.floor(((world?.clock?.tick ?? 0) - (p?.born ?? 0)) / perYear(world));

/** 1 at the base age, easing linearly to 0 a working lifetime later — the
 *  dimensionless "how young" every age effect above is scaled by. */
export const youthOf = (world, p) =>
  clamp(1 - (currentAge(world, p) - POLITICAL_BASE_AGE) / POLITICAL_YOUTH_SPAN, 0, 1);

/**
 * The national flag: purple at the hoist, gold at the fly, a black disc across
 * the seam. One definition, because it flies in the pixel scenes, in the
 * inauguration tableau and on the title screen, and three hand-tuned copies of
 * a flag is how you end up with three different flags.
 */
export const FLAG = { hoist: '#6b3fa0', fly: '#f2c230', disc: '#141414' };

/**
 * The flag as SVG markup, for the two scenes drawn in SVG rather than on the
 * pixel canvas. The disc is sized off the shorter side so it stays a disc at
 * any dimensions, and sits on the seam between the halves.
 */
export const flagSvg = (x, y, w, h, ink = '#141414') => {
  const r = Math.max(1.5, Math.min(w, h) * 0.3);
  return `<rect x="${x}" y="${y}" width="${w / 2}" height="${h}" fill="${FLAG.hoist}"/>`
    + `<rect x="${x + w / 2}" y="${y}" width="${w / 2}" height="${h}" fill="${FLAG.fly}"/>`
    + `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" fill="${FLAG.disc}"/>`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${ink}" stroke-width="1"/>`;
};

export function money(n) {
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n >= 1e9) s = '$' + (n / 1e9).toFixed(2) + 'B';
  else if (n >= 1e6) s = '$' + (n / 1e6).toFixed(2) + 'M';
  else if (n >= 1e3) s = '$' + (n / 1e3).toFixed(0) + 'K';
  else s = '$' + n.toFixed(0);
  return (neg ? '−' : '') + s;
}
export const moneyExact = (n) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const pct = (n, d = 1) => (n * 100).toFixed(d) + '%';
export const num = (n) => Math.round(n).toLocaleString('en-US');

export function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' || typeof kid === 'number'
      ? document.createTextNode(String(kid)) : kid);
  }
  return n;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A tiny structural hash so views can skip re-rendering unchanged subtrees.
export function hash(obj) {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

export const PALETTE = [
  '#e0b64a', '#5fa8d3', '#c96a5b', '#7fb069', '#b07fc0',
  '#d98a4a', '#4fb3a4', '#c05f8a', '#8a9ac0', '#a8a04a',
];

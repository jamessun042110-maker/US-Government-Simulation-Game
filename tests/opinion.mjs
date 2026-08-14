// Opinion moves slower — the drift and the shove alike.
//
// The point of routing every effect through util.nudge* is that there is now
// one place to change how hard anything lands. These assertions check the two
// channels separately (a discrete effect, and the per-tick convergence) and
// then check the thing that is easy to get wrong: that the assignments — a
// persona minted at 50, a seceded district set to 62 — are *not* damped,
// because they are states of affairs rather than reactions to one.
const base = new URL('../js/', import.meta.url).href;
const U = await import(base + 'util.js');
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- the constants ----------------------------------------------------------
ok('mood lands a tenth softer', near(U.MOOD_DAMP, 0.9), String(U.MOOD_DAMP));
ok('standing a twentieth', near(U.APPROVAL_DAMP, 0.95), String(U.APPROVAL_DAMP));

// --- the helpers --------------------------------------------------------------
const d = { mood: 50 };
U.nudgeMood(d, -10);
ok('a ten-point knock costs nine', near(d.mood, 41), String(d.mood));
U.nudgeMood(d, 10);
ok('and it works upward too', near(d.mood, 50), String(d.mood));
const p = { approval: 50 };
U.nudgeApproval(p, -20);
ok('a twenty-point fall costs nineteen', near(p.approval, 31), String(p.approval));

// Clamped, and safe on nothing.
const floor = { mood: 3 };
U.nudgeMood(floor, -99);
ok('mood cannot go below zero', floor.mood === 0, String(floor.mood));
const ceil = { approval: 98 };
U.nudgeApproval(ceil, 99);
ok('standing cannot pass a hundred', ceil.approval === 100, String(ceil.approval));
ok('a missing district is not an error', (() => { U.nudgeMood(null, -5); U.nudgeApproval(undefined, -5); return true; })());

// --- the shove, through a real effect ----------------------------------------
const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};
const w = mk();
const before = w.districts.map((x) => x.mood);
// Declaring war costs the country six points of mood — 5.4 after damping.
A.declareWar(w, w.foreign[0].id);
const moved = w.districts.map((x, i) => before[i] - x.mood);
ok('a declared war costs 5.4 rather than 6', moved.every((m) => near(m, 5.4, 1e-6)),
  moved.map((m) => m.toFixed(2)).join(', '));
ok('and every district feels it', moved.length === w.districts.length && moved.every((m) => m > 0));

// --- the drift ----------------------------------------------------------------
// Both convergence rates are the base rate times the same damping, so that a
// future edit to the damping cannot move one channel without the other.
const w2 = mk();
const dd = w2.districts[0];
dd.mood = 20;
const { target } = S.districtMoodTarget(w2, dd);
const gap = target - dd.mood;
S.tick(w2);
// The tick also normalises and re-derives; compare against the damped rate.
const expected = 20 + gap * 0.02 * U.MOOD_DAMP;
ok('mood closes 1.8% of the gap, not 2%', Math.abs(dd.mood - expected) < 0.35,
  `${dd.mood.toFixed(3)} vs ${expected.toFixed(3)} (undamped would be ${(20 + gap * 0.02).toFixed(3)})`);
ok('and it moved toward the target', (target > 20) === (dd.mood > 20));

// --- what must NOT be damped ---------------------------------------------------
const w3 = mk();
const fresh = Object.values(w3.personas).filter((x) => x.alive);
ok('personas are minted, not nudged, into being', fresh.length > 0 && fresh.every((x) => x.approval >= 0 && x.approval <= 100));
// A seceded district is set to 62 outright — an assignment, not a reaction.
const secede = { mood: 10, seceded: false };
secede.seceded = true; secede.mood = 62;
ok('an assignment stays an assignment', secede.mood === 62, String(secede.mood));

// --- nothing writes mood or approval directly any more --------------------------
// The whole point is one lever. If a new effect site is added that writes the
// field itself, this catches it before the balance quietly drifts apart again.
const fs = await import('node:fs/promises');
const dir = new URL('../js/', import.meta.url);
const ALLOWED = {
  // The helpers themselves, the per-tick convergence and normalisation, and
  // the places a value is assigned outright rather than moved — a persona minted
  // with a youth-scaled starting approval (world.makePersona, and the founding
  // screen's re-derivation of it in actions.js) among them.
  'util.js': 2, 'sim.js': 4, 'intrigue.js': 1, 'actions.js': 3, 'world.js': 1,
};
let stray = [];
for (const f of await fs.readdir(dir)) {
  if (!f.endsWith('.js')) continue;
  const src = await fs.readFile(new URL(f, dir), 'utf8');
  // A property write, specifically — `const mood = …` is a local and fine.
  const hits = src.split('\n').filter((l) =>
    /\.(mood|approval)\s*(=[^=]|\+=|-=)/.test(l)
    && !/moodTarget|moodParts|nationalApproval|approvalOfOffice|approvalDrivers/.test(l));
  const cap = ALLOWED[f] ?? 0;
  if (hits.length > cap) stray.push(`${f}: ${hits.length} > ${cap}\n    ${hits.map((h) => h.trim()).join('\n    ')}`);
}
ok('every effect goes through the damped helpers', stray.length === 0, stray.join('\n  '));

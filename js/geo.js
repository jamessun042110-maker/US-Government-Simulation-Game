// The shape of the world.
//
// Everything the maps draw is generated here, from the nation's name — so the
// same republic always occupies the same ground, and the world map and the
// districts map are the same geometry at two scales rather than two drawings
// that resemble each other.
//
// **The continent is now real.** It was invented — a hand-drawn silhouette cut
// into three countries by fractal borders solved against target land shares.
// It is North America now, and it comes from atlas.js, which is written in
// degrees and can be checked against a map.
//
// The order of operations survives the change, because it was right:
//
//   1. Take the continent. One landmass, coast and all, drawn without reference
//      to who lives on it.
//   2. Cut it up. Two frontiers run clean across it, both east-west now: the
//      49th parallel and the lakes bounding Canada to the north, and the Rio
//      Grande bounding Mexico to the south. Silver's two borders met at a triple
//      junction, which put its neighbours side by side — the reason the topology
//      had to be redrawn and not merely renamed.
//   3. Leave the island power offshore.
//
// **What did not survive is the solving.** A fractal border can be re-solved
// against a new target share after a war; the Rio Grande cannot. So the borders
// are *offset* instead — see `atlas.ringsAt`, which reassembles all three
// countries at any frontier displacement. The share solve below now searches for
// that displacement rather than for the shape of the line.
//
// ── How a territory is represented ────────────────────────────────────────
//
// Not as a closed outline of its coast. A territory is a **half** — a simple
// polygon made of its borders plus a closure drawn well outside the frame — and
// the coast is applied by intersecting it with the continent. Nothing here
// computes that intersection: SVG clips a group by two paths at once. Where code
// genuinely needs it (areas, label placement, district seeding) it asks a
// predicate, point by point.
//
// The obvious implementation instead walks the coast ring between the points
// where a border crosses it, and it is a trap: a fractal coast can double back,
// so a border may cross four times and the walk encloses the wrong side or
// crosses itself. Half-planes plus clipping cannot go wrong.

import { mulberry32, hashSeed } from './util.js';
import { CONTINENT_RING, ringsAt } from './atlas.js';

// --- Primitives ------------------------------------------------------------

/** A closed SVG path through points. */
export const pathOf = (pts) =>
  'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ' Z';

/** An open SVG path through points. */
export const lineOf = (pts) =>
  'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');

/**
 * Fractal midpoint displacement along an open line.
 *
 * The same technique the coast uses, which is the point: a national border and a
 * shoreline are both irregular at every scale, and a border drawn as a straight
 * line between two capitals is the single thing that makes a map look generated.
 *
 * `taper` pins the displacement to zero at both ends — a district border has to
 * meet the coast exactly where the coast is, and an untapered wobble at the last
 * point walks it into the sea.
 */
export function fractalLine(a, b, { seed = 1, rounds = 5, amp = 0.16, roughness = 0.56, taper = false } = {}) {
  const rand = mulberry32(typeof seed === 'number' ? seed : hashSeed(seed));
  let pts = [[a[0], a[1]], [b[0], b[1]]];
  for (let r = 0; r < rounds; r++) {
    const scale = amp * Math.pow(roughness, r);
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const d = (rand() * 2 - 1) * len * scale;
      out.push(p, [(p[0] + q[0]) / 2 - (dy / len) * d, (p[1] + q[1]) / 2 + (dx / len) * d]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  if (!taper) return pts;
  const n = pts.length - 1;
  return pts.map((p, i) => {
    const t = i / n;
    const f = Math.pow(Math.sin(Math.PI * t), 0.7);
    const sx = a[0] + (b[0] - a[0]) * t, sy = a[1] + (b[1] - a[1]) * t;
    return [sx + (p[0] - sx) * f, sy + (p[1] - sy) * f];
  });
}

/** A closed fractal coast from a coarse control ring. */
export function coast(ring, { seed = 1, rounds = 5, roughness = 0.56, amp = 0.26 } = {}) {
  const rand = mulberry32(typeof seed === 'number' ? seed : hashSeed(seed));
  let pts = ring.map((p) => [p[0], p[1]]);
  for (let r = 0; r < rounds; r++) {
    const scale = amp * Math.pow(roughness, r);
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const d = (rand() * 2 - 1) * len * scale;
      out.push(a, [(a[0] + b[0]) / 2 - (dy / len) * d, (a[1] + b[1]) / 2 + (dx / len) * d]);
    }
    pts = out;
  }
  return pts;
}

export function inPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a / 2);
}

export function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (!a) return poly[0] ? [poly[0][0], poly[0][1]] : [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** An ellipse of `n` points — the starting ring for an island. */
export function ellipse(cx, cy, rx, ry, n = 16, phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = phase + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return pts;
}

// --- The continent ---------------------------------------------------------

export const WORLD_W = 340;
export const WORLD_H = 232;

// The continent is no longer invented. It was a hand-drawn silhouette roughened
// by a fractal; it is now North America, and it comes from the atlas.
//
// `coast()` still runs over it, at a much smaller amplitude. A real coastline
// wants the roughening — the atlas carries the vertices that make the country
// recognisable, not every inlet — but it must not wander far enough to move
// Florida, so the amplitude is a fifth of what the invented continent used.
const CONTINENT = CONTINENT_RING;

// Far enough outside the frame that a closure can never clip anything real.
const OUT = 90;

// What share of the landmass each country holds **at the founding**.
//
// This used to be a target the border solver aimed at, because a fractal border
// dropped on a fractal coast gave whatever it gave — Canada came out anywhere
// from a fifth of the continent to over half depending only on the nation's
// name, which is not a border, it is a lottery.
//
// There is no lottery now. The frontiers are the 49th parallel and the Rio
// Grande, so the shares are simply *measured* off the atlas at startup rather
// than solved for. They are still needed, because a war moves a frontier by a
// share of a country and the code that prices a cession has to know what a
// country was worth to begin with.
let SHARES = null;

/**
 * Sample the continent on a grid once: the discrete land every measure uses —
 * shares, label placement, district sizing.
 *
 * By scanline, not by testing every cell against the ring. The coast has seven
 * hundred vertices and the frame has tens of thousands of cells; asking "is this
 * one on land?" that many times took over a second, which is a second of blank
 * screen the first time anyone opens the map. Crossing the ring once per row is
 * the same answer about a hundred times faster.
 */
function landGrid(ring, step = 2) {
  const b = bounds(ring);
  const pts = [];
  for (let y = b.y0 + step / 2; y < b.y1; y += step) {
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil((xs[k] - b.x0) / step) * step + b.x0; x < xs[k + 1]; x += step) pts.push([x, y]);
    }
  }
  return { pts, cell: step * step, step };
}

/**
 * The two frontiers and the three territories they divide, at a given
 * displacement.
 *
 * This was the fractal border solver. It is now a thin wrapper over
 * `atlas.ringsAt`, and the change of shape is the point: `north` and `south` are
 * how far each frontier has been pushed by war, in frame units, and at zero this
 * is the continent as founded.
 *
 * The seed argument is gone. Silver's borders were seeded off the nation's name,
 * so a republic called something else got a different continent; the United
 * States gets the United States. Callers no longer pass one.
 *
 * A displaced frontier leaves a step where it meets the sea, which is correct —
 * a war moves the border, and the border ends at the water, so the corner of the
 * country moves with it.
 */
function cut(north = 0, south = 0) {
  const r = ringsAt(north, south);
  return {
    A: r.borders.canada,
    B: r.borders.mexico,
    // There is no triple junction any more. Silver's two borders met at one,
    // which is precisely what put its neighbours side by side instead of one
    // north and one south; the frontiers here never touch. Kept as null rather
    // than removed because the world map draws a marker at it when it exists.
    junction: null,
    halves: { canada: r.canada, silver: r.us, mexico: r.mexico },
  };
}

const CACHE = new Map();

// --- Annexation --------------------------------------------------------------
//
// Land taken in a war is not a band painted over somebody else's country: it is
// their country being smaller. `world.annexed` is a map of `foreignId → percent`
// (negative where the republic was the one that ceded), and the way it reaches
// the map is the *target shares the borders are solved for*. Take a third of
// Canada and Canada's target drops by a third, Silver's rises by exactly what
// Canada lost, and border A is re-solved: the line moves north, through the
// same landscape, still wandering the way it always did.
//
// This is why the seeds below are taken from the base key and not from the
// annexed one. The coast, the terrain and the borders' own wander must be
// identical either side of a treaty — a peace that moved the mountains would be a
// different continent, not a new frontier.

/** A power's annexed share as a signed fraction. A country is 100% of itself. */
const annexOf = (annexed, id) => Math.max(-1, Math.min(1, Math.round(annexed?.[id] || 0) / 100));

/** The map a world is currently looking at: its own seed, and the land it holds. */
export const mapOf = (world) => geography(world?.nation, world?.mapSeed || 0, world?.annexed);

/**
 * The whole geography, from the nation's name.
 *
 * Cached: solving the borders costs a few dozen grid passes and the world view
 * repaints on a one-second clock.
 */
export function geography(nation, salt = 0, annexed = null) {
  // The salt is what makes the map redrawable. Everything below seeds off `key`,
  // so a different salt is a different country with the same name — new coast,
  // new border, new terrain — while salt 0 is the map the nation was founded on.
  const key = String(nation || 'silver') + (salt ? '#' + salt : '');
  const a = {
    canada: annexOf(annexed, 'canada'),
    mexico: annexOf(annexed, 'mexico'),
    sab: annexOf(annexed, 'sab'),
  };
  // A moved border is a different map of the same country, so it is a different
  // cache entry — but only when something actually moved, so the founding map of
  // every Season still lands on the same entry it always did.
  const moved = !!(a.canada || a.mexico || a.sab);
  const ck = moved ? `${key}@${a.canada},${a.mexico},${a.sab}` : key;
  if (CACHE.has(ck)) return CACHE.get(ck);

  // The founding map is solved first and the cessions are solved *from* it, so
  // the frontier a treaty moves is the one the republic was founded with and the
  // continent underneath is not drawn twice.
  const g0 = moved ? geography(nation, salt) : null;
  // Amplitude cut from 0.24 to 0.05. An invented coast wants the wander — it is
  // what stops it reading as a drawn blob. A real one already has its shape, and
  // at the old amplitude the roughening was large enough to walk Florida into
  // the Gulf and put a bite through the Chesapeake. What is left is enough to
  // keep the line from looking ruled.
  const ring = g0 ? g0.ring : coast(CONTINENT, { seed: key + '/continent', rounds: 5, roughness: 0.56, amp: 0.05 });
  const grid = g0 ? g0.grid : landGrid(ring);
  const shareOf = (half) => grid.pts.reduce((n, p) => n + (inPoly(p, half) ? 1 : 0), 0) / grid.pts.length;

  // What each country is owed, once the treaties are counted. Mexico's share is
  // whatever the other two leave, here as everywhere else.
  //
  // Ground taken *from* a neighbour is a share of that neighbour, which is what
  // acts.territoryLeft counts; ground the republic gave up is a share of the
  // republic, which is what the treaty instrument says in so many words. So the
  // two directions are not the same fraction of the same thing, and reading them
  // as one would have a 20% cession to Canada move a fifth of *Canada* the
  // wrong way across the line.
  // Measured off the founding map rather than declared. Silver named its shares
  // and solved its borders to hit them; here the borders are given and the
  // shares are the consequence, so the only honest way to know what Canada was
  // worth before the war is to count the ground it stood on. Memoised: the coast
  // roughening is tiny now, so every seed measures the same country.
  if (!SHARES) {
    const f = cut(0, 0);
    SHARES = {
      canada: shareOf(f.halves.canada),
      silver: shareOf(f.halves.silver),
      mexico: shareOf(f.halves.mexico),
    };
  }
  const BASE = SHARES;
  const toUs = (id) => (a[id] >= 0 ? BASE[id] : BASE.silver) * a[id];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const want = {
    canada: clamp01(BASE.canada - toUs('canada')),
    mexico: clamp01(BASE.mexico - toUs('mexico')),
  };

  // The solve is bisection against a monotone measure — a border slid south can
  // only add land to the north of it — so a wider bracket buys iterations and
  // nothing else, and the old one was too narrow to reach its own target. On the
  // founding seed of "The Silver Republic" itself it railed at the southern end
  // with Canada on 27% of a continent it is supposed to hold 44% of, and
  // Mexico on twice its share; the shares the map is calibrated for were simply
  // out of reach. This is wide enough for the targets on every seed, and wide
  // enough that a country annexed outright can be driven off the continent
  // altogether rather than left as a rail-thin crescent — a target of zero is
  // reached here, not merely approached.
  const solve = (lo, hi, f, target) => {
    for (let i = 0; i < 13; i++) {
      const m = (lo + hi) / 2;
      if (f(m) < target) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };

  // **There is no founding calibration any more.** Silver had to solve for its
  // borders because they were random; the 49th parallel and the Rio Grande are
  // where they are. The founding map is `cut(0, 0)` and the shares are whatever
  // the real geography gives, measured once and cached in SHARES above.
  //
  // What remains is the treaties, and they are simpler than they were. Silver's
  // two borders met at a triple junction, so pushing one moved the other and the
  // two knobs had to be alternated until they agreed. These frontiers never
  // touch — one is north of the country and one is south of it — so each is
  // solved once, independently, and winning a war against Canada cannot move the
  // Mexican border by so much as a unit. The test asserts exactly that.
  //
  // Both measures fall as their knob rises: a frontier pushed north leaves less
  // Canada. So each is solved against its own negative, which is the same
  // bisection upside down.
  let north = 0, south = 0;
  if (a.canada || a.mexico) {
    // Sampled every third point for the treaty solve. The measure comes out
    // within a few tenths of a percent of the full pass, which is finer than the
    // borders can be placed anyway, and it is the difference between a treaty
    // costing the tick half a second and costing it a second and a half.
    const probe = grid.pts.filter((_, i) => i % 3 === 0);
    const shareIn = (half) => probe.reduce((n, p) => n + (inPoly(p, half) ? 1 : 0), 0) / probe.length;
    if (a.canada) north = solve(-260, 260, (m) => -shareIn(cut(m, 0).halves.canada), -want.canada);
    if (a.mexico) south = solve(-260, 260, (m) => -shareIn(cut(0, m).halves.mexico), -want.mexico);
  }

  const c = cut(north, south);
  const g = {
    ring,
    halves: c.halves,
    borders: { a: c.A, b: c.B },
    junction: c.junction,
    // How far each frontier has been pushed by war, so a map with treaties on it
    // can be solved from the founding map rather than from scratch. These
    // replace `dy`/`jFrac`, which described the shape of a fractal line that no
    // longer exists.
    north,
    south,
    // The island power, moved from a strait west of Silver to the Caribbean —
    // south-east of the Florida keys, which is the only place on this map an
    // island power can sit and still be across water from us rather than in the
    // middle of the country.
    //
    // Wider than it is tall now, where Silver's was the reverse. The league's
    // name and its standing with us are drawn at a fixed anchor in the middle of
    // it, and an archipelago whose label does not fit on its own islands reads
    // as a mistake rather than as a small country.
    sab: coast(ellipse(234, 188, 36, 14, 14, 2.2), { seed: key + '/sab', rounds: 5, roughness: 0.6, amp: 0.3 }),
    /** Is this point in that country? Coast and border, both. */
    isIn: (p, id) => inPoly(p, ring) && inPoly(p, c.halves[id]),
    grid,
    annexed: a,
  };
  // What each country ended up holding, as a share of the continent. One pass,
  // and the only thing that can answer "has this power any ground left at all" —
  // which the maps have to ask before they write a name on it.
  // **Whatever is neither Canada's nor Mexico's is ours.** The order matters and
  // it used to run the other way, with Mexico as the fall-through. At the
  // founding that is invisible, because the three tile the continent exactly.
  // After an annexation it is not: driving the northern frontier off the top of
  // the map leaves the frame's corners outside every polygon, and with Mexico
  // last those corners became Mexican — annexing Canada outright handed Mexico
  // 30.9% of the continent it had never set foot on.
  //
  // Ours is the right fall-through because ground taken in a war is ground we
  // took. A neighbour's claim has to be positively established; ours is what is
  // left when both of theirs fail.
  g.share = { canada: 0, silver: 0, mexico: 0 };
  for (const p of grid.pts) {
    const id = inPoly(p, c.halves.canada) ? 'canada' : inPoly(p, c.halves.mexico) ? 'mexico' : 'silver';
    g.share[id] += 1 / grid.pts.length;
  }
  g.terrain = terrainOf(key, grid, ring);
  // The island power has no land frontier to move, so a share taken from the SAB
  // is cut off its islands instead: one line across them, solved for the share,
  // with the ground on the near side — the side facing the republic across the
  // strait — ours. Nothing is given the other way: the league can take an
  // indemnity off us but it has no border with us to advance, and inventing one
  // in the middle of the republic would be a lie the map cannot support.
  g.sabTaken = a.sab > 0 ? sabCut(key, g.sab, a.sab) : null;
  CACHE.set(ck, g);
  return g;
}

/**
 * Cut the SAB's islands for a share taken from them.
 *
 * The line is a single fractal curve translated east or west until the ground
 * east of it — the strait side, nearest Silver — is the share annexed. Because
 * only the endpoints move and never the length, the curve keeps its exact shape
 * as it slides, which is what makes the measure monotone and the solve stable.
 */
function sabCut(key, sab, share) {
  const b = bounds(sab);
  const pts = landGrid(sab, 1).pts;
  if (!pts.length) return null;
  const at = (x) => fractalLine([x, b.y0 - 20], [x, b.y1 + 20], { seed: key + '/sab-cut', rounds: 5, amp: 0.05 });
  const east = (line) => [...line, [b.x1 + OUT, b.y1 + OUT], [b.x1 + OUT, b.y0 - OUT]];
  const held = (x) => {
    const poly = east(at(x));
    return pts.reduce((n, p) => n + (inPoly(p, poly) ? 1 : 0), 0) / pts.length;
  };
  let lo = b.x0 - 30, hi = b.x1 + 30;
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2;
    if (held(m) > share) lo = m; else hi = m;
  }
  const line = at((lo + hi) / 2);
  return { poly: east(line), line, share: held((lo + hi) / 2) };
}

// --- Physical geography ----------------------------------------------------

/**
 * Physical geography: a range, a dry interior, forest on the wet margins, and
 * water collected at the foot of the hills.
 *
 * The first pass scattered a dozen independent blobs at random land cells, which
 * is why it looked thrown on: real terrain is not independent of itself. A range
 * is a *chain* running in a direction, not three circles; desert sits where the
 * sea is furthest away; forest sits where it is not; lakes gather in the lee of
 * high ground. So this places one feature *from* another rather than sampling
 * each on its own, and every shape is elongated along the axis it belongs to.
 *
 * Still pure decoration — nothing simulates it, nothing keys off it — and still
 * seeded off the nation's name, so a given republic always has the same country.
 */
function terrainOf(key, grid, ring) {
  const rand = mulberry32(hashSeed(key + '/terrain'));
  const step = grid.step;
  const pts = grid.pts;
  if (!pts.length) return { forest: [], desert: [], highland: [], lake: [], glyphs: [] };

  // Land occupancy as a lookup, so "is there land 14 units that way?" is O(1)
  // instead of a point-in-polygon test against a seven-hundred-vertex coast.
  const cells = new Set(pts.map(([x, y]) => `${Math.round(x / step)}|${Math.round(y / step)}`));
  const onLand = (x, y) => cells.has(`${Math.round(x / step)}|${Math.round(y / step)}`);
  /** 0 = on the shore, 1 = land in every direction at this radius. */
  const inland = (x, y, r) => {
    let n = 0;
    for (let a = 0; a < 8; a++) {
      const t = (a * Math.PI) / 4;
      if (onLand(x + Math.cos(t) * r, y + Math.sin(t) * r)) n++;
    }
    return n / 8;
  };

  const blob = (x, y, rx, ry, rot, tag) => coast(ellipse(x, y, rx, ry, 14, rot), {
    seed: `${key}/t/${tag}`, rounds: 3, roughness: 0.62, amp: 0.22,
  });

  const out = { forest: [], desert: [], highland: [], lake: [], glyphs: [] };
  const taken = [];
  const free = (x, y, d) => taken.every((q) => Math.hypot(q[0] - x, q[1] - y) > d);

  // --- the range ----------------------------------------------------------
  // A spine walked across the land in one direction, with the hills strung along
  // it. This is the feature everything else is placed relative to.
  const deep = pts.filter((p) => inland(p[0], p[1], 16) === 1);
  const seedPt = (deep.length ? deep : pts)[Math.floor(rand() * (deep.length || pts.length))];
  let dir = rand() * Math.PI * 2;
  let cur = seedPt.slice();
  const spine = [cur.slice()];
  for (let i = 0; i < 9; i++) {
    dir += (rand() - 0.5) * 0.55;
    const nxt = [cur[0] + Math.cos(dir) * 11, cur[1] + Math.sin(dir) * 11];
    if (inland(nxt[0], nxt[1], 7) < 0.75) break;
    spine.push(nxt.slice());
    cur = nxt;
  }
  for (const [i, sp] of spine.entries()) {
    out.highland.push(blob(sp[0], sp[1], 11 + rand() * 4, 6 + rand() * 2, dir, 'h' + i));
    taken.push(sp);
    // The hachures carry the range, not the wash under it: a blurred grey blob
    // with three chevrons on it reads as a smudge on the paper. So there is a
    // ridge at every step of the spine, with a second one offset across it, and
    // they vary in size the way a drawn range does.
    out.glyphs.push({ kind: 'ridge', x: sp[0], y: sp[1], s: 0.85 + rand() * 0.5 });
    const t = dir + Math.PI / 2;
    const off = (rand() < 0.5 ? -1 : 1) * (3.5 + rand() * 2.5);
    out.glyphs.push({
      kind: 'ridge', x: sp[0] + Math.cos(t) * off, y: sp[1] + Math.sin(t) * off + 1.5,
      s: 0.6 + rand() * 0.35,
    });
  }

  // --- the dry interior ---------------------------------------------------
  // Wherever the sea is furthest off and the range is not already there.
  const dryScore = (p) => inland(p[0], p[1], 26) + inland(p[0], p[1], 34) * 0.6;
  const dry = pts.filter((p) => free(p[0], p[1], 21)).sort((a, b) => dryScore(b) - dryScore(a));
  for (let i = 0; i < 2 && i < dry.length; i++) {
    const p = dry[Math.min(dry.length - 1, i * 7 + Math.floor(rand() * 5))];
    if (!free(p[0], p[1], 24)) continue;
    out.desert.push(blob(p[0], p[1], 20 + rand() * 8, 13 + rand() * 5, rand() * 3, 'd' + i));
    taken.push(p);
    out.glyphs.push({ kind: 'dune', x: p[0], y: p[1] });
  }

  // --- forest on the wet margins ------------------------------------------
  // Near the coast, or in the lee of the range — never in the middle of the dry.
  const wet = pts.filter((p) => {
    const i18 = inland(p[0], p[1], 18);
    return i18 > 0.35 && i18 < 0.9 && free(p[0], p[1], 24);
  });
  for (let i = 0; i < 4 && wet.length; i++) {
    const p = wet[Math.floor(rand() * wet.length)];
    if (!free(p[0], p[1], 24)) continue;
    const rot = rand() * Math.PI;
    out.forest.push(blob(p[0], p[1], 15 + rand() * 7, 8 + rand() * 4, rot, 'f' + i));
    taken.push(p);
    out.glyphs.push({ kind: 'tree', x: p[0] - 4, y: p[1] + 1 });
    out.glyphs.push({ kind: 'tree', x: p[0] + 3, y: p[1] - 1 });
  }

  // --- water at the foot of the hills -------------------------------------
  for (let i = 0; i < 2 && spine.length; i++) {
    const sp = spine[Math.floor(rand() * spine.length)];
    const off = 9 + rand() * 6;
    const t = dir + Math.PI / 2 + (i ? Math.PI : 0);
    const lx = sp[0] + Math.cos(t) * off, ly = sp[1] + Math.sin(t) * off;
    if (inland(lx, ly, 6) < 0.85) continue;
    out.lake.push(blob(lx, ly, 5 + rand() * 3, 3 + rand() * 2, rand() * 3, 'l' + i));
  }
  return out;
}

// --- Labels ----------------------------------------------------------------

/**
 * Somewhere inside a region to put its name, and how much room there is for it.
 *
 * The centroid of a crescent falls outside the crescent, and a country bounded by
 * a wandering border and a bay is frequently crescent-shaped — Mexico's name
 * used to sit inside Silver. So this walks the region as sampled points, takes
 * the widest unbroken horizontal run, and returns its middle. A name placed here
 * cannot land on a neighbour or in the sea.
 */
export function labelSpotFrom(points, step, { away = null } = {}) {
  // Occupancy, on the sampling grid.
  const cells = new Set();
  const rows = new Map();
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const [x, y] of points) {
    const r = Math.round(y / step), c = Math.round(x / step);
    cells.add(r + '|' + c);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(x);
    if (c < minC) minC = c; if (c > maxC) maxC = c;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }
  if (!cells.size) return { x: 0, y: 0, w: 40 };

  // How far this cell is from the nearest piece of ground that is not ours.
  //
  // This replaces "the widest unbroken row", which was the wrong question and
  // gave the wrong answer in a way that took three attempts to paper over. The
  // widest row of a country with a straight border down one side is the row
  // hard against that border — so Canada's name sat on its own southern
  // frontier with its halo painted across the line, its standing underneath it
  // reached into Silver, and Mexico's name crowded up against Silver rather
  // than sitting in Mexico. Every one of those is the same bug, and the
  // patches for them were a hand-written lift table keyed by country.
  //
  // What a cartographer actually does is put the name where there is the most
  // country around it in every direction. That is the pole of inaccessibility,
  // and a two-pass Chebyshev distance transform finds it: the cell whose
  // nearest edge is furthest away. A name placed there cannot be near a border,
  // because being near a border is precisely what it maximises the distance
  // from.
  const D = new Map();
  const key = (r, c) => r + '|' + c;
  const FAR = 1e6;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (!cells.has(key(r, c))) continue;
      // The frame's own edge counts as an edge: a country running off the side
      // of the map has no room out there either.
      let d = FAR;
      for (const [dr, dc] of [[-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
        const n = D.get(key(r + dr, c + dc));
        d = Math.min(d, (n == null ? 0 : n) + 1);
      }
      D.set(key(r, c), d);
    }
  }
  // A wide country has a long ridge of cells all equally far from an edge, so
  // the winner among them is decided on a second key: nearest the middle of the
  // country. Without it the answer is wherever the scan happened to reach the
  // maximum first, which is a corner of the ridge — and a corner of the ridge in
  // a band that slopes is a name sliding down toward the frontier again.
  let cRow = 0, cCol = 0;
  for (const k2 of cells) { const [r, c] = k2.split('|'); cRow += +r; cCol += +c; }
  cRow /= cells.size; cCol /= cells.size;

  // The backward pass finishes the transform before anything is chosen off it.
  // It used to pick the winner in the same loop, which is only correct while
  // the choice depends on nothing but the cell in hand — and `away` compares
  // cells against each other, so the whole field has to exist first.
  let maxD = 0;
  for (let r = maxR; r >= minR; r--) {
    for (let c = maxC; c >= minC; c--) {
      if (!cells.has(key(r, c))) continue;
      let d = D.get(key(r, c));
      for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const n = D.get(key(r + dr, c + dc));
        d = Math.min(d, (n == null ? 0 : n) + 1);
      }
      D.set(key(r, c), d);
      if (d > maxD) maxD = d;
    }
  }

  // Pushed away from a neighbour, when the caller names one.
  //
  // The pole of inaccessibility is the point furthest from *any* edge, and the
  // frame counts as an edge, so a country between the republic and the rim gets
  // its name hung squarely between the two — reading as though the label were
  // about the border as much as the country. A reader wants a neighbour's name
  // out in its own ground, near the rim, well clear of the line it shares with
  // you.
  //
  // Done as a band rather than as a weight: only cells within one cell of the
  // best clearance are eligible, and among those the furthest from `away` wins.
  // Clearance is what decides whether the name and the standing under it fit at
  // all — the caller scales the text by it — so it is a constraint to be held,
  // not a term to be traded off. Without the band this walks the name straight
  // out onto the coast at half the size.
  const slack = away ? 1 : 0;
  let best = null;
  for (let r = maxR; r >= minR; r--) {
    for (let c = maxC; c >= minC; c--) {
      if (!cells.has(key(r, c))) continue;
      const d = D.get(key(r, c));
      if (d < maxD - slack) continue;
      const off = Math.abs(r - cRow) + Math.abs(c - cCol) * 0.35;
      const far = away ? Math.hypot(c * step - away[0], r * step - away[1]) : 0;
      // With no `away` every `far` is 0 and this is the old comparison exactly:
      // most clearance, ties broken toward the middle of the country.
      if (!best || far > best.far
        || (far === best.far && (d > best.d || (d === best.d && off < best.off)))) {
        best = { d, r, c, off, far };
      }
    }
  }
  if (!best) return { x: 0, y: 0, w: 40 };

  // And how much room the name has to be set in: the unbroken run of country
  // through the chosen cell, on its own row.
  const xs = (rows.get(best.r) || []).slice().sort((a, b) => a - b);
  const at = best.c * step;
  let lo = at, hi = at;
  // Walk the row's runs and keep the one the chosen cell falls in. Scanning
  // outward from `at` in two independent loops looks equivalent and is not:
  // each loop stops at the first x on the wrong side of `at`, so both bail on
  // their first step and the run comes out one cell wide every time.
  let runLo = xs[0], prev = xs[0];
  for (let i = 1; i <= xs.length; i += 1) {
    const x = xs[i];
    const ends = x == null || x - prev > step * 1.6;
    if (!ends) { prev = x; continue; }
    if (at >= runLo - step && at <= prev + step) { lo = runLo; hi = prev; break; }
    if (x == null) break;
    runLo = prev = x;
  }
  return {
    // The chosen cell's own x, not the middle of its row.
    //
    // Taking the row's midpoint looked like centring and was not: the y came
    // from the cell with the most country around it and the x came from
    // somewhere else entirely, so on a country whose southern border slopes —
    // Canada's does — the name slid along the row to a column with a third
    // less headroom than the placement had been chosen for, and sat on the
    // border with the clearance figure still cheerfully reporting 22.
    x: at,
    y: best.r * step,
    w: Math.max(step * 2, hi - lo + step),
    // How much country there is above and below, in map units. The caller uses
    // it to decide whether the name and the line under it will fit here at all.
    room: best.d * step,
  };
}

/** The bounding box of the ground one country actually holds. */
export function landExtent(g, id) {
  const pts = g.grid.pts.filter((p) => inPoly(p, g.halves[id]));
  return bounds(pts.length ? pts : g.ring);
}

/** The same, for a region defined by a predicate over the continent. */
export function labelSpot(g, id, opts = {}) {
  const pts = g.grid.pts.filter((p) => inPoly(p, g.halves[id]));
  const step = Math.sqrt(g.grid.cell);
  return pts.length ? labelSpotFrom(pts, step, opts) : { x: WORLD_W / 2, y: WORLD_H / 2, w: 60 };
}

/**
 * The middle of the ground one country holds, for a neighbour to be pushed away
 * from. Null when it holds none — there is nothing to be pushed away from then,
 * and labelSpotFrom treats a null `away` as "no preference".
 */
export function landCentre(g, id) {
  const pts = g.grid.pts.filter((p) => inPoly(p, g.halves[id]));
  if (!pts.length) return null;
  return [pts.reduce((n, p) => n + p[0], 0) / pts.length,
    pts.reduce((n, p) => n + p[1], 0) / pts.length];
}

// --- Districts -------------------------------------------------------------

/** Clip a polygon to the half-plane f(p) <= 0. */
function clipHalf(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const fa = f(A), fb = f(B);
    if (fa <= 0) out.push(A);
    if ((fa <= 0) !== (fb <= 0)) {
      const t = fa / (fa - fb);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out;
}

/** Which site owns this point, under weighted (power) distance. */
function owner(p, sites) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const d = (s.x - p[0]) ** 2 + (s.y - p[1]) ** 2 - (s.w || 0);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * A power diagram over `frame` — Voronoi with a weight per site, which is what
 * makes cell size answer to population and not to spacing alone. Every boundary
 * between two sites is a straight half-plane, so cells can be cut by clipping and
 * they always tile the frame exactly. The coast and the national border are not
 * applied here; the map clips the whole set to them at once.
 */
export function powerCells(frame, sites) {
  return sites.map((s, i) => {
    let cell = frame;
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue;
      const t = sites[j];
      const k = (t.x * t.x + t.y * t.y - (t.w || 0)) - (s.x * s.x + s.y * s.y - (s.w || 0));
      cell = clipHalf(cell, (p) => 2 * (t.x - s.x) * p[0] + 2 * (t.y - s.y) * p[1] - k);
      if (cell.length < 3) return [];
    }
    return cell;
  });
}

/**
 * Fit the cells to target shares of the country, measured on the land the country
 * actually holds.
 *
 * Lloyd relaxation alone spaces sites evenly, which gives every district the same
 * size — exactly what the old grid did wrong. So each pass also nudges the
 * weights: a district under its share gains weight and pushes its borders outward
 * against its neighbours. Measuring on the sampled land rather than on the raw
 * cells is what keeps a coastal district honest — half its cell is sea, and it
 * should be paid for the half that is not.
 */
function fitSites(points, sites, shares, { passes = 40, gain = 0.5 } = {}) {
  const n = sites.length;
  for (let pass = 0; pass < passes; pass++) {
    const cx = new Array(n).fill(0), cy = new Array(n).fill(0), cnt = new Array(n).fill(0);
    for (const p of points) {
      const i = owner(p, sites);
      cx[i] += p[0]; cy[i] += p[1]; cnt[i]++;
    }
    const spread = bounds(points);
    const scale = (spread.w * spread.h) / Math.max(1, points.length);
    for (let i = 0; i < n; i++) {
      const want = points.length * shares[i];
      if (!cnt[i]) {
        // Squeezed out entirely: hand weight back until it re-emerges.
        sites[i].w = (sites[i].w || 0) + want * scale * gain;
        continue;
      }
      sites[i].x += (cx[i] / cnt[i] - sites[i].x) * 0.6;
      sites[i].y += (cy[i] / cnt[i] - sites[i].y) * 0.6;
      sites[i].w = (sites[i].w || 0) + (want - cnt[i]) * scale * gain;
    }
  }
  return sites;
}

/** Deterministic, well-spread starting sites among a set of points. */
function seedSites(points, n, seed) {
  const rand = mulberry32(hashSeed(String(seed)));
  if (!points.length) return Array.from({ length: n }, () => ({ x: 0, y: 0, w: 0 }));
  const chosen = [points[Math.floor(rand() * points.length)]];
  // Farthest-point selection, sampled rather than exhaustive: n is at most 20 and
  // the point set is a few thousand.
  while (chosen.length < n) {
    let best = points[0], bestD = -1;
    for (let k = 0; k < 400; k++) {
      const p = points[Math.floor(rand() * points.length)];
      let d = Infinity;
      for (const q of chosen) d = Math.min(d, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2);
      if (d > bestD) { bestD = d; best = p; }
    }
    chosen.push(best);
  }
  return chosen.map((p) => ({ x: p[0], y: p[1], w: 0 }));
}

/**
 * Replace the straight internal boundaries between cells with matched fractal
 * ones. A border that follows a river or a ridge is what an administrative map
 * actually looks like; a fan of exact straight lines is what a generator looks
 * like.
 *
 * The displacement for a boundary is seeded on the *pair* of cells that share it
 * and generated from its endpoints in a fixed order, so both cells receive the
 * identical polyline and no gap or overlap can open between them. It tapers to
 * nothing at each end, so a boundary still meets the coast, and the other
 * boundaries, exactly where it did.
 */
export function wobbleShared(cells, sites, { amp = 0.14, rounds = 3, key = 'd' } = {}) {
  const partner = (mid, i) => {
    const s = sites[i];
    const ds = (s.x - mid[0]) ** 2 + (s.y - mid[1]) ** 2 - (s.w || 0);
    let best = -1, bestGap = Infinity;
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue;
      const t = sites[j];
      const dt = (t.x - mid[0]) ** 2 + (t.y - mid[1]) ** 2 - (t.w || 0);
      const gap = Math.abs(dt - ds);
      if (gap < bestGap) { bestGap = gap; best = j; }
    }
    // A tie means the midpoint is genuinely equidistant, so the edge is an
    // internal boundary. Anything else is the frame's own edge, which must not
    // move — it is about to be clipped to the coast.
    return bestGap < 0.9 ? best : -1;
  };

  return cells.map((cell, i) => {
    if (cell.length < 3) return cell;
    const out = [];
    for (let v = 0; v < cell.length; v++) {
      const p = cell[v], q = cell[(v + 1) % cell.length];
      out.push(p);
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const j = partner(mid, i);
      if (j < 0) continue;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 6) continue;
      // Fixed endpoint order, so both neighbours generate the same curve.
      const flip = p[0] > q[0] || (p[0] === q[0] && p[1] > q[1]);
      const a = flip ? q : p, b = flip ? p : q;
      const curve = fractalLine(a, b, { seed: `${key}/${Math.min(i, j)}-${Math.max(i, j)}`, rounds, amp, taper: true });
      const inner = curve.slice(1, -1);
      out.push(...(flip ? inner.reverse() : inner));
    }
    return out;
  });
}

/**
 * The districts of a country, as polygons over a frame, plus a label spot for
 * each measured on the land it actually holds.
 *
 * `points` is the sampled land of that country; `frame` is the rectangle the
 * cells are cut from. The caller clips the result to the coast and the border.
 */
export function subdivide(points, frame, weights, seed) {
  const n = weights.length;
  if (!n) return [];
  const tot = weights.reduce((a, b) => a + Math.max(1, b), 0);
  const shares = weights.map((v) => Math.max(1, v) / tot);
  const sites = fitSites(points, seedSites(points, n, String(seed) + '/sites'), shares);

  // Assign the sampled land once more, for areas and for label spots that are
  // guaranteed to be on the district's own ground.
  const owned = sites.map(() => []);
  for (const p of points) owned[owner(p, sites)].push(p);

  const cells = wobbleShared(powerCells(frame, sites), sites, { key: String(seed) + '/edge' });
  const spread = bounds(points.length ? points : frame);
  const step = Math.max(1, Math.sqrt((spread.w * spread.h) / Math.max(1, points.length)));
  return sites.map((s, i) => ({
    site: s,
    poly: cells[i] || [],
    share: owned[i].length / Math.max(1, points.length),
    spot: owned[i].length ? labelSpotFrom(owned[i], step) : null,
  }));
}

/** Scanline-sample the land of one country, at whatever resolution is wanted. */
function landIn(ring, half, step) {
  const b = bounds(ring);
  const pts = [];
  for (let y = b.y0 + step / 2; y < b.y1; y += step) {
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil((xs[k] - b.x0) / step) * step + b.x0; x < xs[k + 1]; x += step) {
        const p = [x, y];
        if (inPoly(p, half)) pts.push(p);
      }
    }
  }
  return pts;
}

// Population drifts every tick and the map repaints every tick, so the geometry
// is signed rather than recomputed: it is rebuilt when a district's population
// actually moves by a quarter of a thousand, or when parcels change hands
// (a REDISTRICT clause), and reused otherwise.
let CITY = { sig: null, value: null };

/**
 * The districts map: Silver's real territory, subdivided.
 *
 * Districts are sized by population and bounded by the republic's own border and
 * coastline, so a coastal district is the shape the coast leaves it and a dense
 * one is small and tight. Each district is then subdivided again into its
 * parcels, so nothing on this map is a square — the grid the engine indexes
 * parcels by is bookkeeping, not geography.
 */
export function cityGeometry(world) {
  const all = world.districts || [];
  const parcels = world.city?.parcels || [];
  // A district holding no parcels holds no ground, and giving it a slice anyway
  // put a nameless splinter on the map. The land is divided between the districts
  // that actually exist on it.
  const onGround = all.filter((d) => parcels.some((p) => p.district === d.id));
  const ds = onGround.length ? onGround : all;
  const sig = [
    world.nation,
    ds.map((d) => `${d.id}:${Math.round((d.pop || 0) / 250)}`).join(','),
    parcels.map((p) => p.district).join(','),
  ].join('|');
  if (CITY.sig === sig) return CITY.value;

  const g = geography(world.nation, world.mapSeed || 0);
  const key = String(world.nation || 'silver');
  const b = bounds(g.ring);
  const frame = [[b.x0 - OUT, b.y0 - OUT], [b.x1 + OUT, b.y0 - OUT], [b.x1 + OUT, b.y1 + OUT], [b.x0 - OUT, b.y1 + OUT]];

  // A finer sample than the world map's, because the parcels inside a district
  // are cut from it too.
  const land = landIn(g.ring, g.halves.silver, 1);
  const value = { g, frame, land, extent: bounds(land.length ? land : g.ring), cells: [] };
  if (!ds.length || !land.length) { CITY = { sig, value }; return value; }

  const parts = subdivide(land, frame, ds.map((d) => d.pop || 1), key + '/districts');

  // Each district's own land, then its parcels cut from that. Parcels are all of
  // a size — a parcel is a unit of land, not a population — so they get no
  // weights, only Lloyd's relaxation and the same wandering edges.
  const ownerOfPoint = parts.map(() => []);
  for (const p of land) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].site;
      const d = (s.x - p[0]) ** 2 + (s.y - p[1]) ** 2 - (s.w || 0);
      if (d < bestD) { bestD = d; best = i; }
    }
    ownerOfPoint[best].push(p);
  }

  value.cells = parts.map((part, i) => {
    const d = ds[i];
    const mine = parcels.filter((pp) => pp.district === d.id);
    const pts = ownerOfPoint[i];
    const sub = mine.length && pts.length
      ? subdivide(pts, part.poly.length > 2 ? part.poly : frame, mine.map(() => 1), `${key}/${d.id}/parcels`)
      : [];
    return {
      district: d,
      poly: part.poly,
      spot: part.spot,
      share: part.share,
      parcels: sub.map((s, k) => ({ parcel: mine[k], poly: s.poly, site: s.site })),
    };
  });

  CITY = { sig, value };
  return value;
}

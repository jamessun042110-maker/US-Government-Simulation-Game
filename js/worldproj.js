// The world frame, and the bridge between it and the atlas's.
//
// There are two projections in this game and they answer different questions.
// `atlas.P` is North America at about three and a half units to the degree with
// a latitude correction fitted to 37°N: it is the frame the country is played
// on, and everything the engine counts — parcels, districts, frontiers, land
// shares — is measured in it. This one is the whole globe, and nothing is
// measured in it at all. It exists so the World tab can be a map of the world.
//
// Keeping them separate is deliberate. Re-anchoring the atlas on a global
// projection would shrink the United States to a fifth of the frame and make
// every hand-checked coordinate in atlas.js wrong at once, to gain nothing: the
// Domestic map wants the country filling the page. So the atlas keeps its frame,
// and anything that has to appear on the world map is converted through degrees
// — which is exactly what `atlas.unP` is for, and why it exists.
import { unP } from './atlas.js';

/** 2:1 equirectangular, two units to the degree. */
export const WORLD_W = 720, WORLD_H = 360;

/** A real place, in world-frame units. Latitude first, as everywhere else here. */
export const PW = (lat, lon) => [
  +((lon + 180) * (WORLD_W / 360)).toFixed(2),
  +((90 - lat) * (WORLD_H / 180)).toFixed(2),
];

/**
 * The viewport, cropped.
 *
 * Antarctica is a sixth of an equirectangular frame and nothing in this game
 * happens there; the Arctic above 84°N is ocean. Cropping to 84°N–58°S spends
 * the height on the latitudes countries are actually in — and it is a viewBox
 * rather than a change to the projection, so PW stays the plain thing it says
 * it is and every coordinate remains checkable.
 */
export const VIEW = { x: 0, y: (90 - 84) * (WORLD_H / 180), w: WORLD_W, h: (84 + 58) * (WORLD_H / 180) };

/** GeoJSON order — [lon, lat] — because that is how worldmap.js stores it. */
export const fromLonLat = ([lon, lat]) => PW(lat, lon);
export const ringOfLonLat = (r) => r.map(fromLonLat);

/** An atlas-frame point, in world-frame units: back through degrees and out again. */
export const fromAtlas = (pt) => { const [lat, lon] = unP(pt); return PW(lat, lon); };
export const ring = (pts) => (pts || []).map(fromAtlas);

/**
 * A whole geography, moved into the world frame.
 *
 * Everything the World tab draws hangs off the object `geo.mapOf` returns, and
 * everything it *positions* — capital rings, name anchors, the standing under
 * them — is computed from those same polygons rather than stored separately. So
 * converting the polygons once converts the entire drawing, and the twenty-odd
 * call sites downstream never learn that anything moved.
 *
 * `share`, `annexed`, `north` and `south` are numbers rather than geometry and
 * are carried across untouched.
 *
 * `grid` comes too, because `geo.labelSpot` and `geo.landCentre` are what decide
 * where a country's name and capital go and both walk it — a name placed from
 * atlas-frame points onto a world-frame map lands in the ocean. Its `step` and
 * `cell` are rescaled with it: the sampling stays the same ground, measured in
 * the new frame's units.
 *
 * `terrain` and `isIn` do not. The terrain washes are drawn with glyphs authored
 * at fixed sizes for a frame where the United States filled the page — a ridge
 * is four units wide, and four units is now most of Colorado — so at world scale
 * they are noise drawn three times too large on one country out of two hundred.
 * Every consumer already guards for their absence. `isIn` is a point test that
 * closes over the *atlas*-frame polygons, and one that silently answers in the
 * wrong frame is worse than one that is not there.
 */
export function toWorld(g) {
  if (!g) return g;
  const halves = {};
  for (const k of Object.keys(g.halves || {})) halves[k] = ring(g.halves[k]);
  // Measured rather than assumed: the two frames differ in scale *and* in the
  // latitude correction, so the honest way to get the factor is to project a
  // known span and look at what came out.
  const a0 = fromAtlas([0, 0]), a1 = fromAtlas([10, 0]);
  const scale = Math.abs(a1[0] - a0[0]) / 10 || 1;
  const grid = g.grid ? {
    ...g.grid,
    pts: ring(g.grid.pts),
    step: (g.grid.step || 2) * scale,
    cell: ((g.grid.step || 2) * scale) ** 2,
  } : g.grid;
  return {
    ...g,
    ring: ring(g.ring),
    halves,
    sab: ring(g.sab),
    borders: g.borders ? { a: ring(g.borders.a), b: ring(g.borders.b) } : g.borders,
    sabTaken: g.sabTaken ? { ...g.sabTaken, poly: ring(g.sabTaken.poly), line: ring(g.sabTaken.line) } : null,
    grid,
    terrain: undefined,
    isIn: undefined,
  };
}

/**
 * The oceans and the seas that a map of the world names.
 *
 * atlas.SEAS names four bodies of water, all of them in North America, because
 * that is all its frame could see. At this scale those four are a corner of the
 * picture. Positions are in open water at every latitude the crop shows, and
 * `size` is relative in the same way — an ocean larger than a sea.
 */
export const WORLD_SEAS = [
  { name: 'North Pacific Ocean', at: PW(30, -155), size: 1 },
  { name: 'South Pacific Ocean', at: PW(-25, -125), size: 1 },
  { name: 'North Atlantic Ocean', at: PW(32, -45), size: 1 },
  { name: 'South Atlantic Ocean', at: PW(-28, -18), size: 1 },
  { name: 'Indian Ocean', at: PW(-25, 78), size: 1 },
  { name: 'Arctic Ocean', at: PW(80, 5), size: 0.8 },
  { name: 'Southern Ocean', at: PW(-55, 100), size: 0.8 },
  { name: 'Caribbean Sea', at: PW(14.5, -73), size: 0.5 },
  { name: 'Gulf of Mexico', at: PW(25.2, -90.5), size: 0.5 },
  { name: 'Mediterranean Sea', at: PW(35, 17), size: 0.5 },
  { name: 'Bay of Bengal', at: PW(14, 88), size: 0.45 },
  { name: 'Arabian Sea', at: PW(14, 63), size: 0.45 },
  { name: 'South China Sea', at: PW(13, 115), size: 0.45 },
  { name: 'Coral Sea', at: PW(-18, 155), size: 0.45 },
  { name: 'Bering Sea', at: PW(57, -177), size: 0.45 },
];

// The real North America, in the frame the engine draws in.
//
// Silver's continent was invented: a hand-drawn silhouette roughened by a
// fractal, cut into three countries by borders that were *solved* against target
// land shares. This replaces the invention with the real thing, and keeps the
// solving.
//
// **Everything here is written in degrees.** The atlas is data about a real
// place, and data about a real place should be checkable against a map — a
// reader can hold `P(25.8, -80.2)` against Miami and see that it is Miami, which
// is not true of `[216.3, 159.7]`. The projection to frame units happens once,
// here, and nothing downstream ever sees a degree again.
//
// The projection is equirectangular with a latitude correction: longitude
// degrees are narrower than latitude degrees away from the equator, and at the
// mid-latitudes of the United States the ratio is about 0.8. Without the
// correction the country comes out visibly stretched east-west — Texas as wide
// as it is tall, which is wrong by half. This is not a survey projection and is
// not trying to be: it is trying to be recognisable at a glance in a 340×232
// box.

// **This module imports nothing.** geo.js imports the atlas, so the atlas
// importing geo.js back would be the first module cycle in the codebase — the
// frame size is repeated here as two numbers rather than reached for. A test
// asserts the two definitions agree.
const WORLD_W = 340, WORLD_H = 232;

// --- Projection --------------------------------------------------------------

// The anchor: 49°N (the western Canada border) and 125°W (the Pacific coast) sit
// at this point in the frame, and everything else is measured from it.
const X0 = 55, Y0 = 60;
const LAT0 = 49, LON0 = -125;
// Frame units per degree. SY/SX ≈ 1.19, the latitude correction at ~37°N.
const SX = 3.6, SY = 4.3;

/** A real place, in frame units. Latitude first, the way coordinates are said. */
export const P = (lat, lon) => [
  +(X0 + (lon - LON0) * SX).toFixed(2),
  +(Y0 + (LAT0 - lat) * SY).toFixed(2),
];

/** Frame units back to degrees — for tests and for reading a click off the map. */
export const unP = ([x, y]) => [LAT0 - (y - Y0) / SY, LON0 + (x - X0) / SX];

// --- Shared anchors ----------------------------------------------------------
//
// A border is shared by two states, and the two of them must agree on it to the
// last decimal or the map gets a seam. Identical arguments to `P` give identical
// output, so discipline alone is enough for most of it — but the junctions where
// three or more regions meet are worth naming, because those are where a typo
// shows up as a visible hole rather than as a slightly wrong line.

const FOUR_CORNERS = P(37, -109);      // UT/CO/AZ/NM, the only real quadripoint
const YUMA = P(32.7, -114.7);          // where the Mexican border meets the Colorado
const EL_PASO = P(31.8, -106.5);       // the Rio Grande's turn
const BROWNSVILLE = P(25.9, -97.4);    // the Rio Grande's mouth
const CAPE_FLATTERY = P(48.4, -124.7); // the north-west corner of the country
const LAKE_OF_WOODS = P(49, -95.2);    // where the 49th parallel gives out
const KEY_WEST = P(24.6, -81.8);       // the southern tip
const EASTPORT = P(45, -67);           // the north-east corner

// --- The national outline ----------------------------------------------------
//
// Clockwise from the north-west corner: down the Pacific, along the Mexican
// border, around the Gulf, around Florida, up the Atlantic, and home along the
// lakes and the 49th parallel. These are the vertices that make the country
// *recognisable* — the Californian bulge, the Gulf curve, the Florida peninsula,
// the Maine corner. Coastline detail below this scale is added by `coast()`,
// which roughens the line without moving it.

// The country is stored as four segments rather than one loop, because two of
// the four are **frontiers that move**. Silver's borders were fractal lines
// solved against target land shares, and a won war re-solved them; the real
// borders cannot be re-solved, so they are offset instead — and offsetting a
// segment is only possible if the segment is a thing you can name.
//
// Coast never moves. Frontiers do. `ringsAt` below reassembles all three
// countries from these four pieces at any offset.

/** The Pacific coast, north to south: Cape Flattery down to San Diego. */
export const COAST_PACIFIC = [
  CAPE_FLATTERY,
  P(46.3, -124.1), P(42.8, -124.6), P(40.4, -124.4),  // Oregon coast, Cape Mendocino
  P(37.8, -122.5), P(35.4, -120.9), P(34.4, -120.5),  // San Francisco, Point Conception
  P(33.7, -118.2), P(32.5, -117.1),                    // Los Angeles, San Diego
];

/** The Gulf and Atlantic coasts, west to east then north: Brownsville to Maine. */
export const COAST_ATLANTIC = [
  P(27.8, -97.4), P(29.3, -94.8), P(29.7, -93.8),      // the Texas coast
  P(29.2, -89.4), P(30.2, -88), P(30.4, -87.2),        // the delta, Mobile, Pensacola
  P(29.7, -85), P(27.8, -82.6), KEY_WEST,              // the Florida panhandle and gulf coast
  P(25.8, -80.2), P(28.4, -80.6), P(30.3, -81.4),      // Miami, Canaveral, Jacksonville
  P(32.1, -81.1), P(32.8, -79.9), P(35.2, -75.5),      // Savannah, Charleston, Hatteras
  P(36.9, -76), P(38.8, -75), P(40.6, -74),            // the Chesapeake, Delaware Bay, New York
  P(41.7, -70), P(43.7, -70.2), EASTPORT,              // Cape Cod, Portland, the Maine corner
];

// --- The neighbours ----------------------------------------------------------
//
// Canada and Mexico are drawn only as far as the frame shows them. Neither is a
// survey either: what matters is that Canada reads as the larger country across
// the top and Mexico as the one tapering away south, because those are the two
// facts a player uses when deciding who to fight.

/** The US–Canada frontier, west to east. The line a won northern war moves. */
export const BORDER_CA = [
  P(49, -123), LAKE_OF_WOODS, P(46.8, -92.1), P(46.5, -84.3),
  P(43, -82.4), P(42.1, -83.1), P(43.1, -79.1), P(44.1, -76.4),
  P(45, -73.3), P(47.4, -69.2), EASTPORT,
];

/** The US–Mexico frontier, west to east. The line a won southern war moves. */
export const BORDER_MX = [
  P(32.5, -117.1), YUMA, EL_PASO, P(29.2, -102.9), P(27.5, -99.5), BROWNSVILLE,
];

// Far enough outside the frame that a closure can never clip anything real.
const OUT = 90;
// The continent stops just outside the frame, not `OUT` units outside it — see
// CONTINENT_RING below for why the two margins are different.
const EDGE = 2;

// --- Canada -------------------------------------------------------------------
//
// Canada was a rectangle: the frontier along the bottom and the frame's corners
// everywhere else. It is the second largest country on earth and it was drawn as
// a bar across the top of the picture.
//
// The frame reaches about 63°N, which is enough room for the two things that
// make the shape read as Canada — **Hudson Bay**, a bay the size of the Gulf of
// Mexico biting a third of the way down the country, and the Atlantic coast of
// Labrador and Newfoundland. Both are in.
//
// Alaska is deliberately absent. It belongs north-west of here, and drawing it
// would put a piece of the United States on the far side of Canada at the edge
// of the frame, where it reads as a mistake. It is an inset, the way every US
// map does it.

/** British Columbia's coast, from the frontier's west end up out of frame. */
const COAST_CANADA_PACIFIC = [
  P(50.5, -127.5), P(52.5, -129), P(54.5, -130.5), P(56, -131),
  [P(56, -131)[0], -EDGE],
];

/** The Arctic edge, west to east, with Hudson Bay cut into it. */
const COAST_CANADA_ARCTIC = [
  [P(60, -95)[0], -EDGE],
  P(60, -94), P(56, -91), P(53, -86), P(51.2, -81.5),   // down the bay's west shore to James Bay
  P(55, -78.5), P(58.5, -77.5), P(62, -74),              // and back up its eastern one
  [P(62, -72)[0], -EDGE], [P(58, -62)[0], -EDGE],
];

/** Labrador and Newfoundland, down to the Maine corner. */
const COAST_CANADA_ATLANTIC = [
  P(58, -62), P(54.5, -58), P(51, -55.5), P(48.5, -53.5),
  P(46.8, -56), P(46, -60), P(45.5, -64), EASTPORT,
];

/**
 * Mexico's own coasts: Brownsville, round the isthmus, and up the Pacific — then
 * into the Gulf of California, down the length of Baja and back up its far side.
 *
 * Baja was a single vertex before, which fused the peninsula to the mainland and
 * drew Mexico as one blunt wedge. The Gulf of California is the second most
 * recognisable thing about the country's shape after the isthmus, and it is a
 * notch two hundred and fifty miles deep — so the outline has to go down one
 * side of it and up the other.
 */
const COAST_MEXICO = [
  // The Gulf coast, running south from the Rio Grande's mouth.
  P(22.2, -97.8), P(19.2, -96.1), P(18.7, -95.1), P(18.4, -93.6),
  // **The Bay of Campeche and the Yucatán.** Both were missing: the outline ran
  // from Veracruz straight across to the Pacific side, which cut off the whole
  // south-east of the country and drew Mexico as a wedge that stopped at the
  // isthmus. The Yucatán is a peninsula the size of England sitting well inside
  // this frame — a player looking for the top of Latin America was looking at
  // open sea where it should have been.
  P(18.6, -91.5), P(19.8, -90.6),                     // round the Bay of Campeche
  P(21.5, -90.3), P(21.6, -88), P(21.4, -86.9),       // the Yucatán's north coast to Cabo Catoche
  P(19.6, -87.5), P(18.5, -88.3),                     // down the Caribbean shore to Chetumal
  // The southern frontier: Belize and Guatemala. Not drawn as a border — this is
  // a coastline polygon — but it is where Mexico stops, and it has to be here or
  // the country runs off the bottom of the map.
  P(17.8, -89.1), P(16, -90.1), P(15.1, -92.2), P(14.6, -92.3),
  // The Pacific coast, running back north-west.
  P(15.8, -96.5), P(16.9, -99.9), P(18.5, -103.5),
  P(20, -105.5), P(23, -106.5), P(26, -109),          // the Pacific coast north
  P(28.5, -111.5), P(31.4, -114.7),                   // into the head of the Gulf of California
  P(29.5, -114.2), P(27, -112.2), P(24.5, -110.4),    // down Baja's inner shore
  P(22.9, -109.9),                                    // Cabo San Lucas
  P(24.5, -112), P(27, -114.2), P(29.5, -115.6), P(31.5, -116.8), // and up its ocean side
];

/**
 * The three countries, with both frontiers offset by the given number of units.
 *
 * This is the whole annexation mechanism, and it is the reason the borders are
 * stored as segments. `north` slides the Canadian frontier up — the United
 * States gaining ground — and `south` slides the Mexican one down. Both are in
 * frame units, both default to nothing, and at zero this returns the country as
 * founded.
 *
 * The coasts do not move, so a frontier that has been pushed leaves a step where
 * it meets the sea. That is correct and not a seam: a war moves the border and
 * the border ends at the water, so the corner of the country moves with it.
 *
 * Canada's closure has to leave its frontier *horizontally* before turning
 * north. Running straight from the frontier's western end to the off-frame
 * corner draws a diagonal across the Pacific and renders Canada as a wedge
 * pointing at Seattle, which is what the first draft of this did.
 */
export function ringsAt(north = 0, south = 0) {
  const ca = BORDER_CA.map(([x, y]) => [x, y - north]);
  const mx = BORDER_MX.map(([x, y]) => [x, y + south]);
  const caEnd = ca[ca.length - 1], mxEnd = mx[mx.length - 1];

  // Where the frontier is at a given longitude — the northernmost of whatever
  // segments span it, so the Great Lakes jog (where the line doubles back west
  // around Detroit) cannot pick the wrong one.
  const frontierAt = (line) => (x) => {
    let best = null;
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      if (x < Math.min(x0, x1) || x > Math.max(x0, x1)) continue;
      const t = (x - x0) / ((x1 - x0) || 1);
      const y = y0 + (y1 - y0) * t;
      if (best === null || y < best) best = y;
    }
    if (best !== null) return best;
    return x <= line[0][0] ? line[0][1] : line[line.length - 1][1];
  };

  // Canada's coast, held north of its own frontier.
  //
  // The coasts do not move when a war does — only the frontier does — but the
  // polygon still has to stay a polygon. Driven far enough north the frontier
  // crosses the coastline, the ring folds through itself, and a ray-casting
  // point test starts reporting the XOR of the overlap: Canada was annexed
  // outright and kept 9.8% of the continent, in scattered pieces. Clamping each
  // coast vertex to the frontier collapses the shape cleanly to nothing instead.
  //
  // At rest this changes not one vertex — every Canadian coast point is already
  // north of the 49th parallel, including Newfoundland, which sits south of it
  // but east of where the frontier ends.
  const caY = frontierAt(ca);
  const held = (pts) => pts.map(([x, y]) => [x, Math.min(y, caY(x))]);

  // And Mexico's coast, held *south* of its own frontier — the same clamp in the
  // other direction, and needed for the same reason.
  //
  // Mexico did not have one, and got away with it for exactly as long as its
  // coastline was shallow: the old outline stopped at the isthmus, so a frontier
  // driven far enough south cleared the whole of it and the shape collapsed to
  // nothing on its own. Drawing the Yucatán put land four degrees further south
  // and a peninsula that runs back *north* to Cabo Catoche, so a frontier
  // pushed into that latitude band cut the country in two and left the
  // peninsula behind as a detached lobe. Annexing both neighbours outright then
  // left 2% of the continent in Mexican hands — the same fold-through, and the
  // same ray-casting XOR, that cost Canada 9.8% before `held` existed.
  const mxY = frontierAt(mx);
  const heldSouth = (pts) => pts.map(([x, y]) => [x, Math.max(y, mxY(x))]);

  return {
    // Clockwise: down the Pacific, along the Mexican frontier, round the Gulf
    // and up the Atlantic, then home westward along the Canadian frontier.
    us: [...COAST_PACIFIC, ...mx, ...COAST_ATLANTIC, ...ca.slice().reverse()],
    // Canada is its own coastline now rather than the frame's corners: up the
    // British Columbia shore, across the Arctic with Hudson Bay cut into it,
    // down Labrador to Maine, and home along the frontier.
    //
    // The coasts do not move with the frontier — only the frontier moves — but
    // the polygon still has to *close* around wherever the frontier has been
    // driven to, which the reversed `ca` at the end does for free. Driven far
    // enough north the whole shape inverts to nothing, which is what lets a
    // power be annexed out of existence.
    canada: [
      ...held(COAST_CANADA_PACIFIC), ...held(COAST_CANADA_ARCTIC), ...held(COAST_CANADA_ATLANTIC),
      ...ca.slice().reverse(),
    ],
    mexico: [...mx, ...heldSouth(COAST_MEXICO)],
    borders: { canada: ca, mexico: mx },
  };
}

const FOUNDED = ringsAt();

/** The United States as founded. */
export const US_RING = FOUNDED.us;
/** Canada as founded, out of frame at the top. */
export const CANADA_RING = FOUNDED.canada;
/** Mexico as founded — a real silhouette, Baja and all, rather than a fill. */
export const MEXICO_RING = FOUNDED.mexico;

/**
 * Central America — the isthmus, from the Guatemalan border down to Colombia.
 *
 * **Nobody holds this.** It is scenery, and it is deliberately not part of
 * `CONTINENT_RING`: the engine counts land shares as
 * `canada ? canada : mexico ? mexico : us`, so any ground added to the continent
 * that neither neighbour positively claims becomes the United States. An isthmus
 * that quietly annexed itself to us the moment it was drawn is worse than no
 * isthmus, so this ring lives outside the territory system entirely and only the
 * map reads it.
 *
 * It is here because the continent used to stop dead at the Guatemalan border
 * with twenty-four units of empty sea under it — a blunt polygon edge in open
 * water, which reads as a drawing that was not finished rather than as a country
 * that ends. A frame edge reads as "the map continues"; a straight cut in the
 * middle of the ocean does not. So the land now runs off the bottom of the
 * frame, which it does at about 9°N — Panama is south of that and is clipped by
 * the viewport, exactly as a real map clips it.
 *
 * The three vertices along the top are written with the same arguments as
 * Mexico's southern frontier, so the two shapes share that edge without a seam.
 */
export const CENTRAL_AMERICA = [
  // The Caribbean shore, running south-east from Chetumal.
  P(18.5, -88.3), P(16.0, -88.9),                     // Belize
  P(15.8, -85.5), P(15.9, -83.2),                     // the Honduran north coast to Gracias a Dios
  P(14.0, -83.4), P(12.2, -83.7),                     // the Mosquito Coast
  P(10.9, -83.5), P(9.6, -82.6),                      // Costa Rica and Bocas del Toro
  P(9.4, -79.9), P(9.6, -77.8), P(8.0, -77.3),        // Panama, and the Colombian frontier
  // The Pacific shore, running back north-west.
  P(7.2, -78.0), P(8.4, -79.5), P(8.0, -80.9),        // the Darién and the Azuero peninsula
  P(8.6, -82.9), P(9.4, -84.1), P(10.6, -85.7),       // Chiriquí to Nicoya
  P(12.0, -87.0), P(13.2, -88.5), P(13.8, -90.5),     // Nicaragua, El Salvador, Guatemala
  // And home along the frontier Mexico stops at — the same three points, so the
  // two polygons meet exactly.
  P(14.6, -92.3), P(15.1, -92.2), P(16.0, -90.1), P(17.8, -89.1),
];

/**
 * North America: everything the map draws land for.
 *
 * The engine's `ring` is the whole continent, which the country polygons are
 * then cut out of. Here it is the outer boundary of all three at once — the
 * Pacific down past Baja, round Mexico, up the Gulf and Atlantic, and along the
 * top of the frame where Canada runs off it.
 */
/**
 * North America: the outer boundary of all three countries at once.
 *
 * This is no longer a box with the coasts cut out of the bottom. It is the
 * continent's actual outline, walked once clockwise — up the British Columbia
 * coast, east along the Arctic with Hudson Bay cut into it, down Labrador and
 * the whole Atlantic seaboard, round the Gulf and Florida, down Mexico and
 * around Baja, and back up the Pacific.
 *
 * The margin matters and is not `OUT`. Country polygons are closed far off-frame
 * on purpose — they are clipped by this ring, so a generous closure can never go
 * wrong. The continent is the opposite: it *defines* what land is, and every
 * share in the game is measured against it. Closed at OUT it enclosed ninety
 * units of empty north, and Canada came out holding 79.7% of a continent it
 * should hold about half of — not because a border was wrong, but because the
 * ocean was being counted as Canadian.
 */
export const CONTINENT_RING = [
  ...COAST_CANADA_PACIFIC, ...COAST_CANADA_ARCTIC, ...COAST_CANADA_ATLANTIC,
  // Atlantic southward (reversed), then Mexico's own coasts — which already run
  // south round the isthmus and back north — then the Pacific northward.
  ...COAST_ATLANTIC.slice().reverse(),
  ...COAST_MEXICO,
  ...COAST_PACIFIC.slice().reverse(),
];

// --- The twenty states -------------------------------------------------------
//
// Fifty merged down to twenty, which is not an arbitrary target: `MAX_DISTRICTS`
// in world.js is twenty, so it is the ceiling the engine already had.
//
// The merges keep whole the six states a player can find without being told —
// New York, Florida, Texas, California, Michigan, Illinois — and group the rest
// regionally, on the theory that someone who cannot place Rhode Island can still
// place New England.
//
// Every polygon is clockwise and every shared edge is written with identical
// arguments on both sides, so the twenty of them tile the country without seams.
// Where a state meets the sea its outer edge is taken from US_RING's vertices,
// for the same reason.

export const STATES = [
  {
    id: 'new-england', name: 'New England', code: 'NE', people: 15.1, liberal: 0.6, jobless: 0.039, rough: 27, homeValue: 520, income: 89000,
    merged: ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut'],
    poly: [
      EASTPORT, P(43.7, -70.2), P(41.7, -70), P(41, -71.9), P(41, -73.5),
      P(42.7, -73.3), P(45, -73.3), P(47.4, -69.2),
    ],
  },
  {
    id: 'new-york', name: 'New York', code: 'NY', people: 20.2, liberal: 0.61, jobless: 0.044, rough: 52, homeValue: 460, income: 82000, merged: ['New York'],
    poly: [
      P(45, -73.3), P(42.7, -73.3), P(41, -73.5), P(40.6, -74), P(41.4, -74.7),
      P(42, -75.4), P(42, -79.8), P(43.1, -79.1), P(44.1, -76.4),
    ],
  },
  {
    id: 'mid-atlantic', name: 'Mid-Atlantic', code: 'MA', people: 30.2, liberal: 0.57, jobless: 0.039, rough: 13, homeValue: 350, income: 85000,
    merged: ['New Jersey', 'Pennsylvania', 'Delaware', 'Maryland', 'D.C.'],
    poly: [
      P(42, -79.8), P(42, -75.4), P(41.4, -74.7), P(40.6, -74), P(38.8, -75),
      P(38, -75.6), P(38, -78.4), P(39.7, -79.5), P(39.7, -80.5), P(41.5, -80.5),
    ],
  },
  {
    id: 'virginia', name: 'Virginia', code: 'VA', people: 10.4, liberal: 0.505, jobless: 0.031, rough: 8, homeValue: 350, income: 82000, merged: ['Virginia', 'West Virginia'],
    poly: [
      P(39.7, -80.5), P(39.7, -79.5), P(38, -78.4), P(38, -75.6), P(36.9, -76),
      P(36.5, -75.9), P(36.5, -81.7), P(37.5, -82.3), P(38.4, -82.5), P(40.6, -80.5),
    ],
  },
  {
    id: 'carolinas', name: 'The Carolinas', code: 'CR', people: 15.5, liberal: 0.47, jobless: 0.039, rough: 10, homeValue: 310, income: 68000,
    merged: ['North Carolina', 'South Carolina'],
    poly: [
      P(36.5, -81.7), P(36.5, -75.9), P(35.2, -75.5), P(33.9, -78), P(32.8, -79.9),
      P(32.1, -81.1), P(34.8, -83.1), P(35, -84),
    ],
  },
  {
    id: 'florida', name: 'Florida', code: 'FL', people: 21.5, liberal: 0.48, jobless: 0.033, rough: 14, homeValue: 390, income: 71000, merged: ['Florida'],
    poly: [
      P(31, -87.6), P(31, -85), P(30.7, -83), P(30.7, -81.5), P(30.3, -81.4),
      P(28.4, -80.6), P(25.8, -80.2), KEY_WEST, P(27.8, -82.6), P(29.7, -85),
      P(30.4, -87.2), P(30.2, -88), P(31, -87.6),
    ],
  },
  {
    id: 'deep-south', name: 'Deep South', code: 'DS', people: 18.7, liberal: 0.45, jobless: 0.034, rough: 9, homeValue: 240, income: 66000,
    merged: ['Georgia', 'Alabama', 'Mississippi'],
    poly: [
      P(35, -84), P(34.8, -83.1), P(32.1, -81.1), P(30.7, -81.5), P(30.7, -83),
      P(31, -85), P(31, -87.6), P(30.2, -88), P(30.2, -89.6), P(31, -91.5),
      P(35, -90), P(35, -88.2),
    ],
  },
  {
    id: 'upper-south', name: 'Upper South', code: 'UP', people: 11.4, liberal: 0.37, jobless: 0.04, rough: 12, homeValue: 240, income: 63000,
    merged: ['Kentucky', 'Tennessee'],
    poly: [
      P(38.4, -82.5), P(37.5, -82.3), P(36.5, -81.7), P(35, -84), P(35, -88.2),
      P(35, -90), P(36.5, -89.7), P(37, -89.1), P(38, -88), P(37.8, -84.8),
      P(38.8, -84.8), P(39, -84.8),
    ],
  },
  {
    id: 'ohio-valley', name: 'Ohio Valley', code: 'OV', people: 18.6, liberal: 0.44, jobless: 0.042, rough: 11, homeValue: 220, income: 68000, merged: ['Ohio', 'Indiana'],
    poly: [
      P(41.7, -84.8), P(41.7, -83.5), P(41.5, -80.5), P(40.6, -80.5), P(38.4, -82.5),
      P(39, -84.8), P(38.8, -84.8), P(37.8, -84.8), P(38, -88), P(41.7, -87.5),
      P(41.7, -84.8),
    ],
  },
  {
    id: 'michigan', name: 'Michigan', code: 'MI', people: 10.1, liberal: 0.51, jobless: 0.045, rough: 9, homeValue: 230, income: 69000, merged: ['Michigan'],
    poly: [
      P(46.5, -90), P(46.5, -84.3), P(43, -82.4), P(42.1, -83.1), P(41.7, -83.5),
      P(41.7, -84.8), P(41.7, -86.8), P(45.1, -86.3), P(45.8, -87), P(46.5, -90),
    ],
  },
  {
    id: 'illinois', name: 'Illinois', code: 'IL', people: 12.8, liberal: 0.58, jobless: 0.05, rough: 15, homeValue: 260, income: 78000, merged: ['Illinois'],
    poly: [
      P(42.5, -90.6), P(42.5, -87.8), P(41.7, -87.5), P(38, -88), P(37, -89.1),
      P(36.98, -89.5), P(38.8, -90.2), P(40.4, -91.4), P(42.5, -90.6),
    ],
  },
  {
    id: 'upper-midwest', name: 'Upper Midwest', code: 'UM', people: 11.6, liberal: 0.515, jobless: 0.031, rough: 13, homeValue: 300, income: 78000,
    merged: ['Wisconsin', 'Minnesota'],
    poly: [
      LAKE_OF_WOODS, P(48, -89.5), P(46.8, -92.1), P(46.5, -90), P(45.8, -87),
      P(45.1, -86.3), P(42.5, -87.8), P(42.5, -90.6), P(43.5, -91.2),
      P(43.5, -96.6), P(45.9, -96.5), P(49, -96.8),
    ],
  },
  {
    id: 'heartland', name: 'Heartland', code: 'HL', people: 9.3, liberal: 0.43, jobless: 0.034, rough: 10, homeValue: 220, income: 70000, merged: ['Iowa', 'Missouri'],
    poly: [
      P(43.5, -96.6), P(43.5, -91.2), P(42.5, -90.6), P(40.4, -91.4), P(38.8, -90.2),
      P(36.98, -89.5), P(36, -89.7), P(36, -94.6), P(40, -94.6), P(40, -95.3),
      P(42.5, -96.4),
    ],
  },
  {
    id: 'great-plains', name: 'Great Plains', code: 'GP', people: 6.6, liberal: 0.39, jobless: 0.028, rough: 12, homeValue: 230, income: 71000,
    merged: ['North Dakota', 'South Dakota', 'Nebraska', 'Kansas'],
    poly: [
      P(49, -104), P(49, -96.8), P(45.9, -96.5), P(43.5, -96.6), P(42.5, -96.4),
      P(40, -95.3), P(40, -94.6), P(37, -94.6), P(37, -102), P(41, -102),
      P(41, -104),
    ],
  },
  {
    id: 'south-central', name: 'South Central', code: 'SC', people: 11.6, liberal: 0.37, jobless: 0.038, rough: 9, homeValue: 200, income: 60000,
    merged: ['Arkansas', 'Louisiana', 'Oklahoma'],
    poly: [
      P(37, -103), P(37, -94.6), P(36, -94.6), P(36, -89.7), P(35, -90),
      P(31, -91.5), P(30.2, -89.6), P(29.2, -89.4), P(29.7, -93.8), P(33.9, -94.4),
      P(34.5, -100), P(36.5, -100), P(36.5, -103),
    ],
  },
  {
    id: 'texas', name: 'Texas', code: 'TX', people: 29.1, liberal: 0.47, jobless: 0.041, rough: 9, homeValue: 300, income: 75000, merged: ['Texas'],
    poly: [
      P(36.5, -103), P(36.5, -100), P(34.5, -100), P(33.9, -94.4), P(29.7, -93.8),
      P(29.3, -94.8), P(27.8, -97.4), BROWNSVILLE, P(27.5, -99.5), P(29.2, -102.9),
      EL_PASO, P(31.8, -103),
    ],
  },
  {
    id: 'mountain-west', name: 'Mountain West', code: 'MW', people: 3.5, liberal: 0.35, jobless: 0.033, rough: 14, homeValue: 400, income: 71000,
    merged: ['Montana', 'Idaho', 'Wyoming'],
    poly: [
      P(49, -117), P(49, -104), P(41, -104), P(41, -111), P(42, -111),
      P(42, -117),
    ],
  },
  {
    id: 'southwest', name: 'Southwest', code: 'SW', people: 21.4, liberal: 0.504, jobless: 0.041, rough: 21, homeValue: 440, income: 80000,
    merged: ['Colorado', 'Utah', 'Nevada', 'Arizona', 'New Mexico'],
    poly: [
      P(42, -120), P(42, -111), P(41, -111), P(41, -102), P(37, -102),
      P(37, -103), P(31.8, -103), EL_PASO, YUMA, P(35, -114.6), P(39, -120),
    ],
  },
  {
    id: 'california', name: 'California', code: 'CA', people: 39.5, liberal: 0.65, jobless: 0.053, rough: 46, homeValue: 780, income: 91000, merged: ['California'],
    poly: [
      P(42, -120), P(39, -120), P(35, -114.6), YUMA, P(32.5, -117.1),
      P(33.7, -118.2), P(34.4, -120.5), P(35.4, -120.9), P(37.8, -122.5),
      P(40.4, -124.4), P(42, -124.2),
    ],
  },
  {
    id: 'pacific-northwest', name: 'Pacific Northwest', code: 'PN', people: 14.1, liberal: 0.59, jobless: 0.043, rough: 40, homeValue: 530, income: 88000,
    merged: ['Washington', 'Oregon', 'Alaska', 'Hawaii'],
    poly: [
      P(49, -123), P(49, -117), P(42, -117), P(42, -120), P(42, -124.2),
      P(42.8, -124.6), P(46.3, -124.1), CAPE_FLATTERY,
    ],
  },
];

// --- Water ------------------------------------------------------------------
//
// The terrain generator used to scatter two lakes per seed at whatever inland
// spot the dice liked, which on a real map is a large unexplained lake in the
// middle of Kansas. On an invented continent that reads as landscape; on this
// one it reads as a mistake, because a reader knows where the lakes are.
//
// So there are exactly these, they are where they are, and every one of them has
// a name — which is the test for whether a lake belongs on a map at this scale.

/** An ellipse specified in degrees, so a lake can be checked against an atlas. */
const lakeRing = (lat, lon, dLat, dLon, n = 18, phase = 0) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = phase + (i / n) * Math.PI * 2;
    pts.push(P(lat + Math.sin(t) * dLat, lon + Math.cos(t) * dLon));
  }
  return pts;
};

// --- Alaska and Hawaii --------------------------------------------------------
//
// Drawn where every US map draws them: cropped into a corner, at their own
// scale, out of the ocean nobody is using.
//
// They cannot go where they belong. Alaska is north-west of Canada, which on
// this frame is off the left edge and on the far side of another country;
// Hawaii is two thousand miles out into a Pacific the frame does not reach. A
// map that showed them in place would be mostly empty water, which is exactly
// why the convention exists.
//
// Both are part of the Pacific Northwest region for every purpose the engine
// has — representation, elections, population. The inset is a drawing, not a
// district.

/**
 * Alaska's own little projection.
 *
 * The inset is its own map at its own scale, so it gets its own `P` — and it is
 * written in degrees for exactly the reason the rest of this file is: the old
 * outline was twenty-eight hand-placed integers, which is a shape nobody can
 * check. `AK(71.4, -156.5)` is Point Barrow and can be held against an atlas;
 * `[0, 14]` is a number.
 *
 * SX/SY is 0.47, the longitude correction at 62°N — much stronger than the 0.8
 * the main map uses, because Alaska is far enough north that a degree of
 * longitude is under half a degree of latitude. Drawn without it the state comes
 * out twice as wide as it is tall, which is the single thing most likely to make
 * a reader say it looks wrong without being able to say why.
 */
const AK = (lat, lon) => [
  +(4 + (lon + 170) * 0.56).toFixed(2),
  +((72 - lat) * 1.2).toFixed(2),
];

/**
 * Alaska, clockwise from Point Barrow.
 *
 * The previous outline was a blob with a spur on it. What makes Alaska read as
 * Alaska is five features, and it had none of them: the Seward Peninsula
 * reaching west toward Russia, Norton Sound under it, Bristol Bay biting into
 * the south-west, the Alaska Peninsula trailing away from that bay, and the
 * panhandle running south-east along the Canadian border to Ketchikan. Those are
 * in, in that order, and everything else is coastline joining them up.
 */
export const ALASKA = [
  // The Arctic coast, east from Point Barrow to the Canadian border at 141°W.
  AK(71.4, -156.5), AK(70.4, -149), AK(70.1, -143.6), AK(69.6, -141),
  // Straight down the 141st meridian — the one border Alaska has, and a
  // ruler-straight one, which is a fact about it worth drawing.
  AK(60.3, -141),
  // The panhandle, south-east down the inland border to the tip at Portland Canal.
  AK(59.8, -139.2), AK(59.2, -136.5), AK(58.4, -133.5), AK(56.6, -131.5), AK(55, -130),
  // And back up its ocean side, over the islands.
  AK(54.7, -132), AK(56.3, -134.7), AK(57.8, -136.6), AK(59.5, -139.7), AK(60, -142.5),
  // The Gulf of Alaska coast, running west.
  AK(60.3, -145.8), AK(59.9, -148.5),
  // Cook Inlet: north to Anchorage and back down the Kenai Peninsula. A notch,
  // not a smooth coast — the state's largest city sits at the head of it.
  AK(61.3, -149.9), AK(59.6, -152.4),
  // The Alaska Peninsula, south-west toward the Aleutians.
  AK(58.5, -154.5), AK(57.5, -157.5), AK(56.3, -160), AK(55.2, -162.5),
  // Back up its northern shore into Bristol Bay, round the head of the bay, and
  // out west again to Cape Newenham.
  AK(56.6, -160.8), AK(58.2, -157.6), AK(59, -158.5), AK(58.7, -161.8),
  // The Yukon–Kuskokwim delta, bulging west.
  AK(60.5, -165.3), AK(61.5, -166.2), AK(62.8, -165.5),
  // Norton Sound: in to its head, and out along its northern shore.
  AK(63.5, -160.8), AK(64.5, -161.5), AK(64.9, -164),
  // The Seward Peninsula, reaching for Russia. Cape Prince of Wales is the
  // westernmost point of the mainland United States.
  AK(64.6, -166.5), AK(65.6, -168), AK(66.2, -166.5), AK(66.6, -164),
  // Kotzebue Sound, Point Hope, and the Chukchi coast back to Barrow.
  AK(66.8, -161.5), AK(67.7, -164), AK(68.3, -166), AK(69, -163), AK(70.2, -160.5),
];

/** The Hawaiian chain: eight islands on a north-west to south-east diagonal. */
export const HAWAII = [
  { cx: 2, cy: 2, r: 1.1 }, { cx: 5, cy: 3.4, r: 1.5 }, { cx: 8.2, cy: 5, r: 1.2 },
  { cx: 11, cy: 6.4, r: 1.9 }, { cx: 14, cy: 8.4, r: 1.0 }, { cx: 17.5, cy: 10.6, r: 2.7 },
];

export const LAKES = [
  { name: 'Lake Superior', poly: lakeRing(47.7, -87.5, 1.1, 4.3) },
  { name: 'Lake Michigan', poly: lakeRing(44.0, -87.0, 2.6, 1.1) },
  { name: 'Lake Huron', poly: lakeRing(44.8, -82.4, 1.8, 1.5, 18, 0.6) },
  { name: 'Lake Erie', poly: lakeRing(42.2, -81.2, 0.6, 2.4) },
  { name: 'Lake Ontario', poly: lakeRing(43.7, -77.9, 0.5, 1.6) },
  { name: 'Great Salt Lake', poly: lakeRing(41.2, -112.5, 0.6, 0.5) },
];

/**
 * The postal code of every state that went into the merge.
 *
 * A merged region needs to say what it is made of — "Deep South" is not
 * somewhere anyone says they are from, and "GA · AL · MS" is — and the two-letter
 * code is how an American reads a state at a glance.
 *
 * Note that this is *not* the `abbr` on each region above. That is a label for
 * the map, invented per region, and several of them collide with real codes: the
 * Carolinas' `CA` is California's, New England's `NE` is Nebraska's. Anything
 * shown to a player as a state code comes from here.
 */
const POSTAL = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'D.C.': 'DC', Florida: 'FL',
  Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN',
  Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
  Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY',
};

/** The postal codes a region was merged from, in the order they were listed. */
export const postalOf = (state) => (state?.merged || []).map((n) => POSTAL[n]).filter(Boolean);

/**
 * The code that stands for a *region* — the map label, what a congressional
 * district is numbered from, and what a player reads beside the region's name.
 *
 * Two letters, because that is what a state abbreviation is. There were three
 * once, on the reasoning that a merged region should never collide with one of
 * the real fifty; but the twenty *are* the states here, the fifty are only what
 * they were merged from, and `TX-1` beside `NWE-1` reads as two different kinds
 * of thing. So the rule is uniqueness among the twenty, which the table holds
 * and `tests/atlas.mjs` checks.
 *
 * Where a region is one real state it keeps that state's real code — NY, TX,
 * CA. The merged ones are initials: `CR` the Carolinas, `UP` the Upper South.
 * `postalOf` is what a region is *made of*, which is a list, and a list cannot
 * number a district.
 */
export const codeOf = (state) => state?.code || '';

/**
 * How many people live there, in millions, from the 2020 census — summed over the
 * real states each region was merged from.
 *
 * A real fact about a real place, so it belongs here with the polygons and gets
 * held to the same standard: a reader can check California against 39.5 and the
 * Great Plains against 6.6.
 *
 * It exists because the House is apportioned. Population in the simulation is a
 * consequence of housing, housing is a consequence of parcels, and parcels are a
 * consequence of *land* — so left alone the engine gives the Great Plains more
 * people than California, and a chamber apportioned by population then hands the
 * empty half of the country the seats. Seeding the housing against this instead
 * is what makes "one member per so many people" mean anything.
 */
export const peopleOf = (state) => +state?.people || 0;

/**
 * How the place actually votes: the Liberal share of the two-party presidential
 * vote in 2020, summed over the real states the region was merged from and
 * weighted by their populations.
 *
 * The same kind of fact as `people` and held to the same standard — a reader can
 * check California against 0.65 and Wyoming's corner of the Mountain West
 * against 0.35. Two-party, so it and its complement are the whole of it; the
 * game has exactly two parties and no third to lose the remainder to.
 *
 * It exists because district lean was `pick(world, PARTIES)` — a coin flip per
 * state, every Season, with no geography in it at all. Texas came up Liberal as
 * often as California did, which meant the map taught the player nothing and the
 * bloc a bill had to win was a different bloc every run. Seeding against this
 * instead is what makes "the Deep South" and "New England" mean anything when
 * you are counting votes.
 *
 * Virginia, the Upper Midwest and the Southwest sit within a point of even on
 * purpose. They are the regions that really are that close, and a Season where
 * they can break either way is the correct simulation of them.
 */
export const liberalOf = (state) => {
  const n = +state?.liberal;
  return Number.isFinite(n) ? n : 0.5;
};

/**
 * Three more real facts about a real place, on the same footing as `people` and
 * `liberal` and checkable the same way.
 *
 * - `jobless` — the unemployment rate. Great Plains 2.8%, California 5.3%.
 * - `rough`   — people sleeping rough or in shelter, per ten thousand. This is
 *               the one with the widest spread in the country: New York 52 and
 *               California 46 against Virginia's 8, a factor of six that no
 *               national average shows you.
 * - `homeValue` — the median home, in thousands of dollars.
 * - `income`    — median household income, in dollars.
 *
 * They exist because all three were dice. Unemployment fell out of however many
 * factories the seeder happened to drop, land value was `range(40, 140)` and
 * homelessness was a flat 8% of everybody — so the opening board taught a player
 * nothing about the country and the same state was a crisis in one Season and
 * comfortable in the next. Seeded against these, the first thing you read on the
 * Nation tab is the United States.
 *
 * The engine still moves all three from here. These set where the Season starts,
 * not where it goes.
 */
export const joblessOf = (state) => {
  const n = +state?.jobless;
  return Number.isFinite(n) ? n : 0.04;
};
export const roughOf = (state) => {
  const n = +state?.rough;
  return Number.isFinite(n) ? n : 20;
};
export const homeValueOf = (state) => {
  const n = +state?.homeValue;
  return Number.isFinite(n) ? n : 300;
};

/** Median household income, in dollars. New England 89k against South Central's 60k. */
export const incomeOf = (state) => {
  const n = +state?.income;
  return Number.isFinite(n) ? n : 70000;
};

/** A region by its code, for anything reading a district name back apart. */
export const stateByCode = (code) => STATES.find((s) => s.code === code) || null;

/**
 * How a region is written in a list a player reads: the name, its own code, and
 * what it is made of.
 *
 *   New York (NY) — NY
 *   New England (NE) — ME · NH · VT · MA · RI · CT
 *
 * A region of one real state repeats itself, and that is deliberate: the shape
 * of every row is the same, so the eye can run down the codes in one column
 * instead of learning two layouts.
 */
export const labelOf = (state) =>
  `${state.name} (${codeOf(state)}) \u2014 ${postalOf(state).join(' \u00b7 ')}`;

/**
 * The regions in the order a human looks for them: alphabetical, ignoring a
 * leading "The". "The Carolinas" is filed under C, where somebody hunting for
 * the Carolinas will actually look.
 */
export const sortKey = (state) => state.name.replace(/^The\s+/i, '');
export const STATES_AZ = [...STATES].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

/**
 * The five regions with no salt water and no Great Lake on them.
 *
 * Everything else has a coast, counting the lakes — Ohio Valley has Erie and
 * Michigan, Upper Midwest has Superior. This decides which states get water
 * parcels and therefore which ones open with a working port, so it is a fact
 * about the map and not a decoration.
 */
const LANDLOCKED = new Set(['mountain-west', 'southwest', 'great-plains', 'heartland', 'upper-south']);

/** Does the sea, or a Great Lake, touch this state? Takes a name or an id. */
export const isCoastal = (nameOrId) => {
  const s = STATES.find((x) => x.name === nameOrId || x.id === nameOrId);
  return !!s && !LANDLOCKED.has(s.id);
};

/** The twenty state names, in the order the engine seats them. */
export const STATE_NAMES = STATES.map((s) => s.name);

/** A state by id, for anything holding one. */
export const stateOf = (id) => STATES.find((s) => s.id === id) || null;

// Four corners is a real quadripoint and the only one; every other junction on
// this map is a triple point. It is exported because the districts map draws it
// as a landmark, and because a test asserts the four regions that meet there
// still all touch it after any edit to the polygons above.
export { FOUR_CORNERS };

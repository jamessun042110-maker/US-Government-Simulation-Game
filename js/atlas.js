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
  P(21.5, -97.2), P(19.2, -96.1), P(18.5, -94.5),    // the Gulf coast running south
  P(16.2, -95), P(15.8, -97.5), P(17.5, -101.5),     // the isthmus and the southern bight
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
    mexico: [...mx, ...COAST_MEXICO],
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
    id: 'new-england', name: 'New England', abbr: 'NE',
    merged: ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut'],
    poly: [
      EASTPORT, P(43.7, -70.2), P(41.7, -70), P(41, -71.9), P(41, -73.5),
      P(42.7, -73.3), P(45, -73.3), P(47.4, -69.2),
    ],
  },
  {
    id: 'new-york', name: 'New York', abbr: 'NY', merged: ['New York'],
    poly: [
      P(45, -73.3), P(42.7, -73.3), P(41, -73.5), P(40.6, -74), P(41.4, -74.7),
      P(42, -75.4), P(42, -79.8), P(43.1, -79.1), P(44.1, -76.4),
    ],
  },
  {
    id: 'mid-atlantic', name: 'Mid-Atlantic', abbr: 'MA',
    merged: ['New Jersey', 'Pennsylvania', 'Delaware', 'Maryland', 'D.C.'],
    poly: [
      P(42, -79.8), P(42, -75.4), P(41.4, -74.7), P(40.6, -74), P(38.8, -75),
      P(38, -75.6), P(38, -78.4), P(39.7, -79.5), P(39.7, -80.5), P(41.5, -80.5),
    ],
  },
  {
    id: 'virginia', name: 'Virginia', abbr: 'VA', merged: ['Virginia', 'West Virginia'],
    poly: [
      P(39.7, -80.5), P(39.7, -79.5), P(38, -78.4), P(38, -75.6), P(36.9, -76),
      P(36.5, -75.9), P(36.5, -81.7), P(37.5, -82.3), P(38.4, -82.5), P(40.6, -80.5),
    ],
  },
  {
    id: 'carolinas', name: 'The Carolinas', abbr: 'CA',
    merged: ['North Carolina', 'South Carolina'],
    poly: [
      P(36.5, -81.7), P(36.5, -75.9), P(35.2, -75.5), P(33.9, -78), P(32.8, -79.9),
      P(32.1, -81.1), P(34.8, -83.1), P(35, -84),
    ],
  },
  {
    id: 'florida', name: 'Florida', abbr: 'FL', merged: ['Florida'],
    poly: [
      P(31, -87.6), P(31, -85), P(30.7, -83), P(30.7, -81.5), P(30.3, -81.4),
      P(28.4, -80.6), P(25.8, -80.2), KEY_WEST, P(27.8, -82.6), P(29.7, -85),
      P(30.4, -87.2), P(30.2, -88), P(31, -87.6),
    ],
  },
  {
    id: 'deep-south', name: 'Deep South', abbr: 'DS',
    merged: ['Georgia', 'Alabama', 'Mississippi'],
    poly: [
      P(35, -84), P(34.8, -83.1), P(32.1, -81.1), P(30.7, -81.5), P(30.7, -83),
      P(31, -85), P(31, -87.6), P(30.2, -88), P(30.2, -89.6), P(31, -91.5),
      P(35, -90), P(35, -88.2),
    ],
  },
  {
    id: 'upper-south', name: 'Upper South', abbr: 'US',
    merged: ['Kentucky', 'Tennessee'],
    poly: [
      P(38.4, -82.5), P(37.5, -82.3), P(36.5, -81.7), P(35, -84), P(35, -88.2),
      P(35, -90), P(36.5, -89.7), P(37, -89.1), P(38, -88), P(37.8, -84.8),
      P(38.8, -84.8), P(39, -84.8),
    ],
  },
  {
    id: 'ohio-valley', name: 'Ohio Valley', abbr: 'OV', merged: ['Ohio', 'Indiana'],
    poly: [
      P(41.7, -84.8), P(41.7, -83.5), P(41.5, -80.5), P(40.6, -80.5), P(38.4, -82.5),
      P(39, -84.8), P(38.8, -84.8), P(37.8, -84.8), P(38, -88), P(41.7, -87.5),
      P(41.7, -84.8),
    ],
  },
  {
    id: 'michigan', name: 'Michigan', abbr: 'MI', merged: ['Michigan'],
    poly: [
      P(46.5, -90), P(46.5, -84.3), P(43, -82.4), P(42.1, -83.1), P(41.7, -83.5),
      P(41.7, -84.8), P(41.7, -86.8), P(45.1, -86.3), P(45.8, -87), P(46.5, -90),
    ],
  },
  {
    id: 'illinois', name: 'Illinois', abbr: 'IL', merged: ['Illinois'],
    poly: [
      P(42.5, -90.6), P(42.5, -87.8), P(41.7, -87.5), P(38, -88), P(37, -89.1),
      P(36.98, -89.5), P(38.8, -90.2), P(40.4, -91.4), P(42.5, -90.6),
    ],
  },
  {
    id: 'upper-midwest', name: 'Upper Midwest', abbr: 'UM',
    merged: ['Wisconsin', 'Minnesota'],
    poly: [
      LAKE_OF_WOODS, P(48, -89.5), P(46.8, -92.1), P(46.5, -90), P(45.8, -87),
      P(45.1, -86.3), P(42.5, -87.8), P(42.5, -90.6), P(43.5, -91.2),
      P(43.5, -96.6), P(45.9, -96.5), P(49, -96.8),
    ],
  },
  {
    id: 'heartland', name: 'Heartland', abbr: 'HL', merged: ['Iowa', 'Missouri'],
    poly: [
      P(43.5, -96.6), P(43.5, -91.2), P(42.5, -90.6), P(40.4, -91.4), P(38.8, -90.2),
      P(36.98, -89.5), P(36, -89.7), P(36, -94.6), P(40, -94.6), P(40, -95.3),
      P(42.5, -96.4),
    ],
  },
  {
    id: 'great-plains', name: 'Great Plains', abbr: 'GP',
    merged: ['North Dakota', 'South Dakota', 'Nebraska', 'Kansas'],
    poly: [
      P(49, -104), P(49, -96.8), P(45.9, -96.5), P(43.5, -96.6), P(42.5, -96.4),
      P(40, -95.3), P(40, -94.6), P(37, -94.6), P(37, -102), P(41, -102),
      P(41, -104),
    ],
  },
  {
    id: 'south-central', name: 'South Central', abbr: 'SC',
    merged: ['Arkansas', 'Louisiana', 'Oklahoma'],
    poly: [
      P(37, -103), P(37, -94.6), P(36, -94.6), P(36, -89.7), P(35, -90),
      P(31, -91.5), P(30.2, -89.6), P(29.2, -89.4), P(29.7, -93.8), P(33.9, -94.4),
      P(34.5, -100), P(36.5, -100), P(36.5, -103),
    ],
  },
  {
    id: 'texas', name: 'Texas', abbr: 'TX', merged: ['Texas'],
    poly: [
      P(36.5, -103), P(36.5, -100), P(34.5, -100), P(33.9, -94.4), P(29.7, -93.8),
      P(29.3, -94.8), P(27.8, -97.4), BROWNSVILLE, P(27.5, -99.5), P(29.2, -102.9),
      EL_PASO, P(31.8, -103),
    ],
  },
  {
    id: 'mountain-west', name: 'Mountain West', abbr: 'MW',
    merged: ['Montana', 'Idaho', 'Wyoming'],
    poly: [
      P(49, -117), P(49, -104), P(41, -104), P(41, -111), P(42, -111),
      P(42, -117),
    ],
  },
  {
    id: 'southwest', name: 'Southwest', abbr: 'SW',
    merged: ['Colorado', 'Utah', 'Nevada', 'Arizona', 'New Mexico'],
    poly: [
      P(42, -120), P(42, -111), P(41, -111), P(41, -102), P(37, -102),
      P(37, -103), P(31.8, -103), EL_PASO, YUMA, P(35, -114.6), P(39, -120),
    ],
  },
  {
    id: 'california', name: 'California', abbr: 'CL', merged: ['California'],
    poly: [
      P(42, -120), P(39, -120), P(35, -114.6), YUMA, P(32.5, -117.1),
      P(33.7, -118.2), P(34.4, -120.5), P(35.4, -120.9), P(37.8, -122.5),
      P(40.4, -124.4), P(42, -124.2),
    ],
  },
  {
    id: 'pacific-northwest', name: 'Pacific Northwest', abbr: 'PN',
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

/** Alaska, in its own little coordinate space, drawn around the origin. */
export const ALASKA = [
  [0, 14], [3, 9], [2, 4], [7, 2], [12, 3], [17, 1], [22, 3], [26, 2],
  [30, 5], [28, 9], [31, 12], [27, 15], [24, 13], [20, 17], [15, 16],
  [11, 20], [7, 19], [4, 22], [1, 19],
  // The panhandle, running south-east — the piece that makes it Alaska rather
  // than a blob.
  [30, 19], [33, 23], [31, 25], [27, 22], [24, 21], [18, 22], [12, 24], [6, 25],
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

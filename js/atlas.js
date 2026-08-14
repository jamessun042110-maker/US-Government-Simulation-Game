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

export const US_RING = [
  CAPE_FLATTERY,
  P(46.3, -124.1), P(42.8, -124.6), P(40.4, -124.4),  // Oregon coast, Cape Mendocino
  P(37.8, -122.5), P(35.4, -120.9), P(34.4, -120.5),  // San Francisco, Point Conception
  P(33.7, -118.2), P(32.5, -117.1),                    // Los Angeles, San Diego
  YUMA, EL_PASO,                                       // the Mexican border, west half
  P(29.2, -102.9), P(27.5, -99.5), BROWNSVILLE,        // Big Bend, Laredo, the river mouth
  P(27.8, -97.4), P(29.3, -94.8), P(29.7, -93.8),      // the Texas coast
  P(29.2, -89.4), P(30.2, -88), P(30.4, -87.2),        // the delta, Mobile, Pensacola
  P(29.7, -85), P(27.8, -82.6), KEY_WEST,              // the Florida panhandle and gulf coast
  P(25.8, -80.2), P(28.4, -80.6), P(30.3, -81.4),      // Miami, Canaveral, Jacksonville
  P(32.1, -81.1), P(32.8, -79.9), P(35.2, -75.5),      // Savannah, Charleston, Hatteras
  P(36.9, -76), P(38.8, -75), P(40.6, -74),            // the Chesapeake, Delaware Bay, New York
  P(41.7, -70), P(43.7, -70.2), EASTPORT,              // Cape Cod, Portland, the Maine corner
  P(47.4, -69.2), P(45, -73.3),                        // the Maine panhandle, the 45th parallel
  P(44.1, -76.4), P(43.1, -79.1), P(42.1, -83.1),      // Ontario, Niagara, Detroit
  P(43, -82.4), P(46.5, -84.3), P(46.8, -92.1),        // Huron, the Soo, Superior
  LAKE_OF_WOODS, P(49, -123),                          // the 49th parallel, west to the sound
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

/**
 * Canada: the frontier, then straight out to the sides and off the top.
 *
 * The closure has to leave the border *horizontally* before it goes north. Going
 * straight from the border's western end to the off-frame corner draws a
 * diagonal across the Pacific, and Canada renders as a wedge pointing at Seattle
 * — which is what the first draft of this did.
 */
export const CANADA_RING = [
  [-OUT, BORDER_CA[0][1]],
  ...BORDER_CA,
  [WORLD_W + OUT, BORDER_CA[BORDER_CA.length - 1][1]],
  [WORLD_W + OUT, -OUT], [-OUT, -OUT],
];

/**
 * Mexico: the frontier, down the Gulf coast, round the isthmus and back up the
 * Pacific — a real silhouette rather than a box.
 *
 * Closing this one out to the frame edges instead paints the whole south-western
 * ocean as Mexican territory, and the Baja peninsula is the tell that it is the
 * country and not a fill.
 */
export const MEXICO_RING = [
  ...BORDER_MX,
  P(21.5, -97.2), P(19.2, -96.1), P(18.5, -94.5),    // the Gulf coast running south
  P(16.2, -95), P(15.8, -97.5), P(17.5, -101.5),     // the isthmus and the southern bight
  P(20, -105.5), P(23, -106.5),                       // the Pacific coast north
  P(23, -110), P(28, -114), P(31.3, -117),            // Baja, and up to the border
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

/** The twenty state names, in the order the engine seats them. */
export const STATE_NAMES = STATES.map((s) => s.name);

/** A state by id, for anything holding one. */
export const stateOf = (id) => STATES.find((s) => s.id === id) || null;

// Four corners is a real quadripoint and the only one; every other junction on
// this map is a triple point. It is exported because the districts map draws it
// as a landmark, and because a test asserts the four regions that meet there
// still all touch it after any edit to the polygons above.
export { FOUR_CORNERS };

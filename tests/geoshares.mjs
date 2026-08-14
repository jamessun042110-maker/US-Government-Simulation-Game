// Every seed hands out a whole continent with three countries on it.
//
// This was written against a real bug: the borders used to be fractal lines
// whose baselines were *solved* for target land shares, the solve railed when
// the border wandered further than the control parameter could move it, and
// Canada came out at 0.1% of the map — a sliver that did not even touch us.
//
// The borders are real coordinates now and cannot rail, so that specific bug is
// gone. The line the bug report drew is still worth holding, and it now holds
// something stronger: because the geography is fixed, every seed should give the
// *same* answer, where the fractal version gave a different one to every nation
// name.
const base = new URL('../js/', import.meta.url).href;
const G = await import(base + 'geo.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// Classify a coarse grid once (0 sea, 1 Canada, 2 the United States, 3 Mexico),
// then read shares and adjacency straight off it. One point-in-polygon pass per
// sampled cell instead of five, on a 3-unit grid instead of every pixel — the
// shares are the same to a fraction of a percent and the file stays quick.
function survey(nation, salt) {
  const g = G.geography(nation, salt);
  const step = 3;
  const cols = Math.ceil(G.WORLD_W / step), rows = Math.ceil(G.WORLD_H / step);
  const grid = new Int8Array(cols * rows);
  const c = [0, 0, 0, 0, 0];
  let land = 0;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const p = [col * step + step / 2, r * step + step / 2];
    let code = 0;
    if (G.inPoly(p, g.ring)) {
      // Neighbours first, ours last — the same order geo.js counts shares by,
      // and it has to be the same or this file measures a different country.
      // Ours is the fall-through: a neighbour's claim is positively established
      // by its polygon, and whatever neither of them holds is the United States.
      // Classifying us in the middle instead left every cell the roughened
      // coastline pushed outside the authored outline unassigned, and reported
      // gaps on eight seeds that have no gaps.
      code = G.inPoly(p, g.halves.canada) ? 1
        : G.inPoly(p, g.halves.mexico) ? 3 : 2;
      land++;
    }
    grid[r * cols + col] = code;
    c[code]++;
  }
  // Border cells: a Canada cell with a US cell 4-connected to it.
  let goldSilver = 0;
  for (let r = 1; r < rows - 1; r++) for (let col = 1; col < cols - 1; col++) {
    if (grid[r * cols + col] !== 1) continue;
    if (grid[r * cols + col - 1] === 2 || grid[r * cols + col + 1] === 2
      || grid[(r - 1) * cols + col] === 2 || grid[(r + 1) * cols + col] === 2) goldSilver++;
  }
  // Ours being the fall-through means unassigned land is now impossible by
  // construction, so counting it proves nothing. The failure it used to catch
  // — land belonging to nobody — becomes land belonging to *both* neighbours,
  // which would silently eat the country from both ends at once.
  let overlap = 0;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const p = [col * step + step / 2, r * step + step / 2];
    if (!G.inPoly(p, g.ring)) continue;
    if (G.inPoly(p, g.halves.canada) && G.inPoly(p, g.halves.mexico)) overlap++;
  }
  const pct = (code) => (c[code] / land) * 100;
  return { gold: pct(1), silver: pct(2), mexico: pct(3), overlap, goldSilver };
}

// The founding map the player is handed, and the two redraws they can buy, plus a
// spread of other nation names to stand in for other players' worlds.
const cases = [
  // The founding map and its two redraws.
  ['The United States', 0], ['The United States', 1], ['The United States', 2],
  // Names that used to rail the solver (Canada ate the map, Mexico vanished).
  // They cannot rail now, and that is the point of still running them.
  ['Republic', 0], ['Concordia', 0], ['Canada', 0], ['Silver', 0], ['Freeland', 0],
];

let worstGold = 100, worstBorder = Infinity, anyOverlap = 0, anyMissing = 0;
for (const [n, s] of cases) {
  const r = survey(n, s);
  worstGold = Math.min(worstGold, r.gold);
  worstBorder = Math.min(worstBorder, r.goldSilver);
  if (r.overlap > 0) anyOverlap++;
  if (r.gold < 5 || r.silver < 5 || r.mexico < 5) anyMissing++;
}

ok('the two neighbours never claim the same ground', anyOverlap === 0, `${anyOverlap} seeds with overlap`);
ok('all three nations survive on every seed', anyMissing === 0, `${anyMissing} seeds lost a nation`);
ok('Canada is never a sliver', worstGold >= 20, `worst canada ${worstGold.toFixed(1)}%`);
ok('Canada always borders the United States', worstBorder >= 20, `worst frontier ${worstBorder} cells`);

// The founding map specifically — the one every Season is played on.
const tsr = survey('The United States', 0);
ok('the United States founds with a real Canada on its border', tsr.gold >= 20 && tsr.goldSilver >= 20,
  `canada ${tsr.gold.toFixed(1)}%, border ${tsr.goldSilver} cells`);

// Canada's share is no longer a target that a solver aims at — the 49th parallel
// is where it is, so the share is whatever the real geography gives, which is
// about 63% of the in-frame continent. What is worth asserting is that it is
// stable: it comes off fixed coordinates now, so it should not move at all
// between seeds, where the old fractal borders gave a different answer to every
// nation name.
const spread = cases.map(([n, s]) => survey(n, s).gold);
const drift = Math.max(...spread) - Math.min(...spread);
ok('Canada holds the same share on every seed', drift < 1.5,
  `${Math.min(...spread).toFixed(1)}%–${Math.max(...spread).toFixed(1)}%`);
// Canada holds about half the in-frame continent, which is close to life — it
// is 46% of North America's land against the United States' 45%. It was 63%
// while Canada was drawn as a rectangle across the top of the frame; carving
// Hudson Bay out of it and giving it real coasts took it to where it belongs.
ok('and it is the share the real map gives', spread[0] > 44 && spread[0] < 56,
  `canada ${spread[0].toFixed(1)}%`);

// The map is cut from a single continent by two wandering borders whose
// baselines are *solved* for target land shares. That solve is fragile: it
// bisects a control parameter against the share a border produces, and if the
// border wanders more than the parameter can move it, the solve rails and a whole
// nation vanishes. That is exactly what happened when the border amplitude was
// trebled — Canada came out 0.1% of the map on the founding seed of "The Silver
// Republic" itself, a sliver that no longer bordered Silver.
//
// So this test holds the line the human bug report drew: on every seed the game
// can hand out, all three continental nations exist, none is a sliver, and
// Canada — the northern rival — actually borders Silver.
const base = new URL('../js/', import.meta.url).href;
const G = await import(base + 'geo.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// Classify a coarse grid once (0 sea, 1 gold, 2 silver, 3 mexico, 4 unassigned),
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
      code = G.inPoly(p, g.halves.canada) ? 1
        : G.inPoly(p, g.halves.us) ? 2
          : G.inPoly(p, g.halves.mexico) ? 3 : 4;
      land++;
    }
    grid[r * cols + col] = code;
    c[code]++;
  }
  // Border cells: a Canada cell with a Silver cell 4-connected to it.
  let goldSilver = 0;
  for (let r = 1; r < rows - 1; r++) for (let col = 1; col < cols - 1; col++) {
    if (grid[r * cols + col] !== 1) continue;
    if (grid[r * cols + col - 1] === 2 || grid[r * cols + col + 1] === 2
      || grid[(r - 1) * cols + col] === 2 || grid[(r + 1) * cols + col] === 2) goldSilver++;
  }
  const pct = (code) => (c[code] / land) * 100;
  return { gold: pct(1), silver: pct(2), mexico: pct(3), none: c[4], goldSilver };
}

// The founding map the player is handed, and the two redraws they can buy, plus a
// spread of other nation names to stand in for other players' worlds.
const cases = [
  // The founding map and its two redraws — the exact seeds the bug was against.
  ['The Silver Republic', 0], ['The Silver Republic', 1], ['The Silver Republic', 2],
  // Names that used to rail the solver at the trebled amplitude (Canada ate the
  // map, Mexico vanished), plus a couple of ordinary ones.
  ['Republic', 0], ['Concordia', 0], ['Canada', 0], ['Silver', 0], ['Freeland', 0],
];

let worstGold = 100, worstBorder = Infinity, anyNone = 0, anyMissing = 0;
for (const [n, s] of cases) {
  const r = survey(n, s);
  worstGold = Math.min(worstGold, r.gold);
  worstBorder = Math.min(worstBorder, r.goldSilver);
  if (r.none > 0) anyNone++;
  if (r.gold < 5 || r.silver < 5 || r.mexico < 5) anyMissing++;
}

ok('no unassigned land on any seed', anyNone === 0, `${anyNone} seeds with gaps`);
ok('all three nations survive on every seed', anyMissing === 0, `${anyMissing} seeds lost a nation`);
ok('Canada is never a sliver', worstGold >= 20, `worst canada ${worstGold.toFixed(1)}%`);
ok('Canada always borders Silver', worstBorder >= 20, `worst gold-silver border ${worstBorder} cells`);

// The founding map specifically — the one the bug was reported against.
const tsr = survey('The Silver Republic', 0);
ok('The Silver Republic founds with a real Canada', tsr.gold >= 20 && tsr.goldSilver >= 20,
  `canada ${tsr.gold.toFixed(1)}%, border ${tsr.goldSilver} cells`);

// And the target calibration actually lands on a typical seed (most seeds hit the
// ~44% target; the point of the assertion above is only the worst case).
const typ = survey('Silver', 0);
ok('a typical seed calibrates near the Canada target', typ.gold >= 38 && typ.gold <= 50,
  `canada ${typ.gold.toFixed(1)}%`);

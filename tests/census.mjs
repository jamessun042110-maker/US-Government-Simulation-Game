// The country opens as the real one.
//
// Population, unemployment, homelessness and land prices used to fall out of
// where the seeder happened to drop buildings on a ninety-six-square grid, and a
// state held four or five squares — so California could not be seven times
// Montana because it did not have seven times the ground. Everything downstream
// inherited that: the Great Plains outvoted New York, and a chamber apportioned
// by population handed the empty half of the country the seats.
//
// The four figures are seeded from the atlas now (see world.seedCensus), so they
// can be tested against the real United States, which is the whole point of
// having authored them. These are not "does it run" tests. They are "is this the
// United States" tests, exactly like tests/atlas.mjs.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const AT = await import(base + 'atlas.js');

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? (pass++, console.log(`PASS ${m}${x ? ' | ' + x : ''}`)) : (fail++, console.log(`FAIL ${m}${x ? ' | ' + x : ''}`)); };

const w = W.newWorld({ nation: 'The United States', founder: 'James Sun' });
const D = (name) => w.districts.find((d) => d.name === name);
const total = w.districts.reduce((a, d) => a + d.pop, 0);

// --- the population ----------------------------------------------------------

ok(Math.abs(total - 331e6) / 331e6 < 0.001, 'the country holds the country',
  `${(total / 1e6).toFixed(1)}M`);

{
  // Every state within a per cent of its census share. This is the one that used
  // to be off by a factor of five.
  const off = w.districts.filter((d) => {
    const st = AT.STATES.find((s) => s.name === d.name);
    if (!st) return false;
    const want = 331e6 * (AT.peopleOf(st) / AT.STATES.reduce((a, s) => a + AT.peopleOf(s), 0));
    return Math.abs(d.pop - want) / want > 0.01;
  });
  ok(off.length === 0, 'and every state holds its census share of it',
    off.map((d) => `${d.name} ${(d.pop / 1e6).toFixed(1)}M`).join(', ') || 'all twenty');
  ok(D('California').pop > D('Texas').pop && D('Texas').pop > D('Michigan').pop
    && D('Michigan').pop > D('Mountain West').pop,
    'California over Texas over Michigan over the Mountain West',
    `${(D('California').pop / 1e6).toFixed(1)} > ${(D('Texas').pop / 1e6).toFixed(1)} > `
    + `${(D('Michigan').pop / 1e6).toFixed(1)} > ${(D('Mountain West').pop / 1e6).toFixed(1)}`);
}

// --- what is derived from it -------------------------------------------------

{
  const u = w.economy.unemployment;
  ok(u > 0.03 && u < 0.055, 'national unemployment is a plausible American figure',
    (u * 100).toFixed(1) + '%');
  // Not all one number. The blend with the national rate pulls the states in, so
  // this is a floor on the spread rather than a match to the atlas — but a
  // country whose states are all within a tenth of a point of each other is not
  // a country, it is an average wearing twenty hats.
  const rates = w.districts.map((d) => d.unemployment);
  ok(Math.max(...rates) - Math.min(...rates) > 0.008, 'and the states are not all the same',
    `${(Math.min(...rates) * 100).toFixed(1)}% .. ${(Math.max(...rates) * 100).toFixed(1)}%`);
}

{
  const homeless = w.districts.reduce((a, d) => a + d.homeless, 0);
  ok(homeless > 4e5 && homeless < 9e5, 'and about two thirds of a million people sleep rough',
    Math.round(homeless).toLocaleString());
  // The widest real spread in the country, and the flat 8%-of-everybody the old
  // seeder used hid all of it. California and New York carry a quarter of the
  // nation's homeless between them on a seventh of its people.
  ok(D('California').homeless > D('Virginia').homeless * 8,
    'and California carries many times Virginia’s share of them',
    `${D('California').homeless.toLocaleString()} vs ${D('Virginia').homeless.toLocaleString()}`);
}

{
  ok(D('California').landValue > D('Heartland').landValue * 2,
    'a home in California costs multiples of one in the Heartland',
    `$${D('California').landValue}k vs $${D('Heartland').landValue}k`);
  // recomputeEconomy re-derives a district's land value as the mean of its
  // parcels', so the parcels have to have been priced off their own state. They
  // were priced off districts[0] for the whole country once, which quietly
  // replaced every state's figure with New England's on the first tick.
  //
  // Measured across all twenty at once, as a rank correlation, and not as a
  // per-state tolerance — because a per-state tolerance is a claim about a
  // *tendency* tested on a single sample, and it failed about one Season in five.
  // Two real effects put the noise there: a parcel is jittered across 0.7–1.35 of
  // its state's median and a state holds only four or five parcels, so the mean
  // of them carries about ten per cent of sampling error on its own; and
  // carveWater adds eight per cent to any state with a coast. Neither is a bug.
  //
  // What is actually being claimed is that the country is priced in the right
  // *order* — California dear, the Heartland cheap — and that survives the noise,
  // where "is Florida within a third of 390" does not. The failure this catches
  // is every state priced off districts[0], which drops the correlation to zero.
  const pairs = w.districts
    .map((d) => ({ d, st: AT.STATES.find((s) => s.name === d.name) }))
    .filter((x) => x.st);
  const rank = (list, key) => {
    const sorted = [...list].sort((a, b) => key(a) - key(b));
    return new Map(sorted.map((x, i) => [x.d.id, i]));
  };
  const rA = rank(pairs, (x) => AT.homeValueOf(x.st));
  const rB = rank(pairs, (x) => x.d.landValue);
  const n = pairs.length;
  const dsq = pairs.reduce((a, x) => a + (rA.get(x.d.id) - rB.get(x.d.id)) ** 2, 0);
  const rho = 1 - (6 * dsq) / (n * (n * n - 1));
  ok(rho > 0.85, 'and the twenty are priced in the country’s own order', `rho ${rho.toFixed(3)}`);
}

// --- and what the country is for ---------------------------------------------

{
  // Apportionment is the reason the census had to be real: the House is divided
  // by population, so a population that argues with the map hands out the wrong
  // seats. Now that it does not, this is stable enough to assert.
  const seats = {};
  for (const s of w.seats.filter((x) => x.office === 'assembly')) {
    const d = w.districts.find((x) => x.id === s.district);
    seats[d.name] = (seats[d.name] || 0) + 1;
  }
  ok(Object.values(seats).reduce((a, b) => a + b, 0) === 45, 'the House still deals forty-five seats');
  ok(seats.California >= seats.Texas && seats.Texas > seats['Mountain West'],
    'and deals them in the census’s order',
    `CA ${seats.California}, TX ${seats.Texas}, MW ${seats['Mountain West']}`);
  ok(Object.values(seats).every((n) => n >= 1), 'and no state is left without a member');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

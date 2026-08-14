// A hire is one person off the unemployment count. Nationally, and where they live.
//
// The national half has been true since the payroll was wired into
// recomputeEconomy, and it is pinned here because it is the load-bearing claim
// of company.js — that the private sector is inside the country's numbers
// rather than beside them — and nothing was holding it.
//
// The district half was not true. The national jobs total counted company
// staff; the *local* term counted only buildings on the map. So forty people
// hired in Kiln Hill moved the national figure by forty and moved Kiln Hill by
// the 60% national share every district got equally — the one district where
// those forty actually work saw almost none of it.
//
// Measured by cloning the world at the branch point rather than by building two
// worlds: hiring draws on `rng`, so two separately-constructed republics have
// diverged into different countries by the first tick and the comparison is
// worthless. Same seed, same map, one clone hires.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function founded() {
  const w = W.newWorld({ nation: 'Testland', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  const pid = w.players.p1.personaId;
  for (const s of w.seats) if (s.personaId === pid) s.personaId = null;
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  CO.foundedBy(w, pid).cash = 200e6;
  W.recomputeEconomy(w);
  return { w, pid };
}

const HIRES = 20;

// --- nationally, one for one ------------------------------------------------------
{
  const { w, pid } = founded();
  const labour = W.totalPop(w) * 0.48;
  const before = w.economy.structural;
  for (let i = 0; i < HIRES; i += 1) ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
  W.recomputeEconomy(w);
  const moved = (before - w.economy.structural) * labour;

  ok('the hires actually landed', CO.foundedBy(w, pid).employees.length === HIRES,
    String(CO.foundedBy(w, pid).employees.length));
  ok('and the payroll is counted as private jobs', w.economy.privateJobs === HIRES,
    String(w.economy.privateJobs));
  ok('each hire is exactly one person off the national count',
    Math.abs(moved - HIRES) < 0.001, `${moved.toFixed(3)} people for ${HIRES} hires`);
}

// --- and in the district the company is actually in ----------------------------------
// Deliberately a district with headroom. The local term is `1 - jobs/labour`
// clamped to 0.01, and the founding map gives Old Quarter and Northgate more
// jobs than workers — they sit on the floor, and twenty more jobs cannot move a
// number that is already as low as it goes. That is the model working (people
// commute), not a failure, but it makes those two districts useless for
// measuring this.
{
  const { w, pid } = founded();
  const co = CO.foundedBy(w, pid);
  // The district with the most room to move, not simply the first one.
  //
  // The local term is `1 - jobs/labour` clamped at 0.01, so a district already
  // holding more jobs than workers sits on that floor and twenty more hires
  // cannot shift a number that is as low as it goes. This used to take
  // districts[0] and give it three times the population, hoping that cleared the
  // floor — which worked while seven districts split the country and stopped
  // working at twenty, where each state holds a third as many people.
  //
  // Scaling the population is the wrong knob in both directions: too little and
  // the district stays pinned on the floor, too much and twenty hires vanish
  // into a labour force large enough to swallow them, which is how `pop * 9` and
  // an absolute 10,000 both failed.
  //
  // And `local` is clamped at *both* ends — 0.01 and 0.7 — so simply taking the
  // district with the most unemployment picks one pinned against the ceiling,
  // where twenty hires move it exactly as little as they do on the floor. What
  // is wanted is a district in the middle of the range, which needs no
  // calibration and survives the map being redrawn.
  const localOf = (d) => (d.structural - w.economy.structural * 0.6) / 0.4;
  const home = w.districts.slice()
    .sort((a, b) => Math.abs(localOf(a) - 0.35) - Math.abs(localOf(b) - 0.35))[0];
  co.district = home.id;
  W.recomputeEconomy(w);
  const beforeHome = home.structural;
  const others = w.districts.filter((d) => d.id !== home.id).map((d) => [d.id, d.structural]);

  for (let i = 0; i < HIRES; i += 1) ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
  W.recomputeEconomy(w);

  const homeDrop = beforeHome - home.structural;
  const otherDrop = others.map(([id, s]) => s - w.districts.find((d) => d.id === id).structural);
  const avgOther = otherDrop.reduce((a, b) => a + b, 0) / Math.max(1, otherDrop.length);

  ok('the company\'s own district gains more than the rest',
    homeDrop > avgOther * 1.5, `home ${(homeDrop * 100).toFixed(4)}pp vs others ${(avgOther * 100).toFixed(4)}pp`);
  ok('and the other districts still gain something, because people commute',
    avgOther > 0, `${(avgOther * 100).toFixed(4)}pp`);
}

// --- what is deliberately NOT asserted here --------------------------------------------
//
// That the *headline* rate moves by one person per hire. It does not, and it
// should not: `e.unemployment` converges on `structural + slump − relief +
// cyclical` (see sim.tickOpinion), so a hire moves the floor it is heading for
// while Okun's term and a slump move it somewhere else at the same time. The
// count of jobs against workers is the claim this file is about, and that is
// the structural rate, which is exact above.
//
// Two ways of trying to assert it failed before this note was written, and both
// failed by measuring noise. A clone of the world taken before hiring is not a
// control — hiring draws on `rng`, so the two worlds run different random
// streams from the first hire and by two hundred ticks have had different
// crises and different elections; that read +20 people one run and −18 the
// next. And the gap between the headline and the structural rate does not close
// either, because the cycle holds it open on purpose.

// --- and letting them go puts them back ------------------------------------------------
{
  const { w, pid } = founded();
  const labour = W.totalPop(w) * 0.48;
  for (let i = 0; i < HIRES; i += 1) ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
  W.recomputeEconomy(w);
  const employed = w.economy.structural;
  const co = CO.foundedBy(w, pid);
  const half = co.employees.slice(0, 10);
  for (const id of half) ACT.apply(w, { type: 'COMPANY_FIRE', playerId: 'p1', personaId: id });
  W.recomputeEconomy(w);
  ok('letting ten go puts exactly ten back out of work',
    Math.abs((w.economy.structural - employed) * labour - 10) < 0.001,
    `${((w.economy.structural - employed) * labour).toFixed(3)}`);
}

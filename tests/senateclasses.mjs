// The Senate turns over in thirds.
//
// It used to go to the country whole: twenty seats stamped with the same term
// at the founding, one election every sixth year, and nothing in between. That
// is not a senate — it is a second house of representatives on a longer clock,
// and the whole argument for having an upper chamber is that it outlasts the
// wave that elected the lower one.
//
// The seats are dealt into three classes at ratification and the first terms
// are cut to a third, two thirds and the whole of a term, exactly as the real
// Senate was started in 1789. After the first count everybody serves the full
// six and the classes stay two years apart for the life of the Season.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

/** A ratified republic with nobody at the table, so no ballot waits on a human. */
function republic() {
  const w = W.newWorld({ nation: 'The United States', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  // And no age in the way. Every claim in this file is about the Senate's
  // classes, but `SEAT_SELF` asks `eligibleByAge` before it seats anybody, and
  // `makePersona` rolls from 34 against a presidency that asks 35. About one
  // founder in thirty-four was therefore refused the chair — and a founder who
  // holds no chair fails `readyGate`, so `READY` was a silent no-op, the world
  // never left `convention`, and `beginSeason` never ran. The first terms are
  // cut there, so all twenty senators kept the full six years they were minted
  // with and the file read 6.0 / 6.0 / 6.0. Measured at 13 in 300.
  //
  // Same trap as candidacy.mjs, termlimit.mjs and emptyballot.mjs, and the same
  // fix: put the age out of the way so the assertions can only be answering the
  // question they ask. See the handoff, "Ages, water, cloakrooms".
  const founder = w.personas[w.players.p1.personaId];
  founder.age = Math.max(founder.age ?? 0, R.minAgeFor(w, 'president') + 5);
  ACT.apply(w, { type: 'SEAT_SELF', playerId: 'p1', seatId: w.seats.find((s) => s.office === 'president').id });
  ACT.apply(w, { type: 'READY', playerId: 'p1', ready: true });
  // The setup either produced a live republic or it produced nothing worth
  // measuring. Assert it here rather than letting a convention that never
  // adjourned come back as a mystifying reading further down: every number in
  // this file is stamped by `beginSeason`, so if it did not run, the failures
  // are all downstream of one cause and none of them name it.
  if (w.phase !== 'live') throw new Error(`setup: the republic did not ratify (phase=${w.phase})`);
  // The clock is held at the first tick until the oath is taken, and canon time
  // stops while any ballot waits on a player. Neither is what this file is about.
  w.inaugurated = 1;
  w.players = {};
  for (const p of Object.values(w.personas)) { p.synthetic = true; p.everPlayer = false; p.playerId = null; }
  return w;
}

const senate = (w) => w.seats.filter((s) => s.office === 'senate');
const yearOf = (w, tick) => tick / w.clock.ticksPerYear;

// --- the classes exist, and they are the size they should be ------------------
{
  const w = republic();
  const sen = senate(w);
  const groups = {};
  for (const s of sen) (groups[s.cohort] ??= []).push(s);
  const sizes = Object.keys(groups).sort().map((k) => groups[k].length);

  ok('the Senate is dealt into three classes', Object.keys(groups).length === 3, sizes.join('/'));
  ok('and they are as near equal as twenty divides into three',
    Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join('/'));
  ok('every senator is in exactly one of them',
    sen.every((s) => s.cohort === 0 || s.cohort === 1 || s.cohort === 2) && sen.length === 20);

  // The House is not staggered, and neither is anything else. A class on an
  // office that polls whole would put two thirds of it beyond the reach of an
  // election for ever.
  ok('the House is not staggered', w.seats.filter((s) => s.office === 'assembly').every((s) => s.cohort == null));
  ok('nor is the presidency', w.seats.filter((s) => s.office === 'president').every((s) => s.cohort == null));
}

// --- the first terms are cut, and only the first ------------------------------
{
  const w = republic();
  const ends = {};
  for (const s of senate(w)) ends[s.cohort] = yearOf(w, s.termEnds - 1);
  ok('class 1 sits two years, class 2 four, class 3 six',
    Math.abs(ends[0] - 2) < 0.05 && Math.abs(ends[1] - 4) < 0.05 && Math.abs(ends[2] - 6) < 0.05,
    `${ends[0].toFixed(1)} / ${ends[1].toFixed(1)} / ${ends[2].toFixed(1)}`);
  ok('and every senator in a class expires with the rest of it',
    [0, 1, 2].every((k) => {
      const mine = senate(w).filter((s) => s.cohort === k);
      return mine.every((s) => s.termEnds === mine[0].termEnds);
    }));
  // A state with more than one chair would want them in different classes. We
  // have exactly one per state, so the weaker claim is the true one: no class
  // is a solid bloc of neighbouring states.
  ok('the classes are dealt round-robin, not in blocks',
    senate(w).slice(0, 6).map((s) => s.cohort).join('') === '012012');
}

// --- one class at a time goes to the country ---------------------------------
{
  const w = republic();
  const ballots = [];
  let seen = 0;
  for (let i = 0; i < w.clock.ticksPerYear * 8; i++) {
    S.tick(w);
    for (const e of w.elections.slice(seen)) {
      if (e.office === 'senate') {
        ballots.push({ year: yearOf(w, w.clock.tick), cohort: e.cohort, seats: R.seatsUpIn(w, e).length });
      }
    }
    seen = w.elections.length;
  }

  ok('three Senate ballots run in eight years, not one', ballots.length === 3,
    ballots.map((b) => `${b.year.toFixed(1)}y c${b.cohort + 1}`).join(', '));
  ok('and they are the three classes in order',
    ballots.map((b) => b.cohort).join('') === '012');
  ok('each one carries only its own class',
    ballots.every((b) => b.seats > 0 && b.seats < 20), ballots.map((b) => b.seats).join('/'));
  ok('they fall two years apart',
    Math.abs((ballots[1].year - ballots[0].year) - 2) < 0.2
    && Math.abs((ballots[2].year - ballots[1].year) - 2) < 0.2,
    ballots.map((b) => b.year.toFixed(1)).join(' → '));

  // The point of the whole exercise: after two of the three have voted, most of
  // the chamber has still never been to the country under this government.
  const ends = senate(w).map((s) => yearOf(w, s.termEnds));
  ok('and afterwards the classes still expire two years apart, on full terms',
    new Set(ends.map((e) => e.toFixed(1))).size === 3,
    [...new Set(ends.map((e) => e.toFixed(1)))].sort().join(' '));
}

// --- an election is keyed on the class, not the office ------------------------
{
  const w = republic();
  const acts = await import(base + 'acts.js');
  const first = acts.scheduleElection(w, 'senate', 60, 0);
  ok('a ballot can be called for one class', first.ok === true);
  const again = acts.scheduleElection(w, 'senate', 60, 0);
  ok('and not twice for the same class', again.ok === false, again.reason);
  const other = acts.scheduleElection(w, 'senate', 60, 1);
  ok('but another class may poll at the same time', other.ok === true);
  ok('and the two ballots are for different chairs',
    R.seatsUpIn(w, first.value).every((s) => !R.seatsUpIn(w, other.value).some((x) => x.id === s.id)));
}

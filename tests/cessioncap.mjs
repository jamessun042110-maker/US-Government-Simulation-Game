// A country has one hundred per cent of itself, and no more.
//
// Found by playing: arm under an emergency, declare on the weakest neighbour,
// win, dictate the maximum cession, wait out the armistice, repeat. Fifteen
// rounds against Mexico took 450% of its territory. Because the value of a
// cession was booked per point *asked for* rather than against anything that
// existed, each one paid 30 × CESSION_VALUE into the treasury and lifted every
// district's mood by four — and the enemy's strength floors at 1, so every war
// after the fourth was free. Treasury ran 116M → 457M and approval sat at 68
// while it happened. A money printer with a flag on it.
//
// acts.territoryLeft is the cap, and it is applied inside applyPeaceTerms so a
// negotiated treaty is bound by it as well as a dictated peace.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const A = await import(base + 'acts.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function republic() {
  const w = W.newWorld({ nation: 'The Farm' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Farmer' });
  const head = R.headOffice(w);
  const seat = w.seats.find((x) => x.office === head.id);
  seat.personaId = w.players.p1.personaId; seat.since = 0;
  w.phase = 'live'; w.inaugurated = 0;
  return { w, pid: seat.personaId };
}

// ---------------------------------------------------------------------------
// The cap itself
// ---------------------------------------------------------------------------

{
  const { w } = republic();
  const f = w.foreign[0];
  ok('a power starts with all of its own territory', A.territoryLeft(w, f) === 100,
    `${A.territoryLeft(w, f)}%`);

  A.applyPeaceTerms(w, f, { cede: 30 });
  ok('a cession takes what it says', w.annexed[f.id] === 30, `${w.annexed[f.id]}%`);
  ok('and the power has that much less left', A.territoryLeft(w, f) === 70);

  A.applyPeaceTerms(w, f, { cede: 30 });
  A.applyPeaceTerms(w, f, { cede: 30 });
  ok('three cessions take ninety per cent', w.annexed[f.id] === 90, `${w.annexed[f.id]}%`);

  // The fourth asks for thirty and can only have ten.
  A.applyPeaceTerms(w, f, { cede: 30 });
  ok('the fourth takes only what is left', w.annexed[f.id] === 100, `${w.annexed[f.id]}%`);
  ok('and nothing remains', A.territoryLeft(w, f) === 0);

  // The fifth takes nothing at all, and pays nothing for it.
  const before = w.economy.treasury;
  const strength = f.strength;
  A.applyPeaceTerms(w, f, { cede: 30 });
  ok('a cession from a power with nothing left moves no land', w.annexed[f.id] === 100);
  ok('and books no money', w.economy.treasury === before, `${before} → ${w.economy.treasury}`);
  ok('and takes no more of its army', f.strength === strength);
}

// ---------------------------------------------------------------------------
// Land given back goes back on the table
// ---------------------------------------------------------------------------

{
  const { w } = republic();
  const f = w.foreign[0];
  A.applyPeaceTerms(w, f, { cede: 30 });
  A.applyPeaceTerms(w, f, { cede: -10 });     // a lost peace, handing some back
  ok('giving territory back reduces what we hold', w.annexed[f.id] === 20, `${w.annexed[f.id]}%`);
  ok('and puts it back on the table', A.territoryLeft(w, f) === 80);
}

// ---------------------------------------------------------------------------
// And the dictated peace says so rather than booking a cession of nothing
// ---------------------------------------------------------------------------

{
  const { w, pid } = republic();
  const f = w.foreign[0];
  w.annexed = { [f.id]: 100 };
  w.dictate = [{ foreignId: f.id, since: w.clock.tick, until: w.clock.tick + 40 }];

  const refused = A.dictateTerms(w, pid, f.id, { cede: 30, indemnity: 0 });
  ok('dictating land from a power that has none is refused', !refused.ok, refused.reason || '');
  ok('and the refusal says why', /nothing left/i.test(refused.reason || ''), refused.reason || '');
  ok('and the window stays open for terms that can be met',
    (w.dictate || []).some((d) => d.foreignId === f.id));

  // And an indemnity is no way round it either. What a beaten power can be made
  // to pay is priced off what it still holds — the same money a cession is
  // priced in — so a country the republic has taken entirely has nothing left
  // to hand over in either currency. Which is the point: the farm stops paying.
  const paid = A.dictateTerms(w, pid, f.id, { cede: 30, indemnity: 5e6 });
  ok('and an indemnity is no way round it', !paid.ok, paid.reason || 'it went through');
  ok('and no territory moved', (w.annexed[f.id] || 0) === 100, `${w.annexed[f.id]}%`);
  ok('a fully annexed power can be made to pay nothing', A.indemnityCap(w, f) === 0,
    `cap $${A.indemnityCap(w, f)}`);
}

// ---------------------------------------------------------------------------
// An indemnity is capped by what is left to pay it
// ---------------------------------------------------------------------------

{
  const { w, pid } = republic();
  const f = w.foreign[0];
  const whole = A.indemnityCap(w, f);
  ok('an untouched power can be made to pay what it is worth', whole > 0, `$${(whole / 1e6).toFixed(0)}M`);

  // There was no ceiling at all, and no check that the figure was a number:
  // Infinity made the treasury Infinity for the rest of the Season, and 1e12
  // simply paid out a trillion from a country valued at a hundred and twenty
  // million.
  w.dictate = [{ foreignId: f.id, since: w.clock.tick, until: w.clock.tick + 40 }];
  const before = w.economy.treasury;
  A.dictateTerms(w, pid, f.id, { cede: 0, indemnity: 1e12 });
  ok('and no more, however large a number is named',
    w.economy.treasury - before <= whole, `$${((w.economy.treasury - before) / 1e6).toFixed(0)}M of $${(whole / 1e6).toFixed(0)}M`);
  ok('and the treasury is still a number', Number.isFinite(w.economy.treasury), String(w.economy.treasury));

  // Half the country gone, half the indemnity.
  w.annexed = { [f.id]: 50 };
  ok('a power stripped of half its ground can pay half as much',
    A.indemnityCap(w, f) === Math.round(whole / 2), `$${(A.indemnityCap(w, f) / 1e6).toFixed(0)}M`);
}

// ---------------------------------------------------------------------------
// Fifteen wars against one neighbour, which is how this was found
// ---------------------------------------------------------------------------

{
  const { w, pid } = republic();
  const f = w.foreign.find((x) => x.id === 'mexico') || w.foreign[0];
  for (let i = 0; i < 15; i++) {
    w.dictate = [{ foreignId: f.id, since: w.clock.tick, until: w.clock.tick + 40 }];
    A.dictateTerms(w, pid, f.id, { cede: 30, indemnity: 0 });
  }
  const held = w.annexed[f.id] || 0;
  ok('fifteen dictated cessions cannot take more than the whole country',
    held === 100, `took ${held}%`);
  ok('and its army is not ground below a single division', f.strength >= 1, `${f.strength}`);
}

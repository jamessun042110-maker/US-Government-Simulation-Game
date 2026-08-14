// Round three: the two halves of a peace, and the spine of the world.
//
// Found by driving the map solver to its ends — a power annexed out of
// existence, a republic that has ceded everything, shares at ±1000% and NaN —
// and by firing malformed actions at the founding convention, which every
// earlier hunt skipped by forcing `phase = 'live'`.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const GEO = await import(base + 'geo.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => { const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' }); w.phase = 'live'; return w; };

// --- 1. The republic could cede more land than it owned ---------------------
//
// `applyPeaceTerms` clamped what could be taken *from* a foreign power against
// `territoryLeft`, under a comment reading "nobody cedes what they no longer
// hold". The other direction had no floor at all. Two lost wars against each of
// three neighbours — six lost wars, well inside a Season, and the handoff notes
// wars are lost more often than won — and the republic had signed away 180% of
// itself, paying the treasury price of every acre each time.
{
  const w = mk();
  for (let round = 0; round < 6; round++) {
    for (const f of w.foreign) A.applyPeaceTerms(w, f, { cede: -100 });
  }
  const given = Object.values(w.annexed || {}).reduce((n, p) => n + Math.max(0, -p), 0);
  ok('a republic cannot give away more than it has', given <= 100, `${given}% ceded`);
  ok('and what is left is never negative', A.ourTerritoryLeft(w) >= 0, String(A.ourTerritoryLeft(w)));
  ok('the shares stay inside the country',
    Object.values(w.annexed || {}).every((p) => p >= -100 && p <= 100), JSON.stringify(w.annexed));

  // Taking still works, and still absorbs a power that has nothing left.
  const w2 = mk();
  for (let i = 0; i < 8; i++) A.applyPeaceTerms(w2, w2.foreign[0], { cede: 100, cap: 100 });
  ok('taking is still bounded by what they hold', (w2.annexed || {})[w2.foreign[0].id] === 100);
  ok('and a power with nothing left ceases to exist', !!w2.foreign[0].absorbed);

  // A republic on its last acre is still a republic that can be played.
  let threw = null;
  try { for (let i = 0; i < 400; i++) S.tick(w); } catch (err) { threw = err; }
  ok('and a republic that has ceded everything still runs', threw === null, threw?.message || '');
  ok('and still has a map', (() => { try { return !!GEO.mapOf(w); } catch { return false; } })());
}

// --- 2. ourTerritoryLeft, on its own -----------------------------------------
{
  const w = mk();
  ok('a founding republic holds all of itself', A.ourTerritoryLeft(w) === 100, String(A.ourTerritoryLeft(w)));
  w.annexed = { canada: -30, sab: -20 };
  ok('and half of it after giving half away', A.ourTerritoryLeft(w) === 50, String(A.ourTerritoryLeft(w)));
  w.annexed = { canada: 40, sab: -20 };
  ok('land taken from others does not count as land of ours given away',
    A.ourTerritoryLeft(w) === 80, String(A.ourTerritoryLeft(w)));
  w.annexed = {};
  ok('and an empty ledger is a whole country', A.ourTerritoryLeft(w) === 100);
}

// --- 3. The constitution is the spine, and anything could be written on it ---
//
// SET_CONSTITUTION assigned whatever arrived and *then* read it, so a malformed
// action — and actions arrive from other tabs over the transport, not from a
// button — left world.constitution as null or a string, wiped world.seats, and
// made every later rules.offices() call throw. The wreck ticked on and
// serialised to storage quite happily, so it was republished to every tab.
{
  const HOSTILE = [null, undefined, {}, 'a string', 42, [], { offices: null },
    { offices: 'nope' }, { offices: [] }, { offices: [{}] }, { template: 'nonsense' }];
  for (const c of HOSTILE) {
    const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
    ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
    const seatsBefore = w.seats.length;
    let threw = null;
    try { ACT.apply(w, { type: 'SET_CONSTITUTION', playerId: 'p1', constitution: c }); }
    catch (err) { threw = err; }
    const label = String(JSON.stringify(c)).slice(0, 20);
    ok(`a constitution of ${label} is refused`,
      threw === null && Array.isArray(w.constitution?.offices) && w.constitution.offices.length > 0,
      threw ? `THREW ${threw.message}` : `constitution is ${JSON.stringify(w.constitution).slice(0, 40)}`);
    ok(`  and ${label} leaves the chairs standing`, w.seats.length === seatsBefore,
      `${w.seats.length} vs ${seatsBefore}`);
    ok(`  and ${label} leaves the offices readable`,
      (() => { try { return R.offices(w).length > 0; } catch { return false; } })());
  }
}

// --- 4. And a real constitution still founds a republic ---------------------
{
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  for (const t of R.TEMPLATES) {
    ACT.apply(w, { type: 'SET_CONSTITUTION', playerId: 'p1', constitution: t.build('Silver') });
    ok(`the convention can adopt ${t.id}`, w.constitution.template === t.id, w.constitution.template);
    ok(`  and ${t.id} lays out its chairs`, w.seats.length > 0, `${w.seats.length} seats`);
    ok(`  and every chair belongs to an office it has`,
      w.seats.every((s) => R.office(w, s.office)),
      w.seats.filter((s) => !R.office(w, s.office)).map((s) => s.office).join(', '));
  }
}

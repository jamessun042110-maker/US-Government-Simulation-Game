// The two armies are counted on the same scale.
//
// Found by simulation, not by reading: thirty years of a Season nobody was
// playing, against a neighbour at maximum hostility, produced seventeen wars
// and seventeen defeats. Traced tick by tick, the republic went from six
// divisions to none in two hundred and fifty ticks while Canada went from 148
// strength to 145 — because attrition subtracted 0.018 from a number in the
// hundreds and 0.012 from a number in single figures. Two quantities on two
// scales, bled at the same rate.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const DEP = await import(base + 'depts.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  w.phase = 'live';
  // Nobody in the chair: a synthetic president puts reinforcements to the
  // chamber, and divisions arriving mid-test would hide the ones being lost.
  for (const s of w.seats) s.personaId = null;
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true; f.hostility = 0;
  f.baseStrength = f.strength = 300;
  w.military.units = 10;
  w.military.wars.push({ id: 'w', foreign: f.id, started: 0, front: 0, exhaustion: 0, allies: [] });
  return { w, f };
};

// --- Bled at the same rate ---------------------------------------------------
{
  const { w, f } = mk();
  const startUnits = w.military.units, startStrength = f.strength;
  for (let i = 0; i < 300; i++) { S.tick(w); w.military.wars[0].front = 0; }
  const oursLost = startUnits - w.military.units;
  const theirsLost = (startStrength - f.strength) / DEP.STRENGTH_PER_DIVISION;
  ok('a stalemate costs us divisions', oursLost >= 3, `${oursLost} divisions`);
  ok('and costs them at least as many', theirsLost >= oursLost - 0.01,
    `us ${oursLost}, them ${theirsLost.toFixed(1)}`);
  // The whole bug in one assertion: their loss must be within half of ours, not
  // a thirtieth of it.
  ok('within the same order of magnitude, which it was not',
    theirsLost < oursLost * 2.5 && theirsLost > oursLost * 0.8,
    `ratio ${(theirsLost / Math.max(0.01, oursLost)).toFixed(2)}`);
}

// --- What an army is worth is what the front is decided on -------------------
{
  const { w, f } = mk();
  f.hostility = 100;
  ok('a hostile power fights harder than its headcount',
    DEP.enemyWeight(f) > DEP.enemyDivisions(f),
    `${DEP.enemyDivisions(f)} divisions, fighting like ${DEP.enemyWeight(f).toFixed(1)}`);
  f.hostility = 0;
  ok('and one with no quarrel fights like what it is',
    Math.abs(DEP.enemyWeight(f) - DEP.enemyDivisions(f)) < 0.01);
  ok('one division is thirty of their strength', DEP.STRENGTH_PER_DIVISION === 30);
}

// --- Arming has a ceiling a republic can reach -------------------------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  w.phase = 'live';
  const f = w.foreign.find((x) => x.id === 'canada');
  const base0 = f.strength;
  f.hostility = 100;
  f.baseStrength = base0;
  f.strength = base0 * 5;      // as if it had armed without limit
  S.tick(w);
  ok('a rearming neighbour has a ceiling', f.strength <= base0 * S.ARMING_CEILING + 0.1,
    `${Math.round(base0)} → ${Math.round(f.strength)} (ceiling ${S.ARMING_CEILING})`);
  // Eleven divisions is a hard ask and a possible one; thirteen was neither.
  ok('and what it stops at can be answered', DEP.enemyWeight(f) <= 11.5,
    `fights like ${DEP.enemyWeight(f).toFixed(1)}`);
}

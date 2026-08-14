// An army on a frontier is a threat, and the country it is pointed at can see it.
//
// Divisions on a border used to be a private arrangement: they set the multiplier
// a war would be fought at — see depts.effectiveness — and cost nothing else. So
// the dominant line was to mass everything on the angriest neighbour at the
// founding and never touch it again, which is not what an army on a frontier is.
//
// Two effects, deliberately different in kind. Moving up is an event and lands
// once; leaving them there is a condition and lands every tick. Pulling back
// stops the second and buys back none of the first — talking a neighbour down is
// the envoy's job, and a deployment that could be walked back for free would be
// a toggle rather than a decision.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function fresh() {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  w.military.units = 10;
  return { w, pid };
}

// --- moving up is noticed at once -----------------------------------------------
{
  const { w, pid } = fresh();
  const f = w.foreign[0];
  const before = f.hostility;
  const res = DEP.deploy(w, pid, f.id, 3);
  ok('the deployment is accepted', res.ok === true, res.reason || '');
  ok('and the neighbour reacts immediately',
    f.hostility === before + 3 * DEP.BORDER_SHOCK, `${before} -> ${f.hostility}`);
  ok('the Chronicle says they noticed',
    w.chronicle.some((e) => /move to the .* border/.test(e.text) && /has noticed/.test(e.text)),
    (w.chronicle.find((e) => /border/.test(e.text)) || {}).text || 'nothing');

  // Reinforcing again is a second message, and only the increase counts.
  const mid = f.hostility;
  DEP.deploy(w, pid, f.id, 5);
  ok('reinforcing costs only the difference', f.hostility === mid + 2 * DEP.BORDER_SHOCK);

  // Pulling back stops the provocation and buys nothing back.
  const high = f.hostility;
  DEP.deploy(w, pid, f.id, 0);
  ok('withdrawing does not undo it', f.hostility === high, `${high} -> ${f.hostility}`);
  ok('and the menace stops accruing', DEP.borderMenace(w, f.id) === 0);
}

// --- and leaving them there is a standing cost -----------------------------------
{
  const { w, pid } = fresh();
  const f = w.foreign.find((x) => !x.allied && !x.atWar);
  DEP.deploy(w, pid, f.id, 4);
  const menace = DEP.borderMenace(w, f.id);
  ok('a garrison carries a per-tick menace', menace > 0, String(menace));
  ok('scaled by how many are there',
    DEP.borderMenace(w, f.id) === 4 * DEP.BORDER_MENACE, String(menace));

  // It reaches hostility through the ordinary drift, not by a separate path.
  const start = f.hostility;
  for (let i = 0; i < 50; i += 1) S.tick(w);
  const withArmy = f.hostility - start;

  const { w: w2 } = fresh();
  const f2 = w2.foreign.find((x) => x.id === f.id);
  const start2 = f2.hostility;
  for (let i = 0; i < 50; i += 1) S.tick(w2);
  const without = f2.hostility - start2;
  ok('so hostility climbs faster with an army on the border than without',
    withArmy > without, `${withArmy.toFixed(2)} vs ${without.toFixed(2)} over 50 ticks`);
}

// --- the cap, the ally, and the war ----------------------------------------------
{
  const { w, pid } = fresh();
  const f = w.foreign.find((x) => !x.allied && !x.atWar);
  w.military.units = 60;
  DEP.deploy(w, pid, f.id, 40);
  ok('the menace is capped, so a huge army cannot outrun diplomacy',
    DEP.borderMenace(w, f.id) === DEP.BORDER_MENACE_CAP * DEP.BORDER_MENACE,
    String(DEP.borderMenace(w, f.id)));

  f.allied = true;
  ok('an ally reads the same divisions as cover, not a threat',
    DEP.borderMenace(w, f.id) === DEP.BORDER_MENACE_CAP * DEP.BORDER_MENACE * 0.25);

  f.allied = false; f.atWar = true;
  ok('and a power already at war is past being provoked', DEP.borderMenace(w, f.id) === 0);
}

// --- hostility stays on its rails --------------------------------------------------
{
  const { w, pid } = fresh();
  const f = w.foreign.find((x) => !x.allied && !x.atWar);
  f.hostility = 99;
  w.military.units = 30;
  DEP.deploy(w, pid, f.id, 25);
  ok('a huge deployment cannot push hostility past 100', f.hostility <= 100, String(f.hostility));
}

// Raising an army takes time, and volunteers can be sent where the fighting is.
//
//  - A division ordered is paid for now and in the field a month and a half
//    later (FORMATION_TICKS), whether it was ordered by the department or by law.
//  - Volunteers left at home add their weight to the whole army, thinned by how
//    thinly it is spread; volunteers sent to a front fight there at full weight.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};
const run = (w, n) => { for (let i = 0; i < n; i++) { w.elections = []; w.atThePolls = false; S.tick(w); } };
const goToWar = (w) => {
  const f = w.foreign[0];
  f.atWar = true; f.baseStrength = f.strength = 120;
  w.military.wars.push({ id: 'w1', foreign: f.id, started: 0, front: 0, exhaustion: 0, allies: [] });
  return f;
};

// --- divisions take time ------------------------------------------------------
ok('a division takes a month or so to raise', DEP.FORMATION_TICKS >= 20 && DEP.FORMATION_TICKS <= 60,
  String(DEP.FORMATION_TICKS));
{
  const w = mk();
  const pid = w.players.p1.personaId;
  w.emergency = { active: true, ends: 1e9 };   // so the executive may pay for it alone
  const units = w.military.units;
  const money = w.economy.treasury;
  const r = DEP.mobilize(w, pid, 2);
  ok('the order goes through', r.ok, r.reason || '');
  ok('the money leaves at once', w.economy.treasury < money, `${money} → ${w.economy.treasury}`);
  ok('but no division appears yet', w.military.units === units, String(w.military.units));
  ok('and they are shown as mustering', DEP.formingCount(w) === 2, String(DEP.formingCount(w)));
  run(w, DEP.FORMATION_TICKS - 2);
  ok('still mustering the tick before they are due', w.military.units === units, String(w.military.units));
  run(w, 3);
  ok('then they join the line', w.military.units === units + 2, String(w.military.units));
  ok('and the muster is empty', DEP.formingCount(w) === 0, String(DEP.formingCount(w)));
}

// --- a bill raises them the same way ------------------------------------------
{
  const w = mk();
  const units = w.military.units;
  A.CLAUSES.RAISE_DIVISIONS.apply(w, { count: 3 });
  ok('a law does not conjure a trained corps either', w.military.units === units, String(w.military.units));
  ok('the law\'s divisions muster too', DEP.formingCount(w) === 3, String(DEP.formingCount(w)));
  run(w, DEP.FORMATION_TICKS + 2);
  ok('and arrive in their own time', w.military.units === units + 3, String(w.military.units));
}

// --- volunteers to the front ---------------------------------------------------
{
  const w = mk();
  const pid = w.players.p1.personaId;
  const f = goToWar(w);
  w.military.volunteers = 4;
  ok('all volunteers start at home', DEP.volunteersHome(w) === 4 && DEP.volunteersAt(w, f.id) === 0);
  const r = DEP.sendVolunteers(w, pid, f.id, 3);
  ok('three go up to the front', r.ok && DEP.volunteersAt(w, f.id) === 3, r.reason || '');
  ok('and one is left at home', DEP.volunteersHome(w) === 1, String(DEP.volunteersHome(w)));
  const over = DEP.sendVolunteers(w, pid, f.id, 9);
  ok('more cannot be sent than exist', over.ok === false, over.reason);
  const back = DEP.sendVolunteers(w, pid, f.id, 0);
  ok('and they can be brought home again', back.ok && DEP.volunteersAt(w, f.id) === 0);
}
{
  // No war, no front to send them to.
  const w = mk();
  const r = DEP.sendVolunteers(w, w.players.p1.personaId, w.foreign[0].id, 1);
  ok('volunteers cannot be sent where there is no war', r.ok === false, r.reason);
}
{
  // Committed volunteers push the front harder than the same volunteers at home.
  //
  // One world, cloned, so both arms share an RNG stream and the per-tick swing
  // is identical in each — the only difference is where the volunteers are.
  // Two separately-seeded worlds made this a coin flip: the ±0.8 random swing
  // per tick is larger than the advantage being measured.
  const home = mk();
  const fh = goToWar(home);
  home.military.volunteers = 10;
  const front = JSON.parse(JSON.stringify(home));
  DEP.sendVolunteers(front, front.players.p1.personaId, fh.id, 10);
  run(home, 12); run(front, 12);
  const wh = home.military.wars[0].front, wf = front.military.wars[0].front;
  ok('volunteers at the front do more than volunteers at home', wf > wh, `${wf.toFixed(2)} vs ${wh.toFixed(2)}`);
}
{
  // Attrition spends the ones at the front, and the commitment follows them down.
  const w = mk();
  const f = goToWar(w);
  w.military.wars[0].front = -40;
  w.military.volunteers = 2; w.military.attrition = 0.95;
  DEP.sendVolunteers(w, w.players.p1.personaId, f.id, 2);
  for (let i = 0; i < 8 && w.military.volunteers === 2; i++) run(w, 1);
  ok('a volunteer at the front is spent first', w.military.volunteers < 2, String(w.military.volunteers));
  ok('and never more are claimed at the front than exist',
    DEP.volunteersAt(w, f.id) <= w.military.volunteers,
    `${DEP.volunteersAt(w, f.id)} at front, ${w.military.volunteers} alive`);
}

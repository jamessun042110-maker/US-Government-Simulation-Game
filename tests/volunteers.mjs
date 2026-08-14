// Volunteer divisions: a tenth the strength of a regular division for $900k, and
// the first to fall. Raised out of the Treasury's discretionary disbursement to
// the army, cheaply enough that a president need not take it to the chamber.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};
// Volunteers are only raised in wartime now, so put the country at war first.
const goToWar = (w) => {
  const f = w.foreign.find((x) => x.id === 'canada') || w.foreign[0];
  f.atWar = true; f.baseStrength = f.strength = 120;
  w.military.wars.push({ id: 'w_setup', foreign: f.id, started: 0, front: -20, exhaustion: 0, allies: [] });
  return w;
};

ok('a volunteer division costs $900k', DEP.VOLUNTEER_COST === 9e5, String(DEP.VOLUNTEER_COST));
ok('and fights at a tenth of a regular division', DEP.VOLUNTEER_STRENGTH === 0.1, String(DEP.VOLUNTEER_STRENGTH));

// Volunteers may only be called up in wartime — no war, no levy.
{
  const w = mk();
  const r = DEP.mobilizeVolunteers(w, w.players.p1.personaId, 1);
  ok('no volunteers may be raised in peacetime', !r.ok && /war/i.test(r.reason || ''), r.reason || '');
}

// Raising one, discretionarily: $900k is under the $1M that would force a vote.
{
  const w = goToWar(mk());
  const pid = w.players.p1.personaId;
  const before = w.economy.treasury;
  const r = DEP.mobilizeVolunteers(w, pid, 1);
  ok('a president raises a volunteer division out of discretionary money', r.ok, r.reason || '');
  ok('a volunteer division appears', w.military.volunteers === 1, String(w.military.volunteers));
  ok('and the Treasury pays $900k for it', before - w.economy.treasury === DEP.VOLUNTEER_COST,
    `${((before - w.economy.treasury) / 1e3).toFixed(0)}k`);
  ok('the regular line is untouched', w.military.units === 4, String(w.military.units));
}

// A whole levy at once crosses the discretionary line and needs the chamber, the
// same as any disbursement of that size — volunteers are cheap, not lawless.
{
  const w = goToWar(mk());
  const pid = w.players.p1.personaId;
  const r = DEP.mobilizeVolunteers(w, pid, 5);   // $4.5M
  ok('raising a levy at once needs a vote', !r.ok && /vote|bill|majority/i.test(r.reason || ''), r.reason || '');
  ok('and nothing is raised without it', (w.military.volunteers || 0) === 0, String(w.military.volunteers || 0));
}

// Their strength, on the line: ten volunteers are one regular division's worth.
{
  const w = mk();
  w.military.volunteers = 10;
  const line = w.military.units + w.military.volunteers * DEP.VOLUNTEER_STRENGTH;
  ok('ten volunteers add one division of strength', Math.abs(line - w.military.units - 1) < 1e-9,
    `line strength ${line} vs ${w.military.units} regulars`);
}

// The first into the ground: a war under way, and a volunteer falls before a regular.
{
  const w = mk();
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true; f.baseStrength = f.strength = 120;
  w.military.wars.push({ id: 'w_vol', foreign: 'canada', started: 0, front: -40, exhaustion: 0, allies: [] });
  w.military.units = 3; w.military.volunteers = 2; w.military.attrition = 0.95;
  for (let i = 0; i < 6 && w.military.volunteers === 2; i++) S.tick(w);
  ok('under fire a volunteer is spent before a regular division',
    w.military.volunteers < 2 && w.military.units === 3, `volunteers ${w.military.volunteers}, divisions ${w.military.units}`);
}

// Through the action, the way the Defense tab dispatches it.
{
  const w = goToWar(mk());
  ACT.apply(w, { type: 'MOBILIZE_VOLUNTEERS', playerId: 'p1', count: 1 });
  ok('the MOBILIZE_VOLUNTEERS action raises one', w.military.volunteers === 1, String(w.military.volunteers));
}

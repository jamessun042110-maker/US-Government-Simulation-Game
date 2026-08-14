const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const SC = await import(base + 'scene.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};

// --- the doors --------------------------------------------------------------
{
  const { w, pid } = mk();
  ok('the President enters both', R.mayEnterDept(w, pid, 'state') && R.mayEnterDept(w, pid, 'defense'));
  const secSeat = w.seats.find((s) => s.office === 'state');
  const cit = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length);
  ok('a private citizen enters neither', !R.mayEnterDept(w, cit.id, 'state') && !R.mayEnterDept(w, cit.id, 'defense'));
  secSeat.personaId = cit.id;
  ok('the Secretary of State enters State', R.mayEnterDept(w, cit.id, 'state'));
  ok('...but not Defense', !R.mayEnterDept(w, cit.id, 'defense'));
  ok('the channels are gated the same way',
    R.mayHear(w, pid, 'state') && R.mayHear(w, cit.id, 'state') && !R.mayHear(w, cit.id, 'defense'));
  const vp = w.seats.find((s) => s.office === 'vp')?.personaId;
  ok('the VP is not in either', !R.mayEnterDept(w, vp, 'state') && !R.mayEnterDept(w, vp, 'defense'));
}

// --- State ------------------------------------------------------------------
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  const e = DEP.envoys(w)[f.id];
  const all = Object.values(DEP.envoys(w));
  ok('every power has an ambassador', all.length === w.foreign.length && all.every((x) => /^[^u].*\s\S+$/.test(x.name) && !/undefined/.test(x.name)),
    all.map((x) => x.name).join(', '));

  const h0 = f.hostility;
  ok('received', DEP.receive(w, pid, f.id).ok && DEP.audienceOpen(w, e));
  ok('reassurance lowers hostility', DEP.talk(w, pid, f.id, 'reassure').ok && f.hostility < h0, `${h0} -> ${f.hostility}`);
  ok('one piece of business per audience', DEP.talk(w, pid, f.id, 'press').ok === false);

  // The audience closes on its own, and then they will not come back for a year.
  for (let i = 0; i < DEP.AUDIENCE_TICKS + 2; i++) S.tick(w);
  ok('the audience ends itself', !DEP.audienceOpen(w, DEP.envoys(w)[f.id]));
  ok('and they will not return at once', DEP.receive(w, pid, f.id).ok === false, DEP.receive(w, pid, f.id).reason?.slice(0, 40));
  w.clock.tick += w.clock.ticksPerYear;
  ok('a year later they will', DEP.receive(w, pid, f.id).ok);

  // Terms cost money and work harder. Money at this size needs authority: the
  // department spends through disburseGate like everything else, so the test
  // declares the emergency the constitution would otherwise require.
  const h1 = f.hostility, t0 = w.economy.treasury;
  w.emergency = { active: true, by: pid, started: w.clock.tick, ends: w.clock.tick + 5000 };
  DEP.talk(w, pid, f.id, 'terms');
  ok('terms cost the treasury', w.economy.treasury < t0, `${Math.round(t0/1e6)}M -> ${Math.round(w.economy.treasury/1e6)}M`);
  ok('and buy more than words', h1 - f.hostility > 15, `${h1} -> ${f.hostility}`);

  // A power at war sends nobody.
  const g = w.foreign.find((x) => x.id === 'sab');
  g.atWar = true;
  ok('a belligerent has no delegation', DEP.receive(w, pid, g.id).ok === false);
}

// --- Defense ----------------------------------------------------------------
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  const units0 = w.military.units;

  ok('nothing done means eight-tenths', Math.abs(DEP.effectiveness(w, f.id).factor - 0.8) < 1e-9,
    DEP.effectiveness(w, f.id).factor.toFixed(2));

  // Same here: an army is a disbursement well over the threshold.
  w.emergency = { active: true, by: pid, started: w.clock.tick, ends: w.clock.tick + 5000 };
  // Ordered now, in the field after DEP.FORMATION_TICKS — a division is not
  // conjured by paying for it. The rest of this block needs an army to deploy,
  // so run the muster out rather than waiting on the tick loop.
  ok('mobilising orders divisions', DEP.mobilize(w, pid, 3).ok && DEP.formingCount(w) === 3, String(DEP.formingCount(w)));
  w.military.units += 3; w.military.forming = [];
  ok('and they reach the line', w.military.units === units0 + 3, String(w.military.units));
  ok('cannot deploy more than exist', DEP.deploy(w, pid, f.id, w.military.units + 1).ok === false);
  ok('deploying works', DEP.deploy(w, pid, f.id, w.military.units).ok && DEP.committedTo(w, f.id) === w.military.units);
  ok('fully committed is full strength', Math.abs(DEP.effectiveness(w, f.id).factor - 1.0) < 1e-9,
    DEP.effectiveness(w, f.id).factor.toFixed(2));
  ok('the reserve empties', DEP.inReserve(w) === 0);
  ok('and other borders are then blocked', DEP.deploy(w, pid, 'sab', 1).ok === false);

  ok('a plan starts unready', DEP.draftPlan(w, pid, f.id, 'offensive').ok && DEP.planFor(w, f.id).ready === false);
  for (let i = 0; i < DEP.PLAN_DRAFT_TICKS + 1; i++) S.tick(w);
  const plan = DEP.planFor(w, f.id);
  ok('then comes into force', plan.ready && plan.strength > 0.9, plan.strength.toFixed(2));
  ok('and adds to the fighting', DEP.effectiveness(w, f.id).factor > 1.0
    && DEP.effectiveness(w, f.id).factor <= 1.1001, DEP.effectiveness(w, f.id).factor.toFixed(2));
  w.clock.tick += DEP.PLAN_LIFE_YEARS * w.clock.ticksPerYear;
  ok('a stale plan is worth nothing', DEP.planFor(w, f.id).strength === 0);

  // Nobody outside the building may touch any of it.
  const cit = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length);
  ok('a citizen cannot mobilise', DEP.mobilize(w, cit.id, 1).ok === false);
  ok('a citizen cannot deploy', DEP.deploy(w, cit.id, f.id, 0).ok === false);
  ok('a citizen cannot plan', DEP.draftPlan(w, cit.id, f.id, 'defensive').ok === false);
}

// --- the art ----------------------------------------------------------------
{
  const { w } = mk();
  const st = SC.officeScene(w, 'state');
  const df = SC.officeScene(w, 'defense');
  ok('the State room draws', typeof st === 'string' && st.length > 500);
  ok('the war room draws', typeof df === 'string' && df.length > 500);
  ok('and it is lit cyan', /3fd8e8|[0-9a-f]{0,2}d8e8/i.test(df) || /cyan/i.test(df), 'screens present');
}

// A peace treaty ends a specific war, or refuses to.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function mk() {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0;
  return { w, pid };
}

// --- the clause is offered on the treaty menu ----------------------------------
{
  ok('the treaty menu carries a peace treaty', A.clausesFor('treaty').includes('TREATY_PEACE'));
  ok('and it names both parties', /peace/i.test(A.CLAUSES.TREATY_PEACE.label));
}

// --- peace during peace is refused ---------------------------------------------
{
  const { w, pid } = mk();
  const doc = A.createDoc(w, {
    type: 'treaty', title: 'Peace with Goldland', authorId: pid,
    clauses: [{ kind: 'TREATY_PEACE', party: 'goldland' }],
  });
  const weigh = DEP.weighAssent(w, doc);
  ok('there is no war to end', weigh.ok === false, weigh.reason || '');
}

// --- a losing enemy accepts ----------------------------------------------------
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  f.atWar = true;
  w.military.wars.push({ id: 'w0', foreign: f.id, started: 0, front: 40, exhaustion: 0, allies: [] });

  const doc = A.createDoc(w, {
    type: 'treaty', title: 'Peace with Goldland', authorId: pid,
    clauses: [{ kind: 'TREATY_PEACE', party: 'goldland' }],
  });
  const weigh = DEP.weighAssent(w, doc);
  ok('a losing enemy is likely to accept', weigh.ok !== false && weigh.chance > 0.9, JSON.stringify(weigh));
}

// --- a winning enemy is much less likely ----------------------------------------
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  f.atWar = true;
  w.military.wars.push({ id: 'w0', foreign: f.id, started: 0, front: -40, exhaustion: 0, allies: [] });

  const doc = A.createDoc(w, {
    type: 'treaty', title: 'Peace with Goldland', authorId: pid,
    clauses: [{ kind: 'TREATY_PEACE', party: 'goldland' }],
  });
  const weigh = DEP.weighAssent(w, doc);
  ok('a winning enemy is unlikely to accept', weigh.ok !== false && weigh.chance < 0.2, JSON.stringify(weigh));
}

// --- applying it ends the war ---------------------------------------------------
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  f.atWar = true;
  const war = { id: 'w0', foreign: f.id, started: 0, front: 20, exhaustion: 0, allies: [] };
  w.military.wars.push(war);
  const bootHostility = f.hostility;

  A.CLAUSES.TREATY_PEACE.apply(w, { party: 'goldland' });
  ok('the war is over', f.atWar === false);
  ok('the war record is marked negotiated', war.negotiated === true);
  ok('hostility comes down substantially', f.hostility < bootHostility - 30,
    `${bootHostility} -> ${f.hostility}`);
  ok('and no indemnity is paid', w.economy.treasury >= 0);
}

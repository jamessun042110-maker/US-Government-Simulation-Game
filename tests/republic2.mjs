// Seven rules added in one stretch, each closing a gap where the game said one
// thing and did another: construction that employed nobody, a presidency that
// could not be lost, a founder who was also a minister, a crisis the chamber
// answered and the record ignored, a country made entirely of officeholders,
// and a treaty the other party was never asked about.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const D = await import(base + 'director.js');
const DEP = await import(base + 'depts.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));
const pct = (v) => (v * 100).toFixed(2) + '%';

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};

// --- 1. a country with private citizens in it ---------------------------------
{
  const { w, pid } = mk();
  const free = Object.values(w.personas).filter((x) => x.alive && !R.officesOf(w, x.id).length);
  ok('the republic opens with people out of office', free.length >= 12, String(free.length));
  const placed = new Set(free.map((x) => x.district).filter((id) => w.districts.some((d) => d.id === id)));
  ok('spread across the districts', placed.size === w.districts.length,
    `${placed.size} of ${w.districts.length}`);
  // Which is the point: the cabinet can be filled without raiding the chamber.
  const appointable = free.filter((x) => R.mayAlsoHold(w, x.id, 'state').ok);
  ok('and the President has somebody to appoint', appointable.length > 0, String(appointable.length));
}

// --- 2. construction employs people while it is going up ------------------------
{
  // The same world twice, not two worlds. `newWorld` seeds rngState from
  // Math.random, so "a control and a treatment" built by calling mk() twice
  // are two different countries with two different districts and two different
  // moods — the comparison passed by luck for a while and then failed by it.
  // A JSON round-trip is an exact copy, rng state included.
  const control = mk().w;
  const site = JSON.parse(JSON.stringify(control));
  for (let i = 0; i < 60; i++) { S.tick(control); S.tick(site); }
  const parcel = site.city.parcels.find((p) => !p.building && !p.water && !p.project);
  ok('a crew is estimated off the cost',
    W.constructionCrew({ cost: 8e6 }) === 100, String(W.constructionCrew({ cost: 8e6 })));
  ok('and nothing under way employs nobody', W.constructionCrew(null) === 0);

  const before = site.economy.structural;
  A.startProject(site, parcel.i, 'park');
  ok('breaking ground puts people to work at once', site.economy.structural < before,
    `${pct(before)} -> ${pct(site.economy.structural)}`);
  ok('the crew is counted', site.economy.constructionJobs > 0, String(site.economy.constructionJobs));
  ok('and the record says how many', site.chronicle.some((e) => /[\d,]+ on the site/.test(e.text)),
    site.chronicle.slice(-1)[0]?.text || '');

  for (let i = 0; i < 80; i++) { S.tick(control); S.tick(site); }
  ok('unemployment is lower than in the republic that built nothing',
    site.economy.unemployment < control.economy.unemployment,
    `${pct(control.economy.unemployment)} vs ${pct(site.economy.unemployment)}`);
  const d = site.districts.find((x) => x.id === parcel.district);
  const cd = control.districts.find((x) => x.id === parcel.district);
  ok('and the district doing the building feels it most',
    d.unemployment < cd.unemployment, `${pct(cd.unemployment)} vs ${pct(d.unemployment)}`);

  // The crew goes home when the building opens.
  for (let i = 0; i < 400; i++) S.tick(site);
  ok('the crew goes home when it opens', site.economy.constructionJobs === 0);
  // The site is settled one way or the other — it opened, or the director took
  // it off the map, which it is entitled to do to a building or a site under
  // construction. This block is about the crew being counted while they work
  // and gone when they stop; asserting the building is also *fireproof* fails a
  // run in twenty for a reason that is the game working.
  const p2 = site.city.parcels[parcel.i];
  ok('and the site is settled', !p2.project,
    p2.building ? 'the park opened' : 'the site was lost, which is allowed');
}

// --- 3. a national election is a referendum on the government -------------------
// A whole presidency used to be almost unlosable: incumbency was a flat ×1.1
// whatever the country thought, so approval could sit at 20% for a term and the
// sitting head of government still went into the count with a bonus. Measured
// over many counts, because a single election is one roll of the dice — the
// question is whether the odds moved, not whether one man lost his job.
{
  /** Run one presidential election, incumbent against an equal challenger. */
  const contest = (mood, seed) => {
    const { w, pid } = mk();
    w.rngState = seed;
    for (const d of w.districts) { d.mood = mood; d.moodTarget = mood; }
    const rival = Object.values(w.personas).find((x) => x.alive && x.id !== pid && !R.officesOf(w, x.id).length);
    // Personal standing held equal, so the only difference is the country's.
    w.personas[pid].approval = 50; rival.approval = 50;
    A.scheduleElection(w, 'president', 1);
    const e = w.elections.find((x) => x.office === 'president' && x.status === 'open');
    S.nominate(w, e, pid); S.nominate(w, e, rival.id);
    for (const d of w.districts) { d.mood = mood; }
    for (let i = 0; i < (e.runs ?? 60) + 8 && e.status === 'open'; i++) {
      for (const d of w.districts) d.mood = mood;   // hold the country still
      S.tick(w);
    }
    return w.seats.find((s) => s.office === 'president').personaId === pid;
  };
  const rate = (mood) => {
    let held = 0;
    for (let n = 0; n < 40; n++) if (contest(mood, 1000 + n * 7919)) held++;
    return held / 40;
  };
  const loved = rate(88), loathed = rate(12);
  ok('a government the country likes is returned more often than one it does not',
    loved > loathed, `${(loved * 100).toFixed(0)}% at 88 mood vs ${(loathed * 100).toFixed(0)}% at 12`);
  ok('and being loathed is a real risk, not a rounding error', loathed < 0.75,
    `${(loathed * 100).toFixed(0)}% held`);
  const { w } = mk();
  const nat = (m) => { for (const d of w.districts) d.mood = m; return S.nationalApproval(w); };
  ok('national approval tracks the districts it is made of', nat(80) > nat(20));
}

// --- 4. an officeholder cannot found a company ----------------------------------
{
  const { w, pid } = mk();
  ok('the President may not found one', !CO.mayFound(w, pid, R.officesOf));
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  ok('and the engine refuses it', !(w.companies || []).length);
  ok('saying why', (w.notices || []).some((n) => /hold an office/.test(n.text)),
    (w.notices || []).slice(-1)[0]?.text || '');

  // Out of office, the door opens.
  w.seats.find((s) => s.office === 'president').personaId = null;
  ok('a private citizen may', CO.mayFound(w, pid, R.officesOf));
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  ok('and does', (w.companies || []).length === 1);
}

// --- 5. a crisis the chamber answers is answered --------------------------------
{
  const { w, pid } = mk();
  D.fire(w, 'recession');
  const ev = w.events.find((e) => !e.resolved && !e.notice);
  const costed = ev.options.findIndex((o) => o.cost);
  ok('the crisis has a costed answer', costed >= 0);

  const doc = A.createDoc(w, {
    type: 'bill', title: `${ev.title} — appropriation`, authorId: pid,
    clauses: [{ kind: 'APPROPRIATE', amount: ev.options[costed].cost, purpose: 'relief' }],
    answers: { evUid: ev.uid, option: costed },
  });
  ok('the bill remembers what it is for', doc.answers?.evUid === ev.uid);
  A.introduce(w, doc.id, pid, 30);
  // Every chamber the constitution names, not just the one it used to have.
  for (let room = 0; doc.status === 'floor' && room < 4; room++) {
    for (const v of R.electorateFor(w, doc)) A.castVote(w, doc.id, v.personaId, 'yea');
    A.closeFloor(w, doc.id);
  }
  A.sign(w, doc.id, pid);
  ok('it becomes law', doc.status === 'law', doc.status);
  ok('and the crisis is closed by it', ev.resolved != null, String(ev.resolved));
  ok('credited to the chamber', ev.byLaw === doc.id);
  ok('and the record says so', w.chronicle.some((e) => /answered by the chamber/.test(e.text)));
}

// --- 6. a treaty is put to the other party first ---------------------------------
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'mexico');
  f.hostility = 2;
  const doc = A.createDoc(w, {
    type: 'treaty', title: 'Pact with Mexico', authorId: pid,
    clauses: [{ kind: 'TREATY_NONAGGRESSION', party: 'mexico', years: 10 }],
  });
  A.introduce(w, doc.id, pid, 60);
  ok('it does not go straight to the floor', doc.status === 'awaiting-assent', doc.status);
  ok('it is with the other party', doc.assent?.foreignId === 'mexico');
  ok('and the record says the chamber is waiting',
    w.chronicle.some((e) => /is put to Mexico/.test(e.text)));

  for (let i = 0; i < DEP.ASSENT_TICKS + 4; i++) S.tick(w);
  ok('a friendly power answers', doc.assent?.answered != null);
  ok('and a warm one agrees', doc.assent?.agreed === true, doc.assent?.why || '');
  ok('which lays it before the chamber', ['floor', 'law', 'awaiting-signature', 'passed'].includes(doc.status), doc.status);

  // A power at war with you will not sign anything.
  const { w: w2, pid: p2 } = mk();
  const g = w2.foreign.find((x) => x.id === 'canada');
  g.atWar = true;
  const d2 = A.createDoc(w2, {
    type: 'treaty', title: 'Pact with Canada', authorId: p2,
    clauses: [{ kind: 'TREATY_DEFENSE', party: 'canada' }],
  });
  // Refused at the door, not forty ticks later. An answer that is knowable in
  // advance — they are at war with us, they read us as an enemy, they turned
  // this down last year — is worth more to the player now than as a Chronicle
  // entry a minute from now. Only the dice are worth waiting on.
  const r2 = A.introduce(w2, d2.id, p2, 60);
  ok('a power at war refuses', r2.ok === false, r2.reason || '');
  ok('and the measure never leaves the desk', d2.status === 'draft', d2.status);
  ok('with a reason the player can act on', /at war/.test(r2.reason || ''), r2.reason);

  // Hostility is the lever, which is what the Department of State moves.
  const { w: w3, pid: p3 } = mk();
  const h = w3.foreign.find((x) => x.id === 'canada');
  const at = (hostility) => {
    h.hostility = hostility;
    const d = A.createDoc(w3, { type: 'treaty', title: 'P' + hostility, authorId: p3,
      clauses: [{ kind: 'TREATY_NONAGGRESSION', party: 'canada', years: 5 }] });
    return DEP.weighAssent(w3, d).chance;
  };
  ok('a warm power is likelier to sign than a cold one', at(10) > at(80), `${at(10).toFixed(2)} vs ${at(80).toFixed(2)}`);
}

// --- 7. the first hundred days --------------------------------------------------
// Two things, and they pull the same way: a new government starts from a better
// number than it came in on, and for a hundred days the public's verdict pulls
// at a fifth of its usual strength. A president sworn in last week is not yet
// the reason the country is the way it is.
{
  const { w, pid } = mk();
  const p = w.personas[pid];
  p.approval = 40;
  R.countTerm(w, pid, 'president');
  ok('taking office lifts you toward a starting position', p.approval > 40 && p.approval < R.HONEYMOON_START,
    `40 -> ${p.approval.toFixed(1)}`);

  // A wildly popular figure does not lose standing by winning.
  const q = Object.values(w.personas).find((x) => x.alive && x.id !== pid);
  q.approval = 90;
  R.countTerm(w, q.id, 'assembly');
  ok('and a popular one is not dragged down to it', q.approval > 70, q.approval.toFixed(1));

  // The decay. Same world twice, same miserable country, differing only in how
  // long the government has been in the chair.
  const decay = (daysIn) => {
    const world = JSON.parse(JSON.stringify(mk().w));
    const me = world.players.p1.personaId;
    const seat = world.seats.find((s) => s.office === 'president');
    seat.personaId = me;
    seat.since = world.clock.tick - Math.round((daysIn / 365) * world.clock.ticksPerYear);
    for (const d of world.districts) { d.mood = 10; d.moodTarget = 10; }
    world.personas[me].approval = 70;
    // Twenty ticks is about a month of canon time, which keeps the whole
    // window inside the honeymoon. Measuring over sixty ran to day 96 — past
    // the point where the protection has already faded most of the way back,
    // which understated it by half.
    for (let i = 0; i < 20; i++) {
      for (const d of world.districts) d.mood = 10;
      S.tick(world);
    }
    return 70 - world.personas[me].approval;
  };
  const fresh = decay(5), settled = decay(300);
  ok('approval falls far more slowly in the honeymoon', fresh < settled,
    `${fresh.toFixed(2)} points lost at day 5 vs ${settled.toFixed(2)} at day 300`);
  ok('and by a wide margin', settled > fresh * 3,
    `${fresh.toFixed(2)} vs ${settled.toFixed(2)}`);
  ok('it has worn off by day 160', decay(160) > decay(20) * 2,
    `${decay(20).toFixed(2)} at day 20 vs ${decay(160).toFixed(2)} at day 160`);
}

// --- 8. the record knows a re-election when it sees one ---------------------------
{
  const { w } = mk();
  for (let i = 0; i < 240 * 12; i++) S.tick(w);
  // Two entries per succession now, because the count and the oath are months
  // apart: the poll in November says who won and whom they beat, and the
  // swearing-in in January says which term of theirs it is. See
  // rules.electionCallTick and sim.tickPendingTerms.
  const results = w.chronicle.filter((e) => e.kind === 'election' && /\bis (re-)?elected\b/.test(e.text));
  const oaths = w.chronicle.filter((e) => /is sworn in /.test(e.text));
  ok('elections are reported', results.length > 4, String(results.length));
  const again = results.filter((e) => /is re-elected/.test(e.text));
  const fresh = results.filter((e) => /\bis elected\b/.test(e.text));
  ok('some are re-elections', again.length > 0, `${again.length} of ${results.length}`);
  ok('and some are not', fresh.length > 0, `${fresh.length} of ${results.length}`);
  ok('a re-election says which term it is',
    oaths.some((e) => /for a (second|third|fourth|fifth|sixth) term/.test(e.text)),
    oaths.slice(0, 2).map((e) => e.text).join(' | '));
  ok('and a defeat names who was beaten',
    fresh.some((e) => /defeating /.test(e.text)) || oaths.some((e) => /succeeding /.test(e.text)),
    fresh.slice(0, 1).map((e) => e.text).join(''));
  ok('nobody is described as defeating themselves',
    !results.some((e) => { const m = e.text.match(/^(.+?) is elected .*defeating (.+?)\./); return m && m[1] === m[2]; }));
}

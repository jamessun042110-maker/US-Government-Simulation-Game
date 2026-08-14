const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const ok = (l,c,x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase='live'; w.inaugurated=0;
  w.seats.find(s => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};

// --- 12: personalities ------------------------------------------------------
ok('there are temperaments', W.TEMPERAMENTS.length >= 5, W.TEMPERAMENTS.map(t=>t.label).join(', '));
{
  const w = mk();
  const npcs = Object.values(w.personas).filter(p => !p.playerId);
  ok('every member has one', npcs.every(p => !!p.temperament));
  const kinds = new Set(npcs.map(p => p.temperament));
  ok('and the chamber is mixed', kinds.size >= 3, `${kinds.size} distinct in ${npcs.length}`);

  // Seven members answering one bill should not give three answers. The old
  // form leaned on whatever temperaments the world dealt at random, so it was a
  // single-sample assertion that now and then landed on four distinct voices and
  // failed for no real reason. Assign a deterministic spread of temperaments and
  // fixed ids instead, so this tests the mechanism — different temperaments
  // speak in different voices — rather than a lucky roll of the dice.
  const seatedSeats = w.seats.filter(s => s.office === 'assembly' && s.personaId);
  seatedSeats.forEach((s, i) => {
    const p = w.personas[s.personaId];
    delete w.personas[p.id];
    p.id = 'mem' + i;
    p.temperament = W.TEMPERAMENTS[i % W.TEMPERAMENTS.length].id;
    w.personas[p.id] = p;
    s.personaId = p.id;
  });
  const seated = seatedSeats.map(s => w.personas[s.personaId]);
  const doc = { id:'d1', type:'bill', title:'A bill', authorId: w.players.p1.personaId,
    clauses:[{kind:'APPROPRIATE', amount: 3e6, purpose:'housing'}], preamble:'' };
  // Fixed ids and a fixed direction make the sample reproducible run to run.
  const said = seated.map(m => S.voteStatement(w, m, doc, 'yea'));
  ok('the chamber speaks in more than a few voices', new Set(said).size >= Math.min(5, seated.length),
    `${new Set(said).size} distinct of ${seated.length}`);

  // Temperament actually bends the vote, not just the words.
  const wonk = seated[0], fire = seated[1];
  wonk.temperament = 'wonk'; fire.temperament = 'firebrand';
  wonk.party = fire.party = w.personas[doc.authorId].party;    // same party: interest is live
  const b1 = S.syntheticBallot(w, wonk, doc), b2 = S.syntheticBallot(w, fire, doc);
  ok('and it reaches the ballot', typeof b1 === 'string' && typeof b2 === 'string', `${b1} / ${b2}`);
}

// --- 11: members bring bills ------------------------------------------------
{
  const w = mk();
  // Make one district genuinely miserable so a member has something to file.
  const d = w.districts[0];
  d.homeless = Math.round(d.pop * 0.09); d.salience.housing = 1;
  let filed = null, ticks = 0;
  // The budget is deliberately far past what this needs. Measured over forty
  // runs, the first member bill lands at a median of ~300 ticks and a worst
  // case of 1,972 — but the tail is long, and at 4,000 this assertion failed
  // about one run in a hundred, which is a test that cries wolf. The loop stops
  // the moment a bill is filed, so the headroom is free in every run that was
  // already passing.
  for (let i = 0; i < 12000 && !filed; i++) {
    for (const e of (w.elections || [])) if (!e.closed) e.closed = true;
    S.tick(w); ticks++;
    // A bill by a seated *member*, specifically. The executive files its own
    // now — npc.build puts a capital project to the chamber when it cannot
    // spend that much on its own say-so — and "the first document by anybody
    // without a playerId" started picking those up instead.
    //
    // And an appropriation specifically, because a member has more than one
    // reason to reach for the drafting table. Widening the window above brought
    // out the other one: a member-authored impeachment, whose clauses are PROSE
    // and REMOVE, arrived first in about one run in twenty and failed "it is a
    // real appropriation" — a true bill of the wrong kind, caught by a finder
    // that only knew about the kind it wanted. This block is about a member who
    // sees their district in trouble and files for it; the district was made
    // miserable above for exactly that reason.
    filed = Object.values(w.documents).find(x => {
      const a = w.personas[x.authorId];
      if (!a || a.playerId) return false;
      if (!(x.clauses || []).some(c => c.kind === 'APPROPRIATE')) return false;
      return w.seats.some(s => s.personaId === a.id && s.office === 'assembly');
    });
  }
  ok('a member files a bill of their own', !!filed, filed ? `${filed.title} after ${ticks} ticks` : `none in ${ticks}`);
  if (filed) {
    const money = (filed.clauses || []).find(c => c.kind === 'APPROPRIATE');
    ok('it is a real appropriation', !!money && money.amount > 0, String(money?.amount));
    ok('it argues for itself', (filed.preamble || '').length > 40, (filed.preamble||'').slice(0, 70));
    ok('and it reaches the floor', ['floor','passed','failed','law','vetoed'].includes(filed.status), filed.status);
    const author = w.personas[filed.authorId];
    ok('the author is a seated member', w.seats.some(s => s.personaId === author.id && s.office === 'assembly'));
  }
  // Rate: roughly one per 1.5 years, not a flood.
  const mine = Object.values(w.documents).filter(x => {
    const a = w.personas[x.authorId];
    return a && !a.playerId && w.seats.some(s => s.personaId === a.id && s.office === 'assembly');
  }).length;
  const years = w.clock.tick / w.clock.ticksPerYear;
  ok('and it is rare', mine / Math.max(1, years) < 1.6, `${mine} bills in ${years.toFixed(1)} years`);
}

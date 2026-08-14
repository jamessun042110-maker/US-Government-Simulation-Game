// The convention's ceilings, the right that names nothing, and who answers a
// crisis. Three unrelated rules that share one property: the UI used to be the
// only thing enforcing them.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const D = await import(base + 'director.js');
const CT = await import(base + 'court.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};

// --- seat ceilings ----------------------------------------------------------
ok('one president', R.seatCap('president') === 1, String(R.seatCap('president')));
ok('two vice presidents', R.seatCap('vp') === 2, String(R.seatCap('vp')));
ok('thirteen justices', R.seatCap('justice') === 13, String(R.seatCap('justice')));
ok('twenty in the chamber', R.seatCap('assembly') === 20, String(R.seatCap('assembly')));
ok('an invented office keeps the general ceiling', R.seatCap('ministryofthings3') === R.MAX_SEATS);

// repairConstitution is the enforcement point, because a constitution can
// arrive from a save, a template, an amendment or another player's tab.
{
  const { w } = mk();
  const c = w.constitution;
  c.offices.find((o) => o.id === 'president').seats = 9;
  c.offices.find((o) => o.id === 'vp').seats = 7;
  c.offices.find((o) => o.id === 'justice').seats = 40;
  c.offices.find((o) => o.id === 'assembly').seats = 99;
  R.repairConstitution(c);
  const at = (id) => c.offices.find((o) => o.id === id).seats;
  ok('a nine-headed presidency is cut to one', at('president') === 1, String(at('president')));
  ok('seven deputies to two', at('vp') === 2, String(at('vp')));
  ok('forty justices to thirteen', at('justice') === 13, String(at('justice')));
  ok('ninety-nine members to twenty', at('assembly') === 20, String(at('assembly')));
  // Zero still means "this office will not exist", which the cap must not undo.
  c.offices.find((o) => o.id === 'vp').seats = 0;
  R.repairConstitution(c);
  ok('and zero survives the repair', at('vp') === 0, String(at('vp')));
}

// --- the right that names nothing -------------------------------------------
{
  const { w, pid } = mk();
  ok('a republic does not retain them by default', !R.retainsUnenumerated(w));
  ok('the catalogue carries the clause', !!R.RIGHTS_CATALOG.unenumerated?.open);
  ok('and it blocks no named act', (R.RIGHTS_CATALOG.unenumerated.blocks || []).length === 0);

  // An arrest by decree, in a republic with no right against it either way.
  w.constitution.rights = [];
  const doc = {
    id: 'd', type: 'order', authorId: pid, title: 'An arrest',
    clauses: [{ kind: 'ARREST', personaId: pid, charge: '' }],
  };
  const bare = CT.overreachOf(w, doc);
  w.constitution.rights = [{ ...R.RIGHTS_CATALOG.unenumerated }];
  ok('the clause reads as retained', R.retainsUnenumerated(w));
  const kept = CT.overreachOf(w, doc);
  ok('the bench can reach an act no written right touches', kept.score > bare.score,
    `${bare.score.toFixed(3)} -> ${kept.score.toFixed(3)}`);
  ok('and says so in the grounds', kept.grounds.some((g) => /retained/.test(g)), kept.grounds.join(' | '));
  // Weaker than a written right: it does not put the act beyond a wide majority.
  ok('it is not treated as an enumerated right', kept.rights === false);

  // A written right is still the stronger ground.
  w.constitution.rights = [{ ...R.RIGHTS_CATALOG.unenumerated }, { ...R.RIGHTS_CATALOG.dueProcess }];
  const written = CT.overreachOf(w, doc);
  ok('a written right outweighs a retained one', written.score > kept.score,
    `${kept.score.toFixed(3)} -> ${written.score.toFixed(3)}`);
  ok('and that one does put it beyond a majority', written.rights === true);

  // Reachable by amendment for a republic that did not found with it.
  const { w: w2 } = mk();
  w2.constitution.rights = [];
  A.CLAUSES.RIGHT.apply(w2, { name: 'Rights Retained', blocks: 'OPEN', body: '' });
  ok('an amendment can add it later', R.retainsUnenumerated(w2));
  ok('and it reads as law', /silent/.test(A.CLAUSES.RIGHT.text(w2, { blocks: 'OPEN' })),
    A.CLAUSES.RIGHT.text(w2, { blocks: 'OPEN' }).slice(0, 60));
}

// --- who answers a crisis ----------------------------------------------------
{
  const { w, pid } = mk();
  ok('the President answers', R.mayAnswerCrisis(w, pid));
  const justice = w.seats.find((s) => s.office === 'justice' && s.personaId).personaId;
  ok('a justice does not', !R.mayAnswerCrisis(w, justice));
  const member = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;
  ok('nor a member of the chamber', !R.mayAnswerCrisis(w, member));
  ok('nor nobody at all', !R.mayAnswerCrisis(w, null));

  // A notice is filed by the chair too — filing clears the card for everyone.
  D.fire(w, 'goldland');
  const ev = w.events.find((e) => !e.resolved);
  ok('a crisis is open', !!ev);
  ev.notice = true;
  ok('a justice cannot file it', D.acknowledge(w, ev.uid, justice).ok === false);
  ok('the President can', D.acknowledge(w, ev.uid, pid).ok === true);

  // The stamp is the tick it closed on, and tick 0 is a real tick — a crisis
  // answered on the republic's first second used to read as still open and
  // could be answered twice.
  const { w: w3, pid: pid3 } = mk();
  w3.clock.tick = 0;
  D.fire(w3, 'goldland');
  const ev3 = w3.events.find((e) => !e.resolved);
  const free = ev3.options.findIndex((o) => !o.cost);
  ok('answered at tick zero', D.respond(w3, ev3.uid, free, pid3).ok === true);
  ok('the stamp is truthy anyway', !!ev3.resolved, String(ev3.resolved));
  ok('and it cannot be answered twice', D.respond(w3, ev3.uid, free, pid3).ok === false);
}

// --- a pause is not history --------------------------------------------------
{
  const { w } = mk();
  const before = w.chronicle.length;
  ACT.apply(w, { type: 'TABLE_MOTION', playerId: 'p1', kind: 'pause' });
  ok('the world pauses', !!w.paused);
  ACT.apply(w, { type: 'TABLE_MOTION', playerId: 'p1', kind: 'resume' });
  ok('and resumes', !w.paused);
  ok('with nothing written down', w.chronicle.length === before,
    w.chronicle.slice(before).map((e) => e.text).join(' | '));
  // Wiping the Season still is history — it is a fact about the Season.
  ACT.apply(w, { type: 'TABLE_MOTION', playerId: 'p1', kind: 'reset' });
  ok('but a wipe is', w.chronicle.length > before,
    w.chronicle.slice(before).map((e) => e.text).join(' | '));
}

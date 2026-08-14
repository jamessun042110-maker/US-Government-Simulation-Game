// An administration bill is the government's own record. Carrying it lifts the
// President's standing; losing it on the floor costs them. A bill introduced by
// an ordinary legislator does neither — and the Chronicle names which is which.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};
const assemblyVote = (w, docId, ballot) => {
  for (const s of w.seats.filter((x) => x.office === 'assembly' && x.personaId)) A.castVote(w, docId, s.personaId, ballot);
};
const resultLog = (w, title) => [...w.chronicle].reverse()
  .find((e) => e.kind === 'vote' && e.text.includes(title) && /(passes|fails)/.test(e.text))?.text || '';

// The President authors it → an administration bill.
ok('the President authors an administration bill', true);
{
  const { w, pid } = mk();
  const pres = w.personas[pid];
  const doc = A.createDoc(w, { type: 'bill', title: 'The Administration Act', authorId: pid, clauses: [{ kind: 'PROSE', text: 'Whereas the government wills it.' }] });
  ok('it reads as an administration bill', R.isAdministrationBill(w, doc) === true);
  A.introduce(w, doc.id, pid, 20);
  assemblyVote(w, doc.id, 'yea');
  const before = pres.approval;
  A.closeFloor(w, doc.id);
  ok('carrying it lifts the President', pres.approval > before, `${before.toFixed(2)} → ${pres.approval.toFixed(2)}`);
  ok('and the record names it an administration bill', /administration bill/i.test(resultLog(w, "The Administration Act")), resultLog(w, "The Administration Act"));
}
{
  const { w, pid } = mk();
  const pres = w.personas[pid];
  const doc = A.createDoc(w, { type: 'bill', title: 'The Doomed Act', authorId: pid, clauses: [{ kind: 'PROSE', text: 'Whereas the government wills it.' }] });
  A.introduce(w, doc.id, pid, 20);
  assemblyVote(w, doc.id, 'nay');
  const before = pres.approval;
  A.closeFloor(w, doc.id);
  ok('a bill defeated on the floor fails', doc.status === 'failed', doc.status);
  ok('losing it costs the President', pres.approval < before, `${before.toFixed(2)} → ${pres.approval.toFixed(2)}`);
}
{
  // A legislator's bill: authored by a seated assembly member, not the President.
  const { w, pid } = mk();
  const pres = w.personas[pid];
  const legSeat = w.seats.find((s) => s.office === 'assembly' && s.personaId);
  const leg = legSeat.personaId;
  ok('the author is not the head of government', leg !== pid);
  const doc = A.createDoc(w, { type: 'bill', title: 'A Private Member Act', authorId: leg, clauses: [{ kind: 'PROSE', text: 'Whereas a member wills it.' }] });
  ok('it is not an administration bill', R.isAdministrationBill(w, doc) === false);
  A.introduce(w, doc.id, leg, 20);
  assemblyVote(w, doc.id, 'yea');
  const before = pres.approval;
  A.closeFloor(w, doc.id);
  ok("a legislator's bill passing does not move the President", pres.approval === before, `${before.toFixed(2)} → ${pres.approval.toFixed(2)}`);
  ok('and the record marks it a bill from the floor', /introduced on the floor/i.test(resultLog(w, "A Private Member Act")), resultLog(w, "A Private Member Act"));
}
{
  // A crisis the executive cannot fund alone, referred to the chamber from the
  // Nation tab: the President drafts it, so it is the administration's bill and
  // carries the administration's credit. This is the exact case reported from
  // play — "The bottom falls out — appropriation" read as nobody's bill.
  const { w, pid } = mk();
  const pres = w.personas[pid];
  const DIR = await import(base + 'director.js');
  DIR.fire(w, 'recession');
  const ev = w.events.find((e) => e.id === 'recession');
  const costed = ev.options.find((o) => o.cost);
  ACT.apply(w, { type: 'CREATE_DOC', playerId: 'p1', introduce: true, doc: {
    type: 'bill', title: `${ev.title} — appropriation`,
    preamble: 'Whereas the crisis requires an answer the executive cannot fund alone.',
    clauses: [{ kind: 'APPROPRIATE', amount: costed.cost, purpose: `${ev.title}: ${costed.label}` }],
    answers: { evUid: ev.uid, option: costed.i },
  } });
  const bill = Object.values(w.documents).at(-1);
  ok('a referred crisis appropriation is the President\'s bill', bill.authorId === pid, bill.title);
  ok('and reads as an administration bill', R.isAdministrationBill(w, bill) === true);
  const before = pres.approval;
  assemblyVote(w, bill.id, 'yea');
  A.closeFloor(w, bill.id);
  ok('so carrying it credits the administration', pres.approval > before, `${before.toFixed(2)} → ${pres.approval.toFixed(2)}`);
  ok('and the record says so', /administration bill/i.test(resultLog(w, bill.title)), resultLog(w, bill.title));
}

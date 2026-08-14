// The strike crisis carries a fourth answer: refer a cut to the assembly.
//
// An executive without the tax power was previously left with three options
// that either exercised a power they did not hold or made things worse; the
// referral is the way a bill gets written for a crisis rather than a power
// grab used to answer one.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const D = await import(base + 'director.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
const seat = w.seats.find((s) => s.office === 'president');
seat.personaId = pid; seat.since = 0;

const rate = w.economy.taxes.income;

// Open the strike card by hand and answer it with the referral option (index 1
// now — the negotiate option is at 0, and the two new options push the old
// break/wait down to 2 and 3).
const ev = D.notice ? null : null;                              // no-op, keeps linter happy
const openEv = {
  uid: 'ev_strike', id: 'strike', title: 'The yards stop',
  text: 'the strike',
  options: [], opened: w.clock.tick, deadline: w.clock.tick + 100,
  resolved: null, resolvedBy: null, choice: null,
};
w.events.push(openEv);

const res = D.respond(w, openEv.uid, 1, pid);
ok('the referral answers', res.ok === true, res.reason || '');
ok('the rate does not move — nothing has been passed yet', w.economy.taxes.income === rate,
  `${(rate*100).toFixed(2)}% -> ${(w.economy.taxes.income*100).toFixed(2)}%`);
const docs = Object.values(w.documents || {});
const bill = docs.find((d) => /Ironside/.test(d.title));
ok('a bill is on the floor', !!bill && bill.status === 'floor', bill ? bill.status : 'none');
const cut = (bill?.clauses || []).find((c) => c.kind === 'SET_TAX' && c.tax === 'income');
ok('and it carries a one-point cut to income tax', cut && Math.abs((rate * 100) - cut.rate - 1) < 1e-9,
  cut ? `${(rate*100).toFixed(1)} -> ${cut.rate}` : 'no clause');
ok('the crisis card is closed', !!w.events.find((e) => e.uid === openEv.uid).resolved);

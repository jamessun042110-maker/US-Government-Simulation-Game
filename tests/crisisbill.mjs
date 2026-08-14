const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const D = await import(base + 'director.js');
const ACT = await import(base + 'actions.js');
const ok = (l,c,x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase='live'; w.inaugurated=0;
  const pid = w.players.p1.personaId;
  w.seats.find(s => s.office === 'president').personaId = pid;
  return { w, pid };
};

// --- 9: no unilateral tax cut on the yards-stop card ------------------------
// The card once offered "Negotiate — cut income tax 1pt", gated on the tax
// power. It no longer offers any unilateral cut at all: the rate is the
// chamber's to set, and relief comes only by declaring an emergency or by
// referring a cut to the assembly. See director.js EVENTS 'strike'.
{
  const { w, pid } = mk();
  const strike = D.EVENTS.find(e => e.id === 'strike');
  ok('the strike crisis exists', !!strike, strike?.title);
  ok('no option cuts income tax by the executive\'s own hand',
    !strike.options.some(o => /cut income tax|negotiate/i.test(o.label)),
    strike.options.map(o => o.label).join(' | '));
  ok('no option exercises the tax power directly',
    !strike.options.some(o => o.power === 'tax'));
  ok('declaring an emergency is on the card', strike.options.some(o => /declare a state of emergency/i.test(o.label)));
  ok('referring a cut to the assembly is on the card', strike.options.some(o => /refer .*assembly/i.test(o.label)));
}
// Answering a crisis is an act of the chair, whoever else holds a power. The
// emergency option is put to the President; a member and a justice are refused.
{
  const { w, pid } = mk();
  D.fire(w, 'strike');
  const ev = w.events.find(e => e.id === 'strike');
  const emIdx = D.EVENTS.find(e => e.id === 'strike').options.findIndex(o => /declare a state of emergency/i.test(o.label));

  const member = w.seats.find(s => s.office === 'assembly' && s.personaId)?.personaId;
  ok('a member does not answer for the republic', !R.mayAnswerCrisis(w, member));
  const r2 = D.respond(w, ev.uid, emIdx, member);
  ok('so the card refuses a member', r2.ok === false, (r2.reason||'').slice(0, 80));
  ok('for want of the chair', /do not hold that office/.test(r2.reason || ''), r2.reason);
  ok('and the crisis is still open', ev.resolved == null);

  // A justice is further from it still — this is the one that was found in play.
  const justice = w.seats.find(s => s.office === 'justice' && s.personaId)?.personaId;
  const free = D.EVENTS.find(e => e.id === 'strike').options.findIndex(o => !o.cost && !o.power);
  ok('the strike has an answer that costs nothing', free >= 0, String(free));
  const r3 = D.respond(w, ev.uid, free, justice);
  ok('a justice cannot answer even the free option', r3.ok === false, (r3.reason||'').slice(0, 80));
  ok('and the president still can', D.respond(w, ev.uid, free, pid).ok === true);
  // `!= null`: the stamp is the tick it closed on, and tick 0 is a real tick.
  ok('which closes it', ev.resolved != null, String(ev.resolved));
}

// --- 10: the bill straight to the floor -------------------------------------
{
  const { w, pid } = mk();
  D.fire(w, 'recession');
  const ev = w.events.find(e => e.id === 'recession');
  const costed = ev.options.find(o => o.cost);
  ok('the crisis has a costed option', !!costed, `${costed?.label} @ ${costed?.cost}`);

  const before = Object.keys(w.documents).length;
  ACT.apply(w, {
    type: 'CREATE_DOC', playerId: 'p1', introduce: true,
    doc: {
      type: 'bill', title: `${ev.title} — appropriation`,
      preamble: 'Whereas the crisis requires an answer the executive cannot fund alone.',
      clauses: [{ kind: 'APPROPRIATE', amount: costed.cost, purpose: `${ev.title}: ${costed.label}` }],
    },
  });
  const docs = Object.values(w.documents);
  ok('a bill is drafted', docs.length === before + 1, `${docs.length} documents`);
  const bill = docs[docs.length - 1];
  ok('for the right money', bill.clauses[0].amount === costed.cost, String(bill.clauses[0].amount));
  ok('and it is on the floor', bill.status === 'floor', bill.status);
  ok('the chamber can vote on it', !!w.documents[bill.id]);
}

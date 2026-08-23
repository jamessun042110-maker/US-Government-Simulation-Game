// Each party holds an ideology across the legislation the chamber sees, and its
// members vote it: Democrats for spending, taxes to fund it, and rights;
// Republicans against those and for a hawkish, order-first line. Measured as
// the gap in support between a pure-Democratic and a pure-Republican chamber
// reading the same bill from a neutral, party-less author (so the only thing
// moving the vote is the party line, not the whip or the sponsor).
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic' });
const author = W.makePersona(w, { synthetic: true, party: null }); // independent → no whip, no colleague bonus
author.approval = 50; author.age = 45; author.born = w.clock.tick;

// A chamber of one party, none of them seated (so no district colours the read).
const chamberOf = (party, n = 400) => {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const m = W.makePersona(w, { synthetic: true, party });
    m.approval = 50; ms.push(m);
  }
  return ms;
};
const libs = chamberOf('democrat');
const cons = chamberOf('republican');
const support = (members, doc) => members.filter((m) => S.syntheticBallot(w, m, doc) === 'yea').length;
const doc = (clauses) => ({ id: 'doc_ideo', type: 'bill', authorId: author.id, preamble: '', clauses });

// Income tax is low to begin with, so this is unambiguously a rise.
w.economy.taxes.income = 0.1;
const taxRaise = doc([{ kind: 'SET_TAX', tax: 'income', rate: 60 }]);
const spend = doc([{ kind: 'APPROPRIATE', amount: 1000 }]);
const right = doc([{ kind: 'RIGHT', text: 'A right to counsel.' }]);
const war = doc([{ kind: 'DECLARE_WAR', party: (w.foreign || [])[0]?.id }]);

const libTax = support(libs, taxRaise), conTax = support(cons, taxRaise);
ok('Democrats back a tax rise more than Republicans', libTax > conTax, `${libTax} vs ${conTax}`);

const libSpend = support(libs, spend), conSpend = support(cons, spend);
ok('Democrats back spending more than Republicans', libSpend > conSpend, `${libSpend} vs ${conSpend}`);

const libRight = support(libs, right), conRight = support(cons, right);
ok('Democrats back a new right more than Republicans', libRight > conRight, `${libRight} vs ${conRight}`);

const libWar = support(libs, war), conWar = support(cons, war);
ok('Republicans back a war more than Democrats', conWar > libWar, `${conWar} vs ${libWar}`);

// The two parties genuinely differ — the lines are not the same line.
ok('the parties vote differently across the board',
  libTax !== conTax && libSpend !== conSpend && libRight !== conRight && libWar !== conWar);

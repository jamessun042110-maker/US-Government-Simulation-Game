// Whose friend the company was.
//
// `bailout` would catch anybody's company. That is right — a government should
// not be barred from saving four hundred jobs because the founder once gave to a
// party — but it was the *whole* rule, which left the most obvious corruption in
// this republic free of charge: fund the campaign, take the chair, sign the
// cheque back. Nothing in the world connected the three, so the country could
// not be angry about it and the court had no cause of action to hear.
//
// Nothing here forbids a rescue. It finds the connection, prices it, and hands
// the court something it can weigh.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const CO = await import(base + 'company.js');
const CT = await import(base + 'court.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  w.constitution.spending = [{ above: 0, requires: null }];
  w.constitution.discretion = { cap: 4e8, years: 1 };
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};

let nth = 0;
const sinking = (w, { staff = 60, unpaid = 4e6 } = {}) => {
  const founder = Object.values(w.personas).filter((x) => !x.playerId && x.alive)[nth++ % 40];
  const co = CO.found(w, founder.id, 'Kiln & Yard ' + nth, null, 'industry').company;
  co.employees = Array.from({ length: staff }, (_, i) => 'e' + i);
  co.cash = 0; co.unpaid = unpaid; co.revenue = 2e6; co.valuation = 5e6;
  CO.tickDistress(w, co);
  return co;
};

// --- A rescue with nothing behind it is a rescue -----------------------------
{
  const w = mk();
  const me = w.players.p1.personaId;
  const co = sinking(w);
  const found = A.bailoutInterest(w, me, co);
  ok('a company that has given nobody anything is nobody\'s friend',
    found.conflicted === false && found.weight === 0, JSON.stringify(found));
  const res = A.bailout(w, me, co.id, 5e6);
  ok('and catching it is an ordinary act of government', res.ok === true, res.reason || '');
  ok('the record says so', w.rescues.length === 1 && w.rescues[0].interest === null);
}

// --- Money that came back the other way --------------------------------------
{
  const w = mk();
  const me = w.players.p1.personaId;
  const co = sinking(w);
  co.cash = 20e6; co.valuation = 6e7;   // out of the basement, so it may give
  CO.donateCampaign(w, co, co.founderId, me, 8e6);
  co.cash = 0;
  CO.tickDistress(w, co);

  const found = A.bailoutInterest(w, me, co);
  ok('a company that funded the campaign is not a stranger', found.conflicted === true);
  ok('and the ground names the money', /put .* behind the campaign/.test(found.grounds.join(' ')),
    found.grounds.join(' | '));
  ok('the donation is on the record with a donor on it',
    (w.donations || []).some((d) => d.companyId === co.id && d.candidateId === me && d.amount === 8e6));

  // The country is angrier about this one than about the same rescue clean.
  const clean = A.bailoutMood(w, co, null);
  const dirty = A.bailoutMood(w, co, found);
  ok('and the country minds it more', dirty < clean, `${clean.toFixed(2)} → ${dirty.toFixed(2)}`);

  const res = A.bailout(w, me, co.id, 5e6);
  ok('the rescue still happens — this forbids nothing', res.ok === true, res.reason || '');
  ok('but it is written down as what it was',
    w.rescues[0].interest && w.rescues[0].interest.weight > 0);
  ok('and the Chronicle says it out loud, in the line about the money',
    w.chronicle.some((e) => /not a disinterested rescue/.test(e.text)),
    w.chronicle.filter((e) => /public money/.test(e.text)).map((e) => e.text).join(' | ').slice(0, 200));
}

// --- Money to think about a bill ---------------------------------------------
{
  const w = mk();
  const me = w.players.p1.personaId;
  const co = sinking(w);
  const person = w.personas[me];
  person.lobbiedBy = [{ tick: w.clock.tick, company: co.id, name: co.name, docId: 'doc_x', amount: 4e5 }];
  const found = A.bailoutInterest(w, me, co);
  ok('a company that paid the signer to think about a bill is not a stranger either',
    found.conflicted === true && /paid/.test(found.grounds.join(' ')), found.grounds.join(' | '));

  // And it goes stale. A connection six years old is not a connection.
  w.clock.tick += A.INTEREST_YEARS * w.clock.ticksPerYear + 1;
  ok('but not for ever', A.bailoutInterest(w, me, co).conflicted === false);
}

// --- Family -------------------------------------------------------------------
{
  const w = mk();
  const me = w.players.p1.personaId;
  const co = sinking(w);
  w.personas[co.founderId].lineage = w.personas[me].lineage;
  const found = A.bailoutInterest(w, me, co);
  ok('and neither is a relative', found.conflicted === true && /family/.test(found.grounds.join(' ')));
}

// --- The court has somewhere to stand ----------------------------------------
{
  const w = mk();
  const me = w.players.p1.personaId;
  const claim = CT.CLAIMS.public_money_private_interest;
  const citizen = Object.values(w.personas).find((x) => x.alive && !x.playerId && x.id !== me);

  const noneYet = claim.weigh(w, citizen, w.personas[me]);
  ok('somebody who has rescued nothing has a claim that goes nowhere', noneYet.score < 0.1,
    String(noneYet.score));

  const clean = sinking(w, { staff: 300 });
  A.bailout(w, me, clean.id, 3e6);
  const afterClean = claim.weigh(w, citizen, w.personas[me]);
  ok('nor does an honest rescue of three hundred jobs', afterClean.score < 0.2,
    `${afterClean.score.toFixed(2)} | ${afterClean.grounds.join(' | ')}`);

  const friend = sinking(w, { staff: 8 });
  friend.cash = 20e6; friend.valuation = 6e7;
  CO.donateCampaign(w, friend, friend.founderId, me, 9e6);
  friend.cash = 0; CO.tickDistress(w, friend);
  A.bailout(w, me, friend.id, 3e6);

  const after = claim.weigh(w, citizen, w.personas[me]);
  ok('but eight jobs at a donor\'s company does', after.score > afterClean.score + 0.25,
    `${afterClean.score.toFixed(2)} → ${after.score.toFixed(2)}`);
  ok('and the grounds are the record, not the pleading',
    after.grounds.some((g) => /behind the campaign/.test(g)) && after.grounds.some((g) => /people worked there|person worked there/.test(g)),
    after.grounds.join(' | '));
  ok('a claim can actually be filed on it', (() => {
    const bench = CT.justices(w);
    if (!bench.length) w.seats.find((s) => s.office === 'justice').personaId = citizen.id;
    const r = CT.fileSuit(w, w.personas[me].id === citizen.id ? null : citizen.id, me,
      'public_money_private_interest', 'He signed our money over to the people who paid for his campaign.');
    return r.ok === true;
  })());
  ok('and it never rises to a certainty on the record alone', after.score <= 1);
}

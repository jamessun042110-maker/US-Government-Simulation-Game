// Age in politics. A political life is reckoned from eighteen: you must be that
// old to hold the head office, and every age effect measures from that floor.
// Younger politicians arrive a shade better liked, take praise harder, and have
// a thinner book of favours in the chamber.
const base = new URL('../js/', import.meta.url).href;
const U = await import(base + 'util.js');
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const S = await import(base + 'sim.js');
const M = await import(base + 'media.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => W.newWorld({ nation: 'The Silver Republic' });
// A persona of exactly this age, born now (so currentAge === age), at a fixed
// approval unless we are measuring approval itself.
const aged = (w, age, { party = 'liberal', approval = 50 } = {}) => {
  const p = W.makePersona(w, { synthetic: true, party });
  p.age = age; p.born = w.clock.tick; p.approval = approval;
  return p;
};

// --- the base age and the youth curve -----------------------------------------
ok('the base age is eighteen', U.POLITICAL_BASE_AGE === 18, String(U.POLITICAL_BASE_AGE));
{
  const w = mk();
  ok('youth is full at the base age', Math.abs(U.youthOf(w, aged(w, 18)) - 1) < 1e-9);
  ok('youth is gone a working lifetime later',
    U.youthOf(w, aged(w, 18 + U.POLITICAL_YOUTH_SPAN)) === 0);
  ok('and never runs negative', U.youthOf(w, aged(w, 95)) === 0);
  ok('the middle-aged fall in between', U.youthOf(w, aged(w, 41)) > 0 && U.youthOf(w, aged(w, 41)) < 1);
}

// --- current age advances with the clock --------------------------------------
{
  const w = mk();
  const p = W.makePersona(w, { synthetic: true });
  p.age = 30; p.born = 0;
  w.clock.tick = 2 * w.clock.ticksPerYear;
  ok('current age counts the years since the record opened', U.currentAge(w, p) === 32, String(U.currentAge(w, p)));
}

// --- younger politicians start a shade better liked ---------------------------
{
  const w = mk();
  // The starting approval world.js writes, for a persona of a given age.
  const at = (age) => { const p = W.makePersona(w, { synthetic: true }); p.age = age; p.born = w.clock.tick; return U.clamp(50 + U.YOUTH_APPROVAL * U.youthOf(w, p), 0, 100); };
  ok('an eighteen-year-old opens above fifty', at(18) > 50, at(18).toFixed(2));
  ok('and above a sixty-year-old', at(18) > at(60), `${at(18).toFixed(2)} vs ${at(60).toFixed(2)}`);
  ok('the bump is slight, not decisive', at(18) - 50 <= 5, (at(18) - 50).toFixed(2));
  // makePersona itself: whatever age it rolls, the approval it writes must be
  // the youth-scaled starting value for that same age.
  let matched = true;
  for (let i = 0; i < 50; i++) {
    const p = W.makePersona(w, { synthetic: true });
    const want = U.clamp(50 + U.YOUTH_APPROVAL * U.youthOf(w, p), 0, 100);
    if (Math.abs(p.approval - want) > 1e-9) matched = false;
  }
  ok('makePersona writes a youth-scaled starting approval', matched);
}

// --- eighteen to be president -------------------------------------------------
{
  const w = mk();
  const head = R.headOffice(w);
  ok('there is a head office to gate', !!head, head?.id);
  const under = aged(w, 16); const at = aged(w, 18); const grown = aged(w, 40);
  ok('a sixteen-year-old may not hold the head office', R.mayHoldAgain(w, under.id, head.id).ok === false);
  ok('an eighteen-year-old may', R.mayHoldAgain(w, at.id, head.id).ok === true);
  ok('and so may the middle-aged', R.mayHoldAgain(w, grown.id, head.id).ok === true);
  // The gate is the head office only — a lesser office has no age of majority here.
  const other = w.constitution.offices.find((o) => o.id !== head.id);
  if (other) ok('a lesser office is not age-gated', R.mayHoldAgain(w, under.id, other.id).ok === true, other.id);
}

// --- more receptive to praise -------------------------------------------------
{
  const w = mk();
  const write = (age) => {
    const target = aged(w, age, { approval: 50 });
    const outlet = M.foundOutlet(w, { name: `Paper ${age}`, ownerPersonaId: target.id }).value
      || (w.media.outlets || []).find((o) => o.ownerPersonaId === target.id);
    const before = target.approval;
    M.publish(w, { outletId: outlet.id, authorId: target.id, angle: 'praise',
      headline: 'A steady hand at the tiller', body: 'Praise, warmly meant and widely shared across the whole of the republic.',
      targetType: 'persona', targetId: target.id });
    return target.approval - before;
  };
  const youngGain = write(18);
  const oldGain = write(62);
  ok('praise lifts a young figure', youngGain > 0, youngGain.toFixed(3));
  ok('and lifts them more than an older one', youngGain > oldGain + 1e-6,
    `${youngGain.toFixed(3)} vs ${oldGain.toFixed(3)}`);
}

// --- weaker connections in the chamber ----------------------------------------
{
  // A chamber of same-party members reads the same spending bill from a young
  // author and an old one; everything is identical but the author's age, so any
  // gap in the yea count is the thinner book of favours the young author has.
  const w = mk();
  const doc = (authorId) => ({ id: 'doc_conn', type: 'bill', authorId, preamble: '',
    clauses: [{ kind: 'APPROPRIATE', amount: 1000 }] });
  const young = aged(w, 18, { party: 'liberal', approval: 50 });
  const old = aged(w, 64, { party: 'liberal', approval: 50 });
  // One fixed chamber, read twice — only the author's age differs.
  //
  // Twelve hundred, not four. The claim below is a strict inequality on a
  // count, and at four hundred members the two readings sit around 379 apiece:
  // the chamber is near enough saturated that the connection penalty has only a
  // handful of votes left to move, and about one run in a hundred they came out
  // dead level and "strictly fewer" failed on a tie. The effect is real and the
  // sample was just too small to see it — widen the chamber and the margin goes
  // from a few votes to a couple of dozen, which is what a strict inequality
  // needs under it.
  const members = [];
  for (let i = 0; i < 1200; i++) {
    const m = W.makePersona(w, { synthetic: true, party: 'liberal' });
    m.approval = 50; members.push(m);
  }
  const carry = (author) => members.filter((m) => S.syntheticBallot(w, m, doc(author.id)) === 'yea').length;
  const youngYea = carry(young);
  const oldYea = carry(old);
  ok('a young author carries no more of the chamber than an old one',
    youngYea <= oldYea, `${youngYea} vs ${oldYea}`);
  ok('and carries strictly fewer in aggregate', youngYea < oldYea, `${youngYea} vs ${oldYea}`);
}

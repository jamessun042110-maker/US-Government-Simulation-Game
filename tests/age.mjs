// Age in politics. A political life is reckoned from eighteen — every age effect
// measures from that floor — but holding office asks for more than that, and how
// much more is the constitution's business: twenty-five for the House, thirty
// for the Senate, thirty-five for the President and, by the Twelfth Amendment,
// the same thirty-five for the Vice President.
//
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
const aged = (w, age, { party = 'democrat', approval = 50 } = {}) => {
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

// --- the constitution's age for each office -----------------------------------
{
  const w = mk();
  const head = R.headOffice(w);
  ok('there is a head office to gate', !!head, head?.id);

  // The four the document actually sets.
  const WANT = { assembly: 25, senate: 30, president: 35, vp: 35 };
  for (const [id, want] of Object.entries(WANT)) {
    const o = R.office(w, id);
    if (!o) { ok(`the constitution has a ${id}`, false, 'missing'); continue; }
    ok(`the ${o.name} asks for ${want}`, R.minAgeFor(w, id) === want, String(R.minAgeFor(w, id)));
  }
  // The Twelfth Amendment's rule, stated as the test of it: whatever the
  // President's floor is, the Vice President's is the same number.
  ok('the Vice President carries the President\u2019s own floor',
    R.minAgeFor(w, 'vp') === R.minAgeFor(w, 'president'),
    `${R.minAgeFor(w, 'vp')} vs ${R.minAgeFor(w, 'president')}`);

  // A year either side of each bar, at the bar itself and one below it.
  for (const [id, want] of Object.entries(WANT)) {
    if (!R.office(w, id)) continue;
    const below = aged(w, want - 1);
    const at = aged(w, want);
    ok(`${want - 1} is too young for the ${id}`, R.mayHoldAgain(w, below.id, id).ok === false);
    ok(`${want} is old enough for the ${id}`, R.mayHoldAgain(w, at.id, id).ok === true);
  }

  // Eighteen is still the floor under everything: an office the document sets no
  // age for takes the age of majority and nothing more.
  const unset = w.constitution.offices.find((o) => !o.minAge);
  if (unset) {
    ok('an office with no stated age falls back to majority',
      R.minAgeFor(w, unset.id) === U.POLITICAL_BASE_AGE, `${unset.id}: ${R.minAgeFor(w, unset.id)}`);
    ok('and a sixteen-year-old still may not hold it',
      R.mayHoldAgain(w, aged(w, 16).id, unset.id).ok === false, unset.id);
  }

  // Age expires; a spent term limit does not. Somebody barred today is eligible
  // the year they grow into it, and the check has to be asked fresh to see that.
  const youth = aged(w, 30);
  ok('a thirty-year-old may not be President today', R.mayHoldAgain(w, youth.id, 'president').ok === false);
  w.clock.tick += 5 * w.clock.ticksPerYear;
  ok('and may five years later, having aged into it',
    R.mayHoldAgain(w, youth.id, 'president').ok === true, String(U.currentAge(w, youth)));
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
  const young = aged(w, 18, { party: 'democrat', approval: 50 });
  const old = aged(w, 64, { party: 'democrat', approval: 50 });
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
    const m = W.makePersona(w, { synthetic: true, party: 'democrat' });
    m.approval = 50; members.push(m);
  }
  const carry = (author) => members.filter((m) => S.syntheticBallot(w, m, doc(author.id)) === 'yea').length;
  const youngYea = carry(young);
  const oldYea = carry(old);
  ok('a young author carries no more of the chamber than an old one',
    youngYea <= oldYea, `${youngYea} vs ${oldYea}`);
  ok('and carries strictly fewer in aggregate', youngYea < oldYea, `${youngYea} vs ${oldYea}`);
}

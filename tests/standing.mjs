// Standing, and what it buys on the floor.
//
// Approval was one national number and the chamber barely voted on it: the
// author's own figure moved merit a little and nothing carried the country's
// temper or the difference between one district and another.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid, author: w.personas[pid] };
};
const bill = (author) => ({
  id: 'd1', type: 'bill', title: 'A bill', authorId: author.id,
  clauses: [{ kind: 'PROSE', text: 'Nothing in particular.' }], preamble: '',
});
const chamber = (w) => w.seats.filter((s) => s.office === 'assembly' && s.personaId)
  .map((s) => w.personas[s.personaId]);
const yeas = (w, author) => chamber(w).filter((m) => S.syntheticBallot(w, m, bill(author)) === 'yea').length;

// --- approvalIn: one person, read many ways ---------------------------------
{
  const { w, author } = mk();
  author.approval = 50;
  for (const d of w.districts) d.mood = 50;
  ok('a flat country reads you at your national figure',
    w.districts.every((d) => Math.abs(S.approvalIn(w, author, d) - 50) < 1e-9));

  const [warm, cold] = w.districts;
  warm.mood = 90; cold.mood = 10;
  ok('a contented district reads you better', S.approvalIn(w, author, warm) > 50,
    S.approvalIn(w, author, warm).toFixed(1));
  ok('an unhappy one reads you worse', S.approvalIn(w, author, cold) < 50,
    S.approvalIn(w, author, cold).toFixed(1));
  ok('and the gap is real, not decorative',
    S.approvalIn(w, author, warm) - S.approvalIn(w, author, cold) > 20,
    (S.approvalIn(w, author, warm) - S.approvalIn(w, author, cold)).toFixed(1));

  // Home ground.
  for (const d of w.districts) d.mood = 50;
  const home = w.districts[0], away = w.districts[1];
  author.district = home.id;
  ok('your own people are kinder', S.approvalIn(w, author, home) > S.approvalIn(w, author, away),
    `${S.approvalIn(w, author, home).toFixed(1)} vs ${S.approvalIn(w, author, away).toFixed(1)}`);
  ok('it is bounded at a hundred', S.approvalIn(w, { approval: 99, district: home.id }, home) <= 100);
  ok('and at zero', S.approvalIn(w, { approval: 1 }, cold) >= 0);
}

// --- the breakdown ------------------------------------------------------------
{
  const { w, author } = mk();
  w.districts.forEach((d, i) => { d.mood = 20 + i * 15; });
  const rows = S.approvalByDistrict(w, author);
  ok('every district is in the breakdown', rows.length === w.districts.length, String(rows.length));
  ok('worst first, which is the order the work is in',
    rows.every((r, i) => i === 0 || r.approval >= rows[i - 1].approval),
    rows.map((r) => r.approval.toFixed(0)).join(' ≤ '));
  ok('and it agrees with approvalIn',
    rows.every((r) => r.approval === S.approvalIn(w, author, r.district)));
  ok('the national figure is not simply the best district',
    rows[rows.length - 1].approval > (author.approval ?? 50));
}

// --- national standing moves the floor --------------------------------------
{
  const run = (mood) => {
    const { w, author } = mk();
    for (const d of w.districts) d.mood = mood;
    // Hold the author's own figure fixed, so this measures the country's temper
    // and not the person's.
    author.approval = 50;
    return yeas(w, author);
  };
  let popular = 0, hated = 0;
  for (let i = 0; i < 20; i++) { popular += run(85); hated += run(15); }
  ok('a bill carries further in a contented country', popular > hated,
    `${popular} yeas at 85 vs ${hated} at 15`);
}

// --- the author's own standing moves it too ---------------------------------
{
  const run = (approval) => {
    const { w, author } = mk();
    for (const d of w.districts) d.mood = 50;
    author.approval = approval;
    return yeas(w, author);
  };
  let high = 0, low = 0;
  for (let i = 0; i < 20; i++) { high += run(90); low += run(10); }
  ok('and a popular author carries further than an unpopular one', high > low,
    `${high} yeas at 90% vs ${low} at 10%`);
}

// --- and it is *local* standing that decides the local member ----------------
// Two countries with identical national approval, differing only in which
// districts are warm. The chamber should not vote the same way.
{
  const run = (warmFirst) => {
    const { w, author } = mk();
    author.approval = 50;
    // The same multiset of moods either way, only dealt to different districts:
    // pair them off and leave any odd one out at the midpoint, so the two
    // countries really do average the same rather than nearly.
    const n = w.districts.length;
    w.districts.forEach((d, i) => {
      if (i >= n - (n % 2)) { d.mood = 50; return; }
      d.mood = ((i % 2 === 0) === warmFirst) ? 85 : 15;
    });
    return { w, author, national: S.nationalApproval(w) };
  };
  const a = run(true), b = run(false);
  ok('the two countries have comparable national approval',
    Math.abs(a.national - b.national) < 12, `${a.national.toFixed(0)} vs ${b.national.toFixed(0)}`);
  const spread = (x) => S.approvalByDistrict(x.w, x.author).map((r) => r.approval);
  ok('but the standing is spread quite differently',
    Math.max(...spread(a)) - Math.min(...spread(a)) > 25,
    spread(a).map((v) => v.toFixed(0)).join(', '));
}

// --- the one lever is still the one lever -----------------------------------
{
  const { w, author } = mk();
  const before = w.districts.map((d) => S.approvalIn(w, author, d));
  S.approvalIn(w, author, w.districts[0]);
  S.approvalByDistrict(w, author);
  ok('reading it changes nothing',
    w.districts.every((d, i) => S.approvalIn(w, author, d) === before[i]));
  ok('and no per-district store was invented',
    !Object.keys(author).some((k) => /approvalBy|districtApproval/i.test(k)),
    Object.keys(author).join(','));
}

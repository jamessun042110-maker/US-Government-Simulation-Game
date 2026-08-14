// The article's register, and the two things that revise it after office.
//
// The bios read like a filing rather than an encyclopaedia entry: on
// first-name terms with their subject, one fact per sentence, and a bare score
// where a verdict should be. See docs/presidential-article-reference.md.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const M = await import(base + 'media.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const flat = (a) => (!a ? '' : typeof a === 'string' ? a
  : [a.lede, ...(a.sections || []).flatMap((x) => [x.h, ...x.p])].join(' '));
// One paragraph now; a heading lookup falls through to the whole body. See the
// note in biodates.mjs. "Origins come before the career" still holds because
// the body opens with them — the ordering was always the real claim.
const sect = (bio, h) => (bio.sections || []).find((s) => s.h === h)?.p.join(' ')
  || bio.body || (bio.sections || []).flatMap((s) => s.p).join(' ') || '';

// A president who served, left, and can be written about.
const served = (name = 'Ann Marchetti') => {
  const w = W.newWorld({ nation: 'Testland', founder: name });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;
  for (let i = 0; i < 200; i++) S.tick(w);
  w.clock.tick = 4 * w.clock.ticksPerYear;
  A.vacate(w, seat, 'term ended');
  return { w, pid, seat };
};

// --- the register --------------------------------------------------------------
{
  const { w, pid } = served('Ann Marchetti');
  const bio = w.bios[pid].text;
  const text = flat(bio);

  ok('the article is on surname terms with its subject',
    /\bMarchetti\b/.test(text), text.slice(0, 90));
  ok('and never on first-name terms', !/\bAnn (took|sat|signed|answered|was named|put)\b/.test(text),
    (text.match(/\bAnn \w+/g) || []).slice(0, 3).join(', ') || 'none');
  ok('the lede names the office and the span',
    /was the \S+ President of Testland, serving /.test(bio.lede), bio.lede.slice(0, 120));
  ok('origins come before the career', sect(bio, 'Early life and career').startsWith('Born in'),
    sect(bio, 'Early life and career').slice(0, 60));
  ok('and it uses a pronoun rather than repeating the name',
    /\b(He|She|They) (sat|held)\b/.test(sect(bio, 'Early life and career')),
    sect(bio, 'Early life and career'));

  // The verdict is attributed, never in the article's own voice.
  const assess = sect(bio, 'Assessment');
  // Anchored to the start of its own sentence rather than of a section, now
  // that there are no sections. The claim is the same one: the verdict arrives
  // attributed, and never in the article's own voice.
  ok('the verdict is attributed to historians', /(^|\. )Historians of Testland rank /.test(assess),
    (assess.match(/[^.]*Historians[^.]*\./) || ['not found'])[0]);
  ok('and places them in a field rather than giving a bare score',
    /(upper tier|above-average|average|below-average|among the worst)/.test(assess), assess);
  ok('the article never says good or bad in its own voice',
    !/\b(was a great|was a bad|was a poor) /.test(text));
}

// A single crisis is named, not "among them" one thing.
{
  const { w, pid } = served();
  const cr = sect(w.bios[pid].text, 'Crises');
  ok('one crisis is not "among them"', !/a single crisis from the chair, among them/.test(cr), cr || '(none)');
}

// --- death revises the article -------------------------------------------------
{
  const { w, pid } = served();
  const before = w.bios[pid];
  ok('the article is not final on leaving office', before.final === false);
  for (let i = 0; i < 300; i++) S.tick(w);
  ACT.apply(w, { type: 'KILL_PERSONA', playerId: 'p1', personaId: pid, cause: 'a long illness' });

  const after = w.bios[pid];
  ok('death rewrites it', after.final === true && !!after.finalText);
  ok('and the record says why', after.revisedFor === 'on the death of its subject', String(after.revisedFor));
  ok('the Chronicle says so too',
    w.chronicle.some((e) => /rewritten on the death of its subject/.test(e.text)));
  ok('the dates close', /\(\d+–\d+\)/.test(after.finalText.lede), after.finalText.lede.slice(0, 100));
  ok('and the subject is spoken of in the past', /\bwas the \S+ President\b/.test(after.finalText.lede));
}

// --- memoirs -------------------------------------------------------------------
{
  const { w, pid } = served();
  ok('a former head of government may write one',
    M.publishMemoir(w, { authorId: pid, title: 'A Plain Account', chapters: 6 }).ok === true);
  ok('it is on the shelf', (w.memoirs || []).length === 1, String((w.memoirs || []).length));
  ok('and only once', M.publishMemoir(w, { authorId: pid, title: 'Again', chapters: 4 }).ok === false);
}

// It has to be after office, and by somebody who held it.
{
  const { w, pid, seat } = served();
  seat.personaId = pid; seat.since = w.clock.tick; // back in the chair
  const res = M.publishMemoir(w, { authorId: pid, title: 'From The Desk', chapters: 4 });
  ok('not from the chair', res.ok === false, res.reason);

  const nobody = Object.values(w.personas).find((x) => x.alive && !R.heldHeadOffice(w, x.id));
  ok('and not by somebody who never held it',
    M.publishMemoir(w, { authorId: nobody.id, title: 'My Life', chapters: 4 }).ok === false);
}

// The weight: a tenth of a press article, times the chapters.
{
  const long = served(); const short = served();
  const before = { l: long.w.personas[long.pid].approval, s: short.w.personas[short.pid].approval };
  M.publishMemoir(long.w, { authorId: long.pid, title: 'Everything', chapters: M.MEMOIR_MAX_CHAPTERS });
  M.publishMemoir(short.w, { authorId: short.pid, title: 'A Note', chapters: 1 });
  const moved = {
    l: long.w.personas[long.pid].approval - before.l,
    s: short.w.personas[short.pid].approval - before.s,
  };
  ok('a memoir helps its author', moved.l > 0, moved.l.toFixed(3));
  ok('and a longer one helps more', moved.l > moved.s, `${moved.l.toFixed(3)} vs ${moved.s.toFixed(3)}`);
  ok('the weight is a tenth of a press article', M.MEMOIR_WEIGHT === 0.1);
  // Twelve chapters at a tenth is a little over one article's worth, and no
  // amount of writing about yourself buys more than that.
  ok('and even the longest is about one article\'s worth', moved.l < 6, moved.l.toFixed(2));
}

// Publishing revises the article, which is the point of writing one.
{
  const { w, pid } = served();
  ACT.apply(w, { type: 'MEMOIR', playerId: 'p1', title: 'The Years', chapters: 5 });
  const bio = w.bios[pid];
  ok('the histories are revised', bio.final === true && !!bio.finalText);
  ok('and the record says what prompted it',
    bio.revisedFor === 'after its subject published their own account', String(bio.revisedFor));
  ok('the memoir is in the Chronicle',
    w.chronicle.some((e) => /publishes “The Years”, 5 chapters/.test(e.text)),
    w.chronicle.filter((e) => /publishes/.test(e.text)).map((e) => e.text)[0] || 'nothing');
}

// Whether a player can actually reach any of this is memoirui.mjs, which
// renders the Offices page through ui.js and clicks the button. Everything
// above passed for a whole session while nothing in the interface called
// MEMOIR at all.

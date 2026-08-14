const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

// The article is { lede, sections } now — it grew from a paragraph into
// something with headings. Flatten it to assert on the prose.
const flat = (a) => (!a ? '' : typeof a === 'string' ? a
  : [a.lede, ...(a.sections || []).flatMap((x) => [x.h, ...x.p])].join(' '));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase='live'; w.inaugurated=0;
const pid = w.players.p1.personaId;
const seat = w.seats.find(s => s.office === 'president');
seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;

// Give them a prior office in the record, so the lede has a career to report.
w.pastSeats = w.pastSeats || [];
w.pastSeats.push({ id:'assembly#1', office:'assembly', personaId: pid, since: 0, endedTick: 0, district: w.districts[0].id });

ok('no bio while sitting', !w.bios || !w.bios[pid]);

// Leave the chair.
w.clock.tick = 4 * w.clock.ticksPerYear;
A.vacate(w, seat, 'term ended');
const bio = w.bios?.[pid];
ok('a bio is written on leaving', !!bio, bio ? flat(bio.text).slice(0, 90) + '…' : 'none');
ok('it names them', bio && flat(bio.text).includes('James Sun'));
ok('it gives the office and the years', bio && /President of The Silver Republic/.test(flat(bio.text)) && /Yr \d/.test(flat(bio.text)));
// Asked of the constitution rather than hardcoded. The chamber was the Assembly
// and is the House of Representatives; it is due to be split in two, and a test
// that names it in a literal has to be edited every time that label moves — for
// no gain, because what is being checked is that the bio mentions the earlier
// office at all.
const chamber = R.office(w, 'assembly')?.name || 'House of Representatives';
ok('it lists the earlier office', bio && new RegExp(chamber, 'i').test(flat(bio.text)),
  (flat(bio?.text).match(new RegExp(`sat in the ${chamber}[^.]*\\.`)) || [''])[0].slice(0, 110));
ok('it is not final yet', bio && bio.final === false);
ok('the article has sections', !!bio.text?.sections?.length, String(bio.text?.sections?.length));
ok('and a lede that names the office', /President of The Silver Republic/.test(bio.text?.lede || ''),
  (bio.text?.lede || '').slice(0, 100));
// The article is one paragraph, so this is no longer "is there a Presidency
// heading" but "does the body actually carry the tenure".
ok('it reports what was signed', /took office on|was sworn in on/.test(bio.text.body || ''),
  (bio.text.body || '').slice(0, 120));

// Twelve years pass.
w.clock.tick += 12 * w.clock.ticksPerYear;
C.writeFinalBios(w);
const b2 = w.bios[pid];
ok('twelve years on it is rewritten', b2.final === true && !!b2.finalText, b2.finalText ? flat(b2.finalText).slice(-90) : 'none');
ok('and the original is kept', !!b2.text && flat(b2.text) !== flat(b2.finalText));
ok('hindsight is labelled', /Twelve years on/.test(flat(b2.finalText)));

// It must not rewrite twice.
const at = b2.finalAt;
w.clock.tick += 5 * w.clock.ticksPerYear;
C.writeFinalBios(w);
ok('and only once', w.bios[pid].finalAt === at);

// Somebody back in the chair does not get a premature verdict.
const w2 = W.newWorld({ nation: 'Testland', founder: 'A B' });
ACT.apply(w2, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w2.phase='live'; w2.inaugurated=0;
const p2 = w2.players.p1.personaId;
const s2 = w2.seats.find(s => s.office === 'president');
s2.personaId = p2; s2.since = 0;
w2.clock.tick = 100;
A.vacate(w2, s2, 'defeated');
s2.personaId = p2; s2.since = w2.clock.tick;      // re-elected
w2.clock.tick += 13 * w2.clock.ticksPerYear;
C.writeFinalBios(w2);
ok('a sitting return holds the clock', w2.bios[p2].final === false);

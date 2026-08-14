// The pixel-art frames, and the one engine fact the Oval badge now waits on.
//
// scene.js and pixfont.js are pure — they take a world and return an SVG string,
// with no document anywhere — so unlike ui.js they can be run here. What is
// pinned is not how the picture looks (nothing can pin that) but that it is
// still made of pixels: a rasterised frame emits nothing but axis-aligned
// <rect>s at integer coordinates, and the moment somebody puts a <path>, a
// <polygon> or a fractional stroke back in, that stops being true. That is
// exactly the regression these two frames were rewritten to fix.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const SC = await import(base + 'scene.js');
const PF = await import(base + 'pixfont.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
const pid = w.players.p1.personaId;
const head = R.headOffice(w);
const seat = w.seats.find((s) => s.office === head.id);
seat.personaId = pid; seat.since = 0;

// ---------------------------------------------------------------------------
// The badge waits for the oath
// ---------------------------------------------------------------------------
// ui.actionItems.oval counts empty cabinet seats only once world.inaugurated is
// stamped. Before that the founders are still arguing the document at the
// convention, the offices they would be filling may yet be struck out of it, and
// a toast offering to walk them to the Oval Office is pointing at a room that
// does not exist. (ui.js cannot run headless; this pins the fact under it.)
ok('a world at the convention has not been inaugurated', w.inaugurated == null,
  `phase=${w.phase} inaugurated=${String(w.inaugurated)}`);
ok('and a founder already holds the head office there', !!seat.personaId);

w.phase = 'live';
ACT.apply(w, { type: 'OATH', playerId: 'p1', line: 'I accept this office.' });
ok('the founding oath stamps world.inaugurated', w.inaugurated != null,
  `inaugurated=${String(w.inaugurated)}`);

// It is stamped once and never again, so a later President is badged the moment
// they take office rather than waiting for a second founding that never comes.
const first = w.inaugurated;
ACT.apply(w, { type: 'OATH', playerId: 'p1', line: 'Again.' });
ok('and only once, however many oaths follow', w.inaugurated === first);

// ---------------------------------------------------------------------------
// The frames are still made of pixels
// ---------------------------------------------------------------------------

// Everything the rasteriser emits, and nothing else. A <path>, a <polygon>, a
// stroke or a gradient means somebody has gone back to drawing shapes.
const RECT = /<rect x="(-?\d+(?:\.\d+)?)" y="(-?\d+(?:\.\d+)?)" width="(\d+)" height="(\d+)" fill="([^"]+)"\/>/g;
const NOT_PIXELS = /<(path|polygon|ellipse|circle|line|polyline|linearGradient|radialGradient)\b|stroke=/;

function pins(label, svg, { min = 200 } = {}) {
  ok(`${label}: is an svg on an integer viewBox`,
    /^<svg viewBox="0 0 \d+ \d+"/.test(svg), svg.slice(0, 40));
  ok(`${label}: draws no shapes, only pixels`, !NOT_PIXELS.test(svg),
    (svg.match(NOT_PIXELS) || [''])[0]);
  const rects = [...svg.matchAll(RECT)];
  ok(`${label}: emits a merged field of rects`, rects.length >= min, `${rects.length} rects`);
  // The merge is the whole reason this is affordable: one node per pixel would
  // be 36,000 of them for the inauguration alone.
  const area = rects.reduce((n, m) => n + (+m[3]) * (+m[4]), 0);
  ok(`${label}: merges — more pixels covered than rects emitted`,
    area > rects.length * 2, `${area} px in ${rects.length} rects`);
  ok(`${label}: every rect lands on an integer coordinate`,
    rects.every((m) => Number.isInteger(+m[1]) && Number.isInteger(+m[2])));
  ok(`${label}: every fill is a plain hex colour`,
    rects.every((m) => /^#[0-9a-f]{6}$/i.test(m[5])),
    (rects.find((m) => !/^#[0-9a-f]{6}$/i.test(m[5])) || [])[5] || '');
}

pins('the inauguration', SC.inaugurationScene(w, 'f'), { min: 800 });
pins('the title screen', SC.titleScene(), { min: 800 });
pins('the Oval Office', SC.officeScene(w, 'oval'), { min: 100 });

// The confetti is the one animated layer, and it works the way the weather in
// the rooms does: a negative wall-clock delay, so a frame rebuilt mid-fall
// carries on from where it had got to instead of jumping back to the ceiling.
const inaug = SC.inaugurationScene(w, 'm');
ok('the inauguration carries confetti', /class="pxconf"/.test(inaug));
ok('and each piece is phased off the wall clock',
  /animation-delay:-\d+\.\d\ds/.test(inaug));

// The scene wears the season, like every room does — so a president inaugurated
// three canon years after the founding does not stand in the founding's light.
const winter = SC.inaugurationScene(w, 'm');
w.clock.tick = 60 * 4 * 2;   // two full seasons on
const later = SC.inaugurationScene(w, 'm');
ok('and the tableau takes its light from the calendar', winter !== later);

// ---------------------------------------------------------------------------
// The bitmap face
// ---------------------------------------------------------------------------

const mark = PF.pixText('SILVER', { ink: '#f4e0a8' });
pins('the wordmark', mark, { min: 10 });
ok('the wordmark measures 5 wide and 7 tall per glyph',
  /viewBox="0 0 35 7"/.test(mark), mark.slice(0, 32));
ok('a gutter widens it by one column per gap',
  PF.pixTextWidth('SILVER', 2) === 6 * 5 + 5 * 2);
ok('an unknown character falls back rather than throwing',
  PF.pixText('☃').length > 0);
// Everything the UI actually passes through it, so a missing glyph is a failing
// test rather than a question mark somebody notices in a screenshot.
const used = 'SILVER';
ok('every character the UI sets is in the face',
  [...used].every((c) => PF.pixText(c).includes('<rect')), used);

// ---------------------------------------------------------------------------
// The Oval Office door
// ---------------------------------------------------------------------------
// Everyone who holds a key by office must be on the list the room prints, and
// vice versa. They were two hardcoded arrays before, and they had drifted: the
// rule admitted the Secretary of the Treasury and the "Who may enter" card did
// not list them, so the one secretary the President argues with most read as a
// guest who had never been asked in. They are one array now — this is what
// stops them coming apart again.

const ov = W.newWorld({ nation: 'The Silver Republic' });
ACT.apply(ov, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
const opid = ov.players.p1.personaId;
const ohead = R.headOffice(ov);
const oseat = ov.seats.find((s) => s.office === ohead.id);
oseat.personaId = opid; oseat.since = 0;
ov.phase = 'live'; ov.inaugurated = 0;
// Fill the cabinet, so every keyholding chair actually has somebody in it.
for (const s of ov.seats) {
  const o = R.office(ov, s.office);
  if (!o || !o.atWill || s.personaId) continue;
  ACT.apply(ov, { type: 'APPOINT', playerId: 'p1', seatId: s.id, personaId: W.makePersona(ov, { synthetic: true }).id });
}

ok('the Treasury holds a key to the Oval Office',
  R.OVAL_KEY_OFFICES.includes('exchequer'), R.OVAL_KEY_OFFICES.join(', '));
ok('and so does every other secretary, the VP and the President',
  ['president', 'vp', 'state', 'defense'].every((id) => R.OVAL_KEY_OFFICES.includes(id)));

// Every holder of a listed chair is admitted by office...
const listed = R.OVAL_KEY_OFFICES.flatMap((oid) => R.holders(ov, oid));
ok('every chair the room lists really does open the door',
  listed.length > 0 && listed.every((h) => R.ovalByOffice(ov, h.id) && R.mayEnterOval(ov, h.id)),
  `${listed.length} keyholders`);

// ...and nobody else is, however senior. The bench and the chamber are other
// branches; they come in by invitation or not at all.
const outsiders = ov.seats
  .filter((s) => s.personaId && !R.OVAL_KEY_OFFICES.includes(s.office))
  .map((s) => ov.personas[s.personaId]);
ok('and no chair outside that list opens it',
  outsiders.length > 0 && !outsiders.some((h) => R.ovalByOffice(ov, h.id)),
  `${outsiders.length} checked`);

// A keyholder is never offered the invitation the Oval Office view builds —
// that list is filtered on the same predicate.
ok('a keyholder is not offered an invitation they do not need',
  !Object.values(ov.personas).some((x) => R.ovalByOffice(ov, x.id) && R.ovalGuests(ov).some((g) => g.id === x.id)));

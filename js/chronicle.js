// The Chronicle. Everything consequential is written here, once, with a
// timestamp, and never edited — only annotated and contested. The promise on
// the box is that whatever you do will be remembered; this file is that promise.

// `export { x } from` re-exports without binding x locally, and this file calls
// canonDate on every log line.
import { uid, esc, count, yearAt, canonDate, dayOfYear, tickOf, nextDay, DAYS_PER_MONTH } from './util.js';
import { headOffice, headOfficeLabel } from './rules.js';
import { COLLEGES, collegeNameFor } from './world.js';
// company.js imports nothing but util, so this closes no cycle.
import { valuation as companyValue } from './company.js';

// The calendar lives in util.js — the leaf module — because rules.js needs to
// answer "when is the next inauguration day" and importing the Chronicle to do
// it would close a cycle. Re-exported here because most of the engine has
// always asked the Chronicle what day it is.
export { daysAt, MONTHS, DAYS_PER_MONTH, DAYS_PER_YEAR } from './util.js';
export { canonDate, dayOfYear, tickOf, nextDay };
export const year = (world, tick = world.clock.tick) => yearAt(world, tick);

/**
 * A span of ticks as the country would say it: years and months, not ticks.
 *
 * A tick is an engine unit. Nobody in the republic has ever served "in 118
 * ticks" — they serve until a date, and the time between now and it is measured
 * the way time is measured everywhere else in this game.
 */
export const canonSpan = (world, ticks) => {
  const per = world.clock.ticksPerYear || 240;
  const t = Math.max(0, Math.round(ticks));
  if (t <= 0) return 'now';
  const years = Math.floor(t / per);
  const months = Math.round((t % per) / (per / 12));
  // 12 months of remainder is a year; say so rather than "1 yr 12 mo".
  const y = years + (months >= 12 ? 1 : 0);
  const m = months >= 12 ? 0 : months;
  if (!y && !m) return 'under a month';
  if (!y) return `${m} month${m === 1 ? '' : 's'}`;
  if (!m) return `${y} year${y === 1 ? '' : 's'}`;
  return `${y} yr ${m} mo`;
};

export const KINDS = {
  founding: { icon: '◈', cls: 'k-found' },
  law: { icon: '§', cls: 'k-law' },
  vote: { icon: '⚖', cls: 'k-vote' },
  office: { icon: '★', cls: 'k-office' },
  election: { icon: '✓', cls: 'k-election' },
  money: { icon: '$', cls: 'k-money' },
  build: { icon: '⌂', cls: 'k-build' },
  press: { icon: '❝', cls: 'k-press' },
  crisis: { icon: '!', cls: 'k-crisis' },
  war: { icon: '⚔', cls: 'k-war' },
  death: { icon: '†', cls: 'k-death' },
  // A circle half in shadow, matching the Intrigue tab's own mark. The eye it
  // replaces was the one icon in this table the system drew in colour emoji.
  intrigue: { icon: '◑', cls: 'k-intrigue' },
  court: { icon: '⚑', cls: 'k-court' },
  system: { icon: '·', cls: 'k-system' },
};

export function log(world, kind, text, meta = {}) {
  // Player-influenced vs auto-generated, decided at log time. Only the former
  // may be contested — the record of an NPC president signing a bill has no
  // interpretation a player can claim was theirs to make. Snapshotted rather
  // than derived at read time so a leaver's old entries do not go uncontestable
  // as they lose their seat; the interpretation was theirs when it was made.
  const actors = meta.actors || [];
  const players = Object.values(world.players || {}).map((pl) => pl.personaId);
  const player = actors.some((a) => players.includes(a));
  const entry = {
    id: uid('ch'),
    tick: world.clock.tick,
    ts: Date.now(),
    year: year(world),
    date: canonDate(world),
    kind, text,
    actors,
    docId: meta.docId || null,
    district: meta.district || null,
    weight: meta.weight ?? 1,
    player,
    annotations: [],
  };
  world.chronicle.push(entry);
  if (world.chronicle.length > 4000) world.chronicle.splice(0, 500);
  world.lastActivity = Date.now();
  return entry;
}

export function annotate(world, entryId, personaId, text, stance = 'dispute') {
  const e = world.chronicle.find((x) => x.id === entryId);
  if (!e) return null;
  e.annotations.push({ id: uid('an'), personaId, text, stance, ts: Date.now(), date: canonDate(world) });
  return e;
}

/** Presidential-log style timeline for one persona. */
export function timelineFor(world, personaId) {
  return world.chronicle.filter((e) => e.actors.includes(personaId));
}

// --- presidential ranking ---------------------------------------------------
// Historians rank presidents. That is the genre this borrows from, and it is the
// only ranking that means anything: the thirteen attributes below are things an
// executive is answerable for, and scoring a Rep. on Crisis Leadership against a
// President on the same scale flattered the one and libelled the other. So the
// table is every holder of the top chair and nobody else — see rules.headOffice,
// which finds that chair by what it can do rather than by what it is called.
//
// Attributes are computed from tenure data and still votable, because
// historiography is partisan.
export const ATTRIBUTES = [
  'Public Persuasion', 'Crisis Leadership', 'Economic Management', 'Moral Authority',
  'International Relations', 'Administrative Skill', 'Relations with Congress',
  'Vision / Agenda Setting', 'Pursued Equal Justice', 'Performance Within Context',
  'Integrity', 'Ruthlessness', 'Historical Consequence',
];

export const rankingLabel = (world) => headOfficeLabel(world);

/**
 * The chair, numbered the way a country actually numbers it.
 *
 * Not "the Nth person to have held the office" — the Nth *administration*. A
 * holder returned to the chair after somebody else has had it starts a new
 * one, which is why Grover Cleveland is the 22nd and 24th President of the
 * United States and why that country has had more presidencies than presidents.
 * Consecutive re-election is the same administration and keeps its number; it
 * is only the interruption that mints a new one.
 *
 * Returns `[{ n, personaId, since, endedTick, terms }]`, oldest first.
 */
export function administrations(world) {
  const head = headOffice(world);
  if (!head) return [];
  const runs = [...(world.pastSeats || []), ...world.seats]
    .filter((s) => s.office === head.id && s.personaId && s.since != null)
    .sort((a, b) => (a.since - b.since) || ((a.endedTick ?? Infinity) - (b.endedTick ?? Infinity)));
  const out = [];
  for (const s of runs) {
    const prev = out[out.length - 1];
    // The same person straight on from their own last term is one continuous
    // administration. Anybody else in between — a caretaker who held it for a
    // month, a rival for a full term — ends it, and the return is a new number.
    if (prev && prev.personaId === s.personaId) {
      prev.endedTick = s.endedTick ?? null;
      prev.terms += 1;
      continue;
    }
    out.push({
      n: out.length + 1, personaId: s.personaId,
      since: s.since, endedTick: s.endedTick ?? null, terms: 1,
    });
  }
  return out;
}

/** Every number one persona has held the chair under, oldest first: `[1, 3]`. */
export const ordinalsOf = (world, personaId) =>
  administrations(world).filter((a) => a.personaId === personaId).map((a) => a.n);

export function computeRanking(world) {
  const rows = [];
  const head = headOffice(world);
  if (!head) return rows;
  const allSeats = [...world.seats, ...(world.pastSeats || [])];
  for (const p of Object.values(world.personas)) {
    const terms = allSeats.filter((s) => s.office === head.id && s.personaId === p.id);
    if (!terms.length) continue; // never held the chair; not a subject of this ranking
    const tenure = world.chronicle.filter((e) => e.actors.includes(p.id));
    const n = (k) => tenure.filter((e) => e.kind === k).length;
    const scores = {};
    const base = 40 + Math.min(30, tenure.length * 1.2);
    scores['Public Persuasion'] = clampS(base + (p.approval - 50) * 0.9 + n('press') * 2);
    scores['Crisis Leadership'] = clampS(base + n('crisis') * 5 + n('war') * 3);
    scores['Economic Management'] = clampS(base + (world.economy.treasury > 0 ? 12 : -18) - world.economy.unemployment * 180);
    scores['Moral Authority'] = clampS(base + p.reputation * 3 - n('intrigue') * 6);
    scores['International Relations'] = clampS(base + n('war') * -2 + tenure.filter((e) => /treaty/i.test(e.text)).length * 8);
    scores['Administrative Skill'] = clampS(base + n('build') * 3 + n('law') * 2);
    scores['Relations with Congress'] = clampS(base + n('vote') * 2 - n('court') * 4);
    scores['Vision / Agenda Setting'] = clampS(base + n('law') * 4);
    scores['Pursued Equal Justice'] = clampS(base + tenure.filter((e) => /housing|school|hospital|pardon/i.test(e.text)).length * 5);
    scores['Performance Within Context'] = clampS(base + (p.alive ? 6 : -4));
    scores['Integrity'] = clampS(base + p.reputation * 4 - n('intrigue') * 9);
    scores['Ruthlessness'] = clampS(30 + n('intrigue') * 9 + n('war') * 7 + (p.exiled ? 6 : 0));
    scores['Historical Consequence'] = clampS(base + tenure.length * 0.8 + n('death') * 6);
    const community = world.historianVotes?.[p.id] || {};
    for (const k of Object.keys(scores)) {
      if (community[k]?.length) {
        const avg = community[k].reduce((a, b) => a + b.score, 0) / community[k].length;
        scores[k] = Math.round(scores[k] * 0.6 + avg * 0.4);
      }
    }
    const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / ATTRIBUTES.length);
    const since = Math.min(...terms.map((s) => s.since ?? 0));
    const sitting = terms.some((s) => world.seats.includes(s));
    rows.push({ persona: p, scores, overall, acts: tenure.length, office: head, terms, since, sitting });
  }
  // The number history knows them by, which is the administration's and not the
  // ranking's — the 3rd President stays the 3rd whatever the historians make of
  // them. Somebody who came back after a gap holds two, and `ordinals` carries
  // both; `ordinal` is the first of them, for anything that wants one number.
  const admin = administrations(world);
  for (const r of rows) {
    r.ordinals = admin.filter((a) => a.personaId === r.persona.id).map((a) => a.n);
    r.ordinal = r.ordinals[0] || 1;
  }
  return rows.sort((a, b) => b.overall - a.overall);
}

// --- The mini-biography ----------------------------------------------------
// When somebody leaves the chair, the republic writes them up: the opening
// paragraph of the article history would keep on them. Name, the offices they
// held and when, the presidency and its years — the lede of an encyclopaedia
// entry, which is exactly the register in which a country remembers a former
// head of government.
//
// It is written on the way out rather than continuously, because a biography is
// a thing written *about* a completed tenure. See writeFinalBios(): twelve
// years later it is written again, once, with the benefit of hindsight.

// One calendar, not two. This had its own copy of the arithmetic and so did not
// know the republic is founded on the twentieth of January rather than the
// first — a year's worth of dates that disagreed with canonDate by nineteen days.
const yearOf = (world, tick) => year(world, tick ?? 0);

/**
 * The year somebody was born, which is not the year the record first heard of
 * them.
 *
 * `persona.born` is the tick the persona was *created* — at the founding, or
 * the day an election minted a candidate — and `persona.age` is how old they
 * already were on that day. Printing the one as a birth year gave every
 * founder "b. Yr 2000; aged 68": the year the world began, sitting next to an
 * age counted from a different clock. Their birthday is that year minus that
 * age, and for anybody present at the founding that is a year before the
 * republic existed, which is correct — they had a life before it.
 */
export const birthYear = (world, p) => yearOf(world, p?.born ?? 0) - (p?.age ?? 0);

/** How old they are now: their age when the record opened, plus what has passed. */
export const ageNow = (world, p) => (p?.age ?? 0)
  + Math.floor((world.clock.tick - (p?.born ?? 0)) / (world.clock.ticksPerYear || 240));

const nth = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4)] || 'th');

// --- Dates, as an encyclopedia sets them -------------------------------------
//
// The Chronicle stamps its lines "Jan 20, Yr 2029". The abbreviation keeps a
// timeline column narrow, and the "Yr" says plainly that the year is this
// world's rather than ours — both right for a ledger you scan.
//
// An article is neither. It is prose, read at length, and the reference
// articles write the month out and let the year stand on its own: "February 22,
// 1732", never "Feb 22, Yr 1732". These are deliberately local to the article —
// the Chronicle tab still reads as a ledger and still says Yr.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const articleDate = (world, tick) => {
  const inYear = dayOfYear(world, tick);
  const m = MONTH_NAMES[Math.min(MONTH_NAMES.length - 1, Math.floor(inYear / DAYS_PER_MONTH))];
  return `${m} ${1 + Math.floor(inYear % DAYS_PER_MONTH)}, ${yearAt(world, tick)}`;
};

/** The same date with the year taken off, for a span that names it once. */
const longDayOnly = (world, tick) => articleDate(world, tick).replace(/, \d+$/, '');

/**
 * A span, collapsing whatever its two ends share.
 *
 * "from January 20 to January 24, 2029", not "from January 20, 2029 to January
 * 24, 2029" — a presidency that began and ended inside one year says the year
 * once, the way any editor would set it. Across years both ends carry it.
 */
const longSpan = (world, from, to) => {
  if (to == null) return `from ${articleDate(world, from)} to the present`;
  return yearAt(world, from) === yearAt(world, to)
    ? `from ${longDayOnly(world, from)} to ${articleDate(world, to)}`
    : `from ${articleDate(world, from)} to ${articleDate(world, to)}`;
};

/**
 * Small ordinals as words, the way the reference articles set them.
 *
 * Wikipedia writes "the first president of the United States", not "the 1st
 * President". Past tenth it goes back to figures, which is also the house rule
 * in most style guides and keeps "the 43rd president" from becoming a mouthful.
 */
const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth',
  'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinalWord = (n) => ORDINAL_WORDS[n] || nth(n);

/** "1st", "1st and 3rd", "1st, 3rd and 7th" — a set of administrations, said. */
export const nthList = (ns) => {
  const a = (ns || []).filter((n) => n > 0).map(nth);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
};

/** Every office this persona has held, oldest first, with its span in years. */
export function serviceRecord(world, personaId) {
  const all = [...(world.pastSeats || []), ...world.seats];
  const mine = all.filter((s) => s.personaId === personaId && s.since != null);
  const out = [];
  for (const s of mine) {
    const o = world.constitution.offices.find((x) => x.id === s.office);
    if (!o) continue;
    const from = yearOf(world, s.since);
    const to = s.endedTick != null ? yearOf(world, s.endedTick) : null;
    const district = s.district ? world.districts.find((d) => d.id === s.district)?.name : null;
    out.push({ office: o, from, to, district, sitting: to == null, since: s.since, endedTick: s.endedTick });
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * A term, to the day.
 *
 * "Yr 2000–2004" is the span of a career, not the record of an office. A
 * presidency has a first morning and a last afternoon, and which day it was is
 * exactly the sort of thing the encyclopaedia this article is imitating puts in
 * bold at the top. The engine has always known the tick; only the printer was
 * rounding it to the year.
 */
const spanText = (world, r) => (r.sitting
  ? `since ${canonDate(world, r.since)}`
  : `${canonDate(world, r.since)} – ${canonDate(world, r.endedTick)}`);

/**
 * The lede. `final` adds the verdict of hindsight — see writeFinalBios.
 */
/**
 * Everything the republic recorded about one tenure.
 *
 * Gathered once and handed to every section below, because eight sections each
 * scanning the chronicle and the document table separately is both slow and a
 * way for two paragraphs to quietly disagree about what happened.
 *
 * The window is the tenure: from the first day of their first term to the last
 * day of their last. Anything outside it belongs to somebody else's article.
 */
function tenureRecord(world, personaId, chairSeats) {
  // One interval per term — not one range from the first term to the last. A
  // president who served, lost, and came back had all four of the intervening
  // years attributed to them, including 100% of a war somebody else started
  // and 100% of a chamber somebody else signed for. The intervals are the
  // republic they actually governed.
  const intervals = chairSeats
    .filter((s) => s.since != null)
    .map((s) => ({ from: s.since, to: s.endedTick ?? world.clock.tick }));
  const from = intervals.length ? Math.min(...intervals.map((i) => i.from)) : 0;
  const to = intervals.length ? Math.max(...intervals.map((i) => i.to)) : world.clock.tick;
  const totalTicks = intervals.reduce((s, i) => s + Math.max(0, i.to - i.from), 0);
  const within = (tick) => tick != null && intervals.some((i) => tick >= i.from && tick <= i.to);
  const docs = Object.values(world.documents || {});

  return {
    from, to, intervals, totalTicks, within,
    // Acts they signed into law, and acts they wrote. A president signs far more
    // than they author, and the article should be able to tell the two apart.
    signed: docs.filter((d) => d.status === 'law'
      && (d.signedBy || []).some((s) => s.personaId === personaId) && within(d.promulgated)),
    // Everything that became law while they held the office, whoever put their
    // name to it. The signed list above is what they personally signed, which is
    // the right measure for a legislative record but the wrong one for asking
    // "was a treaty ratified under this president" — a treaty ratified by the
    // chamber and signed by a secretary still happened on their watch.
    lawsInTenure: docs.filter((d) => d.status === 'law' && within(d.promulgated)),
    authored: docs.filter((d) => d.authorId === personaId && d.status === 'law' && within(d.promulgated)),
    vetoed: docs.filter((d) => d.vetoedBy === personaId),
    struck: docs.filter((d) => d.struck
      && (d.authorId === personaId || (d.signedBy || []).some((s) => s.personaId === personaId))),
    // What arrived on their desk and what they chose.
    crises: (world.events || []).filter((e) => e.resolvedBy === personaId && !e.notice),
    ignored: (world.events || []).filter((e) => e.ignored && within(e.resolved) && !e.notice),
    // Wars fought under them, either way.
    wars: (world.military?.wars || []).filter((x) => within(x.started)),
    // What the wars actually moved. A war is a thing that happened; a border is
    // a thing that changed, and the second is what a president is remembered
    // for. Asked of the tenure rather than of the person for the same reason
    // `wars` is — see acts.recordSettlement, where the ledger and the reasoning
    // both live.
    cessions: (world.cessions || []).filter((x) => within(x.tick)),
    // Public money into a private company, and whose company it was. The court
    // has read this record since bailouts existed; the article never had.
    rescues: (world.rescues || []).filter((x) => within(x.tick)),
    // Their own record, and the record kept on them.
    entries: (world.chronicle || []).filter((e) => e.actors?.includes(personaId) && within(e.tick)),
    inquests: (world.inquests || []).filter((q) => q.subjectId === personaId && within(q.opened)),
    emergencies: (world.chronicle || []).filter((e) => e.actors?.includes(personaId)
      && within(e.tick) && /state of emergency|emergency is declared/i.test(e.text)),
  };
}

// --- What a presidency is remembered for -----------------------------------
//
// The article used to name the three heaviest entries in the tenure and stop.
// Three is not a record, it is a sample, and it was drawn on `weight` alone —
// which is the Chronicle's own judgement of how loud a line is, not of how much
// it mattered. A president with three hundred acts behind them got three, and
// they were routinely three of the same kind, because a tenure that disburses
// often disburses loudly.
//
// So: score everything, then choose across the domains rather than down the
// list. Fourteen is enough to be a record of a presidency and few enough that a
// reader gets to the end of it.

/**
 * What each kind of act weighs before anything else is known about it.
 *
 * A war is not a press release. These are the standing gravities of the
 * Chronicle's own kinds (see KINDS) — the multiplier applied to an entry's
 * weight, which is how loudly the line was written, to get how much it counted.
 */
const DEED_GRAVITY = {
  war: 3.0, founding: 2.4, court: 2.2, law: 2.0, crisis: 1.9,
  death: 1.8, intrigue: 1.7, election: 1.5, office: 1.4, money: 1.3,
  build: 1.1, press: 1.0, vote: 0.9, system: 0.3,
};

/** How many the article will name, at most. */
export const DEED_LIMIT = 14;
/** And how many of any single kind, so a war cannot take all fourteen. */
export const DEED_KIND_CAP = 4;
/** What the second act of a kind is worth against the first, and so on down. */
const DEED_REPEAT_DECAY = 0.55;

/** Two lines that differ only in their figures are one deed told twice. */
const deedSignature = (e) => String(e.text || '')
  .toLowerCase()
  .replace(/[\d.,$%]+/g, '#')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60);

/**
 * Lines that are the shape of the biography rather than anything done in it.
 *
 * A president is an actor on every entry about their own inauguration,
 * re-election, defeat and succession, so the first pass at this filled six of
 * fourteen slots with them — and the sentence immediately before the list
 * already gives every term and every date. Worse, being *defeated* by the next
 * president made that person's victory one of the subject's fourteen most
 * consequential acts.
 *
 * Being sworn in is not a deed. Appointing somebody else is, which is why this
 * matches the subject's own seating rather than dropping the whole `office`
 * kind.
 */
const ceremonial = (text, name) => {
  const t = String(text || '');
  const sur = String(name || '').split(' ').filter(Boolean).slice(-1)[0] || name;
  const who = `(?:${[name, sur].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
  return new RegExp(`^${who} is (?:sworn in|re-elected|elected|returned)`).test(t)
    || new RegExp(`(?:defeating|succeeding|endorses|succeeds) ${who}`).test(t)
    || new RegExp(`^${who} takes (?:up )?(?:the )?office`).test(t)
    // Existing is not a deed either. Every persona is an actor on their own
    // "<name> arrives in <nation>" line (actions.JOIN), and it is `founding`
    // kind, whose gravity is the second-heaviest in the table — so a president
    // with a short record had their own birth into the world listed among the
    // most consequential acts of their presidency, above things they did.
    || new RegExp(`^${who} arrives in `).test(t)
    // And neither is swearing the oath. It is the same event as being sworn in,
    // logged from the other side (actions.js writes "<name> takes the oath as
    // President: <the line they chose>"), and the sentence directly above the
    // list already gives the day they took office.
    || new RegExp(`^${who} takes the oath`).test(t);
};

/**
 * Everything in a tenure that is an act at all, deduplicated.
 *
 * Split out of notableDeeds so that the count and the list cannot disagree.
 * The article used to say "the Chronicle records 3 acts under her name" off the
 * raw entry list and then name two of them, because the raw list counts every
 * line the persona is an actor on — being sworn in, being re-elected, arriving
 * in the world — and the list drops all of those. With one ceremonial entry and
 * nothing else it printed "A single act stands under Sun's name for the whole
 * of it — unrecorded", which is the template showing through.
 *
 * One definition of what counts, used by both.
 */
export function deedPool(entries, { name = '' } = {}) {
  const seen = new Map();
  for (const e of entries || []) {
    if (!e || !e.text) continue;
    if (e.kind === 'system') continue;              // bookkeeping, not deeds
    // An election is how somebody came to be able to act, not an act. The
    // tenure sentence directly above the list already gives every term.
    if (e.kind === 'election') continue;
    if (name && ceremonial(e.text, name)) continue;
    const sig = deedSignature(e);
    const prev = seen.get(sig);
    // Of a line repeated all tenure, keep the loudest instance.
    if (!prev || (e.weight || 1) > (prev.weight || 1)) seen.set(sig, e);
  }
  return [...seen.values()];
}

/**
 * The most significant acts of a tenure, across as many domains as it has.
 *
 * Selection is greedy on a score that decays each time a kind is picked again:
 * the first war is worth its full weight, the second 55% of it, the third 30%.
 * A presidency that really was nothing but wars still fills its list with them
 * — up to DEED_KIND_CAP — but one that did four things in four domains will
 * name all four before it names a second of anything, which is the point. A
 * reader should be able to see the *shape* of an administration in the list,
 * not just its loudest quarter.
 *
 * Returned in significance order, strongest first, because that is what the
 * list is for: if a reader stops after five they should have read the five that
 * mattered most, not the five that happened first.
 */
export function notableDeeds(entries, { limit = DEED_LIMIT, name = '' } = {}) {
  const pool = deedPool(entries, { name });
  if (!pool.length) return [];

  // How many of each kind there are at all. A kind that happened once in eight
  // years is a landmark; the fortieth disbursement is a Tuesday.
  const total = {};
  for (const e of pool) total[e.kind] = (total[e.kind] || 0) + 1;

  const scoreOf = (e) => (e.weight || 1)
    * (DEED_GRAVITY[e.kind] ?? 1)
    * (1 + 0.5 / Math.sqrt(total[e.kind] || 1));

  const scored = pool.map((e) => ({ e, base: scoreOf(e) }));
  const chosen = [];
  const used = {};
  while (chosen.length < limit) {
    let best = null, bestVal = -Infinity;
    for (const it of scored) {
      if (it.taken) continue;
      const n = used[it.e.kind] || 0;
      if (n >= DEED_KIND_CAP) continue;
      const val = it.base * Math.pow(DEED_REPEAT_DECAY, n);
      // Ties broken by the earlier act, so the list is stable run to run.
      if (val > bestVal || (val === bestVal && best && it.e.tick < best.e.tick)) {
        bestVal = val; best = it;
      }
    }
    if (!best) break;
    best.taken = true;
    best.value = bestVal;
    used[best.e.kind] = (used[best.e.kind] || 0) + 1;
    chosen.push(best);
  }
  return chosen.sort((a, b) => b.value - a.value).map((x) => x.e);
}

/**
 * A Chronicle line as it should read inside a list of fourteen.
 *
 * The first sentence only. A Chronicle entry often carries a consequence after
 * the act — "$979,999 disbursed for public works. About 12 people find work
 * while the programme runs. $2,683,606 of discretionary allowance remains" —
 * which is the right amount of detail on the Chronicle tab and three times too
 * much fourteen times over in a paragraph. The act is the first sentence; the
 * rest is the footnote to it.
 */
const deedText = (e) => {
  const whole = String(e.text || '').replace(/\s+/g, ' ').trim();
  // Split on a full stop that ends a sentence, not on one inside a figure or an
  // abbreviation: the following character has to be a space and a capital.
  let first = whole.split(/(?<=\.)\s+(?=[A-Z“"])/)[0] || whole;
  // …but never inside a quotation. A line that quotes somebody — the oath is
  // the common one, `takes the oath as President: “This office is a loan, not a
  // gift. I mean to give it back intact.”` — has a sentence boundary *within*
  // the quotation marks, and cutting there left the article holding an opening
  // quote it never closed: `takes the oath as President: “This office is a
  // loan, not a gift`. If the cut leaves the quotes unbalanced, keep the whole
  // line; a deed that needs its second sentence is rare enough to afford it.
  const balanced = (s) => {
    const open = (s.match(/[“"]/g) || []).length;
    const close = (s.match(/[”]/g) || []).length;
    // Straight quotes are their own closer, so an even count is balanced.
    return s.includes('“') ? open === close : open % 2 === 0;
  };
  if (!balanced(first)) first = whole;
  return first.replace(/[.\s]+$/, '').trim();
};

const list = (items, conj = 'and') => (items.length <= 1 ? items[0] || ''
  : items.length === 2 ? `${items[0]} ${conj} ${items[1]}`
    : `${items.slice(0, -1).join(', ')}, ${conj} ${items[items.length - 1]}`);

// Deduplicated by name. Two distinct acts can carry the same title — the
// chamber names an appropriation after the district it is for, and a district
// with a standing problem gets one every few years — and the article was
// listing "The Terraces Employment Act" and "The Terraces Employment Act"
// side by side, which reads as a printing fault rather than as two bills.
const titles = (docs, n = 4) =>
  list([...new Set(docs.map((d) => d.title))].slice(0, n).map((t) => `“${t}”`));

/**
 * The article.
 *
 * Written as sections rather than a paragraph, because a paragraph could hold
 * the dates and nothing else — and the republic records what a tenure actually
 * did in enough detail to write the rest of it. Every section is omitted when
 * there is nothing in it, so a caretaker who served eight months and signed
 * nothing gets four lines and a consequential president gets a page.
 *
 * Returns `{ lede, sections }`. Old saves hold a bare string here and the
 * reader handles both — see ui.bioModal.
 */
export function composeBio(world, personaId, { final = false, leftAt = null } = {}) {
  const p = world.personas[personaId];
  if (!p) return null;
  const head = headOffice(world);
  const record = serviceRecord(world, personaId);
  const chair = record.filter((r) => r.office.id === head?.id);
  if (!chair.length) return null;

  const allSeats = [...(world.pastSeats || []), ...world.seats]
    .filter((s) => s.personaId === personaId && s.office === head?.id && s.since != null);
  const T = tenureRecord(world, personaId, allSeats.length ? allSeats : [{ since: 0 }]);
  const rows = computeRanking(world);
  const row = rows.find((r) => r.persona.id === personaId);
  // "the 1st and 3rd President" for somebody who came back after a gap. See
  // administrations() — the number belongs to the administration, not the man.
  // Spelled out — "the first President", not "the 1st President". See
  // ordinalWord; past tenth it goes back to figures.
  const ords = (row?.ordinals || []).filter((n) => n > 0);
  const ord = ords.length
    ? (ords.length === 1 ? ordinalWord(ords[0])
      : `${ords.slice(0, -1).map(ordinalWord).join(', ')} and ${ordinalWord(ords.at(-1))}`)
    : (row ? ordinalWord(row.ordinal || 1) : null);
  const first = chair[0], last = chair[chair.length - 1];
  const name = p.name;
  // The surname, not the first name. An encyclopaedia writes "Washington led
  // Patriot forces", never "George led Patriot forces"; the article was on
  // first-name terms with its subject for its whole length, which is the single
  // loudest thing telling a reader this is not that kind of writing. See
  // docs/presidential-article-reference.md.
  const sur = name.split(' ').filter(Boolean).slice(-1)[0] || name;
  const they = pronounsOf(p);
  const officeName = head?.name || 'head of government';
  // To the day, and per term. A presidency has a first morning and a last
  // afternoon, and the engine has always known which tick they were — only
  // the printer was rounding to the year. Non-consecutive terms get an "and"
  // between spans, the way the reference articles handle Cleveland ("from
  // 1885 to 1889 and from 1893 to 1897"): the two occupancies are two things,
  // not one bracket with a gap inside it.
  // Consecutive terms are one occupancy, not two. A president re-elected has a
  // run archived for each term (sim.closeElection), which is what the tenure
  // window needs, but the article should read "2029 to 2037" and not "2029 to
  // 2033 and 2033 to 2037" — the reader cares when they held the office, not how
  // many times they were sworn into it. A gap is still two spans, which is the
  // Cleveland case the format was built for.
  const merged = [];
  for (const r of chair) {
    const open = merged[merged.length - 1];
    // Contiguous: the next term begins where the last one ended. Allow a few
    // ticks of slack for the days between the count and the swearing-in.
    if (open && open.endedTick != null && Math.abs(r.since - open.endedTick) <= 3) {
      open.endedTick = r.endedTick;
    } else {
      merged.push({ since: r.since, endedTick: r.endedTick });
    }
  }
  // Each span already carries its own "from", so they join on "and" rather than
  // on a semicolon — "from A to B and from C to D", the way the reference
  // articles set Cleveland.
  const spans = merged.map((r) => longSpan(world, r.since, r.endedTick));
  const served = spans.length <= 1 ? spans[0]
    : spans.length === 2 ? `${spans[0]} and ${spans[1]}`
      : `${spans.slice(0, -1).join(', ')}, and ${spans.at(-1)}`;

  // --- the lede ---------------------------------------------------------------
  const bits = [];
  // "(born 1994)" for somebody still here, "(1994–2029)" for somebody gone —
  // exactly the two forms the reference articles use, and neither of them
  // carries a current age. Wikipedia does not tell you how old a former
  // president is in the first line; the birth year is the fact, and the age is
  // arithmetic that goes stale the moment it is written.
  if (p.age != null) {
    bits.push(p.alive === false && p.died != null
      ? `${birthYear(world, p)}–${yearOf(world, p.died)}`
      : `born ${birthYear(world, p)}`);
  }
  const paren = bits.length ? ` (${bits.join('; ')})` : '';
  const sitting = last.endedTick == null;

  // The lede. Name, life dates, what they were, and then the one thing the
  // presidency is for in public memory — in that order, in one paragraph, the
  // way the reference articles do it. The college and the district belong in
  // the origins below, not in the first sentence; a Wikipedia lede does not
  // open by telling you where somebody went to school.
  let lede = `${name}${paren} ${sitting ? 'is' : 'was'} the ${ord || 'a'} ${officeName} `
    + `of ${world.nation}, serving ${served}`
    + `${chair.length > 1 ? `, across ${chair.length} terms` : ''}.`;
  const chiefly = chiefLine(world, T, sur);
  if (chiefly) lede += ' ' + chiefly;
  // And the one number that would be the headline. A president is remembered
  // for the thing that moved most, and the lede should say what it was rather
  // than leave it to be assembled out of the sections.
  const headline = headlineFact(world, T, sur, personaId);
  if (headline) lede += ' ' + headline;

  const sections = [];
  const add = (h, ...paras) => {
    const ps = paras.filter(Boolean);
    if (ps.length) sections.push({ h, p: ps });
  };

  // --- early life and career -----------------------------------------------------
  // Held before the chair: started earlier, or ended by the time it began. A
  // seat resigned on the day you are sworn in has the same tick as the chair,
  // and `< T.from` dropped the whole prior career of anybody who did the
  // ordinary thing and gave up their seat to take office.
  const before = record.filter((r) => r.office.id !== head?.id
    && ((r.since ?? 0) < T.from || (r.endedTick != null && r.endedTick <= T.from)));
  const home = p.district ? world.districts.find((d) => d.id === p.district)?.name : null;
  const school = p.college ? (collegeNameFor(world, p) || p.college) : null;
  // Origins in one sentence, career in the next — "Born in X, he was educated
  // at Y" then "He sat in the Assembly for Z from A to B, and ...". The old
  // version gave the schooling its own orphaned sentence at the end.
  const origin = home || school
    ? `${home ? `Born in ${home}` : 'Born in the republic'}, ${sur}`
      + `${school ? ` was educated at ${school}` : ' has no schooling on the record'}.`
    : null;
  // The other career. See businessPast — a president who built a company and
  // took a bid for it had "no record for anyone to read" written about them.
  const biz = businessPast(world, p, T, sur, they);
  add('Early life and career', origin,
    before.length
      ? `${origin ? cap(they.subj) : sur} sat `
        + `${list(before.map((r) => `${r.office.seats > 1 ? 'in the ' : 'as '}${r.office.name}`
          + `${r.district ? ' for ' + r.district : ''} (${spanText(world, r)})`))}`
        + '.'
      : `${origin ? cap(they.subj) : sur} held no office of the republic before taking the chair.`,
    biz);

  // --- the presidency ----------------------------------------------------------
  const howLeft = allSeats.map((s) => s.why).filter(Boolean);
  const ending = howLeft.length ? leaveText(howLeft[howLeft.length - 1]) : null;
  // Multi-term presidencies get each term's dates and the total time in office,
  // not one span from the first day of the first term to the last day of the
  // last — which stretched an eight-year career with a four-year gap into "16
  // years in office" that had never been in office at all through the gap.
  const totalInOffice = canonSpan(world, T.totalTicks || 0);
  const presFirst = chair.length > 1
    ? `${sur} was sworn in on ${articleDate(world, first.since)}, `
      + `served ${chair.length} terms — `
      + chair.map((r) => r.sitting
        ? `${articleDate(world, r.since)} to the present`
        : `${articleDate(world, r.since)} to ${articleDate(world, r.endedTick)}`).join('; ')
      + ` — ` + (sitting
        ? `and sits again, ${totalInOffice} in office to date.`
        : `and left the chair for the last time on ${articleDate(world, last.endedTick)}`
          + `${ending ? ` ${ending}` : ''} after ${totalInOffice} in office in total.`)
    : `${sur} took office on ${articleDate(world, first.since)}`
      + (sitting
        ? ', and holds the chair still.'
        : `, leaving on ${articleDate(world, last.endedTick)}${ending ? ` ${ending}` : ''}`
          + ` after ${totalInOffice} in office.`);
  // Counted off the same pool the list of deeds is drawn from — see deedPool.
  // A tenure whose only entries are ceremonial has no acts to report, however
  // many lines its subject is an actor on.
  const acts = deedPool(T.entries, { name }).length;
  // No "It reads, in the balance, as a presidency of legislation before all
  // else." That was the article grading its own subject in its own voice, which
  // is the one thing the Assessment section exists to avoid doing — see the
  // note there: every verdict is attributed to the historians who hold it. The
  // sentence also said nothing the paragraphs around it had not: a tenure with
  // three wars in it is already legible as a tenure with three wars in it.
  // What those acts actually were. A count on its own — "the Chronicle records 3
  // acts under his name" — tells the reader the size of a record without telling
  // them a single thing that is in it, which is the one job this paragraph has.
  //
  // Up to fourteen, chosen across the domains rather than off the top of one —
  // see notableDeeds. Strongest first.
  const deeds = notableDeeds(T.entries, { name });
  const notable = deeds.map(deedText).filter(Boolean);
  const named = notable.length
    ? ` The most consequential of them, in order: ${notable.join('; ')}.`
    : '';
  add('Presidency',
    presFirst,
    acts === 1 && notable.length
      ? `A single act stands under ${sur}'s name in the Chronicle for the whole of it — ${notable[0]}.`
      : acts
        ? `The Chronicle records ${count(acts, 'act')} under ${they.poss} name across the tenure${chair.length > 1 ? 's' : ''}.${named}`
        : `Almost nothing stands under ${sur}'s name in the Chronicle.`);

  // --- domestic ------------------------------------------------------------------
  const dom = [];
  // Signed and authored overlap almost completely for a president who writes
  // their own programme, and naming the same four bills in consecutive
  // sentences read as a stutter. Say it once and note who held the pen.
  const ownAll = T.signed.length && T.authored.length >= T.signed.length;
  const alsoWrote = T.authored.filter((d) => !T.signed.includes(d));
  if (T.signed.length) {
    dom.push(`${sur} signed ${T.signed.length} act${T.signed.length === 1 ? '' : 's'} into law`
      + `, among them ${titles(T.signed)}`
      + (ownAll ? ' — the whole programme written by their own hand' : '') + '.');
    if (!ownAll && T.authored.length) {
      dom.push(`${T.authored.length} of them ${T.authored.length === 1 ? 'was' : 'were'} `
        + `written by ${they.obj} personally: ${titles(T.authored)}.`);
    }
  } else if (T.authored.length) {
    dom.push(`${sur} wrote ${T.authored.length} of the laws of this period — ${titles(T.authored)} — `
      + 'though the signature on them was somebody else\'s.');
  }
  if (alsoWrote.length && T.signed.length) {
    dom.push(`A further ${alsoWrote.length} act${alsoWrote.length === 1 ? '' : 's'} of theirs `
      + `${alsoWrote.length === 1 ? 'was' : 'were'} signed by another hand: ${titles(alsoWrote, 3)}.`);
  }
  if (T.vetoed.length) {
    dom.push(`${T.vetoed.length} measure${T.vetoed.length === 1 ? ' was' : 's were'} vetoed, including ${titles(T.vetoed, 3)}.`);
  }
  const clauses = clauseTally(T.signed);
  if (clauses.length) dom.push(`By subject the record runs ${list(clauses)}.`);
  add('Domestic policy', ...dom);

  // --- the economy -----------------------------------------------------------------
  add('The economy', economyLine(world, T, sur, personaId), rescueLine(T, sur));

  // --- abroad -------------------------------------------------------------------------
  const foreign = [];
  if (T.wars.length) {
    const lost = T.wars.filter((x) => x.lost).length;
    const won = T.wars.filter((x) => x.ended && !x.lost).length;
    // "was fought", not "began under" — a war declared *on* the republic is as
    // much a fact of the tenure as one the republic started, and the article was
    // crediting the president with beginning wars they had no part in choosing.
    foreign.push(`${T.wars.length} war${T.wars.length === 1 ? ' was' : 's were'} fought under ${sur}`
      + (won ? `, of which ${won} ${won === 1 ? 'was' : 'were'} won` : '')
      + (lost ? `${won ? ' and' : ', of which'} ${lost} ended in capitulation` : '') + '.');
  }
  // A surrender sued for and sent back. There is no louder decision available
  // to this office: the guns had stopped and the president started them again.
  const refused = T.wars.filter((x) => x.pressed);
  if (refused.length) {
    const times = refused.reduce((n, x) => n + (x.pressed || 0), 0);
    // "once", not "1 time" — and a single refusal in a single war does not need
    // to say how many wars it was spread across.
    foreign.push(`${cap(they.subj)} refused a beaten enemy's surrender `
      + (times === 1 ? 'once' : `${count(times, 'time')} across ${count(refused.length, 'war')}`)
      + ', sending the army back out rather than take the terms on the table.');
  }
  // And what all of it moved. See borderLine — this is the sentence the article
  // has never had, and it is the one a reader remembers.
  for (const line of borderLine(T, sur)) foreign.push(line);
  // Any treaty ratified on their watch, not only the ones they personally signed.
  const treaties = T.lawsInTenure.filter((d) => (d.clauses || []).some((c) => /^TREATY_/.test(c.kind)));
  if (treaties.length) foreign.push(`${treaties.length} treat${treaties.length === 1 ? 'y was' : 'ies were'} ratified: ${titles(treaties)}.`);
  const allies = (world.foreign || []).filter((f) => f.allied);
  // Only when nothing at all happened abroad. A tenure that annexed a neighbour
  // without ratifying a treaty was being told it had a quiet foreign record, in
  // the paragraph directly after the one saying it had redrawn the continent.
  if (!T.wars.length && !treaties.length && !(T.cessions || []).length) {
    foreign.push(`No war began and no treaty was ratified under ${sur}`
      + (allies.length ? `; the alliances of the period were inherited.` : '.'));
  }
  add('Abroad', ...foreign);

  // --- crises ---------------------------------------------------------------------------
  const cr = [];
  if (T.crises.length) {
    // "crisis"/"crises", not "crisises" — the -es rule does not apply to a word
    // that is already irregular, and the article was printing "4 crisises".
    // "among them" needs more than one thing to be among. A single crisis is
    // named directly, and keeps the capitalisation the card was written with —
    // lowercasing it gave "among them kiln hill is venting".
    const named = T.crises.slice(0, 4).map((e) => e.title);
    cr.push(`${sur} answered ${T.crises.length === 1 ? 'a single crisis' : `${T.crises.length} crises`} `
      + `from the chair${T.crises.length === 1 ? `, ${named[0]}` : `, among them ${list(named)}`}.`);
  }
  if (T.ignored.length) {
    cr.push(`${T.ignored.length} ${T.ignored.length === 1 ? 'was' : 'were'} left to resolve against the government: `
      + `${list(T.ignored.slice(0, 3).map((e) => e.title.toLowerCase()))}.`);
  }
  if (T.emergencies.length) {
    const naked = T.emergencies.filter((e) => /no crisis/i.test(e.text || '')).length;
    cr.push(`A state of emergency was declared ${T.emergencies.length === 1 ? 'once' : `${T.emergencies.length} times`}`
      + (naked
        ? `, ${naked === T.emergencies.length
          ? (naked === 1 ? 'on no crisis the country could see' : 'each time on no crisis the country could see')
          : `${naked} of them on no crisis at all`} — the office's gravest instrument reached for on nothing`
        : ' — the gravest instrument the office holds, and the one the histories weigh most')
      + '.');
  }
  if (!cr.length) {
    cr.push(`No crisis of the first order came before ${sur} from the chair, and no emergency was declared.`);
  }
  add('Crises', ...cr);

  // --- the courts ---------------------------------------------------------------------------
  const ct = [];
  if (T.struck.length) {
    ct.push(`The court struck down ${T.struck.length} act${T.struck.length === 1 ? '' : 's'} of this administration: ${titles(T.struck)}.`);
  }
  const suits = (world.cases || []).filter((c) => c.respondentId === personaId && T.within(c.opened));
  if (suits.length) ct.push(`${cap(they.subj)} ${they.were} named as respondent in ${suits.length} action${suits.length === 1 ? '' : 's'} before the court.`);
  if (T.struck.length && !suits.length) {
    ct.push(`The strikings came on the merits of the acts, not from any proceeding against ${they.obj} in person.`);
  }
  if (!ct.length) {
    ct.push(`No act of ${they.poss} administration was struck down, and ${they.subj} ${they.were} never named as respondent before the court.`);
  }
  add('The courts', ...ct);

  // --- controversy -----------------------------------------------------------------------------
  const bad = [];
  if (T.inquests.length) {
    const charged = T.inquests.filter((q) => q.finding === 'charged').length;
    const cleared = T.inquests.filter((q) => q.finding === 'cleared').length;
    bad.push(`${T.inquests.length} file${T.inquests.length === 1 ? ' was' : 's were'} opened on ${sur} in office`
      + (charged ? `; ${charged} ended in charges` : '')
      + (cleared ? `${charged ? ' and' : ';'} ${cleared} found no case to answer` : '') + '.');
  }
  const disrepute = T.signed.filter((d) => d.disrepute?.length);
  if (disrepute.length) {
    bad.push(`${cap(they.subj)} put ${disrepute.length} act${disrepute.length === 1 ? '' : 's'} on the statute book that the record `
      + `names for what ${disrepute.length === 1 ? 'it is' : 'they are'}: ${titles(disrepute, 2)}.`);
  }
  // A rescue the president was not disinterested in. `interest` is written onto
  // the rescue at the moment the money lands, by acts.bailoutInterest, so this
  // is the connection as it stood on the day and not as it looks now — and the
  // grounds are the same words the Chronicle and the bench were given. Only the
  // ones this president signed for: a conflict is a fact about a person, not
  // about a period, and every other paragraph of this section is the same.
  const tainted = (T.rescues || []).filter((r) => r.interest && r.by === personaId);
  if (tainted.length) {
    const spent = tainted.reduce((n, r) => n + (r.amount || 0), 0);
    bad.push(`${count(tainted.length, 'rescue')} ${tainted.length === 1 ? 'was' : 'were'} `
      + `signed by ${sur} for ${tainted.length === 1 ? 'a company' : 'companies'} `
      + `${they.subj} ${they.were} not disinterested in, ${moneyish(spent)} of public money in all: `
      + `${list([...new Set(tainted.flatMap((r) => r.interest.grounds || []))].slice(0, 3))}.`);
  }
  const plot = (world.conspiracies || []).find((c) => c.exposed && (c.members || []).includes(personaId) && T.within(c.created));
  if (plot) bad.push(`${cap(they.subj)} ${they.were} exposed as a party to ${plot.name}.`);
  add('Controversy', ...bad);

  // --- assessment ---------------------------------------------------------------------------------
  // The verdict, and never in the article's own voice. Every reference article
  // ends by attributing the judgement to somebody — "historians and scholars
  // rank him as among the worst presidents in American history" — and says
  // where in the field they fall rather than giving a bare score.
  if (row) {
    const rank = rows.findIndex((r) => r.persona.id === personaId) + 1;
    const of = rows.length;
    const tier = row.overall >= 70 ? 'in the upper tier of'
      : row.overall >= 55 ? 'as an above-average'
        : row.overall >= 45 ? 'as an average'
          : row.overall >= 32 ? 'as a below-average' : 'among the worst of';
    add('Assessment',
      `Historians of ${world.nation} rank ${sur} ${tier} ${tier.endsWith('of') ? `its ${officeName}s` : `${officeName}`}`
      + `${of > 1 ? `, ${nth(rank)} of the ${of} to have held the office` : ''}, `
      + `at ${row.overall} of 100 across the thirteen attributes.`,
      `They are judged strongest on ${bestAttr(row)} and weakest on ${worstAttr(row)}.`
      + (T.wars.some((x) => x.lost) || T.ignored.length >= 2
        ? ' The assessment is contested.' : ''));
  }

  // --- and what happened next ------------------------------------------------------------------------
  if (final) {
    add('Legacy', legacyLine(world, p, row, leftAt));
    if (leftAt != null) add('Later life', laterLife(world, p, leftAt));
  }

  // --- and then it is all one paragraph ------------------------------------
  //
  // The article grew sections as the republic learned to record more, and the
  // headings turned a life into a form to be filled in: eleven boxes, several
  // of them there to say that nothing had happened in them. Read straight
  // through, the same sentences are a life — the career that led to the chair,
  // what was done from it, what was done to it, and what the histories made of
  // it afterwards — and the ordering was always narrative anyway. The headings
  // were scaffolding that outlived the building.
  //
  // `sections` is still returned, as one unheaded section, because a saved
  // Season holds articles in the old shape and the readers of both — ui.bioBody
  // and half the test suite — walk it. `body` is the paragraph itself for
  // anything that just wants the prose.
  // Trimmed and emptied before joining. A section whose paragraph came back
  // blank — most of them are conditional — put a second space into the middle
  // of the article, and the presidential article is the one piece of prose in
  // this game that is meant to be read closely.
  const body = sections.flatMap((s) => s.p)
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean)
    .join(' ');
  return { lede, body, sections: body ? [{ h: null, p: [body] }] : [] };
}

/**
 * How the article refers to its subject after the first mention.
 *
 * The reference articles lean on pronouns constantly — "He directed a poorly
 * organized force", "his 1796 farewell address" — and ours opened every
 * sentence with the surname, which reads like a police report. The republic
 * asks everybody their gender at the founding and deals one to everyone else,
 * so this is stated rather than guessed; anyone who answered "neither" gets
 * they/them, and so does anybody the record has nothing for.
 */
function pronounsOf(p) {
  if (p?.gender === 'f') return { subj: 'she', obj: 'her', poss: 'her', were: 'was' };
  if (p?.gender === 'm') return { subj: 'he', obj: 'him', poss: 'his', were: 'was' };
  return { subj: 'they', obj: 'them', poss: 'their', were: 'were' };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The number that would have been the headline.
 *
 * Every reference article puts one hard fact in the lede — 31 days, 26,000,000
 * acres, a $25,000,000 indemnity — and lets the sections carry the rest. This
 * finds the largest movement of the tenure and says it plainly, so the first
 * paragraph is about something rather than about the shape of a presidency.
 */
function headlineFact(world, T, sur, personaId) {
  const all = world.economy?.history || [];
  const within = all.filter((r) => r.tick != null && r.tick >= T.from && r.tick <= T.to);
  const a = within[0], b = within[within.length - 1];
  const pts = (x) => Math.abs(x * 100);
  const cands = [];
  if (a && b && a !== b) {
    const du = (b.unemployment ?? 0) - (a.unemployment ?? 0);
    if (pts(du) >= 3) {
      cands.push([pts(du), du > 0
        ? `Unemployment rose ${pts(du).toFixed(0)} points over the tenure.`
        : `Unemployment fell ${pts(du).toFixed(0)} points over the tenure.`]);
    }
    const di = (b.inflation ?? 0) - (a.inflation ?? 0);
    if (pts(di) >= 4) {
      cands.push([pts(di), di > 0
        ? `Prices rose ${pts(di).toFixed(0)} points faster by the end of it.`
        : `Inflation was brought down ${pts(di).toFixed(0)} points.`]);
    }
    const dd = (b.debt ?? 0) - (a.debt ?? 0);
    if (Math.abs(dd) >= 5e7) {
      cands.push([Math.abs(dd) / 1e7, dd > 0
        ? `The national debt grew by $${Math.round(dd / 1e6)}M.`
        : `$${Math.round(-dd / 1e6)}M was taken off the national debt.`]);
    }
  }
  const mine = (world.discretionLog || []).filter((r) => r.by === personaId && T.within(r.tick));
  const spent = mine.reduce((s, r) => s + (r.amount || 0), 0);
  if (spent >= 5e6) cands.push([spent / 1e7, `${sur} disbursed $${Math.round(spent / 1e6)}M without a vote.`]);

  // The border, when it moved and was not the whole of a country. A total
  // annexation belongs to chiefLine, and both sentences in one lede is a
  // stutter. Weighted above every economic candidate on purpose: a tenth of a
  // neighbour is a bigger fact about a presidency than any figure the treasury
  // can produce.
  // Netted per power, the same way the body nets it — see cessionsByPower.
  const cess = cessionsByPower(T);
  if (!cess.some((x) => x.absorbed)) {
    const took = cess.reduce((n, x) => n + Math.max(0, x.pct), 0);
    const lost = cess.reduce((n, x) => n + Math.max(0, -x.pct), 0);
    const from = cess.filter((x) => x.pct > 0).length;
    if (took) {
      cands.push([1000 + took, from === 1
        ? `${took}% of a neighbour's territory was annexed under ${sur}.`
        : `Ground was annexed from ${count(from, 'neighbour')} under ${sur}, ${took}% of their territory in all.`]);
    }
    if (lost) cands.push([1000 + lost, `${lost}% of the republic's own territory was signed away.`]);
  }
  if (!cands.length) return null;
  return cands.sort((x, y) => y[0] - x[0])[0][1];
}

/** The one line a reader should take away, if the tenure has one. */
function chiefLine(world, T, sur) {
  // The border outranks everything, in both directions. Taking a neighbour off
  // the map is the only act of this office that changes what the continent is,
  // and ground signed away is the thing a country remembers longest about a
  // government — both of them were reading as "the war fought during it", which
  // is the most generic sentence the article owns.
  const cess = cessionsByPower(T);
  const wiped = cess.filter((x) => x.absorbed);
  if (wiped.length) return `${sur} is remembered above all for annexing ${list(wiped.map((x) => x.name))} entire.`;
  const gave = cess.reduce((n, x) => n + Math.max(0, -x.pct), 0);
  if (gave >= 20) return `The presidency is chiefly remembered for the ${gave}% of the republic signed away under it.`;
  if (T.wars.some((x) => x.lost)) return `The presidency is chiefly remembered for the war it lost.`;
  if (T.wars.some((x) => x.pressed)) return `${sur} sent a beaten enemy's surrender back, and the histories begin there.`;
  if (T.wars.length) return `The presidency is chiefly remembered for the war fought during it.`;
  if (T.struck.length >= 2) return `Much of the programme was undone by the court.`;
  if (T.emergencies.length) return `${sur} governed part of the term under a state of emergency.`;
  if (T.signed.length >= 6) return `It was a legislatively busy period.`;
  if (T.ignored.length >= 2) return `The record is mostly of things left unanswered.`;
  // Rescues count as consequence. A government that spent eight million
  // catching two employers was being told its tenure recorded little of it, in
  // the same article that goes on to name them.
  if (!T.signed.length && !T.crises.length && !(T.rescues || []).length) {
    return `Little of consequence is recorded from the tenure.`;
  }
  return null;
}

/**
 * What each power's border did over a tenure, netted.
 *
 * One aggregation, because the lede and the body have to agree about it. They
 * did not: a president who took 30% of a neighbour and handed 10% of it back
 * got "30% of a neighbour's territory was annexed" in the lede and "20% of
 * Canada was annexed by treaty" three sentences later, because the lede summed
 * the takings and the body netted them. Summing per settlement is the wrong
 * question in both places — what a reader wants is where the line ended up.
 */
function cessionsByPower(T) {
  const per = new Map();
  for (const x of T.cessions || []) {
    const cur = per.get(x.foreignId)
      || { id: x.foreignId, name: x.foreignName, pct: 0, money: 0, absorbed: false };
    cur.pct += x.pct || 0;
    cur.money += x.indemnity || 0;
    cur.absorbed = cur.absorbed || !!x.absorbed;
    per.set(x.foreignId, cur);
  }
  return [...per.values()];
}

/**
 * The map a presidency left behind.
 *
 * Aggregated per power rather than per settlement: three treaties with the same
 * neighbour across eight years are one thing that happened to the border, and
 * listing them one at a time reads as a filing cabinet rather than a history.
 * Netted per power too, so a neighbour handed half of itself back in a later
 * peace is not still down as an annexation of ground it no longer holds.
 *
 * A power annexed out of existence is named on its own and never as a figure —
 * "every acre of Canada" is the sentence a reader remembers, "100% of
 * Canada" is a spreadsheet.
 *
 * Returns nought to four sentences. Most tenures never touch the border at all
 * and get none.
 */
function borderLine(T, sur) {
  const all = cessionsByPower(T);
  if (!all.length) return [];
  const out = [];

  const wiped = all.filter((x) => x.absorbed);
  const took = all.filter((x) => !x.absorbed && x.pct > 0);
  const gave = all.filter((x) => !x.absorbed && x.pct < 0);

  if (wiped.length) {
    out.push(`${list(wiped.map((x) => x.name))} ceased to exist as `
      + `${wiped.length === 1 ? 'a state' : 'states'} under ${sur} — every acre annexed, and `
      + `${wiped.length === 1 ? 'a neighbour' : 'neighbours'} struck off the map of the continent.`);
  }
  if (took.length) {
    // A percentage is singular however many countries it came out of: "55% of
    // Canada was annexed", but "55% of Canada and 20% of Mexico were".
    out.push((wiped.length ? 'The border moved further out besides: ' : `The border moved out under ${sur}: `)
      + `${list(took.map((x) => `${x.pct}% of ${x.name}`))} `
      + `${took.length === 1 ? 'was' : 'were'} annexed by treaty.`);
  }
  if (gave.length) {
    const total = gave.reduce((n, x) => n - x.pct, 0);
    out.push(`${took.length || wiped.length ? 'Against that, the republic' : 'The republic'} signed away `
      + `${total}% of its own territory in the same period, to ${list(gave.map((x) => x.name))}.`);
  }
  const won = all.reduce((n, x) => n + Math.max(0, x.money), 0);
  const paid = all.reduce((n, x) => n + Math.max(0, -x.money), 0);
  if (won && paid) out.push(`${moneyish(won)} was taken in indemnities across the settlements, and ${moneyish(paid)} paid out in them.`);
  else if (won) out.push(`${moneyish(won)} was taken in indemnities.`);
  else if (paid) out.push(`${moneyish(paid)} was paid out in indemnities.`);
  return out;
}

/**
 * The career before politics, when it was in business rather than in office.
 *
 * The other half of the board reaching a presidential article. A president who
 * built a company, took a bid for it and walked into the chair on the proceeds
 * was described by their own biography as having come to office "without a
 * record for anyone to read", because the career paragraph only ever looked at
 * seats. Being bought out is the most consequential thing that happens to most
 * founders, and it was the one ending the histories could not see.
 *
 * Only what was finished before the chair. A company still trading is not a
 * past — and an officeholder cannot have one anyway, which is why the divest is
 * forced on taking office (company.found, and the forced sale in company.sell).
 * `closed` is a tick, so it is tested against null rather than for truth.
 */
function businessPast(world, p, T, sur, they) {
  const mine = (world.companies || []).filter((c) => c.founderId === p.id
    && c.closed != null && c.closed <= T.from);
  if (!mine.length) return null;
  const bits = mine.slice(0, 2).map((c) => {
    // Bought, sold, or wound up — the three endings a company has, and the
    // first of them is the one the bid machinery added.
    if (c.acquiredBy) return `founded ${c.name} and sold it to ${c.acquiredBy.name} for ${moneyish(c.acquiredBy.price)}`;
    if (c.soldFor != null) return `founded ${c.name} and sold it for ${moneyish(c.soldFor)}`;
    if (c.failed) {
      const short = c.liquidation?.shortfall || 0;
      return `founded ${c.name} and wound it up${short > 0 ? `, owing ${moneyish(short)}` : ''}`;
    }
    return `founded ${c.name}`;
  });
  return `${sur} came to politics from business: ${they.subj} ${list(bits)}.`;
}

/**
 * Public money into private hands.
 *
 * `world.rescues` is the ledger acts.payBailout keeps, and it carries the one
 * thing that makes a rescue biographical rather than a line item: whether the
 * president had an interest in the company they caught. The bench has read this
 * record since bailouts existed — see court.CLAIMS.public_money_private_interest
 * — and the article never had, so a presidency could be built on catching its
 * own donors and the histories would report that it disbursed some money.
 *
 * The conflicted ones are named in Controversy rather than here. This sentence
 * is the size of the policy; that one is the question about it.
 */
function rescueLine(T, sur) {
  const rs = T.rescues || [];
  if (!rs.length) return null;
  const total = rs.reduce((n, r) => n + (r.amount || 0), 0);
  // Per company, not per cheque. A business caught twice in one tenure is one
  // employer the government would not let fail — counting the cheques reported
  // "3 failing companies" of two, and counted the same payroll twice with it.
  const byCo = new Map();
  for (const r of rs) byCo.set(r.companyId, Math.max(byCo.get(r.companyId) || 0, r.staff || 0));
  const jobs = [...byCo.values()].reduce((n, s) => n + s, 0);
  const again = rs.length - byCo.size;
  return `${sur}'s government caught ${count(byCo.size, 'failing company', 'failing companies')} `
    + `with public money, ${moneyish(total)} in all`
    + (jobs ? `, and the ${count(jobs, 'person', 'people')} on their payrolls stayed in work` : '')
    + '.'
    + (again ? ` ${count(again, 'further cheque')} went to ${again === 1 ? 'a company' : 'companies'} already caught once.` : '');
}

/** How a term ended, in the words the seat record kept. */
/**
 * How a tenure ended, when that is worth a sentence.
 *
 * `null` for the unremarkable endings. A term running out is not news — the
 * dates in the sentence before it have already said so — and spelling it out
 * gave "The last term ended at its natural end", which says the same thing
 * twice and reads like a template nobody finished. Before that it gave "The
 * last term ended — term ended", which is the most common ending of all
 * wearing a placeholder.
 */
const LEAVE_TEXT = {
  defeated: 'in defeat at the polls',
  // Not a defeat. The constitution they governed under would not let them stand,
  // so there was no contest for them to lose — see sim.tickPendingTerms.
  'term-limited': 'at the term limit, barred from standing again',
  'stood down': 'having chosen not to stand again',
  removed: 'in removal from office',
  detained: 'with their detention',
  dead: 'with their death',
  'left office': null,
  'term ended': null,
  'elected to the presidency': null,
};
// `in`, not `??`. The unremarkable endings map to null deliberately, and `??`
// treats that as "no value" and falls straight through to the placeholder — so
// the fix printed exactly the string it was written to remove.
const leaveText = (why) => (why in LEAVE_TEXT ? LEAVE_TEXT[why] : `— ${why}`);

/** What the laws of a tenure were actually about. */
function clauseTally(docs) {
  const names = {
    APPROPRIATE: 'appropriations', BUILD: 'public works', SET_TAX: 'taxation',
    ZONE: 'zoning', REDISTRICT: 'the district lines', RIGHT: 'rights',
    GRANT_POWER: 'the powers of office', CREATE_OFFICE: 'new offices',
    AMEND: 'amendments to the constitution', DECLARE_WAR: 'war',
    TREATY_DEFENSE: 'alliance', TREATY_NONAGGRESSION: 'non-aggression',
    MILITARY: 'the army', PARDON: 'pardons', ARREST: 'detention', EXILE: 'exile',
    DEMAND_ACCOUNTS: 'the public accounts', TERM_LIMIT: 'term limits',
    PLURALITY: 'plurality of office', CALL_ELECTION: 'the timing of elections',
  };
  const counts = {};
  for (const d of docs) for (const c of d.clauses || []) {
    const n = names[c.kind];
    if (n) counts[n] = (counts[n] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, k]) => `${k} on ${n}`);
}

/**
 * What the country's books did while they held it.
 *
 * Read off economy.history, which is snapshotted every ten ticks — so this is
 * the same series the Nation tab draws, and the article cannot flatter a
 * tenure the chart contradicts.
 */
function economyLine(world, T, sur, personaId) {
  const per = world.clock.ticksPerYear || 240;
  const all = world.economy?.history || [];
  if (all.length < 4) return null;
  const span = Math.max(1, T.to - T.from);
  // Located by the tick each row carries, not by its position in the array.
  // The old version took the index proportional to `T.from / clock.tick`, which
  // is only right while the series has never rolled — and it is capped at 400
  // rows. Past that the window slid, and a long Season's articles were reading
  // somebody else's presidency off the chart.
  const within = all.filter((r) => r.tick != null && r.tick >= T.from && r.tick <= T.to);
  const a = within[0] || all.find((r) => r.tick == null) || all[0];
  const b = within[within.length - 1] || all[all.length - 1];
  if (!a || !b || a === b) return null;

  const parts = [];
  // `level`, when given, prints where the number started and where it finished
  // as well as how far it moved. "Unemployment rose 2.1 points" tells a reader
  // the direction of a presidency; "rose 2.1 points, from 4.8% to 6.9%" tells
  // them whether it was a bad one. The three a household feels — work, prices,
  // a roof — all carry it.
  const move = (from, to, unit, up, down, floor = 0.001, level = null) => {
    if (from == null || to == null) return null;
    const d = to - from;
    if (Math.abs(d) < floor) return null;
    return `${d > 0 ? up : down} ${unit(Math.abs(d))}`
      + (level ? `, from ${level(from)} to ${level(to)}` : '');
  };
  const money0 = (v) => `$${Math.round(v / 1e6)}M`;
  const pt = (v) => `${(v * 100).toFixed(1)} points`;
  const raw = (v) => `${v.toFixed(1)} points`;
  const pctv = (v) => `${(v * 100).toFixed(1)}%`;
  const people = (v) => Math.round(v).toLocaleString();

  // What the country's condition did under them — the three numbers a household
  // feels (work, prices, a roof) and then the two the government is judged on.
  for (const x of [
    move(a.unemployment, b.unemployment, pt, 'unemployment rose', 'unemployment fell', 0.001, pctv),
    move(a.inflation, b.inflation, pt, 'inflation rose', 'inflation came down', 0.001, pctv),
    move(a.homeless, b.homeless, people, 'the number sleeping rough climbed by', 'homelessness fell by', 50, people),
    move(a.gdp, b.gdp, money0, 'output grew by', 'output shrank by', 1e6),
    move(a.approval, b.approval, raw, 'approval of the government rose', 'approval of the government fell'),
  ]) if (x) parts.push(x);
  const condition = parts.length
    ? `Over the ${yearsText(span / per)} of the tenure, ${list(parts)}.`
    : null;

  // What they did with the money, which is a different sentence.
  const books = [];
  const t = move(a.treasury, b.treasury, money0, 'The reserve rose by', 'The reserve fell by', 1e5);
  if (t) books.push(t + '.');
  const debtMove = move(a.debt, b.debt, money0, 'the national debt grew by', 'the debt was paid down by', 1e5);
  if (debtMove) books.push(`Against that, ${debtMove} — ${b.debt > 0 ? `${money0(b.debt)} outstanding at the close` : 'the books cleared'}.`);
  const rateMove = move(a.rate, b.rate, pctv, 'Money cost more by the end, dearer by', 'Money got cheaper, down by', 0.0005);
  if (rateMove) books.push(rateMove + '.');

  // And what they personally signed for. The discretion log is the executive's
  // own hand on the treasury — money that never went to a vote — and it is the
  // one number a president cannot blame the chamber for.
  const mine = (world.discretionLog || []).filter((r) => r.by === personaId && T.within(r.tick));
  if (mine.length) {
    const total = mine.reduce((s, r) => s + (r.amount || 0), 0);
    books.push(`${sur} disbursed ${money0(total)} across ${mine.length} `
      + `${mine.length === 1 ? 'order' : 'orders'} without a vote.`);
  }
  const approps = T.signed.flatMap((d) => (d.clauses || []).filter((c) => c.kind === 'APPROPRIATE'));
  if (approps.length) {
    const voted = approps.reduce((s, c) => s + (+c.amount || 0), 0);
    books.push(`The chamber appropriated a further ${money0(voted)} over ${approps.length} `
      + `${approps.length === 1 ? 'clause' : 'clauses'} they signed.`);
  }

  return [condition, books.join(' ') || null].filter(Boolean).join(' ') || null;
}

const bestAttr = (row) => Object.entries(row.scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'nothing in particular';
const worstAttr = (row) => Object.entries(row.scores).sort((a, b) => a[1] - b[1])[0]?.[0] || 'nothing in particular';

/**
 * What they did next.
 *
 * The twelve-year article used to jump from the tenure straight to the verdict
 * on it, which reads as though the person stopped existing on the day they
 * handed over. They did not: they went into business, or back to the chamber,
 * or to the bench, or to the newspapers, or to prison. A former head of
 * government is one of the more interesting private citizens in the republic
 * and the whole reason for waiting twelve years is to find out what they became.
 *
 * Everything here is read off the world rather than generated, so a sentence
 * only appears when the thing actually happened, and every clause is something
 * a player could have gone and looked at.
 */
function laterLife(world, p, leftAt) {
  // The surname, like the rest of the article. This section alone was on
  // first-name terms with its subject — "Yara took no further part in public
  // life" — which is the one register the whole piece is written to avoid. See
  // the note on `sur` in composeBio.
  const first = p.name.split(' ').filter(Boolean).slice(-1)[0] || p.name;
  // Inclusive. Somebody who walks out of the chair and founds a company the
  // same afternoon has very much begun their later life, and `>` filed that
  // under nothing-happened.
  const since = (tick) => tick != null && tick >= leftAt;
  const bits = [];

  // Office again. The presidency itself is filtered out — a second tenure is
  // part of the tenure, and the twelve-year clock would not have run.
  const head = headOffice(world);
  const after = serviceRecord(world, p.id)
    .filter((r) => r.office.id !== head?.id && since(r.since));
  if (after.length) {
    bits.push(`returned to public life ${after.map((r) =>
      `${r.office.seats > 1 ? 'in the ' : 'as '}${r.office.name}${r.district ? ' for ' + r.district : ''} (${spanText(world, r)})`).join(', then ')}`);
  }

  // Business. The most common second act now that there is one to have.
  const co = (world.companies || []).find((c) => c.founderId === p.id);
  if (co && since(co.founded)) {
    // Priced now rather than off the cached field, which is only written by
    // the tick — a company founded and read in the same breath was "worth $0k".
    const worth = companyValue(world, co);
    // Three different endings, and the old line gave all of them the same one.
    // `closed` is set by a sale as much as by a failure, so a founder who sold
    // up for eleven million was written down as having founded a company "which
    // did not survive them" — which is not what happened to it, and is the
    // opposite of what happened to them.
    bits.push(co.failed
      ? `founded ${co.name}, which was wound up under them`
        + ((co.liquidation?.shortfall || 0) > 0 ? ` owing ${moneyish(co.liquidation.shortfall)}` : '')
      : co.soldFor != null
        ? `founded ${co.name} and sold it for ${moneyish(co.soldFor)}`
        : co.closed
          ? `founded ${co.name}, which did not survive them`
          : `founded ${co.name}${co.public ? ', took it public' : ''}, worth ${moneyish(worth)} at the last count`);
    if ((co.lobbySpend || 0) > 0) {
      bits.push(`spent ${moneyish(co.lobbySpend)} of it lobbying the government they used to run`);
    }
  } else {
    const employer = (world.companies || []).find((c) => (c.employees || []).includes(p.id));
    if (employer) bits.push(`took a salary at ${employer.name}`);
  }

  // The press.
  const outlet = (world.media?.outlets || []).find((o) => o.ownerPersonaId === p.id && since(o.founded));
  if (outlet) bits.push(`founded ${outlet.name} and wrote for it`);

  // The courts, on either side of the table.
  const suits = (world.cases || []).filter((c) => since(c.opened)
    && (c.plaintiffId === p.id || c.respondentId === p.id));
  if (suits.length) {
    const brought = suits.filter((c) => c.plaintiffId === p.id).length;
    bits.push(brought === suits.length ? `brought ${brought} action${brought === 1 ? '' : 's'} before the court`
      : brought ? `was in and out of the courts on both sides of the table`
        : `answered ${suits.length} action${suits.length === 1 ? '' : 's'} before the court`);
  }

  // Whatever they were doing that they did not want reported.
  const plot = (world.conspiracies || []).find((c) => c.exposed && (c.members || []).includes(p.id) && since(c.created));
  if (plot) bits.push(`was found to have been a party to ${plot.name}`);

  // And how it ended, if it has.
  const tail = [];
  if (!p.alive) tail.push(`${first} died in Yr ${yearOf(world, p.died ?? world.clock.tick)}${p.cause ? `, ${p.cause}` : ''}.`);
  else if (p.exiled) tail.push(`${first} lives outside the republic.`);
  else if (p.imprisoned) tail.push(`${first} is in prison.`);

  if (!bits.length && !tail.length) {
    return `${first} took no further part in public life.`;
  }
  const sentence = bits.length
    ? `${first} ${bits.join('; ')}.`
    : '';
  return [sentence, ...tail].filter(Boolean).join(' ');
}

/** Rounded to something a paragraph can say out loud. */
const moneyish = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn`
  : v >= 1e6 ? `$${Math.round(v / 1e6)}M`
    : v >= 1e3 ? `$${Math.round(v / 1e3)}k`
      : `$${Math.round(v)}`);

/**
 * The sentence hindsight adds. Written from what the republic looks like now,
 * not from what it looked like when they left — which is the whole reason this
 * is written twice.
 */
function legacyLine(world, p, row, leftAt) {
  const laws = (world.chronicle || []).filter((e) => e.actors.includes(p.id) && e.kind === 'law').length;
  const struck = Object.values(world.documents || {}).filter((d) => d.authorId === p.id && d.struck).length;
  const parts = [];
  if (laws) parts.push(`${laws} act${laws === 1 ? '' : 's'} of theirs stood`);
  if (struck) parts.push(`${struck} ${struck === 1 ? 'was' : 'were'} later struck down`);
  const verdict = !row ? 'The record is thin and the argument is thinner.'
    : row.overall >= 70 ? 'The verdict has hardened in their favour.'
      : row.overall >= 45 ? 'Historians remain divided.'
        : 'Time has not been kind.';
  // No later life here — it is its own section now. It used to be appended,
  // and once the article grew sections the same sentence printed twice.
  return `Twelve years on: ${parts.length ? parts.join(', ') + '. ' : ''}${verdict}`;
}

/** Write somebody up on their way out of the chair. */
/**
 * A tenure's length, the way a newspaper writes one.
 *
 * `toFixed(1)` gave "over the 12.0 years of the tenure" for a presidency that
 * lasted exactly twelve. A whole number of years is written whole, and one that
 * is not keeps its decimal — and one year is a year, not "1 years".
 */
export function yearsText(years) {
  if (!Number.isFinite(years)) return 'the tenure';
  const rounded = Math.round(years * 10) / 10;
  const whole = Number.isInteger(rounded);
  if (Math.abs(rounded - 1) < 0.05) return 'one year';
  return `${whole ? rounded : rounded.toFixed(1)} years`;
}

export function writeBio(world, personaId) {
  const text = composeBio(world, personaId);
  if (!text) return null;
  world.bios = world.bios || {};
  const prior = world.bios[personaId];
  world.bios[personaId] = {
    text,
    written: world.clock.tick,
    // A second term rewrites the lede but keeps the date they first left, so
    // the twelve-year clock runs from the end of their last term.
    leftAt: world.clock.tick,
    final: false,
    finalText: prior?.finalText || null,
  };
  return world.bios[personaId];
}

/**
 * Twelve canon years after a tenure ends, write it once more.
 *
 * A legacy is not finished when the presidency is: the downstream of a
 * presidency is the argument about it, and that argument needs the country to
 * have lived a while longer. Called each tick; does nothing almost always.
 */
export function writeFinalBios(world) {
  const per = world.clock.ticksPerYear || 240;
  for (const [pid, bio] of Object.entries(world.bios || {})) {
    if (bio.final || bio.leftAt == null) continue;
    if (world.clock.tick - bio.leftAt < 12 * per) continue;
    // Still sitting again? Then the tenure is not over and neither is the clock.
    if (world.seats.some((s) => s.personaId === pid && s.office === headOffice(world)?.id)) continue;
    const text = composeBio(world, pid, { final: true, leftAt: bio.leftAt });
    if (!text) { bio.final = true; continue; }
    bio.finalText = text;
    bio.final = true;
    bio.finalAt = world.clock.tick;
    const p = world.personas[pid];
    if (p) {
      log(world, 'system', `The histories are revised: the article on ${p.name} is rewritten with twelve years of hindsight.`,
        { actors: [pid], weight: 1 });
    }
  }
}

/**
 * Rewrite an article now, whatever the twelve-year clock says.
 *
 * There are two other moments an encyclopaedia revises an entry, and neither is
 * an anniversary. One is death — the dates close, the later life stops being
 * open-ended, and the assessment is written about a finished life rather than a
 * finished tenure. The other is the subject publishing their own account of it.
 *
 * `why` goes in the Chronicle so a reader can tell which revision they are
 * looking at.
 */
export function reviseBio(world, personaId, why) {
  const bio = world.bios?.[personaId];
  if (!bio) return null;
  const text = composeBio(world, personaId, { final: true, leftAt: bio.leftAt });
  if (!text) return null;
  bio.finalText = text;
  bio.final = true;
  bio.finalAt = world.clock.tick;
  bio.revisedFor = why;
  const p = world.personas[personaId];
  if (p) {
    log(world, 'system', `The histories are revised: the article on ${p.name} is rewritten ${why}.`,
      { actors: [personaId], weight: 1 });
  }
  return bio;
}

/** "the 3rd President" — or "the 1st and 3rd" — for a ranking row. */
export function heldAs(row) {
  return `${nthList(row.ordinals) || nth(row.ordinal || 1)} ${row.office?.name || 'holder'}`;
}
const clampS = (v) => Math.round(Math.max(1, Math.min(100, v)));

export function obituary(world, p) {
  const acts = timelineFor(world, p.id);
  const first = acts[0], last = acts.at(-1);
  const offices = [...new Set([...world.seats, ...(world.pastSeats || [])]
    .filter((s) => s.personaId === p.id).map((s) => s.office))];
  const bits = [];
  // A year for the birth and a date for the death, because that is exactly what
  // is known: `age` is whole years, so a birthday to the day would be invented
  // precision. It used to print the day the persona was created as a birth date.
  bits.push(`${regnal(p)} — Yr ${birthYear(world, p)} to `
    + `${p.died != null ? canonDate(world, p.died) : 'present'}.`);
  if (offices.length) bits.push(`Held: ${offices.join(', ')}.`);
  if (first) bits.push(`First recorded act: ${first.text}`);
  if (last && last !== first) bits.push(`Last: ${last.text}`);
  if (p.cause) bits.push(`Cause: ${p.cause}.`);
  bits.push(`${acts.length} acts of record. Final approval ${Math.round(p.approval)}%.`);
  return bits.join(' ');
}
export const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);

/** Full style of a persona, without doubling a numeral they already wrote in. */
export function regnal(p) {
  if (!p) return '';
  if (p.gen <= 1 || /\s(I{1,3}|IV|V|VI{0,3}|IX|X|\d+)$/.test(p.name)) return p.name;
  return `${p.name} ${roman(p.gen)}`;
}

/** Assemble the narrative chronicle: an exportable history of the Season. */
export function exportChronicle(world) {
  const L = [];
  L.push(`# ${world.nation} — ${world.seasonName}`);
  L.push(`*Founded ${new Date(world.createdAt).toLocaleString()} · ${world.chronicle.length} recorded acts · canon dial: ${world.canon}*`);
  L.push('');
  L.push(`## The Constitution`);
  L.push(`**${world.constitution.name}**`);
  L.push('');
  L.push(`> ${world.constitution.preamble}`);
  L.push('');
  for (const o of world.constitution.offices) {
    L.push(`- **${o.name}** — ${o.seats} seat(s), ${o.selection}, ${o.termYears}-year term. Powers: ${o.powers.join(', ')}.`);
  }
  L.push('');
  L.push('## Laws in force');
  for (const id of world.laws) {
    const d = world.documents[id];
    if (d) L.push(`- **${d.title}** (${d.date}) — ${d.clauses.length} clause(s)${d.struck ? ' — *struck down*' : ''}`);
  }
  L.push('');
  L.push('## The Record');
  let cy = null;
  for (const e of world.chronicle) {
    if (e.year !== cy) { cy = e.year; L.push(''); L.push(`### Year ${cy}`); }
    L.push(`- \`${e.date}\` ${KINDS[e.kind]?.icon || '·'} ${e.text}`);
    for (const a of e.annotations) {
      const who = world.personas[a.personaId]?.name || 'Anonymous';
      L.push(`  - *${a.stance === 'dispute' ? 'Disputed' : 'Noted'} by ${who}: ${a.text}*`);
    }
  }
  L.push('');
  const ranked = computeRanking(world);
  L.push(`## ${rankingLabel(world)}`);
  L.push('');
  L.push(ranked.length
    ? `*Every ${headOffice(world)?.name || 'holder of the office'} of ${world.nation}, ranked by the historians.*`
    : `*Nobody has been ${headOffice(world)?.name || 'seated'} yet.*`);
  for (const [i, r] of ranked.entries()) {
    L.push(`${i + 1}. **${r.persona.name}** — ${r.overall} · ${heldAs(r)}${r.sitting ? ', sitting' : ''}`);
  }
  L.push('');
  L.push('## Obituaries');
  for (const p of Object.values(world.personas)) {
    if (!p.alive) L.push(`- ${obituary(world, p)}`);
  }
  if (world.epitaph) { L.push(''); L.push('## Epitaph'); L.push(`> ${world.epitaph}`); }
  return L.join('\n');
}

export function download(name, text, mime = 'text/markdown') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export { esc };

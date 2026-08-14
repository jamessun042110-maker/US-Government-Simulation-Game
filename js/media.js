// The press.
//
// Propaganda is the beating heart of every Silver, so it is a first-class
// system with real consequences and real counterplay. Publishing moves
// synthetic-citizen opinion, weighted by the outlet's reach and credibility
// and by whether the story is *supported* — that is, whether it cites an entry
// that actually exists in the Chronicle. Planting a story that isn't true
// works. It just costs you later.

import { uid, clamp, sum, chance, nudgeMood, nudgeMoodAll, nudgeApproval, youthOf, YOUTH_PRESS } from './util.js';
import { log, canonDate } from './chronicle.js';
import * as R from './rules.js';
import { COLLEGES } from './world.js';
import * as CONDUCT from './conduct.js';

export const ANGLES = [
  { id: 'praise', label: 'Praise', dir: +1, blurb: 'Raises approval of the target.' },
  { id: 'attack', label: 'Attack', dir: -1, blurb: 'Lowers approval of the target.' },
  { id: 'alarm', label: 'Raise alarm', dir: -1, issue: true, blurb: 'Raises the salience of an issue in a district. Makes the numbers hurt more.' },
  { id: 'reassure', label: 'Reassure', dir: +1, issue: true, blurb: 'Lowers salience of an issue. Buys the incumbent room.' },
];

export const ISSUES = ['jobs', 'housing', 'taxes', 'order', 'amenity'];

export function foundOutlet(world, { name, ownerPersonaId, districtId = null, capital = 500000 }) {
  // One press each. A player who could found a second paper could publish the
  // same story twice and double its reach, and a chain of them would let one
  // person own the whole press — which is a thing to do with a law, not a thing
  // to do with a button.
  if (ownerPersonaId && outletsOf(world, ownerPersonaId).length)
    return { ok: false, reason: 'You already own a paper. One press each — buy or seize another by law for a second.' };
  if (R.rightBlocking(world, 'SEIZE_PRESS') === null && world.pressLicensed) {
    // Press law can require a licence; if one exists and no right protects the
    // press, founding can be refused by the state.
    if (!world.pressLicences?.includes(ownerPersonaId))
      return { ok: false, reason: 'Press law requires a licence, and no right protects the press.' };
  }
  const o = {
    id: uid('out'), name: name || 'The Daily', ownerPersonaId, districtId,
    credibility: 55, reach: districtId ? 0.34 : 0.16, funds: capital,
    founded: world.clock.tick, articles: 0, retractions: 0,
  };
  world.media.outlets.push(o);
  log(world, 'press', `${o.name} begins publication${districtId ? ' in ' + world.districts.find((d) => d.id === districtId)?.name : ''}, owned by ${world.personas[ownerPersonaId]?.name}.`,
    { actors: [ownerPersonaId], weight: 2 });
  return { ok: true, value: o };
}

/**
 * Does this cite actually bear on the article's target?
 *
 * A cite used to be a cite: any Chronicle entry passed as evidence lifted the
 * story a third harder, which meant a paper could praise Congress by pointing
 * to the weather report and get the same boost as one pointing to a bill. It
 * is a wrong attribution, and the rule that penalises wrong attributions is
 * the reason a Chronicle is worth citing at all — so this checks the two ways
 * a cite can be *about* its target, and everything else counts as unsupported.
 */
function citeRelevant(world, cited, art) {
  if (!cited) return false;
  const actors = cited.actors || [];
  if (!actors.length) return false;
  if (art.targetType === 'persona') {
    return actors.includes(art.targetId);
  }
  if (art.targetType === 'office') {
    // Somebody from the office in the entry — currently or when the entry was
    // logged. `pastSeats` covers the tenure case: an article about a President
    // may fairly cite what one of that office's holders was doing at the time.
    const all = [...(world.seats || []), ...(world.pastSeats || [])];
    return actors.some((id) => all.some((s) => s.personaId === id && s.office === art.targetId));
  }
  return false;
}

/** Where an article lands, and how hard. */
function impactModel(world, outlet, art) {
  const cited = art.citedEntryId ? world.chronicle.find((e) => e.id === art.citedEntryId) : null;
  const relevant = citeRelevant(world, cited, art);
  // A wrong attribution helps you no more than not citing at all: the entry
  // exists, but it says nothing about what the story claims. The credibility
  // hit for wrong attribution lands separately in publish() — the outlet keeps
  // the boost it would have had, and pays for it on its own line.
  const supported = relevant;
  const cred = outlet.credibility / 100;
  // A story lands harder where the outlet is read and where the issue already
  // bites. It bounces off districts that like the target.
  const rows = [];
  for (const d of world.districts) {
    const local = outlet.districtId ? (outlet.districtId === d.id ? 1 : 0.28) : 0.7;
    const reach = clamp(outlet.reach * local * 3.2, 0, 1);
    const sal = art.issue ? d.salience[art.issue] || 0.5 : 0.6;
    const prior = priorAffinity(world, d, art);
    const raw = 7.5 * reach * (0.45 + cred) * (0.5 + sal) * (supported ? 1.35 : 0.85) * prior;
    rows.push({ district: d.id, delta: art.dir * raw });
  }
  return { rows, supported, cited };
}

// Citizens discount stories that cut against what they already believe — and a
// grand education is a stick the press is glad of. An attack on somebody from
// the most exclusive college in the republic lands about a third harder than
// the same attack on a Northgate graduate, because resentment is a resource and
// the papers know how to spend it. Only attacks: prestige buys no protection
// and no better write-up, it only raises the height of the fall.
function priorAffinity(world, d, art) {
  if (art.targetType === 'persona') {
    const p = world.personas[art.targetId];
    if (!p) return 1;
    const likes = (p.approval ?? 50) > 55;
    const cutsWithMood = art.dir < 0 ? !likes : likes;
    const base = cutsWithMood ? 1.15 : 0.7;
    const col = COLLEGES.find((c) => c.id === p.college);
    const exposure = art.dir < 0 && col ? 1 + (col.prestige - 1) * 0.11 : 1;
    return base * exposure;
  }
  return 1;
}

export function publish(world, { outletId, authorId, headline, body, angle, targetType, targetId, issue, citedEntryId }) {
  const outlet = world.media.outlets.find((o) => o.id === outletId);
  if (!outlet) return { ok: false, reason: 'No such outlet.' };
  if (outlet.ownerPersonaId !== authorId && !(outlet.staff || []).includes(authorId))
    return { ok: false, reason: 'You do not write for that paper.' };
  const a = ANGLES.find((x) => x.id === angle) || ANGLES[1];

  // What the table will not print, and what it prints at a price.
  const conduct = CONDUCT.scan(headline, body);
  if (conduct.ok === false) return { ok: false, reason: CONDUCT.REFUSAL };

  const art = {
    id: uid('art'), outletId, authorId, headline: headline || '(untitled)', body: body || '',
    angle, dir: a.dir, targetType, targetId, issue: a.issue ? issue : null,
    citedEntryId: citedEntryId || null,
    tick: world.clock.tick, date: canonDate(world), rebuttals: [], suit: null,
  };
  const model = impactModel(world, outlet, art);
  art.supported = model.supported;
  art.impact = model.rows;

  // Immediate hit, then a decaying pressure the simulation keeps applying.
  for (const row of model.rows) {
    const d = world.districts.find((x) => x.id === row.district);
    if (!d) continue;
    if (art.issue) {
      d.salience[art.issue] = clamp((d.salience[art.issue] || 0.5) + (art.dir < 0 ? 0.12 : -0.1), 0.1, 1.6);
      nudgeMood(d, row.delta * 0.3);
    } else {
      nudgeMood(d, row.delta * 0.35);
    }
  }
  applyToTarget(world, art, model.rows, 0.7);

  // A story about a party moves the country's allegiance to it, not any one
  // person's approval: praise draws voters in from the undecided, an attack
  // drives them off. Scaled by the paper's reach and how much it is believed.
  if (art.targetType === 'party') {
    const reach = (outlet.reach || 0) * ((outlet.credibility || 50) / 100);
    for (const d of world.districts || []) {
      if (!d.partisan || d.partisan[art.targetId] == null) continue;
      const move = clamp(art.dir * 0.02 * reach, -0.02, 0.02);
      d.partisan[art.targetId] = Math.max(0.02, d.partisan[art.targetId] + move);
      d.undecided = Math.max(0.02, (d.undecided || 0) - move);
      const tot = (d.undecided || 0) + Object.values(d.partisan).reduce((s, v) => s + v, 0);
      if (tot > 0) { d.undecided /= tot; for (const k of Object.keys(d.partisan)) d.partisan[k] /= tot; }
    }
  }

  world.media.pressure = world.media.pressure || [];
  world.media.pressure.push({ artId: art.id, rows: model.rows, left: 24, targetType, targetId });
  world.media.articles.unshift(art);
  outlet.articles++;
  outlet.funds -= 40000;

  // Three cases the credibility ledger separates:
  //
  //   - Cited an entry that bore on the target: a small credit.
  //   - Ran uncited: a gamble, and a small debit if the gamble is noticed.
  //   - Cited an entry that had nothing to do with the target: a wrong
  //     attribution, and worse than uncited — a reader who checks the cite
  //     finds it says something else, and the paper wears that. It always
  //     costs, and it costs more than an uncited story of the same shape.
  const wrongCite = !!art.citedEntryId && !model.supported;
  if (wrongCite) {
    outlet.credibility = clamp(outlet.credibility - 12, 5, 99);
    art.miscited = true;
  } else if (!model.supported && chance(world, 0.35)) {
    outlet.credibility = clamp(outlet.credibility - 6, 5, 99);
    art.flagged = true;
  } else if (model.supported) {
    outlet.credibility = clamp(outlet.credibility + 1.5, 5, 99);
  }

  const cited = art.citedEntryId ? world.chronicle.find((e) => e.id === art.citedEntryId) : null;
  const tail = wrongCite ? ' — cited an unrelated entry'
    : (model.supported ? '' : (cited ? '' : ' — uncited'));
  log(world, 'press', `${outlet.name}: “${art.headline}”${tail}`,
    { actors: [authorId, targetType === 'persona' ? targetId : null].filter(Boolean), weight: 1 });

  // A paper that runs this does not persuade anybody of anything; it becomes
  // the story. The reach it bought is the reach the disgrace travels on, so a
  // big outlet is hurt worse than a pamphlet — which is the point.
  if (conduct.tier === 'incite') {
    art.disrepute = conduct.grounds;
    const reach = clamp((outlet.reach ?? 0.1), 0.02, 1);
    outlet.credibility = clamp(outlet.credibility - 26, 5, 99);
    nudgeMoodAll(world, -(4 + 10 * reach));
    const owner = world.personas[outlet.ownerPersonaId];
    if (owner) { nudgeApproval(owner, -16); owner.reputation = (owner.reputation || 0) - 3; }
    const writer = world.personas[authorId];
    if (writer && writer !== owner) nudgeApproval(writer, -12);
    // Whatever the story was aimed at, it lands on the paper instead.
    world.media.pressure = world.media.pressure.filter((p) => p.artId !== art.id);
    log(world, 'press', `${outlet.name} prints “${art.headline}” — ${conduct.grounds[0]}. The paper, not its target, is the scandal by morning.`,
      { actors: [authorId, outlet.ownerPersonaId].filter(Boolean), weight: 4 });
  }
  return { ok: true, value: art };
}

// --- Memoirs ---------------------------------------------------------------
// The last move available to somebody with no office left.
//
// A memoir is a run of press articles the author has written about themselves,
// held back and published together — so it is modelled as exactly that, through
// the same impact machinery, and not as a special case with its own numbers.
// What makes it a memoir rather than a newspaper is the weight: MEMOIR_WEIGHT
// is a tenth of a press article's, because a book about yourself is the least
// credible account of you there is, and the country knows it.
//
// The compensation is volume and reach. Every chapter lands on the same day,
// nobody rebuts it, and it reaches the whole republic rather than one paper's
// district. A long memoir by somebody the country half-remembers can move a
// legacy; a long memoir by somebody it detests cannot.

/** A memoir chapter is worth this much of a press article. */
export const MEMOIR_WEIGHT = 0.1;
/** How many chapters, at most. Beyond this nobody is still reading. */
export const MEMOIR_MAX_CHAPTERS = 12;
/** A former head of government may publish one. */
export const MEMOIR_MIN_CHAPTERS = 1;

/** Has this person already published? A memoir is written once. */
export const hasMemoir = (world, personaId) =>
  (world.memoirs || []).some((m) => m.authorId === personaId);

/**
 * Publish the whole thing at once.
 *
 * `chapters` is the length the author put into it — the only lever they have,
 * and it is a real one, because the reach is per chapter. Each chapter is run
 * through the same impact model a press article uses, at MEMOIR_WEIGHT, and the
 * article's own record of the tenure is revised afterwards: the point of
 * writing one is to change what the article says.
 */
export function publishMemoir(world, { authorId, title, chapters = 6 }) {
  const p = world.personas?.[authorId];
  if (!p) return { ok: false, reason: 'No such person.' };
  if (!p.alive) return { ok: false, reason: 'The dead publish nothing.' };
  if (R.officesOf(world, authorId).length) {
    return { ok: false, reason: 'A memoir is written after office, not from it. Leave the chair first.' };
  }
  if (!R.heldHeadOffice(world, authorId)) {
    return { ok: false, reason: 'Only somebody who has held the chair has a memoir anybody would print.' };
  }
  if (hasMemoir(world, authorId)) return { ok: false, reason: 'You have written it once. That is how many memoirs there are.' };

  const clean = String(title || '').trim().slice(0, 60);
  if (!clean) return { ok: false, reason: 'It needs a title.' };
  const conduct = CONDUCT.scan(clean);
  if (conduct.ok === false) return { ok: false, reason: CONDUCT.REFUSAL };
  const n = clamp(Math.round(+chapters || 0), MEMOIR_MIN_CHAPTERS, MEMOIR_MAX_CHAPTERS);

  // A memoir is favourable to its author by construction — that is what makes
  // it a memoir. Modelled as a supported story with no outlet's district bias
  // and no outlet's credibility either: an author's own credibility stands in.
  const art = {
    id: uid('mem'), authorId, targetType: 'persona', targetId: authorId,
    dir: 1, issue: null, headline: clean, tick: world.clock.tick, date: canonDate(world),
  };
  const outlet = {
    // Nationwide, and no better trusted than the author is.
    districtId: null, reach: 0.5,
    credibility: clamp(40 + (p.reputation || 0) * 6, 10, 85),
  };
  const model = impactModel(world, outlet, { ...art, citedEntryId: null });
  const rows = model.rows.map((r) => ({ ...r, delta: r.delta * MEMOIR_WEIGHT * n }));

  for (const row of rows) {
    const d = world.districts.find((x) => x.id === row.district);
    if (d) nudgeMood(d, row.delta * 0.35);
  }
  applyToTarget(world, art, rows, 0.7, false);
  // It keeps working for a while, the way a book does — longer than a headline
  // and much more weakly.
  world.media.pressure = world.media.pressure || [];
  world.media.pressure.push({ artId: art.id, rows, left: 60, targetType: 'persona', targetId: authorId });

  const memoir = {
    id: art.id, authorId, title: clean, chapters: n,
    tick: world.clock.tick, date: canonDate(world),
    impact: sum(rows, (r) => r.delta) / Math.max(1, rows.length),
  };
  world.memoirs = world.memoirs || [];
  world.memoirs.unshift(memoir);

  log(world, 'press', `${p.name} publishes “${clean}”, ${n} chapters on ${pronounPoss(p)} own account of the tenure.`,
    { actors: [authorId], weight: 2 });
  return { ok: true, value: memoir };
}

// The republic asks everybody their gender at the founding, so this is stated
// rather than guessed; anyone who answered "neither" gets their.
const pronounPoss = (p) => (p?.gender === 'f' ? 'her' : p?.gender === 'm' ? 'his' : 'their');

function applyToTarget(world, art, rows, scale, youthPraise = true) {
  const avg = sum(rows, (r) => r.delta) / Math.max(1, rows.length);
  if (art.targetType === 'persona') {
    const p = world.personas[art.targetId];
    let delta = avg * scale;
    // A younger figure's standing swings further on a good headline — an ear
    // not yet hardened to praise. Only praise, and only the press: a bad story
    // lands the same on everyone, and a memoir is the author's own account
    // rather than praise the country paid them (youthPraise=false).
    if (delta > 0 && youthPraise) delta *= 1 + YOUTH_PRESS * youthOf(world, p);
    nudgeApproval(p, delta);
  } else if (art.targetType === 'office') {
    for (const p of R.holders(world, art.targetId)) nudgeApproval(p, avg * scale);
  } else if (art.targetType === 'district') {
    const d = world.districts.find((x) => x.id === art.targetId);
    nudgeMood(d, avg * scale * 1.4);
  }
}

/** Called every tick: media pressure keeps working, then fades. */
export function tickMedia(world) {
  const list = world.media.pressure || [];
  for (const p of list) {
    p.left--;
    const fade = clamp(p.left / 24, 0, 1) * 0.06;
    for (const row of p.rows) {
      const d = world.districts.find((x) => x.id === row.district);
      nudgeMood(d, row.delta * fade);
    }
    const art = world.media.articles.find((a) => a.id === p.artId);
    if (art) applyToTarget(world, art, p.rows, fade * 1.2);
  }
  world.media.pressure = list.filter((p) => p.left > 0);
}

export function rebut(world, articleId, personaId, text) {
  const art = world.media.articles.find((a) => a.id === articleId);
  if (!art) return { ok: false, reason: 'No such article.' };
  art.rebuttals.push({ id: uid('reb'), personaId, text, tick: world.clock.tick });
  const p = world.media.pressure?.find((x) => x.artId === art.id);
  if (p) { p.left = Math.max(2, Math.round(p.left * 0.45)); p.rows = p.rows.map((r) => ({ ...r, delta: r.delta * 0.5 })); }
  log(world, 'press', `${world.personas[personaId]?.name} publicly rebuts “${art.headline}”.`, { actors: [personaId] });
  return { ok: true };
}

/** Libel suit — only meaningful under whatever press law the constitution defines. */
export function sueForLibel(world, articleId, plaintiffId) {
  const art = world.media.articles.find((a) => a.id === articleId);
  if (!art) return { ok: false, reason: 'No such article.' };
  const right = R.rightBlocking(world, 'SEIZE_PRESS');
  const outlet = world.media.outlets.find((o) => o.id === art.outletId);
  const strong = !art.supported;
  const shield = right ? 0.45 : 1;
  const win = chance(world, (strong ? 0.75 : 0.2) * shield);
  art.suit = { plaintiffId, win, tick: world.clock.tick };
  if (win) {
    outlet.credibility = clamp(outlet.credibility - 18, 5, 99);
    outlet.funds -= 400000;
    outlet.retractions++;
    const p = world.media.pressure?.find((x) => x.artId === art.id);
    if (p) p.left = 0;
    log(world, 'court', `${world.personas[plaintiffId]?.name} wins a libel action against ${outlet.name} over “${art.headline}”. Retraction ordered.`, { actors: [plaintiffId], weight: 2 });
  } else {
    const pl = world.personas[plaintiffId];
    nudgeApproval(pl, -5);
    log(world, 'court', `${world.personas[plaintiffId]?.name}'s libel action against ${outlet.name} fails${right ? `; the court cites ${right.name}` : ''}.`, { actors: [plaintiffId], weight: 2 });
  }
  return { ok: true, value: art.suit };
}

export function outletsOf(world, personaId) {
  return world.media.outlets.filter((o) => o.ownerPersonaId === personaId);
}

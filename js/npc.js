// The government, when nobody is playing it.
//
// An NPC in the chamber has always voted — see sim.syntheticBallot — but an NPC
// in the *chair* did nothing whatsoever. Crisis cards sat on the desk until
// they expired against the republic; bills passed by the chamber waited
// forever for a signature that was never coming; the treasury was never opened
// and no ambassador was ever received. A Season where the player lost an
// election became a Season where the country had no executive at all, which is
// the least interesting possible consequence of losing.
//
// What follows is not an AI. It is a set of dispositions — what this particular
// person, with this party and this temperament, would obviously do with the
// paper in front of them — applied through exactly the same doors a player uses.
// Every action here goes through the engine's own gates: director.respond,
// acts.sign, acts.disburse, depts.talk. An NPC president cannot do anything a
// player in the same chair could not, and is refused by the same rules.

import { clamp, chance, rng, count, moneyExact } from './util.js';
import * as R from './rules.js';
import * as A from './acts.js';
import * as D from './director.js';
import * as DEP from './depts.js';
import * as CO from './company.js';
import * as MACRO from './macro.js';
import { log } from './chronicle.js';
import { PARTIES, temperamentOf, BUILDINGS, makePersona } from './world.js';

/**
 * How often the chair looks at its desk.
 *
 * Not every tick. A president who answered every crisis in the second it broke
 * and signed every bill on arrival would be a machine rather than a person, and
 * the player would never get to watch a government dither. Twelve ticks is
 * about three weeks of canon time.
 */
export const CADENCE = 12;

/** Deterministic 0..1 from a string, so one president is consistent with itself. */
function hash01(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}

const leanOf = (p) => (PARTIES.find((x) => x.id === p.party) || PARTIES[0]).lean;

// --- Executive disposition -------------------------------------------------
// The chamber has temperaments — see world.TEMPERAMENTS — and they do real
// work: they bend the two ledgers a vote is decided on, so the way a member
// talks and the way they vote agree. The executive had nothing of the kind.
// Every synthetic president reached for the treasury on the same 0.12, broke
// ground on the same 0.09, called an ambassador in on the same 0.1, and sued
// for peace at exactly the same front and the same exhaustion. Two presidents
// of the same party were the same president wearing a different name, and the
// only thing that ever distinguished a tenure was which crises happened to
// land in it.
//
// A disposition is four numbers and it is deliberately *small*. This is not a
// second party system: a Ledger president and a Ledger president are still
// recognisably the same politics. It is the difference between one who cannot
// leave a thing alone and one who waits to be sure — appetite for activity,
// for confrontation, for spending, and for how long they will let a war run
// before they look for a way out of it.
//
//   energy   scales every "does the government act this window" roll
//   nerve    the forceful answer, the pressed demand, the war fought on
//   purse    how much of the discretionary allowance actually gets spent
//   patience how long they sit with a problem before reaching for something
export const DISPOSITIONS = [
  {
    id: 'restless', label: 'Restless', energy: 1.5, nerve: 0.1, purse: 0.15, patience: -0.25,
    blurb: 'Cannot leave a thing alone. Acts, and then acts again.',
  },
  {
    id: 'cautious', label: 'Cautious', energy: 0.62, nerve: -0.3, purse: -0.2, patience: 0.4,
    blurb: 'Waits until they are sure, and is occasionally sure too late.',
  },
  {
    id: 'hawkish', label: 'Hawkish', energy: 1.15, nerve: 0.5, purse: 0.05, patience: -0.35,
    blurb: 'Reaches for the harder answer, and reaches for it early.',
  },
  {
    id: 'emollient', label: 'Emollient', energy: 0.95, nerve: -0.5, purse: 0.1, patience: 0.4,
    blurb: 'Would rather talk, and goes on talking past where others would stop.',
  },
  {
    id: 'frugal', label: 'Frugal', energy: 0.8, nerve: -0.05, purse: -0.5, patience: 0.2,
    blurb: 'Signs nothing with a number on it if there is a version without one.',
  },
  {
    id: 'builder', label: 'Builder', energy: 1.2, nerve: -0.1, purse: 0.5, patience: 0.05,
    blurb: 'Thinks the answer is usually something you can stand in front of and open.',
  },
];

const NEUTRAL = { id: 'plain', label: 'Plain', energy: 1, nerve: 0, purse: 0, patience: 0, blurb: '' };

/**
 * Which of the six this person is.
 *
 * Chosen rather than rolled, and chosen off what the game already knows about
 * them, so the disposition agrees with the rest of the person instead of
 * arriving as a second, contradictory personality. A member of a party that
 * likes order and spending is drawn toward hawkish and builder; a wonk toward
 * cautious; a firebrand toward hawkish. The hashed term is the individual — it
 * is what makes two firebrands of the same party govern differently — and it
 * is small enough that it decides only between the candidates their politics
 * already left open.
 *
 * Hashed off the persona id and nothing else, so it is stable for life: a
 * president does not become a different person because the clock advanced.
 */
export function dispositionOf(p) {
  if (!p) return NEUTRAL;
  const lean = leanOf(p);
  const t = temperamentOf(p);
  let best = DISPOSITIONS[0], bestScore = -Infinity;
  for (const d of DISPOSITIONS) {
    const score = d.nerve * (lean.order * 1.6 + t.interest * 1.4)
      + d.purse * (lean.spend * 1.8)
      + d.patience * (t.merit * 1.5)
      + (d.energy - 1) * (t.interest * 0.8)
      + (hash01(p.id + '|disp|' + d.id) - 0.5) * 0.9;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** A chance roll scaled by how busy this person is, kept on sane rails. */
const acts = (world, p, base) => chance(world, clamp(base * dispositionOf(p).energy, 0.01, 0.85));

/** The synthetic holder of the top chair, or null when a player holds it. */
export function npcHead(world) {
  const head = R.headOffice(world);
  if (!head) return null;
  const seat = world.seats.find((s) => s.office === head.id && s.personaId);
  const p = seat && world.personas[seat.personaId];
  if (!p || !p.synthetic || !p.alive || p.imprisoned || p.exiled) return null;
  return p;
}

// --- Crises ----------------------------------------------------------------

// Words that give an option's character away. The crisis cards are prose, and
// the engine cannot simulate an option to find out what it does — but the label
// is written for a human to read, and what a president is drawn to is precisely
// the thing a human would read off it.
const DOES_NOTHING = /do nothing|say (it is|nothing)|wait and see|ride it out|deny it|no comment|leave it/i;
const FORCEFUL = /clear|arrest|seize|crack|suppress|order the|troops|force|expel|raid/i;
const CAREFUL = /commission|inquiry|review|meet|negotiate|talk|publish|consult|hearing/i;

/**
 * Which option this person takes.
 *
 * Scored, not rolled: a Ledger president really will reach for the cheap answer
 * every time, and a firebrand really will reach for the forceful one, and that
 * consistency is the whole reason the party and the temperament are on the
 * card. The jitter is hashed off the persona and the event, so the same
 * president facing the same crisis makes the same decision — a re-render or a
 * re-entry cannot shake a different answer out of them.
 */
export function chooseOption(world, p, ev, tpl) {
  const opts = tpl?.options || [];
  if (!opts.length) return -1;
  const lean = leanOf(p);
  const temper = temperamentOf(p);
  const disp = dispositionOf(p);
  let best = -1, bestScore = -Infinity;

  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    let score = 0;

    if (o.cost) {
      // Can they even do this? The same gate the button uses.
      const gate = A.disburseGate(world, p.id, o.cost);
      if (!gate.ok) continue;
      // A party that likes spending likes spending; one that does not, does not
      // — and within the party, a builder reaches for the paid answer where a
      // frugal one of the same politics reads the same card and looks for the
      // version of it without a number on it.
      score += lean.spend * 2.2 + disp.purse * 1.6;
      // And nobody empties the treasury on one card.
      const share = o.cost / Math.max(1, world.economy.treasury);
      score -= clamp(share, 0, 3) * 2.6;
    } else {
      score += 0.4; // free is easy
    }
    // Doing nothing is always on the table and is almost always wrong. It is
    // not struck off — a weary president really does take it — but it has to
    // be a positively attractive alternative to everything else.
    if (DOES_NOTHING.test(o.label)) score -= 3.4 + temper.merit * 4 + (disp.energy - 1) * 1.8;
    if (FORCEFUL.test(o.label)) score += lean.order * 1.8 + temper.interest * 3 + disp.nerve * 2.4;
    if (CAREFUL.test(o.label)) score += temper.merit * 3 - lean.order * 0.8 + disp.patience * 2;
    // An option that exercises a power they do not hold is not an option.
    if (o.power && !R.hasPower(world, p.id, o.power)) continue;

    score += (hash01(p.id + '|' + ev.uid + '|' + i) - 0.5) * 1.6;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * Answer what is on the desk.
 *
 * Deliberately not instant. A crisis answered in the tick it broke reads as a
 * machine; this government takes a visible moment, and one that has left it
 * nearly too late starts acting like it. If nothing is affordable and nothing
 * is allowed, they answer nothing — and it expires against them, exactly as it
 * would against a player who could not find the money.
 */
function answerCrises(world, p) {
  for (const ev of world.events || []) {
    if (ev.resolved) continue;
    // Notices only want filing, and a government that files its post is the
    // baseline. It also clears the card for everybody.
    if (ev.notice) { D.acknowledge(world, ev.uid, p.id); continue; }
    const life = Math.max(1, (ev.deadline ?? 0) - (ev.opened ?? ev.tick ?? 0));
    const gone = (ev.deadline ?? 0) - world.clock.tick;
    // Urgency: idle at first, near-certain once the clock is nearly out.
    const pressure = clamp(1 - gone / life, 0, 1);
    if (!chance(world, 0.18 + pressure * 0.6)) continue;
    const tpl = D.EVENTS.find((e) => e.id === ev.id);
    const pick = chooseOption(world, p, ev, tpl);
    if (pick < 0) continue;
    D.respond(world, ev.uid, pick, p.id);
  }
}

// --- The desk --------------------------------------------------------------

/**
 * Sign it or veto it.
 *
 * Decided by syntheticBallot — the same function that decides how this person
 * would vote on the same bill from a seat in the chamber, which is exactly the
 * question a veto asks. An abstention signs: a president with no strong view
 * does not spend a veto to stop the chamber having its way, and a bill dying
 * on an unattended desk is the failure this whole file exists to end.
 *
 * `ballot` is passed in rather than imported. sim.js imports this module for
 * the tick, so reaching back for syntheticBallot would close a cycle over a
 * binding needed at call time.
 */
function clearTheDesk(world, p, ballot) {
  const veto = world.constitution.legislature?.vetoOffice;
  if (!veto || !R.officesOf(world, p.id).some((o) => o.id === veto)) return;
  for (const id of world.docOrder || []) {
    const doc = world.documents[id];
    if (!doc || doc.status !== 'awaiting-signature') continue;
    // A day or two to read it.
    if (world.clock.tick - (doc.passedAt ?? doc.floorCloses ?? 0) < CADENCE) continue;
    if (!chance(world, 0.55)) continue;
    // Nobody vetoes their own bill. syntheticBallot answers "how would this
    // person vote on this measure", and in an unhappy country it answers nay to
    // almost everything — including the appropriation the President wrote that
    // morning to fix the thing making the country unhappy. Seven vetoes to one
    // signature, a government legislating against itself, and a city that could
    // never be rebuilt because the executive kept striking down its own plans.
    const mine = doc.authorId === p.id;
    const view = mine ? 'yea' : (ballot ? ballot(world, p, doc) : 'yea');
    if (view === 'nay') A.veto(world, doc.id, p.id);
    else A.sign(world, doc.id, p.id);
  }
}

// --- The chequebook --------------------------------------------------------

// What the country is worst at, and the words that buy an answer to it. The
// purposes are written to match acts.SPEND_EFFECTS' own parser, because a
// president typing words the engine does not recognise is the bug that parser
// was given labels to fix.
// Each `read` returns roughly "how many points out of tolerable is this", so
// the four are on one scale and can be compared. They were not, on the first
// pass — homeless was divided by a flat 400 regardless of the size of the
// country — and a government spent twenty-eight consecutive orders on housing
// while unemployment sat at fourteen per cent.
const REMEDIES = [
  {
    purpose: 'public works and jobs',
    read: (w) => Math.max(0, (w.economy.unemployment - 0.06) * 100) / 3,
  },
  {
    purpose: 'housing for the encampment',
    read: (w) => {
      const pop = w.districts.reduce((s, d) => s + d.pop, 0) || 1;
      const homeless = w.districts.reduce((s, d) => s + d.homeless, 0);
      return Math.max(0, (homeless / pop) * 100 - 2) / 3;
    },
  },
  {
    purpose: 'schools and hospitals',
    read: (w) => Math.max(0, 55 - Math.min(...w.districts.map((d) => d.health ?? 55))) / 8,
  },
  {
    purpose: 'policing and patrols',
    read: (w) => Math.max(0, 45 - Math.min(...w.districts.map((d) => d.order ?? 50))) / 8,
  },
];

/**
 * Spend on the worst thing, within the allowance, and never past it.
 *
 * A president who never opens the treasury is not governing, and one who spends
 * it to the floor on the first bad quarter is not either. This takes a slice of
 * what the constitution actually lets them disburse without a vote — see
 * rules.discretionUsed — and only when something is genuinely wrong.
 */
/**
 * A company about to fail, and what this president thinks a government is for.
 *
 * The bailout is a real decision with a real cost — see acts.bailout — so a
 * synthetic executive has to be able to make it and to make it *characterfully*.
 * A builder catches employers; a frugal one does not think the treasury is an
 * insurance scheme; and nobody spends money they would have to ask the chamber
 * for, which in most republics means the rescues an NPC can reach alone are the
 * small ones. The rest is the chamber's, as it should be.
 */
function rescue(world, p) {
  if (!R.hasPower(world, p.id, 'spend')) return;
  const failing = (world.companies || []).filter((co) => !co.closed && co.distress);
  if (!failing.length) return;
  const disp = dispositionOf(p);
  // Purse is the appetite; a hard-nosed one wants a bigger payroll on the line
  // before the public pays for it. Below twelve people, nobody bothers.
  const floor = Math.round(clamp(30 - disp.purse * 45 + disp.nerve * 15, 12, 200));
  const co = failing
    .filter((c) => (c.employees || []).length >= floor)
    .sort((a, b) => (b.employees || []).length - (a.employees || []).length)[0];
  if (!co) return;
  if (!acts(world, p, 0.25 + disp.purse * 0.3)) return;
  const need = Math.max(Math.round(co.unpaid || 0), Math.round(-CO.equity(world, co)), 0);
  const amount = Math.max(1e5, Math.round(need * 1.2));
  if (amount > world.economy.treasury * 0.25) return;   // not with the country's last money
  A.bailout(world, p.id, co.id, amount);
}

function spend(world, p) {
  if (!R.hasPower(world, p.id, 'spend')) return;
  if (!acts(world, p, 0.12)) return;
  // Weighted, not simply the worst. A government has several problems at once
  // and attends to the biggest most often rather than exclusively — taking the
  // maximum every time produced a president who spent a decade on one of them
  // and never looked up.
  const live = REMEDIES.map((r) => ({ ...r, weight: r.read(world) })).filter((r) => r.weight >= 0.5);
  if (!live.length) return; // nothing is bad enough to act on
  const total = live.reduce((s, r) => s + r.weight, 0);
  let roll = rng(world) * total;
  const worst = live.find((r) => (roll -= r.weight) <= 0) || live[0];

  const d = R.discretionUsed(world);
  // Stay under the vote threshold as well as under the allowance: an executive
  // that files bills with itself is a different behaviour, and this is not it.
  const rule = world.constitution.spending?.slice().sort((a, b) => a.above - b.above)
    .find((x) => x.requires);
  const ceiling = Math.min(
    Number.isFinite(d.remaining) ? d.remaining : Infinity,
    rule ? rule.above - 1 : Infinity,
    Math.max(0, world.economy.treasury * 0.15),
  );
  if (!Number.isFinite(ceiling) || ceiling < 1e5) return;
  // How much of the room they actually use. A frugal president who has decided
  // to spend still spends the smallest amount that answers the question; a
  // builder who has decided to spend takes most of what the constitution left
  // them. Same allowance, same problem, and a visibly different government.
  const purse = clamp(0.4 + dispositionOf(p).purse * 0.35, 0.15, 0.8);
  const amount = Math.round(ceiling * clamp(purse + rng(world) * 0.5, 0.12, 0.98));
  if (amount < 1e5) return;
  A.disburse(world, p.id, amount, worst.purpose);
}

// --- The cabinet -----------------------------------------------------------

/**
 * Who is available to serve.
 *
 * Anybody alive, at liberty, holding nothing already, and allowed by the
 * constitution to hold this particular office — mayAlsoHold is what keeps the
 * Vice President and the bench out of a department. A player is eligible and
 * gets a nomination they can refuse; a synthetic person takes the post.
 */
function candidatesFor(world, byId2, seat) {
  const year = world.clock.ticksPerYear || 240;
  return Object.values(world.personas).filter((x) => {
    if (!x.alive || x.exiled || x.imprisoned) return false;
    if (R.officesOf(world, x.id).length) return false;
    // Somebody who let an offer of this post lapse is not asked again for a
    // year. See acts.tickNominations — without this the president re-offered
    // to the same silence on a loop and the seat was never actually free.
    const lapsed = x.lapsedOffers?.[seat.id];
    if (lapsed != null && world.clock.tick - lapsed < year) return false;
    return A.appointGate(world, byId2, seat.id, x.id).ok;
  });
}

/**
 * Fill the empty departments.
 *
 * A government that leaves the Department of State vacant for a decade is not
 * making a choice, it is an oversight — and until now it was not even that,
 * because the rules of appointment were locked inside an action handler that
 * only somebody with a playerId could reach. A Season with no human in the
 * chair ran its whole length with an empty cabinet.
 *
 * Who they pick is the ordinary politics of it: their own party first, because
 * a president appoints people who will agree with them, then whoever the
 * country thinks well of. The jitter is hashed off the appointer and the seat,
 * so a given president's cabinet is their cabinet and not a fresh roll.
 */
function appointCabinet(world, p) {
  if (!R.hasPower(world, p.id, 'appoint')) return;
  if (!chance(world, 0.35)) return;
  const mine = R.officesOf(world, p.id).map((o) => o.id);
  const vacancies = world.seats.filter((s) => {
    if (s.personaId) return false;
    const o = R.office(world, s.office);
    if (!o || o.selection !== 'appointment') return false;
    if (!mine.includes(o.appointedBy)) return false;
    return !(world.nominations || []).some((n) => n.seatId === s.id);
  });
  if (!vacancies.length) return;

  // Every vacancy, not the first. Taking `seats.find(...)` and giving up when
  // that one seat had nobody eligible meant a single unfillable department
  // starved the whole cabinet: the search returned at the same seat every time
  // and the two behind it were never looked at. Observed as a government that
  // filled one department in six years and then stopped.
  for (const vacancy of vacancies) {
    const pool = candidatesFor(world, p.id, vacancy);
    if (!pool.length) continue;
    const score = (x) => (x.party === p.party ? 2.4 : 0)
      + clamp((x.approval ?? 50) - 50, -25, 25) / 14
      + (x.reputation || 0) * 0.5
      + (hash01(p.id + '|' + vacancy.id + '|' + x.id) - 0.5) * 2;
    const best = pool.slice().sort((a, b) => score(b) - score(a))[0];
    // One appointment per sitting. A cabinet named in a single afternoon reads
    // as a list being filled in rather than as a government being formed.
    if (A.appoint(world, p.id, vacancy.id, best.id).ok) return;
  }
}

// --- The city --------------------------------------------------------------

/**
 * Rebuild.
 *
 * The one-way ratchet this exists to break: a fire, an eruption, a war takes a
 * building off the map, and nothing in the engine ever puts one back except a
 * player deciding to. Watched for twenty years, an ungoverned republic loses
 * four buildings, a thousand jobs and never recovers a single one of them —
 * structural unemployment goes 5.6% to 22% and stays there, whatever the
 * central bank does, because the jobs are simply gone. It is not a downturn, it
 * is a country quietly demolishing itself.
 *
 * So a government with money, empty ground and people out of work builds
 * something, through the same door the player's own button uses.
 */
function build(world, p) {
  if (!R.hasPower(world, p.id, 'zone')) return;
  // A builder breaks ground about twice as often as a frugal president does,
  // which over a term is the difference between a city that changed shape and
  // one that did not.
  if (!acts(world, p, 0.09 * (1 + dispositionOf(p).purse * 0.7))) return;
  // Already building something is enough for now. A country with three sites
  // open at once is a country that has stopped paying for anything else.
  if (world.city.parcels.some((x) => x.project)) return;

  // Which is worse, on one scale — not housing-first.
  //
  // The first cut built housing whenever more than 3% of the country was
  // sleeping outside, which is nearly always. So a republic that lost a factory
  // to a fire replaced it with low-income housing, over and over: the count of
  // buildings came back to where it started and the *jobs* never did, because a
  // Factory carries 900 of them and Low-Income Housing carries 60. Twenty years
  // on, a fully rebuilt city with structural unemployment two points worse than
  // when it burned.
  const homeless = world.districts.reduce((s, d) => s + d.homeless, 0);
  const pop = world.districts.reduce((s, d) => s + d.pop, 0) || 1;
  const roofNeed = ((homeless / pop) * 100 - 2) / 3;
  const workNeed = (world.economy.structural * 100 - 5) / 3;
  if (roofNeed < 0.4 && workNeed < 0.4) return;
  const key = roofNeed > workNeed ? 'housing_low'
    : workNeed > 2 ? 'factory'
      : 'market';

  const b = BUILDINGS[key];
  if (b.cost > world.economy.treasury * 0.4) return;

  const free = world.city.parcels
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => !x.building && !x.project);
  if (!free.length) return;
  const spot = free[Math.floor(rng(world) * free.length)];

  // Straight to the ground if the constitution lets them — an emergency in
  // force, or a republic whose executive may spend at that size.
  const gate = A.disburseGate(world, p.id, b.cost);
  if (gate.ok) {
    if (A.startProject(world, spot.i, key).ok) {
      A.noteDiscretion(world, b.cost, gate, p.id, b.name);
    }
    return;
  }
  // Otherwise the constitutional route, which is the one a player would have to
  // take: a capital project costs many times the discretionary threshold, so
  // the executive asks the chamber. Without this an NPC government could want
  // to rebuild, have the money, and be stopped by its own spending rule with no
  // way of ever asking — which is not a government, it is a spectator with a
  // treasury.
  if (!R.hasPower(world, p.id, 'propose_bill')) return;
  const pending = Object.values(world.documents || {}).some((d) =>
    d.authorId === p.id && ['draft', 'floor', 'awaiting-signature'].includes(d.status));
  if (pending) return;
  const d = world.districts.find((x) => x.id === spot.x.district);
  const doc = A.createDoc(world, {
    type: 'bill',
    title: `${b.name} for ${d?.name || 'the city'}`,
    authorId: p.id,
    preamble: key === 'housing_low'
      ? `Whereas there are people in ${d?.name || 'this city'} sleeping outside, and whereas the `
        + 'ground on which to house them is standing empty, this chamber orders it built.'
      : `Whereas ${(world.economy.structural * 100).toFixed(0)} in every hundred who want work `
        + `cannot find it, and whereas ${d?.name || 'the city'} has ground standing idle, this `
        + 'chamber orders work begun on it.',
    clauses: [{ kind: 'BUILD', building: key, parcel: spot.i }],
  });
  if (!doc || doc.ok === false) return;
  // A draft that never reached the floor is a deadlock, not a document. The
  // `pending` guard above counts drafts, so one failed introduce left this
  // government unable to propose anything ever again — observed as a republic
  // that broke ground zero times in twenty years while its city burned down
  // around it. Take it back off the table.
  if (!A.introduce(world, doc.id, p.id, 60).ok) {
    delete world.documents[doc.id];
    world.docOrder = (world.docOrder || []).filter((id) => id !== doc.id);
  }
}

// --- Abroad ----------------------------------------------------------------

/**
 * Receive the ambassador of whoever is angriest, and say the obvious thing.
 *
 * A hostile power left alone rearms — see sim.tickWar — so a government that
 * never opens the Department of State is a government walking into a war it was
 * warned about. Terms if the treasury will stand it and the hostility is bad
 * enough to be worth the money; reassurance otherwise, which is free and small.
 */
function diplomacy(world, p) {
  if (!R.mayEnterDept(world, p.id, 'state')) return;
  const es = DEP.envoys(world);
  // Anyone already in the building gets their business done, and not on a dice
  // roll: a government that summoned an ambassador and then failed to say
  // anything to them before the audience lapsed is worse than one that never
  // called. Deciding to call is the part that is occasional.
  const open = (world.foreign || []).find((f) => DEP.audienceOpen(world, es[f.id]) && !es[f.id].spoke);
  const disp = dispositionOf(p);
  if (open) {
    const f = open;
    const rich = A.disburseGate(world, p.id, DEP.APPROACHES.terms.cost).ok;
    // Where the line between a demand and a reassurance falls is a matter of
    // nerve. A hawk puts terms to a country an emollient one would still be
    // soothing at the same hostility.
    DEP.talk(world, p.id, f.id, f.hostility >= 55 - disp.nerve * 18 && rich ? 'terms' : 'reassure');
    return;
  }
  if (!acts(world, p, 0.1)) return;
  const target = (world.foreign || [])
    .filter((f) => !f.atWar && !DEP.audienceOpen(world, es[f.id]) && DEP.recallLeft(world, es[f.id]) <= 0)
    .sort((a, b) => b.hostility - a.hostility)[0];
  // And how bad it has to get before they think it worth a conversation. The
  // one who would rather talk starts talking earlier.
  if (!target || target.hostility < 30 + disp.nerve * 10 - disp.patience * 6) return;
  DEP.receive(world, p.id, target.id);
}

// ---------------------------------------------------------------------------

/**
 * One turn of a government nobody is playing.
 *
 * Order is urgency: what is on fire, then what is on the desk, then the money,
 * then the world. Called from sim.tick.
 */
// Suing for peace.
//
// An NPC head of government used to fight every war to the last division. The
// machinery to end one by agreement was all there — a treaty of peace, put to the
// enemy, ratified by the chamber — but nothing in the disposition ever reached
// for it, so a war it could not win ran on until the front hit the wall and the
// country was overrun. Now, once a war has ground on long enough to cost
// something and it is not being won, the head of government sues for terms.
// Whether the enemy grants them is the enemy's call (depts.weighAssent, peace
// path: a winning enemy refuses, an even or beaten one may not).
const PEACE_FRONT = 10;             // "not winning it": the front at or below this
const PEACE_MIN_EXHAUSTION = 0.2;   // and only once the war has actually cost something

function sueForPeace(world, p) {
  // And *when* is the disposition. A hawk has to be losing considerably worse,
  // for considerably longer, before they will put their name to a treaty; the
  // one who would rather talk goes looking for terms while the line is still
  // roughly where it started. Same machinery, two different wars.
  const disp = dispositionOf(p);
  const front = PEACE_FRONT - disp.nerve * 9 + disp.patience * 3;
  const worn = clamp(PEACE_MIN_EXHAUSTION + disp.nerve * 0.14 - disp.patience * 0.06, 0.05, 0.6);
  for (const f of world.foreign || []) {
    if (!f.atWar) continue;
    const war = DEP.liveWar(world, f.id);
    if (!war) continue;
    if (war.front > front) continue;                           // winning it — fight on
    if ((world.military.exhaustion || 0) < worn) continue;
    // One overture at a time per war: a peace already in flight is not re-tabled.
    const pending = Object.values(world.documents || {}).some((d) =>
      ['draft', 'awaiting-assent', 'floor', 'awaiting-signature'].includes(d.status)
      && (d.clauses || []).some((c) => c.kind === 'TREATY_PEACE' && c.party === f.id));
    if (pending) continue;
    const doc = A.createDoc(world, {
      type: 'treaty',
      title: `Treaty of peace with ${f.name}`,
      authorId: p.id,
      preamble: war.front < -20
        ? `The war with ${f.name} is being lost on the ground, and ${world.nation} seeks terms before more of it is.`
        : `The war with ${f.name} has settled into a stalemate that bleeds the republic to no end, and ${world.nation} seeks terms.`,
      clauses: [{ kind: 'TREATY_PEACE', party: f.id }],
    });
    if (!doc || doc.ok === false) continue;
    if (!A.introduce(world, doc.id, p.id, 60).ok) {
      delete world.documents[doc.id];
      world.docOrder = (world.docOrder || []).filter((id) => id !== doc.id);
      continue;
    }
    return; // one overture per turn
  }
}

/**
 * Terms, when the other side is beaten and waiting for them.
 *
 * `acts.dictateTerms` is executive-only and no NPC ever called it, so a
 * synthetic president who won a war took nothing from it: the window opened,
 * `tickDictate` let it lapse, and Canada surrendered to a government that
 * could not think of anything to ask for. Every war an NPC won ended in a white
 * peace — which made winning one worth exactly as much as not fighting it.
 *
 * What they ask for is their disposition. A hawk takes most of what is on the
 * table; an emollient one takes an indemnity and leaves the border alone,
 * because land taken is a grievance that outlives the government that took it.
 * All of it goes through the same door and the same caps a player's click does.
 */
function dictate(world, p) {
  if (!R.hasPower(world, p.id, 'sign_treaty')) return;
  const pending = (world.dictate || []).find((d) => world.clock.tick <= d.until);
  if (!pending) return;
  const f = (world.foreign || []).find((x) => x.id === pending.foreignId);
  if (!f) return;
  const disp = dispositionOf(p);
  const room = A.territoryLeft(world, f);
  const cap = A.indemnityCap(world, f);
  // Some of them will not take a third of a country when the whole of it is
  // three months away. Nerve is the whole of it, and the state of the war is
  // the other half: a hawk with the front on the enemy's capital and a country
  // that is not yet sick of the fighting refuses the surrender and goes on. It
  // costs them exactly what it costs a player — see acts.pressOn — including
  // the ones who then lose the war they had already won.
  const war = (world.military?.wars || []).filter((x) => x.foreign === f.id).at(-1);
  if (!pending.total && disp.nerve >= 0.4 && room > 40 && war && !war.pressed
    && war.front >= 80 && (world.military.exhaustion || 0) < 0.5 && acts(world, p, 0.5)) {
    const res = A.pressOn(world, p.id, f.id);
    if (res?.ok) return;
  }
  // Nerve decides how much of what is on the table they reach for; a builder's
  // purse tilts them toward money over ground, which they have to garrison.
  const land = Math.round(clamp(0.15 + disp.nerve * 0.7, 0, 0.85) * room);
  const cash = Math.round(clamp(0.3 + disp.purse * 0.5 - disp.nerve * 0.15, 0, 0.9) * cap);
  const res = A.dictateTerms(world, p.id, f.id, { cede: land, indemnity: cash });
  if (res?.ok === false) return;
  log(world, 'war', `${p.name} dictates the terms of the peace with ${f.name}.`,
    { actors: [p.id], weight: 3 });
}

export function tickExecutive(world, ballot) {
  if (world.phase !== 'live') return;
  if (world.clock.tick % CADENCE !== 0) return;
  const p = npcHead(world);
  if (!p) return;
  // The whole point of the summit's week is that the office is empty while it
  // runs. That has to be true of an NPC too, or the cost is a player-only rule.
  if (R.abroad(world, p.id)) return;
  answerCrises(world, p);
  clearTheDesk(world, p, ballot);
  // Before suing for peace: a beaten enemy is waiting on an answer, and the
  // window is short.
  dictate(world, p);
  sueForPeace(world, p);
  appointCabinet(world, p);
  emergency(world, p);
  warBill(world, p);
  rescue(world, p);
  spend(world, p);
  build(world, p);
  diplomacy(world, p);
}

// --- The departments -------------------------------------------------------
// A Secretary is not a second President and must not read like one. They run
// one building, they act inside it, and they do it rarely — a department that
// moved every time the chair did would make the cabinet feel like extra arms on
// the same person rather than three people with three jobs. So this runs on its
// own slower clock and each secretary acts on a small chance within it.
//
// What they do is what their room is for, and nothing else. State moves
// hostility. Defense draws plans and puts divisions where the border is. The
// Treasury sets a rate — but only where the constitution left the central bank
// captured, because an independent one is not theirs to touch, and that clause
// is the whole point of it existing.

/** How often a department looks up from its work. Five times the chair's clock. */
export const DEPT_CADENCE = CADENCE * 5;

/** The synthetic holder of a department, or null if it is empty or played. */
function npcSecretary(world, deptId) {
  const seat = world.seats.find((s) => s.office === deptId && s.personaId);
  const p = seat && world.personas[seat.personaId];
  if (!p || !p.synthetic || !p.alive || p.imprisoned || p.exiled) return null;
  if (R.abroad(world, p.id)) return null;
  return p;
}

/** State: keep the angriest neighbour talking. */
function runState(world, p) {
  const es = DEP.envoys(world);
  const open = (world.foreign || []).find((f) => DEP.audienceOpen(world, es[f.id]) && !es[f.id].spoke);
  // A Secretary has a disposition too, and it is their own — a hawkish Foreign
  // Secretary under an emollient President is a government arguing with itself
  // in public, which is the most interesting thing a cabinet can do.
  const disp = dispositionOf(p);
  if (open) {
    const rich = A.disburseGate(world, p.id, DEP.APPROACHES.terms.cost).ok;
    // A Secretary presses harder than a President dares. Reading another
    // country's intentions is this department's own product, and it is the one
    // thing nobody else in the government can get.
    const kind = open.hostility >= 55 - disp.nerve * 16 && rich ? 'terms'
      : open.hostility >= 45 - disp.nerve * 12 ? 'press'
        : 'reassure';
    DEP.talk(world, p.id, open.id, kind);
    return;
  }
  if (!acts(world, p, 0.3)) return;
  const target = (world.foreign || [])
    .filter((f) => !f.atWar && !DEP.audienceOpen(world, es[f.id]) && DEP.recallLeft(world, es[f.id]) <= 0)
    .sort((a, b) => b.hostility - a.hostility)[0];
  if (!target || target.hostility < 25 + disp.nerve * 8 - disp.patience * 5) return;
  DEP.receive(world, p.id, target.id);
}

/** Defense: a plan against whoever is likeliest to come, and men on that border. */
function runDefense(world, p) {
  const threat = (world.foreign || [])
    .filter((f) => !f.allied)
    .sort((a, b) => (b.atWar ? 200 : b.hostility) - (a.atWar ? 200 : a.hostility))[0];
  if (!threat) return;
  const plan = DEP.planFor(world, threat.id);
  // A plan goes stale. Drawing one against the country most likely to come is
  // the whole argument for the department — see depts.effectiveness, which is
  // the difference between fighting at six tenths and fighting at full weight.
  if (!plan || !plan.ready) {
    DEP.draftPlan(world, p.id, threat.id, threat.atWar ? 'offensive' : 'defensive');
    return;
  }
  const disp = dispositionOf(p);
  const reserve = DEP.inReserve(world);
  // What counts as a border worth putting men on. A nervy Secretary of Defense
  // moves divisions at a hostility a cautious one is still calling a
  // disagreement, and commits more of the reserve when they do.
  if (reserve > 0 && (threat.atWar || threat.hostility >= 50 - disp.nerve * 14)) {
    const send = Math.min(disp.nerve > 0.2 ? 3 : 2, reserve);
    DEP.deploy(world, p.id, threat.id, DEP.committedTo(world, threat.id) + send);
    return;
  }
  // Raising divisions costs more than any ordinary threshold allows, so this
  // almost always refuses — correctly. It goes through the same gate a player's
  // click does, and a department cannot vote itself an army.
  if (threat.hostility >= 65 - disp.nerve * 10) DEP.mobilize(world, p.id, 1);

  // The three verbs a war gives this room that peace does not. They were the
  // player's alone: an NPC government fought every war with the army it started
  // with, never bought an aeroplane, never flew a raid and never asked an ally
  // to put a force ashore, so a Season nobody was playing was a Season in which
  // half the Department of Defense did not exist.
  if (!threat.atWar) return;
  const war = DEP.liveWar(world, threat.id);
  if (!war) return;
  // An air force is bought before it is used, and it is bought by governments
  // that expect to need one. Through the same gate as any other money.
  if ((world.military.airforce || 0) < 1 + disp.nerve * 3 && acts(world, p, 0.25)) {
    if (DEP.commissionAir(world, p.id, 1)?.ok) return;
  }
  // Bombing wears a country's stomach for the war out faster than the front
  // does, which is exactly what a president who wants terms is short of.
  if ((world.military.airforce || 0) >= 1 && acts(world, p, 0.35 + disp.nerve * 0.25)) {
    if (DEP.bomb(world, p.id, threat.id)?.ok) return;
  }
  // And a second front, if anybody signed for one. A cautious government does
  // not ask; a nervy one asks the moment the war is worth winning.
  if (!war.landing && war.front > -40 && acts(world, p, 0.15 + disp.nerve * 0.3)) {
    DEP.landAllies(world, p.id, threat.id);
  }
}

/**
 * An army, which costs more than any executive is allowed to spend on its own.
 *
 * This is the hole the whole department fell down. Raising a division costs six
 * million and a president's discretionary allowance is five, so every road to
 * an army an NPC government could reach was refused — correctly, by the same
 * gate a player's click meets. The player's answer to that gate is to file a
 * bill; the synthetic executive had no such answer, so it fought every war with
 * the four divisions the republic was founded with, lost them to attrition, and
 * then lost the war. Five wars in twenty-nine years, five defeats, and a
 * standing army of zero.
 *
 * So it asks the chamber, which is what the chamber is for. The bill goes
 * through createDoc and introduce like any other, the members vote on it as
 * they vote on anything, and it can be refused.
 */
function warBill(world, p) {
  if (!R.mayPropose(world, p.id, 'bill').ok) return;
  // One at a time, and never while the floor is busy with something else.
  if (Object.values(world.documents).some((d) => d.status === 'floor')) return;
  const disp = dispositionOf(p);
  const enemy = (world.foreign || []).find((f) => f.atWar);
  const threat = enemy || (world.foreign || []).filter((f) => !f.allied && !f.absorbed)
    .sort((a, b) => b.hostility - a.hostility)[0];
  if (!threat) return;
  if (!enemy && threat.hostility < 70 - disp.nerve * 15) return;
  // What the other side can field, against what we can. Divisions in training
  // count: a government does not order the same army twice.
  const theirs = Math.ceil(DEP.enemyWeight(threat));
  const ours = (world.military.units || 0) + DEP.formingCount(world);
  // Parity in peacetime, and a margin once the shooting starts. Eight tenths
  // was the target and it is exactly the wrong one: a government that arms to
  // four fifths of its neighbour arrives at every war four fifths as strong as
  // the other side and loses it, having paid for the army anyway. If a power is
  // hostile enough to be worth arming against at all, it is worth matching.
  if (ours >= theirs * (enemy ? 1.1 : 0.95)) return;
  if (!acts(world, p, enemy ? 0.5 : 0.2)) return;
  const want = Math.max(1, Math.min(6, Math.ceil((theirs * (enemy ? 1.25 : 1.05)) - ours)));
  // And aeroplanes, while the chamber is being asked. A wing costs more than
  // any allowance runs to, so this instrument is the only way an air force is
  // ever bought in a republic with a chamber — see CLAUSES.RAISE_AIRWINGS.
  const wings = enemy && (world.military.airforce || 0) < 2 && disp.nerve > 0 ? 1 : 0;
  const cost = want * DEP.DIVISION_COST + wings * DEP.AIRWING_COST;
  if (cost > world.economy.treasury * 0.6) return;   // not with money the country does not have

  const doc = A.createDoc(world, {
    type: 'bill',
    title: enemy ? `An Act to reinforce the line against ${threat.name}` : `An Act for the defence of ${world.nation}`,
    preamble: enemy
      ? `${threat.name} fields ${theirs} divisions against our ${ours}. The government asks the chamber for the difference.`
      : `${threat.name} is arming, and this republic is not. The government asks the chamber to raise ${want} division${want === 1 ? '' : 's'} before it has to.`,
    authorId: p.id,
    clauses: wings
      ? [{ kind: 'RAISE_DIVISIONS', count: want }, { kind: 'RAISE_AIRWINGS', count: wings }]
      : [{ kind: 'RAISE_DIVISIONS', count: want }],
  });
  if (!doc || doc.ok === false) return;
  const res = A.introduce(world, doc.id, p.id, 60);
  if (res && res.ok === false) return;
  log(world, 'war', `${p.name} puts an army to the chamber: ${want} division${want === 1 ? '' : 's'}, ${moneyExact(cost)}.`,
    { actors: [p.id], docId: doc.id, weight: 3 });
}

/**
 * The emergency power, in the hands of somebody who is not a player.
 *
 * It was the one executive power no synthetic president ever touched, which
 * made it a player-only mechanic: the constitution's most dangerous clause
 * could only ever be used by the person reading this sentence. Now it is used
 * the way it would be — mostly for the crisis it exists for, and occasionally,
 * by somebody with the nerve for it and an unhappy country, for nothing at all.
 * director.declareEmergency already prices a naked one; this only decides.
 */
function emergency(world, p) {
  const c = world.constitution?.emergency;
  if (!c || !R.hasPower(world, p.id, 'emergency')) return;
  const disp = dispositionOf(p);
  const nat = (world.districts || []).reduce((a, d) => a + (d.mood || 50), 0) / ((world.districts || []).length || 1);

  if (world.emergency?.active) {
    // Lifting it is a decision too, and the one a patient person makes sooner.
    // An emergency declared on nothing by somebody who has since been replaced
    // is exactly the thing a successor is elected to end.
    const theirs = world.emergency.by === p.id;
    const cause = D.emergencyCause(world);
    if (!cause.ok && (!theirs || disp.nerve < 0.2) && acts(world, p, 0.2 + disp.patience * 0.2)) {
      D.endEmergency(world, p.id);
    }
    return;
  }
  const cause = D.emergencyCause(world);
  if (cause.ok) {
    if (acts(world, p, 0.12 + disp.nerve * 0.15)) {
      D.declareEmergency(world, p.id, `${cause.why} — the ordinary powers of this office are not equal to it.`);
    }
    return;
  }
  // A naked one. Rare on purpose, and only from the sort of person who would:
  // nerve, an unpopular government, and no patience left for the chamber.
  if (disp.nerve < 0.45 || nat > 42) return;
  if (!chance(world, 0.02)) return;
  D.declareEmergency(world, p.id,
    'The condition of the country requires a government able to act without waiting on a vote.');
}

/**
 * The Treasury: mind the rate, where it is theirs to mind.
 *
 * `constitution.centralBank.independent` is a clause, not a setting. Where the
 * republic founded an independent bank, the Taylor rule already runs the rate
 * and a Secretary reaching for it would be the constitutional crisis the clause
 * exists to prevent. Where the bank is captured, somebody has to actually
 * decide — and an unattended captured bank simply left the rate where it was
 * founded, for ever, whatever prices did.
 */
function runTreasury(world, p) {
  if (world.constitution?.centralBank?.independent) return;
  if (!acts(world, p, 0.4)) return;
  const e = world.economy;
  const want = MACRO.taylorRate(world);
  const now = e.policyRate ?? 0.04;
  const disp = dispositionOf(p);
  if (Math.abs(want - now) < 0.004) return;
  // A quarter of the way, not all of it. A finance ministry that jumped
  // straight to the model's answer would be an independent central bank wearing
  // a different hat, and the difference between the two is meant to be visible.
  //
  // How big a quarter is, though, is a matter of nerve: a bold Chancellor moves
  // in something closer to halves and a cautious one in eighths, so two
  // captured banks reading the same Taylor rule take visibly different numbers
  // of years to get where it is pointing.
  const step = clamp(0.25 + disp.nerve * 0.18 - disp.patience * 0.08, 0.08, 0.5);
  MACRO.setPolicyRate(world, now + (want - now) * step);
  log(world, 'money', `${p.name} moves the policy rate to ${((e.policyRate) * 100).toFixed(2)}%.`,
    { actors: [p.id], weight: 1 });
}

/** One turn of the departments nobody is playing. */
export function tickDepartments(world) {
  if (world.phase !== 'live') return;
  if (world.clock.tick % DEPT_CADENCE !== 0) return;
  for (const [dept, run] of [['state', runState], ['defense', runDefense], ['exchequer', runTreasury]]) {
    const p = npcSecretary(world, dept);
    // Rarely. A cabinet that acted every window would be three more presidents.
    // How rarely is the secretary's own business — a restless one at this desk
    // is heard from most windows, a cautious one perhaps twice a year.
    if (p && acts(world, p, 0.45)) run(world, p);
  }
}

// --- The chamber, when a player is losing the country ----------------------
// A player who has run the country down to a national approval below
// IMPEACH_THRESHOLD has crossed the line where a chamber that answers to its
// districts will start moving. This is not a punishment — a Season without any
// consequence for governance would be a game about pressing buttons — and it
// is not automatic: the *opportunity* opens, and an opposition member picks
// it up on a chance. The trial then runs through the ordinary machinery, so
// the president can still fight it on the floor, and NPC members vote by the
// same standing rule everyone else uses.
//
// Deliberately player-only. An NPC president losing the country to an NPC
// chamber is a sim story that nobody reads; a player being impeached is the
// player's own consequence, and it is the case worth building for.

export const IMPEACH_THRESHOLD = 30;
export const IMPEACH_CADENCE = 60;
/** After an attempt fails or lands, hold off this long before trying again. */
export const IMPEACH_COOLDOWN = 168;
// How much a naked state of emergency spikes the opposition's willingness to file.
export const EMERGENCY_IMPEACH_SPIKE = 0.5;

/** Whoever is sitting in the head chair, and whether a player is playing them. */
function headSeated(world) {
  const head = R.headOffice(world);
  if (!head) return null;
  const seat = world.seats.find((s) => s.office === head.id && s.personaId);
  const p = seat && world.personas[seat.personaId];
  if (!p || !p.alive || p.imprisoned || p.exiled) return null;
  const played = Object.values(world.players || {}).some((pl) => pl.personaId === p.id);
  return { seat, persona: p, played };
}

/** Is there already a live articles-of-impeachment doc against this person? */
function liveImpeachAgainst(world, personaId) {
  for (const id of world.docOrder || []) {
    const doc = world.documents[id];
    if (!doc || doc.type !== 'impeachment') continue;
    // `!= null`, not truthy: `promulgated` is a tick, and tick 0 is a real one.
    // A law promulgated on the founding tick read as still pending here.
    if (doc.promulgated != null || doc.struck) continue;
    if ((doc.clauses || []).some((c) => c.kind === 'REMOVE' && c.persona === personaId)) return doc;
  }
  return null;
}

/**
 * Open a proceeding, once the opportunity is ripe and an opposition member is
 * willing to file. Runs on IMPEACH_CADENCE, so at most every ~15 canon weeks.
 */
export function tickChamberImpeach(world, syntheticBallot) {
  if (world.phase !== 'live') return;
  if (world.clock.tick % IMPEACH_CADENCE !== 0) return;

  const seated = headSeated(world);
  if (!seated || !seated.played) return;                        // NPC presidents are not the target of this
  const approval = (Object.values(world.districts).reduce((a, d) => a + (d.mood || 50), 0) / (world.districts.length || 1));
  // A state of emergency declared on nothing (or on a lie) is itself grounds: the
  // chamber will move even when approval is otherwise too high for articles.
  const naked = !!(world.emergency?.active && (world.emergency.noCause || world.emergency.pretext));
  if (approval >= IMPEACH_THRESHOLD && !naked) return;
  if (liveImpeachAgainst(world, seated.persona.id)) return;

  // Cooldown: a fresh attempt every fortnight is harassment, not a check.
  const last = world.impeachAttempts?.[seated.persona.id] || 0;
  if (last && world.clock.tick - last < IMPEACH_COOLDOWN) return;

  // Who may bring articles: any assembly member of an opposition party will
  // do. The proposalRights list is in the constitution; the party check keeps
  // the president's own caucus from filing against them.
  const rights = world.constitution.impeachment?.proposalRights || [];
  const oppositionLean = seated.persona.party
    ? (PARTIES.find((x) => x.id === seated.persona.party) || PARTIES[0]).lean * -1
    : 0;
  const filers = world.seats
    .filter((s) => rights.includes(s.office) && s.personaId && s.personaId !== seated.persona.id)
    .map((s) => world.personas[s.personaId])
    .filter((mp) => mp && mp.alive && !mp.imprisoned && !mp.exiled && mp.synthetic
      && mp.party !== seated.persona.party);
  if (!filers.length) return;

  // Willingness scales with how far the country has fallen and with how
  // opposed they are. A member of an ideologically-adjacent party is a
  // reluctant filer; a distant one moves at the first opportunity.
  const gap = (IMPEACH_THRESHOLD - approval) / IMPEACH_THRESHOLD;      // 0…1
  const distance = Math.abs(oppositionLean) || 0.5;
  let p0 = clamp(0.35 + gap * 0.55, 0.25, 0.9) * (0.6 + distance * 0.6);
  // A naked emergency spikes the willingness sharply, easing exponentially the
  // more the country approves of the government past 55%.
  if (naked) p0 += EMERGENCY_IMPEACH_SPIKE * Math.exp(-Math.max(0, approval - 55) / 15);
  if (!chance(world, clamp(p0, 0, 0.97))) return;

  // Pick the readiest filer: highest personal standing among the opposition.
  filers.sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
  const filer = filers[0];

  const doc = A.createDoc(world, {
    type: 'impeachment',
    title: `Articles of impeachment against ${seated.persona.name}`,
    preamble: `The country's approval of the government has stood at ${Math.round(approval)}%, and the chamber is asked to remove the ${R.headOffice(world)?.name || 'executive'} from office.`,
    authorId: filer.id,
    clauses: [
      { kind: 'PROSE', text: `Whereas national approval has fallen to ${Math.round(approval)}%, below the level at which the chamber owes its districts a reckoning.` },
      { kind: 'REMOVE', persona: seated.persona.id },
    ],
  });
  if (!doc || doc.ok === false) return;
  const res = A.introduce(world, doc.id, filer.id, 90);
  if (res && res.ok === false) return;

  world.impeachAttempts = world.impeachAttempts || {};
  world.impeachAttempts[seated.persona.id] = world.clock.tick;

  log(world, 'crisis', `${filer.name} moves articles of impeachment against ${seated.persona.name}. Approval stands at ${Math.round(approval)}%.`,
    { actors: [filer.id, seated.persona.id], docId: doc.id, weight: 4 });
}

// --- The private sector, when nobody is playing it --------------------------
//
// Every company in the game was founded by a player, so a Season with one
// player had exactly one company in it — and a Season where that player stayed
// in politics had none. Half the board was a career nobody was on: the
// valuation multiple moved for nobody, the tax code was nobody's margin, no
// employer ever failed, and the bankruptcy model, the credit-loss channel and
// the rescue the treasury can now pay for had nothing to happen to.
//
// So the country founds its own. These are not simulated founders with a plan —
// they are the obvious thing a business does with the money it has: hire while
// there are desks and wages, buy a desk when there are none, take the company
// public when it is big enough to be worth it, put their own money in when it
// is drowning, and sell up if somebody has been at it long enough. All of it
// through the same functions a player's clicks reach, so a synthetic company
// obeys every rule a player's does and can be read on the same page.

/** How many synthetic companies the republic keeps trading. */
export const NPC_COMPANIES = 3;
/** How often anybody thinks about founding one. */
export const FOUNDING_WINDOW = 60;

/**
 * The odds a synthetic founder bids for a healthy player company, per look.
 *
 * They look every CADENCE ticks, so three of them look sixty times a year. At
 * a half a percent that is one unsolicited offer roughly every four years —
 * rare enough to be an event, common enough that a founder who never fails
 * still meets the question of what their company is worth to somebody else.
 * A company in trouble is not gated by this; see runCompany.
 */
export const BID_UNSOLICITED = 0.005;

/**
 * What a company is called, by what it actually does.
 *
 * The trade word used to be drawn from one flat list while the sector was drawn
 * separately, so the country founded "Hellhound Ironworks — software and
 * machines that think" and "Tolliver Engineering — software". The name is the
 * only thing most players ever read about a synthetic company; it should not
 * contradict the one line printed beside it.
 */
const TRADE_BY_SECTOR = {
  works: ['Ironworks', 'Yards', 'Mills', 'Foundry', 'Works', 'Engineering', 'Timber'],
  trade: ['Shipping', 'Freight', 'Chandlery', 'Traders', 'Import Co.', 'Warehousing'],
  provisions: ['Brewing', 'Provisions', 'Bakeries', 'Grocers', 'Victuallers'],
  finance: ['& Co.', 'Assurance', 'Bank', 'Underwriters', 'Trust'],
  tech: ['Instruments', 'Optics', 'Systems', 'Computing', 'Laboratories'],
};
const TRADE_FALLBACK = ['Works', 'Yards', 'Mills', 'Engineering', '& Co.'];
const tradeWords = (sectorId) => TRADE_BY_SECTOR[sectorId] || TRADE_FALLBACK;

/** A name for a company nobody has thought about very hard. */
function companyName(world, sectorId = null) {
  const p = Object.values(world.personas);
  const words = tradeWords(sectorId);
  for (let i = 0; i < 40; i++) {
    const who = p[Math.floor(rng(world) * p.length)];
    const last = String(who?.name || 'Ash').split(' ').pop();
    const trade = words[Math.floor(rng(world) * words.length)];
    const name = rng(world) < 0.3 ? `${last} & Sons` : `${last} ${trade}`;
    if (!(world.companies || []).some((c) => !c.closed && c.name.toLowerCase() === name.toLowerCase())) return name;
  }
  return `Ash Works ${(world.companies || []).length + 1}`;
}

/** Somebody with no office, no company, and no seat waiting for them. */
function anEntrepreneur(world) {
  const people = Object.values(world.personas).filter((x) =>
    x.synthetic && x.alive && !x.exiled && !x.imprisoned && !x.playerId
    && !R.officesOf(world, x.id).length
    && !(world.companies || []).some((c) => c.founderId === x.id && !c.closed));
  if (!people.length) return null;
  // Ambition, of a sort: the ones with an appetite for risk try it, and one who
  // has already failed at it is slower to try again than one who has not.
  const scored = people.map((x) => ({
    x,
    w: Math.max(0.05, 0.5 + temperamentOf(x).interest * 0.8 - (x.bankruptcies || 0) * 0.35 + (x.soldCompanies || 0) * 0.2),
  }));
  const total = scored.reduce((s, r) => s + r.w, 0);
  let roll = rng(world) * total;
  return (scored.find((r) => (roll -= r.w) <= 0) || scored[0]).x;
}

/**
 * The card on the desk, answered by the person whose desk it is.
 *
 * These used to be dealt only to played companies, which made the synthetic
 * private sector the one part of the board nothing happened to: it compounded,
 * quietly, while a player answered a walkout every year and paid for it. Now it
 * gets the same post, and the answer comes out of `takenBy` on each option —
 * see company.CO_EVENTS. A hawkish founder sits a strike out; an emollient one
 * settles it and carries the wage premium afterwards.
 *
 * And some of it goes unopened. A card ignored is an answer, and it is the
 * expensive one — see company.expireEvents, which charges for it either way.
 */
function answerCard(world, co, p) {
  const ev = CO.openEvent(co);
  if (!ev || ev.npcIgnored) return false;
  const d = dispositionOf(p);
  if (ev.npcSeen == null) {
    ev.npcSeen = world.clock.tick || 1;
    // Whether it is worth their attention at all, decided once. The impatient
    // let more of it slide, and pay the ignore price when the deadline lands.
    if (chance(world, clamp(0.12 - d.patience * 0.15, 0.02, 0.3))) {
      ev.npcIgnored = true;
      return false;
    }
  }
  const tpl = CO.CO_EVENTS.find((t) => t.id === ev.id);
  if (!tpl) return false;
  const pool = tpl.options
    .map((o, i) => ({ i, cost: o.cost || 0, w: Math.max(0.05, o.takenBy ? o.takenBy(d) : 1) }))
    .filter((x) => !x.cost || (co.cash || 0) >= x.cost);
  if (!pool.length) return false;
  const total = pool.reduce((s, x) => s + x.w, 0);
  let roll = rng(world) * total;
  const chosen = pool.find((x) => (roll -= x.w) <= 0) || pool[0];
  const res = CO.answerEvent(world, co, ev.uid, chosen.i);
  if (!res.ok) return false;
  log(world, 'money', `${co.name}: ${ev.title.toLowerCase()}. ${res.value.note}`,
    { actors: [p.id], weight: 2 });
  return true;
}

/** What a founder does with their company this window. */
function runCompany(world, co) {
  const p = world.personas?.[co.founderId];
  if (!p) return;
  const disp = dispositionOf(p);
  const staff = (co.employees || []).length;

  // The post first. It is the only thing on this list with a deadline on it,
  // and a company in trouble may be in trouble because of it.
  if (answerCard(world, co, p)) return;

  // Drowning: the two moves a founder has, in the order a founder has them.
  // Their own money first — it is the only cure for insolvency that does not
  // need the business to get better — and a building after that, which is the
  // decision where a founder chooses the company over the people in it.
  if (co.distress) {
    const need = Math.max(Math.round(co.unpaid || 0), Math.round(-CO.equity(world, co)), 0);
    if ((p.wallet || 0) > 0 && need > 0) {
      CO.injectCapital(world, p.id, Math.min(p.wallet, Math.round(need * 1.1)));
    }
    if (CO.distressOf(world, co) && (co.buildings || 1) > 1 && chance(world, 0.35)) {
      const res = CO.sellBuilding(world, co);
      if (res.ok) {
        log(world, 'money', `${co.name} sells a building to stay open. `
          + `${res.value.letGo.length ? `${count(res.value.letGo.length, 'person', 'people')} go with it.` : 'The desks were empty anyway.'}`,
        { actors: [p.id], weight: 2 });
      }
    }
    return;
  }

  // Somebody else's company, going cheap because it is going under. A buyer
  // takes the staff and the debt with it, which is why only a company with
  // money does this and why nerve decides whether they bother. See
  // company.acquire — the alternative for everyone in the target is that it is
  // wound up and they all go home.
  const rivals = (world.companies || []).filter((c) => !c.closed && c.id !== co.id);
  const prey = rivals.find((c) => c.distress && !world.personas?.[c.founderId]?.playerId);
  if (prey && chance(world, 0.3 + disp.nerve * 0.3)) {
    const price = CO.acquisitionPrice(world, prey);
    if ((co.cash || 0) > price.toSeller * 1.5 + CO.BUILDING_COST) {
      const res = CO.acquire(world, co, prey);
      if (res.ok) {
        log(world, 'money', `${co.name} buys ${prey.name} for ${moneyExact(res.value.toSeller)}`
          + `${res.value.staff ? `, and the ${res.value.staff} people in it keep their jobs` : ''}. `
          + 'It was weeks from being wound up.',
        { actors: [p.id, prey.founderId].filter(Boolean), weight: 3 });
        return;
      }
    }
  }

  // The same want, aimed at a player. It cannot be taken, so it is offered — and
  // the offer is announced, clocked and answered by the person whose company it
  // is. See company.offerBid. A business in trouble draws one readily, because
  // the alternative for everybody in it is that it is wound up; a business doing
  // well draws one about once every four years across the whole private sector,
  // which is often enough to be a thing that happens to founders and rare enough
  // that it stays an event when it does.
  const marks = rivals.filter((c) => world.personas?.[c.founderId]?.playerId && !CO.openBid(c));
  const mark = marks.find((c) => c.distress) || marks[0];
  if (mark && chance(world, mark.distress ? 0.25 + disp.nerve * 0.3 : BID_UNSOLICITED)) {
    const price = CO.acquisitionPrice(world, mark);
    if ((co.cash || 0) > price.toSeller * 1.5 + CO.BUILDING_COST) {
      const res = CO.offerBid(world, mark, co);
      if (res.ok) return;   // tickBids announces it; the founder answers or does not
    }
  }

  // Money into politics. A company with more cash than it can spend on itself
  // and a founder with a side gives to that side — and gives to a candidate
  // while an election is open, which is the channel the whole lobbying and
  // donation model existed for and which nobody but a player ever used. On the
  // record, through the same door and the same caps. See company.donateParty.
  if ((co.cash || 0) > 60e6 && p.party && chance(world, 0.04)) {
    const open = (world.elections || []).filter((e) => e.status === 'nominations' || e.status === 'open');
    const cand = open.flatMap((e) => e.candidates || [])
      .find((c) => world.personas?.[c.personaId]?.party === p.party);
    const give = Math.min(5e6, Math.round((co.cash || 0) * 0.1));
    if (cand) {
      const res = CO.donateCampaign(world, co, p.id, cand.personaId, give);
      if (res.ok) {
        log(world, 'money', `${co.name} puts ${moneyExact(res.value.given)} behind ${world.personas[cand.personaId]?.name}'s campaign. On the record.`,
          { actors: [p.id, cand.personaId], weight: 2 });
        return;
      }
    }
    const res = CO.donateParty(world, co, p.id, p.party, give);
    if (res.ok) {
      log(world, 'money', `${co.name} gives ${moneyExact(res.value.given)} to the ${(PARTIES.find((x) => x.id === p.party) || {}).name || 'party'} party. On the record.`,
        { actors: [p.id], weight: 2 });
      return;
    }
  }

  // A month's wages in hand and a desk to put them at: hire.
  const runway = (co.cash || 0) / Math.max(1, CO.wageOf(co));
  if (runway > 6 && staff < CO.capacityOf(co) && chance(world, 0.5)) {
    CO.hire(world, co, { makePersona, officesOf: R.officesOf });
    return;
  }
  // Full, and the money is there for another building. A builder does it
  // sooner; somebody frugal sits in the one they have.
  if (staff >= CO.capacityOf(co) && (co.cash || 0) > CO.BUILDING_COST * (2.4 - disp.purse)
    && chance(world, 0.3)) {
    const res = CO.buyBuilding(world, co);
    if (res.ok) log(world, 'money', `${co.name} takes on another building — room for ${CO.capacityOf(co)} now.`, { actors: [p.id], weight: 1 });
    return;
  }
  // Big enough to list, and somebody has told them so.
  if (!co.public && (co.valuation || 0) >= CO.IPO_MINIMUM && chance(world, 0.12)) {
    const res = CO.goPublic(world, co);
    if (res.ok !== false) {
      log(world, 'money', `${co.name} lists. A quarter of it is sold to the public for ${moneyExact(res.raised)}, `
        + `valuing the whole at ${moneyExact(co.valuation || 0)}.`, { actors: [p.id], weight: 3 });
    }
    return;
  }
  // And, eventually, out. A founder ten years in with a solvent business and no
  // appetite for the next decade of it takes the money.
  const years = (world.clock.tick - (co.founded || 0)) / (world.clock.ticksPerYear || 240);
  if (years > 10 && CO.solvent(world, co) && chance(world, 0.02)) {
    const res = CO.sell(world, p.id);
    if (res.ok) {
      log(world, 'money', `${p.name} sells ${res.value.name} for ${moneyExact(res.value.net)} and walks away from it.`,
        { actors: [p.id], weight: 3 });
    }
  }
}

/**
 * The country's own businesses: founded, run, and occasionally wound up.
 *
 * Called every tick from sim.tick, and does its thinking on the same cadence
 * the executive does — a company is not a thing anybody makes a decision about
 * every day.
 */
export function tickFounders(world) {
  if (world.phase !== 'live') return;
  if (world.clock.tick % CADENCE !== 0) return;

  for (const co of world.companies || []) {
    if (co.closed) continue;
    if (world.personas?.[co.founderId]?.playerId) continue;   // a player's company is a player's business
    runCompany(world, co);
  }

  if (world.clock.tick % FOUNDING_WINDOW !== 0) return;
  const live = (world.companies || []).filter((c) => !c.closed && !world.personas?.[c.founderId]?.playerId);
  if (live.length >= NPC_COMPANIES) return;
  // Nobody founds anything into the teeth of a slump; a good year brings them out.
  const odds = clamp(0.5 + (world.economy?.gap || 0) * 2, 0.15, 0.85);
  if (!chance(world, odds)) return;
  const who = anEntrepreneur(world);
  if (!who) return;
  const sector = CO.SECTORS[Math.floor(rng(world) * CO.SECTORS.length)];
  const res = CO.found(world, who.id, companyName(world, sector.id), R.officesOf, sector.id);
  if (!res.ok) return;
  log(world, 'money', `${who.name} founds ${res.company.name} — ${sector.short}, one room and a quarter of a million.`,
    { actors: [who.id], weight: 2 });
}

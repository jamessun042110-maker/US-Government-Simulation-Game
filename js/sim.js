// The tick. One real second of the world.
//
// Everything here runs on the host client only. Construction, revenue cycles,
// opinion drift and war fronts advance whether or not anyone is looking, which
// is why a player checking in from a phone at lunch finds a changed world and a
// queue of decisions.

import { clamp, rng, chance, pick, sum, uid, money, moneyExact, withThe, MOOD_DAMP, APPROVAL_DAMP, nudgeMood, nudgeMoodAll, youthOf, YOUTH_CONNECTION } from './util.js';
import { log, canonDate, obituary, writeFinalBios, computeRanking } from './chronicle.js';
import * as R from './rules.js';
import { BUILDINGS, recomputeEconomy, distributePopulation, totalPop, makePersona, PARTIES, COLLEGES, temperamentOf } from './world.js';
import { closeFloor, closeOverride, scheduleElection, vacate, promulgate, createDoc, introduce, callAllies, dismissAllies, tickNominations, tickDivestOfficeholders, ALLY_WEIGHT, DICTATE_TICKS, TOTAL_FRONT } from './acts.js';
import { tickMedia } from './media.js';
import { tickDirector, notice } from './director.js';
import { tickIntrigue, headId } from './intrigue.js';
import { tickCourt } from './court.js';
import * as DEP from './depts.js';
import * as MACRO from './macro.js';
import * as CO from './company.js';
import * as NPC from './npc.js';

// One canon tick per this many real seconds while a draft is open.
export const DRAFT_SLOWDOWN = 8;

export function tick(world) {
  if (world.phase === 'convention' || world.phase === 'ended') return world;

  // A paused world still accepts actions; it just stops moving underneath you.
  if (world.paused) { world.rev = (world.rev || 0) + 1; return world; }

  // The calendar does not start until the head of government has been sworn in.
  // A republic's first day is the day someone takes the oath, and the Season
  // opening while the inauguration is still on screen meant the first crisis
  // could land before the President had finished saying what they stood for.
  //
  // Only a *player* can hold it up. If the chair is held by a citizen the engine
  // runs, there is nobody to wait on, and waiting would freeze the world for
  // good.
  // `== null`, not falsy: the oath is taken at tick 0 and 0 is a real answer.
  if (world.inaugurated == null) {
    const head = headId(world);
    const byPlayer = head && world.personas[head]?.playerId;
    if (byPlayer) { world.rev = (world.rev || 0) + 1; return world; }
    world.inaugurated = world.clock.tick;
  }

  // Expire a motion nobody finished voting on.
  if (world.motion && !world.motion.closed && Date.now() > world.motion.closes) {
    world.motion.closed = true;
    world.motion.passed = false;
    world.motion.expired = true;
  }

  // An election stops the republic. The ballot is a modal nobody can govern
  // around, so the canon clock does not advance while one is open: no economy, no
  // crisis, no term quietly expiring behind the popup, no war arriving during the
  // count. The election itself runs on its own counter (e.age), which is the only
  // thing that moves — the canon clock is what the polls are holding, so a
  // deadline measured in canon ticks would never come.
  //
  // Slowing time for the ballot used to be the answer and it was the wrong one:
  // a 1/8th-speed republic is still a moving one, and a player reading a ballot
  // could lose a district to a crisis they never saw.
  const polls = openElections(world);
  if (polls.length) {
    world.rev = (world.rev || 0) + 1;
    tickElections(world);
    // Set after, not before: the count can land inside this very call, and the
    // header should not still read "at the polls" over a resumed republic.
    world.atThePolls = openElections(world).length > 0;
    return world;
  }
  world.atThePolls = false;

  // While anyone is drafting a law, canon time crawls — the moment the fast clock
  // would otherwise trample. Drafting flags expire after 90s; an editor can sit
  // open a while.
  const drafters = Object.values(world.drafting || {}).filter((t) => Date.now() - t < 90000).length;
  const deliberators = Object.values(world.deliberating || {}).filter((t) => Date.now() - t < 12000).length;
  const slowed = drafters + deliberators;
  if (slowed > 0) {
    world.draftSlow = true;
    world.slowReason = drafters ? 'drafting' : 'the ballot';
    world.draftCarry = (world.draftCarry || 0) + 1 / DRAFT_SLOWDOWN;
    if (world.draftCarry < 1) { world.rev = (world.rev || 0) + 1; return world; }
    world.draftCarry -= 1;
  } else {
    world.draftSlow = false;
    world.draftCarry = 0;
  }

  world.clock.tick++;
  world.rev = (world.rev || 0) + 1;

  tickEconomy(world);
  // Foreign ministries answering the treaties put to them. An accepted one is
  // laid before the chamber exactly as it would have been; a refused one is
  // dead, and the Department of State has somewhere to start again.
  for (const { doc, yes, foreign, why } of DEP.tickAssent(world)) {
    if (yes) {
      doc.status = 'draft';
      const res = introduce(world, doc.id, doc.authorId, 90);
      log(world, 'war', `${foreign?.name} agrees to “${doc.title}”${why ? ` — ${why}` : ''}. `
        + `It goes before the chamber.`, { docId: doc.id, weight: 3 });
      if (!res.ok) doc.status = 'draft';
    } else {
      doc.status = 'refused';
      log(world, 'war', `${foreign?.name} declines “${doc.title}”${why ? ` — ${why}` : ''}.`,
        { docId: doc.id, weight: 3 });
    }
  }

  tickRooms(world);
  // An offer of office nobody answered is withdrawn, and the seat is free
  // again. See acts.tickNominations.
  tickNominations(world);
  // An officeholder may not run a company. Whoever took a seat this tick and
  // still owns one divests it. See acts.tickDivestOfficeholders.
  tickDivestOfficeholders(world);
  // A head of state abroad comes home when the week is up, and the powers of
  // the office come back with them. See depts.summon and rules.abroad.
  DEP.tickSummit(world);
  // And an ambassador left standing in the lobby since the spring goes home.
  DEP.tickAudiences(world);
  // And a chair nobody is sitting in governs itself. syntheticBallot is handed
  // in rather than imported by npc.js, because this module imports that one and
  // a binding needed at call time would close the cycle the wrong way.
  NPC.tickExecutive(world, syntheticBallot);
  // And the departments, on their own slower clock. A Secretary is not a second
  // President: see npc.tickDepartments.
  NPC.tickDepartments(world);
  // And, when the country has soured on a player-held head of government, the
  // opposition benches start moving. See npc.tickChamberImpeach.
  NPC.tickChamberImpeach(world, syntheticBallot);
  // The country's own founders, before the quarter is counted: they hire, buy
  // buildings, list, and occasionally found something new. See npc.tickFounders
  // — without it a one-player Season has one company in it.
  NPC.tickFounders(world);
  // The private sector, once a tick. Growth, payroll, and the storey a company
  // is worth — see company.tickCompanies, which returns whatever the country
  // would actually have heard about.
  for (const item of CO.tickCompanies(world)) {
    log(world, 'money', item.text, { actors: [item.co.founderId].filter(Boolean), weight: item.weight });
    // An employer of any size going into its last months is a thing a
    // government hears about from somebody, and it now has an answer available
    // — see acts.bailout. Told once, when the window opens, to whoever is
    // sitting in the chair; what they do about it is the whole point.
    // Somebody wants your company. The card is on the company tab either way,
    // but a founder who is not looking at that tab should still be told — the
    // offer has a deadline on it and the answer to one nobody read is no.
    if (item.bidOpened && world.personas[item.co.founderId]?.playerId) {
      notice(world, `An offer for ${item.co.name}`,
        `${item.bidOpened.buyerName} offers ${moneyExact(item.bidOpened.toSeller)} for ${item.co.name}`
        + `${item.bidOpened.debt ? `, and to take on the ${moneyExact(item.bidOpened.debt)} it owes` : ''}. `
        + `There are ${item.bidOpened.deadline - world.clock.tick} ticks to answer it, and not answering is answering.`);
    }
    if (item.distressOpened && (item.co.employees || []).length >= BAILOUT_HEARD_AT) {
      const head = world.seats.find((s) => s.office === R.headOffice(world)?.id && s.personaId);
      if (head && world.personas[head.personaId]?.playerId) {
        // director.notice takes (world, title, text). This passed the player's
        // id as the title, so the government's one warning that an employer was
        // failing arrived headed "p1".
        notice(world, `${item.co.name} is in trouble`,
          `${(item.co.employees || []).length} people work there, and it has ${CO.graceMonths(world)} months. `
          + 'The treasury can catch it, if you think that is the government\'s job.');
      }
    }
  }
  DEP.tickDepts(world);
  tickConstruction(world);
  tickOpinion(world);
  tickFloor(world);
  tickMemberBills(world);
  tickTerms(world);
  tickElections(world);
  tickFormations(world);
  tickDictate(world);
  tickWar(world);
  tickMedia(world);
  tickIntrigue(world);
  tickCourt(world);
  tickDirector(world);
  tickEmergency(world);
  tickAffiliation(world);
  writeFinalBios(world);
  checkCollapse(world);

  if (world.clock.tick % 10 === 0) snapshotHistory(world);
  return world;
}

// --- money ------------------------------------------------------------------
function tickEconomy(world) {
  const e = world.economy;
  const per = 1 / world.clock.ticksPerYear;
  const slump = e.slump || 0;
  if (e.slump) e.slump = Math.max(0, e.slump - 0.004);

  // The money side runs first: the rate the market clears at this tick is the
  // rate this tick's borrowing is priced at. See macro.tickMacro for the chain.
  MACRO.tickMacro(world);

  const rev = e.revenueYr * per * (1 - slump * 0.28);
  const spend = e.spendYr * per;
  const flow = rev - spend;
  e.treasury += flow;
  // The balance is allowed to run below zero — a deficit shows on the treasury
  // itself, not only on a separate debt line — and the year's overdraft is
  // financed into the debt stock when the year closes (below). A surplus still
  // amortises outstanding debt out of a positive balance.
  MACRO.settleBorrowing(world, flow);
  // What lenders make of it. Running a deficit (a balance below zero) marks the
  // rating down; carrying a stock approaching a year of output marks it down
  // slowly even in balance; a state that owes nothing and is in the black recovers.
  if (e.treasury < 0) e.credit = clamp(e.credit - 0.05, 5, 100);
  else if (MACRO.debtRatio(world) > 0.9) e.credit = clamp(e.credit - 0.02, 5, 100);
  else e.credit = clamp(e.credit + 0.02, 5, 100);
  // Slumps put people out of work. Recovery is slower than the fall: the
  // headline rate climbs toward structural-plus-slump fast and falls back at a
  // third the speed, which is why an ignored recession outlives the government.
  if (e.structural == null) e.structural = e.unemployment ?? 0.05;
  // Jobs and relief spending buys a temporary reduction in unemployment that
  // fades as the program's money runs out. Applied here, after recompute, so a
  // bill's own recompute can't erase it.
  e.reliefBoost = Math.max(0, (e.reliefBoost || 0) - 0.0015);
  const relief = e.reliefBoost || 0;
  // Okun's term rides on top of the structural rate the map dictates: output
  // above potential pulls people into work, below it pushes them out. It is
  // added, not substituted — the count of jobs against workers is still what
  // sets the floor.
  const cyc = e.cyclical || 0;
  const target = clamp(e.structural + slump * 0.11 - relief + cyc, 0.012, 0.65);
  const rate = target > e.unemployment ? 0.06 : 0.02;
  e.unemployment += (target - e.unemployment) * rate;
  for (const d of world.districts) {
    if (d.structural == null) d.structural = d.unemployment ?? 0.05;
    const dt = clamp(d.structural + slump * 0.11 - relief + cyc, 0.005, 0.75);
    d.unemployment += (dt - d.unemployment) * (dt > d.unemployment ? 0.06 : 0.02);
  }
  if (world.clock.tick % world.clock.ticksPerYear === 0) {
    // The year's deficit, if any, is financed into debt here — the balance was
    // allowed to run negative through the year, and the close is where the hole
    // becomes borrowing that carries interest.
    const closing = e.treasury;
    const financed = MACRO.financeDeficit(world);
    if (financed > 0) e.credit = clamp(e.credit - 0.15, 5, 100);
    log(world, 'money', `Fiscal year closes. Treasury ${moneyExact(closing)}`
      + (financed > 0 ? ` — a ${moneyExact(financed)} deficit, financed by borrowing` : '')
      + `; revenue ${money(e.revenueYr)}, spending ${money(e.spendYr)}; unemployment ${(e.unemployment * 100).toFixed(1)}%.`, { weight: 1 });
    log(world, 'money', MACRO.annualReport(world), { weight: 1 });
  }
}

/**
 * What the state of the treasury is worth in approval, on a curve.
 *
 * Measured in years of spending held in reserve, because that is the only way
 * a treasury figure means anything: $60M is a fortune to a village and a
 * fortnight to a nation. Full marks at two years' cover, nothing at all at
 * empty, and a real penalty once the state is borrowing to pay for itself.
 */
export function solvencyPoints(world) {
  const e = world.economy;
  // Reserve, measured in years of spending. The balance can now run below zero —
  // an overdraft — so it is no longer floored at empty: a deep deficit reads
  // worse than an empty vault does, down to about -3 at a full year underwater.
  const years = e.treasury / Math.max(1, e.spendYr);
  const cover = clamp(years / 2, -0.5, 1) * 4 - 1;   // -3 a year in overdraft, -1 at empty, +3 at two years' cover
  // And what is owed against it. Reading the reserve alone would have made a
  // state that borrowed its way to a full vault look solvent, so the debt stock
  // is priced too: nothing at all up to a third of a year's output, and steeply
  // worse past a year of it.
  const ratio = (e.debt || 0) / Math.max(1, e.gdp || 1);
  const owed = -clamp((ratio - 0.3) / 0.7, 0, 1) * 7;
  return cover + owed;
}

/**
 * What the state pays to borrow.
 *
 * Three things, added: the short rate the money market clears at, the spread
 * lenders charge on this republic's credit rating, and a premium for how much
 * of the nation's savings the government is already absorbing. That last one is
 * crowding out arriving as a price — see macro.tickMacro, which computes all
 * three and leaves the answer on `marketRate`.
 *
 * This used to be the credit rating alone, which meant the interest rate was a
 * fact about the government's reputation and nothing else: no central bank
 * could move it, no amount of borrowing could raise it, and monetary policy had
 * nothing to act on. The fallback is that old formula, for a world saved before
 * any of this existed and not yet ticked.
 */
export const interestRate = (world) => world.economy.marketRate
  ?? (0.03 + (1 - clamp((world.economy.credit ?? 72) / 100, 0, 1)) * 0.09);

// --- the private rooms ------------------------------------------------------
/**
 * Invitations to the Oval Office run out after two canon months.
 *
 * A guest list that only ever grew meant that by mid-Season half the republic
 * could walk in on a private meeting, and the President had to remember to
 * revoke a conversation they had forgotten having. The cabinet and the Vice
 * President are not touched: they hold a key by their office and never appear
 * on this list at all.
 *
 * This is also where the old shape is migrated — a bare persona id has no stamp
 * on it, so it gets one now and starts its two months from here rather than
 * vanishing out from under a Season already in progress.
 */
function tickRooms(world) {
  for (const room of R.INVITABLE_ROOMS) {
    if (room !== 'oval' && !R.deptExists(world, room)) continue;
    sweepRoom(world, room);
  }
}

const roomName = (world, room) =>
  (room === 'oval' ? 'the Oval Office' : `the ${R.office(world, room)?.name || room}'s department`);

function sweepRoom(world, room) {
  const guests = R.roomInvites(world, room);
  if (!guests.length) return;
  const kept = [];
  for (const g of guests) {
    // The oldest shape: a bare id with no stamp. Give it one and start its two
    // months from here rather than dropping a guest out of a live Season.
    if (g.at == null) { kept.push({ id: g.id, at: world.clock.tick }); continue; }
    if (!R.inviteExpired(world, g)) { kept.push(g); continue; }
    const p = world.personas[g.id];
    if (!p) continue;
    const unanswered = R.invitePending(g);
    // An offer nobody replied to is not history — it never happened in public.
    // A visit that ran its course is, and the room notices the door closing.
    if (!unanswered) {
      log(world, 'office', `${p.name}'s invitation to ${roomName(world, room)} lapses.`, { actors: [g.id], weight: 1 });
    }
    if (p.playerId) {
      world.notices = world.notices || [];
      world.notices.push({
        id: 'nt_' + room + '_' + g.id + '_' + world.clock.tick, playerId: p.playerId,
        text: unanswered
          ? `You never answered the invitation into ${roomName(world, room)}. It has lapsed.`
          : `Your invitation into ${roomName(world, room)} has lapsed.`,
        tone: 'error', ts: Date.now(),
      });
    }
  }
  if (kept.length !== guests.length || guests.some((g) => g.at == null)) R.setRoomInvites(world, room, kept);
}

// --- construction -----------------------------------------------------------
function tickConstruction(world) {
  let finished = 0;
  for (const p of world.city.parcels) {
    if (!p.project) continue;
    p.project.progress++;
    if (p.project.progress >= p.project.ticks) {
      const key = p.project.building;
      const b = BUILDINGS[key];
      p.building = key;
      p.project = null;
      p.landValue = Math.round(clamp(p.landValue + (b.land || 0), 8, 900));
      // Neighbours feel it. A jail next to the bank does exactly what you think.
      for (const q of neighbours(world, p)) {
        q.landValue = Math.round(clamp(q.landValue + (b.land || 0) * 0.5, 8, 900));
      }
      const d = world.districts.find((x) => x.id === p.district);
      if (d) { nudgeMood(d, b.mood || 0); d.order = clamp(d.order + (b.order || 0), 0, 100); }
      if (b.units) world.military.units += b.units;
      log(world, 'build', `${b.name} opens in ${d?.name}. ${b.jobs ? b.jobs + ' jobs' : ''}${b.homes ? (b.jobs ? ', ' : '') + b.homes + ' homes' : ''}.`, { district: p.district, weight: 2 });
      finished++;
    }
  }
  if (finished) {
    distributePopulation(world, totalPop(world));
    recomputeEconomy(world);
  }
}

function neighbours(world, p) {
  const { w } = world.city;
  return world.city.parcels.filter((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1 && q !== p);
}

// --- opinion ----------------------------------------------------------------
// The mood a district is settling toward, and the named contributions that
// make it up. One function so the dashboard can explain exactly what the
// simulation is doing — the number is never a mystery.
//
// Calibrated so a nation at rest, with ordinary problems (a few percent
// unemployed, some homeless, moderate taxes) and doing nothing, sits near 50
// rather than sinking into the 30s. Genuinely bad conditions still bite; the
// citizenry just no longer treats a normal opening position as a catastrophe.
export function districtMoodTarget(world, d) {
  const e = world.economy;
  const homelessRate = d.pop ? d.homeless / d.pop : 0;
  const taxBite = e.taxes.income + e.taxes.sales * 0.6 + e.taxes.property * 0.4;
  const amenity = sum(world.city.parcels.filter((p) => p.district === d.id),
    (p) => (p.building && ['amenity', 'infra'].includes(BUILDINGS[p.building].tag) ? 1 : 0));

  // Ground broken counts for something before it opens. A district with housing
  // or jobs under construction has that disapproval eased by a tenth of what the
  // finished building will be worth — the public gives a government credit for
  // building — with the other nine tenths arriving when it opens and the homes or
  // jobs are real (see tickConstruction, which is what removes the project and so
  // ends this credit). Not stacked: breaking more ground does not multiply the
  // promise, it only keeps it.
  const ANTICIPATION = 0.10;
  const buildingFor = (tag) => world.city.parcels.some((p) =>
    p.district === d.id && p.project && BUILDINGS[p.project.building]?.tag === tag);
  const jobsEase = buildingFor('jobs') ? 1 - ANTICIPATION : 1;
  const housingEase = buildingFor('housing') ? 1 - ANTICIPATION : 1;

  // Only the part of a problem *above* what people take for granted hurts:
  // ~4% unemployment and a small homeless share are normal and cost nothing.
  const parts = {
    Unemployment: -Math.max(0, d.unemployment - 0.04) * 150 * d.salience.jobs * jobsEase,
    Housing: -Math.max(0, homelessRate - 0.03) * 150 * d.salience.housing * housingEase,
    Taxes: -Math.max(0, taxBite - 0.08) * 120 * d.salience.taxes,
    Order: (d.order - 50) * 0.1 * d.salience.order,
    Amenities: Math.min(10, amenity * 2) * d.salience.amenity,
    War: -world.military.exhaustion * 20,
    Emergency: world.emergency?.active ? -6 : 0,
    // This used to be `treasury > 0 ? 2 : -6` — a cliff with nothing on
    // either side of it, so a government could spend ninety per cent of the
    // reserve and the public would not notice until the day it went negative.
    // It is a gradient now, measured the way anyone actually judges a treasury:
    // how many years of spending is in it. Two years or more is comfortable,
    // and the fall from there is steep enough to feel.
    // Named "Solvency" until somebody read the chart and asked what it could
    // possibly mean. Every other row here names the thing itself — Housing,
    // Taxes, Order — so this one does too.
    Treasury: solvencyPoints(world),
    // Public health was written by hospital spending and read by nothing at
    // all — a bar that moved and meant nothing. It is worth about as much as
    // amenities, and it decays, so a health service is a thing you keep paying
    // for rather than a box you tick once.
    Health: (((d.health ?? 55) - 55) / 45) * 6 * d.salience.amenity,
  };
  const target = clamp(58 + sum(Object.values(parts)), 2, 96);
  return { target, parts };
}

/**
 * How fast opinion answers the conditions driving it.
 *
 * Both are a fraction of the remaining gap, closed every tick, so they are
 * half-lives rather than speeds: mood covers 1.8% of the distance to its target
 * each second, an officeholder's standing 2.85% of the distance to the mood of
 * the people who elected them.
 *
 * The base rates are 2% and 3%, scaled by the same damping every discrete
 * shove is scaled by (see util.MOOD_DAMP). Written as a product rather than as
 * the two answers so drift and shove cannot drift apart: change the damping
 * once and the whole of public opinion slows together, which is the only way
 * the balance between "conditions are bad" and "something happened" survives.
 *
 * National approval is the pop-weighted mean of district mood, so it inherits
 * the mood figure rather than having a rate of its own.
 */
/**
 * The first hundred days.
 *
 * Long enough to be a real grace period and short enough that it is over
 * before the first budget lands. Inside it the drift toward the public's
 * verdict runs at a fifth of its usual rate and fades back to full strength
 * across the last third, so there is no cliff on day 101 — the honeymoon ends
 * the way a real one does, by wearing off.
 */
const HONEYMOON_DAYS = 100;
const HONEYMOON_DAMP = 0.2;

function honeymoon(world, seat) {
  if (seat?.since == null) return 1;
  const per = world.clock.ticksPerYear || 240;
  const days = ((world.clock.tick - seat.since) / per) * 365;
  if (days >= HONEYMOON_DAYS) return 1;
  // Full protection for the first two thirds, then a ramp back to normal.
  const t = Math.max(0, (days - HONEYMOON_DAYS * 0.66) / (HONEYMOON_DAYS * 0.34));
  return HONEYMOON_DAMP + (1 - HONEYMOON_DAMP) * clamp(t, 0, 1);
}

const MOOD_CONVERGENCE = 0.02 * MOOD_DAMP;
const APPROVAL_CONVERGENCE = 0.03 * APPROVAL_DAMP;

function tickOpinion(world) {
  for (const d of world.districts) {
    // Public health settles toward what the district is actually equipped for —
    // a hospital holds it up, nothing holds it at the baseline — so money spent
    // on clinics is money that has to keep being spent. Without this the health
    // figure only ever went up, which made it a ratchet rather than a service.
    const beds = world.city.parcels.filter((pp) => pp.district === d.id && pp.building
      && BUILDINGS[pp.building]?.tag === 'amenity').length;
    const healthBase = clamp(48 + beds * 4, 30, 90);
    d.health = clamp((d.health ?? 55) + (healthBase - (d.health ?? 55)) * 0.004, 0, 100);
    // Crises, wars and articles all shove mood around directly; normalise
    // before anything reads it, so a bad minute can't drive it off the scale.
    d.mood = clamp(d.mood, 0, 100);
    const { target, parts } = districtMoodTarget(world, d);
    // Mood drifts toward its target over a minute or two; it doesn't lurch.
    d.mood = clamp(d.mood + (target - d.mood) * MOOD_CONVERGENCE, 0, 100);
    d.moodTarget = target;
    d.moodParts = parts;
  }

  // Officeholders converge on the mood of the districts that elected them,
  // damped by their own standing — and, for the first hundred days of a term,
  // damped a great deal further. See HONEYMOON_DAYS.
  for (const seat of world.seats) {
    if (!seat.personaId) continue;
    const p = world.personas[seat.personaId];
    if (!p) continue;
    const d = seat.district ? world.districts.find((x) => x.id === seat.district) : null;
    let base = d ? d.mood : sum(world.districts, (x) => x.mood * x.pop) / Math.max(1, totalPop(world));
    const o = R.office(world, seat.office);
    // Whoever answers for foreign policy has their standing move with the state
    // of the world — peace and pacts lift the target they converge toward, a war
    // and a hostile neighbourhood lower it. See foreignStability.
    if (o?.powers.some((pw) => FOREIGN_POWERS.includes(pw))) {
      base = clamp(base + foreignStability(world), 0, 100);
    }
    const blame = o?.powers.includes('spend') ? 1.35 : 1; // the executive owns the numbers
    // The honeymoon. A government sworn in last week is not yet answerable for
    // the state of the country it inherited, and the public knows it — so for
    // the first hundred days the pull toward the district's mood is a fraction
    // of its usual strength, and a new administration gets a hundred days to
    // *become* the reason things are the way they are before it is judged as
    // though it already were. It is not immunity: a genuine disaster still
    // moves the number, because a crisis shoves approval directly and this
    // damps only the drift.
    const honey = honeymoon(world, seat);
    p.approval = clamp(p.approval + ((base - p.approval) * APPROVAL_CONVERGENCE * blame * honey), 0, 100);
  }
}

export function nationalApproval(world) {
  const pop = totalPop(world) || 1;
  return clamp(sum(world.districts, (d) => clamp(d.mood, 0, 100) * d.pop) / pop, 0, 100);
}

// How much a peaceful, well-managed neighbourhood is worth to the government's
// standing, and what a war or a wall of hostility costs it. Folded into the
// approval the executive converges toward (tickOpinion), not shoved — so it is a
// standing background pressure a government feels for as long as the condition
// holds, on top of the discrete shocks of declaring a war or losing a battle.
const FOREIGN_WAR_PENALTY = 5;      // per ongoing war
const FOREIGN_PACT_BONUS = 1.5;     // per standing pact or alliance
const FOREIGN_CALM_HOSTILITY = 40;  // mean hostility below this reads as calm
const FOREIGN_HOSTILITY_WEIGHT = 0.06;
const FOREIGN_STABILITY_CAP = 8;

/**
 * The state of the republic's foreign relations, as a signed nudge to the
 * executive's approval target. Peace, standing pacts and calm neighbours lift
 * it; an ongoing war and a hostile neighbourhood drag it down. Zero if there is
 * no world to have relations with. Capped so foreign policy is a real term in a
 * government's standing without ever being the whole of it.
 */
export function foreignStability(world) {
  const foreign = world.foreign || [];
  if (!foreign.length) return 0;
  let s = 0;
  const wars = (world.military?.wars || []).filter(DEP.stillFighting);
  s -= wars.length * FOREIGN_WAR_PENALTY;
  const pacts = foreign.filter((f) => f.allied || (f.pact && world.clock.tick < f.pact.ends)).length;
  s += pacts * FOREIGN_PACT_BONUS;
  const meanHostility = sum(foreign, (f) => f.hostility || 0) / foreign.length;
  s += (FOREIGN_CALM_HOSTILITY - meanHostility) * FOREIGN_HOSTILITY_WEIGHT;
  return clamp(s, -FOREIGN_STABILITY_CAP, FOREIGN_STABILITY_CAP);
}

// The powers that make an office answerable for foreign policy — its holder's
// standing moves with the state of the world (see foreignStability).
const FOREIGN_POWERS = ['sign_treaty', 'command_military', 'declare_war'];

/**
 * How much of a district's own temper colours its reading of a person, and
 * what it is worth to be one of their own.
 */
export const DISTRICT_READ = 0.45;
export const HOME_GROUND = 6;

/**
 * How one district reads one person.
 *
 * A president at 55 nationally is not at 55 everywhere. A district that is
 * content reads them generously; one that is not reads them as the reason it
 * is not; and their own people are kinder than strangers. That difference is
 * the whole of why anybody campaigns anywhere, and until now the engine did
 * not have it — approval was one number and the chamber voted against it.
 *
 * Deliberately *derived* and not stored. Opinion has one lever
 * (util.nudgeApproval, and tests/opinion.mjs fails the build if anything
 * writes .approval directly); a second per-district store would be a second
 * lever and fifty call sites that forget to pull it. This reads the number
 * that exists through the district doing the reading.
 */
export function approvalIn(world, persona, district) {
  const nat = clamp(persona?.approval ?? 50, 0, 100);
  const d = typeof district === 'string' ? world.districts.find((x) => x.id === district) : district;
  if (!d || !persona) return nat;
  const temper = (clamp(d.mood, 0, 100) - 50) * DISTRICT_READ;
  const seat = R.seatOf(world, persona.id);
  const home = (seat?.district === d.id || persona.district === d.id) ? HOME_GROUND : 0;
  return clamp(nat + temper + home, 0, 100);
}

/**
 * The whole country's reading of one person, district by district, worst
 * first — which is the order a politician wants it in.
 */
export function approvalByDistrict(world, persona) {
  return world.districts
    .map((d) => ({
      district: d,
      approval: approvalIn(world, persona, d),
      home: R.seatOf(world, persona?.id)?.district === d.id || persona?.district === d.id,
    }))
    .sort((a, b) => a.approval - b.approval);
}

/**
 * Why approval is where it is: the population-weighted contribution of each
 * driver across every district, plus where mood is currently heading. Lets the
 * dashboard say "housing is costing you 6 points" instead of leaving the number
 * unexplained.
 */
export function approvalDrivers(world) {
  const pop = totalPop(world) || 1;
  const totals = {};
  let targetSum = 0;
  for (const d of world.districts) {
    const { target, parts } = districtMoodTarget(world, d);
    const w = d.pop / pop;
    targetSum += target * w;
    for (const [k, v] of Object.entries(parts)) totals[k] = (totals[k] || 0) + v * w;
  }
  const drivers = Object.entries(totals)
    .map(([label, value]) => ({ label, value }))
    .filter((x) => Math.abs(x.value) >= 0.05)
    .sort((a, b) => a.value - b.value);
  const now = nationalApproval(world);
  return { drivers, target: clamp(targetSum, 0, 100), now, trend: clamp(targetSum, 0, 100) - now };
}

// --- the floor --------------------------------------------------------------
// A bill the executive neither signs nor vetoes within this long is pocket-vetoed.
const POCKET_VETO_MONTHS = 2;

function tickFloor(world) {
  for (const id of world.docOrder) {
    const doc = world.documents[id];
    if (!doc) continue;
    if (doc.status === 'floor' || doc.status === 'override') {
      // Seated citizens make up their minds a few seconds in.
      const elapsed = world.clock.tick - doc.floorOpened;
      if (elapsed >= 6) {
        doc.statements = doc.statements || {};
        for (const v of R.electorateFor(world, doc)) {
          const p = world.personas[v.personaId];
          if (!p || !p.synthetic) continue;
          const prev = doc.votes[v.personaId];
          if (!prev) {
            if (chance(world, 0.125)) {
              const b = syntheticBallot(world, p, doc);
              doc.votes[v.personaId] = b;
              doc.statements[v.personaId] = { ballot: b, text: voteStatement(world, p, doc, b) };
            }
          } else if (chance(world, 0.07)) {
            // They keep watching the bill. A member who truly voted on the merits
            // they cited will move when those merits move; one who didn't, won't —
            // so changing the circumstances can win over the sincere, and only the
            // sincere. Their vote is recomputed against current conditions.
            const nb = syntheticBallot(world, p, doc);
            if (nb !== prev) {
              doc.votes[v.personaId] = nb;
              doc.statements[v.personaId] = { ballot: nb, text: voteStatement(world, p, doc, nb, true), changed: true };
            }
          }
        }
        // The tie-breaker (the VP) records a position too, once the room has sat
        // a moment. It counts only if the chamber splits evenly, but it has to
        // exist by the close for a tie to be broken. NPC only; a player VP casts
        // through the floor like anyone who holds the power.
        const tb = R.tieBreaker(world, doc);
        if (tb) {
          const vp = world.personas[tb.personaId];
          if (vp && vp.synthetic && !doc.votes[tb.personaId]) doc.votes[tb.personaId] = syntheticBallot(world, vp, doc);
        }
      }
      if (world.clock.tick >= doc.floorCloses) {
        if (doc.status === 'floor') closeFloor(world, id, { auto: true });
        else closeOverride(world, id);
      }
    } else if (doc.status === 'awaiting-signature' && doc.passedAt != null) {
      // A pocket veto: a bill the executive neither signs nor vetoes within two
      // months dies on the desk. The NPC executive clears its desk in a day or
      // two (npc.clearTheDesk, which runs earlier this tick), so this bites a
      // human president who lets a bill sit — or an office left vacant with
      // nobody to sign at all.
      const window = Math.round((world.clock.ticksPerYear || 240) * (POCKET_VETO_MONTHS / 12));
      if (world.clock.tick - doc.passedAt >= window) {
        doc.status = 'vetoed';
        doc.pocketVetoed = world.clock.tick || 1;
        log(world, 'vote', `“${doc.title}” dies unsigned — two months passed with neither a signature nor a veto. A pocket veto.`, { docId: id, weight: 2 });
      }
    }
  }
}

// Deterministic 0..1 hash, so a member's personal bias on a given bill is fixed:
// re-evaluating a vote on the floor moves it only when the circumstances move,
// never on fresh randomness.
function hash01(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}
// A member can be principled on tax and venal on spending, or the reverse.
function topicJitter(persona, topic) { return (hash01(persona.id + '#' + topic) - 0.5) * 0.44; }

/**
 * How a seated citizen votes. Two ledgers are kept: `merit` — the case a member
 * would argue in public (their district's concerns, fiscal prudence, war-
 * weariness) — and `interest` — the quiet drivers (party, pork, a purchased
 * loyalty). A member's hidden sincerity weights one against the other, so a
 * sincere member's vote tracks the circumstances they cite (change those and you
 * change their vote), while a cynical one holds unless you reach their interest.
 */
// How hard the opposition whips against the president's own bills.
const OPPOSITION_WHIP = 1.4;

// Touching the constitution is graver than passing a law. A member weighs an
// amendment more warily than an ordinary bill, whatever it happens to contain —
// institutional caution about the founding rules themselves, on the principled
// (merit) ledger so a whip cannot simply buy it off. This is on top of the
// higher fraction an amendment must clear (rules.reqFor) and of any AMEND
// clause's own per-clause caution below, so a bare rule-change is the hardest of
// all to carry, which is the point of a constitution.
const AMENDMENT_CAUTION = 1.6;

export function syntheticBallot(world, persona, doc) {
  const party = PARTIES.find((p) => p.id === persona.party) || PARTIES[0];
  const seat = R.seatOf(world, persona.id);
  const d = seat?.district ? world.districts.find((x) => x.id === seat.district) : null;
  let merit = 0, interest = 0;

  for (const c of doc.clauses) {
    if (c.kind === 'SET_TAX') {
      const cur = world.economy.taxes[c.tax] * 100;
      const raising = +c.rate > cur;
      interest += (raising ? 1 : -1) * party.lean.tax * 2.2;
      if (d) merit -= (raising ? 1 : -1) * d.salience.taxes * 1.4;
    } else if (c.kind === 'APPROPRIATE' || c.kind === 'BUILD') {
      interest += party.lean.spend * 1.8;
      const amt = c.kind === 'BUILD' ? BUILDINGS[c.building]?.cost || 0 : +c.amount;
      if (amt > world.economy.treasury * 0.5) merit -= 2.2; // fiscal prudence
      if (c.kind === 'BUILD') {
        const pcl = world.city.parcels[c.parcel];
        if (pcl && d && pcl.district === d.id) interest += 2.6; // pork is persuasive
        const tag = BUILDINGS[c.building]?.tag;
        if (tag === 'housing' && d) merit += d.salience.housing * 2;
        if (tag === 'order') interest += party.lean.order * 2;
      }
    } else if (c.kind === 'AMEND') {
      merit -= 1.2; // institutional caution
      if (/citizenWeight|playerWeight/.test(c.path)) merit -= 0.8;
    } else if (c.kind === 'GRANT_POWER') {
      merit += c.revoke ? 1.0 : -1.3;
    } else if (c.kind === 'RIGHT') {
      // A right is a good in itself (merit), and a party-line question besides:
      // the Liberal bloc leans for it, the Conservative bloc against. Weighted
      // enough that the two blocs visibly part on it rather than both waving it
      // through on the merit bonus alone — rights are contested politics here.
      merit += 1.6; interest += (party.lean.rights ?? -party.lean.order) * 2.6;
    } else if (c.kind === 'DECLARE_WAR') {
      interest += party.lean.order * 2; merit += -1.4 - world.military.exhaustion * 3;
    } else if (c.kind === 'REDISTRICT') {
      interest += (d && c.to === d.id) ? 2.5 : -2.5;
    } else if (c.kind === 'REMOVE' || doc.type === 'impeachment') {
      const t = world.personas[c.persona];
      if (t) merit += (55 - t.approval) / 18;
    }
  }

  // What somebody has paid them to think. It lands on the *interest* ledger,
  // never on merit: money buys a thumb on the scale and does not change what a
  // member believes the bill will do. A member who thinks it is a disaster
  // still votes against it, having taken the cheque, which is the whole of what
  // this mechanic is for. Capped at rather less than a party whip.
  const bought = CO.lobbyLean(doc, persona.id);
  if (bought) interest += clamp(bought, 0, 1.2) * 2.4;

  const author = world.personas[doc.authorId];
  if (author) {
    // Standing, asked as two different questions.
    //
    // What the country makes of them decides whether they can carry a vote at
    // all — a president at 30% is asking a favour, one at 70% is calling in a
    // debt. What *this member's own district* makes of them decides what the
    // vote costs the member personally, and it is not the same number: see
    // approvalIn. A president loved in Ironside and loathed in Kiln Hill now
    // has to count the chamber district by district, which is what the job is.
    merit += (author.approval - 50) / 34;
    if (d) merit += (approvalIn(world, author, d) - 50) / 30;
    // Connections in the chamber are built over a career. A younger author has
    // had less time to build them, so the personal pull — the party loyalty
    // they can call on and the old school tie — counts for less. What the
    // country makes of them (the merit above) is unchanged; this is only the
    // book of favours, and the young have a thinner one.
    const conn = 1 - YOUTH_CONNECTION * youthOf(world, author);
    if (author.party === persona.party) interest += 1.1 * conn;
    // Opposition. A member of the other party votes against the president's own
    // proposals as a matter of course — the bloc a president has to break rather
    // than count on. Only against the head of government's bills, and only
    // between two actual parties; an independent whips nobody and is whipped by
    // no one.
    else if (persona.party && author.party
      && R.officesOf(world, author.id).some((o) => o.id === R.headOffice(world)?.id)) {
      interest -= OPPOSITION_WHIP;
    }
    // The old school tie. A classmate is worth about as much as a party
    // colleague — and it is worth *more* the rarer the college, because an
    // Argent president finds few classmates in the chamber and a Northgate one
    // finds them everywhere. That is the trade the founding screen offers.
    if (author.college && author.college === persona.college) {
      const col = COLLEGES.find((c) => c.id === author.college);
      interest += (col ? 0.8 + (col.prestige - 1) * 0.35 : 0.8) * conn;
    }
    // An open file costs them while it is open. A file that closed with a charge
    // costs them more, and lastingly — which is the point of it closing.
    if (author.underInvestigation) merit -= 0.8;
    if ((author.charges || []).length) merit -= 1.3;
    // A member who has said it out loud carries that into every bill they bring.
    // Half the weight of writing it into the bill itself — it is who is asking,
    // not what is being asked — and it fades as the chamber's memory does.
    const said = (author.saidDisrepute || []).filter((s) => world.clock.tick - s.tick < world.clock.ticksPerYear * 2);
    if (said.length) merit -= Math.min(3.2, 1.4 + said.length * 0.6);
    if ((world.turned || []).includes(persona.id)) interest += 1.5; // bought and paid for
  }
  // The member's own district's general temper — a contented district sends a
  // more agreeable member, whoever is asking. Lighter than it was, because the
  // district's mood is now also inside its reading of the author above and
  // counting it at full weight in both places would double it.
  if (d) merit += (d.mood - 50) / 60;
  // And the government's own standing, which is not any one district's. A bill
  // that would have carried at 60% dies at 35% — the term the player feels as
  // "nothing gets through any more" in the back half of a bad term.
  merit += (nationalApproval(world) - 50) / 50;

  // Rhetoric: a bill argues for itself in its preamble. A written, relevant
  // preamble moves the persuadable toward yea — the same way a press story moves
  // opinion — and it lands harder on a member whose district or issues it names.
  // It rides the merit channel, so it sways the principled, not the bought.
  const pre = (doc.preamble || '').trim();
  if (pre.length >= 12) {
    const low = pre.toLowerCase();
    let force = Math.min(1, pre.split(/\s+/).length / 45) * 1.1;
    if (d && d.name && low.includes(d.name.toLowerCase())) force += 0.7;
    for (const [key, kw] of [['jobs', 'job'], ['housing', 'hous'], ['taxes', 'tax'], ['order', 'order'], ['amenity', 'school']])
      if (low.includes(kw)) force += 0.22 * (d?.salience?.[key] ?? 0.5);
    merit += Math.min(force, 2.2);
  }

  // A bill written in the language of the gutter. This is not a policy
  // disagreement a whip can buy off, so it hits both ledgers — the principled
  // will not vote for it and the bought do not want their name on it — and it
  // is large enough that passing one takes a chamber that genuinely wants to.
  if (doc.disrepute?.length) { merit -= 6.5; interest -= 4.5; }

  // Amending the constitution is graver than legislating under it — a member is
  // warier of the founding rules than of an ordinary bill. See AMENDMENT_CAUTION.
  if (doc.type === 'amendment') merit -= AMENDMENT_CAUTION;

  // Temperament is not only a register. A wonk is moved by the argument and not
  // by the whip; a firebrand is the reverse. The bend is small — sincerity and
  // the district still dominate — but it means the way a member talks and the
  // way they vote agree.
  const temper = temperamentOf(persona);
  merit *= 1 + temper.merit;
  interest *= 1 + temper.interest;
  const s = clamp((persona.sincerity ?? 0.6) + topicJitter(persona, topicOf(doc)), 0.05, 0.98);
  // ×2 so an average-sincerity member (s≈0.5) reproduces the old merit+interest sum.
  let score = 2 * (s * merit + (1 - s) * interest);
  score += (hash01(persona.id + '|' + doc.id) - 0.5) * 2.4; // fixed personal bias
  return score > 0 ? 'yea' : score > -0.35 ? 'abstain' : 'nay';
}

// A public word from a minister on why they voted as they did — so a chamber
// full of AI ministers isn't a black box, and you can see why your bill died.
// Keyed by the bill's topic and the direction of the vote, several per cell so
// the same vote on the same kind of bill doesn't read identically every time.
// {d} fills in the minister's district.
/**
 * How each temperament sounds, whatever the bill is about.
 *
 * The topic pools below say what the vote was about; these say who is
 * speaking. voteStatement draws from here most of the time, so a chamber of
 * seven answers a bill in seven voices instead of three.
 */
const VOICES = {
  blunt: {
    for: ['It helps my people. That is the whole of my reasoning. Aye.', 'I know what this is. I am voting for it anyway.', 'Yes. Next.'],
    against: ['No. I have read it and I do not want it.', 'Somebody wins from this and it is not {d}. No.', 'Against, and I will say why in the corridor.'],
    abstain: ['I am not putting my name on this either way.', 'Not my fight. Stood aside.', 'Ask me again when it is honest. Abstained.'],
  },
  lawyerly: {
    for: ['The drafting is sound and the power is there. I vote aye.', 'On the clause as written — and only as written — yes.', 'It survives the obvious objection. For.'],
    against: ['The clause reaches further than the grant. I must vote no.', 'This will be struck within the year. Against.', 'Show me the authority for it. Until then, no.'],
    abstain: ['The instrument is wrong even where the aim is right. Abstained.', 'I reserve my position on the drafting.', 'I would want this pleaded better. Stood aside.'],
  },
  folksy: {
    for: ['I put this to people in {d} and they told me to vote for it. So I did.', 'It is a plain good thing for plain people. Aye.', 'My neighbours will notice this one. Yes.'],
    against: ['Nobody in {d} asked for this. No.', 'I cannot go home and defend it. Against.', 'We were promised this before. I am voting no.'],
    abstain: ['{d} is split and so am I, honestly. Abstained.', 'I will not guess at what my people want. Stood aside.', 'I would rather say nothing than say the wrong thing.'],
  },
  firebrand: {
    for: ['At last. Aye, and about time.', 'Anyone voting against this should explain themselves to {d}. For.', 'Yes — and I want the vote recorded.'],
    against: ['This is an insult dressed as a bill. No.', 'They will not do this to {d} while I have a vote. Against.', 'Absolutely not, and I will say so outside.'],
    abstain: ['I refuse to dignify it with a vote.', 'A pox on the lot of it. Abstained.', 'I will not be counted on this farce.'],
  },
  wonk: {
    for: ['The numbers hold at the stated rate. Aye.', 'Costed, funded, and it clears its own threshold. Yes.', 'It does what it says it does. For.'],
    against: ['The arithmetic does not close. No.', 'This is a rounding error pretending to be a policy. Against.', 'The projection assumes a growth rate we have never had. No.'],
    abstain: ['I want the figures before I want an opinion. Abstained.', 'Insufficient data. Stood aside.', 'Bring me the model and I will bring you a vote.'],
  },
  weary: {
    for: ['We have argued this for years. Fine. Aye.', 'It is not what I wanted, but it is something. Yes.', 'For — and let us not do this again.'],
    against: ['I voted against this the last time it had another name. No.', 'It will not work. It did not work before. Against.', 'No. I have run out of ways to say it.'],
    abstain: ['I have nothing left to say about this. Abstained.', 'Wake me when it changes. Stood aside.', 'Neither. Genuinely, neither.'],
  },
};

const STATEMENTS = {
  tax: {
    for: ['The bills come due whether we like them or not. Aye.', 'You cannot run a republic on good wishes. Yes from me.', 'Someone has to pay for the roads {d} keeps asking for. Aye.'],
    against: ['Another reach into the pockets of {d}. Not with my vote.', 'We tax and tax, then wonder why the streets are angry. No.', 'Raise this and the money simply leaves. I voted no.'],
    abstain: ['The rate is wrong in both directions. I stood aside.', 'I could not in conscience vote either way on this one.', '{d} is split down the middle, and so am I. Abstained.'],
  },
  spend: {
    for: ['This is money {d} will actually see. I backed it.', 'Idle treasuries help no one. Aye.', 'Build it — my people have waited long enough. Yes.'],
    against: ['We do not have the money for this, whatever the sponsor says. No.', 'Grand projects, empty coffers. I voted against.', 'This buys headlines, not results. No from {d}.'],
    abstain: ['Worthy aim, reckless price. I abstained.', 'Fund it properly or not at all — I stood aside.', 'I want this built, just not like this. Abstained.'],
  },
  war: {
    for: ['Weakness invites what strength deters. Aye.', 'There is a time to stand, and this is it. Yes.', '{d} will not be safe if we flinch now. For.'],
    against: ['War is easy to start and murder to end. No.', 'We are already exhausted. I will not send them again. No.', 'Show me the plan to win before you ask for the war. Against.'],
    abstain: ["I will not cheer a war, nor tie the government's hands. Abstained.", 'Not yet. I stood aside.', 'The case is not made either way. Abstained.'],
  },
  rights: {
    for: ['A right on paper is worth having when the arrests begin. Aye.', 'Better to bind our own hands than trust our own tempers. Yes.', 'This protects {d} from us as much as from anyone. For.'],
    against: ['Fine words that will tie the state in a crisis. No.', 'Rights without order are a suggestion. Against.', 'We cannot govern {d} with our wrists cuffed. No.'],
    abstain: ['Good in spirit, loose in wording. I abstained.', 'I support the idea and distrust the draft. Stood aside.', 'Bring it back tighter and I am with you. Abstained.'],
  },
  power: {
    for: ['The office needs the tools to do the job. Aye.', 'Someone must be able to act. Yes.', 'Better a clear hand than a paralysed one. For.'],
    against: ['Every power we grant is one we cannot easily take back. No.', 'This is how republics quietly stop being republics. Against.', '{d} did not send me to hand away its say. No.'],
    abstain: ['Necessary and dangerous in equal measure. Abstained.', 'I would grant it to some hands, not these. Stood aside.', 'Ask me again when I trust the holder. Abstained.'],
  },
  rules: {
    for: ['The rules should fit the country we actually are. Aye.', 'Overdue housekeeping. Yes.', 'This makes the machine run truer for {d}. For.'],
    against: ['You do not rewrite the rulebook mid-game to suit yourself. No.', 'This redraws the lines to the sponsor’s advantage. Against.', 'Institutional caution — I voted no.'],
    abstain: ['A change worth making, made carelessly. Abstained.', 'Not against the aim, only the hurry. Stood aside.', 'I withheld my vote on principle. Abstained.'],
  },
  person: {
    for: ['The office is bigger than the person in it. Aye.', 'The evidence left me no honest choice. Yes.', 'No one is above the seat they hold. For removal.'],
    against: ['Remove them for this and no chair is ever safe again. No.', 'A vote to settle scores, not to do justice. Against.', '{d} elected them; a chamber should not simply undo that. No.'],
    abstain: ['Grave charge, thin proof. I stood aside.', 'I will not convict on a mood. Abstained.', 'Let the voters judge this, not us. Abstained.'],
  },
  generic: {
    for: ['On balance, this does more good than harm. Aye.', 'I read it, weighed it, backed it. Yes.', 'Good enough to pass, and {d} needs the win. For.'],
    against: ['More cost than sense in this one. No.', 'Not persuaded. Against.', 'This does not serve {d}. No.'],
    abstain: ['Not convinced either way. Abstained.', 'I stood aside on this one.', 'Neither yes nor no in good conscience. Abstained.'],
  },
};
function topicOf(doc) {
  const k = (doc.clauses[0] && doc.clauses[0].kind) || (doc.type === 'impeachment' ? 'REMOVE' : '');
  if (k === 'SET_TAX') return 'tax';
  if (k === 'APPROPRIATE' || k === 'BUILD') return 'spend';
  if (k === 'DECLARE_WAR') return 'war';
  if (k === 'RIGHT') return 'rights';
  if (k === 'GRANT_POWER') return 'power';
  if (k === 'AMEND' || k === 'REDISTRICT') return 'rules';
  if (k === 'REMOVE' || doc.type === 'impeachment') return 'person';
  return 'generic';
}
// When a member changes their vote because the bill or the conditions moved,
// they say so — the words a principled member would use for a genuine rethink.
const CHANGED = {
  for: ['I said no, but the bill has changed — and so has my vote. Aye now.', 'Credit where due: they fixed what I objected to. I switched to yes.', '{d} sees something here now it did not before. I moved to aye.'],
  against: ['I was with this, but no longer — what changed lost me. No now.', 'The terms turned, and my vote turned with them. Against.', 'I gave my word on the old bill, not this one. No.'],
  abstain: ['I can no longer take a side on this. I have withdrawn to abstain.', 'The ground shifted under this vote; I am stepping back.', 'On reflection, {d} and I both had better sit this one out.'],
};
export function voteStatement(world, persona, doc, ballot, reconsidered = false) {
  const dir = ballot === 'yea' ? 'for' : ballot === 'nay' ? 'against' : 'abstain';
  // Who is speaking, most of the time; what it was about, the rest. A chamber
  // where everyone answers in the topic's voice is a chamber of one person.
  const voice = VOICES[temperamentOf(persona).id]?.[dir];
  const topical = (STATEMENTS[topicOf(doc)] || STATEMENTS.generic)[dir];
  const useVoice = voice && hash01(persona.id + '#voice#' + doc.id) < 0.65;
  const pool = reconsidered ? CHANGED[dir] : (useVoice ? voice : topical);
  const seat = R.seatOf(world, persona.id);
  const dName = seat && seat.district ? (world.districts.find((x) => x.id === seat.district) || {}).name : null;
  const s = persona.id + ':' + doc.id + (reconsidered ? ':r' : ''); let key = 0;
  for (let i = 0; i < s.length; i++) key = (key * 31 + s.charCodeAt(i)) >>> 0;
  return pool[key % pool.length].replace(/\{d\}/g, dName || 'my district');
}

/**
 * Members bringing their own bills.
 *
 * The chamber only ever voted; it never proposed. Every bill in a Season came
 * from a player, which made the seven citizens holding seats a voting machine
 * rather than a legislature. So from time to time a member looks at the worst
 * number in their own district and files something about it.
 *
 * Deliberately rare — about one bill somewhere in the chamber every canon year
 * and a half — because the point is that the floor has a life of its own, not
 * that the player is buried in other people's paperwork.
 */
const MEMBER_BILL_YEARS = 1.5;

function tickMemberBills(world) {
  if (world.phase !== 'live') return;
  const per = world.clock.ticksPerYear || 240;
  if (!chance(world, 1 / (MEMBER_BILL_YEARS * per))) return;
  // Nobody files while the floor is busy; a chamber with a bill on it is
  // already doing the thing this exists to produce.
  if (Object.values(world.documents).some((d) => d.status === 'floor')) return;

  // Either chamber. A senator's bill still starts its life in the House — that
  // is where every measure originates here — but a Senate that never files
  // anything is twenty people who only ever say no to other people's work.
  const rooms = R.chambers(world);
  const seated = world.seats.filter((s) => rooms.includes(s.office) && s.personaId)
    .map((s) => ({ seat: s, p: world.personas[s.personaId] }))
    .filter((x) => x.p && x.p.alive && !x.p.playerId && !x.p.imprisoned && !x.p.exiled);
  if (!seated.length) return;
  const { seat, p } = pick(world, seated);
  if (!R.mayPropose(world, p.id, 'bill').ok) return;

  const d = seat.district ? world.districts.find((x) => x.id === seat.district) : null;
  if (!d) return;

  // What is actually worst in their district, weighted by how much that
  // district cares about it. A member from a comfortable seat files nothing.
  const grievances = [
    { key: 'housing', bad: d.homeless / Math.max(1, d.pop) * 22, sal: d.salience.housing },
    { key: 'jobs', bad: d.unemployment * 9, sal: d.salience.jobs },
    { key: 'order', bad: (50 - (d.order ?? 50)) / 30, sal: d.salience.order },
    { key: 'amenity', bad: (50 - (d.amenity ?? 50)) / 30, sal: d.salience.amenity ?? 0.5 },
  ].map((g) => ({ ...g, score: g.bad * (0.5 + g.sal) }))
    .sort((a, b) => b.score - a.score);
  const top = grievances[0];
  if (!top || top.score < 0.55) return;    // nothing worth a bill

  const ASKS = {
    housing: { amount: 6e6, purpose: `housing in ${d.name}`, title: `${d.name} Housing Act`,
      pre: `Whereas ${d.homeless.toLocaleString()} people in ${d.name} have nowhere to sleep, and the district has waited long enough for a building rather than a promise.` },
    jobs: { amount: 5e6, purpose: `jobs and relief in ${d.name}`, title: `${d.name} Employment Act`,
      pre: `Whereas ${(d.unemployment * 100).toFixed(1)} percent of ${d.name} is out of work, and a member who says nothing about it should not be returned.` },
    order: { amount: 4e6, purpose: `policing in ${d.name}`, title: `${d.name} Public Order Act`,
      pre: `Whereas order in ${d.name} has broken down to a degree its people can measure by walking home.` },
    amenity: { amount: 5e6, purpose: `schools and clinics in ${d.name}`, title: `${d.name} Amenities Act`,
      pre: `Whereas ${d.name} has neither the schools nor the clinics its numbers entitle it to.` },
  };
  const ask = ASKS[top.key];
  if (!ask || ask.amount > world.economy.treasury * 0.6) return;   // do not file the absurd

  const doc = createDoc(world, {
    type: 'bill', title: ask.title, authorId: p.id, preamble: ask.pre,
    clauses: [{ kind: 'APPROPRIATE', amount: ask.amount, purpose: ask.purpose }],
  });
  if (!doc || doc.ok === false) return;
  const res = introduce(world, doc.id, p.id, 60);
  if (!res.ok) return;
  log(world, 'law', `${p.name} brings ${withThe(ask.title)} to the floor on behalf of ${d.name}.`,
    { actors: [p.id], docId: doc.id, weight: 2 });
}

// --- terms, elections, appointments ----------------------------------------

/**
 * Inauguration day.
 *
 * A president-elect chosen in November takes the oath here and not before. The
 * whole point of separating the two is that the country knows who won for two
 * months while somebody else still holds the powers — see rules.electionCallTick.
 */
function tickPendingTerms(world) {
  for (const pt of [...(world.pendingTerms || [])]) {
    if (world.clock.tick < pt.at) continue;
    world.pendingTerms = world.pendingTerms.filter((x) => x !== pt);
    const o = R.office(world, pt.office);
    const seat = world.seats.find((s) => s.id === pt.seatId) || world.seats.find((s) => s.office === pt.office);
    const p = world.personas[pt.personaId];
    if (!o || !seat) continue;
    // Winning is not the same as being able to serve. An election runs for
    // months and `nominate` only tests eligibility on the day somebody stands,
    // so a winner exiled or jailed during their own campaign was sworn in
    // anyway — and tickTerms vacated them again on the next tick, and the next,
    // for the rest of the Season. The chair stays empty instead and the
    // machinery calls another election for it.
    if (!p || !p.alive || p.exiled || p.imprisoned) {
      if (p) {
        log(world, 'election', `${p.name} won the ${o.name} and cannot take it: `
          + `${p.exiled ? 'they are in exile' : p.imprisoned ? 'they are in a cell' : 'they did not live to be sworn in'}. `
          + 'The chair stays empty until the republic fills it.', { actors: [p.id], weight: 3 });
      }
      continue;
    }

    const prev = seat.personaId;
    const returned = prev === pt.personaId;
    // Why they are leaving, and only "defeated" if they actually stood. A
    // holder who was on the ballot and lost was defeated; one who was barred by
    // a term limit was term-limited; one who could have stood and did not
    // stood down. All three used to read as a defeat at the polls.
    if (prev && !returned) {
      const stood = pt.outgoing === prev ? pt.outgoingStood !== false : true;
      // `.ok` — mayHoldAgain returns { ok, reason } so it can quote the clause,
      // and the bare call is always truthy. Same trap as director.fire().
      const couldHave = R.mayHoldAgain(world, prev, o.id).ok;
      vacate(world, seat, stood ? 'defeated' : couldHave ? 'stood down' : 'term-limited');
    }
    // An incumbent returned is a *new term*, and the one they have just
    // finished has to be written down before `since` is overwritten.
    //
    // closeElection carries this exact fix, with a comment describing this
    // exact bug — but it carries it on the branch that seats a winner
    // immediately, and that branch is nearly unreachable: a winner is sworn in
    // on the constitutional swearing day, so `takesOfficeAt` is in the future
    // and the whole thing goes down the pendingTerms path instead. Every real
    // re-election lands here, and here nothing was archived at all.
    //
    // What that cost: a president who won a second term lost the first one
    // completely. `seat.since` moved to the new term and the old one existed
    // nowhere, so serviceRecord, administrations and tenureRecord all began at
    // the second inauguration — the founding term 2029–2033 simply never
    // appeared in anybody's article, and neither did any war, treaty or act
    // inside it, because tenureRecord's window is built from these runs.
    else if (returned && seat.since != null) {
      world.pastSeats = world.pastSeats || [];
      world.pastSeats.push({ ...seat, endedTick: world.clock.tick, why: 're-elected' });
    }
    seat.personaId = pt.personaId;
    seat.since = world.clock.tick;
    seat.termEnds = R.termEndTick(world, o, world.clock.tick);
    // The term was already recorded the night it was won; here only the honeymoon
    // lands, on the day power actually moves. A pending term with no `counted`
    // flag (an old save, say) still counts here, so none slips through uncounted.
    if (pt.counted) R.honeymoonNudge(p); else R.countTerm(world, pt.personaId, o.id);
    const held = p.terms?.[o.id] || 1;
    log(world, 'office', `${p.name} is sworn in ${o.seats > 1 ? 'to the' : 'as'} ${o.name}`
      + `${held > 1 ? ` for a ${['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'][Math.min(6, held)]} term` : ''}`
      + `${prev && !returned ? `, succeeding ${world.personas[prev]?.name}` : ''}.`,
    { actors: [pt.personaId, prev].filter(Boolean), weight: 4 });

    // The running mate takes the oath on the same day, for the same term.
    const mateOffice = R.ticketMateOffice(world, o.id);
    if (mateOffice && pt.runningMate && world.personas[pt.runningMate]?.alive) {
      const mateSeat = world.seats.find((ms) => ms.office === mateOffice);
      if (mateSeat) {
        if (mateSeat.personaId && mateSeat.personaId !== pt.runningMate) vacate(world, mateSeat, 'ticket changed');
        // And the same for a deputy returned on the same ticket, who was losing
        // their earlier terms the same way and for the same reason.
        else if (mateSeat.personaId === pt.runningMate && mateSeat.since != null) {
          world.pastSeats = world.pastSeats || [];
          world.pastSeats.push({ ...mateSeat, endedTick: world.clock.tick, why: 're-elected' });
        }
        mateSeat.personaId = pt.runningMate;
        mateSeat.since = world.clock.tick;
        mateSeat.termEnds = seat.termEnds;
        if (pt.mateCounted) R.honeymoonNudge(world.personas[pt.runningMate]);
        else R.countTerm(world, pt.runningMate, mateOffice);
        log(world, 'office', `${world.personas[pt.runningMate]?.name} is sworn in as ${R.office(world, mateOffice)?.name}.`,
          { actors: [pt.runningMate], weight: 2 });
      }
    }
  }
}

/**
 * How long a chair that has never been filled waits for a real appointment.
 *
 * Two hundred ticks, about ten months. A government forms in its first weeks and
 * an NPC president names its cabinet within a hundred and fifty; a post still
 * empty after ten months is a post nobody is going to fill.
 */
const CARETAKER_GRACE_NEW = 200;

function tickTerms(world) {
  tickPendingTerms(world);
  for (const seat of world.seats) {
    const o = R.office(world, seat.office);
    if (!o) continue;
    if (seat.personaId) {
      const p = world.personas[seat.personaId];
      if (!p || !p.alive || p.exiled) { vacate(world, seat, 'vacated'); continue; }
      // The country goes to the polls in the November before a term runs out,
      // not on the morning it expires. See rules.electionCallTick — the winner
      // waits until the swearing-in day, and the incumbent holds every power of
      // the office until then.
      const elective = o.selection === 'election' && !o.ticket;
      if (elective && seat.termEnds != null
        && world.clock.tick >= R.electionCallTick(world, seat.termEnds)
        && !world.elections.some((e) => e.office === o.id && e.status === 'open')
        && !(world.pendingTerms || []).some((pt) => pt.seatId === seat.id)) {
        const res = scheduleElection(world, o.id, 60);
        if (res.ok) {
          res.value.takesOfficeAt = seat.termEnds;
          log(world, 'election', `The country goes to the polls for the ${o.name}. `
            + `Whoever wins is sworn in on ${canonDate(world, seat.termEnds)}.`, { weight: 2 });
        }
      }
      if (seat.termEnds != null && world.clock.tick >= seat.termEnds) {
        if (elective) {
          // Nobody was elected in time — a vacancy the machinery has to fill.
          if (!world.elections.some((e) => e.office === o.id && e.status === 'open')
            && !(world.pendingTerms || []).some((pt) => pt.seatId === seat.id)) {
            scheduleElection(world, o.id, 60);
            log(world, 'election', `The term of the ${o.name} expires with no successor chosen. Nominations open.`, { weight: 2 });
          }
          seat.termEnds = world.clock.tick + 60; // caretaker until the count
        } else {
          seat.termEnds = R.termEndTick(world, o, world.clock.tick);
        }
      }
    } else {
      // Vacancies fill themselves eventually — a republic abhors an empty chair.
      const waited = world.clock.tick - (seat.vacantSince ?? world.clock.tick);
      // A mid-term VP vacancy is filled by presidential appointment (o.ticket),
      // not by its own election — same handling as an appointive office.
      if (o.selection === 'appointment' || o.ticket) {
        // The three cabinet posts are created empty and are only ever filled by
        // a deliberate appointment, so they have no vacantSince — and with
        // `?? tick` above, `waited` was zero for ever and this caretaker, whose
        // whole job is to fill a post nobody appointed to, could never fire for
        // the only posts that need it. Start the clock the first time the chair
        // is seen empty. Elective seats are left alone: theirs is stamped by
        // vacate(), and an unstamped one there is a convention-time artefact,
        // not a vacancy the country should be called to the polls over.
        //
        // A post that has never been filled waits longer than one that fell
        // vacant. Fifty ticks is the right grace for a secretary who resigned;
        // for the founding cabinet it raced the incoming government's own
        // appointments and sometimes won, so a president who was about to name
        // their Secretary of State found a caretaker already in the chair.
        const neverFilled = seat.since == null;
        if (seat.vacantSince == null) seat.vacantSince = world.clock.tick;
        if (world.clock.tick - seat.vacantSince > (neverFilled ? CARETAKER_GRACE_NEW : 50)) {
          const p = makePersona(world, { synthetic: true, district: seat.district });
          p.bio = `Caretaker ${o.name}, seated when the appointment was not made.`;
          seat.personaId = p.id; seat.since = world.clock.tick;
          seat.termEnds = R.termEndTick(world, o, world.clock.tick);
          log(world, 'office', `${p.name} is seated as ${o.name} in default of an appointment.`, { actors: [p.id] });
        }
      } else if (waited > 16 && !world.elections.some((e) => e.office === o.id && e.status === 'open')) {
        scheduleElection(world, o.id, 60);
      }
    }
  }
}

/** Elections open right now. While any is, the republic is at the polls. */
export const openElections = (world) => (world.elections || []).filter((e) => e.status === 'open');

/**
 * Has everybody who can vote in this election finished?
 *
 * The ballot is a blocking modal, so in practice the answer arrives in seconds
 * and the count follows immediately — nobody sits watching a frozen clock run
 * down a thirty-tick timer they have already finished with. Players who are not
 * eligible to vote (no persona, imprisoned, exiled) are not waited on.
 */
function everyoneHasVoted(world, e) {
  const voters = Object.values(world.players).filter((pl) => {
    const p = pl.personaId ? world.personas[pl.personaId] : null;
    return p && p.alive && !p.exiled && !p.imprisoned;
  });
  if (!voters.length) return false;
  return voters.every((pl) => e.sealed?.[pl.personaId] != null);
}

/**
 * How long a finished election stays in the world.
 *
 * It used to stay for ever. Every race a republic ever ran kept its full
 * candidate list, its per-district tallies, every ballot cast and every sealed
 * envelope, in a list that is serialised to storage and republished to every
 * other tab on a one-second clock. Twenty-nine years of Season came out at
 * fifty-odd closed elections carried in every snapshot, for no reader: the
 * Chronicle already holds the result, and nothing in the engine reads a race
 * that closed a decade ago. A year is long enough for anything still looking at
 * the count to find it.
 */
export const ELECTION_KEEP_YEARS = 1;

function pruneElections(world) {
  const keep = ELECTION_KEEP_YEARS * (world.clock.ticksPerYear || 240);
  const before = world.elections.length;
  world.elections = world.elections.filter((e) =>
    !(e.status === 'closed' || e.status === 'void')
    || e.closedAt == null
    || world.clock.tick - e.closedAt < keep);
  return before - world.elections.length;
}

function tickElections(world) {
  if (world.clock.tick % 60 === 0) pruneElections(world);
  for (const e of world.elections) {
    if (e.status !== 'open') continue;
    const o = R.office(world, e.office);
    if (!o) { e.status = 'void'; continue; }
    e.age = (e.age || 0) + 1;

    // NPC incumbents stand for re-election as a matter of course. A *player*
    // is not entered against their will: standing again is a decision, and the
    // ballot is a blocking modal put in front of them with a "Declare your
    // candidacy" button, so they cannot miss the window the way the old comment
    // here worried about. Being auto-nominated meant a player who meant to
    // retire had to find a way to withdraw from a race they never entered.
    // A runoff has a fixed field — the top two from the first round — so it never
    // opens nominations. Everything else does at age 4.
    if (e.age === 4 && !e.runoff) {
      for (const s of world.seats.filter((s) => s.office === e.office)) {
        if (!s.personaId) continue;
        if (world.personas[s.personaId]?.everPlayer) continue; // theirs to declare
        nominate(world, e, s.personaId, s.district, null, s.id);
      }
      const seats = world.seats.filter((s) => s.office === e.office);
      const office = R.office(world, e.office);
      const challenger = (s) => {
        const d = s.district ? world.districts.find((x) => x.id === s.district) : pick(world, world.districts);
        // Old enough for the chair they are standing for. makePersona rolls an
        // age from 34, and the constitution asks 35 of anyone standing for the
        // executive — so about one challenger in thirty-four was refused by
        // nominate on the way in, silently, and the guarantee below then thought
        // it had filled the ballot. On a single-seat race with a retiring
        // incumbent that is an empty ballot, a stopped clock, and a President
        // held in a chair they had just chosen to leave: the exact fault this
        // block exists to prevent, reintroduced by the age rule.
        const p = makePersona(world, {
          synthetic: true, district: s.district, party: d?.lean,
          minAge: R.minAgeFor(world, e.office),
        });
        p.approval = 44 + rng(world) * 18;
        p.bio = `Challenger${s.district ? ' for ' + d?.name : ''}.`;
        return nominate(world, e, p.id, s.district, null, s.id).ok;
      };
      // Usually contested: three seats in four draw a challenger.
      for (const s of seats) if (chance(world, 0.75)) challenger(s);

      // And then, whatever the dice said, nobody at all is not an election.
      //
      // That roll is per seat, so on the Assembly's seven it is invisible — the
      // odds of all seven coming up empty are nil. On a single-seat office it is
      // a flat one in four, and it lands squarely on the change above: a player
      // incumbent is deliberately not entered against their will, so a President
      // who declines to stand again met an empty ballot a quarter of the time.
      // The republic then stopped its own clock and put a blocking modal with
      // nobody on it in front of them for a full minute — and, having no one to
      // hand the office to, kept them in the chair they had just chosen to
      // leave. Measured: 10 of 40 retirements, every one of them held over.
      //
      // Nominations open once, at age 4, and never again, so this is the only
      // place the gap can be closed. A seat is checked against whatever actually
      // decides its field at the count: its own numbered district if it has one,
      // its state if the chamber is one seat per state, and the length of the
      // race if the office has no district at all (the presidency, the vice
      // presidency).
      //
      // The seat-level check is what an apportioned chamber needs. Asking only
      // "does this state have a candidate" was right while a state held one
      // seat; with four Texas seats it is satisfied by one Texan, and the other
      // three go to the count with nobody on them.
      for (const s of seats) {
        const bare = !s.district
          ? e.candidates.length < seats.length
          : office?.apportioned
            ? !e.candidates.some((c) => c.seatId === s.id)
            : !e.candidates.some((c) => (c.district ?? null) === s.district);
        if (bare) challenger(s);
      }
    }
    // Former heads of government throw their weight behind someone once the field
    // is set — but only in the race for the chair they once held, and only the
    // NPCs here; a player's former president endorses through the ballot. Each
    // backs a candidate of their own party, or the strongest on offer if none.
    if (e.age === 5 && !e.runoff && !e.endorsed && e.office === R.headOffice(world)?.id) {
      e.endorsed = true;
      const head = R.headOffice(world);
      for (const per of Object.values(world.personas)) {
        if (!per.synthetic || !per.alive || per.imprisoned || per.exiled) continue;
        if (!R.heldHeadOffice(world, per.id)) continue;
        if (R.officesOf(world, per.id).some((o) => o.id === head?.id)) continue;   // still in the chair
        if (e.candidates.some((c) => c.personaId === per.id)) continue;            // standing themselves
        const sameParty = e.candidates.filter((c) => world.personas[c.personaId]?.party === per.party);
        const pool2 = (sameParty.length ? sameParty : e.candidates).slice()
          .sort((a, b) => (world.personas[b.personaId]?.approval || 0) - (world.personas[a.personaId]?.approval || 0));
        if (pool2[0]) endorse(world, per.id, e, pool2[0].personaId);
      }
    }
    // The field has to exist before the count means anything, so an early close
    // waits for nominations to have opened.
    if (e.age >= e.runs || (e.age > 4 && everyoneHasVoted(world, e))) closeElection(world, e);
  }
}

export function nominate(world, election, personaId, district = null, runningMate = null, seatId = null) {
  if (election.candidates.some((c) => c.personaId === personaId)) return { ok: false, reason: 'Already nominated.' };
  const p = world.personas[personaId];
  if (!p || !p.alive || p.exiled || p.imprisoned) return { ok: false, reason: 'This persona cannot stand.' };
  const o = R.office(world, election.office);
  // Term limits bite here, at the point of standing. A ballot that lists a
  // candidate who cannot hold the office is a ballot that wastes the votes cast
  // for them.
  const eligible = R.mayHoldAgain(world, personaId, election.office);
  if (!eligible.ok) return eligible;
  const cand = { personaId, district: district ?? p.district ?? null, votes: 0, breakdown: null };
  // **An apportioned chamber runs one contest per seat, not one per state.**
  //
  // closeElection filters the field to the seat's own district, which is the
  // right rule when a state holds one seat and a disaster when it holds four:
  // every seat sees the same field, so the same person wins all of them and the
  // other three quarters of the state's delegation is that one person again. A
  // candidate for an apportioned seat therefore declares for a *seat* — a
  // numbered congressional district — and the field is cut by that instead.
  if (o?.apportioned && o.electorate === 'district' && cand.district) {
    const seats = world.seats.filter((s) => s.office === o.id && s.district === cand.district);
    // A named seat wins, because the caller that names one is the guarantee that
    // no seat goes to the count empty — and it has to be able to fill *that*
    // seat rather than whichever one the heuristic below prefers. Otherwise the
    // guarantee walks the seats in order, and every challenger it makes for a
    // bare seat lands on the earliest empty one instead.
    const named = seatId && seats.find((s) => s.id === seatId);
    // An incumbent stands again for their own district. Anyone else takes the
    // emptiest one going, so a state's races fill out evenly instead of the whole
    // field piling into whichever seat happens to be listed first.
    const held = seats.find((s) => s.personaId === personaId);
    const declared = (sid) => election.candidates.filter((c) => c.seatId === sid).length;
    const target = named || held
      || seats.slice().sort((a, b) => declared(a.id) - declared(b.id) || a.index - b.index)[0];
    if (target) { cand.seatId = target.id; cand.cd = target.cd; }
  }
  // A ticket office (the President) may name a running mate for the office elected
  // on its ticket (the VP). A synthetic mate joins at once; a player must accept.
  const mate = R.ticketMateOffice(world, election.office);
  if (mate && runningMate && world.personas[runningMate] && runningMate !== personaId) {
    const rm = world.personas[runningMate];
    cand.runningMate = runningMate;
    cand.mateAccepted = !rm.playerId;
    if (rm.playerId) {
      world.nominations = (world.nominations || []).filter((n) => !(n.ticket === election.id && n.by === personaId));
      world.nominations.push({ ticket: election.id, candidate: personaId, personaId: runningMate, office: mate, by: personaId, tick: world.clock.tick });
    }
  }
  election.candidates.push(cand);
  if (!p.synthetic) log(world, 'election', `${p.name} stands for the ${o?.name}${cand.runningMate ? `, with ${world.personas[cand.runningMate]?.name} for ${R.office(world, mate)?.name}` : ''}.`, { actors: [personaId] });
  return { ok: true };
}

/**
 * A former head of government endorses a candidate in an open election.
 *
 * Worth a little to that candidate's appeal at the count — see closeElection,
 * where it is (the endorser's performance score / 100) per cent. Only a former
 * head may give one: a sitting head endorsing would just be campaigning with the
 * powers of the office, and someone who never held it has nothing to lend. One
 * endorsement per person per election; endorsing again moves it.
 */
export function endorse(world, endorserId, election, candidatePersonaId) {
  if (!election || election.status !== 'open') return { ok: false, reason: 'The polls are closed.' };
  const e = world.personas[endorserId];
  if (!e || !e.alive) return { ok: false, reason: 'No such person.' };
  if (!R.heldHeadOffice(world, endorserId)) return { ok: false, reason: 'Only a former head of government may endorse.' };
  if (R.officesOf(world, endorserId).some((o) => o.id === R.headOffice(world)?.id)) {
    return { ok: false, reason: 'A sitting head of government does not endorse — they campaign.' };
  }
  const cand = election.candidates.find((c) => c.personaId === candidatePersonaId);
  if (!cand) return { ok: false, reason: 'That candidate is not standing in this election.' };
  for (const c of election.candidates) c.endorsedBy = (c.endorsedBy || []).filter((id) => id !== endorserId);
  cand.endorsedBy = [...(cand.endorsedBy || []), endorserId];
  log(world, 'election', `${e.name} endorses ${world.personas[candidatePersonaId]?.name || 'a candidate'} for the ${R.office(world, election.office)?.name}.`,
    { actors: [endorserId, candidatePersonaId], weight: 2 });
  return { ok: true };
}

/**
 * What a candidate's endorsements are worth to their appeal, as a fraction: each
 * endorsing former head of government adds (their performance score / 100) per
 * cent. Zero for a candidate nobody has endorsed, which is the common case.
 */
export function endorseBoost(world, cand) {
  if (!(cand.endorsedBy || []).length) return 0;
  const ranks = {};
  for (const r of computeRanking(world)) ranks[r.persona.id] = r.overall;
  return cand.endorsedBy.reduce((b, eid) => b + ((ranks[eid] ?? 50) / 100) * 0.01, 0);
}

export function castBallot(world, electionId, voterPersonaId, candidatePersonaId) {
  const e = world.elections.find((x) => x.id === electionId);
  if (!e || e.status !== 'open') return { ok: false, reason: 'The polls are closed.' };
  // `!= null`, not truthiness: the seal records the tick it happened on, and
  // tick 0 is a real tick. Testing it as a boolean silently unsealed every
  // ballot submitted at the founding.
  if (e.sealed?.[voterPersonaId] != null) return { ok: false, reason: 'Your ballot is submitted. It cannot be changed before the count.' };
  // A district office is not one election. It is one contest per seat, run at
  // the same moment — closeElection has always counted it that way, filtering
  // the field to the seat's own district — but the ballot let anybody vote for
  // anybody, so a player could put their weight behind a candidate standing
  // four districts away and it landed in that district's count. You vote where
  // you live, in the one race you are an elector in, and nowhere else.
  const o = R.office(world, e.office);
  if (o?.electorate === 'district') {
    const voter = world.personas[voterPersonaId];
    const cand = e.candidates.find((c) => c.personaId === candidatePersonaId);
    if (!voter?.district) return { ok: false, reason: 'You are from no district, so you have no seat to vote for.' };
    if (cand && cand.district !== voter.district) {
      const home = world.districts.find((d) => d.id === voter.district);
      return { ok: false, reason: `That candidate stands in another district. You vote for ${home?.name || 'your own district'}'s seat.` };
    }
  }
  e.ballots[voterPersonaId] = candidatePersonaId;
  return { ok: true };
}

/**
 * Finish voting before the polls do. A ballot is revisable right up to the
 * count, which means "I have decided" and "I have not looked yet" are the same
 * state — and it leaves the ballot page holding canon time at a crawl for a
 * player who is already done. Submitting settles both: the vote is fixed, and
 * you stop slowing the world down.
 */
export function sealBallot(world, electionId, voterPersonaId) {
  const e = world.elections.find((x) => x.id === electionId);
  if (!e || e.status !== 'open') return { ok: false, reason: 'The polls are closed.' };
  if (!voterPersonaId) return { ok: false, reason: 'No persona to vote with.' };
  if (!e.ballots[voterPersonaId]) return { ok: false, reason: 'Choose a candidate before you submit your ballot.' };
  e.sealed = e.sealed || {};
  if (e.sealed[voterPersonaId] != null) return { ok: false, reason: 'Your ballot is already submitted.' };
  e.sealed[voterPersonaId] = world.clock.tick;
  const p = world.personas[voterPersonaId];
  // That you have voted is public; who you voted for is not.
  if (p && !p.synthetic) {
    log(world, 'election', `${p.name} casts a ballot in the ${R.office(world, e.office)?.name} election.`,
      { actors: [voterPersonaId], weight: 1 });
  }
  return { ok: true };
}

// A runoff campaigns as long as the round that produced it.
const RUNOFF_RUNS = 60;

// Narrow the field to the top two and put them back to the country. The runoff
// carries the first round's swearing-in date, so the calendar is unchanged; its
// field is fixed, so no fresh nominations join it (see tickElections).
function scheduleRunoff(world, prev, o, topTwo) {
  const e = {
    id: uid('el'), office: o.id, status: 'open', runoff: true,
    opens: world.clock.tick, age: 0, runs: RUNOFF_RUNS, closes: world.clock.tick + RUNOFF_RUNS,
    candidates: topTwo.map((c) => ({
      personaId: c.personaId, district: c.district ?? null,
      seatId: c.seatId ?? null, cd: c.cd ?? null,
      runningMate: c.runningMate, mateAccepted: c.mateAccepted,
      votes: 0, breakdown: null,
    })),
    ballots: {}, sealed: {}, takesOfficeAt: prev.takesOfficeAt,
  };
  world.elections.push(e);
  const a = world.personas[topTwo[0].personaId]?.name || 'the front-runner';
  const b = world.personas[topTwo[1].personaId]?.name || 'the runner-up';
  log(world, 'election', `No candidate for the ${o.name} won a majority. A runoff is called between ${a} and ${b}.`, { weight: 3 });
  return e;
}

// How reliably each part of the electorate turns out. A party's firm bloc votes;
// the undecided vote at less than half that, and the rest of them stay home.
const PARTISAN_TURNOUT = 0.75;
const UNDECIDED_TURNOUT = 0.4;

/** The partisan split an election is decided in: a district's own, or the nation's. */
function partisanOf(world, d) {
  if (d && d.partisan) return { partisan: d.partisan, undecided: d.undecided ?? 0 };
  const tot = totalPop(world) || 1;
  const partisan = {};
  let undecided = 0;
  for (const dd of world.districts || []) {
    const w = (dd.pop || 0) / tot;
    for (const pid of Object.keys(dd.partisan || {})) partisan[pid] = (partisan[pid] || 0) + (dd.partisan[pid] || 0) * w;
    undecided += (dd.undecided ?? 0) * w;
  }
  return { partisan, undecided };
}

// How the party balance shifts. The government's standing moves voters into or
// out of the president's party at full weight; a district's own representative
// moves that district a tenth as much. Bounded per step, and drifting on its own
// slow clock so it is felt over a term, not a tick.
const AFFIL_CADENCE = 60;
const AFFIL_PRES = 0.02;   // most the president's party gains/loses per step
const AFFIL_REP = 0.1;     // a representative's pull, relative to the president's

/** Move `delta` of a district's voters into (or out of) a party, via the undecided. */
export function shiftPartisan(d, partyId, delta) {
  if (!d?.partisan || d.partisan[partyId] == null) return;
  const move = clamp(delta, -AFFIL_PRES, AFFIL_PRES);
  d.partisan[partyId] = Math.max(0.02, (d.partisan[partyId] || 0) + move);
  d.undecided = Math.max(0.02, (d.undecided || 0) - move);
  const total = (d.undecided || 0) + Object.values(d.partisan).reduce((a, b) => a + b, 0);
  if (total > 0) {
    d.undecided /= total;
    for (const k of Object.keys(d.partisan)) d.partisan[k] /= total;
  }
}

function tickAffiliation(world) {
  if (world.phase !== 'live') return;
  if (world.clock.tick % AFFIL_CADENCE !== 0) return;
  const head = R.headOffice(world);
  const rooms = R.chambers(world);
  const presSeat = world.seats.find((s) => s.office === head?.id && s.personaId);
  const pres = presSeat && world.personas[presSeat.personaId];
  const presPerf = pres ? (nationalApproval(world) - 50) / 50 : 0;   // -1…+1
  for (const d of world.districts || []) {
    if (!d.partisan) continue;
    if (pres?.party && d.partisan[pres.party] != null) shiftPartisan(d, pres.party, presPerf * AFFIL_PRES);
    // Everyone a state sends to the capital bends it, not just the one in the
    // lower chamber — but between them by no more than the single member used
    // to, so splitting the chamber does not silently double how fast a state's
    // partisanship moves. Two members, half the weight each.
    const mine = world.seats.filter((s) => rooms.includes(s.office) && s.district === d.id && s.personaId);
    for (const repSeat of mine) {
      const rep = world.personas[repSeat.personaId];
      if (!rep?.party || d.partisan[rep.party] == null) continue;
      const repPerf = (approvalIn(world, rep, d) - 50) / 50;
      shiftPartisan(d, rep.party, (repPerf * AFFIL_PRES * AFFIL_REP) / mine.length);
    }
  }
}

export function closeElection(world, e) {
  // The ballot is closed; nobody is deliberating over it any more. Without
  // this the last voter's 12s deliberation flag keeps the whole nation at
  // 1/8th speed and the header reads "at the ballot" over an empty page.
  world.deliberating = {};
  const o = R.office(world, e.office);
  const cw = world.constitution.elections.citizenWeight;
  const pw = world.constitution.elections.playerWeight;
  const seats = world.seats.filter((s) => s.office === e.office);

  for (const seat of seats) {
    // A seat's own field. `seatId` is set on nomination for an apportioned
    // chamber, where several seats share a state and the district alone cannot
    // tell their races apart; everything else still sorts by district, and a
    // candidate carrying neither runs everywhere the district allows.
    const field = e.candidates.filter((c) => {
      if (!seat.district) return true;
      if (c.seatId) return c.seatId === seat.id;
      return c.district === seat.district;
    });
    if (!field.length) continue;

    // The citizenry is one electorate, not one per candidate: partisanship and
    // appeal decide how it splits (see the allocation below), so the reported
    // count never exceeds the people who live there.
    const d = seat.district ? world.districts.find((x) => x.id === seat.district) : null;

    /**
     * A national election is a referendum on the government.
     *
     * Incumbency used to be a flat ×1.1 whatever the country thought of the
     * people in office, which made a presidency almost impossible to lose:
     * approval could sit at 22% for a whole term and the sitting head of
     * government still went into the count with a bonus. National approval is
     * the number the whole game is built around and it did not touch the one
     * event that is supposed to answer to it.
     *
     * So for a seat the whole nation votes on, the executive's own record
     * scales their appeal: neutral at 50%, worth about a quarter again at 80%,
     * and worth barely two-thirds of it at 20%. It lands on the head of
     * government hardest, because they are who the question is about, and on
     * the rest of the government at half strength.
     */
    const nat = nationalApproval(world);
    const head = R.headOffice(world);
    const referendum = (personaId) => {
      if (d) return 1;                                   // a district seat is a local question
      const offs = R.officesOf(world, personaId).map((x) => x.id);
      if (!offs.length) return 1;                        // a challenger is not on trial
      const full = clamp(0.55 + (nat / 100) * 0.9, 0.5, 1.5);
      return offs.includes(head?.id) ? full : 1 + (full - 1) * 0.5;
    };

    const appeals = field.map((c) => {
      const p = world.personas[c.personaId];
      const partyFit = d && p.party === d.lean ? 1.25 : 0.85;
      const incumbency = R.seatOf(world, c.personaId) ? 1.1 : 1;
      // A former head of government's endorsement is a thumb on the scale worth
      // (their performance score / 100) per cent — heavier the better regarded
      // the endorser. See endorseBoost.
      // Money in politics: a party's war chest lifts all its candidates, a
      // campaign fund lifts the one it backs. Capped at a per cent each — save a
      // company bootstrapping its own candidate, which is uncapped (see company).
      const funding = CO.partyInfluence(world, p.party) + CO.campaignInfluence(world, c.personaId);
      return clamp(p.approval / 50, 0.15, 2) * partyFit * incumbency
        * referendum(c.personaId) * (1 + endorseBoost(world, c)) * (1 + funding) * (0.85 + rng(world) * 0.3);
    });
    // The electorate, sorted between the parties. Each party's firm bloc votes for
    // its own candidates (split among them by appeal); the undecided turn out at a
    // lower rate and break by appeal across the whole field; the fully undecided
    // stay home. A candidate with no party has only the undecided to win, which in
    // a two-party electorate is almost never enough — running as an independent is
    // meant to be hard.
    const part = partisanOf(world, d);
    const N = d ? d.pop : totalPop(world);
    const appealSum = sum(appeals) || 1;
    const partyAppeal = {};
    field.forEach((c, i) => {
      const cp = world.personas[c.personaId]?.party;
      if (cp) partyAppeal[cp] = (partyAppeal[cp] || 0) + appeals[i];
    });
    field.forEach((c, i) => {
      const cp = world.personas[c.personaId]?.party;
      const bloc = (cp && (part.partisan[cp] || 0) > 0)
        ? N * part.partisan[cp] * PARTISAN_TURNOUT * (appeals[i] / (partyAppeal[cp] || 1))
        : 0;
      const undec = N * (part.undecided || 0) * UNDECIDED_TURNOUT * (appeals[i] / appealSum);
      const citizens = (bloc + undec) / 1000 * cw;
      const players = sum(Object.entries(e.ballots), ([voter, choice]) =>
        choice === c.personaId ? pw * (world.personas[voter]?.playerId ? 1 : 0.4) : 0);
      c.votes = citizens + players;
      c.breakdown = { citizens, players, bloc: (bloc / 1000) * cw, undecided: (undec / 1000) * cw };
    });
    const winner = field.slice().sort((a, b) => b.votes - a.votes)[0];
    const prev = seat.personaId;
    // Whether the country kept the person it had. Read before the seat is
    // touched, because vacate() clears it.
    const returned = !!prev && prev === winner.personaId;
    const total = sum(field, (c) => c.votes) || 1;
    const shareOf = Math.round((winner.votes / total) * 100);
    const castOf = Math.round(total * 1000).toLocaleString();

    // A head of government must win a majority, not merely lead a split field. If
    // the front-runner is short of half the vote and this is not already a runoff,
    // the field narrows to the top two and the country votes again — where one of
    // them necessarily clears fifty per cent. Head office only; district and
    // chamber seats stay first-past-the-post, and a two-horse race needs no
    // runoff (one of two already has the majority, bar an exact tie).
    if (head && o.id === head.id && !seat.district && !e.runoff
      && field.length > 2 && winner.votes <= total / 2) {
      const topTwo = field.slice().sort((a, b) => b.votes - a.votes).slice(0, 2);
      scheduleRunoff(world, e, o, topTwo);
      e.status = 'closed';
      e.closedAt = world.clock.tick;
      return;
    }

    // Elected in November, sworn in in January. The result is announced now and
    // nothing else happens: the incumbent keeps the chair and every power that
    // goes with it until the day the constitution names. See rules.swearingDay.
    if (e.takesOfficeAt != null && world.clock.tick < e.takesOfficeAt) {
      // Keyed by seat, not by office. A multi-seat chamber runs one contest per
      // seat inside a single election — see the loop above — so deduping by
      // office threw away six of the Assembly's seven winners and seated the
      // last one only.
      world.pendingTerms = (world.pendingTerms || []).filter((pt) => pt.seatId !== seat.id);
      const pending = {
        office: o.id, seatId: seat.id, personaId: winner.personaId,
        runningMate: winner.mateAccepted ? winner.runningMate : null,
        at: e.takesOfficeAt, elected: world.clock.tick,
        // Whether the holder losing the seat was on the ballot at all.
        //
        // Somebody who could not stand did not lose. A president at their term
        // limit is barred from the contest by the constitution they governed
        // under, and the record was filing that under `defeated` — "left the
        // chair in defeat at the polls" — for a president who never appeared on
        // a ballot paper. It is decided here, where the field is still in hand;
        // tickPendingTerms, which does the vacating two months later, has the
        // winner and nothing else.
        outgoing: prev || null,
        outgoingStood: prev ? e.candidates.some((c) => c.personaId === prev) : false,
      };
      world.pendingTerms.push(pending);
      // A term you were elected to counts the night you win it, not only when you
      // are sworn in — so stepping aside in the weeks before the oath cannot dodge
      // the term limit. Recorded here without the honeymoon; the honeymoon waits
      // for the swearing-in (tickPendingTerms), which is when power actually moves.
      R.recordTerm(world, winner.personaId, o.id);
      pending.counted = true;
      const mateOfficeAtWin = R.ticketMateOffice(world, o.id);
      if (mateOfficeAtWin && pending.runningMate && world.personas[pending.runningMate]?.alive) {
        R.recordTerm(world, pending.runningMate, mateOfficeAtWin);
        pending.mateCounted = true;
      }
      // "to the Assembly", "President" — a body takes you into it and a single
      // chair you simply are. Without the distinction this read "is returned to
      // the President", which is not a sentence.
      const asOffice = `${o.seats > 1 ? 'to the ' : ''}${o.name}`;
      log(world, 'election', `${world.personas[winner.personaId]?.name} is `
        + `${returned ? 're-elected' : 'elected'} ${asOffice} with ${shareOf}% of ${castOf} votes`
        + `${!returned && prev ? `, defeating ${world.personas[prev]?.name}` : ''}. `
        + `They are sworn in on ${canonDate(world, e.takesOfficeAt)}.`,
      { actors: [winner.personaId, prev].filter(Boolean), weight: 3 });
      e.status = 'closed';
      e.closedAt = world.clock.tick;
      continue;
    }

    // Same test as the swearing-in path above: a winner who cannot serve is not
    // seated, whatever the count said.
    const won = world.personas[winner.personaId];
    if (!won || !won.alive || won.exiled || won.imprisoned) {
      e.status = 'closed';
      e.closedAt = world.clock.tick;
      continue;
    }
    if (prev && prev !== winner.personaId) vacate(world, seat, 'defeated');
    // An incumbent returned is a *new term*, and the one they just finished has
    // to be written down before `since` is overwritten below. Without this the
    // seat carried only the latest term, so a president who served eight years
    // across two terms had a service record — and a Chronicle article — that
    // began on the day of their second inauguration. Everything measured against
    // the tenure went with it: the bio's span, and the window tenureRecord uses
    // to decide which wars, treaties and acts were theirs.
    if (prev && prev === winner.personaId && seat.since != null) {
      world.pastSeats = world.pastSeats || [];
      world.pastSeats.push({ ...seat, endedTick: world.clock.tick, why: 're-elected' });
    }
    seat.personaId = winner.personaId;
    seat.since = world.clock.tick;
    seat.termEnds = R.termEndTick(world, o, world.clock.tick);
    // A term begins here, and is counted here. Counting on the way out would
    // mean a sitting president's own term never showed against the limit while
    // they were serving it, which is precisely when anyone looks.
    R.countTerm(world, winner.personaId, o.id);
    // A country keeping the person it had is a different sentence from a
    // country choosing somebody new, and the record read the same either way —
    // so a president returned four times looked, in the histories, like four
    // unrelated people winning four elections.
    const share = Math.round((winner.votes / total) * 100);
    const cast = Math.round(total * 1000).toLocaleString();
    const where = seat.district ? ' for ' + world.districts.find((d) => d.id === seat.district)?.name : '';
    // countTerm has already run for this win, so the tally on the persona
    // is the number of terms including the one just begun.
    const held = world.personas[winner.personaId]?.terms?.[o.id] || 1;
    log(world, 'election', returned
      ? `${world.personas[winner.personaId]?.name} is re-elected ${o.seats > 1 ? 'to the ' : ''}${o.name}${where}`
        + `${held > 1 ? ` for a ${['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'][Math.min(6, held)]} term` : ''}`
        + `, with ${share}% of ${cast} votes.`
      : `${world.personas[winner.personaId]?.name} takes the ${o.name}${where} with ${share}% of ${cast} votes`
        + `${prev ? `, unseating ${world.personas[prev]?.name}` : ''}.`,
    { actors: [winner.personaId, prev].filter(Boolean), weight: 2 });

    // The winner's running mate takes the office elected on this ticket (the VP).
    const mateOffice = R.ticketMateOffice(world, e.office);
    if (mateOffice && winner.runningMate && winner.mateAccepted && world.personas[winner.runningMate]?.alive) {
      const mateSeat = world.seats.find((ms) => ms.office === mateOffice);
      if (mateSeat) {
        if (mateSeat.personaId && mateSeat.personaId !== winner.runningMate) vacate(world, mateSeat, 'ticket changed');
        mateSeat.personaId = winner.runningMate;
        mateSeat.since = world.clock.tick;
        mateSeat.termEnds = seat.termEnds; // serves the same term as the head of the ticket
        R.countTerm(world, winner.runningMate, mateOffice);
        log(world, 'election', `${world.personas[winner.runningMate]?.name} is elected ${R.office(world, mateOffice)?.name} on ${world.personas[winner.personaId]?.name}'s ticket.`, { actors: [winner.runningMate], weight: 2 });
      }
    }
  }
  e.status = 'closed';
  e.closedAt = world.clock.tick;
}

/**
 * How many people have to work somewhere before its failing is government
 * business. Below it a company in trouble is a private misfortune and the
 * Chronicle is the only place it appears; at or above it the head of government
 * is told directly, because a rescue has a deadline on it.
 */
export const BAILOUT_HEARD_AT = 20;

// --- war --------------------------------------------------------------------
/** How often a foreign power weighs whether it has had enough of you. */
export const WAR_WINDOW = 200;

// War exhaustion at a front dead even, per tick, and how sharply it steepens with
// the front. The rate is multiplied by exp(EXHAUST_EXP * disadvantage), where
// disadvantage runs -1 (winning outright) to +1 (losing outright): a war you are
// winning wears on you slowly, one you are losing wears on you exponentially fast.
// Halved from 0.0022: wars were wearing a country down about twice as fast as
// they should, so a conflict of any length ran the home front to exhaustion
// before the fighting had run its course. Both sides accrue at this rate.
export const EXHAUST_BASE = 0.0011;
export const EXHAUST_EXP = 1.6;

// A country will not sue for terms out of weariness until it is past this much
// exhaustion; beyond it, the per-tick chance climbs from nothing to SURRENDER_ODDS
// as exhaustion goes from the threshold to total.
export const SURRENDER_THRESHOLD = 0.9;
export const SURRENDER_ODDS = 0.05;

/** The per-tick chance an enemy this exhausted gives up. Zero at or below the threshold. */
export const surrenderOdds = (exhaustion) =>
  clamp(((exhaustion || 0) - SURRENDER_THRESHOLD) / (1 - SURRENDER_THRESHOLD), 0, 1) * SURRENDER_ODDS;

// Victory lifts the whole country, before it is tempered by how much the war
// cost: nudgeMoodAll(WIN_MOOD * (1 - exhaustion)), so a war won cheap is a
// triumph and one won at the edge of collapse a grim relief.
export const WIN_MOOD = 12;
// The exhaustion a beaten side carries out of the war and then works off slowly
// in peace — it does not wake refreshed the morning after it loses.
export const WAR_LOSER_EXHAUSTION = 0.3;
/**
 * How fast a power at war raises more, per tick, at an even front.
 *
 * Deliberately under the 0.018 a tick attrition takes off them, and multiplied
 * by up to 2.6 as the front turns against them. The point is to *offset* the
 * bleeding, not reverse it: a war still grinds an enemy down — that is the
 * model, and warattrition.mjs holds it — but it grinds them down about half as
 * fast as it did, and a country being driven back digs in and slows the
 * collapse further. Set above the attrition rate instead, a stalemate made the
 * enemy stronger every tick and the whole attrition model inverted.
 */
export const WAR_MOBILISE = 0.008;
/**
 * What a war costs each side per tick, in divisions.
 *
 * In *divisions*, both of them, which is the whole of the fix: the enemy's
 * figure is converted into their own strength scale where it is applied. The
 * loser of the ground bleeds half again as much, because the side losing ground
 * loses it under fire.
 */
export const ENEMY_ATTRITION = 0.018;
export const OUR_ATTRITION = 0.012;
/**
 * How far above its founding strength a power can arm, at peace and at war.
 *
 * Peace was 2.2 and war 2.6, and both were past what a republic can answer —
 * see the note at the arming drift in tickWar. A neighbour is dangerous because
 * it is bigger than you and getting bigger; it is not supposed to be
 * arithmetically unbeatable by a government that saw it coming.
 */
export const ARMING_CEILING = 1.8;
export const MOBILISE_CEILING = 2.2;
// How fast that inherited exhaustion decays, per tick, at peace.
export const PEACE_EXHAUSTION_DECAY = 0.004;

/**
 * The chance a foreign power declares war at its next decision, given how it
 * currently feels about you. Nothing below hostility 30 — a neighbour that is
 * merely unfriendly does not invade — and from there it climbs to a real risk
 * at the top of the scale. A fascist state reads restraint as invitation and
 * moves sooner; an ally almost never does, but "almost" is doing work, because
 * a treaty is a piece of paper.
 *
 * Exported so the World tab can show you the number rather than making you
 * infer it from a hostility bar.
 */
export function warOdds(world, f) {
  if (!f || f.atWar) return 0;
  // A power with no territory left has no army, no government and no border to
  // cross. It stays on the board as a name in the history; it does not declare
  // wars. See acts.applyPeaceTerms, where the last acre goes.
  if (f.absorbed) return 0;
  // A war that has just ended stays ended. Peace terms are signed by armies
  // that cannot immediately march again, and without this a power that sued for
  // peace could re-declare at the very next decision — observed at a gap of
  // three ticks, which reads as the same war restarting rather than a new one.
  if (inArmistice(world, f)) return 0;
  // A power with its divisions in the field beside ours is not weighing whether
  // to declare on us. The World tab reads this to show the risk, so the number
  // has to say so too and not just the declaration loop. See acts.callAllies.
  if (f.fighting) return 0;
  if (f.hostility < 30) return 0;
  // Halved once, and halved again: 7.5% a window at maximum hostility. Even at
  // 15% a long Season saw war after war, and powers with no quarrel with us —
  // the SAB is three ports and a tariff schedule — were eventually declaring
  // one because the dice had enough windows to work in.
  const base = ((f.hostility - 30) / 70) * 0.3 * 0.25;   // 0 at 30, 7.5% at 100
  // A non-aggression pact holds the odds down, not to zero. It is a promise not
  // to start a war, made by a state that may later want one — which is the
  // whole of its value and the whole of its risk.
  const pact = pactHolds(world, f) ? 0.25 : 1;
  // Temperament. A trading league does not invade over a tariff dispute — and
  // the SAB is an island with no land border, so a war with it cannot even move
  // ground (see depts.occupiedBand). It gets a fraction of anyone else's odds.
  const nature = f.ideology === 'fascist' ? 1.5 : f.ideology === 'mercantile league' ? 0.3 : 1;
  const temper = nature * (f.allied ? 0.15 : 1) * pact;
  return clamp(base * temper, 0, 0.6);
}

/** Is there a live non-aggression pact with this power? */
export function pactHolds(world, f) {
  return !!(f && f.pact && world.clock.tick < f.pact.ends);
}

// How long a power that has just fought you must wait before it can declare
// again. Two canon years: long enough that a second war is a new chapter rather
// than the last one resuming, short enough to happen inside a Season.
export const ARMISTICE_YEARS = 2;

/** Is this power still inside the cooling period after a war with us? */
export function inArmistice(world, f) {
  if (!f || f.warEndedAt == null) return false;
  return world.clock.tick - f.warEndedAt < ARMISTICE_YEARS * (world.clock.ticksPerYear || 240);
}

/**
 * Divisions ordered and paid for arrive in the field.
 *
 * The money leaves the treasury the moment the order is given (depts.mobilize);
 * the men take DEP.FORMATION_TICKS to be found, equipped and drilled. Anything
 * whose day has come is delivered here and the queue is cleared of it.
 */
/**
 * A war won leaves the loser waiting on terms.
 *
 * The window is the whole of the leverage: dictate inside it and the settlement
 * is yours to name, let it lapse and the guns simply stopped. See
 * acts.dictateTerms and DICTATE_TICKS.
 */
function offerDictate(world, f, total = false) {
  world.dictate = (world.dictate || []).filter((d) => d.foreignId !== f.id);
  world.dictate.push({ foreignId: f.id, since: world.clock.tick, until: world.clock.tick + DICTATE_TICKS, total });
  log(world, 'war', total
    ? `${f.name} capitulates without terms. There is no government left to argue for one, and ${world.nation} `
      + 'may take as much of it as it cares to hold — including all of it.'
    : `${f.name} awaits the terms of its surrender. `
      + `${world.nation} may dictate them, or let the guns simply stop.`, { weight: total ? 5 : 3 });
}

/** A settlement not dictated in time is a settlement declined. */
function tickDictate(world) {
  const q = world.dictate;
  if (!q || !q.length) return;
  const lapsed = q.filter((d) => world.clock.tick > d.until);
  if (!lapsed.length) return;
  world.dictate = q.filter((d) => world.clock.tick <= d.until);
  for (const d of lapsed) {
    const f = world.foreign.find((x) => x.id === d.foreignId);
    log(world, 'war', `No terms are dictated to ${f?.name || 'the beaten power'}. `
      + 'The peace is the one the guns left.', { weight: 2 });
  }
}

function tickFormations(world) {
  const q = world.military?.forming;
  if (!q || !q.length) return;
  const done = q.filter((f) => world.clock.tick >= f.ready);
  if (!done.length) return;
  world.military.forming = q.filter((f) => world.clock.tick < f.ready);
  for (const f of done) {
    world.military.units += f.count;
    log(world, 'war', `${f.count} division${f.count === 1 ? '' : 's'} complete${f.count === 1 ? 's' : ''} training and `
      + `join${f.count === 1 ? 's' : ''} the line. ${world.military.units} standing.`,
    { actors: [f.by].filter(Boolean), weight: 2 });
  }
  recomputeEconomy(world);
}

function tickWar(world) {
  for (const f of world.foreign) {
    if (!f.atWar) {
      // Hostility drifts; ignored aggressors escalate. A pact holds it down
      // gently for as long as it runs, and says so when it runs out.
      // Plus whatever is massed on their border — see depts.borderMenace. An
      // army sitting on a frontier is a standing provocation, not a one-off,
      // so it belongs in the drift rather than only in the act of deploying.
      f.hostility = clamp(f.hostility + (f.ideology === 'fascist' ? 0.05 : 0.01)
        + DEP.borderMenace(world, f.id)
        - (f.allied ? 0.06 : 0) - (pactHolds(world, f) ? 0.03 : 0), 0, 100);
      // And a rearming neighbour rearms. Strength was set at the founding and
      // never moved again, so "a rearming neighbour that reads restraint as
      // invitation" was a sentence in a blurb rather than anything happening —
      // and the Defense department's whole argument is that the other side is
      // getting stronger while you decide. A hostile power builds; a friendly
      // one lets its army run down.
      //
      // The ceiling was 2.2× and it was out of reach. An enemy is counted at
      // `strength / 30 × (1 + hostility/200)`, so a fascist neighbour that has
      // sat at hostility 100 for a decade fields the equivalent of thirteen
      // divisions — and a republic that has to vote itself every division at
      // six million apiece, out of a treasury of a hundred and thirty, cannot
      // reach thirteen before the war is over. Thirty years of simulation
      // against a maximally hostile Canada is five wars and five defeats,
      // every one of them at the same wall. At 1.8 the same neighbour tops out
      // near eleven, which a government that took the warning seriously can
      // field and one that ignored it cannot. See WAR_MOBILISE for the wartime
      // ceiling, which moves with it.
      if (f.baseStrength == null) f.baseStrength = f.strength;
      const arming = (f.hostility - 40) / 100 * (f.ideology === 'fascist' ? 0.06 : 0.03);
      f.strength = clamp(f.strength + arming - (f.allied ? 0.02 : 0),
        f.baseStrength * 0.5, f.baseStrength * ARMING_CEILING);
      // A power beaten in war carries its exhaustion into the peace and works it
      // off slowly (see WAR_LOSER_EXHAUSTION). Nothing else gives a foreign power
      // exhaustion, so this only ever counts down.
      if (f.exhaustion) f.exhaustion = clamp(f.exhaustion - PEACE_EXHAUSTION_DECAY, 0, 1);
      if (f.pact && world.clock.tick >= f.pact.ends) {
        f.pact = null;
        log(world, 'war', `The non-aggression pact with ${f.name} expires by its own terms. Nothing now stands between the two states but their intentions.`, { weight: 2 });
      }
      // And the mutual-defence pact, which had no term at all.
      //
      // A non-aggression pact has always run for a stated number of years and
      // expired by its own terms; an alliance was signed once and held for the
      // rest of the Season, whatever either party did afterwards. So the first
      // treaty of a republic's life was permanent and free — an ally could not
      // drift, could not be lost, and never had to be renewed. See
      // acts.TREATY_DEFENSE, which now stamps the term.
      if (f.allied && f.alliance && world.clock.tick >= f.alliance.ends) {
        f.allied = false;
        f.alliance = null;
        log(world, 'war', `The mutual-defence pact with ${f.name} runs out. `
          + 'Neither state is now obliged to the other, and both are free to say so.', { weight: 3 });
      }
    } else {
      // At war, and building for it. A power's strength was frozen the moment
      // fighting started: the arming above only runs for a country at peace, so
      // an enemy fought the whole war with the army it happened to own on the
      // first morning. A long war against a fixed opponent is an attrition
      // problem with a known answer, which is not what a war is.
      //
      // Mobilisation, then: a country at war raises more, and raises harder the
      // worse it is going for them — the losing side digs deeper, which is what
      // makes pressing an advantage cost something and a stalemate dangerous.
      // Bounded by the same ceiling their peacetime rearmament respects.
      if (f.baseStrength == null) f.baseStrength = f.strength;
      const theirWar = DEP.liveWar(world, f.id);
      // `front` is signed from our side, so their disadvantage is +front/100.
      const losing = clamp((theirWar?.front ?? 0) / 100, -1, 1);
      const mobilising = WAR_MOBILISE * (1 + Math.max(0, losing) * 1.6) * DEP.STRENGTH_PER_DIVISION;
      f.strength = clamp(f.strength + mobilising, f.baseStrength * 0.5, f.baseStrength * MOBILISE_CEILING);
    }
  }

  // Every hundred ticks, each power that is not already fighting you decides.
  // A nation already at war cannot declare it again; it is busy.
  if (world.clock.tick % WAR_WINDOW === 0) {
    for (const f of world.foreign) {
      if (f.atWar) continue;
      // A power that is in the field beside us does not turn on us in the
      // middle of the same war. See acts.callAllies.
      if (f.fighting) continue;
      const odds = warOdds(world, f);
      if (odds <= 0 || !chance(world, odds)) continue;
      f.atWar = true;
      if (f.allied) { f.allied = false; }
      const broke = pactHolds(world, f);
      if (broke) f.pact = null;
      const war = { id: 'w_' + f.id + '_' + world.clock.tick, foreign: f.id, started: world.clock.tick, front: -10, exhaustion: 0, allies: [] };
      world.military.wars.push(war);
      // The pacts answer. This is the case a mutual-defence treaty is signed
      // for, and until now it was the one case that called nobody: obligations
      // fired when *we* declared and were silent when we were attacked.
      callAllies(world, war, f.id);
      nudgeMoodAll(world, -6);
      log(world, 'war', `${f.name} declares war on ${world.nation}. Hostility stood at ${Math.round(f.hostility)}; there was warning.`, { weight: 5 });
      // War arriving is the one thing the board never told you to your face —
      // it went to the Chronicle and the World tab and nowhere you were looking.
      // A notice, not a crisis: the decision is not whether it happened.
      notice(world, `${f.name} declares war`,
        `${f.name} has declared a state of war with ${world.nation}. Hostility stood at ${Math.round(f.hostility)} when it moved; there was warning.`
        + (broke ? ' The non-aggression pact they signed is torn up in the same breath.' : '')
        + ' The front opens against us and the districts have heard.');
    }
  }
  for (const war of world.military.wars) {
    // A war that has already been won or lost stays in the record and stays
    // finished. Without this it woke up the next time the same power declared,
    // fought a second war on the old front line, and ended the new one the
    // moment the stale front hit ±85.
    if (!DEP.stillFighting(war)) continue;
    const f = world.foreign.find((x) => x.id === war.foreign);
    if (!f || !f.atWar) continue;
    // What the Department of Defense did about this power before the shooting
    // started: divisions actually on that border, and a plan drawn against that
    // army. An army that was never deployed still fights — at the six-tenths a
    // surprised country manages — and one that was prepared fights at twice
    // that. See depts.effectiveness.
    const eff = DEP.effectiveness(world, f.id);
    // Our army, plus whatever the pacts brought. An ally's divisions are on the
    // same scale as the enemy's — strength over thirty — and arrive at
    // ALLY_WEIGHT, because a signatory has its own borders to hold.
    const coalition = sum((war.allies || []).map((id) => world.foreign.find((x) => x.id === id)).filter(Boolean),
      (a) => (a.strength / 30) * ALLY_WEIGHT);
    // A force an overseas ally has put ashore in the enemy's own territory — a
    // second front behind their line, weak against the defences at first and
    // stronger as it establishes itself. See depts.landAllies / landingRamp.
    let landing = 0;
    if (war.landing) {
      const lander = world.foreign.find((x) => x.id === war.landing.ally);
      if (lander) landing = (lander.strength / 30) * ALLY_WEIGHT * DEP.landingRamp(world, war);
    }
    // Volunteers add to the line at a tenth of a regular division each — bodies,
    // not a professional army — and air wings add their weight in air superiority
    // over the front.
    // Volunteers left at home count with the rest of the army, diluted by how
    // thinly it is spread. Volunteers *sent to this front* are all in one place
    // and that place is the war, so they fight at their full weight here and are
    // not thinned by eff.factor. See depts.sendVolunteers.
    const lineStrength = world.military.units
      + DEP.volunteersHome(world) * DEP.VOLUNTEER_STRENGTH
      + (world.military.airforce || 0) * DEP.AIR_COMBAT;
    const atFront = DEP.volunteersAt(world, f.id) * DEP.VOLUNTEER_STRENGTH
      * world.military.funding * (1 - world.military.exhaustion * 0.4);
    const ours = lineStrength * world.military.funding * eff.factor * (1 - world.military.exhaustion * 0.4)
      + atFront + coalition + landing;
    // What they are worth in the line, hostility and all — see depts.enemyWeight,
    // which is the same figure the Defense tab prints and a war bill is written to.
    const theirs = DEP.enemyWeight(f);
    // Posture is the plan's other half: an offensive plan moves the front
    // faster in both directions, a defensive one steadies it.
    const posture = DEP.planFor(world, f.id);
    const bias = posture?.ready ? (DEP.POSTURES[posture.posture]?.bias || 0) * posture.strength : 0;
    const swing = (ours - theirs) * 0.09 * (1 + bias * 0.35) + (rng(world) - 0.5) * 0.8;
    war.front = clamp(war.front + swing, -100, 100);
    // Exhaustion moves with the front, exponentially, and both sides feel it.
    // Yours is the global scalar the country reacts to; the enemy's is kept on the
    // war, where the decision to sue for peace or surrender reads it. `front` is
    // signed from our side, so our disadvantage is -front/100 and theirs is its
    // mirror — a war one side is losing is one the other is winning.
    world.military.exhaustion = clamp(world.military.exhaustion
      + EXHAUST_BASE * Math.exp(EXHAUST_EXP * (-war.front / 100)), 0, 1);
    war.exhaustion = clamp((war.exhaustion || 0)
      + EXHAUST_BASE * Math.exp(EXHAUST_EXP * (war.front / 100)), 0, 1);

    // A country worn past endurance may simply give up, before the front has been
    // driven to the wall — an army whose people will not fight on. Only once its
    // own exhaustion is past the threshold, and then with a chance that climbs
    // with it. It reads the enemy's exhaustion, not ours: the side quitting is the
    // one that is spent, never the one winning the war.
    // Capitulation out of exhaustion. Certain once a side is spent outright
    // (100%), and a rising chance past the threshold before that. The enemy
    // reads its own exhaustion — the side quitting is the spent one, never the
    // one winning.
    // A war whose terms were refused has no more suing in it. The side that was
    // told it would be annexed does not offer again, and the side that refused
    // has said what it will settle for — so the only way out is one army spent.
    // See acts.pressOn.
    const enemyDone = (war.exhaustion || 0) >= 1;
    const odds = war.pressed ? 0 : surrenderOdds(war.exhaustion);
    if (enemyDone || (odds > 0 && chance(world, odds))) {
      f.atWar = false; war.won = true; war.surrendered = true; war.ended = world.clock.tick;
      dismissAllies(world, war);
      f.warEndedAt = world.clock.tick;
      f.hostility = clamp(f.hostility - 40, 0, 100);
      // A beaten enemy carries its exhaustion into the peace (see #23).
      f.exhaustion = Math.max(f.exhaustion || 0, WAR_LOSER_EXHAUSTION);
      // And is at our mercy for a while: the executive may dictate what the
      // victory is worth — land, money, or nothing. See acts.dictateTerms.
      //
      // A war fought on after a refused surrender ends differently: an enemy
      // spent outright, with our army that far into its country, has nothing
      // left to negotiate with, and the settlement is not capped at a third of
      // it. That is what pressing on was for.
      const total = !!war.pressed && war.front >= TOTAL_FRONT;
      war.total = total;
      offerDictate(world, f, total);
      // The country is lifted, tempered by what the war cost it.
      nudgeMoodAll(world, WIN_MOOD * (1 - world.military.exhaustion));
      world.military.exhaustion = clamp(world.military.exhaustion - 0.25, 0, 1);
      log(world, 'war', enemyDone
        ? `${f.name} capitulates — its army is spent and it can fight no longer. The war ends in our favour.`
        : `${f.name} sues for terms — its people will not fight on. The war ends in our favour.`, { weight: 4 });
      continue;
    }
    // The same, turned on us: at total home exhaustion the republic can fight no
    // longer and quits the field, whatever the front reads.
    if (world.military.exhaustion >= 1) {
      f.atWar = false; war.lost = true; war.ended = world.clock.tick;
      dismissAllies(world, war);
      f.warEndedAt = world.clock.tick;
      f.hostility = clamp(f.hostility - 20, 0, 100);
      world.economy.treasury -= 25e6;
      nudgeMoodAll(world, -14);
      // A defeated country does not wake refreshed: it keeps its exhaustion and
      // works it off from there (see #23).
      world.military.exhaustion = Math.max(world.military.exhaustion, WAR_LOSER_EXHAUSTION);
      log(world, 'war', `${world.nation} can fight no longer and capitulates to ${f.name}. Indemnity of $25,000,000.`, { weight: 5 });
      continue;
    }

    // Attrition. War kills both sides — until this ran, the only way a foreign
    // strength number ever moved was peacetime arming, and our own division
    // count did not move at all. So a long war between countries of matched
    // strength ended looking exactly as it had begun, which is not what a war
    // looks like. Both sides bleed at a small, steady rate now; the loser
    // bleeds more heavily, because the side losing ground loses it under fire.
    //
    // f.baseStrength is set the first time this power is checked (see the
    // peacetime block above), so it exists by the time a war is running — the
    // enemy has been ticked by the same loop long before shots are fired.
    // Both rates are in *divisions* a tick, and the enemy's is converted at the
    // rate the rest of the war counts their strength — see DEP.STRENGTH_PER_DIVISION.
    //
    // It was 0.018 against a strength of 148 and 0.012 against a line of six,
    // which is not "both sides bleed": it is us bleeding sixteen times faster
    // than them. Traced through a war it is unmistakable — over 250 ticks the
    // republic went from six divisions to none while Canada went from 148 to
    // 145 — and it is why a synthetic government lost seventeen wars out of
    // seventeen. Two quantities on two scales, subtracted at the same number.
    const enemyLosing = war.front > 5, weLosing = war.front < -5;
    const enemyLoss = ENEMY_ATTRITION * (enemyLosing ? 1.6 : 1) * DEP.STRENGTH_PER_DIVISION;
    f.strength = Math.max(f.strength - enemyLoss, (f.baseStrength ?? f.strength) * 0.15);
    const ourLoss = OUR_ATTRITION * (weLosing ? 1.6 : 1);
    world.military.attrition = (world.military.attrition || 0) + ourLoss;
    while (world.military.attrition >= 1 && (world.military.units > 0 || (world.military.volunteers || 0) > 0)) {
      world.military.attrition -= 1;
      // Volunteers are the first into the ground — a tenth the strength, and the
      // regular line is what they are spent to spare.
      if ((world.military.volunteers || 0) > 0) {
        world.military.volunteers -= 1;
        // The ones at this front are the ones in the fighting, so they are the
        // ones lost — and the commitment has to come down with the headcount or
        // it would claim more volunteers at the front than the country still has.
        if (DEP.volunteersAt(world, f.id) > 0) {
          DEP.volunteerFront(world)[f.id] = DEP.volunteersAt(world, f.id) - 1;
        }
        log(world, 'war', `A volunteer division is lost on the ${f.name} front. ${world.military.volunteers} volunteer${world.military.volunteers === 1 ? '' : 's'} left.`,
          { weight: 2 });
      } else {
        world.military.units -= 1;
        log(world, 'war', `A division is lost on the ${f.name} front. ${world.military.units} left standing.`,
          { weight: 2 });
      }
    }
    if (world.clock.tick % 25 === 0) {
      log(world, 'war', `The front with ${f.name} stands at ${war.front > 0 ? '+' : ''}${war.front.toFixed(0)}. `
        + `War exhaustion ${(world.military.exhaustion * 100).toFixed(0)}% at home, ${((war.exhaustion || 0) * 100).toFixed(0)}% in ${f.name}.`);
    }
    // Either way the guns stop, and a settled war settles something: the
    // hostility that produced it comes down, and neither side can march again
    // until the armistice runs out. Before this, a power sued for peace with
    // its hostility untouched and could re-declare at the next decision — the
    // same war with a new record number.
    // A pressed war is not won by driving the front to the wall — the wall is
    // where it started. It ends when they are spent, above.
    if (war.front >= 85 && !war.pressed) {
      f.atWar = false; war.won = true; war.ended = world.clock.tick;
      dismissAllies(world, war);
      f.warEndedAt = world.clock.tick;
      f.hostility = clamp(f.hostility - 35, 0, 100);
      // A beaten army is a smaller army. It will rebuild — see the arming
      // drift above — which is what makes a dictated peace a clock rather than
      // a conclusion.
      f.strength = Math.max((f.baseStrength ?? f.strength) * 0.5, f.strength * 0.7);
      // The beaten enemy carries its exhaustion into the peace (see #23).
      f.exhaustion = Math.max(f.exhaustion || 0, WAR_LOSER_EXHAUSTION);
      offerDictate(world, f);
      nudgeMoodAll(world, WIN_MOOD * (1 - world.military.exhaustion));
      world.military.exhaustion = clamp(world.military.exhaustion - 0.25, 0, 1);
      log(world, 'war', `${f.name} sues for peace. ${world.nation} dictates the terms.`, { weight: 5 });
    } else if (war.front <= -85) {
      f.atWar = false; war.lost = true; war.ended = world.clock.tick;
      dismissAllies(world, war);
      f.warEndedAt = world.clock.tick;
      // They got what they came for; the grievance is spent, not the enmity.
      f.hostility = clamp(f.hostility - 20, 0, 100);
      world.economy.treasury -= 25e6;
      nudgeMoodAll(world, -14);
      // A defeated country keeps its exhaustion and works it off from there (#23).
      world.military.exhaustion = Math.max(world.military.exhaustion, WAR_LOSER_EXHAUSTION);
      log(world, 'war', `${world.nation} capitulates to ${f.name}. Indemnity of $25,000,000.`, { weight: 5 });
    }
  }
  const atWar = world.military.wars.some((w) => world.foreign.find((f) => f.id === w.foreign)?.atWar);
  if (world.military.exhaustion > 0 && !atWar) {
    world.military.exhaustion = clamp(world.military.exhaustion - 0.004, 0, 1);
  }
  // Volunteers are raised for a war and go home when it ends — they are not a
  // standing force. Disband them the first peacetime tick after any war closes;
  // the log fires once because the count is zero on every tick thereafter.
  if (!atWar && (world.military.volunteers || 0) > 0) {
    const sent = world.military.volunteers;
    world.military.volunteers = 0;
    world.military.volunteerFront = {};   // nobody is at a front that no longer exists
    recomputeEconomy(world);
    log(world, 'war', `The ${sent} volunteer division${sent === 1 ? '' : 's'} raised for the war ${sent === 1 ? 'is' : 'are'} stood down and sent home.`, { weight: 2 });
  }
}

function tickEmergency(world) {
  const em = world.emergency;
  if (em?.active && world.clock.tick >= em.ends) {
    em.active = false;
    log(world, 'crisis', 'The state of emergency lapses by its own terms.', { weight: 2 });
  }
}

// --- collapse ---------------------------------------------------------------
// Seasons are designed to end. Collapse is not a failure state; it is the third act.
function checkCollapse(world) {
  if (world.phase !== 'live') return;
  const approval = nationalApproval(world);
  const broke = world.economy.treasury < -40e6;
  const despair = approval < 24;
  const vacantAll = world.seats.every((s) => !s.personaId);
  const lostWar = world.military.wars.some((w) => w.lost);
  const seceded = (world.breakaway || []).length > 0;

  const reasons = [];
  if (broke) reasons.push('the treasury is ' + moneyExact(world.economy.treasury));
  if (despair) reasons.push(`national approval is ${approval.toFixed(0)}%`);
  if (vacantAll) reasons.push('no office is filled');
  if (lostWar) reasons.push('the war is lost');
  if (seceded) reasons.push('the union is broken');

  if (reasons.length >= 2 && !world.collapseWarned) {
    world.collapseWarned = world.clock.tick;
    log(world, 'crisis', `The third act begins: ${reasons.join('; ')}.`, { weight: 5 });
  }
  if (reasons.length >= 3) {
    world.phase = 'collapse';
    log(world, 'crisis', `${world.nation} enters collapse. ${reasons.join('; ')}.`, { weight: 6 });
  }
}

function snapshotHistory(world) {
  const e = world.economy;
  e.history.push({
    tick: world.clock.tick,
    treasury: e.treasury,
    approval: nationalApproval(world),
    unemployment: e.unemployment,
    homeless: sum(world.districts, (d) => d.homeless),
    gdp: e.gdp,
    // The macro model's own numbers. Without these the record of a tenure could
    // say what the reserve did and not what money cost, what prices did, or how
    // much of the country's future the government had already spent — which is
    // most of what an economic record is. See chronicle.economyLine.
    inflation: e.inflation,
    debt: e.debt || 0,
    rate: e.marketRate,
    spendYr: e.spendYr,
    revenueYr: e.revenueYr,
  });
  if (e.history.length > 400) e.history.shift();
  for (const d of world.districts) {
    d.history.push(Math.round(d.mood));
    if (d.history.length > 120) d.history.shift();
  }
}

export function endSeason(world, epitaph) {
  world.phase = 'ended';
  world.endedAt = Date.now();
  world.epitaph = epitaph || 'The Season ends. The record stands.';
  for (const p of Object.values(world.personas)) {
    if (p.alive && !p.synthetic) p.finalApproval = p.approval;
  }
  log(world, 'founding', `The Season ends after ${world.clock.tick} ticks and ${world.chronicle.length} recorded acts. ${world.epitaph}`, { weight: 6 });
  return world;
}

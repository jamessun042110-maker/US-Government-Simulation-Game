// Documents with force.
//
// A bill is simultaneously readable prose and a machine-executable effect.
// Every clause knows how to render itself as a sentence of law and how to
// change the world when promulgated. Nothing in the simulation changes except
// through one of these, an election, or the drama director.

import { uid, clamp, money, moneyExact, num, sum, byId, count, nudgeMood, nudgeMoodAll, nudgeApproval } from './util.js';
import * as R from './rules.js';
import { log, canonDate, year, writeBio } from './chronicle.js';
import { BUILDINGS, ZONES, recomputeEconomy, distributePopulation, makePersona, totalPop, constructionCrew, CONSTRUCTION_COST_PER_WORKER } from './world.js';
import * as CONDUCT from './conduct.js';
import * as DEP from './depts.js';
// company.js imports only util, so this direction never closes a cycle.
import * as CO from './company.js';

export const DOC_TYPES = {
  bill: { label: 'Bill', blurb: 'Ordinary legislation. Goes to the floor.' },
  amendment: { label: 'Constitutional Amendment', blurb: 'Patches the rules mid-game.' },
  order: { label: 'Executive Order', blurb: 'Immediate, if your office holds the power. No vote.' },
  treaty: { label: 'Treaty', blurb: 'Binds you to a foreign power once ratified and co-signed.' },
  impeachment: { label: 'Articles of Impeachment', blurb: 'Removes a person from office, not from the game.' },
  ruling: { label: 'Court Ruling', blurb: 'Strikes a law, or upholds it.' },
  declaration: { label: 'Declaration', blurb: 'Independence, secession, war. Prose with consequences.' },
  // The chamber's own instrument. A resolution binds nobody and commands
  // nothing — it is how a legislature says a thing in its own name, and how it
  // demands to be shown something it has a right to see.
  resolution: { label: 'Resolution', blurb: 'The chamber speaking for itself. Binds nobody; compels disclosure.' },
};

/**
 * What each kind of document is actually able to do.
 *
 * Articles of impeachment remove a person from office; they do not set the
 * rate of income tax, and offering that in the drafting menu implied they
 * might. Every type here lists only the clauses it can enact, so the composer
 * offers a coherent instrument rather than the whole catalogue every time.
 *
 * A bill is the general instrument and keeps everything except the two things
 * the constitution reserves to other documents: amending itself, and removing
 * an officeholder.
 */
const ALL_CLAUSE_KINDS = ['PROSE', 'SET_TAX', 'APPROPRIATE', 'BAILOUT', 'BUILD', 'ZONE', 'REDISTRICT', 'DEMAND_ACCOUNTS',
  'AMEND', 'CREATE_OFFICE', 'GRANT_POWER', 'RIGHT', 'TERM_LIMIT', 'PLURALITY', 'DECLARE_WAR', 'TREATY_DEFENSE',
  'TREATY_NONAGGRESSION', 'TREATY_PEACE', 'MILITARY', 'RAISE_DIVISIONS', 'RAISE_AIRWINGS', 'PARDON', 'ARREST', 'EXILE', 'REMOVE', 'CALL_ELECTION'];

export const DOC_CLAUSES = {
  bill: ALL_CLAUSE_KINDS.filter((k) => !['AMEND', 'REMOVE'].includes(k)),
  // Amendments touch the rules of the running game: the text, the offices, the
  // powers attached to them, the rights, and the lines on the map.
  amendment: ['PROSE', 'AMEND', 'CREATE_OFFICE', 'GRANT_POWER', 'RIGHT', 'TERM_LIMIT', 'PLURALITY', 'REDISTRICT'],
  // An order is whatever the executive's own powers already reach. It cannot
  // legislate — no rights, no offices, no amendments — and the court is what
  // answers an order that overreaches on the rest.
  order: ['PROSE', 'APPROPRIATE', 'BAILOUT', 'BUILD', 'ZONE', 'MILITARY', 'RAISE_DIVISIONS', 'RAISE_AIRWINGS', 'PARDON', 'ARREST', 'EXILE', 'CALL_ELECTION', 'DECLARE_WAR'],
  treaty: ['PROSE', 'TREATY_DEFENSE', 'TREATY_NONAGGRESSION', 'TREATY_PEACE', 'APPROPRIATE'],
  impeachment: ['PROSE', 'REMOVE'],
  declaration: ['PROSE', 'DECLARE_WAR'],
  resolution: ['PROSE', 'DEMAND_ACCOUNTS'],
  ruling: ['PROSE'],
};

/** The clause kinds a document of this type may carry. */
export const clausesFor = (type) => DOC_CLAUSES[type] || ALL_CLAUSE_KINDS;

/**
 * The books as they stood at one moment — what the chamber actually receives
 * when it demands the accounts.
 *
 * A resolution does not give the chamber a seat in the Treasury; it gives it a
 * copy, and a copy is a piece of paper with a date on it. The chamber reads
 * what the Secretary handed over, however stale that has since become, and has
 * to pass another resolution to see anything newer. That is the difference
 * between oversight and surveillance, and it is the reason the clause is worth
 * having: the executive knows exactly which day it was asked about.
 */
export function snapshotAccounts(world) {
  const e = world.economy;
  return {
    at: world.clock.tick,
    treasury: e.treasury, revenueYr: e.revenueYr, spendYr: e.spendYr,
    credit: e.credit, debt: e.debt,
    // The money side travels with the copy. A chamber that has demanded the
    // accounts and been handed the vault without the debt, the rate the state
    // borrows at or what prices are doing has been handed the flattering half.
    gdp: e.gdp, marketRate: e.marketRate, policyRate: e.policyRate,
    inflation: e.inflation, priceLevel: e.priceLevel, gap: e.gap,
    taxes: { ...e.taxes },
    breakdown: { ...(e.breakdown || {}) },
    spendBreakdown: { ...(e.spendBreakdown || {}) },
    // Enough of the curve to read a trend, not the whole four hundred ticks.
    history: (e.history || []).slice(-120).map((h) => ({ treasury: h.treasury })),
    programs: (world.programs || []).map((pr) => ({ name: pr.name, cost: pr.cost })),
    discretion: R.discretionUsed(world),
  };
}

// --- The terms of a peace --------------------------------------------------
// Land and money — the two things every peace treaty has ever actually settled,
// and the two the game had no way to express. Shared by the negotiated peace
// (TREATY_PEACE, which puts them on the instrument the chamber ratifies) and the
// dictated one (acts.dictateTerms, which is what a surrender buys you).
//
// Territory *is* redrawn, and this is where it starts. `world.annexed` is a map
// of `foreignId → percent`, and geo.js solves the continent's borders for the
// land each country holds after it: take a third of Canada and the line between
// us moves north through the same landscape, on the world map, on the districts
// map, and on the map of the front. Only the frontier moves — the coast and the
// terrain are seeded off the nation's name alone, because a peace that moved the
// mountains would be a different continent rather than a new border.
//
// What a territory is *to the simulation* is still the strength it fields and the
// wealth it holds, and a cession still moves exactly those, permanently. What it
// does not move is the republic's own electorates: the districts stay cut from the
// border the country was founded with, so annexed ground is drawn inside our line
// and undivided, holding no parcel and enrolling no voter. Conquest is not
// enfranchisement, and the map should not imply that it is.

/** What a cession is worth to the taker, per point of territory ceded. */
export const CESSION_STRENGTH = 0.9;   // of the ceding power's base strength, per 1%
export const CESSION_VALUE = 1.2e9;    // to the treasury, per 1% taken

// What one treaty may move, either way. A negotiated peace and an ordinary
// dictated one are bounded by it; a total capitulation is the one settlement
// that is not, because there is no such thing as a partial annexation of a
// country that has ceased to resist. See pressOn.
export const CESSION_MAX = 30;
const pctOf = (v, cap = CESSION_MAX) => Math.max(-cap, Math.min(cap, Math.round(+v || 0)));

/**
 * How much of a power's territory is still its own, as a percentage.
 *
 * A country has one hundred per cent of itself and no more, and this is the
 * only thing that says so. Without it a beaten neighbour could be made to cede
 * thirty per cent of its territory every war, for ever: fifteen wars against
 * Mexico took four hundred and fifty per cent of it, and because the value of
 * a cession is booked per point taken rather than against anything that exists,
 * each one paid $36M into the treasury and lifted the mood of every district by
 * four. The enemy's strength floors at 1, so every war after the fourth was
 * free. It was a money printer with a flag on it.
 *
 * Land already taken stays taken — this counts what is left, so giving some
 * back (a negative cession) puts it back on the table.
 */
/**
 * How long a mutual-defence pact runs before it has to be renewed.
 *
 * Longer than a presidential term on purpose: an alliance should outlive the
 * government that signed it, so that letting one lapse is a decision somebody
 * has to make rather than something that happens between elections.
 */
export const DEFENCE_PACT_YEARS = 12;

export function territoryLeft(world, f) {
  return Math.max(0, 100 - (world.annexed?.[f.id] || 0));
}

/**
 * The same question asked of the republic itself.
 *
 * `territoryLeft` bounded what could be taken *from* a foreign power, and the
 * comment at the clamp — "nobody cedes what they no longer hold" — was written
 * as a rule about ceding in general. It was only ever implemented in one
 * direction. Losing a war and giving ground had no floor at all: two lost wars
 * to each of three neighbours, at the ordinary cession cap and well inside a
 * normal Season, and the republic had signed away 180% of itself. The treasury
 * paid the price of every acre each time, so it also ran away downwards.
 *
 * Cessions to a power are stored as negative shares against that power, so what
 * the republic still holds is a hundred less everything it has given anybody.
 */
export function ourTerritoryLeft(world) {
  const given = Object.values(world.annexed || {})
    .reduce((n, pct) => n + Math.max(0, -(pct || 0)), 0);
  return Math.max(0, 100 - given);
}

/**
 * What a beaten power can be made to pay, and no more.
 *
 * There was no ceiling and no check that the figure was a number at all: a
 * dictated indemnity of Infinity made the treasury Infinity, and 1e12 simply
 * paid out a trillion dollars from a country whose whole territory is valued at
 * a hundred and twenty million. A settlement has to be something the loser
 * could actually hand over.
 *
 * Priced off the same thing a cession is priced off, so the two terms are in
 * the same money: the whole of a country is worth 100 × CESSION_VALUE, and a
 * power already stripped of most of its ground can be squeezed for
 * proportionally less. Negative is allowed and capped the same way — that is
 * the republic paying, which is what a lost peace looks like.
 */
export function indemnityCap(world, f) {
  return Math.round(territoryLeft(world, f) * CESSION_VALUE);
}

function clampIndemnity(world, f, v) {
  const n = Math.round(+v || 0);
  if (!Number.isFinite(n)) return 0;
  const cap = indemnityCap(world, f);
  return Math.max(-cap, Math.min(cap, n));
}

/** The terms, said in the language of a treaty. Empty when there are none. */
export function peaceTermsText(world, foreignName, c) {
  const cede = pctOf(c.cede);
  const money = Math.round(+c.indemnity || 0);
  const parts = [];
  if (cede > 0) parts.push(`${foreignName} shall cede ${cede}% of its territory to ${world.nation}`);
  if (cede < 0) parts.push(`${world.nation} shall cede ${-cede}% of its territory to ${foreignName}`);
  if (money > 0) parts.push(`${foreignName} shall pay an indemnity of ${moneyExact(money)}`);
  if (money < 0) parts.push(`${world.nation} shall pay an indemnity of ${moneyExact(-money)}`);
  return parts.join(' and ');
}

/**
 * Move the land and the money a peace settles. Safe to call with no terms.
 * Positive `cede`/`indemnity` are *to* the republic; negative are *from* it.
 */
export function applyPeaceTerms(world, f, c) {
  let cede = pctOf(c.cede, c.cap || CESSION_MAX);
  // Finite, and inside what a country could conceivably hand over. `+x || 0`
  // lets Infinity through — `Infinity || 0` is Infinity — and one clause of it
  // makes the treasury Infinity for the rest of the Season.
  const money = clampIndemnity(world, f, c.indemnity);
  if (!cede && !money) return;

  if (money) {
    world.economy.treasury += money;
    log(world, 'money', money > 0
      ? `${f.name} pays ${moneyExact(money)} in indemnity to ${world.nation}.`
      : `${world.nation} pays ${moneyExact(-money)} in indemnity to ${f.name}.`, { weight: 3 });
  }

  if (cede) {
    if (f.baseStrength == null) f.baseStrength = f.strength;
    world.annexed = world.annexed || {};
    // Nobody cedes what they no longer hold — in either direction. Clamped here
    // rather than at the dictation, so a negotiated peace treaty is bound by it
    // too. The republic's own floor is the half that was missing.
    if (cede > 0) cede = Math.min(cede, territoryLeft(world, f));
    else cede = -Math.min(-cede, ourTerritoryLeft(world));
    if (!cede) { recordSettlement(world, f, 0, money); return; }
    const share = Math.abs(cede) / 100;
    if (cede > 0) {
      // Taken from them. Their army and their base shrink with the ground it
      // stood on, and the treasury books the value of what was annexed.
      const lost = f.baseStrength * share * CESSION_STRENGTH;
      f.baseStrength = Math.max(1, f.baseStrength - lost);
      f.strength = Math.max(1, f.strength - lost);
      world.annexed[f.id] = (world.annexed[f.id] || 0) + cede;
      world.economy.treasury += cede * CESSION_VALUE;
      log(world, 'war', `${f.name} cedes ${cede}% of its territory to ${world.nation}. `
        + 'The border moves.', { weight: 4 });
      nudgeMoodAll(world, 4);
      // And a country with nothing left is not a country. It stays in the
      // record — it has a history, and the Chronicle will go on naming it — but
      // it holds no ground, fields no army and declares no wars, because there
      // is nobody left to declare them.
      if (!territoryLeft(world, f) && !f.absorbed) {
        f.absorbed = world.clock.tick || 1;
        f.atWar = false; f.allied = false; f.pact = null; f.alliance = null;
        f.hostility = 0;
        f.strength = 1;
        log(world, 'war', `${f.name} ceases to exist as a state. Every acre of it is ${world.nation} — `
          + 'a chapter now, not a country.', { weight: 5 });
      }
    } else {
      // Given up. The republic is smaller, and the country knows it.
      const gained = f.baseStrength * share * CESSION_STRENGTH;
      f.baseStrength += gained;
      f.strength += gained;
      world.annexed[f.id] = (world.annexed[f.id] || 0) + cede;
      world.economy.treasury -= share * 100 * CESSION_VALUE;
      log(world, 'war', `${world.nation} cedes ${-cede}% of its territory to ${f.name}.`, { weight: 5 });
      nudgeMoodAll(world, -9);
    }
    recomputeEconomy(world);
    recordSettlement(world, f, cede, money);
  }
}

/** How many settlements the republic keeps. Longer than any Season needs. */
const SETTLEMENT_LOG = 200;

/**
 * Every acre and every dollar a peace moved, with the tick it moved on.
 *
 * The border is the most biographical thing a presidency can touch, and the
 * presidential article could not see it at all — "annexed Canada entire" was
 * nowhere in a bio of the president who did it. The reason is here rather than
 * in the article: the two cession lines above are logged with **no actors**,
 * because `applyPeaceTerms` is called from a dictated peace, a negotiated one
 * and a treaty clause alike, and only the first of those knows whose decision
 * it was. Anything keyed on the Chronicle's own attribution was never going to
 * find them.
 *
 * So a ledger, keyed on the tick, the same shape as `world.rescues` and
 * `world.discretionLog`. The article asks every other question about a tenure
 * this way already — "what wars were fought under him", not "what wars did he
 * personally declare" — and the border is exactly that kind of question. See
 * chronicle.tenureRecord.
 */
function recordSettlement(world, f, pct, indemnity) {
  if (!pct && !indemnity) return;
  world.cessions = world.cessions || [];
  world.cessions.push({
    tick: world.clock.tick,
    foreignId: f.id,
    foreignName: f.name,
    // Positive is taken from them, negative is given up by the republic — the
    // same sign convention `world.annexed` uses, so the two agree.
    pct,
    indemnity,
    // Whether this was the settlement that took the last acre. `absorbed` is
    // stamped `tick || 1`, so compare against that and not against the raw
    // tick, or a country annexed on the founding tick is never the one that
    // ceased to exist.
    absorbed: !!f.absorbed && f.absorbed === (world.clock.tick || 1),
  });
  if (world.cessions.length > SETTLEMENT_LOG) world.cessions.shift();
}

/**
 * Dictate the terms of a surrender.
 *
 * A beaten enemy is at your mercy for a while — `world.dictate` is set when a
 * war ends in the republic's favour (sim.tickWar) and holds until it lapses.
 * Until then the executive may name what the victory is worth. Nobody votes on
 * this: the chamber's leverage was the declaration, and the field has answered.
 */
export const DICTATE_TICKS = 40;

export function dictateTerms(world, personaId, foreignId, { cede = 0, indemnity = 0 } = {}) {
  const pending = (world.dictate || []).find((d) => d.foreignId === foreignId);
  if (!pending) return fail('There is no beaten enemy waiting on terms.');
  if (world.clock.tick > pending.until) return fail('The moment has passed; the settlement stands.');
  if (!R.hasPower(world, personaId, 'sign_treaty')) return fail('Your office does not hold the power to settle a war.');
  const f = byId(world.foreign, foreignId);
  if (!f) return fail('No such power.');
  // A victor does not hand the loser their own land. Terms dictated run one way.
  const cap = pending.total ? 100 : CESSION_MAX;
  const asked = Math.max(0, pctOf(cede, cap));
  const take = Math.min(asked, territoryLeft(world, f));
  const pay = Math.max(0, clampIndemnity(world, f, indemnity));
  if (!asked && !pay) return fail('Name a term — territory, an indemnity, or both.');
  // Asked for land that is not there any more. Say so rather than booking a
  // cession of nothing, which is what paid for fifteen wars against the same
  // neighbour before territoryLeft existed.
  if (asked && !take && !pay) {
    return fail(`There is nothing left of ${f.name} to take; the republic holds all of it.`);
  }
  applyPeaceTerms(world, f, { cede: take, indemnity: pay, cap });
  // Terms dictated at the point of a gun are remembered as such — by a state
  // that still exists to remember them. A country annexed entire has nobody
  // left to hold a grudge, and leaving one on it put a hostility of 100 on a
  // power with no territory, no army and no government.
  if (!f.absorbed) f.hostility = Math.min(100, f.hostility + take * 1.2 + (pay > 0 ? 6 : 0));
  world.dictate = (world.dictate || []).filter((d) => d.foreignId !== foreignId);
  log(world, 'war', `${world.personas[personaId]?.name} dictates the terms of ${f.name}'s surrender.`,
    { actors: [personaId], weight: 4 });
  return ok({ foreign: f, cede: take, indemnity: pay });
}

// --- Refusing a surrender ---------------------------------------------------
//
// A beaten enemy sued and the only answers were "name your price" and "let the
// guns stop". Neither of them is the answer a victor sometimes wants, which is
// *no* — fight on, and take the country rather than a third of it.
//
// It has to be able to go wrong or it is a free button, so refusing terms is
// not a continuation of the war that was being won. It is a new war against a
// country that has been told what is coming: the front gives ground back, their
// exhaustion lifts, they mobilise everything, and nobody sues again. From here
// the war ends when one side is spent outright — and it can be us.

/** What refusing a surrender costs, and what it wakes up in the other side. */
export const PRESS_SETBACK = 30;        // ground given back the moment terms are refused
export const PRESS_RALLY = 0.35;        // and the share of their war-weariness that lifts
export const PRESS_MOOD = 9;            // what it costs at home, per refusal
export const PRESS_EXHAUSTION = 0.08;   // and what it adds to our own
export const PRESS_ALARM = 8;           // what every other power reads into it
/** How far the front must have run before a spent enemy can be annexed outright. */
export const TOTAL_FRONT = 60;

/** The live or just-finished war with this power. */
const warWith = (world, foreignId) =>
  (world.military?.wars || []).filter((w) => w.foreign === foreignId).at(-1) || null;

export function pressOn(world, personaId, foreignId) {
  const pending = (world.dictate || []).find((d) => d.foreignId === foreignId);
  if (!pending) return fail('There is no beaten enemy waiting on terms.');
  if (pending.total) return fail('There is nothing left to press for — they have nothing left to refuse with.');
  if (world.clock.tick > pending.until) return fail('The moment has passed; the settlement stands.');
  if (!R.hasPower(world, personaId, 'sign_treaty')) return fail('Your office does not hold the power to settle a war.');
  const f = byId(world.foreign, foreignId);
  if (!f) return fail('No such power.');
  const war = warWith(world, foreignId);
  if (!war || war.lost) return fail('There is no war here to go on with.');
  if (!territoryLeft(world, f)) return fail(`There is nothing left of ${f.name} to take.`);

  world.dictate = (world.dictate || []).filter((d) => d.foreignId !== foreignId);
  const again = (war.pressed || 0) + 1;
  war.pressed = again;
  war.won = false; war.surrendered = false; war.ended = null;
  f.atWar = true; f.warEndedAt = null;

  // They are not the army that sued. A country refused its surrender fights the
  // next war knowing what losing it means.
  war.front = clamp(war.front - PRESS_SETBACK, -100, 100);
  war.exhaustion = clamp((war.exhaustion || 0) * (1 - PRESS_RALLY), 0, 1);
  f.exhaustion = 0;
  if (f.baseStrength == null) f.baseStrength = f.strength;
  f.strength = Math.min(f.baseStrength * 2.6, f.strength * 1.25);
  f.hostility = 100;

  // And at home it is a government that had peace on the table and sent the
  // army back out. Each refusal costs more than the last.
  world.military.exhaustion = clamp((world.military.exhaustion || 0) + PRESS_EXHAUSTION * again, 0, 1);
  nudgeMoodAll(world, -PRESS_MOOD * again);

  // A mutual-defence pact is not a partition treaty. Whoever came when we were
  // attacked goes home when the war stops being about defence.
  const left = (war.allies || []).map((id) => byId(world.foreign, id)).filter(Boolean);
  dismissAllies(world, war);
  for (const a of left) {
    a.hostility = clamp(a.hostility + PRESS_ALARM * 1.5, 0, 100);
    log(world, 'war', `${a.name} withdraws from the war. It signed to defend ${world.nation}, not to divide ${f.name}.`,
      { weight: 3 });
  }
  // Everyone else reads it too.
  for (const other of world.foreign || []) {
    if (other.id === f.id || other.absorbed) continue;
    other.hostility = clamp(other.hostility + PRESS_ALARM, 0, 100);
  }

  log(world, 'war', `${world.personas[personaId]?.name} refuses ${f.name}'s surrender and orders the army on. `
    + 'The only terms now are the ones the field gives.', { actors: [personaId], weight: 5 });
  return ok({ foreign: f, war });
}

// --- Clause catalog --------------------------------------------------------

export const CLAUSES = {
  PROSE: {
    label: 'Whereas / narrative clause', power: null, fields: [{ k: 'text', t: 'textarea', label: 'Text' }],
    text: (w, c) => c.text || '(blank clause)',
    apply: () => {},
  },
  SET_TAX: {
    label: 'Set a rate of taxation', power: 'tax',
    fields: [
      { k: 'tax', t: 'select', label: 'Tax', options: [['income', 'Income tax'], ['sales', 'Sales tax'], ['property', 'Property tax'], ['tariff', 'Tariff']] },
      { k: 'rate', t: 'number', label: 'Rate (%)', step: 0.5, min: 0, max: 70, def: 6 },
    ],
    text: (w, c) => `The rate of the ${c.tax} tax is set at ${(+c.rate).toFixed(1)} percent.`,
    apply: (w, c) => {
      const old = w.economy.taxes[c.tax];
      w.economy.taxes[c.tax] = +c.rate / 100;
      recomputeEconomy(w);
      const delta = w.economy.taxes[c.tax] - old;
      for (const d of w.districts) {
        nudgeMood(d, -delta * 100 * (2.2 * d.salience.taxes) * (c.tax === 'income' ? 1.4 : 1));
      }
      log(w, 'money', `${c.tax[0].toUpperCase() + c.tax.slice(1)} tax set to ${(+c.rate).toFixed(1)}% (was ${(old * 100).toFixed(1)}%).`);
    },
  },
  APPROPRIATE: {
    label: 'Appropriate money', power: 'spend',
    fields: [
      { k: 'amount', t: 'number', label: 'Amount ($)', step: 100000, def: 5000000 },
      { k: 'purpose', t: 'text', label: 'Purpose' },
      { k: 'recurring', t: 'check', label: 'Recurring annual program' },
    ],
    text: (w, c) => `${moneyExact(c.amount)} is appropriated${c.recurring ? ' annually' : ''} for ${c.purpose || 'purposes to be determined'}.`,
    cost: (w, c) => +c.amount || 0,
    recurring: (c) => !!c.recurring,
    apply: (w, c) => {
      w.economy.treasury -= c.recurring ? 0 : +c.amount;
      if (c.recurring) {
        w.programs = w.programs || [];
        w.programs.push({ id: uid('prog'), name: c.purpose || 'Program', cost: +c.amount });
      }
      // Appropriated money does what its purpose says, exactly as a
      // discretionary disbursement does — a bill is not a weaker cheque.
      const effect = applySpendingImpact(w, +c.amount, c.purpose);
      // Say which of the two ways the money leaves. A recurring program does
      // not draw a lump sum at signing — the treasury pays it out across the
      // year, every year — and the record claiming "$5,000,000 appropriated"
      // while the balance stood still read as a treasury that had stopped
      // keeping books.
      log(w, 'money', c.recurring
        ? `${c.purpose || 'A program'} is funded at ${moneyExact(c.amount)} a year, drawn as it runs.${effect ? ' ' + effect : ''}`
        : `${moneyExact(c.amount)} appropriated for ${c.purpose || 'unspecified purposes'}.${effect ? ' ' + effect : ''}`);
    },
  },
  // The rescue, as an instrument. In a republic where a million dollars needs
  // the chamber, catching a company needs the chamber — so the argument about
  // whether the public should be paying for this happens where arguments about
  // public money are supposed to happen. See acts.bailout for the executive's
  // own door into the same money.
  BAILOUT: {
    label: 'Rescue a company with public money', power: 'spend',
    fields: [
      { k: 'company', t: 'company', label: 'Company' },
      { k: 'amount', t: 'number', label: 'Amount ($)', step: 100000, def: 5000000 },
    ],
    text: (w, c) => {
      const co = (w.companies || []).find((x) => x.id === c.company);
      const staff = (co?.employees || []).length;
      return `${moneyExact(c.amount)} is voted to ${co ? co.name : 'a company'} to keep it trading`
        + (staff ? `, and the ${staff} ${staff === 1 ? 'person' : 'people'} on its payroll in work` : '')
        + '. The republic ranks with its creditors for the money.';
    },
    cost: (w, c) => +c.amount || 0,
    apply: (w, c) => {
      const co = (w.companies || []).find((x) => x.id === c.company && !x.closed);
      if (!co) return log(w, 'money', 'The company the rescue was voted for is no longer trading. The money stays put.');
      payBailout(w, co, Math.max(0, Math.round(+c.amount || 0)));
    },
  },
  BUILD: {
    label: 'Order construction', power: 'zone',
    fields: [
      { k: 'building', t: 'select', label: 'Structure', options: Object.entries(BUILDINGS).map(([k, b]) => [k, `${b.name} — ${money(b.cost)}`]) },
      { k: 'parcel', t: 'parcel', label: 'Parcel' },
    ],
    text: (w, c) => {
      const p = w.city.parcels[c.parcel];
      const d = p ? w.districts.find((x) => x.id === p.district) : null;
      return `${BUILDINGS[c.building]?.name || 'A structure'} shall be built on parcel ${c.parcel}${d ? ', ' + d.name : ''}, at ${money(BUILDINGS[c.building]?.cost || 0)}.`;
    },
    cost: (w, c) => BUILDINGS[c.building]?.cost || 0,
    apply: (w, c) => startProject(w, c.parcel, c.building),
  },
  ZONE: {
    label: 'Zone land', power: 'zone',
    fields: [
      { k: 'district', t: 'district', label: 'District' },
      { k: 'zone', t: 'select', label: 'Zone as', options: Object.entries(ZONES).map(([k, z]) => [k, z.label]) },
      { k: 'fraction', t: 'number', label: 'Share of vacant parcels (%)', def: 50, min: 5, max: 100 },
    ],
    text: (w, c) => `${c.fraction}% of vacant land in ${w.districts.find((d) => d.id === c.district)?.name || 'the district'} is rezoned ${ZONES[c.zone]?.label || c.zone}.`,
    apply: (w, c) => {
      const vac = w.city.parcels.filter((p) => p.district === c.district && !p.building && !p.project);
      const n = Math.ceil((vac.length * (+c.fraction)) / 100);
      vac.slice(0, n).forEach((p) => (p.zone = c.zone));
      log(w, 'build', `${n} parcels in ${w.districts.find((d) => d.id === c.district)?.name} rezoned ${ZONES[c.zone]?.label}.`);
    },
  },
  REDISTRICT: {
    label: 'Redraw a district boundary', power: 'zone',
    fields: [
      { k: 'from', t: 'district', label: 'Take parcels from' },
      { k: 'to', t: 'district', label: 'Give to' },
      { k: 'count', t: 'number', label: 'How many parcels', def: 4, min: 1, max: 20 },
    ],
    text: (w, c) => `${c.count} parcels are transferred from ${nm(w, c.from)} to ${nm(w, c.to)} for purposes of representation.`,
    apply: (w, c) => {
      const src = w.city.parcels.filter((p) => p.district === c.from);
      const moved = src.slice(0, Math.min(+c.count, Math.max(0, src.length - 3)));
      moved.forEach((p) => (p.district = c.to));
      distributePopulation(w, totalPop(w));
      recomputeEconomy(w);
      log(w, 'law', `Boundaries redrawn: ${moved.length} parcels moved from ${nm(w, c.from)} to ${nm(w, c.to)}.`);
      nudgeMoodAll(w, -1.5);
    },
  },
  AMEND: {
    label: 'Amend the constitution', power: null,
    fields: [
      { k: 'path', t: 'select', label: 'Provision', options: R.AMENDABLE.map((a) => [a.path, a.label]) },
      { k: 'value', t: 'number', label: 'New value', step: 0.01, def: 0.5 },
    ],
    text: (w, c) => {
      const a = R.AMENDABLE.find((x) => x.path === c.path);
      const cur = R.getPath(w.constitution, c.path);
      const fmt = (v) => (a?.kind === 'fraction' ? R.fracText(+v) : a?.kind === 'money' ? money(+v) : String(v));
      return `${a?.label || c.path} is amended from ${fmt(cur)} to ${fmt(c.value)}.`;
    },
    apply: (w, c) => {
      const a = R.AMENDABLE.find((x) => x.path === c.path);
      const before = R.getPath(w.constitution, c.path);
      R.setPath(w.constitution, c.path, +c.value);
      log(w, 'law', `Constitution amended: ${a?.label || c.path} — ${before} → ${c.value}.`, { weight: 3 });
    },
  },
  // Term limits get their own clause rather than a line in AMEND, because
  // AMEND's targets are single values at fixed paths and an office lives in an
  // array. It belongs to the amendment: this is a rule about who may govern,
  // and a president who wants a third term should have to go and win the
  // amendment fraction for it in public.
  TERM_LIMIT: {
    label: 'Set a term limit', power: null,
    fields: [
      { k: 'office', t: 'office', label: 'Office' },
      { k: 'terms', t: 'number', label: 'Terms allowed (0 for none)', def: 2, min: 0, max: 20 },
    ],
    text: (w, c) => {
      const o = R.office(w, c.office);
      const n = Math.max(0, Math.round(+c.terms || 0));
      return n
        ? `No person shall hold the office of ${o?.name || c.office} more than ${n} time${n === 1 ? '' : 's'}.`
        : `The term limit on the office of ${o?.name || c.office} is repealed.`;
    },
    apply: (w, c) => {
      const o = R.office(w, c.office);
      if (!o) return;
      const before = R.termLimitOf(o);
      o.termLimit = Math.max(0, Math.round(+c.terms || 0));
      log(w, 'law', `The term limit on the ${o.name} is changed from ${before || 'none'} to ${o.termLimit || 'none'}.`, { weight: 3 });
    },
  },
  // Plurality of office. By default nobody holds two at once — a justice in the
  // cabinet reviews their own government, a Vice President in it audits the
  // administration they would inherit, and a President appointing themselves
  // has taken a second office without an election. A republic that means to
  // permit any of that has to say so in its constitution.
  PLURALITY: {
    label: 'Allow one person to hold two offices', power: null,
    fields: [{ k: 'allow', t: 'check', label: 'Permit plurality of office' }],
    text: (w, c) => (c.allow
      ? 'A person may hold more than one office at once, including by appointment of themselves.'
      : 'No person shall hold more than one office of this republic at once.'),
    apply: (w, c) => {
      w.constitution.plurality = !!c.allow;
      log(w, 'law', c.allow
        ? 'Plurality of office is permitted: the bench may sit in the cabinet, and the executive may appoint itself.'
        : 'Plurality of office is forbidden: no person may hold two at once.',
      { weight: 3 });
    },
  },
  DEMAND_ACCOUNTS: {
    label: 'Demand the national accounts', power: null,
    fields: [{ k: 'years', t: 'number', label: 'Hold the copy for (canon years)', def: 2, min: 1, max: 20 }],
    text: (w, c) => `The Secretary of the Treasury shall lay the accounts of ${w.nation} before the chamber as they stand this day, to be kept for ${+c.years || 2} year(s).`,
    apply: (w, c) => {
      const until = w.clock.tick + Math.max(1, +c.years || 2) * w.clock.ticksPerYear;
      w.accountsOpenUntil = Math.max(w.accountsOpenUntil || 0, until);
      w.accountsCopy = snapshotAccounts(w);
      log(w, 'money', `A copy of the national accounts as they stand is laid before the chamber.`, { weight: 2 });
    },
  },
  CREATE_OFFICE: {
    label: 'Create an office', power: null,
    fields: [
      { k: 'name', t: 'text', label: 'Name of office' },
      { k: 'seats', t: 'number', label: 'Seats', def: 1, min: 1, max: 9 },
      { k: 'termYears', t: 'number', label: 'Term (canon years)', def: 4, min: 1, max: 20 },
      { k: 'selection', t: 'select', label: 'Chosen by', options: [['election', 'Election'], ['appointment', 'Appointment']] },
      { k: 'appointedBy', t: 'office', label: 'Appointed by (if appointed)' },
      { k: 'powers', t: 'powers', label: 'Powers' },
    ],
    text: (w, c) => `The office of ${c.name || 'the new office'} is established: ${c.seats} seat(s), ${c.selection}, ${c.termYears}-year term, holding ${(c.powers || []).map(R.powerLabel).join('; ') || 'no enumerated power'}.`,
    apply: (w, c) => {
      const id = (c.name || 'office').toLowerCase().replace(/\W+/g, '').slice(0, 12) + Object.keys(w.constitution.offices).length;
      w.constitution.offices.push({
        id, name: c.name || 'New Office', seats: +c.seats, selection: c.selection,
        appointedBy: c.appointedBy || null, termYears: +c.termYears, electorate: 'nation',
        powers: c.powers || [],
      });
      for (let s = 0; s < +c.seats; s++) {
        w.seats.push({ id: `${id}#${s + 1}`, office: id, index: s, personaId: null, district: null, termEnds: null, since: null });
      }
      log(w, 'office', `The office of ${c.name} is created.`, { weight: 2 });
    },
  },
  GRANT_POWER: {
    label: 'Grant or revoke a power', power: null,
    fields: [
      { k: 'office', t: 'office', label: 'Office' },
      { k: 'power', t: 'select', label: 'Power', options: Object.entries(R.POWERS) },
      { k: 'revoke', t: 'check', label: 'Revoke instead of grant' },
    ],
    text: (w, c) => `The ${R.office(w, c.office)?.name || 'office'} ${c.revoke ? 'shall no longer hold' : 'shall hold'} the power to ${(R.POWERS[c.power] || c.power).toLowerCase()}.`,
    apply: (w, c) => {
      const o = R.office(w, c.office);
      if (!o) return;
      o.powers = c.revoke ? o.powers.filter((p) => p !== c.power) : [...new Set([...o.powers, c.power])];
      log(w, 'law', `${o.name}: power to ${(R.POWERS[c.power] || c.power).toLowerCase()} ${c.revoke ? 'revoked' : 'granted'}.`, { weight: 2 });
    },
  },
  RIGHT: {
    label: 'Enumerate a right', power: null,
    fields: [
      { k: 'name', t: 'text', label: 'Name of right' },
      { k: 'body', t: 'textarea', label: 'Text' },
      // "Nothing specific" is the convention's Rights-retained clause, reachable
      // by amendment for a republic that did not found with it. A right that
      // blocks no named act is not a dead letter: it is what lets the bench
      // reach an act no enumerated right touches. See rules.retainsUnenumerated.
      { k: 'blocks', t: 'select', label: 'Blocks', options: [['ARREST_SPEECH', 'Arrest for speech'], ['SEIZE_PRESS', 'Seizure of the press'], ['ARREST_NOCHARGE', 'Detention without charge'], ['SEIZE_LAND', 'Uncompensated taking'], ['BAN_FACTION', 'Banning a faction'], ['EQUAL_PROTECTION', 'Ranking citizens by blood'], ['OPEN', 'Nothing specific — a right retained, for the court to find']] },
    ],
    text: (w, c) => (c.blocks === 'OPEN'
      ? `${c.name || 'Rights Retained'}: ${c.body || R.RIGHTS_CATALOG.unenumerated.text}`
      : `${c.name || 'A right'}: ${c.body || ''}`),
    apply: (w, c) => {
      const open = c.blocks === 'OPEN';
      w.constitution.rights.push(open
        ? { id: 'unenumerated', name: c.name || 'Rights Retained', text: c.body || R.RIGHTS_CATALOG.unenumerated.text, open: true, blocks: [] }
        : { id: uid('rt'), name: c.name || 'Right', text: c.body || '', blocks: [c.blocks] });
      nudgeMoodAll(w, 2);
      log(w, 'law', open
        ? `The people retain the rights this constitution never wrote down. The court is asked to say what they are.`
        : `A right is enumerated: ${c.name}.`, { weight: 2 });
    },
  },
  DECLARE_WAR: {
    label: 'Declare war', power: 'declare_war',
    fields: [{ k: 'target', t: 'foreign', label: 'Upon' }],
    text: (w, c) => `A state of war is declared to exist between ${w.nation} and ${byId(w.foreign, c.target)?.name || 'a foreign power'}.`,
    apply: (w, c) => declareWar(w, c.target),
  },
  TREATY_DEFENSE: {
    label: 'Mutual defense', power: 'sign_treaty',
    fields: [{ k: 'party', t: 'foreign', label: 'With' }],
    text: (w, c) => `${w.nation} and ${byId(w.foreign, c.party)?.name || 'the other party'} pledge that an attack upon either shall be treated as an attack upon both.`,
    apply: (w, c) => {
      const f = byId(w.foreign, c.party);
      if (!f) return;
      f.allied = true; f.hostility = Math.max(0, f.hostility - 25);
      // With a term on it, like the non-aggression pact beside it. An alliance
      // signed once and held for the rest of the Season made the first treaty
      // of a republic's life permanent and free: an ally could not be lost and
      // never had to be renewed, so the diplomacy of a fifty-year Season was
      // decided in its first year. sim.tickWar expires it.
      f.alliance = { since: w.clock.tick, ends: w.clock.tick + Math.round(DEFENCE_PACT_YEARS * w.clock.ticksPerYear) };
      log(w, 'war', `Mutual-defense pact entered with ${f.name}, to run ${count(DEFENCE_PACT_YEARS, 'year')}. `
        + 'Obligations are automatic while it holds.', { weight: 2 });
      // A pact signed while a war is already running is not a promise for next
      // time — the obligation is live now. Any war the republic is currently
      // fighting calls the new signatory in at once, exactly as if the pact had
      // predated the war. (callAllies skips the enemy and anyone already fighting.)
      for (const war of w.military.wars || []) {
        // DEP.stillFighting, not `!won && !lost`: a war ended by negotiated peace
        // is neither won nor lost, and calling allies into one is how ghost wars
        // got painted on the map for a whole Season.
        if (!DEP.stillFighting(war)) continue;
        const foe = byId(w.foreign, war.foreign);
        if (foe && foe.atWar) callAllies(w, war, war.foreign);
      }
    },
  },
  // The lesser treaty, and the more useful one. A mutual-defense pact drags you
  // into their wars; a non-aggression pact only promises that the two of you
  // will not start one. It costs nothing, binds nobody to anything positive,
  // and is worth exactly as much as the signatories' intentions — which is why
  // it holds the war odds down rather than to zero.
  TREATY_NONAGGRESSION: {
    label: 'Non-aggression', power: 'sign_treaty',
    fields: [
      { k: 'party', t: 'foreign', label: 'With' },
      { k: 'years', t: 'number', label: 'Term (canon years)', def: 10, min: 1, max: 99 },
    ],
    text: (w, c) => `${w.nation} and ${byId(w.foreign, c.party)?.name || 'the other party'} undertake for ${count(Math.max(1, +c.years || 10), 'year')} to settle their differences without recourse to arms while it holds.`,
    apply: (w, c) => {
      const f = byId(w.foreign, c.party);
      if (!f) return;
      const years = Math.max(1, +c.years || 10);
      f.pact = { since: w.clock.tick, ends: w.clock.tick + Math.round(years * w.clock.ticksPerYear) };
      f.hostility = Math.max(0, f.hostility - 12);
      log(w, 'war', `Non-aggression pact signed with ${f.name}, to run ${count(years, 'year')}. Neither may take up arms while it holds.`, { weight: 2 });
    },
  },
  // The one treaty a country at war can sign. The other treaties refuse
  // wartime; this exists for wartime and refuses anything else. The chamber
  // ratifies; the other side's assent depends on how the fighting is going —
  // a country losing ground wants to stop, one taking it does not. See
  // depts.weighAssent (peace path) and sim.tickWar (which ends the war when
  // the ratified doc applies).
  TREATY_PEACE: {
    label: 'Treaty of peace', power: 'sign_treaty',
    // A peace is not only a date the shooting stops. The two things every real
    // treaty settles are land and money, so both are on the instrument: a
    // cession as a share of the ceding party's territory, and an indemnity in
    // cash. Positive is *to us*, negative is *from us* — one field each way, so
    // a government can sign a peace it lost as readily as one it won.
    fields: [
      { k: 'party', t: 'foreign', label: 'With' },
      { k: 'cede', t: 'number', label: 'Territory ceded to us (%; negative cedes ours)', def: 0, min: -30, max: 30 },
      { k: 'indemnity', t: 'number', label: 'Indemnity paid to us ($; negative we pay)', def: 0 },
    ],
    text: (w, c) => {
      const f = byId(w.foreign, c.party)?.name || 'the other party';
      const terms = peaceTermsText(w, f, c);
      return `${w.nation} and ${f} agree that the state of war between them shall end `
        + `upon ratification, and the border shall stand where the guns stopped`
        + (terms ? `, save that ${terms}` : '') + '.';
    },
    apply: (w, c) => {
      const f = byId(w.foreign, c.party);
      if (!f || !f.atWar) return;
      const war = DEP.liveWar(w, f.id);
      f.atWar = false; f.warEndedAt = w.clock.tick;
      // A negotiated peace: hostility comes down further than a dictated one
      // (both sides *agreed* to stop). Terms are the exception — land and money
      // taken at the table are still land and money taken, and are resented.
      f.hostility = Math.max(0, f.hostility - 45);
      if (war) { war.negotiated = true; war.ended = w.clock.tick; }
      // Same armistice-clock hook the dictated peace uses.
      w.military.exhaustion = Math.max(0, (w.military.exhaustion || 0) - 0.2);
      log(w, 'war', `Peace is signed with ${f.name}.`, { weight: 4 });
      applyPeaceTerms(w, f, c);
    },
  },
  MILITARY: {
    label: 'Set military funding', power: 'command_military',
    fields: [{ k: 'level', t: 'number', label: 'Funding multiplier', step: 0.1, min: 0, max: 3, def: 1 }],
    text: (w, c) => `Military funding is set at ${(+c.level).toFixed(1)}× standing appropriation.`,
    apply: (w, c) => {
      w.military.funding = +c.level;
      recomputeEconomy(w);
      log(w, 'war', `Military funding set to ${(+c.level).toFixed(1)}×.`);
    },
  },
  // Raise divisions on the same terms depts.raiseDivisions raises them: DEP's
  // DIVISION_COST per unit, straight into world.military.units. The order path
  // needs `spend`; the bill path does not, because the chamber's vote *is* the
  // authorisation to spend, and every other spending clause behaves the same
  // way — see the gate around line 688, which checks author power only for
  // clauses that carry one.
  RAISE_DIVISIONS: {
    label: 'Raise divisions', power: 'spend',
    fields: [{ k: 'count', t: 'number', label: 'Divisions', def: 1, min: 1, max: 10 }],
    text: (w, c) => {
      const n = Math.max(1, Math.round(+c.count || 1));
      return `${n} division${n === 1 ? '' : 's'} shall be raised, at ${moneyExact(n * DEP.DIVISION_COST)}.`;
    },
    cost: (w, c) => Math.max(1, Math.round(+c.count || 1)) * DEP.DIVISION_COST,
    apply: (w, c) => {
      const n = Math.max(1, Math.round(+c.count || 1));
      const cost = n * DEP.DIVISION_COST;
      w.economy.treasury -= cost;
      // Through the same muster the department's own order goes through: the
      // money now, the division in the field after DEP.FORMATION_TICKS. A law
      // cannot conjure a trained corps any faster than a secretary can — see
      // sim.tickFormations.
      w.military.forming = w.military.forming || [];
      w.military.forming.push({
        count: n, by: null,
        since: w.clock.tick,
        ready: w.clock.tick + DEP.FORMATION_TICKS,
      });
      recomputeEconomy(w);
      log(w, 'war', `${n} division${n === 1 ? '' : 's'} ordered by law, at ${moneyExact(cost)}. `
        + `They muster and drill; in the field in ${DEP.FORMATION_TICKS} ticks.`, { weight: 2 });
    },
  },
  // The air force, as a law.
  //
  // A wing costs eight million and no discretionary allowance in the game runs
  // to that, so in a republic where a million dollars needs the chamber the
  // Department of Defense could not commission a single aeroplane and there was
  // no instrument that could either. Air power was, quietly, a feature only a
  // strong-executive constitution had. It is the same money through the same
  // muster as divisions — this is simply the door the chamber walks through.
  RAISE_AIRWINGS: {
    label: 'Commission air wings', power: 'spend',
    fields: [{ k: 'count', t: 'number', label: 'Wings', def: 1, min: 1, max: 6 }],
    text: (w, c) => {
      const n = Math.max(1, Math.round(+c.count || 1));
      return `${n} air wing${n === 1 ? '' : 's'} shall be commissioned, at ${moneyExact(n * DEP.AIRWING_COST)}.`;
    },
    cost: (w, c) => Math.max(1, Math.round(+c.count || 1)) * DEP.AIRWING_COST,
    apply: (w, c) => {
      const n = Math.max(1, Math.round(+c.count || 1));
      w.economy.treasury -= n * DEP.AIRWING_COST;
      w.military.airforce = (w.military.airforce || 0) + n;
      recomputeEconomy(w);
      log(w, 'war', `${n} air wing${n === 1 ? '' : 's'} commissioned by law, at ${moneyExact(n * DEP.AIRWING_COST)}.`, { weight: 2 });
    },
  },
  PARDON: {
    label: 'Pardon', power: 'pardon',
    fields: [{ k: 'persona', t: 'persona', label: 'Person' }],
    text: (w, c) => `${w.personas[c.persona]?.name || 'The named person'} is pardoned of all charges.`,
    apply: (w, c) => {
      const p = w.personas[c.persona];
      if (!p) return;
      p.imprisoned = false; p.charges = [];
      log(w, 'court', `${p.name} is pardoned.`, { actors: [p.id], weight: 2 });
    },
  },
  ARREST: {
    label: 'Order arrest', power: 'arrest',
    fields: [
      { k: 'persona', t: 'persona', label: 'Person' },
      { k: 'charge', t: 'text', label: 'Charge' },
    ],
    text: (w, c) => `${w.personas[c.persona]?.name || 'The named person'} is to be detained on the charge of ${c.charge || '—'}.`,
    apply: (w, c) => {
      const p = w.personas[c.persona];
      if (!p) return;
      p.imprisoned = true; p.charges = [...(p.charges || []), c.charge || 'unspecified'];
      const seat = R.seatOf(w, p.id);
      if (seat) { vacate(w, seat, 'detained'); }
      nudgeMoodAll(w, -2.5);
      log(w, 'court', `${p.name} is detained on the charge of ${c.charge || 'unspecified'}. The character is imprisoned, not the player.`, { actors: [p.id], weight: 3 });
    },
  },
  EXILE: {
    label: 'Exile', power: 'arrest',
    fields: [{ k: 'persona', t: 'persona', label: 'Person' }],
    text: (w, c) => `${w.personas[c.persona]?.name || 'The named person'} is exiled from ${w.nation} and stripped of office.`,
    apply: (w, c) => {
      const p = w.personas[c.persona];
      if (!p) return;
      p.exiled = true;
      const seat = R.seatOf(w, p.id);
      if (seat) vacate(w, seat, 'exiled');
      log(w, 'death', `${p.name} is exiled. Exile is a game state, not a ban — they may return under another name.`, { actors: [p.id], weight: 3 });
    },
  },
  REMOVE: {
    label: 'Remove from office', power: null,
    fields: [{ k: 'persona', t: 'persona', label: 'Officeholder' }],
    text: (w, c) => `${w.personas[c.persona]?.name || 'The named officeholder'} is removed from office.`,
    apply: (w, c) => {
      const seat = R.seatOf(w, c.persona);
      const office = seat?.office;
      if (seat) vacate(w, seat, 'removed by vote');
      log(w, 'office', `${w.personas[c.persona]?.name} is removed from office.`, { actors: [c.persona], weight: 3 });
      if (office) succeed(w, office); // the deputy steps up, if the office has one
    },
  },
  CALL_ELECTION: {
    label: 'Call an election', power: 'call_election',
    fields: [{ k: 'office', t: 'office', label: 'For office' }],
    text: (w, c) => `Elections for the ${R.office(w, c.office)?.name || 'office'} shall be held forthwith.`,
    apply: (w, c) => scheduleElection(w, c.office, 60),
  },
};

const nm = (w, id) => w.districts.find((d) => d.id === id)?.name || 'a district';

export function clauseText(world, c) { return (CLAUSES[c.kind]?.text || (() => c.kind))(world, c); }
// What a clause costs is declared on the clause, next to the apply() that
// spends it — one source of truth. This used to be a second, hand-kept list
// here, and the two drifted: RAISE_DIVISIONS debited $6M a division while this
// list said $0, so an army bill showed no fiscal effect and slipped under the
// chamber's spending threshold entirely.
export function clauseCost(world, c) {
  const k = CLAUSES[c.kind];
  return k?.cost ? (k.cost(world, c) || 0) : 0;
}
export const clauseRecurring = (c) => !!CLAUSES[c.kind]?.recurring?.(c);
// The vote threshold reads the same price list — see the note in rules.js on
// why it is handed over rather than imported.
R._setClausePrice(clauseCost);
export function docCost(world, doc) { return sum(doc.clauses, (c) => clauseCost(world, c)); }
/**
 * The same total, split the way the treasury actually pays it: `now` leaves at
 * signing, `yearly` is a program drawn out across every year it stands. The
 * chamber's spending threshold reads the total; the fiscal-effect line must
 * not, or it promises a lump-sum debit the balance will never show.
 */
export function docCostSplit(world, doc) {
  let now = 0, yearly = 0;
  for (const c of doc.clauses) {
    const v = clauseCost(world, c);
    if (clauseRecurring(c)) yearly += v; else now += v;
  }
  return { now, yearly };
}

// --- Document lifecycle ----------------------------------------------------

/** Everything in a document a person actually wrote, for the conduct scan. */
const proseOf = (d) => [d.title, d.preamble, ...(d.clauses || []).map((c) => [c.text, c.body, c.name, c.charge, c.reason].filter(Boolean).join(' '))];

export function createDoc(world, { type, title, preamble, authorId, clauses = [], target = null, answers = null }) {
  // A document carrying a slur is never filed — not as a draft, not in the
  // record, not anywhere. Refused before the id is minted.
  const conduct = CONDUCT.scan(...proseOf({ title, preamble, clauses }));
  if (conduct.ok === false) return { ok: false, reason: CONDUCT.REFUSAL };

  const id = uid('doc');
  const doc = {
    id, type, title: title || DOC_TYPES[type].label, preamble: preamble || '',
    authorId, clauses, target,
    status: 'draft', votes: {}, signedBy: [], vetoedBy: null, struck: false,
    created: world.clock.tick, date: canonDate(world), promulgated: null,
    floorOpened: null, floorCloses: null, history: [],
    // What crisis this measure was drafted to answer, if any. Set by the
    // "refer to the chamber" button on a crisis card; read by promulgate.
    answers,
  };
  // Short of a slur, the language stands — and is marked. A chamber can pass
  // this and a president can sign it; the marking is what makes both cost.
  if (conduct.tier === 'incite') doc.disrepute = conduct.grounds;
  // Keep the vote threshold honest: appropriations carry their amount.
  for (const c of doc.clauses) if (c.kind === 'BUILD') c.amount = BUILDINGS[c.building]?.cost || 0;
  world.documents[id] = doc;
  world.docOrder.unshift(id);
  return doc;
}

export function introduce(world, docId, personaId, floorTicks = 90) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'draft') return fail('Not a draft.');
  const may = R.mayPropose(world, personaId, doc.type);
  if (!may.ok) return fail(may.reason);

  const req = R.voteRequirement(world, doc);
  // No seated body to try it — an executive order in all but name.
  if (doc.type === 'order' || !req) return signOrder(world, doc, personaId);

  // A treaty is an agreement between two states, and this only ever asked one
  // of them: a non-aggression pact went to the floor, the chamber voted, and
  // the other power was bound without being consulted. It goes to them first
  // now, and what they say depends on the hostility the Department of State
  // exists to move — which is the connection that room was missing.
  const party = DEP.treatyParty(world, doc);
  if (party?.foreign && !doc.assent?.agreed) {
    // Say no at the door rather than forty ticks later. A power that has just
    // refused, or one that reads us as an enemy, is not weighing anything —
    // and the answer is more use to the player now, next to the hostility bar
    // they need to move, than it is as a Chronicle entry a minute from now.
    const weigh = DEP.weighAssent(world, doc);
    if (weigh.ok === false) return fail(weigh.reason);
    doc.status = 'awaiting-assent';
    DEP.askAssent(world, doc);
    log(world, 'war', `“${doc.title}” is put to ${party.foreign.name}. Nothing goes before the `
      + `${R.office(world, req.body)?.name || 'chamber'} until they answer.`,
    { actors: [personaId], docId: doc.id, weight: 2 });
    return ok(doc);
  }

  doc.status = 'floor';
  doc.floorOpened = world.clock.tick;
  doc.floorCloses = world.clock.tick + floorTicks;
  doc.requirement = req;
  log(world, 'vote', `“${doc.title}” is laid before the ${R.office(world, req.body)?.name || req.body}. ${R.fracText(req.fraction)} required. (${req.label})`,
    { actors: [personaId], docId: doc.id, weight: 2 });
  return ok(doc);
}

export function castVote(world, docId, personaId, ballot) {
  const doc = world.documents[docId];
  // An override is a floor vote too. This admitted only `floor`, so a member who
  // moved to override a veto and then voted on their own motion had the ballot
  // dropped on the way in — silently, since the floor card shows the vote buttons
  // for both statuses and CLOSE_FLOOR already routed an override to
  // closeOverride. The synthetic members were unaffected (sim.tickFloor writes
  // doc.votes directly), so an override ran on NPC ballots alone and a player
  // clicking Vote yea watched the tally not move.
  if (!doc || (doc.status !== 'floor' && doc.status !== 'override')) return fail('The floor is closed.');
  const roll = R.electorateFor(world, doc);
  // The chamber's own members, plus the tie-breaking officer (the VP), whose vote
  // is recorded but counted only if the chamber splits evenly.
  const tb = R.tieBreaker(world, doc);
  if (!roll.some((v) => v.personaId === personaId) && tb?.personaId !== personaId) {
    return fail('You hold no seat in the chamber trying this measure.');
  }
  doc.votes[personaId] = ballot;
  return ok(doc);
}

// What passing or losing its own bill does to an administration's standing. A
// win is credited, a defeat rebuked a little harder — the chamber refusing the
// government reads worse than granting it. Through the damped approval helper.
const ADMIN_BILL_PASS = 2.5;
const ADMIN_BILL_FAIL = -3.5;

export function closeFloor(world, docId, { auto = false } = {}) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'floor') return fail('Not on the floor.');
  const t = R.tally(world, doc);
  doc.tally = t;
  const chamber = R.office(world, t.req.body)?.name || t.req.body;
  // When the chamber tied and the Vice President settled it, say so — it is the
  // one vote nobody else in the room could have cast.
  const brokenBy = t.tieBroken ? ` — ${world.personas[t.tieBroken.personaId]?.name || 'the Vice President'} breaks the tie` : '';
  // Whose bill this is, for both the ledger and the record. An administration
  // bill is the government's own programme; a bill from the floor is a
  // legislator's. The Chronicle names the difference, and only the former moves
  // the administration's standing.
  const author = world.personas[doc.authorId];
  const admin = R.isAdministrationBill(world, doc);
  const provenance = doc.type === 'bill'
    ? (admin ? ' An administration bill.' : author ? ` A bill from ${author.name}, from the floor.` : '')
    : '';
  if (!t.passes) {
    doc.status = 'failed';
    // A government defeated on its own bill wears it; the standing falls a little.
    if (admin && author) nudgeApproval(author, ADMIN_BILL_FAIL);
    log(world, 'vote', `“${doc.title}” fails in the ${chamber}: ${t.yea}–${t.nay}${t.quorumMet ? '' : ' (no quorum)'}${brokenBy}. Needed ${R.fracText(t.req.fraction)}.${provenance}`, { docId: doc.id, weight: 2 });
    return ok(doc);
  }
  doc.status = 'passed';
  // Carrying its own programme is a win the administration is credited with.
  if (admin && author) nudgeApproval(author, ADMIN_BILL_PASS);
  log(world, 'vote', `“${doc.title}” passes the ${chamber} ${t.yea}–${t.nay}${brokenBy}.${provenance}`, { docId: doc.id, weight: 2 });

  // Impeachment is two-stage: adopting the articles (this pass) opens a trial at
  // a higher bar. Nobody is removed until the trial convicts. Under a bicameral
  // constitution the trial is a different room as well as a different bar — the
  // House brings the articles, the Senate sits as the court — so the court is
  // named from the *new* requirement rather than from the chamber that just
  // voted, which is a different body the moment `trialPhase` is set.
  if (doc.type === 'impeachment' && !doc.trialPhase) {
    const dur = Math.max(30, (doc.floorCloses || world.clock.tick) - (doc.floorOpened || world.clock.tick));
    doc.trialPhase = true;
    doc.status = 'floor';
    doc.votes = {};
    doc.statements = {};
    doc.floorOpened = world.clock.tick;
    doc.floorCloses = world.clock.tick + dur;
    const req = R.voteRequirement(world, doc);
    doc.requirement = req;
    const court = R.office(world, req.body)?.name || req.body;
    log(world, 'vote', `The articles “${doc.title}” are adopted, ${t.yea}–${t.nay}. The ${court} now sits as a court — ${R.fracText(req.fraction)} to convict.`, { docId: doc.id, weight: 3 });
    return ok(doc);
  }

  // The other chamber. Same shape as the impeachment trial above and for the
  // same reason: the roll is a different set of people, so the votes are cleared
  // and the floor reopens, and voteRequirement reads the advanced stage and
  // hands back the second room on its own. Everything downstream — the roll, the
  // tally, the quorum, the tie-break, every legislative view — goes through that
  // one function, which is why the split lands here and nowhere else.
  //
  // Bills and amendments pass both. A treaty is ratified by the Senate alone and
  // a resolution never leaves the room that made it, so neither stages.
  if (doc.type === 'bill' || doc.type === 'amendment') {
    const next = R.nextChamber(world, doc);
    if (next) {
      const dur = Math.max(30, (doc.floorCloses || world.clock.tick) - (doc.floorOpened || world.clock.tick));
      // The record of the room it has just cleared. `doc.tally` is about to be
      // overwritten by the second chamber's count, and "passed the House 12–8
      // and the Senate 11–9" is the whole point of having two of them.
      doc.chamberTallies = [...(doc.chamberTallies || []),
        { body: t.req.body, yea: t.yea, nay: t.nay, tieBroken: t.tieBroken, tick: world.clock.tick }];
      doc.chamberStage = (doc.chamberStage || 0) + 1;
      doc.status = 'floor';
      doc.votes = {};
      doc.statements = {};
      doc.floorOpened = world.clock.tick;
      doc.floorCloses = world.clock.tick + dur;
      doc.requirement = R.voteRequirement(world, doc);
      log(world, 'vote', `It goes now to the ${R.office(world, next)?.name || next}. ${R.fracText(doc.requirement.fraction)} required.`,
        { docId: doc.id, weight: 2 });
      return ok(doc);
    }
  }

  const veto = world.constitution.legislature.vetoOffice;
  const needsSig = doc.type === 'bill' || doc.type === 'amendment' || doc.type === 'treaty';
  if (veto && needsSig && doc.type !== 'amendment') {
    doc.status = 'awaiting-signature';
    // The day it landed on the desk. Read by npc.clearTheDesk, which gives a
    // government a day or two to read a bill before signing it.
    doc.passedAt = world.clock.tick;
    log(world, 'vote', `“${doc.title}” goes to the ${R.office(world, veto)?.name} for signature.`, { docId: doc.id });
    // Signing happens in the Oval Office, not on the floor — so the person who
    // has to sign it is told the bill has arrived rather than being expected to
    // notice it in the chamber's list on their next visit.
    for (const h of R.holders(world, veto)) {
      if (!h.playerId) continue;
      world.notices = world.notices || [];
      world.notices.push({
        id: 'nt_sig_' + doc.id + '_' + h.id, playerId: h.playerId,
        text: `“${doc.title}” has passed the ${chamber}. Sign or veto it in the Oval Office.`,
        tone: 'ok', ts: Date.now(),
      });
    }
  } else {
    promulgate(world, doc, null);
  }
  return ok(doc);
}

export function sign(world, docId, personaId) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'awaiting-signature') return fail('Nothing to sign.');
  if (!R.hasPower(world, personaId, 'promulgate')) return fail('Your office does not hold the power to sign bills into law.');
  doc.signedBy.push({ personaId, tick: world.clock.tick });
  promulgate(world, doc, personaId);
  return ok(doc);
}

export function veto(world, docId, personaId) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'awaiting-signature') return fail('Nothing to veto.');
  if (!R.hasPower(world, personaId, 'veto')) return fail('Your office does not hold the veto.');
  doc.status = 'vetoed';
  doc.vetoedBy = personaId;
  doc.votes = {};
  log(world, 'vote', `“${doc.title}” is vetoed by ${world.personas[personaId]?.name}.`, { actors: [personaId], docId: doc.id, weight: 2 });
  return ok(doc);
}

export function openOverride(world, docId, personaId, floorTicks = 90) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'vetoed') return fail('Not a vetoed measure.');
  const may = R.mayPropose(world, personaId, 'bill');
  if (!may.ok) return fail(may.reason);
  doc.status = 'override';
  doc.floorOpened = world.clock.tick;
  doc.floorCloses = world.clock.tick + floorTicks;
  // Back to the first chamber. The bill reached the desk by clearing both rooms,
  // so its stage is sitting at the upper one; leaving it there would let a
  // vetoed bill be overridden by the Senate alone — half a Congress undoing a
  // veto the whole of it could not have prevented. Both rooms, at the override
  // bar, in the order they saw it the first time.
  doc.chamberStage = 0;
  doc.votes = {};
  doc.requirement = { ...R.voteRequirement(world, doc), fraction: world.constitution.legislature.overrideFraction, label: 'Veto override' };
  const room = R.office(world, doc.requirement.body)?.name || doc.requirement.body;
  log(world, 'vote', `Override attempt on “${doc.title}” in the ${room}. ${R.fracText(doc.requirement.fraction)} required${R.isBicameral(world) ? ', in both chambers' : ''}.`, { actors: [personaId], docId: doc.id, weight: 2 });
  return ok(doc);
}

export function closeOverride(world, docId) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'override') return fail('Not an override.');
  const roll = R.electorateFor(world, doc);
  let yea = 0, nay = 0;
  for (const v of roll) { const b = doc.votes[v.personaId]; if (b === 'yea') yea++; else if (b === 'nay') nay++; }
  const share = yea + nay ? yea / (yea + nay) : 0;
  const room = R.office(world, doc.requirement.body)?.name || 'chamber';
  if (share >= doc.requirement.fraction - 1e-9 && yea + nay > 0) {
    // One room down. An override that has carried the first chamber is not law
    // until the second one says so too, at the same bar.
    const next = R.nextChamber(world, doc);
    if (next) {
      const dur = Math.max(30, (doc.floorCloses || world.clock.tick) - (doc.floorOpened || world.clock.tick));
      doc.chamberTallies = [...(doc.chamberTallies || []),
        { body: doc.requirement.body, yea, nay, tieBroken: null, tick: world.clock.tick, override: true }];
      doc.chamberStage = (doc.chamberStage || 0) + 1;
      doc.votes = {};
      doc.statements = {};
      doc.floorOpened = world.clock.tick;
      doc.floorCloses = world.clock.tick + dur;
      doc.requirement = { ...R.voteRequirement(world, doc), fraction: world.constitution.legislature.overrideFraction, label: 'Veto override' };
      log(world, 'vote', `The ${room} votes to override, ${yea}–${nay}. The ${R.office(world, next)?.name || next} must do the same.`, { docId: doc.id, weight: 2 });
      return ok(doc);
    }
    log(world, 'vote', `Veto overridden, ${yea}–${nay}. “${doc.title}” becomes law over the executive's objection.`, { docId: doc.id, weight: 3 });
    promulgate(world, doc, null);
  } else {
    doc.status = 'failed';
    log(world, 'vote', `Override fails in the ${room}, ${yea}–${nay}. The veto stands.`, { docId: doc.id, weight: 2 });
  }
  return ok(doc);
}

export function promulgate(world, doc, byPersona) {
  doc.status = 'law';
  doc.promulgated = world.clock.tick;
  doc.promulgatedAt = canonDate(world);
  world.laws.push(doc.id);
  // Log the promulgation before the clauses fire, so the record reads in the
  // order it happened: the law, then everything the law did.
  log(world, 'law', `“${doc.title}” takes effect${byPersona ? `, signed by ${world.personas[byPersona]?.name}` : ''}.`,
    { actors: byPersona ? [byPersona] : [], docId: doc.id, weight: 3 });
  for (const c of doc.clauses) {
    try {
      const r = (CLAUSES[c.kind]?.apply || (() => {}))(world, c, doc);
      // A clause that could not take effect is still on the statute book, and
      // the record has to say so out loud — a bill sits on the floor for weeks,
      // and the world moves under it. A BUILD whose parcel was broken ground on
      // meanwhile used to no-op in silence: the law passed, nothing was built,
      // nothing was charged, and the ledger read like the treasury had lied.
      if (r && r.ok === false) {
        log(world, 'law', `A clause of “${doc.title}” has no effect: ${r.reason}`,
          { docId: doc.id, weight: 3 });
      }
    } catch (e) { console.error('clause failed', c, e); }
  }
  // Putting this on the statute book is the expensive part. Everyone who voted
  // for it wears it, the nation's mood drops, and the record names the ground —
  // which is the same ground the court will be handed.
  if (doc.disrepute?.length) {
    nudgeMoodAll(world, -12);
    const yeas = Object.entries(doc.votes || {}).filter(([, v]) => v === 'yea').map(([pid]) => pid);
    for (const pid of yeas) {
      const p = world.personas[pid];
      if (p) { nudgeApproval(p, -14); p.reputation = (p.reputation || 0) - 2; }
    }
    const author = world.personas[doc.authorId];
    if (author) { nudgeApproval(author, -18); author.reputation = (author.reputation || 0) - 4; }
    log(world, 'law', `“${doc.title}” is on the statute book of ${world.nation}: ${doc.disrepute[0]}. It and everyone who voted for it will be remembered by name.`,
      { actors: [doc.authorId, ...yeas].filter(Boolean), docId: doc.id, weight: 5 });
  }
  // If this measure was drafted to answer a crisis, answering it is what it
  // does. The chamber passing the appropriation *is* the government's response
  // — without this the money left the treasury, the works were funded, and the
  // crisis still expired against the government for having been ignored, which
  // is the opposite of the lesson the referral button exists to teach.
  if (doc.answers?.evUid) {
    const ev = (world.events || []).find((x) => x.uid === doc.answers.evUid);
    if (ev && ev.resolved == null) {
      ev.resolved = world.clock.tick || 1;
      ev.resolvedBy = byPersona || doc.authorId || null;
      ev.choice = doc.answers.option ?? -1;
      ev.byLaw = doc.id;
      log(world, 'crisis', `${ev.title} is answered by the chamber, not the executive: `
        + `“${doc.title}” carries it.`, { docId: doc.id, weight: 2 });
    }
  }
  recomputeEconomy(world);
  return doc;
}

function signOrder(world, doc, personaId) {
  // Executive orders are immediate — but every clause is checked against the
  // powers of the office, and against enumerated rights, before it lands.
  const blocked = [];
  for (const c of doc.clauses) {
    const need = CLAUSES[c.kind]?.power;
    if (need && !R.hasPower(world, personaId, need))
      blocked.push(`${CLAUSES[c.kind].label}: your office does not hold the power to ${(R.POWERS[need] || need).toLowerCase()}.`);
    if (c.kind === 'ARREST') {
      const r = R.rightBlocking(world, 'ARREST_NOCHARGE');
      if (r && !c.charge) blocked.push(`${r.name}: ${r.text}`);
    }
    const cost = clauseCost(world, c);
    if (cost > 0) {
      const rule = R.spendRule(world, cost);
      if (rule.requires) blocked.push(`${moneyExact(cost)} exceeds the executive spending threshold. ${R.spendClauseText(world, cost)}`);
      if (cost > world.economy.treasury) blocked.push(`The treasury holds ${moneyExact(world.economy.treasury)}. This order requires ${moneyExact(cost)}.`);
    }
  }
  if (blocked.length) return fail(blocked.join(' '));
  doc.status = 'law';
  doc.promulgated = world.clock.tick;
  doc.promulgatedAt = canonDate(world);
  // Whether the office was standing on its own grant or on borrowed emergency
  // power is the first thing a court will want to know.
  doc.underEmergency = !!world.emergency?.active;
  doc.signedBy.push({ personaId, tick: world.clock.tick });
  world.laws.push(doc.id);
  for (const c of doc.clauses) (CLAUSES[c.kind]?.apply || (() => {}))(world, c, doc);
  recomputeEconomy(world);
  // Signed in private, in force at once — so the record of it is public
  // immediately. That publication is the only check on an instrument this fast.
  log(world, 'law', `Executive Order: “${doc.title}”, signed by ${world.personas[personaId]?.name}. In force at once, no vote.`, { actors: [personaId], docId: doc.id, weight: 3 });
  return ok(doc);
}

/**
 * Take a law off the board. The mechanical half of striking one down, shared by
 * a single justice's order and by a judgment of the full court — so both undo
 * exactly the same things, and neither can drift from the other.
 */
export function revokeLaw(world, doc) {
  doc.struck = true; doc.status = 'struck';
  world.laws = world.laws.filter((id) => id !== doc.id);
  // Reversible effects come back off the board; spent money does not. A holding
  // that an order was never lawful has to actually reach the person it was used
  // on — otherwise the court is only writing essays.
  for (const c of doc.clauses) {
    if (c.kind === 'AMEND') {
      // Restoring an amendment requires the record — this is why the record matters.
      const a = R.AMENDABLE.find((x) => x.path === c.path);
      if (a && c.prev != null) R.setPath(world.constitution, c.path, c.prev);
    }
    if (c.kind === 'ARREST') {
      const p = world.personas[c.persona];
      if (p && p.imprisoned) {
        p.imprisoned = false;
        p.charges = (p.charges || []).filter((x) => x !== (c.charge || 'unspecified'));
        log(world, 'court', `${p.name} is released — the order that held them is void.`, { actors: [p.id], weight: 2 });
      }
    }
    if (c.kind === 'EXILE') {
      const p = world.personas[c.persona];
      if (p && p.exiled) {
        p.exiled = false;
        log(world, 'court', `${p.name}'s exile is void; they may return.`, { actors: [p.id], weight: 2 });
      }
    }
    if (c.kind === 'GRANT_POWER' && !c.revoke) {
      // A power granted by an act that never had force was never granted.
      const o = R.office(world, c.office);
      if (o) o.powers = o.powers.filter((pw) => pw !== c.power);
    }
    if (c.kind === 'RIGHT') {
      world.constitution.rights = (world.constitution.rights || []).filter((r) => r.name !== c.name);
    }
  }
}

export function strikeDown(world, docId, personaId, reason) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'law') return fail('Only a law in force can be struck.');
  if (!R.hasPower(world, personaId, 'strike_law')) return fail('Your office does not hold the power to strike laws.');
  revokeLaw(world, doc);
  log(world, 'court', `“${doc.title}” is struck down as unconstitutional by ${world.personas[personaId]?.name}. ${reason || ''}`.trim(),
    { actors: [personaId], docId: doc.id, weight: 3 });
  return ok(doc);
}

// --- Treasury gate — the interface that physically will not disburse -------

export function disburseGate(world, personaId, amount) {
  const reasons = [];

  // What is being spent has to be a number, and a positive one.
  //
  // Every other check below is a comparison against `amount`, and a comparison
  // is the wrong shape of guard for a value that might not be a quantity. A
  // negative amount is under every spending threshold, is not greater than the
  // remaining allowance, and is not greater than the treasury — so it passed
  // all three, and then `treasury -= amount` *added* it. Five disbursals of
  // −$1bn took the treasury from $60M to $5,060M. NaN was worse: every
  // comparison against NaN is false, so it passed the same three gates and left
  // the treasury NaN, which within three hundred ticks was every district's
  // mood as well — and it is written to storage like that, so the Season is
  // bricked for good rather than for a moment.
  //
  // The Treasury tab does check (`Number.isFinite(amt) && amt > 0`) and will
  // not let a player press the button. But actions arrive from other tabs over
  // the transport and are applied straight to the world, and the rule this
  // codebase keeps everywhere else is that the engine is the authority and the
  // screen is a courtesy. This is the engine.
  const amt = +amount;
  if (!Number.isFinite(amt) || amt <= 0) {
    return {
      ok: false,
      reasons: ['A disbursement is an amount greater than nothing.'],
      rule: R.spendRule(world, 0), emergency: false,
      allowance: R.discretionUsed(world), viaEmergency: false,
    };
  }

  const g = R.grantOf(world, personaId, 'spend');
  if (!g) reasons.push('Your office does not hold the power to disburse from the treasury.');

  // A declared emergency suspends the thresholds for the office the
  // constitution names — that is the entire point of the power, and the
  // crisis-response path already honoured it while this one did not.
  const ec = world.constitution.emergency;
  const emergency = !!(world.emergency?.active && ec
    && R.officesOf(world, personaId).some((o) => o.id === ec.office));

  const rule = R.spendRule(world, amount);
  if (rule.requires && !emergency) reasons.push(`${R.spendClauseText(world, amount)} File it as a bill.`);

  // The rolling allowance. Without it, a "$1M needs a vote" rule is just a
  // maximum payment size and the executive spends the treasury $900k at a time.
  const d = R.discretionUsed(world);
  if (!emergency && !rule.requires && Number.isFinite(d.cap) && amount > d.remaining) {
    reasons.push(`Discretionary spending is capped at ${moneyExact(d.cap)} per ${d.years} year(s); ${moneyExact(d.used)} committed, ${moneyExact(d.remaining)} left. File a bill, or wait ${d.resetsIn} ticks.`);
  }
  if (amount > world.economy.treasury) reasons.push(`The treasury holds ${moneyExact(world.economy.treasury)}.`);
  return { ok: reasons.length === 0, reasons, rule, emergency, allowance: d, viaEmergency: emergency || !!g?.viaEmergency };
}

/**
 * Record an un-voted disbursement against the rolling allowance.
 *
 * Split out of disburse() so the departments can spend through the same gate
 * and the same ledger without going through disburse()'s own logging — the
 * war room and the foreign ministry write their own lines about what the money
 * bought. Money the chamber approved is the chamber's decision, not discretion,
 * so it is not counted here.
 */
export function noteDiscretion(world, amount, gate, personaId = null, purpose = '') {
  if (gate?.rule?.requires) return;
  world.discretionLog = world.discretionLog || [];
  world.discretionLog.push({ tick: world.clock.tick, amount, by: personaId, purpose });
  if (world.discretionLog.length > 400) world.discretionLog.splice(0, 200);
}

export function disburse(world, personaId, amount, purpose) {
  const gate = disburseGate(world, personaId, amount);
  if (!gate.ok) return fail(gate.reasons.join(' '));
  world.economy.treasury -= amount;
  // Only un-voted money counts against the allowance; anything the chamber
  // approved is the chamber's decision, not discretion.
  if (!gate.rule.requires) {
    world.discretionLog = world.discretionLog || [];
    world.discretionLog.push({ tick: world.clock.tick, amount, by: personaId, purpose: purpose || '' });
    if (world.discretionLog.length > 400) world.discretionLog.splice(0, 200);
  }
  const effect = applySpendingImpact(world, amount, purpose);
  const left = R.discretionUsed(world);
  log(world, 'money', `${moneyExact(amount)} disbursed by ${world.personas[personaId]?.name} for ${purpose || 'unspecified purposes'}${gate.viaEmergency ? ' under emergency powers' : ''}.`
    + (effect ? ' ' + effect : '')
    + (Number.isFinite(left.cap) && !gate.rule.requires ? ` ${moneyExact(left.remaining)} of the allowance remains.` : ''),
    { actors: [personaId], weight: 2 });
  // Deliberately no full recompute here: a jobs or relief disbursement lowers
  // district structural unemployment directly, and recomputeEconomy would
  // re-derive it from the map and erase the effect. It persists, fading as the
  // next construction or law reasserts the underlying figures.
  return ok(effect);
}

// --- Catching a company ----------------------------------------------------
//
// The piece the bankruptcy model was deliberately landed without. A company in
// distress could be caught by its founder's own money, by selling a building,
// or by nobody at all; the government watched an employer of four hundred people
// fail with a full treasury and no way to reach for it.
//
// It is a disbursement like any other, through the same gate — so in a republic
// where a million dollars needs the Assembly, a rescue needs the Assembly, and
// the argument happens on the floor where it belongs (see CLAUSES.BAILOUT). What
// it costs politically is the whole of the decision: public money handed to a
// private business is resented in proportion to how few people it saves.

/** The mood a rescue costs nationally before the jobs are counted against it. */
export const BAILOUT_ANGER = 6;
/** The headcount at which the jobs saved fully answer the anger. */
export const BAILOUT_JOBS_FULL = 200;

/** How far back a connection between a signer and a company still counts. */
export const INTEREST_YEARS = 6;
/** How much angrier the country is about a rescue that had an interest in it. */
export const INTEREST_ANGER = 7;

/**
 * Whose friend this company is.
 *
 * `bailout` will catch anybody's company. That is correct — the government is
 * not supposed to be barred from saving an employer because its founder once
 * gave to a party — and it was also the whole of the rule, which meant the most
 * obvious corruption available in this republic was free: fund the campaign,
 * take the chair, sign the cheque back. Nothing anywhere connected the three.
 *
 * So the connection is *found* rather than forbidden. Three of them, each read
 * off a record the world already keeps and none of them a guess:
 *
 *   - they paid you to think about a bill (persona.lobbiedBy)
 *   - they funded your campaign, or your party's (world.donations)
 *   - they are family (persona.lineage)
 *
 * Nothing here blocks anything. It prices it — the country is angrier, the
 * Chronicle says why, and the court is given something it can actually weigh.
 * See court.CLAIMS.public_money_private_interest.
 */
export function bailoutInterest(world, personaId, co) {
  const out = { conflicted: false, weight: 0, grounds: [], amount: 0 };
  const p = world.personas?.[personaId];
  if (!p || !co) return out;
  const since = world.clock.tick - INTEREST_YEARS * (world.clock?.ticksPerYear || 240);

  const paid = (p.lobbiedBy || []).filter((l) => l.company === co.id && l.tick >= since);
  if (paid.length) {
    const total = paid.reduce((s, l) => s + (l.amount || 0), 0);
    out.weight += 0.45;
    out.amount += total;
    out.grounds.push(`${co.name} paid ${p.name} ${moneyExact(total)} to think about ${paid.length === 1 ? 'a bill' : `${paid.length} bills`}`);
  }

  const gave = (world.donations || []).filter((d) => d.tick >= since && d.companyId === co.id
    && (d.candidateId === personaId || (d.kind === 'party' && d.partyId && d.partyId === p.party)));
  if (gave.length) {
    const total = gave.reduce((s, d) => s + (d.amount || 0), 0);
    const direct = gave.some((d) => d.candidateId === personaId);
    out.weight += direct ? 0.5 : 0.3;
    out.amount += total;
    out.grounds.push(direct
      ? `${co.name} put ${moneyExact(total)} behind the campaign that seated them`
      : `${co.name} gave ${moneyExact(total)} to their party`);
  }

  const founder = world.personas?.[co.founderId];
  if (founder && founder.id !== p.id && founder.lineage && founder.lineage === p.lineage) {
    out.weight += 0.4;
    out.grounds.push(`${founder.name} is family`);
  }

  out.weight = clamp(out.weight, 0, 1);
  out.conflicted = out.weight > 0;
  return out;
}

/**
 * What the country will think of catching this company, per point of mood.
 *
 * Jobs answer the anger; an interest in the company deepens it, and the jobs do
 * not answer that part. A rescue of four hundred people is forgiven; a rescue of
 * four hundred people who happen to work for your donor is not forgiven twice.
 */
export function bailoutMood(world, co, interest = null) {
  const staff = (co?.employees || []).length;
  const base = -BAILOUT_ANGER * (1 - Math.min(1, staff / BAILOUT_JOBS_FULL));
  return base - INTEREST_ANGER * (interest?.weight || 0);
}

export function bailout(world, personaId, companyId, amount) {
  const co = (world.companies || []).find((c) => c.id === companyId && !c.closed);
  if (!co) return fail('No such company.');
  const amt = Math.round(+amount);
  if (!Number.isFinite(amt) || amt < 1) return fail('Name an amount.');
  if (!CO.distressOf(world, co)) return fail(`${co.name} is not in trouble. The treasury does not pay businesses that are doing fine.`);
  const gate = disburseGate(world, personaId, amt);
  if (!gate.ok) return fail(gate.reasons.join(' '));
  noteDiscretion(world, amt, gate, personaId, `rescue of ${co.name}`);
  const res = payBailout(world, co, amt, personaId);
  if (!res.ok) return res;
  return ok({ company: co, ...res.value });
}

/**
 * The money actually moving, shared by the executive act and the clause the
 * chamber votes. The gate is the caller's business — a bill *is* the authority
 * for the money, and putting disburseGate in here would make the Assembly ask
 * the President's allowance for permission.
 */
export function payBailout(world, co, amt, personaId = null) {
  world.economy.treasury -= amt;
  const res = CO.bailout(world, co, amt);
  if (!res.ok) { world.economy.treasury += amt; return fail(res.reason); }

  // Whose friend it is, worked out before the money lands and written onto the
  // rescue itself — the court reads this record, not the Chronicle prose, and a
  // connection made six years ago should be weighed as it stood on the day.
  const interest = bailoutInterest(world, personaId, co);
  world.rescues = world.rescues || [];
  world.rescues.push({
    tick: world.clock.tick, companyId: co.id, companyName: co.name,
    by: personaId, amount: amt, staff: res.value.staff,
    interest: interest.conflicted ? { weight: interest.weight, grounds: interest.grounds, amount: interest.amount } : null,
  });
  if (world.rescues.length > 120) world.rescues.shift();

  // What the country makes of it. Everyone pays; the district with the jobs in
  // it is the only one that gets anything back the same day.
  nudgeMoodAll(world, bailoutMood(world, co, interest));
  const d = (world.districts || []).find((x) => x.id === co.district);
  if (d) nudgeMood(d, 3 + Math.min(6, res.value.staff / 40));

  const who = world.personas[personaId]?.name;
  log(world, 'money', `${moneyExact(amt)} of public money goes into ${co.name}`
    + `${res.value.staff ? `, where ${res.value.staff} ${res.value.staff === 1 ? 'person works' : 'people work'}` : ''}. `
    + (res.value.cured ? 'It is out of danger. ' : 'It is still in trouble. ')
    + 'The republic is a creditor of it now.'
    + (who ? ` ${who} signed for it.` : '')
    // Said out loud, in the same line, where nobody has to go looking for it.
    + (interest.conflicted ? ` It is not a disinterested rescue: ${interest.grounds.join('; ')}.` : ''),
  { actors: [personaId].filter(Boolean), weight: interest.conflicted ? 5 : 4 });
  return ok({ ...res.value, interest });
}

// ---------------------------------------------------------------------------
// Money has to do something, or the treasury is theatre. A disbursement's
// stated purpose is read for intent and the simulation moves accordingly —
// housing money houses people, policing money buys order, a slush fund buys a
// brief bump in mood and nothing lasting. Strength scales with the sum: about
// $10M is a full nudge.
// ---------------------------------------------------------------------------

const worstBy = (world, key) => world.districts.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
const bumpAll = (world, n) => nudgeMoodAll(world, n);

/**
 * What a post costs the public purse for a year.
 *
 * The same figure the republic already pays a worker on a construction site
 * (world.CONSTRUCTION_COST_PER_WORKER), because it is the same kind of job and
 * a game that priced them differently would be lying about one of them.
 *
 * Before this, employment came out of the *strength* term below rather than out
 * of the money: $5,000 hired 28 people and $99,999 hired 56, because both sums
 * were pinned to the same floor and the count was a fraction of the population
 * rather than a payroll. A programme now hires what it can afford and no more,
 * which is why $5,000 hires nobody and says so.
 */
export const COST_PER_JOB = CONSTRUCTION_COST_PER_WORKER;

/** Share of the population that wants work. Matches world.recomputeEconomy. */
const LABOR_SHARE = 0.48;

/**
 * What it costs the public purse to get one person off the street and keep them
 * off it for a year — the capital and the case work together.
 *
 * The same kind of figure as COST_PER_JOB above, and it does the same job: it
 * turns a sum of money into a number of people, so that the size of an
 * appropriation is what decides how much good it does.
 */
export const COST_PER_REHOUSING = 60000;

/**
 * What a disbursement's stated purpose is read as.
 *
 * This is a keyword parser, and for a long time it was a *hidden* keyword
 * parser: the field said "Purpose", the player typed "general fund", nothing
 * matched, and the money produced a mood flicker that decayed inside a minute.
 * The honest complaint that follows is "I have disbursed millions and nothing
 * has changed", and it was right. So each effect now carries a label and an
 * example, the composer offers them, and the player is told which one their
 * words matched before they spend anything.
 */
export const SPEND_EFFECTS = [
  {
    re: /hous|homeless|shelter|tenan|rent|encampment/i, name: 'housing', label: 'Housing', example: 'housing for the encampment',
    apply: (w, s, amount) => {
      const d = worstBy(w, 'homeless');
      // Out of the money, like the jobs programme beside it, and for the same
      // reason. It was a *share* of the district's homeless — 20% at full
      // strength — which meant the sum disbursed decided nothing and the same
      // cheque did twenty times as much in New York as in Virginia. Worse, once
      // the country was the real one, "full strength" was ten billion dollars
      // and every sum a president could actually authorise rounded the share to
      // zero: a $10M disbursal housed nobody and said so.
      //
      // A place costs about what a place costs. The cheque buys as many as it
      // buys, and it cannot house people who are not there.
      const rehoused = Math.min(d.homeless, Math.floor(amount / COST_PER_REHOUSING));
      if (!rehoused) {
        return `${moneyExact(amount)} houses nobody: a place costs about ${money(COST_PER_REHOUSING)}.`;
      }
      d.homeless = Math.max(0, d.homeless - rehoused);
      // Banked so the reduction survives the next distributePopulation recompute
      // rather than being erased by it — the relief houses people for real, not
      // until the next building opens. See world.distributePopulation.
      d.shelterRelief = (d.shelterRelief || 0) + rehoused;
      nudgeMood(d, 4 * s);
      d.salience.housing = clamp(d.salience.housing - 0.15 * s, 0.1, 1.6);
      return `Roughly ${rehoused.toLocaleString()} ${rehoused === 1 ? 'person' : 'people'} in ${d.name} `
        + `${rehoused === 1 ? 'is' : 'are'} housed.`;
    },
  },
  {
    re: /job|employ|work|industr|factory|business|stimul|public works|infrastructur/i, name: 'jobs', label: 'Jobs and works', example: 'public works and jobs',
    apply: (w, s, amount) => {
      // The count comes out of the money, not out of the strength term: a
      // programme hires what its budget will pay for at COST_PER_JOB, and the
      // fall in unemployment is that headcount against the labour force. Ten
      // million dollars is 125 posts, and in a republic of twenty-odd thousand
      // that is about a point of unemployment — which is what it should be.
      const hired = Math.floor(amount / COST_PER_JOB);
      if (!hired) {
        return `${moneyExact(amount)} hires nobody: a post costs about ${money(COST_PER_JOB)} for the year.`;
      }
      // Routed through a decaying relief modifier the tick loop applies after
      // it recomputes unemployment from the map — otherwise the very next
      // recompute (from this same bill) would erase the effect.
      const drop = clamp(hired / Math.max(1, totalPop(w) * LABOR_SHARE), 0, 0.12);
      w.economy.reliefBoost = clamp((w.economy.reliefBoost || 0) + drop, 0, 0.25);
      for (const d of w.districts) { d.unemployment = clamp(d.unemployment - drop, 0.008, 0.7); nudgeMood(d, 2 * s); }
      return hired === 1
        ? 'One person finds work while it runs.'
        : `About ${hired.toLocaleString()} people find work while it runs.`;
    },
  },
  {
    re: /polic|secur|order|jail|prison|law enforc|patrol|guard/i, name: 'order', label: 'Policing', example: 'policing and patrols',
    apply: (w, s) => {
      for (const d of w.districts) { d.order = clamp(d.order + 6 * s, 0, 100); nudgeMood(d, 1 * s); }
      return 'Order rises across the districts.';
    },
  },
  {
    re: /school|educat|hospital|health|clinic|care|medic|sanita/i, name: 'welfare', label: 'Schools and hospitals', example: 'schools and hospitals',
    apply: (w, s) => {
      for (const d of w.districts) { d.health = clamp((d.health || 55) + 5 * s, 0, 100); nudgeMood(d, 3 * s); d.salience.amenity = clamp(d.salience.amenity + 0.08 * s, 0.1, 1.6); }
      return 'Public health and services improve.';
    },
  },
  {
    re: /road|transit|transport|sewer|utilit|water|power|bridge|grid/i, name: 'infrastructure', label: 'Infrastructure', example: 'roads, sewers and the grid',
    apply: (w, s) => {
      for (const p of w.city.parcels) if (p.building) p.landValue = Math.round(clamp(p.landValue * (1 + 0.02 * s), 8, 900));
      bumpAll(w, 2 * s);
      return 'Land values and daily life improve.';
    },
  },
  {
    re: /welfare|relief|aid|food|subsid|pension|stipend|benefit/i, name: 'relief', label: 'Relief', example: 'relief and food aid',
    apply: (w, s) => {
      const d = worstBy(w, 'unemployment');
      w.economy.reliefBoost = clamp((w.economy.reliefBoost || 0) + 0.03 * s, 0, 0.25);
      nudgeMoodAll(w, 2.5 * s);
      nudgeMood(d, 3 * s);
      return `Relief reaches the hardest-hit districts.`;
    },
  },
  {
    re: /militar|defen|army|navy|troop|arms|weapon|barrack|war effort/i, name: 'military', label: 'The army', example: 'the army and its barracks',
    apply: (w, s, amount) => {
      // A division costs what the Department of Defense charges for one. It
      // used to cost `Math.max(1, …)` — which is to say, any sum at all bought
      // a division, and the war room's own price list was a formality you could
      // walk around by typing "army" into the purpose field.
      const added = Math.floor(amount / DEP.DIVISION_COST);
      w.military.exhaustion = clamp(w.military.exhaustion - 0.05 * s, 0, 1);
      if (!added) return `Not enough to raise a division — one costs ${money(DEP.DIVISION_COST)} — but it rests the men in barracks.`;
      w.military.units += added;
      return `${added} new division${added === 1 ? '' : 's'} raised.`;
    },
  },
  {
    re: /propagand|media|celebrat|festiv|monument|parade|campaign|public relations|pr /i, name: 'spectacle', label: 'Spectacle', example: 'a parade and a monument',
    apply: (w, s) => {
      bumpAll(w, 5 * s); // loud, immediate, and it fades — a decaying pressure
      w.media.pressure = w.media.pressure || [];
      w.media.pressure.push({ artId: 'spend_' + uid('p'), rows: w.districts.map((d) => ({ district: d.id, delta: -3 * s })), left: 16, targetType: null, targetId: null });
      return 'Approval jumps — and will settle back.';
    },
  },
];

/**
 * Which effects a purpose string will match, without spending anything. The
 * composer calls this as the player types, so the parser stops being a secret.
 */
export function readPurpose(purpose) {
  const text = String(purpose || '');
  return SPEND_EFFECTS.filter((e) => e.re.test(text));
}

export function applySpendingImpact(world, amount, purpose) {
  // Strength, on a scale where $10M is one full nudge. The floor used to be
  // 0.05, which meant every sum from a dollar to half a million landed with
  // exactly the same weight — the reason $5,000 and $99,999 bought comparable
  // programmes. There is no floor now: a small sum does a small thing, and
  // where the effect is a headcount rather than a mood, the money buys it
  // outright at a stated price (see COST_PER_JOB, DEP.DIVISION_COST).
  const s = clamp(amount / 1e10, 0, 2.5);
  const text = String(purpose || '');
  const hits = SPEND_EFFECTS.filter((e) => e.re.test(text));
  if (!hits.length) {
    // Unmarked money still circulates — a small, honest, fading bump.
    bumpAll(world, 1.2 * s);
    return amount >= 1e9 ? 'The money circulates; little of lasting note.' : null;
  }
  return hits.map((e) => e.apply(world, s, amount)).join(' ');
}

// --- Construction, offices, war --------------------------------------------

export function startProject(world, parcelIndex, buildingKey) {
  const p = world.city.parcels[parcelIndex];
  const b = BUILDINGS[buildingKey];
  if (!p || !b) return fail('No such parcel or structure.');
  if (p.project) return fail('The parcel is already under construction.');
  // The picker only offers vacant land, but a bill is drafted weeks before it
  // is law — the ground can be taken in between, and a law does not demolish
  // what it finds standing there.
  if (p.building) return fail(`A ${BUILDINGS[p.building]?.name || 'structure'} already stands there.`);
  world.economy.treasury -= b.cost;
  p.project = {
    building: buildingKey, started: world.clock.tick,
    ticks: Math.max(4, Math.round(b.years * world.clock.ticksPerYear)),
    progress: 0, cost: b.cost,
  };
  p.zone = b.zone;
  const d = world.districts.find((x) => x.id === p.district);
  // The crew counts as employed from today — see world.constructionCrew. The
  // recompute has to happen here rather than waiting for the next one, or the
  // jobs a groundbreaking creates do not exist until something unrelated
  // happens to trigger it.
  const crew = constructionCrew(p.project);
  recomputeEconomy(world);
  log(world, 'build', `Ground broken on a ${b.name} in ${d?.name} — ${money(b.cost)}, ${b.years} years, `
    + `${num(crew)} on the site.`, { district: p.district });
  return ok(p);
}

// --- Appointment -----------------------------------------------------------
// This lived inside the APPOINT action handler, tangled up with the `notice`
// calls that tell a player why they were refused — which meant the only way to
// appoint anybody was to be somebody with a playerId. An NPC president could
// not fill a vacant department however obvious the vacancy, so a Season without
// a human in the chair ran with an empty cabinet for its whole length.
//
// The gate and the effect are engine calls now. The handler still owns the
// prose it shows the player; it just no longer owns the rules.

/** Put somebody in a seat. Appointments do not count a term — see rules.countTerm. */
export function seatInOffice(world, seat, o, personaId) {
  seat.personaId = personaId;
  seat.since = world.clock.tick;
  if (o.atWill) seat.termEnds = null;
  else if (o.termFollows) {
    const ref = world.seats.find((s) => s.office === o.termFollows && s.personaId);
    seat.termEnds = ref ? ref.termEnds : R.termEndTick(world, o, world.clock.tick);
  } else seat.termEnds = R.termEndTick(world, o, world.clock.tick);
}

/**
 * May this person put that person in that seat, and what happens if they do.
 *
 * Every refusal carries the sentence it would have shown a player, so the
 * handler can print it unchanged and an NPC can simply read `ok`.
 */
export function appointGate(world, byPersonaId, seatId, personaId) {
  const seat = world.seats.find((s) => s.id === seatId);
  if (!seat) return fail('No such seat.');
  const o = R.office(world, seat.office);
  if (!o) return fail('No such office.');
  if (o.selection !== 'appointment') return fail(`${o.name} is not an appointive office.`);

  const appointer = R.office(world, o.appointedBy);
  const holds = R.officesOf(world, byPersonaId).some((x) => x.id === o.appointedBy);
  if (!holds || !R.hasPower(world, byPersonaId, 'appoint')) {
    return fail(`Only the ${appointer?.name || o.appointedBy} holds the power of appointment for the ${o.name}.`);
  }
  // Nobody appoints themselves. The power of appointment is a power over other
  // people; turned on its holder it is just a second office taken without an
  // election, and the Secretaryships are the obvious targets because they are
  // at-will and answer to the appointer. Unless this republic has voted for
  // plurality of office, in which case the constitution has already had this
  // argument and settled it the other way.
  if (personaId === byPersonaId && !R.allowsPlurality(world)) {
    return fail(`The power of appointment does not reach you; ${o.name} must go to somebody else.`);
  }
  // The Vice President and the bench are not available for departments: one is
  // the successor auditing the administration they would inherit, the other
  // reviews the acts of the government they would be serving in.
  const compat = R.mayAlsoHold(world, personaId, o.id);
  if (!compat.ok) return fail(compat.reason);
  // A post is filled before it is refilled.
  if (seat.personaId) {
    return fail(o.atWill
      ? `${o.name} is held by ${world.personas[seat.personaId]?.name}. Dismiss them first.`
      : `${o.name} is held by ${world.personas[seat.personaId]?.name} for a fixed term and cannot be reassigned.`);
  }
  // One offer at a time: an outstanding nomination has to be answered or
  // withdrawn before another goes out.
  const outstanding = (world.nominations || []).find((n) => n.seatId === seat.id);
  if (outstanding) {
    return fail(`${world.personas[outstanding.personaId]?.name} was offered the ${o.name} and has not answered. Withdraw it first.`);
  }
  const nominee = world.personas[personaId];
  if (!nominee || !nominee.alive) return fail('There is nobody by that name to appoint.');
  return ok({ seat, office: o, nominee, needsConsent: !!nominee.playerId });
}

/**
 * Make the appointment.
 *
 * A player offered a post must consent before they hold it — a seat on the
 * bench no less than a cabinet department, since a justice serves a fixed term
 * and cannot simply be dismissed back out of it. A synthetic persona takes it
 * at once. Until accepted the seat stays vacant.
 */
export function appoint(world, byPersonaId, seatId, personaId) {
  const gate = appointGate(world, byPersonaId, seatId, personaId);
  if (!gate.ok) return gate;
  const { seat, office: o, nominee, needsConsent } = gate.value;
  if (needsConsent) {
    world.nominations = (world.nominations || []).filter((n) => n.seatId !== seat.id);
    world.nominations.push({ seatId: seat.id, personaId, by: byPersonaId, tick: world.clock.tick });
    log(world, 'office', `${nominee.name} is nominated ${o.name} by ${world.personas[byPersonaId]?.name}, pending acceptance.`,
      { actors: [byPersonaId, personaId], weight: 1 });
    return ok({ nominated: true, nominee, office: o });
  }
  seatInOffice(world, seat, o, personaId);
  // The choosing happens behind the Oval Office door; the appointment itself is
  // public the moment it is made.
  log(world, 'office', `${nominee.name} is appointed ${o.name} by ${world.personas[byPersonaId]?.name}.`,
    { actors: [byPersonaId, personaId], weight: 3 });
  return ok({ nominated: false, nominee, office: o });
}

/**
 * How long an offer of office stands before it is withdrawn.
 *
 * Nothing ever withdrew one. A post offered to a player who never answered —
 * because they were not at the keyboard, or did not care, or never saw it —
 * blocked that seat for the rest of the Season: appointGate refuses a seat with
 * an outstanding nomination, so nobody else could be named to it either. Found
 * by watching an NPC government run six years with two of its three departments
 * empty and two silent offers pinned to them.
 *
 * The same shape as a department invitation, which already lapses — see
 * rules.INVITE_ANSWER_MONTHS. An offer is a question, and a question nobody
 * answers is a no.
 */
export const NOMINATION_MONTHS = 2;

/**
 * An officeholder may not run a company, so taking office sells it.
 *
 * The founding gate already forbids *starting* a company from the chair, but a
 * founder who then wins an election, or is appointed, or inherits by
 * succession, was left holding one — the conflict the gate exists to prevent,
 * arrived at from the other direction. This runs each tick and catches every
 * seating path at once rather than bolting the same check onto each: anybody
 * who both holds an office and still owns a company divests it, at the market
 * price less the hurried-sale haircut. See company.sell.
 *
 * It is the *president's* business the user asked about, but the rule is not
 * special to the presidency — no officeholder of the republic runs a company,
 * for the same reason. A seat is a seat.
 */
export function tickDivestOfficeholders(world) {
  for (const co of world.companies || []) {
    if (co.closed) continue;
    const ownerId = co.founderId;
    if (!ownerId) continue;
    if (!R.officesOf(world, ownerId).length) continue;
    const res = CO.sell(world, ownerId, { forced: true });
    if (res.ok) {
      // Nobody buys a company that owes more than it is worth, so an insolvent
      // one is wound up on the way into office rather than sold — see
      // company.sell. It is a different sentence because it is a different
      // fact about the person taking the chair.
      const liq = res.value.liquidation;
      log(world, 'money',
        liq
          ? `${world.personas[ownerId]?.name || 'The officeholder'} cannot sell ${res.value.name} on taking office — `
            + `it owes more than it is worth, so it is wound up, ${moneyExact(liq.shortfall)} unpaid. `
            + `No officeholder of ${world.nation} may run a company.`
          : `${world.personas[ownerId]?.name || 'The officeholder'} divests ${res.value.name} on taking office, `
            + `for ${moneyExact(res.value.net)}. No officeholder of ${world.nation} may run a company.`,
        { actors: [ownerId], weight: liq ? 3 : 2 });
    }
  }
  // The same conflict, arrived at from the passenger seat. The hiring gate
  // refuses an officeholder, but an employee who then wins a seat kept the
  // job — and with it companyOf(), which is what the sidebar's basement
  // collapse keys on, so a President hired in private life could lose the
  // Oval Office tab to their old employer's garage. Taking office ends the
  // employment the same tick it would have ended an ownership.
  for (const co of world.companies || []) {
    if (co.closed || !(co.employees || []).length) continue;
    const leaving = co.employees.filter((id) => R.officesOf(world, id).length);
    if (!leaving.length) continue;
    co.employees = co.employees.filter((id) => !leaving.includes(id));
    for (const id of leaving) {
      log(world, 'money',
        `${world.personas[id]?.name || 'The officeholder'} resigns from ${co.name} on taking office. `
        + `No officeholder of ${world.nation} draws a company's wage.`,
        { actors: [id], weight: 1 });
    }
  }
}

export function tickNominations(world) {
  const live = [];
  const wait = Math.round((NOMINATION_MONTHS / 12) * (world.clock.ticksPerYear || 240));
  for (const n of world.nominations || []) {
    // A ticket offer is answered inside the election and is not this.
    if (n.ticket || world.clock.tick - (n.tick ?? 0) < wait) { live.push(n); continue; }
    const p = world.personas[n.personaId];
    const seat = world.seats.find((s) => s.id === n.seatId);
    const o = seat && R.office(world, seat.office);
    // Remembered, so the same offer is not made to the same silence forever.
    // Without this an NPC president re-nominated whoever had just ignored them,
    // the seat spent four fifths of its life under a pending offer nobody was
    // going to answer, and a cabinet could not be completed.
    if (p) { p.lapsedOffers = p.lapsedOffers || {}; p.lapsedOffers[n.seatId] = world.clock.tick; }
    log(world, 'office', `The offer of the ${o?.name || 'office'} to ${p?.name || 'a nominee'} lapses unanswered.`,
      { actors: [n.personaId, n.by].filter(Boolean), weight: 1 });
  }
  world.nominations = live;
}

export function vacate(world, seat, why) {
  world.pastSeats = world.pastSeats || [];
  if (seat.personaId) world.pastSeats.push({ ...seat, endedTick: world.clock.tick, why });
  const left = seat.personaId;
  seat.personaId = null;
  seat.vacantSince = world.clock.tick;
  seat.why = why;
  // Leaving the chair is when the country writes you up. Every exit runs
  // through here — defeat, removal, death, a term simply ending — so this is
  // the one place that catches all of them.
  //
  // After the seat is cleared, not before: the biography counts terms off the
  // seat record, and writing it while the chair still named them counted the
  // tenure twice — a single term came out as "across 2 terms".
  if (left && seat.office === R.headOffice(world)?.id) writeBio(world, left);
}

// Succession: when an office with a named successor falls vacant by removal or
// death, its deputy steps up and serves out the unexpired term, leaving the
// deputy's own chair empty. (Not used for ordinary term-end, which holds an election.)
export function succeed(world, officeId) {
  const o = R.office(world, officeId);
  if (!o || !o.successor) return false;
  const seat = world.seats.find((s) => s.office === officeId && !s.personaId);
  const heirSeat = world.seats.find((s) => s.office === o.successor && s.personaId);
  if (!seat || !heirSeat) return false;
  const heirId = heirSeat.personaId;
  const from = R.office(world, o.successor)?.name || 'the deputy';
  // The unexpired term belongs to the office, so it is read off the office's
  // own seat — which keeps its termEnds through the vacancy — and not off the
  // deputy's. The two normally agree, because a deputy's term follows the
  // office they stand behind; when they disagree it is the office's clock that
  // is running out, and that is the one the term limit turns on.
  const unexpired = seat.termEnds ?? heirSeat.termEnds ?? world.clock.tick;
  seat.personaId = heirId;
  seat.since = world.clock.tick;
  seat.termEnds = unexpired; // completes the unexpired term
  // Whether finishing someone else's term spends one of your own. More than
  // half of it left and you have effectively served that term; less, and you
  // have merely finished it. See rules.partialTermCounts — this is the 22nd
  // Amendment's two-years rule, generalised to a term of any length.
  const remaining = unexpired - world.clock.tick;
  const counts = R.partialTermCounts(world, o, remaining);
  if (counts) R.countTerm(world, heirId, o.id);
  heirSeat.personaId = null;
  heirSeat.vacantSince = world.clock.tick;
  heirSeat.why = 'succeeded to the ' + o.name;
  log(world, 'office', `${world.personas[heirId]?.name} succeeds from ${from} to the ${o.name}.`
    + (R.termLimitOf(o)
      ? counts ? ' Enough of the term remains that it counts as one of their own.'
        : ' Under half remains, so it does not count against the limit.'
      : ''),
    { actors: [heirId], weight: 4 });
  return true;
}

// Every election runs the same 60 ticks — a minute of real time — whoever
// called it. Three different windows (25, 40, 60) meant the countdown you
// learned to read meant something different next time.
export function scheduleElection(world, officeId, inTicks = 60) {
  const o = R.office(world, officeId);
  if (!o) return fail('No such office.');
  if (world.elections.some((e) => e.office === officeId && e.status === 'open')) return fail('An election for that office is already running.');
  const e = {
    id: uid('el'), office: officeId, status: 'open',
    opens: world.clock.tick,
    // An election runs on its own counter, not on the canon clock. Canon time
    // stops for a ballot — the whole nation is at the polls — so a deadline
    // measured in canon ticks would never arrive. `age` advances while the world
    // is held; `runs` is how long it takes. `closes` is kept for display.
    age: 0, runs: inTicks, closes: world.clock.tick + inTicks,
    // `sealed` holds the voters who have finished: a ballot may be revised
    // freely until its owner submits it, and not afterwards.
    candidates: [], ballots: {}, sealed: {},
  };
  world.elections.push(e);
  log(world, 'election', `An election is called for the ${o.name}. Nominations open.`, { weight: 2 });
  return ok(e);
}

export function declareWar(world, foreignId) {
  const f = byId(world.foreign, foreignId);
  if (!f) return fail('No such power.');
  if (f.atWar) return fail('Already at war.');
  // There is nobody to declare it on. See applyPeaceTerms, where the last acre
  // of a country goes.
  if (f.absorbed) return fail(`${f.name} no longer exists. There is nothing to declare war on.`);
  f.atWar = true;
  world.military.wars.push({ id: uid('war'), foreign: foreignId, started: world.clock.tick, front: 0, exhaustion: 0 });
  nudgeMoodAll(world, -6);
  log(world, 'war', `War is publicly declared on ${f.name}.`, { weight: 4 });
  // Tearing up your own signature is not free. Every other power is watching
  // what your name on a treaty is worth, and prices it in.
  if (f.pact && world.clock.tick < f.pact.ends) {
    f.pact = null;
    for (const other of world.foreign) {
      if (other.id !== foreignId && !other.allied) other.hostility = Math.min(100, other.hostility + 8);
    }
    nudgeMoodAll(world, -4);
    log(world, 'war', `The non-aggression pact with ${f.name} is torn up to do it. Every other capital read the lesson.`, { weight: 4 });
  }
  // Alliance obligations fire automatically. That is the point of a treaty.
  callAllies(world, world.military.wars[world.military.wars.length - 1], foreignId);
  return ok();
}

/**
 * How much of an ally's army actually turns up.
 *
 * Not all of it. A pact partner has its own borders to hold, and a coalition
 * where every signatory arrives at full strength would make the alliance the
 * only decision in the game. Six tenths is enough to change a war and not
 * enough to excuse you from having an army.
 */
export const ALLY_WEIGHT = 0.6;

/**
 * Call the mutual-defence pacts.
 *
 * This used to log a sentence and set `ally.joinedWar`, a field nothing in the
 * engine ever read — so "obligations are now automatic" was prose over a value
 * nobody looked at, and a pact bought you a paragraph in the Chronicle. And it
 * was only ever called when *you* declared war. When war was declared on you,
 * which is the case a mutual-defence pact exists for, nobody was called at all.
 *
 * An ally that answers is written onto the war itself, and sim.tickWar counts
 * its army on our side of the front. One already fighting its own war does not
 * answer: it is busy, and a treaty does not conjure divisions.
 */
export function callAllies(world, war, againstId) {
  if (!war) return [];
  war.allies = war.allies || [];
  const called = [];
  for (const ally of world.foreign) {
    if (ally.id === againstId || !ally.allied || ally.atWar || ally.absorbed) continue;
    if (war.allies.includes(ally.id)) continue;
    war.allies.push(ally.id);
    // So the declaration loop does not have a power turn on us in the middle of
    // fighting beside us, and so the war's end knows whom to send home.
    ally.fighting = war.id;
    called.push(ally.name);
  }
  const target = byId(world.foreign, againstId);
  if (called.length) {
    log(world, 'war', `${called.join(' and ')} ${called.length === 1 ? 'enters' : 'enter'} the war `
      + `against ${target?.name || 'the aggressor'}, under the mutual-defense pact.`,
      { weight: 3 });
  } else if (world.foreign.some((a) => a.allied && a.id !== againstId)) {
    // A pact that could not answer is worth saying out loud. It is the whole
    // argument for keeping more than one.
    log(world, 'war', 'The mutual-defense pacts are called on; no signatory can answer.',
      { weight: 3 });
  }
  return called;
}

/** Send the coalition home. Called when a war is won, lost, or otherwise over. */
export function dismissAllies(world, war) {
  for (const id of war?.allies || []) {
    const ally = byId(world.foreign, id);
    if (ally && ally.fighting === war.id) ally.fighting = null;
  }
}

const ok = (v) => ({ ok: true, value: v });
const fail = (reason) => ({ ok: false, reason });
export { ok, fail };

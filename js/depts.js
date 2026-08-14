// The two departments: State and Defense.
//
// Both are rooms with a job, gated to the secretary who runs them and to the
// President, and both do their work through things the rest of the engine
// already believes in — State moves a foreign power's hostility, Defense moves
// the numbers that decide a front. Neither invents a currency of its own.
//
// The split is the point. State can lower a hostility that Defense can only
// prepare for, and Defense can win a war that State failed to prevent. A
// President who never opens either room is a President governing on the two
// levers the crisis cards hand them.

import { uid, clamp, byId, chance, count, moneyExact } from './util.js';
import { log, year } from './chronicle.js';
import * as R from './rules.js';
import * as A from './acts.js';

// --- State: the envoys -----------------------------------------------------

// Names read as a foreign service rather than as a random roll: a rank and a
// surname, drawn off the power's own id so the same country keeps the same
// ambassador for the Season.
const RANKS = ['Ambassador', 'Envoy', 'Chargé d’affaires', 'Minister-Counsellor'];
const SURNAMES = ['Halvard', 'Ostrek', 'Vance', 'Duthiel', 'Marek', 'Sollis', 'Brandt', 'Ivessen', 'Corvane', 'Ruthe'];

const hashOf = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** The standing delegation. Built once, on first use, and kept. */
export function envoys(world) {
  world.envoys = world.envoys || {};
  for (const f of world.foreign || []) {
    if (world.envoys[f.id]) continue;
    const h = hashOf(f.id + '/' + (world.nation || ''));
    world.envoys[f.id] = {
      foreign: f.id,
      // `>>>`, not `>>`: a hash above 2^31 shifted signed goes negative, and a
      // negative index is an ambassador called "undefined".
      name: `${RANKS[h % RANKS.length]} ${SURNAMES[(h >>> 3) % SURNAMES.length]}`,
      received: null,      // tick they were last shown in
      lastVisit: null,     // tick the last audience ended
    };
  }
  return world.envoys;
}

// An audience runs this long, and a power will not send anyone back for this
// long after one. Diplomacy is slow, and a department that could summon the
// same ambassador every tick is a lever, not a foreign ministry.
export const AUDIENCE_TICKS = 30;
export const RECALL_YEARS = 1;

export const audienceOpen = (world, e) =>
  !!e && e.received != null && world.clock.tick - e.received < AUDIENCE_TICKS;

export function recallLeft(world, e) {
  if (!e || e.lastVisit == null) return 0;
  const wait = Math.round(RECALL_YEARS * (world.clock.ticksPerYear || 240));
  return Math.max(0, wait - (world.clock.tick - e.lastVisit));
}

/** Ask a foreign power to send its ambassador to the department. */
export function receive(world, personaId, foreignId) {
  if (!R.mayEnterDept(world, personaId, 'state')) return { ok: false, reason: 'The Department of State is not open to you.' };
  const f = byId(world.foreign, foreignId);
  if (!f) return { ok: false, reason: 'No such power.' };
  const e = envoys(world)[foreignId];
  if (audienceOpen(world, e)) return { ok: false, reason: `${e.name} is already in the building.` };
  if (f.atWar) return { ok: false, reason: `${f.name} is at war with us. Their delegation went home the day it was declared.` };
  const left = recallLeft(world, e);
  if (left > 0) return { ok: false, reason: `${f.name} will not send anyone back yet. The last audience was too recent.` };
  e.received = world.clock.tick;
  log(world, 'office', `${e.name} of ${f.name} is received at the Department of State.`, { actors: [personaId], weight: 1 });
  return { ok: true, value: e };
}

/**
 * What can be said to an ambassador, and what it costs.
 *
 * Three approaches, and the interesting thing about them is that the cheap one
 * is not the good one. Reassurance is free and small. Pressing them is free,
 * raises hostility, and buys the only plain reading of their intentions in the
 * game. Terms cost real money and move the number that decides whether there is
 * a war at all.
 */
export const APPROACHES = {
  reassure: {
    label: 'Reassure them',
    blurb: 'Nothing is meant by the manoeuvres. Costs nothing, and is worth that.',
    apply: (world, f) => {
      f.hostility = clamp(f.hostility - 8, 0, 100);
      return `${f.name} is reassured, for now. Hostility eases.`;
    },
  },
  press: {
    label: 'Press them',
    blurb: 'Ask what they are doing on the border. They will not like it.',
    apply: (world, f) => {
      f.hostility = clamp(f.hostility + 5, 0, 100);
      // The reading is the reward: this is the one place in the game a player is
      // told, in plain words, how close a foreign power actually is to moving.
      const h = f.hostility;
      const read = h >= 75 ? 'They do not bother to deny it. This is a country looking for a pretext.'
        : h >= 55 ? 'The denials are thin and the ambassador is embarrassed by them. They are preparing something.'
          : h >= 35 ? 'Cool, correct, unwilling to give ground. No plan yet, and no goodwill.'
            : 'Genuinely puzzled by the question. Whatever is coming, it is not coming from them.';
      return `${e0(f)} ${read}`;
    },
  },
  terms: {
    label: 'Offer terms',
    cost: 8e6,
    blurb: 'Aid, tariff relief, a border commission. Expensive, and it works.',
    apply: (world, f) => {
      f.hostility = clamp(f.hostility - 22, 0, 100);
      return `${f.name} accepts the terms. The hostility of the last decade is bought down a decade's worth.`;
    },
  },
};

const e0 = (f) => `${f.name}:`;

export function talk(world, personaId, foreignId, kind) {
  if (!R.mayEnterDept(world, personaId, 'state')) return { ok: false, reason: 'The Department of State is not open to you.' };
  const a = APPROACHES[kind];
  if (!a) return { ok: false, reason: 'No such approach.' };
  const f = byId(world.foreign, foreignId);
  const e = envoys(world)[foreignId];
  if (!f || !e) return { ok: false, reason: 'No such power.' };
  if (!audienceOpen(world, e)) return { ok: false, reason: `${e ? e.name : 'The ambassador'} is not in the building. Ask them to come in first.` };
  if (e.spoke) return { ok: false, reason: 'That audience has had its business. Ask them back another time.' };
  if (a.cost) {
    // Money offered across a table is money out of the treasury, and it goes
    // through the same gate as any other disbursement: the constitution's
    // spending threshold, the rolling discretionary allowance, and the
    // treasury's balance. It used to check only that the office could spend at
    // all, which made this room a way around the chamber's own rules.
    const gate = A.disburseGate(world, personaId, a.cost);
    if (!gate.ok) return { ok: false, reason: gate.reasons.join(' ') };
    world.economy.treasury -= a.cost;
    A.noteDiscretion(world, a.cost, gate, personaId, `terms offered to ${f.name}`);
  }
  const note = a.apply(world, f);
  e.spoke = kind;
  e.said = note;
  log(world, 'office', `At the Department of State: ${a.label.toLowerCase()} — ${f.name}. ${note}`,
    { actors: [personaId], weight: 2 });
  return { ok: true, value: { note } };
}

// --- The president's own summons -------------------------------------------
// The department's ambassador is a standing channel with a standing cooldown:
// one audience a year per power, worked by the Secretary, whose whole job it is.
// A head of state telephoning another head of state is not that channel, so it
// does not queue behind it — but it is paid for in the only currency the office
// really has, which is the holder's own attention. A week out of the country,
// during which they hold none of their powers (see rules.abroad), and anything
// that breaks meanwhile breaks without a government. Once a calendar year,
// because the argument for having a Department of State is that it can do this
// more often than the President can.

/** Once a calendar year, per head of state. */
export const SUMMIT_YEARS = 1;

/** The year this persona last spent a week abroad, or null. */
export const lastSummit = (world, personaId) => (world.summitLog || {})[personaId] ?? null;

export function maySummon(world, personaId, foreignId) {
  // The week is counted in ticks, and the clock does not run during the
  // convention. A summit begun before the Season starts would never end, and
  // the head of state would hold none of their powers for the rest of the game
  // — found by walking into exactly that state while testing.
  if (world.phase !== 'live') {
    return { ok: false, reason: 'The republic has not begun. There is nobody to visit yet.' };
  }
  const head = R.headOffice(world);
  if (!head || !R.officesOf(world, personaId).some((o) => o.id === head.id)) {
    return { ok: false, reason: `Only the ${head?.name || 'head of government'} may call on another head of state.` };
  }
  if (R.abroad(world, personaId)) return { ok: false, reason: 'You are abroad already.' };
  const f = byId(world.foreign, foreignId);
  if (!f) return { ok: false, reason: 'No such power.' };
  if (f.atWar) {
    return { ok: false, reason: `${f.name} is at war with us. Their head of state is not taking the call.` };
  }
  const y = year(world);
  if (lastSummit(world, personaId) === y) {
    return { ok: false, reason: `You have already spent a week abroad this year. The next is Yr ${y + SUMMIT_YEARS}.` };
  }
  return { ok: true, foreign: f, weeks: R.summitTicks(world) };
}

/**
 * Go and see them.
 *
 * The business is chosen before departure and done on arrival — the same three
 * approaches the ambassador offers, on the same terms, including the spending
 * gate on `terms`. It has to be settled up front: once the summit starts the
 * President holds no powers, and a chequebook they cannot open is not a
 * negotiation.
 */
export function summon(world, personaId, foreignId, kind) {
  const may = maySummon(world, personaId, foreignId);
  if (!may.ok) return may;
  const a = APPROACHES[kind];
  if (!a) return { ok: false, reason: 'No such approach.' };
  const f = may.foreign;

  if (a.cost) {
    const gate = A.disburseGate(world, personaId, a.cost);
    if (!gate.ok) return { ok: false, reason: gate.reasons.join(' ') };
    world.economy.treasury -= a.cost;
    A.noteDiscretion(world, a.cost, gate, personaId, `terms offered to ${f.name} at a summit`);
  }
  const note = a.apply(world, f);

  world.summitLog = world.summitLog || {};
  world.summitLog[personaId] = year(world);
  world.summit = {
    by: personaId, foreignId, kind, note,
    at: world.clock.tick, ends: world.clock.tick + R.summitTicks(world),
  };
  const p = world.personas[personaId];
  log(world, 'office', `${p?.name || 'The head of state'} goes to ${f.name} in person. `
    + `${a.label} — ${note} The government is abroad for the week.`,
  { actors: [personaId], weight: 3 });
  return { ok: true, value: { note, ends: world.summit.ends } };
}

/** End the summit when the week is up. Called on the tick. */
export function tickSummit(world) {
  const s = world.summit;
  if (!s || world.clock.tick < s.ends) return null;
  const p = world.personas[s.by];
  const f = byId(world.foreign, s.foreignId);
  world.summit = null;
  log(world, 'office', `${p?.name || 'The head of state'} is back from ${f?.name || 'abroad'}. `
    + 'The powers of the office resume.', { actors: [s.by].filter(Boolean), weight: 1 });
  return s;
}

/** Show the ambassador out — ends the audience early and starts the recall clock. */
export function dismiss(world, personaId, foreignId) {
  if (!R.mayEnterDept(world, personaId, 'state')) return { ok: false, reason: 'The Department of State is not open to you.' };
  const e = envoys(world)[foreignId];
  if (!e || !audienceOpen(world, e)) return { ok: false, reason: 'Nobody is waiting.' };
  closeAudience(world, e);
  return { ok: true };
}

function closeAudience(world, e) {
  e.received = null;
  e.spoke = null;
  e.said = null;
  e.lastVisit = world.clock.tick;
}

/**
 * An audience that has run its course ends itself.
 *
 * AUDIENCE_TICKS said "an audience runs this long" and nothing enforced it: the
 * only way one ever ended was a player clicking "Show them out", and that is
 * also the only thing that ever set `lastVisit`. So an ambassador received and
 * then forgotten stayed in the building for the rest of the Season, the recall
 * cooldown never started, and "one audience a year" — the rule that makes the
 * Department of State a foreign ministry rather than a lever — never engaged
 * for anybody who did not tidy up after themselves.
 */
export function tickAudiences(world) {
  for (const e of Object.values(world.envoys || {})) {
    if (e.received == null) continue;
    if (world.clock.tick - e.received < AUDIENCE_TICKS) continue;
    const f = byId(world.foreign, e.foreign);
    closeAudience(world, e);
    log(world, 'office', `${e.name} of ${f?.name || 'the delegation'} leaves the Department of State.`,
      { weight: 1 });
  }
}

// --- Defense: plans, mobilisation, deployment ------------------------------

/**
 * What a war plan is worth, and for how long.
 *
 * A plan is drawn against one power. It takes a while to draw — staff work is
 * not instant — and then it decays, because a plan is written against an army
 * that then changes. At full strength it is worth a fifth of the fighting.
 */
export const PLAN_DRAFT_TICKS = 20;
export const PLAN_LIFE_YEARS = 4;
export const PLAN_WEIGHT = 0.1;

export const POSTURES = {
  defensive: { label: 'Defensive', blurb: 'Hold the border and bleed them on it. Steadier, slower to win.', bias: -0.4 },
  offensive: { label: 'Offensive', blurb: 'Cross first and fight on their ground. Wins faster, loses faster.', bias: 0.9 },
};

export function plans(world) {
  world.military.plans = world.military.plans || {};
  return world.military.plans;
}

export function planFor(world, foreignId) {
  const p = plans(world)[foreignId];
  if (!p) return null;
  const age = world.clock.tick - p.drafted;
  if (age < PLAN_DRAFT_TICKS) return { ...p, ready: false, strength: 0 };
  const life = PLAN_LIFE_YEARS * (world.clock.ticksPerYear || 240);
  const strength = clamp(1 - (age - PLAN_DRAFT_TICKS) / life, 0, 1);
  return { ...p, ready: true, strength };
}

export function draftPlan(world, personaId, foreignId, posture) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const f = byId(world.foreign, foreignId);
  if (!f) return { ok: false, reason: 'No such power.' };
  if (!POSTURES[posture]) return { ok: false, reason: 'No such posture.' };
  plans(world)[foreignId] = { id: uid('plan'), foreign: foreignId, posture, drafted: world.clock.tick, by: personaId };
  log(world, 'war', `The Department of Defense begins a ${POSTURES[posture].label.toLowerCase()} plan against ${f.name}.`,
    { actors: [personaId], weight: 2 });
  return { ok: true };
}

/**
 * Raise divisions. Costs money and time to matter — the money now, the time
 * because a division raised this tick fights as badly as one raised this tick.
 */
export const DIVISION_COST = 6e6;

/**
 * How long a division takes to exist after it is paid for.
 *
 * A month and a half at the default 240 ticks a year — men have to be found,
 * equipped and drilled, and an army that appeared the instant the money cleared
 * meant a government could answer a war that started this morning by fielding a
 * corps this afternoon. The money leaves now; the division arrives later. See
 * sim.tickFormations, which is what actually delivers them.
 */
export const FORMATION_TICKS = 30;

/** Divisions paid for and not yet delivered. */
export const formingCount = (world) =>
  (world.military?.forming || []).reduce((n, f) => n + (f.count || 0), 0);

export function mobilize(world, personaId, n) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const count = Math.max(1, Math.min(6, Math.round(+n || 1)));
  const cost = count * DIVISION_COST;
  // An army is bought with public money. $6M a division is well over any
  // ordinary threshold, so raising one needs what a disbursement of that size
  // needs — a vote, or an emergency in force. It was simply helping itself.
  const gate = A.disburseGate(world, personaId, cost);
  if (!gate.ok) return { ok: false, reason: `${count} division${count === 1 ? '' : 's'} cost ${moneyExact(cost)}. ${gate.reasons.join(' ')}` };
  world.economy.treasury -= cost;
  A.noteDiscretion(world, cost, gate, personaId, `${count} division(s)`);
  // Paid for now, in the field later. `|| 1` because tick 0 is a real tick and
  // `ready` is compared, not flagged — but a formation queued at the founding
  // should still take its time.
  world.military.forming = world.military.forming || [];
  world.military.forming.push({
    count, by: personaId,
    since: world.clock.tick,
    ready: world.clock.tick + FORMATION_TICKS,
  });
  log(world, 'war', `${count} division${count === 1 ? '' : 's'} ordered, at ${moneyExact(cost)}. `
    + `They muster and drill; expect them in the field in ${FORMATION_TICKS} ticks.`,
  { actors: [personaId], weight: 2 });
  return { ok: true };
}

// Volunteer divisions: cheap and weak. A tenth the fighting strength of a regular
// division for well under a fifth of the price — a levy raised in a hurry, or the
// way a government without the votes for a proper army still puts bodies on the
// line. $900k is an ordinary disbursement, not a matter for the chamber the way a
// $6M division is; and they are the first into the ground when the shooting starts
// (see sim.tickWar), which is the other half of what "volunteer" means here.
export const VOLUNTEER_COST = 9e5;
export const VOLUNTEER_STRENGTH = 0.1;

export function mobilizeVolunteers(world, personaId, n) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  // Volunteers are raised for a war, not kept as a standing force — and they are
  // disbanded when it ends (sim.tickWar). No war, no call to arms.
  const atWar = (world.military.wars || []).some((w) => world.foreign.find((f) => f.id === w.foreign)?.atWar);
  if (!atWar) return { ok: false, reason: 'Volunteers are called up for a war. There is no war to raise them for.' };
  const count = Math.max(1, Math.min(10, Math.round(+n || 1)));
  const cost = count * VOLUNTEER_COST;
  const gate = A.disburseGate(world, personaId, cost);
  if (!gate.ok) return { ok: false, reason: `${count} volunteer division${count === 1 ? '' : 's'} cost ${moneyExact(cost)}. ${gate.reasons.join(' ')}` };
  world.economy.treasury -= cost;
  A.noteDiscretion(world, cost, gate, personaId, `${count} volunteer division(s)`);
  world.military.volunteers = (world.military.volunteers || 0) + count;
  log(world, 'war', `${count} volunteer division${count === 1 ? '' : 's'} raised, at ${moneyExact(cost)} — a tenth the strength of the regular line, each.`, { actors: [personaId], weight: 2 });
  return { ok: true };
}

// The Air Force. A wing is dear — dearer than a division — and it is worth it two
// ways: it adds to the weight the army fights at (air superiority over the front),
// and it can be flown against an enemy's cities directly, which is what wears a
// country's will to fight down fastest.
export const AIRWING_COST = 8e6;
export const AIR_COMBAT = 0.4;       // each wing's air-superiority weight in the line
export const BOMB_COOLDOWN = 6;      // ticks a wing needs to refuel and rearm between raids
export const BOMB_EXHAUSTION = 0.05; // enemy war-weariness a raid adds per wing flown
export const BOMB_DAMAGE = 2;        // enemy strength a raid knocks down per wing flown
export const BOMB_FLAK = 0.12;       // chance a raid costs a wing to the enemy's guns
const AIR_SORTIE_CAP = 6;            // most wings that fly one raid

export function commissionAir(world, personaId, n) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const count = Math.max(1, Math.min(6, Math.round(+n || 1)));
  const cost = count * AIRWING_COST;
  const gate = A.disburseGate(world, personaId, cost);
  if (!gate.ok) return { ok: false, reason: `${count} air wing${count === 1 ? '' : 's'} cost ${moneyExact(cost)}. ${gate.reasons.join(' ')}` };
  world.economy.treasury -= cost;
  A.noteDiscretion(world, cost, gate, personaId, `${count} air wing(s)`);
  world.military.airforce = (world.military.airforce || 0) + count;
  log(world, 'war', `${count} air wing${count === 1 ? '' : 's'} commissioned, at ${moneyExact(cost)}.`, { actors: [personaId], weight: 2 });
  return { ok: true };
}

// A foreign power's strength read as divisions on the line — the scale the front
// is fought on (see sim.tickWar, where their weight is strength/30). It is what
// the Defense menu shows of a country you are fighting.
/**
 * How much of a foreign power's strength stands for one of our divisions.
 *
 * The number 30 was written out at every site that had to compare the two
 * armies — the front, the coalition, an ally's landing, the menu — and the two
 * attrition rates were written as though it did not exist, which cost the
 * republic every war it ever fought. One name for it.
 */
export const STRENGTH_PER_DIVISION = 30;

export const enemyDivisions = (f) => Math.max(0, Math.round((f?.strength || 0) / STRENGTH_PER_DIVISION));

/**
 * What that army is actually worth on the day, which is not what it says on the
 * card.
 *
 * sim.tickWar has always counted an enemy as `strength / 30 × (1 + hostility /
 * 200)`: a country that hates you fights harder than its headcount. Nothing
 * said so anywhere a player could read it, so the Defense tab reported nine
 * divisions against a power that fought like thirteen, and any government —
 * synthetic or otherwise — that raised nine to answer them lost the war and
 * could not see why. One definition, used by the war, the card and the bill
 * that pays for it.
 */
export const enemyWeight = (f) => Math.max(0, (f?.strength || 0) / STRENGTH_PER_DIVISION) * (1 + (f?.hostility || 0) / 200);

/** What the enemy's divisions are doing, from the front line. `front` is ours. */
export function enemyDisposition(world, war) {
  if (!war) return 'holding their border';
  if (war.front <= -20) return 'driving into our territory';
  if (war.front >= 20) return 'falling back under pressure';
  return 'holding the line against ours';
}

// How long an allied landing in enemy territory takes to dig in: weak against the
// defences at first, at full weight once it has.
export const BEACHHEAD_RAMP = 40;

/**
 * An overseas ally puts a force ashore in the enemy's own territory — a second
 * front behind their line. It is weak against the defences at first and stronger
 * as it establishes itself (see sim.tickWar, which reads the ramp).
 */
export function landAllies(world, personaId, foreignId) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const f = byId(world.foreign, foreignId);
  if (!f || !f.atWar) return { ok: false, reason: 'You are not at war with them.' };
  const war = liveWar(world, foreignId);
  if (!war) return { ok: false, reason: 'There is no live war on that front.' };
  if (war.landing) return { ok: false, reason: `${byId(world.foreign, war.landing.ally)?.name || 'An ally'} already has a force ashore there.` };
  const ally = (world.foreign || []).find((a) => a.allied && !a.atWar && a.id !== foreignId);
  if (!ally) return { ok: false, reason: 'No overseas ally is in a position to land a force.' };
  war.landing = { ally: ally.id, since: world.clock.tick || 1 };
  log(world, 'war', `${ally.name} lands a force in ${f.name}'s own territory — weak against the defences at first, and stronger as it digs in.`, { actors: [personaId], weight: 3 });
  return { ok: true, ally: ally.id };
}

/** How established an allied landing on this front is, 0.2 (just ashore) to 1 (dug in). */
export function landingRamp(world, war) {
  if (!war?.landing) return 0;
  return clamp((world.clock.tick - (war.landing.since || 0)) / BEACHHEAD_RAMP, 0.2, 1);
}

/** Fly a bombing raid over an enemy at war: wears their will down and their army with it. */
export function bomb(world, personaId, foreignId) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const wings = world.military.airforce || 0;
  if (wings < 1) return { ok: false, reason: 'There is no air force to fly the raid — commission one first.' };
  const f = byId(world.foreign, foreignId);
  if (!f || !f.atWar) return { ok: false, reason: 'You are not at war with them.' };
  const war = liveWar(world, foreignId);
  if (!war) return { ok: false, reason: 'There is no live war on that front.' };
  if (war.bombedAt != null && world.clock.tick - war.bombedAt < BOMB_COOLDOWN) {
    return { ok: false, reason: 'The wings are refuelling and rearming from the last raid. Give them a day or two.' };
  }
  war.bombedAt = world.clock.tick || 1;
  const sortie = Math.min(wings, AIR_SORTIE_CAP);
  war.exhaustion = clamp((war.exhaustion || 0) + BOMB_EXHAUSTION * sortie, 0, 1);
  f.strength = Math.max((f.baseStrength ?? f.strength) * 0.15, f.strength - BOMB_DAMAGE * sortie);
  const lost = chance(world, BOMB_FLAK) ? 1 : 0;
  if (lost) world.military.airforce = Math.max(0, wings - 1);
  log(world, 'war', `Air wings strike ${f.name}'s cities${lost ? ' — one is lost to flak' : ''}. `
    + `Their army is down to ${Math.round(f.strength)}, and their people's stomach for the war wears thinner.`,
    { actors: [personaId], weight: 2 });
  return { ok: true, lostWing: lost };
}

export const deployment = (world) => (world.military.deployment = world.military.deployment || {});

export const committedTo = (world, foreignId) => Math.max(0, Math.round(deployment(world)[foreignId] || 0));

export function totalCommitted(world) {
  return Object.values(deployment(world)).reduce((a, b) => a + Math.max(0, Math.round(b || 0)), 0);
}

export const inReserve = (world) => Math.max(0, world.military.units - totalCommitted(world));

// --- Volunteers at the front -----------------------------------------------
// Volunteers raised and left at home are a levy in barracks: they add their
// weight to the line the way the rest of the army does, diluted by how thinly
// the army is spread (sim.tickWar's eff.factor). Sent to a *particular* front
// they fight there at their full tenth-of-a-division each, because they are all
// in one place and that place is the war. That is the whole of the choice: keep
// them home and they count for something everywhere, or commit them and they
// count for more in one place — and are the first to fall there.

export const volunteerFront = (world) =>
  (world.military.volunteerFront = world.military.volunteerFront || {});

export const volunteersAt = (world, foreignId) =>
  Math.max(0, Math.round(volunteerFront(world)[foreignId] || 0));

export const volunteersCommitted = (world) =>
  Object.values(volunteerFront(world)).reduce((a, b) => a + Math.max(0, Math.round(b || 0)), 0);

export const volunteersHome = (world) =>
  Math.max(0, (world.military.volunteers || 0) - volunteersCommitted(world));

/**
 * Send volunteers to a front, or bring them back. Only to a power the republic
 * is actually fighting — there is no front to send them to otherwise.
 */
export function sendVolunteers(world, personaId, foreignId, n) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const f = byId(world.foreign, foreignId);
  if (!f) return { ok: false, reason: 'No such power.' };
  if (!f.atWar) return { ok: false, reason: `${world.nation} is not at war with ${f.name}. There is no front to send them to.` };
  const want = Math.max(0, Math.round(+n || 0));
  const elsewhere = volunteersCommitted(world) - volunteersAt(world, foreignId);
  const total = world.military.volunteers || 0;
  if (want + elsewhere > total) {
    return { ok: false, reason: `There are ${total} volunteer division(s) and ${elsewhere} are already at another front.` };
  }
  const before = volunteersAt(world, foreignId);
  volunteerFront(world)[foreignId] = want;
  if (want !== before) {
    log(world, 'war', want > before
      ? `${want - before} volunteer division${want - before === 1 ? '' : 's'} go up to the ${f.name} front. ${want} there now.`
      : `${before - want} volunteer division${before - want === 1 ? '' : 's'} come back from the ${f.name} front. ${want} left.`,
    { actors: [personaId], weight: 1 });
  }
  return { ok: true };
}

/** Put divisions on a border, or take them off it. */
export function deploy(world, personaId, foreignId, n) {
  if (!R.mayEnterDept(world, personaId, 'defense')) return { ok: false, reason: 'The Department of Defense is not open to you.' };
  const f = byId(world.foreign, foreignId);
  if (!f) return { ok: false, reason: 'No such power.' };
  const want = Math.max(0, Math.round(+n || 0));
  const others = totalCommitted(world) - committedTo(world, foreignId);
  if (want + others > world.military.units)
    return { ok: false, reason: `There ${world.military.units === 1 ? 'is' : 'are'} ${count(world.military.units, 'division')} in the army and ${others} on other borders.` };
  const before = committedTo(world, foreignId);
  deployment(world)[foreignId] = want;
  if (want !== before) {
    // Moving up is a message, and the other side receives it.
    //
    // Divisions on a border used to be a private arrangement: they set the
    // multiplier a war would be fought at and nothing else, so the dominant
    // move was to mass the whole army on the angriest neighbour and leave it
    // there for the rest of the Season at no cost at all. That is not what an
    // army on a frontier is. It is the most legible threat a state can make
    // without saying anything, and this file's own thesis is that Defense can
    // only prepare for a hostility State has to fix — so preparing has to be
    // able to *create* the thing State is left to fix.
    //
    // Pulling back does not buy it off. Withdrawal stops the provocation and
    // that is all; talking a neighbour down is the envoy's job, not the
    // general's, and letting a deployment be walked back for free would make
    // the whole exercise a toggle rather than a decision.
    const shock = (want - before) * BORDER_SHOCK * (f.allied ? 0.25 : 1);
    if (want > before && !f.atWar) f.hostility = clamp(f.hostility + shock, 0, 100);
    log(world, 'war', want > before
      ? `${want - before} division${want - before === 1 ? '' : 's'} move to the ${f.name} border. ${want} there now.`
        + (f.atWar ? '' : ` ${f.name} has noticed.`)
      : `${before - want} division${before - want === 1 ? '' : 's'} pull back from the ${f.name} border. ${want} left.`,
    { actors: [personaId], weight: 1 });
  }
  return { ok: true };
}

/**
 * What an army parked on a frontier says, every second it is parked there.
 *
 * The one-off shock in `deploy` is the move being noticed; this is the standing
 * cost of leaving them there, added to the drift in sim.tickWar. A garrison is
 * not an event, it is a condition, and a neighbour reading it gets angrier for
 * as long as it can see them.
 *
 * Capped at twelve divisions' worth so a large army does not run the meter
 * faster than diplomacy can ever answer, and quartered for an ally, who reads
 * the same divisions as cover rather than as a threat. A power already at war
 * is past being provoked.
 */
export const BORDER_SHOCK = 1.4;            // per division, when they arrive
export const BORDER_MENACE = 0.006;         // per division, per tick, while they sit
export const BORDER_MENACE_CAP = 12;

export function borderMenace(world, foreignId) {
  const f = byId(world.foreign, foreignId);
  if (!f || f.atWar) return 0;
  const n = Math.min(committedTo(world, foreignId), BORDER_MENACE_CAP);
  if (n <= 0) return 0;
  return n * BORDER_MENACE * (f.allied ? 0.25 : 1);
}

/**
 * The multiplier a war with this power fights at.
 *
 * Committing the army to the border it is actually needed on is most of it, and
 * a plan drawn in advance is the rest. Neither is required — an army that was
 * never deployed still fights, at the eight-tenths a surprised country manages —
 * and a department that has done its work is worth about a third more than one
 * that has not. Enough to be worth doing, not enough to decide the war on its
 * own.
 */
export function effectiveness(world, foreignId) {
  const units = Math.max(1, world.military.units);
  const share = clamp(committedTo(world, foreignId) / units, 0, 1);
  const plan = planFor(world, foreignId);
  const planned = plan && plan.ready ? plan.strength * PLAN_WEIGHT : 0;
  return {
    share,
    plan: planned,
    // 0.8 with nothing done, 1.0 fully committed, up to 1.1 with a fresh plan.
    // It started at 0.6-1.2 and that was too harsh — a country caught out lost
    // nearly half its army's worth of fighting, which made an unopened Defense
    // tab a punishment rather than a missed opportunity.
    factor: 0.8 + 0.2 * share + planned,
  };
}

// --- The front, as ground --------------------------------------------------

/**
 * How far the border has actually moved, and which way.
 *
 * A war's `front` runs -100..100 and has always been a number on a card. This
 * turns it into territory: a band of land along the border, on the losing
 * side of it, that the winner is holding.
 *
 * It is deliberately an *overlay* and not a change to the map's geometry. The
 * district polygons, the parcels and the electorates are all cut from
 * `geography()`, and a REDISTRICT clause addresses parcels by index — moving
 * the real border mid-Season would move the ground under all of that. So the
 * republic keeps its shape and its seats, and occupation is drawn on top of
 * them, which is also what occupation actually is.
 */
export const MAX_ADVANCE = 26;          // world units at a front of ±100

/** The live, unfinished war with this power, if there is one. */
export function liveWar(world, foreignId) {
  return (world.military.wars || []).find((w) => w.foreign === foreignId && stillFighting(w)) || null;
}

/**
 * Is this war still being fought?
 *
 * Won and lost were the whole test, and a *negotiated* peace is neither: the
 * TREATY_PEACE clause stamped `negotiated` and `ended` and left both flags
 * false, so the war stayed live for ever. The occupation band stayed painted on
 * both maps, the front room stayed open on the Defense page, and an ally could
 * be landed in a country the republic had signed peace with years earlier.
 *
 * `ended == null` rather than `!ended`, because tick 0 is a real tick and a war
 * that ended on it would come back to life. See the same trap at `closed`,
 * `sealed` and `soldAt`.
 */
export const stillFighting = (w) => !!w && !w.won && !w.lost && w.ended == null;

/**
 * The occupied band along a border, or null when nothing is held.
 *
 * `byUs` says who is standing on it. The SAB has no land border with us — it
 * is an island — so a war with it moves no ground and returns null rather than
 * inventing a frontier.
 */
export function occupiedBand(g, foreignId, front) {
  if (!g || !front) return null;
  // geography() exposes the two border lines as `borders.a` / `borders.b`.
  const line = foreignId === 'goldland' ? g.borders?.a : foreignId === 'electrum' ? g.borders?.b : null;
  if (!line || line.length < 2) return null;
  const d = (Math.abs(front) / 100) * MAX_ADVANCE;
  if (d < 0.6) return null;
  const byUs = front > 0;
  // Goldland lies north of border A, so ground we take from them is drawn
  // north of it; ground they take from us is drawn south. Electrum lies east
  // of border B, and the same logic runs sideways.
  const push = foreignId === 'goldland'
    ? ([x, y]) => [x, y + (byUs ? -d : d)]
    : ([x, y]) => [x + (byUs ? d : -d), y];
  return { poly: [...line, ...line.slice().reverse().map(push)], byUs, depth: d };
}

/** Every band currently on the board. */
export function occupations(world, g) {
  const out = [];
  for (const f of world.foreign || []) {
    const war = liveWar(world, f.id);
    if (!war) continue;
    const band = occupiedBand(g, f.id, war.front);
    if (band) out.push({ foreign: f, war, ...band });
  }
  return out;
}

/** Called each tick: an audience does not sit in the building for ever. */
export function tickDepts(world) {
  const es = world.envoys;
  if (!es) return;
  for (const e of Object.values(es)) {
    if (e.received == null) continue;
    const f = byId(world.foreign, e.foreign);
    // A power that declares war recalls its delegation the same day.
    if (f?.atWar || world.clock.tick - e.received >= AUDIENCE_TICKS) {
      closeAudience(world, e);
    }
  }
}

// --- Treaties, from the other side of the table ----------------------------
// A treaty is an agreement between two states and this game only ever asked
// one of them. A non-aggression pact went straight to the floor, the chamber
// voted, and the other power was bound by it without ever being consulted —
// which made the Department of State decorative, because there was nothing to
// negotiate *for*. Now the proposal is put to them first and they answer, and
// what they answer depends on exactly the things that room exists to move.

/** How long a foreign ministry takes to answer. */
export const ASSENT_TICKS = 40;

/**
 * How long a foreign ministry remembers saying no.
 *
 * Without this, hostility does not govern anything: a refusal costs a player
 * forty ticks and the same treaty goes straight back out, and a 15% chance
 * asked seven times is a certainty. The point of putting a treaty to the other
 * side is that the answer depends on the relationship — so a no has to stand
 * long enough that the only way past it is the Department of State's own work.
 */
export const REFUSAL_YEARS = 2;
export const refusalTicks = (world) => Math.round(REFUSAL_YEARS * (world.clock.ticksPerYear || 240));

/** Is this power still refusing to be asked? */
export const refusing = (world, f) =>
  !!(f && f.refusedUntil != null && world.clock.tick < f.refusedUntil);

/** At or below this hostility they sign; at or above the other, they will not talk. */
export const HOSTILITY_YES = 10;
export const HOSTILITY_NO = 85;

// A longer commitment is a bigger ask. A power will promise a decade's peace
// readily and a generation's warily — binding your successors' successors is not
// a thing done lightly. The ordinary term (TREATY_COMFORT_YEARS, the clause's
// own default) costs nothing, so a warm power still signs the standard pact every
// time; past it the odds decline by TREATY_YEAR_PENALTY a year, never below
// TREATY_YEAR_FLOOR — even a century-long pact stays possible between friends,
// only unlikely. Only treaties that name a term feel this; a mutual-defence pact
// has none.
export const TREATY_COMFORT_YEARS = 10;
export const TREATY_YEAR_PENALTY = 0.01;
export const TREATY_YEAR_FLOOR = 0.45;

/** Which foreign power a treaty is addressed to, if any. */
export function treatyParty(world, doc) {
  const c = (doc?.clauses || []).find((x) =>
    x.kind === 'TREATY_DEFENSE' || x.kind === 'TREATY_NONAGGRESSION' || x.kind === 'TREATY_PEACE');
  return c ? { foreign: (world.foreign || []).find((f) => f.id === c.party) || null, kind: c.kind, clause: c } : null;
}

/**
 * Whether they say yes, and why.
 *
 * Hostility is most of it — a power that reads you as an enemy does not sign
 * away its options — and everything the Department of State can do moves
 * hostility. An audience that went well is worth a real amount here, which is
 * the connection the room was missing. A power already at war with you will not
 * sign anything, and one much stronger than you sees less in a mutual-defence
 * pact than you do.
 */
export function weighAssent(world, doc) {
  const t = treatyParty(world, doc);
  if (!t?.foreign) return { ok: false, reason: 'There is no such power to sign it.' };
  const f = t.foreign;

  // A peace treaty is the one thing a country at war signs, and the one thing a
  // country at peace has no business signing. Both are refused the wrong way
  // round: only-at-war for peace, only-at-peace for the others.
  if (t.kind === 'TREATY_PEACE') {
    if (!f.atWar) return { ok: false, reason: `${world.nation} is not at war with ${f.name}. There is no war to end.` };
    // Their willingness follows the ground. The front is signed from *our*
    // point of view — positive means we are winning, so they want to stop —
    // and negative means they are winning, so they are not looking to. Map
    // -30…+30 to 0.05…0.98. Hostility trims further: a country that reads
    // us as an enemy is not sitting down over tea even if it is losing.
    const war = liveWar(world, f.id);
    const front = war ? war.front : 0;
    let p = clamp((front + 30) / 60, 0.05, 0.98);
    const reasons = [];
    if (front > 15) reasons.push(`${f.name} has been losing ground`);
    else if (front < -15) reasons.push(`${f.name} is winning and knows it`);
    else reasons.push('the fighting is even');
    if (f.hostility > 70) { p *= 0.5; reasons.push('bitterness runs deep'); }
    return { chance: clamp(p, 0.02, 0.98), foreign: f, reasons };
  }

  if (f.atWar) return { ok: false, reason: `${f.name} is at war with ${world.nation}. There is nothing to discuss.` };

  if (refusing(world, f)) {
    return {
      ok: false,
      reason: `${f.name} turned this down inside the last ${REFUSAL_YEARS} years and will not be `
        + 'asked again yet. Move the hostility and come back.',
    };
  }
  // Hostility past the point where there is anything to talk about. A hard
  // door rather than a long-odds roll: a power that reads you as an enemy is
  // not a 6% chance, it is a no, and offering the dice invites the player to
  // keep throwing them.
  if (f.hostility >= HOSTILITY_NO) {
    return {
      ok: false,
      reason: `${f.name} reads ${world.nation} as an enemy — hostility ${Math.round(f.hostility)}. `
        + 'There is nothing to sign until that comes down.',
    };
  }

  const reasons = [];
  // Hostility is the whole of the base rate, and it runs all the way to
  // certainty. Warm relations used to top out at 96%, which meant the sister
  // republic refused a non-aggression pact one time in twenty-five for no
  // reason anybody could see or act on — the odds were doing the work the
  // relationship was supposed to do.
  //
  // The line runs between the two constants, so they mean what they say:
  // certainty at HOSTILITY_YES, nothing at HOSTILITY_NO, straight in between.
  //
  //   10  certain    30  three in four    50  a coin flip    70  one in five
  let p = clamp((HOSTILITY_NO - f.hostility) / (HOSTILITY_NO - HOSTILITY_YES), 0, 1);
  if (f.hostility <= HOSTILITY_YES) { p = 1; reasons.push('relations could not be better'); }
  else if (f.hostility < 20) reasons.push('relations are warm');
  else if (f.hostility > 60) reasons.push('relations are poor');

  if (t.kind === 'TREATY_DEFENSE') {
    // A defence pact is a bigger ask, and a much stronger partner gets less
    // out of it than you do.
    p *= 0.7;
    const ours = (world.military?.units || 0) * 18 + 40;
    if (f.strength > ours * 1.5) { p *= 0.6; reasons.push(`${f.name} does not need the protection`); }
  }
  if (f.ideology === 'fascist') { p *= 0.6; reasons.push('their government reads agreements as weakness'); }
  if (f.allied) { p = Math.min(0.98, p * 1.4); reasons.push('they are already allied to you'); }
  if (f.pact && world.clock.tick < f.pact.ends) { p = Math.min(0.98, p * 1.3); reasons.push('a pact already holds between you'); }

  // The longer the term they are asked to bind themselves to, the less willing
  // they are to sign it. See TREATY_COMFORT_YEARS and friends.
  const years = Math.max(1, Math.round(+t.clause?.years || 0));
  if (years > TREATY_COMFORT_YEARS) {
    const over = years - TREATY_COMFORT_YEARS;
    p *= clamp(1 - over * TREATY_YEAR_PENALTY, TREATY_YEAR_FLOOR, 1);
    reasons.push(`a ${years}-year term is a long commitment`);
  }

  return { chance: clamp(p, 0, 1), foreign: f, reasons };
}

/**
 * Put the proposal to them. Called when a treaty is introduced; the answer
 * comes back on the tick, ASSENT_TICKS later.
 */
export function askAssent(world, doc) {
  const t = treatyParty(world, doc);
  if (!t?.foreign) return null;
  doc.assent = { foreignId: t.foreign.id, asked: world.clock.tick, decides: world.clock.tick + ASSENT_TICKS };
  return doc.assent;
}

/**
 * Answer every proposal whose clock has run out. Returns what the Chronicle
 * should hear; the caller lays the accepted ones before the chamber.
 */
export function tickAssent(world) {
  const out = [];
  for (const id of world.docOrder || []) {
    const doc = world.documents[id];
    if (!doc || doc.status !== 'awaiting-assent' || !doc.assent) continue;
    if (world.clock.tick < doc.assent.decides) continue;
    const w = weighAssent(world, doc);
    const f = w.foreign || (world.foreign || []).find((x) => x.id === doc.assent.foreignId);
    const yes = w.ok !== false && chance(world, w.chance);
    doc.assent.answered = world.clock.tick;
    doc.assent.agreed = yes;
    doc.assent.why = w.reason || (w.reasons || []).join(', ');
    // A no stands. Otherwise the same treaty goes back out on the next tick
    // and hostility decides nothing but how many attempts it takes.
    if (!yes && f) f.refusedUntil = world.clock.tick + refusalTicks(world);
    out.push({ doc, yes, foreign: f, why: doc.assent.why });
  }
  return out;
}

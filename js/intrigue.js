// Conspiracy, espionage, and the end of governments.
//
// Silver runs on betrayal, so betrayal is sanctioned and mechanized rather than
// smuggled in through alt accounts. Private channels are real and private — and
// they leave a discoverable trail, because the audit log that once exposed a
// cheat is now a gameplay object. Spies replace alts. Coups are resolved by a
// support check, not by who owns the server.

import { uid, clamp, rng, chance, pick, sum, nudgeMood, nudgeMoodAll, nudgeApproval } from './util.js';
import { log } from './chronicle.js';
import * as R from './rules.js';
import { vacate } from './acts.js';

// --- Conspiracies ----------------------------------------------------------

export function foundConspiracy(world, { name, founderId }) {
  const c = {
    id: uid('con'), name: name || 'An understanding', founderId,
    members: [founderId], messages: [], traces: [], exposure: 4,
    created: world.clock.tick, exposed: false, purpose: '',
  };
  world.conspiracies.push(c);
  return { ok: true, value: c };
}

export function invite(world, conId, byId_, personaId) {
  const c = world.conspiracies.find((x) => x.id === conId);
  if (!c || !c.members.includes(byId_)) return { ok: false, reason: 'You are not in that room.' };
  if (c.members.includes(personaId)) return { ok: false, reason: 'Already inside.' };
  c.members.push(personaId);
  // Every new mouth is a new leak.
  c.exposure = clamp(c.exposure + 6 + c.members.length * 1.5, 0, 100);
  c.traces.push({ id: uid('tr'), kind: 'recruitment', tick: world.clock.tick, text: `${world.personas[personaId]?.name} was seen leaving the same door twice.`, weight: 6 });
  return { ok: true };
}

export function whisper(world, conId, personaId, text) {
  const c = world.conspiracies.find((x) => x.id === conId);
  if (!c || !c.members.includes(personaId)) return { ok: false, reason: 'You are not in that room.' };
  const m = { id: uid('msg'), personaId, title: R.titleOf(world, personaId), text, tick: world.clock.tick, ts: Date.now() };
  c.messages.push(m);
  c.exposure = clamp(c.exposure + 1.1 + c.members.length * 0.25, 0, 100);
  if (chance(world, 0.22)) {
    c.traces.push({ id: uid('tr'), kind: 'fragment', tick: world.clock.tick, msgId: m.id, text, weight: 10 });
  }
  return { ok: true, value: m };
}

/** An investigation rolls against accumulated exposure and can surface fragments. */
export function investigate(world, personaId, conIdOrNull) {
  const investigator = world.personas[personaId];
  const canInvestigate = R.hasPower(world, personaId, 'arrest') || R.hasPower(world, personaId, 'strike_law') || R.hasPower(world, personaId, 'impeach');
  if (!canInvestigate) return { ok: false, reason: 'Investigations need an office with power to arrest, try, or strike.' };

  // Every investigation leaves a record with a plain-language outcome, so the
  // Intrigue tab always shows something happened — even a dead end is a result.
  world.investigations = world.investigations || [];
  const file = (result, extra = {}) => world.investigations.push({ id: uid('inv'), by: personaId, tick: world.clock.tick, result, ...extra });

  const pool = conIdOrNull ? world.conspiracies.filter((c) => c.id === conIdOrNull) : world.conspiracies;
  const live = pool.filter((c) => !c.exposed);
  if (!live.length) {
    file('Nothing turned up — not the same as nothing being there.');
    log(world, 'intrigue', `${investigator?.name} opens an investigation. Nothing surfaces.`, { actors: [personaId] });
    return { ok: true, value: { found: false, note: 'Nothing turns up.' } };
  }

  const target = live.slice().sort((a, b) => b.exposure - a.exposure)[0];
  const roll = rng(world) * 100;

  if (roll > target.exposure) {
    target.exposure = clamp(target.exposure + 3, 0, 100);
    file('Nothing on the record yet. The trail is warmer.', { conId: target.id, roll, exposure: target.exposure });
    log(world, 'intrigue', `${investigator?.name} opens an investigation. Nothing on the record.`, { actors: [personaId] });
    return { ok: true, value: { found: false, note: 'Nothing on the record. Yet.' } };
  }

  const frag = target.traces.filter((t) => t.kind === 'fragment').at(-1) || target.traces.at(-1);
  target.leaked = target.leaked || [];
  if (frag) target.leaked.push(frag.id);
  const partial = target.exposure < 55;
  if (!partial) {
    target.exposed = true;
    file(`Exposed “${target.name}”: ${target.members.map((m) => world.personas[m]?.name).join(', ')}.`, { conId: target.id, roll, exposure: target.exposure });
    log(world, 'intrigue', `${investigator?.name}'s investigation exposes “${target.name}”: ${target.members.map((m) => world.personas[m]?.name).join(', ')}.`, { actors: [personaId, ...target.members], weight: 4 });
    for (const m of target.members) {
      const p = world.personas[m];
      if (p) { nudgeApproval(p, -22); p.reputation -= 2; }
    }
    nudgeMoodAll(world, -2);
  } else {
    file(`Surfaced a fragment, no names: “${(frag?.text || '').slice(0, 70)}…”`, { conId: target.id, roll, exposure: target.exposure });
    log(world, 'intrigue', `An investigation surfaces a fragment: “${(frag?.text || '').slice(0, 140)}”. No names.`, { actors: [personaId], weight: 3 });
  }
  return { ok: true, value: { found: true, full: !partial, fragment: frag?.text, conspiracy: partial ? null : target } };
}

/** A deliberate leak — cheaper than an investigation, and traceable to you. */
export function leak(world, conId, personaId, toOutletId) {
  const c = world.conspiracies.find((x) => x.id === conId);
  if (!c || !c.members.includes(personaId)) return { ok: false, reason: 'You are not in that room.' };
  c.exposed = true;
  c.leakedBy = personaId;
  const others = c.members.filter((m) => m !== personaId);
  for (const m of others) nudgeApproval(world.personas[m], -25);
  const self = world.personas[personaId];
  if (self) { nudgeApproval(self, -5); self.reputation -= 1; }
  log(world, 'intrigue', `“${c.name}” is leaked from the inside. Named: ${others.map((m) => world.personas[m]?.name).join(', ')}.`,
    { actors: c.members, weight: 4 });
  return { ok: true };
}

// --- Spies — covert personas with exposure risk, in place of alt accounts ---

export const MISSIONS = {
  observe: { label: 'Observe a chamber', risk: 6, blurb: 'Learn how a seated persona intends to vote.' },
  copy: { label: 'Copy a document', risk: 14, blurb: 'Obtain a draft not yet on the floor.' },
  plant: { label: 'Plant evidence', risk: 26, blurb: 'Leave a trace implicating someone else. It will be found.' },
  sabotage: { label: 'Sabotage a project', risk: 30, blurb: 'Halt a construction project and burn the money spent.' },
  turn: { label: 'Turn an officeholder', risk: 34, blurb: 'Try to recruit a seated persona into a conspiracy.' },
};

export function runAgent(world, { ownerPersonaId, coverName }) {
  world.spies = world.spies || [];
  if (world.spies.some((s) => s.ownerPersonaId === ownerPersonaId && s.active))
    return { ok: false, reason: 'You already run an agent. One cover at a time.' };
  // The head of government does not run a private agent. The whole apparatus of
  // the state already answers to them — an agent of their own is not a covert
  // asset, it is the executive spying on the republic with deniability, and the
  // exposure risk that makes the mechanic a gamble for everyone else costs them
  // nothing they cannot pardon.
  if (ownerPersonaId && ownerPersonaId === headId(world)) {
    const eo = execOffice(world);
    return {
      ok: false,
      reason: `The ${eo?.name || 'head of government'} does not run agents. The state's apparatus answers to you; covert work needs somebody you can disown.`,
    };
  }
  const s = {
    id: uid('spy'), ownerPersonaId, coverName: coverName || 'The Courier',
    exposure: 8, active: true, missions: [], created: world.clock.tick,
  };
  world.spies.push(s);
  return { ok: true, value: s };
}

export function mission(world, spyId, kind, targetId) {
  const s = (world.spies || []).find((x) => x.id === spyId);
  if (!s || !s.active) return { ok: false, reason: 'No active agent.' };
  const m = MISSIONS[kind];
  if (!m) return { ok: false, reason: 'No such mission.' };

  const caught = rng(world) * 100 < s.exposure;
  s.exposure = clamp(s.exposure + m.risk * (0.6 + rng(world) * 0.8), 0, 100);
  const rec = { id: uid('ms'), kind, targetId, tick: world.clock.tick, caught, result: null };
  s.missions.push(rec);

  if (caught) {
    s.active = false; s.burned = world.clock.tick;
    const owner = world.personas[s.ownerPersonaId];
    if (owner) { nudgeApproval(owner, -14); owner.reputation -= 2; }
    log(world, 'intrigue', `${s.coverName} is taken. Under questioning the name ${owner?.name} is given.`,
      { actors: [s.ownerPersonaId], weight: 4 });
    return { ok: true, value: { ...rec, note: 'Burned. Your name is in the record now.' } };
  }

  let note = '';
  if (kind === 'observe') {
    const p = world.personas[targetId];
    const lean = p ? (p.approval > 55 ? 'with the government' : 'against it') : 'unclear';
    note = p ? `${p.name} is expected to vote ${lean}. Approval reads ${Math.round(p.approval)}.` : 'The chamber was empty.';
  } else if (kind === 'copy') {
    const drafts = Object.values(world.documents).filter((d) => d.status === 'draft');
    const d = drafts.length ? pick(world, drafts) : null;
    note = d ? `Draft obtained: “${d.title}” — ${d.clauses.length} clause(s). ${d.clauses.map((c) => c.kind).join(', ')}.` : 'No drafts worth copying.';
  } else if (kind === 'plant') {
    const target = world.conspiracies.find((c) => !c.members.includes(s.ownerPersonaId));
    if (target) {
      target.traces.push({ id: uid('tr'), kind: 'fragment', tick: world.clock.tick, text: `A note in an unfamiliar hand naming ${world.personas[targetId]?.name || 'a member of the government'}.`, planted: true, weight: 14 });
      target.exposure = clamp(target.exposure + 18, 0, 100);
      note = 'Planted. Whoever looks next will find it.';
    } else note = 'Nowhere to put it.';
  } else if (kind === 'sabotage') {
    const live = world.city.parcels.filter((p) => p.project);
    if (live.length) {
      const p = pick(world, live);
      note = `Construction halted. ${p.project.building} in district ${p.district}.`;
      log(world, 'crisis', `A construction site burns overnight. The project is a loss.`, { district: p.district, weight: 3 });
      p.project = null;
    } else note = 'Nothing under construction.';
  } else if (kind === 'turn') {
    const p = world.personas[targetId];
    const won = p && rng(world) < 0.45 + (50 - (p.approval || 50)) / 200;
    note = won ? `${p.name} will listen. Invite them to your room.` : `${p?.name || 'They'} refused, and remembers being asked.`;
    if (!won) nudgeApproval(p, 2);
    if (won) { world.turned = world.turned || []; world.turned.push(targetId); }
  }
  rec.result = note;
  world.intel.push({ id: uid('int'), spyId, owner: s.ownerPersonaId, text: note, tick: world.clock.tick, kind });
  return { ok: true, value: rec };
}

// --- Uprisings — adjudicated by a support check over a real-time window ----

/**
 * Public disapproval, 0..1 — the fuel a revolution recruits from. Driven by
 * unhappy streets (district mood) and joblessness. A content country starves a
 * movement; a miserable one is a recruiting poster.
 */
export function grievance(world) {
  const ds = (world.districts || []).filter((d) => !d.seceded);
  const avgMood = ds.length ? sum(ds, (d) => d.mood) / ds.length : 50;
  const streets = clamp((54 - avgMood) / 40, 0, 1);
  const jobs = clamp((world.economy?.unemployment || 0) * 3.5, 0, 1);
  return clamp(streets * 0.7 + jobs * 0.3, 0, 1);
}

// --- who is who ------------------------------------------------------------
export function execOffice(world) {
  return world.constitution.offices.find((o) => o.powers.includes('spend')) || world.constitution.offices[0];
}
/** The head of government — the person a revolt is against; cannot lead one. */
export function headId(world) {
  const eo = execOffice(world);
  const seat = eo && world.seats.find((s) => s.office === eo.id && s.personaId);
  return seat ? seat.personaId : null;
}
/** Serving officeholders who are not the head of government — the ministers. */
export function ministers(world) {
  const hid = headId(world);
  const set = new Set();
  for (const s of world.seats) if (s.personaId && s.personaId !== hid) set.add(s.personaId);
  return [...set];
}
export function isMinister(world, pid) {
  return pid !== headId(world) && R.officesOf(world, pid).length > 0;
}
function officeWeight(world, pid) {
  return sum(R.officesOf(world, pid), (o) =>
    o.powers.includes('command_military') ? 6 : o.powers.includes('spend') ? 3 : o.powers.includes('arrest') ? 2.5 : 1.5);
}

export function declareUprising(world, { leaderId, cause, kind = 'coup', districts = [] }) {
  if (world.uprising && !world.uprising.resolved) return { ok: false, reason: 'A rising is already under way.' };
  // A revolution can be led by anyone the government has failed — citizens and
  // ministers alike — but never by the head of government against themselves,
  // and it needs a real public grievance to catch.
  if (kind === 'revolution') {
    if (leaderId === headId(world))
      return { ok: false, reason: 'The head of government cannot revolt against themselves.' };
    if (grievance(world) < 0.2)
      return { ok: false, reason: 'The country is too content for a revolution. Let disapproval build first.' };
  }
  const u = {
    id: uid('up'), kind, leaderId, cause: cause || 'The government has forfeited its claim.',
    districts, opened: world.clock.tick, closes: world.clock.tick + 120,
    pledges: {}, rallies: {}, movement: kind === 'revolution' ? Math.round(grievance(world) * 80) : 0,
    grievance: grievance(world), resolved: null, outcome: null,
  };
  u.pledges[leaderId] = 'rising';
  world.uprising = u;
  nudgeMoodAll(world, -4);
  log(world, kind === 'secession' ? 'war' : 'crisis',
    kind === 'secession'
      ? `${world.personas[leaderId]?.name} declares the secession of ${districts.map((id) => world.districts.find((d) => d.id === id)?.name).join(', ')}. “${u.cause}”`
      : kind === 'revolution'
        ? `${world.personas[leaderId]?.name} calls the people into the streets against the government. “${u.cause}”`
        : `${world.personas[leaderId]?.name} raises a standard against the government. “${u.cause}”`,
    { actors: [leaderId], weight: 5 });
  return { ok: true, value: u };
}

/**
 * Each tick an open rising recruits from public disapproval — its movement
 * grows, fastest where the country is most miserable. This is what makes a
 * revolution a live thing that builds over its window rather than a coin-flip
 * tallied at the end.
 */
export function recruit(world) {
  const u = world.uprising;
  if (!u || u.resolved) return;
  const g = grievance(world);
  u.grievance = g;
  u.movement = u.movement || 0;
  const risers = Object.values(u.pledges).filter((s) => s === 'rising').length;
  const rate = g * (5 + risers * 2) * (u.kind === 'revolution' ? 1.25 : 0.8);
  u.movement = clamp(u.movement + rate, 0, 400);
  // A mobilised street is a restless one: sustained agitation nudges mood down,
  // which feeds the next tick's recruiting. Content districts damp it instead.
  if (g > 0.15) for (const d of world.districts) if (!d.seceded) nudgeMood(d, -0.06);
}

/** Take to the streets: a player throws in and actively swells the movement. */
export function rally(world, personaId) {
  const u = world.uprising;
  if (!u || u.resolved) return { ok: false, reason: 'No rising to rally to.' };
  const p = world.personas[personaId];
  if (p && (p.imprisoned || p.exiled)) return { ok: false, reason: 'You cannot rally from a cell.' };
  u.pledges[personaId] = 'rising';
  u.rallies = u.rallies || {};
  if (world.clock.tick - (u.rallies[personaId] ?? -999) < 8) return { ok: false, reason: 'Give the streets a moment to gather.' };
  u.rallies[personaId] = world.clock.tick;
  const gain = 18 + grievance(world) * 55;
  u.movement = clamp((u.movement || 0) + gain, 0, 400);
  log(world, 'crisis', `${p?.name} takes to the streets — the movement swells.`, { actors: [personaId], weight: 2 });
  return { ok: true, value: { gain: Math.round(gain) } };
}

// --- Plots — the secret phase a minister can organise before going loud ----
// A plot is kept quiet while it recruits fellow ministers. Every contact is a
// risk: an AI minister who is comfortable under the regime may refuse and carry
// word to the government; a real player must accept the invitation themselves,
// and can betray it. Two ways to cash it in: launch a public revolution (the
// cabal becomes immediate leverage) or strike a coup d'état (capture the head
// of government outright, the odds rising sharply with every minister aboard).

export function declarePlot(world, { leaderId, kind = 'revolution', cause }) {
  if (world.plot) return { ok: false, reason: 'You already have a plot under way.' };
  if (world.uprising && !world.uprising.resolved) return { ok: false, reason: 'A rising is already under way.' };
  if (leaderId === headId(world)) return { ok: false, reason: 'The head of government does not conspire against themselves.' };
  const plot = {
    id: uid('plot'), kind, leaderId, cause: cause || 'Enough.', secret: true,
    members: [leaderId], invited: {}, defenders: [], exposure: 6, forewarned: false,
    struck: null, created: world.clock.tick,
  };
  world.plot = plot;
  // No public chronicle entry — the whole point is that it is quiet.
  return { ok: true, value: plot };
}

/** Bring a minister into the plot. Returns how it went: joined/invited/refused/betrayed. */
export function recruitToPlot(world, recruiterId, targetId) {
  const plot = world.plot;
  if (!plot || plot.struck) return { ok: false, reason: 'No plot under way.' };
  if (!plot.members.includes(recruiterId)) return { ok: false, reason: 'You are not in on this.' };
  const target = world.personas[targetId];
  if (!target || !target.alive || target.imprisoned || target.exiled) return { ok: false, reason: 'Not someone you can reach.' };
  if (plot.members.includes(targetId)) return { ok: false, reason: 'Already sworn in.' };
  if (targetId === headId(world)) return { ok: false, reason: 'You do not sound out the person you mean to depose.' };
  if (!isMinister(world, targetId)) return { ok: false, reason: 'Only serving ministers can join the plot.' };
  plot.exposure = clamp(plot.exposure + 4 + plot.members.length * 1.2, 0, 100);

  // A real player is invited and must answer for themselves — the real risk.
  if (target.playerId) {
    plot.invited[targetId] = { by: recruiterId, tick: world.clock.tick };
    return { ok: true, value: { invited: true } };
  }

  // An AI minister decides now. Those doing well under the regime defend it; the
  // disaffected join; the comfortable-but-loyal may run to the government.
  const g = grievance(world);
  const head = world.personas[headId(world)];
  const stake = clamp(0.35 + (target.approval - 50) / 120 + (((head && head.approval) ?? 50) - 50) / 160, 0, 1);
  const appeal = clamp(0.28 + g * 0.6 + plot.members.length * 0.04 + officeWeight(world, recruiterId) * 0.02 - stake * 0.7, 0.02, 0.95);
  if (rng(world) < appeal) {
    plot.members.push(targetId);
    return { ok: true, value: { joined: true } };
  }
  const betray = rng(world) < clamp(stake * 0.7 + 0.1, 0.05, 0.9);
  if (betray) {
    plot.forewarned = true;
    plot.exposure = clamp(plot.exposure + 30, 0, 100);
    if (!plot.defenders.includes(targetId)) plot.defenders.push(targetId);
    log(world, 'intrigue', `${target.name} refuses and carries word to the government. The plot is compromised.`,
      { actors: [targetId, headId(world)].filter(Boolean), weight: 3 });
    return { ok: true, value: { betrayed: true } };
  }
  return { ok: true, value: { refused: true } };
}

/** A real player accepts an invitation into the plot. */
export function joinPlot(world, personaId) {
  const plot = world.plot;
  if (!plot || plot.struck) return { ok: false, reason: 'No plot to join.' };
  if (!plot.invited[personaId]) return { ok: false, reason: 'You were not asked.' };
  delete plot.invited[personaId];
  if (!plot.members.includes(personaId)) plot.members.push(personaId);
  return { ok: true };
}

/** A real player betrays the plot to the government. */
export function exposePlot(world, personaId) {
  const plot = world.plot;
  if (!plot || plot.struck) return { ok: false, reason: 'No plot to expose.' };
  const wasIn = plot.members.includes(personaId) || plot.invited[personaId];
  if (!wasIn) return { ok: false, reason: 'You know of no such plot.' };
  delete plot.invited[personaId];
  plot.members = plot.members.filter((m) => m !== personaId);
  plot.forewarned = true; plot.exposed = true;
  if (!plot.defenders.includes(personaId)) plot.defenders.push(personaId);
  log(world, 'intrigue', `${world.personas[personaId]?.name} betrays a plot to the government. The guard is forewarned.`,
    { actors: [personaId, headId(world)].filter(Boolean), weight: 3 });
  return { ok: true };
}

/** Go loud: the cabal becomes a public revolution with immediate leverage. */
export function launchRevolution(world, byId) {
  const plot = world.plot;
  if (!plot || plot.kind !== 'revolution') return { ok: false, reason: 'No revolution plot to launch.' };
  if (byId && byId !== plot.leaderId) return { ok: false, reason: 'Only the one who began it can launch it.' };
  if (world.uprising && !world.uprising.resolved) return { ok: false, reason: 'A rising is already under way.' };
  const leverage = sum(plot.members, (m) => officeWeight(world, m)) + plot.members.length * 8;
  const u = {
    id: uid('up'), kind: 'revolution', leaderId: plot.leaderId, cause: plot.cause,
    districts: [], opened: world.clock.tick, closes: world.clock.tick + 120,
    pledges: {}, rallies: {}, grievance: grievance(world), resolved: null, outcome: null,
    movement: Math.round(grievance(world) * 80 + leverage * (plot.forewarned ? 0.5 : 1) * 6),
  };
  for (const m of plot.members) u.pledges[m] = 'rising';
  for (const dpid of plot.defenders) u.pledges[dpid] = 'government'; // those who ran to the regime
  nudgeMoodAll(world, -4);
  world.uprising = u;
  world.plot = null;
  log(world, 'crisis', `${world.personas[u.leaderId]?.name} throws off the secrecy: ${u.pledges && Object.values(u.pledges).filter((s) => s === 'rising').length} declare a revolution. “${u.cause}”`,
    { actors: [u.leaderId], weight: 5 });
  return { ok: true, value: u };
}

/** The odds a coup succeeds — attackers vs the loyal ministers and the guard. */
export function coupOdds(world, plot = world.plot) {
  if (!plot) return null;
  const attackers = plot.members;
  const loyal = ministers(world).filter((pid) => !attackers.includes(pid));
  const atk = sum(attackers, (pid) => officeWeight(world, pid)) + attackers.length * 2 + 1;
  let def = sum(loyal, (pid) => officeWeight(world, pid)) + 4 + world.military.units * (1 - world.military.exhaustion * 0.5);
  if (plot.forewarned) def *= 1.4;
  const k = 2.2; // >1 makes each additional minister disproportionately decisive
  return { p: Math.pow(atk, k) / (Math.pow(atk, k) + Math.pow(def, k)), atk, def, attackers: attackers.length, loyal: loyal.length };
}

/** Strike: a decapitation attempt on the head of government. Resolved at once. */
export function strikeCoup(world, byId) {
  const plot = world.plot;
  if (!plot || plot.kind !== 'coup') return { ok: false, reason: 'No coup to strike.' };
  if (byId && byId !== plot.leaderId) return { ok: false, reason: 'Only the one who began it can give the order.' };
  const odds = coupOdds(world);
  const win = rng(world) < odds.p;
  // `|| 1` — read as a flag by recruitToPlot, joinPlot, exposePlot and the
  // secrecy test in tickIntrigue. A coup that fired on tick 0 stamped 0, read
  // as never fired, and stayed recruitable and exposable for ever.
  plot.struck = world.clock.tick || 1; plot.p = odds.p; plot.win = win;
  const eo = execOffice(world);
  const seat = world.seats.find((s) => s.office === eo.id);
  const leader = world.personas[plot.leaderId];
  if (win) {
    if (seat && seat.personaId) {
      const pres = world.personas[seat.personaId];
      vacate(world, seat, 'seized');
      if (pres) { pres.imprisoned = true; pres.charges = [...(pres.charges || []), 'deposed']; log(world, 'crisis', `${pres.name} is seized in the night. The palace changes hands.`, { actors: [pres.id], weight: 5 }); }
    }
    if (seat) { seat.personaId = plot.leaderId; seat.since = world.clock.tick; seat.termEnds = world.clock.tick + Math.round((eo.termYears || 4) * world.clock.ticksPerYear); }
    nudgeMoodAll(world, -3); // a coup unsettles the country
    log(world, 'crisis', `Coup d'état: ${leader?.name} takes the ${eo.name} with ${plot.members.length} minister(s), at ${Math.round(odds.p * 100)}% odds.`, { actors: [plot.leaderId, ...plot.members], weight: 5 });
  } else {
    for (const pid of plot.members) {
      const pp = world.personas[pid];
      if (!pp) continue;
      pp.imprisoned = true; pp.charges = [...(pp.charges || []), 'treason'];
      const st = R.seatOf(world, pid); if (st) vacate(world, st, 'treason');
    }
    nudgeApproval(world.personas[headId(world)], 6);
    log(world, 'court', `The coup fails at ${Math.round(odds.p * 100)}% odds. ${plot.members.length} plotter(s) seized for treason; ${head?.name || 'the head of government'} survives.`, { actors: plot.members, weight: 4 });
  }
  world.plotHistory = world.plotHistory || [];
  world.plotHistory.push(plot);
  world.plot = null;
  return { ok: true, value: { win, p: Math.round(odds.p * 100) } };
}

export function pledge(world, personaId, side) {
  const u = world.uprising;
  if (!u || u.resolved) return { ok: false, reason: 'Nothing to pledge to.' };
  // The one who raised the standard does not get to declare for anything. They
  // are already pledged — it happens the moment the rising is declared — and
  // "the government" is not a side available to the person being risen against.
  // Everyone else may declare, and may change their mind; that is the drama.
  if (personaId === u.leaderId) {
    return { ok: false, reason: side === 'rising'
      ? 'You are the rising. Nothing to declare.'
      : 'You raised this standard. You cannot declare for the government you rose against.' };
  }
  if (u.pledges[personaId] === side) {
    return { ok: false, reason: `You have already declared for the ${side === 'rising' ? 'rising' : 'government'}.` };
  }
  const turning = !!u.pledges[personaId];
  u.pledges[personaId] = side;
  const p = world.personas[personaId];
  log(world, 'crisis',
    `${p?.name} ${turning ? 'changes sides and declares' : 'declares'} for the ${side === 'rising' ? 'rising' : 'government'}.`,
    { actors: [personaId], weight: turning ? 3 : 2 });
  return { ok: true };
}

/** Which way does the country actually lean? Player allegiance, arms, sympathy. */
export function supportCheck(world) {
  const u = world.uprising;
  if (!u) return null;
  let rising = 0, loyal = 0;
  const detail = { players: { rising: 0, loyal: 0 }, offices: { rising: 0, loyal: 0 }, arms: { rising: 0, loyal: 0 }, citizens: { rising: 0, loyal: 0 }, movement: 0 };

  for (const [pid, side] of Object.entries(u.pledges)) {
    const p = world.personas[pid];
    if (!p || !p.alive) continue;
    const isPlayer = !!p.playerId;
    const weight = isPlayer ? 3 : 1;
    const offs = R.officesOf(world, pid);
    const officeWeight = sum(offs, (o) => (o.powers.includes('command_military') ? 6 : o.powers.includes('spend') ? 3 : 1.5));
    const contrib = weight + officeWeight;
    if (side === 'rising') { rising += contrib; detail.players.rising += weight; detail.offices.rising += officeWeight; }
    else { loyal += contrib; detail.players.loyal += weight; detail.offices.loyal += officeWeight; }
  }

  // The army goes with whoever commands it — unless morale says otherwise.
  const commander = world.seats.find((s) => R.office(world, s.office)?.powers.includes('command_military') && s.personaId);
  const cmdSide = commander ? u.pledges[commander.personaId] : null;
  const arms = world.military.units * (1 - world.military.exhaustion * 0.5);
  if (cmdSide === 'rising') { rising += arms; detail.arms.rising = arms; }
  else { loyal += arms; detail.arms.loyal = arms; }

  // Citizens go with their mood. An unhappy country is a recruiting poster.
  for (const d of world.districts) {
    const w = d.pop / 4000;
    const sympathy = clamp((52 - d.mood) / 30, -1, 1);
    if (sympathy > 0) { rising += w * sympathy * 3; detail.citizens.rising += w * sympathy * 3; }
    else { loyal += w * -sympathy * 3; detail.citizens.loyal += w * -sympathy * 3; }
  }
  // The movement recruited over the window — the mobilised base itself, on top
  // of the instantaneous sympathy above. This is where sustained disapproval
  // turns into decisive numbers.
  const mob = (u.movement || 0) * 0.12;
  rising += mob; detail.movement = mob;
  const total = rising + loyal || 1;
  return { rising, loyal, share: rising / total, detail };
}

export function resolveUprising(world) {
  const u = world.uprising;
  if (!u || u.resolved) return;
  const check = supportCheck(world);
  // Truthy, always — see the note in director.respond. Tick 0 is a real tick.
  u.resolved = world.clock.tick || 1;
  u.check = check;
  const won = check.share > 0.5;
  u.outcome = won ? 'rising' : 'government';

  if (u.kind === 'secession') {
    if (won) {
      world.breakaway = world.breakaway || [];
      world.breakaway.push({
        id: uid('bk'), name: `Free ${u.districts.map((id) => world.districts.find((d) => d.id === id)?.name).join(' & ')}`,
        districts: u.districts, leaderId: u.leaderId, founded: world.clock.tick,
        constitution: JSON.parse(JSON.stringify(world.constitution)),
      });
      for (const id of u.districts) {
        const d = world.districts.find((x) => x.id === id);
        if (d) { d.seceded = true; d.mood = 62; }
      }
      log(world, 'war', `The secession holds. ${u.districts.length} state(s) leave ${world.nation} with one of their own.`, { actors: [u.leaderId], weight: 5 });
    } else {
      punish(world, u);
      log(world, 'war', `The secession is put down. The districts are reoccupied.`, { weight: 4 });
    }
  } else if (won) {
    // The rising takes the offices. Nobody is removed from the game.
    const leader = world.personas[u.leaderId];
    const exec = world.constitution.offices.find((o) => o.powers.includes('spend')) || world.constitution.offices[0];
    const seat = world.seats.find((s) => s.office === exec.id);
    if (seat) {
      if (seat.personaId) {
        const ousted = world.personas[seat.personaId];
        vacate(world, seat, 'deposed');
        if (ousted) { ousted.exiled = true; log(world, 'death', `${ousted.name} is deposed and flees into exile.`, { actors: [ousted.id], weight: 4 }); }
      }
      seat.personaId = u.leaderId;
      seat.since = world.clock.tick;
      seat.termEnds = world.clock.tick + Math.round((exec.termYears || 4) * world.clock.ticksPerYear);
    }
    const boost = u.kind === 'revolution' ? 8 : 4;
    nudgeMoodAll(world, boost);
    log(world, 'crisis',
      u.kind === 'revolution'
        ? `The revolution wins. ${leader?.name} takes the ${exec.name} on ${Math.round(check.share * 100)}% support, a movement ${Math.round(u.movement || 0)} strong.`
        : `The rising succeeds. ${leader?.name} takes the ${exec.name}. Support: ${Math.round(check.share * 100)}%.`,
      { actors: [u.leaderId], weight: 5 });
  } else {
    punish(world, u, u.kind === 'revolution' ? 'leader' : 'all');
    log(world, 'crisis',
      u.kind === 'revolution'
        ? `The revolution breaks at ${Math.round(check.share * 100)}% support. ${world.personas[u.leaderId]?.name} is seized; the crowds disperse.`
        : `The rising fails at ${Math.round(check.share * 100)}% support. The government holds.`,
      { weight: 4 });
  }
  world.uprisingHistory = world.uprisingHistory || [];
  world.uprisingHistory.push(u);
}

function punish(world, u, scope = 'all') {
  for (const [pid, side] of Object.entries(u.pledges)) {
    if (side !== 'rising') continue;
    // A broken popular revolution jails its leader; the crowds just melt away.
    if (scope === 'leader' && pid !== u.leaderId) continue;
    const p = world.personas[pid];
    if (!p) continue;
    p.imprisoned = true;
    p.charges = [...(p.charges || []), 'sedition'];
    const seat = R.seatOf(world, pid);
    if (seat) vacate(world, seat, 'sedition');
    log(world, 'court', `${p.name} is imprisoned for sedition. The character is in a cell; the player is at the table.`, { actors: [pid], weight: 2 });
  }
}

export function tickIntrigue(world) {
  // Traces cool, but never quite to zero.
  for (const c of world.conspiracies) {
    if (!c.exposed) c.exposure = clamp(c.exposure - 0.05, 2, 100);
  }
  for (const s of world.spies || []) {
    if (s.active) s.exposure = clamp(s.exposure - 0.12, 3, 100);
  }
  if (world.uprising && !world.uprising.resolved) {
    recruit(world); // the movement grows from disapproval every tick
    if (world.clock.tick >= world.uprising.closes) resolveUprising(world);
  }
  // A secret plot leaks over time — the more mouths, the faster. Sit on it too
  // long and the government is forewarned even without a betrayal.
  if (world.plot && world.plot.secret && !world.plot.struck) {
    const pl = world.plot;
    pl.exposure = clamp(pl.exposure + 0.15 + pl.members.length * 0.15, 0, 100);
    if (!pl.forewarned && pl.exposure >= 72) {
      pl.forewarned = true;
      log(world, 'intrigue', 'Word of a plot reaches the government. No names — but the guard is doubled.', { weight: 3 });
    }
  }
}

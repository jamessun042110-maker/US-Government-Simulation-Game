// The single write path into the world.
//
// Clients never mutate state. They dispatch an action; the host applies it here
// and republishes. Every rejection comes back with the reason — usually a
// sentence of the constitution.

import { uid, clamp, money, moneyExact, bareNation, PALETTE, nudgeMoodAll, nudgeApproval, youthOf, YOUTH_APPROVAL, POLITICAL_BASE_AGE } from './util.js';
import { log, annotate, canonDate, canonSpan, regnal, reviseBio } from './chronicle.js';
import * as R from './rules.js';
import * as A from './acts.js';
import * as M from './media.js';
import * as I from './intrigue.js';
import * as D from './director.js';
import * as CT from './court.js';
import * as CONDUCT from './conduct.js';
import * as DEP from './depts.js';
import * as MACRO from './macro.js';
import * as CO from './company.js';
import { makePersona, fillVacantSeats, recomputeEconomy, reshapeDistricts, assignDistrictSeats, BUILDINGS, PARTIES, collegeById, personName } from './world.js';
import { nominate, castBallot, sealBallot, endSeason, endorse } from './sim.js';

function notice(world, playerId, text, tone = 'error') {
  world.notices = world.notices || [];
  world.notices.push({ id: uid('nt'), playerId, text, tone, ts: Date.now() });
  if (world.notices.length > 60) world.notices.shift();
}
const need = (world, a, res) => {
  if (res && res.ok === false) { notice(world, a.playerId, res.reason); return false; }
  return true;
};
const meP = (world, a) => world.players[a.playerId]?.personaId;

/** What a room is called in a sentence. */
const roomName = (world, room) =>
  (room === 'oval' ? 'the Oval Office' : `the ${R.office(world, room)?.name || room}'s department`);

/**
 * Ask somebody into a closed room.
 *
 * The offer waits for an answer, which is the point of it — but only where
 * there is somebody to give one. A synthetic persona has nobody at a keyboard
 * to click Accept, so it accepts on the spot and simply turns up; making the
 * engine's own citizens sit in a queue nobody could clear would have quietly
 * broken every invitation to a non-player, which is most of them.
 */
function inviteToRoom(world, room, byPersonaId, personaId, byPlayerId) {
  if (!personaId) return;
  const target = world.personas[personaId];
  if (!target) return;
  const admitted = room === 'oval'
    ? R.ovalByOffice(world, personaId)
    : R.deptByOffice(world, personaId, room);
  if (admitted) return notice(world, byPlayerId, `${target.name} holds a key to that room already.`);

  const list = R.roomInvites(world, room);
  const prior = list.find((g) => g.id === personaId);
  const auto = !target.playerId;
  const entry = { id: personaId, at: world.clock.tick, acceptedAt: auto ? world.clock.tick : null };
  R.setRoomInvites(world, room, [...list.filter((g) => g.id !== personaId), entry]);

  if (auto && !prior) {
    log(world, 'office', `${target.name} is admitted to ${roomName(world, room)}.`,
      { actors: [byPersonaId, personaId], weight: 1 });
  }
  if (target.playerId) {
    notice(world, target.playerId,
      `${world.personas[byPersonaId]?.name || 'The chair'} invites you into ${roomName(world, room)}. `
      + `Answer within ${R.INVITE_ANSWER_MONTHS} month or it lapses; accepting opens the room for ${R.OVAL_INVITE_MONTHS}.`,
      'ok');
  }
}

// How long between national surveys. The map is the one picture everybody at
// the table has been reading all Season; redrawing it on a whim is disorienting
// rather than interesting.
export const MAP_REDRAW_YEARS = 2;

// The fastest the solo clock will run. 8x was in here briefly and it was too
// much: a term went by while you were reading one crisis card.
const MAX_TIMESCALE = 4;

// Seat a persona in an office, setting the term correctly: at-will posts have no
// term, a termFollows office serves out the term of the office it shadows, others
// get a fresh term.
// Moved to acts.js alongside vacate() and appoint(), so the engine's one way
// into a seat is not locked inside this file's action handlers.
const seatInOffice = A.seatInOffice;

// A player name is taken if any *other* player at the table already answers to
// it, case- and whitespace-insensitively — "James Sun" and "james  sun" clash.
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function nameTaken(world, name, exceptPlayerId) {
  const n = normName(name);
  if (!n) return false;
  return Object.values(world.players).some((p) => p.id !== exceptPlayerId && normName(p.name) === n);
}

/**
 * The persona a returning player should be handed back.
 *
 * A reload is indistinguishable from leaving and arriving again: `pagehide`
 * dispatches LEAVE, removePlayer hands the persona to the republic, and the
 * JOIN a second later used to mint a brand new one. So the table filled up
 * with identical James Suns — the old one still holding the chair, still in
 * the Chronicle, still the one the seats point at — and every lookup by
 * playerId quietly missed the person actually at the keyboard.
 *
 * Two ways back in, in order of confidence:
 *   the same client id, which sessionStorage keeps across a reload; then
 *   the same name, which is how somebody on a new device says who they are.
 *
 * Only personas that have actually been played are eligible — an NPC who
 * happens to have rolled your name is not you — and only ones nobody is
 * holding right now. A persona who died while you were gone is not offered
 * back; that is a new life, and the republic already wrote the obituary.
 *
 * Eligibility is `everPlayer` (stamped by makePersona, never removed) rather
 * than the `wasPlayer` note removePlayer leaves on the way out. The note
 * carries the colour and the gavel and is the better match when it is there —
 * but a persona orphaned by a crash, a pruned heartbeat, or a build predating
 * this fix has no note at all. The durable mark is the one that decides.
 */
/**
 * Recover the mark on personas minted before makePersona started leaving one.
 *
 * A Season founded under older code has orphans with neither `everPlayer` nor
 * a `wasPlayer` note, and no amount of care at JOIN can guess which of the
 * thirty-odd personas in a republic used to have somebody behind it. But the
 * Chronicle knows: JOIN writes "<name> arrives in <nation>" against the new
 * persona's id and writes it for nobody else. That line is an exact, permanent
 * list of every persona ever created for a player, and reading it back is the
 * difference between fixing this for new Seasons and fixing it for the one
 * actually being played.
 *
 * Cheap, idempotent, and only ever adds the mark.
 */
export function repairPersonaMarks(world) {
  for (const e of world.chronicle || []) {
    if (e.kind !== 'founding' || !/ arrives in /.test(e.text || '')) continue;
    for (const id of e.actors || []) {
      const p = world.personas?.[id];
      if (p) p.everPlayer = true;
    }
  }
}

export function reclaimable(world, playerId, name) {
  repairPersonaMarks(world);
  const held = new Set(Object.values(world.players).map((p) => p.personaId));
  const free = Object.values(world.personas || {})
    .filter((p) => (p.everPlayer || p.wasPlayer) && !held.has(p.id) && p.alive !== false);
  if (!free.length) return null;
  const n = normName(name);
  return free.find((p) => p.wasPlayer?.id === playerId)
    || (n ? free.find((p) => normName(p.name) === n) : null)
    || null;
}

// Rooms the whole republic can read. Anything else — the Oval Office, chambers,
// a conspiracy's channel — is closed, and a line said there does not reach the
// districts. It is still on the record of the room, and the court can read it.
const PUBLIC_ROOMS = new Set(['floor']);

/**
 * What it costs to say it out loud.
 *
 * The conduct floor prices a headline by taking the paper's credibility and a
 * bill by turning the chamber against it. Speech has no ledger of its own, so
 * the price lands on the speaker: their standing, their reputation, and — said
 * in the open — the mood of every district that heard it. In every room the
 * line is written onto the speaker's own record, which is what the court reads
 * when somebody brings an action over it.
 */
function sayingIt(world, a, personaId, channel, grounds) {
  const p = world.personas[personaId];
  if (!p) return;
  const open = PUBLIC_ROOMS.has(channel);

  p.saidDisrepute = p.saidDisrepute || [];
  p.saidDisrepute.push({ tick: world.clock.tick, date: canonDate(world), channel, grounds });
  if (p.saidDisrepute.length > 20) p.saidDisrepute.shift();

  nudgeApproval(p, -(open ? 9 : 3));
  p.reputation = clamp((p.reputation || 0) - (open ? 1.5 : 0.6), -10, 10);

  if (open) {
    nudgeMoodAll(world, -3);
    log(world, 'press', `${regnal(p)} says it on the floor, in the record, in front of everyone: ${grounds[0]}.`,
      { actors: [personaId], weight: 3 });
    notice(world, a.playerId, `On the record. ${grounds[0]}. The states heard it, your standing is down, and anyone may use it.`, 'error');
  } else {
    notice(world, a.playerId, `Not printed, but on this room's record. ${grounds[0]}. A closed room is not a private one.`, 'error');
  }
}

export const HANDLERS = {
  JOIN(world, a) {
    if (world.players[a.playerId]) {
      const p = world.personas[world.players[a.playerId].personaId];
      if (p && a.name && p.name !== a.name) {
        if (nameTaken(world, a.name, a.playerId)) return notice(world, a.playerId, `The name “${a.name}” is already taken at this table.`);
        p.name = a.name;
        world.players[a.playerId].name = a.name;
      }
      return;
    }
    // Before minting anybody: is this somebody coming back? A reload takes this
    // exact path, and for four handoffs it took it all the way to makePersona.
    const back = reclaimable(world, a.playerId, a.name);
    if (back) {
      // Absent when the persona was orphaned by a crash or by older code —
      // reclaimable() takes those too, on the durable `everPlayer` mark.
      const was = back.wasPlayer || {};
      back.playerId = a.playerId;
      back.synthetic = false;
      back.everPlayer = true;
      delete back.wasPlayer;
      // A returning player may rename themselves on the way in, but not into a
      // name somebody at the table is already using.
      if (a.name && normName(a.name) !== normName(back.name) && !nameTaken(world, a.name, a.playerId)) {
        back.name = a.name;
      }
      world.players[a.playerId] = {
        id: a.playerId, name: back.name,
        color: was.color || PALETTE[Object.keys(world.players).length % PALETTE.length],
        personaId: back.id, joined: Date.now(),
        // removePlayer hands moderation to whoever was still here. Taking it
        // back would leave the table with two; only reclaim it if it went
        // nowhere, which is the case when you were the only one at the table.
        moderator: !!was.moderator && !Object.values(world.players).some((p) => p.moderator),
      };
      log(world, 'system', `${back.name} returns to the table.`, { actors: [back.id], weight: 1 });
      return;
    }
    // Two James Suns cannot sit at the same table. The engine is the authority;
    // the join screen also checks, but this is what actually enforces it.
    if (a.name && nameTaken(world, a.name, a.playerId)) {
      world.rejoin = world.rejoin || {};
      world.rejoin[a.playerId] = { reason: `The name “${a.name}” is already taken. Choose another.`, ts: Date.now() };
      return notice(world, a.playerId, `The name “${a.name}” is already taken at this table.`);
    }
    // A citizen may already be walking around under this name, and the player's
    // name wins.
    //
    // `nameTaken` above only compares against other *players*, which was enough
    // while the citizenry drew on invented first names — nobody was ever going
    // to be dealt "James Sun". The names are American now and drawn from lists
    // that contain exactly the names players use, so a synthetic citizen can be
    // born holding one, and the republic ended up with two people of that name:
    // the Chronicle wrote about both, and a reload could hand the seat to the
    // wrong one.
    //
    // The citizen is renamed rather than the player refused. A generated name is
    // arbitrary and there are two thousand others; the player's is not.
    if (a.name) {
      const want = normName(a.name);
      for (const p of Object.values(world.personas)) {
        if (p.synthetic && !p.playerId && normName(p.name) === want) p.name = personName(world);
      }
    }
    const idx = Object.keys(world.players).length;
    const persona = makePersona(world, { name: a.name || `Founder ${idx + 1}`, playerId: a.playerId, party: a.party });
    persona.bio = 'Founder.';
    // What the founding screen's advanced panel chose. Anything it did not
    // choose keeps the roll makePersona already made.
    if (a.age != null) {
      persona.age = clamp(Math.round(+a.age), POLITICAL_BASE_AGE, 100);
      // The youth bump is keyed to age (world.makePersona), so a chosen age
      // resets that baseline before the college goodwill below layers on.
      persona.approval = clamp(50 + YOUTH_APPROVAL * youthOf(world, persona), 0, 100);
    }
    if (a.gender) persona.gender = a.gender;
    if (a.college) {
      persona.college = a.college;
      // A grander college opens with the country's goodwill and the treasury's
      // confidence. Small, and paid for elsewhere — see media.priorAffinity for
      // what it costs, and sim.voteOn for the classmates it does not buy you.
      const col = collegeById(a.college);
      if (col && idx === 0) {
        persona.approval = clamp(persona.approval + (col.prestige - 1) * 2, 0, 100);
        world.economy.treasury += (col.prestige - 1) * 2.5e6;
        recomputeEconomy(world);
      }
    }
    // The state the founding screen chose. Set *before* assignHomeDistricts,
    // which deals a district to anyone who has not got one — it leaves a
    // persona that already has one alone, so a chosen home state survives it and
    // an unchosen one is still dealt somewhere.
    if (a.homeState) {
      const home = world.districts.find((d) => d.id === a.homeState || d.name === a.homeState);
      if (home) persona.district = home.id;
    }
    // Someone arriving into a Season already under way still has to be from
    // somewhere, or they can never stand in a district race. The founding does
    // this for everyone at once; this covers the latecomer.
    if (world.phase !== 'convention') assignHomeDistricts(world);
    world.players[a.playerId] = {
      id: a.playerId, name: a.name || `Founder ${idx + 1}`,
      color: PALETTE[idx % PALETTE.length], personaId: persona.id,
      joined: Date.now(), moderator: idx === 0 || !!a.moderator,
    };
    log(world, 'founding', `${persona.name} arrives in ${world.nation}.`, { actors: [persona.id] });
  },

  SET_NAME(world, a) {
    const pl = world.players[a.playerId];
    if (!pl) return;
    if (nameTaken(world, a.name, a.playerId)) return notice(world, a.playerId, `The name “${a.name}” is already taken at this table.`);
    pl.name = a.name;
    const p = world.personas[pl.personaId];
    if (p) p.name = a.name;
  },

  // --- convention ---------------------------------------------------------
  SET_CONSTITUTION(world, a) {
    if (world.phase !== 'convention') return notice(world, a.playerId, 'The convention has adjourned. Amend instead.');
    // The constitution is the spine of the world: rules.offices, every seat,
    // every power and every gate reads it. This assigned whatever arrived and
    // then read it, so a malformed action — and actions arrive from other tabs
    // over the transport, not from a button — left `world.constitution` as null
    // or a string, wiped `world.seats`, and made every later call to
    // rules.offices throw. The wreck ticked on and serialised to storage quite
    // happily, so it was republished to every other tab as well.
    //
    // Validated before anything is touched, and refused whole.
    const c = a.constitution;
    const usable = c && typeof c === 'object' && !Array.isArray(c)
      && Array.isArray(c.offices) && c.offices.length > 0
      && c.offices.every((o) => o && typeof o === 'object' && typeof o.id === 'string' && o.id);
    if (!usable) return notice(world, a.playerId, 'That is not a constitution this republic can be founded on.');
    world.constitution = c;
    // The Season wears its regime's colour; switching templates re-dyes it.
    const t = R.templateById(world.constitution.template);
    if (t?.color) { world.brand = t.color; world.brandHi = t.colorHi; }
    world.seats = [];
    for (const o of world.constitution.offices) {
      for (let s = 0; s < o.seats; s++) {
        world.seats.push({
          id: `${o.id}#${s + 1}`, office: o.id, index: s, personaId: null,
          district: o.electorate === 'district' ? world.districts[s % world.districts.length].id : null,
          termEnds: null, since: null,
        });
      }
    }
    // A founder who had chosen a chair keeps it wherever the same office still
    // exists in the new system — so toggling templates does not silently
    // un-seat people who already committed.
    for (const pl of Object.values(world.players)) {
      if (!pl.seatChoice) continue;
      const seat = world.seats.find((s) => s.office === pl.seatChoice && !s.personaId);
      if (seat) seat.personaId = pl.personaId;
    }
    // Every remaining chair is filled with a named citizen, for every system —
    // not just the one the world happened to open on. Switching templates no
    // longer wipes the names off the positions.
    fillVacantSeats(world);
    // The document just changed under everyone: any "I'm ready" now referred to
    // a constitution that no longer exists, so it is withdrawn.
    clearReady(world);
  },

  SEAT_SELF(world, a) {
    // During the convention, founders take the chairs they mean to hold —
    // first come, first served, and binding. A chair another founder has
    // already claimed cannot be taken from them.
    if (world.phase !== 'convention') return notice(world, a.playerId, 'Seats are filled by election now, not by choice.');
    const pid = meP(world, a);
    const seat = world.seats.find((s) => s.id === a.seatId);
    if (!seat) return;
    const holder = seat.personaId ? world.personas[seat.personaId] : null;
    if (holder && holder.playerId && holder.playerId !== a.playerId)
      return notice(world, a.playerId, `The ${R.office(world, seat.office)?.name || 'chair'} is taken by ${holder.name}. First come, first served.`);
    // Old enough for it. The convention is the one route into a chair that did
    // not pass through mayHoldAgain — every other one goes through a nomination
    // or a ballot — so a founder who set their age to 26 could simply take the
    // presidency at the founding, and the constitution they had just written
    // said thirty-five.
    const oldEnough = R.eligibleByAge(world, pid, seat.office);
    if (!oldEnough.ok) return notice(world, a.playerId, oldEnough.reason, 'bad');
    // Leave the chair you were in; it goes back to a seated citizen.
    for (const s of world.seats) if (s.personaId === pid) s.personaId = null;
    seat.personaId = pid;
    // Taking a district chair is declaring where you are from. The seat is
    // filled by the people who live there, so claiming it makes that district
    // your home — and keeps you on your own ballot come the election.
    if (seat.district && world.personas[pid]) world.personas[pid].district = seat.district;
    const pl = world.players[a.playerId];
    if (pl) pl.seatChoice = seat.office; // remembered across template switches
    fillVacantSeats(world); // refill the chair you vacated with a citizen
    // Who holds which office is part of what the founders consent to, so a seat
    // changing hands stands everyone back down to ready up again.
    clearReady(world);
  },

  // Ready-up: an explicit, revocable "I'm ready to begin" from one founder.
  // The Season starts only once every living founder has readied, so no one is
  // dropped into a running game they never agreed to start. Changing a seat or
  // the constitution voids the standing consent (see SET_CONSTITUTION /
  // SEAT_SELF), so you always ready up to the government you actually see.
  READY(world, a) {
    if (world.phase !== 'convention') return;
    const pl = world.players[a.playerId];
    if (!pl) return;
    pl.lastSeen = Date.now();
    const want = a.ready === undefined ? !pl.ready : !!a.ready;
    if (want) {
      // You cannot vouch you're ready before you hold a chair and the document
      // is at least minimally coherent — otherwise "ready" would mean nothing.
      const gate = readyGate(world);
      if (!gate.ok) return notice(world, a.playerId, gate.reason);
    }
    pl.ready = want;
    if (allReady(world)) beginSeason(world);
  },

  // Kept for the moderator / solo "force" path and any external caller: a
  // forced ratify begins the Season outright, and an ordinary one is just a
  // ready-up under a different name.
  RATIFY(world, a) {
    if (world.phase !== 'convention') return;
    const gate = readyGate(world);
    if (!gate.ok) return notice(world, a.playerId, gate.reason);
    const pl = world.players[a.playerId];
    if (pl) { pl.ready = true; pl.lastSeen = Date.now(); }
    if (a.force || allReady(world)) beginSeason(world);
  },

  // --- documents ----------------------------------------------------------
  CREATE_DOC(world, a) {
    const pid = meP(world, a);
    // Actions arrive from other tabs over the transport and are applied straight
    // to the world, so the shape of one is not something a button guarantees.
    // Without this, a CREATE_DOC with no `doc` threw a TypeError out of the
    // handler instead of being refused like any other bad request.
    if (!a.doc || typeof a.doc !== 'object') return notice(world, a.playerId, 'There is nothing drafted to file.');
    const may = R.mayPropose(world, pid, a.doc.type);
    if (!may.ok && a.introduce) return notice(world, a.playerId, may.reason);
    const doc = A.createDoc(world, { ...a.doc, authorId: pid });
    // The conduct floor refuses a document outright; nothing is filed.
    if (doc && doc.ok === false) return notice(world, a.playerId, doc.reason);
    if (a.introduce) {
      const res = A.introduce(world, doc.id, pid, a.floorTicks || 45);
      if (!res.ok) { doc.status = 'draft'; notice(world, a.playerId, res.reason); }
      else notice(world, a.playerId, `“${doc.title}” is on the floor.`, 'ok');
    }
  },
  UPDATE_DOC(world, a) {
    const doc = world.documents[a.docId];
    if (!doc || doc.status !== 'draft') return;
    if (doc.authorId !== meP(world, a)) return notice(world, a.playerId, 'Not your draft.');
    Object.assign(doc, a.patch);
  },
  INTRODUCE(world, a) {
    const res = A.introduce(world, a.docId, meP(world, a), a.floorTicks || 45);
    need(world, a, res) && notice(world, a.playerId, 'Laid before the chamber.', 'ok');
  },
  VOTE(world, a) { need(world, a, A.castVote(world, a.docId, meP(world, a), a.ballot)); },
  CLOSE_FLOOR(world, a) {
    const doc = world.documents[a.docId];
    if (!doc) return;
    const may = R.mayCloseFloor(world, meP(world, a), doc);
    if (!may.ok) return notice(world, a.playerId, may.reason);
    need(world, a, doc.status === 'override' ? A.closeOverride(world, a.docId) : A.closeFloor(world, a.docId));
  },
  SIGN(world, a) { need(world, a, A.sign(world, a.docId, meP(world, a))); },
  VETO(world, a) { need(world, a, A.veto(world, a.docId, meP(world, a))); },
  OVERRIDE(world, a) { need(world, a, A.openOverride(world, a.docId, meP(world, a))); },
  STRIKE(world, a) { need(world, a, A.strikeDown(world, a.docId, meP(world, a), a.reason)); },

  // --- the court ----------------------------------------------------------
  // A justice decides a case that is before the bench. The court hands down its
  // judgment on its own once every justice has voted, or once argument closes.
  COURT_VOTE(world, a) {
    const res = CT.castOpinion(world, a.caseId, meP(world, a), a.vote, a.opinion);
    need(world, a, res) && notice(world, a.playerId, 'Your vote is entered.', 'ok');
  },
  // A justice puts a law before the full bench rather than striking it alone.
  COURT_TAKE_UP(world, a) {
    const res = CT.takeUp(world, a.docId, meP(world, a), a.reason);
    need(world, a, res) && notice(world, a.playerId, 'The case is on the docket.', 'ok');
  },
  // One person brings an action against another, and the other answers it.
  // Named SUE_PERSON, not SUE: SUE is already the libel action against an
  // outlet, and a duplicate key in this object silently replaces the earlier one.
  SUE_PERSON(world, a) {
    const res = CT.fileSuit(world, meP(world, a), a.personaId, a.claim, a.pleading);
    need(world, a, res) && notice(world, a.playerId, 'Your action is filed.', 'ok');
  },
  COURT_ANSWER(world, a) {
    const res = CT.answerSuit(world, a.caseId, meP(world, a), a.text);
    need(world, a, res) && notice(world, a.playerId, 'Your answer is on the record.', 'ok');
  },
  // Speak in the closed hearing for one case. Access is checked in the engine,
  // not merely hidden in the UI — a private room has to actually be private.
  COURT_SPEAK(world, a) { need(world, a, CT.speakInChamber(world, a.caseId, meP(world, a), a.text)); },

  // --- treasury & city ----------------------------------------------------
  DISBURSE(world, a) {
    const res = A.disburse(world, meP(world, a), +a.amount, a.purpose);
    need(world, a, res) && notice(world, a.playerId, `${moneyExact(a.amount)} disbursed.`, 'ok');
  },
  BUILD(world, a) {
    const pid = meP(world, a);
    if (!R.hasPower(world, pid, 'zone')) return notice(world, a.playerId, 'Your office does not hold the power to order construction.');
    const cost = BUILDINGS[a.building]?.cost || 0;
    const gate = A.disburseGate(world, pid, cost);
    if (!gate.ok) return notice(world, a.playerId, gate.reasons.join(' '));
    const res = A.startProject(world, a.parcel, a.building);
    if (need(world, a, res)) log(world, 'build', `Ordered by ${world.personas[pid]?.name}.`, { actors: [pid] });
  },
  ZONE(world, a) {
    const pid = meP(world, a);
    if (!R.hasPower(world, pid, 'zone')) return notice(world, a.playerId, 'Your office does not hold the power to zone.');
    const p = world.city.parcels[a.parcel];
    if (!p || p.building || p.project) return notice(world, a.playerId, 'That parcel is not vacant.');
    p.zone = a.zone;
  },

  // --- press --------------------------------------------------------------
  FOUND_OUTLET(world, a) {
    const res = M.foundOutlet(world, { name: a.name, ownerPersonaId: meP(world, a), districtId: a.districtId });
    need(world, a, res);
  },
  PUBLISH(world, a) {
    const res = M.publish(world, { ...a.article, authorId: meP(world, a) });
    if (!need(world, a, res)) return;
    if (res.value.disrepute) {
      notice(world, a.playerId, `Printed — and the paper is the story. ${res.value.disrepute[0]}. Its credibility is gone and the states will remember.`, 'error');
    } else {
      notice(world, a.playerId, res.value.supported ? 'Published, and cited. It will land harder.' : 'Published without a citation. Risky.', 'ok');
    }
  },
  REBUT(world, a) { need(world, a, M.rebut(world, a.articleId, meP(world, a), a.text)); },
  SUE(world, a) { need(world, a, M.sueForLibel(world, a.articleId, meP(world, a))); },

  // --- intrigue -----------------------------------------------------------
  CONSPIRE(world, a) { need(world, a, I.foundConspiracy(world, { name: a.name, founderId: meP(world, a) })); },
  CONSPIRE_INVITE(world, a) { need(world, a, I.invite(world, a.conId, meP(world, a), a.personaId)); },
  WHISPER(world, a) { need(world, a, I.whisper(world, a.conId, meP(world, a), a.text)); },
  INVESTIGATE(world, a) {
    const res = I.investigate(world, meP(world, a), a.conId || null);
    if (need(world, a, res)) notice(world, a.playerId, res.value.found ? (res.value.full ? 'Exposed.' : `Fragment: ${res.value.fragment}`) : res.value.note, 'ok');
  },
  LEAK(world, a) { need(world, a, I.leak(world, a.conId, meP(world, a))); },
  RUN_AGENT(world, a) { need(world, a, I.runAgent(world, { ownerPersonaId: meP(world, a), coverName: a.coverName })); },
  MISSION(world, a) {
    const spy = (world.spies || []).find((s) => s.ownerPersonaId === meP(world, a) && s.active);
    if (!spy) return notice(world, a.playerId, 'You have no active agent.');
    const res = I.mission(world, spy.id, a.kind, a.targetId);
    if (need(world, a, res)) notice(world, a.playerId, res.value.note || res.value.result || 'Done.', res.value.caught ? 'error' : 'ok');
  },
  UPRISING(world, a) {
    const res = I.declareUprising(world, { leaderId: meP(world, a), cause: a.cause, kind: a.kind, districts: a.districts || [] });
    need(world, a, res);
  },
  PLEDGE(world, a) { need(world, a, I.pledge(world, meP(world, a), a.side)); },
  RALLY(world, a) {
    const res = I.rally(world, meP(world, a));
    if (need(world, a, res)) notice(world, a.playerId, `To the streets — the movement grows by ${res.value.gain}.`, 'ok');
  },
  RESOLVE_UPRISING(world, a) { I.resolveUprising(world); },
  PLOT_START(world, a) { need(world, a, I.declarePlot(world, { leaderId: meP(world, a), kind: a.kind, cause: a.cause })); },
  PLOT_RECRUIT(world, a) {
    const res = I.recruitToPlot(world, meP(world, a), a.targetId);
    if (need(world, a, res)) {
      const v = res.value || {};
      notice(world, a.playerId,
        v.joined ? 'They are sworn in.'
          : v.invited ? 'The word is out — they must answer for themselves.'
            : v.betrayed ? 'They refused, and ran to the government. You are compromised.'
              : 'They declined, but held their tongue — for now.',
        v.betrayed ? 'error' : 'ok');
    }
  },
  PLOT_JOIN(world, a) { need(world, a, I.joinPlot(world, meP(world, a))); },
  PLOT_EXPOSE(world, a) { need(world, a, I.exposePlot(world, meP(world, a))); },
  PLOT_LAUNCH(world, a) { need(world, a, I.launchRevolution(world, meP(world, a))); },
  PLOT_STRIKE(world, a) {
    const res = I.strikeCoup(world, meP(world, a));
    if (need(world, a, res)) notice(world, a.playerId, res.value.win ? `The coup succeeds — ${res.value.p}% odds.` : `The coup fails — ${res.value.p}% odds. You are taken.`, res.value.win ? 'ok' : 'error');
  },

  // --- crises & emergency --------------------------------------------------
  RESPOND(world, a) { need(world, a, D.respond(world, a.evUid, a.option, meP(world, a))); },
  ACKNOWLEDGE(world, a) { need(world, a, D.acknowledge(world, a.evUid, meP(world, a))); },
  EMERGENCY(world, a) {
    need(world, a, a.on ? D.declareEmergency(world, meP(world, a), a.reason) : D.endEmergency(world, meP(world, a)));
  },

  // --- the private sector ---------------------------------------------------
  // Everything here is gated on being the founder of the company being acted
  // on. An employee may walk into the building and read the books; the person
  // whose name is on it is the only one who may spend its money.
  FOUND_COMPANY(world, a) {
    const pid = meP(world, a);
    const res = CO.found(world, pid, a.name, R.officesOf, a.sector);
    if (!need(world, a, res)) return;
    const sec = CO.sectorOf(res.company);
    log(world, 'money', `${world.personas[pid]?.name} founds ${res.company.name} — ${sec.short} — `
      + 'out of a basement and their savings.', { actors: [pid], weight: 2 });
  },

  /** Sell the company and walk away with what it is worth. */
  SELL_COMPANY(world, a) {
    const pid = meP(world, a);
    const res = CO.sell(world, pid);
    if (!need(world, a, res)) return;
    log(world, 'money', `${world.personas[pid]?.name} sells ${res.value.name} for ${moneyExact(res.value.net)}`
      + `${res.value.staff ? `, and the ${res.value.staff} ${res.value.staff === 1 ? 'person' : 'people'} on its books go with it` : ''}.`,
    { actors: [pid], weight: 2 });
    notice(world, a.playerId, `${res.value.name} is sold for ${moneyExact(res.value.net)}.`, 'ok');
  },
  SELL_SHARES(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.sellShares(world, pid, a.shares);
    if (!res.ok) return notice(world, a.playerId, res.reason);
    log(world, 'money', `${world.personas[pid]?.name} sells ${res.value.shares.toLocaleString()} shares in ${co.name} for `
      + `${moneyExact(res.value.proceeds)}, keeping ${Math.round(res.value.stake * 100)}% of it.`, { actors: [pid], weight: 2 });
    notice(world, a.playerId, `Sold for ${moneyExact(res.value.proceeds)} — it goes to your own account.`, 'ok');
  },

  /** How the founder is running it this year. See company.STANCES. */
  COMPANY_STANCE(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const s = CO.STANCES[a.stance];
    if (!s) return notice(world, a.playerId, 'No such way of running it.');
    if (co.stance === s.id) return;
    co.stance = s.id;
    log(world, 'money', `${co.name} changes footing: ${s.label.toLowerCase()}. ${s.blurb}`,
      { actors: [pid], weight: 1 });
  },

  /** Answer whatever has arrived at the company. See company.CO_EVENTS. */
  COMPANY_ANSWER(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.answerEvent(world, co, a.uid, a.option);
    if (!need(world, a, res)) return;
    notice(world, a.playerId, res.value.note, 'ok');
    log(world, 'money', `${co.name}: ${res.value.note}`, { actors: [pid], weight: 1 });
  },
  /**
   * Take somebody on.
   *
   * With a persona id, that person — someone who has lost an election, or
   * another player. Without one, a name out of the twenty-four thousand: the
   * republic's persona list is only its political cast, and at the founding
   * every last one of them holds a seat, so a founder offered a dropdown of
   * "people not currently in government" was offered an empty list. Your first
   * employees are people nobody has heard of, which is correct.
   */
  COMPANY_HIRE(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    // Every rule of it is in company.hire, because a synthetic founder hires
    // under the same ones and there must be one copy of them.
    const res = CO.hire(world, co, { personaId: a.personaId, makePersona, officesOf: R.officesOf });
    if (!res.ok) return notice(world, a.playerId, res.reason);
    const hired = res.value.hired;
    if (hired.playerId) {
      notice(world, hired.playerId, `${world.personas[pid]?.name} has taken you on at ${co.name}. The building is open to you.`, 'ok');
    }
  },
  COMPANY_FIRE(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return;
    co.employees = co.employees.filter((x) => x !== a.personaId);
  },
  /**
   * Buy another company with yours.
   *
   * Not another player's — a career is not a thing that can be bought out from
   * under the person living it, whatever their balance sheet says. But that used
   * to be the end of the sentence, and a refusal is not an answer to wanting the
   * business. So the same money becomes an offer: priced identically, left on
   * their desk, and theirs to refuse. See company.offerBid, and company.acquire
   * for what moves when they say yes.
   */
  COMPANY_ACQUIRE(world, a) {
    const pid = meP(world, a);
    const buyer = CO.foundedBy(world, pid);
    if (!buyer) return notice(world, a.playerId, 'You do not run a company.');
    const target = (world.companies || []).find((c) => c.id === a.companyId && !c.closed);
    if (!target) return notice(world, a.playerId, 'That company is not trading.');
    const theirPlayer = world.personas[target.founderId]?.playerId;
    if (theirPlayer) {
      const bidRes = CO.offerBid(world, target, buyer);
      if (!need(world, a, bidRes)) return;
      const bid = bidRes.value.bid;
      notice(world, a.playerId, `${moneyExact(bid.toSeller)} offered for ${target.name}. It is not yours until they say so.`, 'ok');
      notice(world, theirPlayer, `${buyer.name} offers ${moneyExact(bid.toSeller)} for ${target.name}. ${CO.BID_DEADLINE} ticks to answer.`, 'ok');
      return log(world, 'money', `${buyer.name} offers ${moneyExact(bid.toSeller)} for ${target.name}. `
        + `${world.personas[target.founderId]?.name} has not said yes.`,
      { actors: [pid, target.founderId].filter(Boolean), weight: 3 });
    }
    const res = CO.acquire(world, buyer, target);
    if (!need(world, a, res)) return;
    const v = res.value;
    log(world, 'money', `${buyer.name} buys ${target.name} for ${moneyExact(v.toSeller)}`
      + `${v.debt ? `, taking on ${moneyExact(v.debt)} of its debt` : ''}`
      + `${v.staff ? ` and ${v.staff} ${v.staff === 1 ? 'person' : 'people'} with it` : ''}. `
      + (v.trouble ? 'It was weeks from being wound up.' : 'It was not for sale until it was.'),
    { actors: [pid, target.founderId].filter(Boolean), weight: 4 });
  },
  /**
   * Yes or no to somebody who wants your company.
   *
   * The one ending a failing business did not have. Declining is a real answer
   * and it costs — the offer goes, and whatever was going to happen to the
   * company still is. See company.answerBid.
   */
  COMPANY_ANSWER_BID(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const bid = CO.openBid(co);
    const res = CO.answerBid(world, co, a.uid, !!a.accept);
    if (!need(world, a, res)) return;
    const buyerFounder = world.personas[(world.companies || []).find((c) => c.id === bid?.buyerId)?.founderId];
    if (!res.value.accepted) {
      notice(world, a.playerId, `${bid.buyerName} has been told no. ${co.name} is still yours.`, 'ok');
      return log(world, 'money', `${world.personas[pid]?.name} turns down ${bid.buyerName}'s ${moneyExact(bid.toSeller)} for ${co.name}. `
        + (bid.trouble ? 'The clock on it did not stop.' : 'It was not for sale.'),
      { actors: [pid, buyerFounder?.id].filter(Boolean), weight: 3 });
    }
    const v = res.value;
    notice(world, a.playerId, `Sold. ${moneyExact(v.toSeller)} is yours and ${v.buyer.name} has the rest.`, 'ok');
    log(world, 'money', `${v.buyer.name} buys ${co.name} for ${moneyExact(v.toSeller)}`
      + `${v.debt ? `, taking on ${moneyExact(v.debt)} of its debt` : ''}`
      + `${v.staff ? ` and ${v.staff} ${v.staff === 1 ? 'person' : 'people'} with it` : ''}. `
      + `${world.personas[pid]?.name} sold it.`,
    { actors: [pid, buyerFounder?.id].filter(Boolean), weight: 4 });
  },
  COMPANY_BUY_BUILDING(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.buyBuilding(world, co);
    if (!res.ok) return notice(world, a.playerId, res.reason);
    log(world, 'company', `${co.name} takes on a new building — room for ${CO.capacityOf(co)} now, and a manager at four times a wage.`, { actors: [pid], weight: 2 });
  },
  /**
   * Sell one of them again — the move a company in trouble actually has.
   *
   * It fetches rather less than it cost and the desks go with it, so anybody
   * past the new capacity is let go. See company.sellBuilding.
   */
  COMPANY_SELL_BUILDING(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.sellBuilding(world, co);
    if (!need(world, a, res)) return;
    const gone = res.value.letGo.length;
    log(world, 'money', `${co.name} sells a building for ${moneyExact(res.value.got)} — `
      + `room for ${CO.capacityOf(co)} now${gone ? `, and ${gone} ${gone === 1 ? 'person is' : 'people are'} let go with it` : ''}.`,
    { actors: [pid, ...res.value.letGo], weight: 2 });
  },
  /**
   * Put your own money into it. See company.injectCapital — the founder's
   * wallet could only ever be spent on founding the *next* company, which left
   * the most obvious move in a crisis off the board entirely.
   */
  COMPANY_INJECT(world, a) {
    const pid = meP(world, a);
    const res = CO.injectCapital(world, pid, a.amount);
    if (!need(world, a, res)) return;
    const co = CO.foundedBy(world, pid);
    log(world, 'money', `${world.personas[pid]?.name} puts ${moneyExact(res.value.amount)} of their own money into ${co?.name || 'the company'}.`,
      { actors: [pid], weight: 2 });
    notice(world, a.playerId, `${moneyExact(res.value.amount)} in. The company holds ${moneyExact(res.value.cash)}.`, 'ok');
  },
  COMPANY_BORROW(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = a.repay ? CO.repay(world, co, a.amount) : CO.borrow(world, co, a.amount);
    need(world, a, res);
  },
  COMPANY_IPO(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.goPublic(world, co);
    if (!need(world, a, res)) return;
    log(world, 'money', `${co.name} lists. A quarter of it is sold to the public for ${moneyExact(res.raised)}, `
      + `valuing the whole at ${moneyExact(co.valuation || 0)}. ${world.personas[pid]?.name} keeps the rest.`,
    { actors: [pid], weight: 4 });
  },
  COMPANY_LOBBY(world, a) {
    const pid = meP(world, a);
    const co = CO.foundedBy(world, pid);
    if (!co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.lobby(world, co, a.personaId, a.docId, a.amount);
    if (!need(world, a, res)) return;
    const target = world.personas[a.personaId];
    const doc = world.documents[a.docId];
    // Loudly. The entire design of lobbying here is that it is on the record —
    // the Chronicle prints it, the member's file carries it, and the court can
    // read both. Money that moves a vote quietly is a different game.
    log(world, 'money', `${co.name} pays ${moneyExact(a.amount)} to ${target?.name} over “${doc?.title}”. `
      + 'It is minuted, and on their file.', { actors: [pid, a.personaId], docId: a.docId, weight: 4 });
    if (target?.playerId) {
      notice(world, target.playerId, `${co.name} has put ${moneyExact(a.amount)} behind your vote on “${doc?.title}”. It is on the record.`, 'ok');
    }
  },
  // Political money past the chamber floor: to a party, to a campaign, or a
  // campaign of the company's own — all on the record, like lobbying.
  // `from: 'wallet'` gives a person's own money instead of their company's —
  // the same pots, the same caps, the same Chronicle line. A founder who sold up
  // and an officeholder who never founded anything can both reach it; only a
  // company donation needs a company.
  DONATE_PARTY(world, a) {
    const pid = meP(world, a);
    const wallet = a.from === 'wallet';
    const co = wallet ? null : CO.foundedBy(world, pid);
    if (!wallet && !co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.donateParty(world, co, pid, a.party, a.amount, { from: a.from });
    if (!res.ok) return notice(world, a.playerId, res.reason);
    const party = PARTIES.find((x) => x.id === a.party);
    log(world, 'money', `${res.value.from} gives ${moneyExact(res.value.given)}${res.value.personal ? ' of their own money' : ''} to the ${party?.name || a.party} party — ${(res.value.influence * 100).toFixed(1)}% behind it at the polls now, and on the record.`, { actors: [pid], weight: 3 });
  },
  DONATE_CAMPAIGN(world, a) {
    const pid = meP(world, a);
    const wallet = a.from === 'wallet';
    const co = wallet ? null : CO.foundedBy(world, pid);
    if (!wallet && !co) return notice(world, a.playerId, 'You do not run a company.');
    const res = CO.donateCampaign(world, co, pid, a.candidatePersonaId, a.amount, { bootstrap: !!a.bootstrap, from: a.from });
    if (!res.ok) return notice(world, a.playerId, res.reason);
    const cand = world.personas[a.candidatePersonaId];
    log(world, 'money', `${res.value.from} ${a.bootstrap ? 'bootstraps' : 'gives'} ${moneyExact(res.value.given)}${res.value.personal ? ' of their own money' : ''} ${a.bootstrap ? 'into' : 'to'} ${cand?.name || 'a'}'s campaign — ${(res.value.influence * 100).toFixed(1)}% behind it now, on the record.`, { actors: [pid, a.candidatePersonaId], weight: 3 });
  },

  // --- monetary policy ------------------------------------------------------
  // The three tools, and one door in front of all of them. Whether that door
  // opens at all is rules.mayMoveRates, which is a clause in the constitution
  // rather than a power on an office: a republic that made its bank independent
  // cannot reach these however senior the person clicking is.
  MONETARY(world, a) {
    const pid = meP(world, a);
    if (!R.mayMoveRates(world, pid)) {
      return notice(world, a.playerId, R.bankIsIndependent(world)
        ? 'The bank is independent of this government. It sets the rate; you may say what you think.'
        : 'Only the Secretary of the Treasury and the President may instruct the bank.');
    }
    const e = world.economy;
    const before = { rate: e.marketRate, m: MACRO.moneySupply(world), policy: e.policyRate };
    let res;
    if (a.tool === 'rate') res = MACRO.setPolicyRate(world, a.value);
    else if (a.tool === 'reserve') res = MACRO.setReserveRatio(world, a.value);
    else if (a.tool === 'omo') res = MACRO.openMarket(world, a.value);
    else return;
    if (!need(world, a, res)) return;

    const who = world.personas[pid]?.name || 'The Treasury';
    if (a.tool === 'rate') {
      const dir = e.policyRate > before.policy ? 'raises' : e.policyRate < before.policy ? 'cuts' : 'holds';
      log(world, 'money', `${who} ${dir} the policy rate to ${(e.policyRate * 100).toFixed(2)}%. `
        + `The bank buys or sells until the money market clears there.`, { actors: [pid], weight: 2 });
    } else if (a.tool === 'reserve') {
      log(world, 'money', `${who} sets the reserve requirement at ${(e.reserveRatio * 100).toFixed(1)}%. `
        + `Every dollar of reserves is now worth ${MACRO.moneyMultiplier(world).toFixed(1)} in deposits.`,
      { actors: [pid], weight: 2 });
    } else {
      const amt = +a.value || 0;
      log(world, 'money', `${who} has the bank ${amt > 0 ? 'buy' : 'sell'} ${moneyExact(Math.abs(amt))} of government bonds. `
        + `${amt > 0 ? 'The money is created to pay for them.' : 'The money paid for them leaves circulation.'}`,
      { actors: [pid], weight: 2 });
    }
  },
  // The head of government's inauguration oath, in their own words, into the record.
  OATH(world, a) {
    const pid = meP(world, a);
    if (!pid || pid !== I.headId(world)) return; // only the one actually taking the oath
    const line = (a.line || '').trim();
    if (!line) return;
    const eo = I.execOffice(world);
    log(world, 'founding', `${world.personas[pid]?.name} takes the oath as ${eo?.name || 'head of government'}: “${line}”`, { actors: [pid], weight: 3 });
    // And the calendar starts here. Until the oath is taken the world is held
    // at its first tick — see sim.tick — so the republic's first day is the day
    // somebody stood up and said what they stood for.
    if (world.inaugurated == null) world.inaugurated = world.clock.tick;
  },

  // --- elections ----------------------------------------------------------
  NOMINATE(world, a) {
    const e = world.elections.find((x) => x.id === a.electionId);
    if (!e) return;
    need(world, a, nominate(world, e, a.personaId || meP(world, a), null, a.runningMate || null));
  },
  BALLOT(world, a) { need(world, a, castBallot(world, a.electionId, meP(world, a), a.candidateId)); },
  ENDORSE(world, a) {
    const e = world.elections.find((x) => x.id === a.electionId) || world.elections.find((x) => x.status === 'open');
    if (!e) return notice(world, a.playerId, 'There is no election open to endorse in.');
    need(world, a, endorse(world, meP(world, a), e, a.candidatePersonaId));
  },
  // A politician chooses (or leaves) a party. Independents keep no party, and win
  // no party's bloc at the polls — a hard road, by design.
  CHOOSE_PARTY(world, a) {
    const pid = meP(world, a);
    const p = world.personas[pid];
    if (!p) return;
    const target = a.party || null;
    if (target && !PARTIES.some((x) => x.id === target)) return notice(world, a.playerId, 'No such party.');
    const from = p.party;
    if (from === target) return;
    p.party = target;
    // At the convention this is the first answer, not a defection: the founder
    // is choosing the side they will stand on before the republic exists. The
    // Chronicle opens on the founding, so a founder trying the two buttons
    // would otherwise write the history of a career spent crossing the floor.
    if (world.phase === 'convention') return;
    const nm = (id) => (PARTIES.find((x) => x.id === id)?.name);
    log(world, 'election', `${p.name} ${target ? `joins the ${nm(target)} party` : 'leaves party politics to sit as an independent'}`
      + `${from && target ? `, crossing from the ${nm(from)} party` : ''}.`, { actors: [pid], weight: 2 });
  },
  // Finalise the ballot ahead of the count: the vote is fixed from here.
  SEAL_BALLOT(world, a) {
    const res = sealBallot(world, a.electionId, meP(world, a));
    need(world, a, res) && notice(world, a.playerId, 'Your ballot is submitted. It counts when the polls close.', 'ok');
  },
  // The rules live in acts.appoint — the same door npc.js uses to fill a
  // cabinet. This is only the part that talks to the person clicking.
  APPOINT(world, a) {
    const res = A.appoint(world, meP(world, a), a.seatId, a.personaId);
    if (!res.ok) return notice(world, a.playerId, res.reason);
    const { nominated, nominee, office } = res.value;
    if (nominated) {
      notice(world, nominee.playerId, `You have been nominated ${office.name}. Accept or decline it in Offices.`, 'ok');
    }
  },

  // A player answers a pending nomination — to a cabinet post (seatId) or to a
  // candidate's ticket for elected office (ticket).
  ACCEPT_POST(world, a) {
    const pid = meP(world, a);
    const nom = (world.nominations || []).find((n) => n.personaId === pid && (a.ticket ? n.ticket === a.ticket : n.seatId === a.seatId));
    if (!nom) return;
    if (nom.ticket) {
      const e = world.elections.find((x) => x.id === nom.ticket);
      const cand = e?.candidates.find((c) => c.personaId === nom.candidate);
      if (cand) cand.mateAccepted = true;
      world.nominations = world.nominations.filter((n) => n !== nom);
      log(world, 'election', `${world.personas[pid]?.name} accepts a place on ${world.personas[nom.candidate]?.name}'s ticket.`, { actors: [pid], weight: 2 });
      return;
    }
    const seat = world.seats.find((s) => s.id === nom.seatId);
    const o = seat && R.office(world, seat.office);
    if (!seat || !o) return;
    // Someone took the chair while this offer was outstanding — accepting can
    // no longer turf them out of it.
    if (seat.personaId) {
      world.nominations = world.nominations.filter((n) => n !== nom);
      return notice(world, a.playerId, `${o.name} was filled while you were deciding. The offer has lapsed.`);
    }
    seatInOffice(world, seat, o, pid);
    world.nominations = world.nominations.filter((n) => n !== nom);
    log(world, 'office', `${world.personas[pid]?.name} accepts appointment as ${o.name} from ${world.personas[nom.by]?.name}.`, { actors: [pid, nom.by].filter(Boolean), weight: 3 });
  },
  DECLINE_POST(world, a) {
    const pid = meP(world, a);
    const nom = (world.nominations || []).find((n) => n.personaId === pid && (a.ticket ? n.ticket === a.ticket : n.seatId === a.seatId));
    if (!nom) return;
    if (nom.ticket) {
      const e = world.elections.find((x) => x.id === nom.ticket);
      const cand = e?.candidates.find((c) => c.personaId === nom.candidate);
      if (cand) { cand.runningMate = null; cand.mateAccepted = false; }
      world.nominations = world.nominations.filter((n) => n !== nom);
      log(world, 'election', `${world.personas[pid]?.name} declines a place on ${world.personas[nom.candidate]?.name}'s ticket.`, { actors: [pid], weight: 2 });
      const byP = world.personas[nom.by]?.playerId;
      if (byP) notice(world, byP, `${world.personas[pid]?.name} declined to run on your ticket.`, 'error');
      return;
    }
    const o = R.office(world, world.seats.find((s) => s.id === nom.seatId)?.office);
    world.nominations = world.nominations.filter((n) => n !== nom);
    log(world, 'office', `${world.personas[pid]?.name} declines the appointment as ${o?.name || 'office'}.`, { actors: [pid], weight: 2 });
    const byPlayer = world.personas[nom.by]?.playerId;
    if (byPlayer) notice(world, byPlayer, `${world.personas[pid]?.name} declined your appointment as ${o?.name || 'office'}.`, 'error');
  },
  // Step down from an office you hold (one of them, if you hold several).
  RESIGN(world, a) {
    const pid = meP(world, a);
    const seat = world.seats.find((s) => s.id === a.seatId && s.personaId === pid);
    if (!seat) return notice(world, a.playerId, 'You do not hold that office.');
    const o = R.office(world, seat.office);
    const office = seat.office;
    A.vacate(world, seat, 'resigned');
    log(world, 'office', `${world.personas[pid]?.name} resigns as ${o?.name || 'officeholder'}.`, { actors: [pid], weight: 3 });
    A.succeed(world, office); // a deputy steps up where the office has one
  },

  // The President admits or removes people from the Oval Office (the cabinet is
  // always admitted and cannot be removed here).
  // The lights in the Oval Office. Shared, not a per-tab preference: if the
  // President is working late in the dark, everyone admitted to the room sees the
  // room they are actually standing in.
  OVAL_LIGHTS(world, a) {
    const me = meP(world, a);
    if (!R.mayEnterOval(world, me)) return notice(world, a.playerId, 'That is not your light switch.');
    world.ovalLights = a.on !== false;
  },

  INVITE_OVAL(world, a) {
    const pid = meP(world, a);
    if (!R.officesOf(world, pid).some((o) => o.id === 'president'))
      return notice(world, a.playerId, 'Only the President may open the Oval Office to others.');
    inviteToRoom(world, 'oval', pid, a.personaId, a.playerId);
  },
  UNINVITE_OVAL(world, a) {
    const pid = meP(world, a);
    if (!R.officesOf(world, pid).some((o) => o.id === 'president')) return;
    R.setRoomInvites(world, 'oval', R.ovalGuests(world).filter((g) => g.id !== a.personaId));
  },

  // A department's guest list. The Secretary who runs the building may open it,
  // and so may the President who appointed them — the same two people the door
  // already answers to.
  INVITE_DEPT(world, a) {
    const pid = meP(world, a);
    if (!R.INVITABLE_ROOMS.includes(a.room) || a.room === 'oval') return;
    if (!R.mayInviteToDept(world, pid, a.room))
      return notice(world, a.playerId, 'That building is not yours to open.');
    inviteToRoom(world, a.room, pid, a.personaId, a.playerId);
  },
  UNINVITE_DEPT(world, a) {
    const pid = meP(world, a);
    if (!R.mayInviteToDept(world, pid, a.room)) return;
    R.setRoomInvites(world, a.room, R.roomInvites(world, a.room).filter((g) => g.id !== a.personaId));
  },

  // The other end of it. Until this lands the offer is just an offer: the guest
  // cannot see the room, and the two months have not started.
  ACCEPT_INVITE(world, a) {
    const pid = meP(world, a);
    const list = R.roomInvites(world, a.room);
    const g = list.find((x) => x.id === pid);
    if (!g || !R.invitePending(g) || R.inviteExpired(world, g))
      return notice(world, a.playerId, 'That invitation is no longer open.');
    R.setRoomInvites(world, a.room, list.map((x) =>
      (x.id === pid ? { ...x, acceptedAt: world.clock.tick } : x)));
    log(world, 'office', `${world.personas[pid]?.name} is admitted to ${roomName(world, a.room)}.`,
      { actors: [pid], weight: 1 });
  },
  DECLINE_INVITE(world, a) {
    const pid = meP(world, a);
    const list = R.roomInvites(world, a.room);
    const g = list.find((x) => x.id === pid);
    if (!g || !R.invitePending(g)) return;
    R.setRoomInvites(world, a.room, list.filter((x) => x.id !== pid));
    const host = a.room === 'oval' ? R.holders(world, 'president')[0] : null;
    const hpl = host && world.personas[host.id]?.playerId;
    if (hpl) notice(world, hpl, `${world.personas[pid]?.name} declines your invitation.`, 'error');
  },

  // The Mansion's guest list. The Oval's invites outlive the President who gave
  // them, which is arguably a bug there; here the list is stamped with the Vice
  // President who wrote it (see rules.mayEnterMansion) and a new one starts empty,
  // because the guests were the person's and not the post's.
  INVITE_MANSION(world, a) {
    const pid = meP(world, a);
    if (!R.officesOf(world, pid).some((o) => o.id === 'vp'))
      return notice(world, a.playerId, 'The Mansion is not yours to open.');
    if (world.mansionHost !== pid) { world.mansionHost = pid; world.mansionInvites = []; }
    world.mansionInvites = world.mansionInvites || [];
    if (a.personaId && !world.mansionInvites.includes(a.personaId)) {
      world.mansionInvites.push(a.personaId);
      const pl = world.personas[a.personaId]?.playerId;
      if (pl) notice(world, pl, 'The Vice President has asked you up to the Mansion.', 'ok');
    }
  },
  UNINVITE_MANSION(world, a) {
    const pid = meP(world, a);
    if (!R.officesOf(world, pid).some((o) => o.id === 'vp')) return;
    world.mansionInvites = (world.mansionInvites || []).filter((id) => id !== a.personaId);
  },

  // Take back an offer nobody has answered. Until the nominee accepts, the seat
  // is neither filled nor free, so the appointer needs a way out of the wait.
  WITHDRAW_NOMINATION(world, a) {
    const pid = meP(world, a);
    const seat = world.seats.find((s) => s.id === a.seatId);
    if (!seat) return;
    const o = R.office(world, seat.office);
    if (!R.officesOf(world, pid).some((x) => x.id === o?.appointedBy) || !R.hasPower(world, pid, 'appoint'))
      return notice(world, a.playerId, `Only the ${R.office(world, o?.appointedBy)?.name || 'appointing office'} may withdraw that offer.`);
    const nom = (world.nominations || []).find((n) => n.seatId === seat.id);
    if (!nom) return;
    world.nominations = world.nominations.filter((n) => n !== nom);
    log(world, 'office', `The offer of ${o.name} to ${world.personas[nom.personaId]?.name} is withdrawn.`, { actors: [pid], weight: 1 });
    const pl = world.personas[nom.personaId]?.playerId;
    if (pl) notice(world, pl, `The offer of ${o.name} has been withdrawn.`, 'error');
  },

  // Dismiss an at-will appointee (a cabinet secretary). The seat is left vacant —
  // fillVacantSeats will not re-seat it — until the appointer names a successor.
  DISMISS(world, a) {
    const pid = meP(world, a);
    const seat = world.seats.find((s) => s.id === a.seatId);
    if (!seat) return;
    const o = R.office(world, seat.office);
    if (!o?.atWill) return notice(world, a.playerId, `${o?.name || 'That office'} does not serve at will and cannot be dismissed.`);
    if (!R.officesOf(world, pid).some((x) => x.id === o.appointedBy) || !R.hasPower(world, pid, 'appoint'))
      return notice(world, a.playerId, `Only the ${R.office(world, o.appointedBy)?.name || o.appointedBy} may dismiss the ${o.name}.`);
    if (!seat.personaId) return;
    const who = world.personas[seat.personaId]?.name;
    A.vacate(world, seat, 'dismissed');
    log(world, 'office', `${who} is dismissed as ${o.name} by ${world.personas[pid]?.name}.`, { actors: [pid], weight: 2 });
  },

  // --- personas -----------------------------------------------------------
  // --- the departments ----------------------------------------------------
  RECEIVE_ENVOY(world, a) { need(world, a, DEP.receive(world, meP(world, a), a.foreignId)); },
  ENVOY_TALK(world, a) {
    const res = DEP.talk(world, meP(world, a), a.foreignId, a.kind);
    if (need(world, a, res)) notice(world, a.playerId, res.value.note, 'ok');
  },
  DISMISS_ENVOY(world, a) { need(world, a, DEP.dismiss(world, meP(world, a), a.foreignId)); },
  // The head of state going in person — around the ambassador's cooldown, and
  // out of the country for a week. See depts.summon.
  SUMMIT(world, a) {
    const res = DEP.summon(world, meP(world, a), a.foreignId, a.kind);
    if (need(world, a, res)) notice(world, a.playerId, res.value.note, 'ok');
  },
  DRAFT_PLAN(world, a) { need(world, a, DEP.draftPlan(world, meP(world, a), a.foreignId, a.posture)); },
  MOBILIZE(world, a) { need(world, a, DEP.mobilize(world, meP(world, a), a.count)); },
  MOBILIZE_VOLUNTEERS(world, a) { need(world, a, DEP.mobilizeVolunteers(world, meP(world, a), a.count)); },
  COMMISSION_AIR(world, a) { need(world, a, DEP.commissionAir(world, meP(world, a), a.count)); },
  BOMB(world, a) { need(world, a, DEP.bomb(world, meP(world, a), a.foreignId)); },
  LAND_ALLIES(world, a) { need(world, a, DEP.landAllies(world, meP(world, a), a.foreignId)); },
  DEPLOY(world, a) { need(world, a, DEP.deploy(world, meP(world, a), a.foreignId, a.count)); },

  // Volunteers to a front, or back from it. Only during a war with that power —
  // see depts.sendVolunteers.
  SEND_VOLUNTEERS(world, a) { need(world, a, DEP.sendVolunteers(world, meP(world, a), a.foreignId, a.count)); },

  // Name what a victory was worth, while the beaten power is still waiting on an
  // answer. See acts.dictateTerms — the window is the leverage.
  DICTATE_TERMS(world, a) {
    const res = A.dictateTerms(world, meP(world, a), a.foreignId, { cede: a.cede, indemnity: a.indemnity });
    if (!need(world, a, res)) return;
    notice(world, a.playerId, `Terms settled with ${res.value.foreign.name}.`, 'ok');
  },

  // Public money into a private company that is about to fail. Through the same
  // gate as any other disbursement, so in most republics a rescue of any size
  // is a bill and this door only opens for the small ones. See acts.bailout.
  BAILOUT(world, a) {
    const res = A.bailout(world, meP(world, a), a.companyId, a.amount);
    if (!need(world, a, res)) return;
    notice(world, a.playerId, res.value.cured
      ? `${res.value.company.name} is out of danger.`
      : `${res.value.company.name} has the money, and is still in trouble.`, res.value.cured ? 'ok' : 'error');
  },

  // Refuse the surrender and fight on for the whole country. See acts.pressOn —
  // the war resumes against a power that knows what losing it means now.
  PRESS_ON(world, a) {
    const res = A.pressOn(world, meP(world, a), a.foreignId);
    if (!need(world, a, res)) return;
    notice(world, a.playerId, `The surrender of ${res.value.foreign.name} is refused. The war goes on.`, 'error');
  },

  // Order the survey redrawn. The coast, the border with Canada and the
  // terrain are all seeded off the nation's name; this changes the seed, so the
  // country keeps its name and gets a different shape.
  //
  // Nothing in the simulation keys off the drawing — it is the picture of the
  // country, not the country — but it is the picture everyone at the table has
  // been reading for hours, so it is the executive's call and it is rationed:
  // once every two canon years.
  //
  // The gate is the power, not the key to the room. Standing in the Oval Office
  // was the test once, and five people hold a key to it — so the Vice President
  // and three secretaries could each redraw the country over the President's
  // head. `spend` is the President's alone under this constitution, which is the
  // right shape for a survey somebody has to pay for.
  REDRAW_MAP(world, a) {
    const pid = meP(world, a);
    if (!pid || !R.mayEnterOval(world, pid))
      return notice(world, a.playerId, 'The survey is ordered from the Oval Office.');
    if (!R.hasPower(world, pid, 'spend'))
      return notice(world, a.playerId, 'Only an office that can commit money may commission the survey.');
    const wait = MAP_REDRAW_YEARS * world.clock.ticksPerYear;
    const last = world.mapRedrawnAt;
    if (last != null && world.clock.tick - last < wait) {
      const left = wait - (world.clock.tick - last);
      return notice(world, a.playerId, `Last ordered ${canonDate(world, last)}. Another may be commissioned in ${canonSpan(world, left)}.`);
    }
    world.mapSeed = (world.mapSeed || 0) + 1;
    world.mapRedrawnAt = world.clock.tick;
    log(world, 'build', `${world.personas[pid]?.name} orders the survey redrawn — coast, border and interior set down afresh.`,
      { actors: [pid], weight: 2 });
    notice(world, a.playerId, 'The survey is redrawn. See the World and City maps.', 'ok');
  },

  // How many ticks a real second is worth. Solo only, and enforced again in the
  // clock: a table cannot have one player fast-forwarding the world out from
  // under everyone else's turn.
  SET_TIMESCALE(world, a) {
    if (activePlayers(world).length > 1)
      return notice(world, a.playerId, 'Time runs at one tick a second while anyone else is here.');
    world.timeScale = clamp(Math.round(+a.scale || 1), 1, MAX_TIMESCALE);
  },

  NEW_PERSONA(world, a) {
    const pl = world.players[a.playerId];
    if (!pl) return;
    const old = world.personas[pl.personaId];
    if (old && old.alive && !old.exiled && !old.imprisoned && !a.force)
      return notice(world, a.playerId, 'Your persona is alive and free. Roll a new one only after death, exile, or disgrace.');
    const lineage = a.inherit ? old?.lineage : null;
    const gen = a.inherit ? (old?.gen || 1) + 1 : 1;
    const p = makePersona(world, {
      name: a.name || (a.inherit && old ? old.name : null),
      playerId: a.playerId, lineage, gen,
      // An heir is from where the family is from; a fresh persona is placed
      // wherever the republic is thinnest, below.
      district: a.inherit ? old?.district || null : null,
    });
    p.bio = a.bio || '';
    if (!p.district) assignHomeDistricts(world);
    if (a.inherit && old) {
      p.reputation = Math.round(old.reputation * 0.5);
      p.approval = 50 + (old.approval - 50) * 0.25;
      log(world, 'founding', `${regnal(p)} takes up the name. Inherits nothing but reputation.`, { actors: [p.id], weight: 2 });
    } else {
      log(world, 'founding', `A new figure appears in ${world.nation}: ${p.name}.`, { actors: [p.id] });
    }
    pl.personaId = p.id;
  },
  KILL_PERSONA(world, a) {
    // Character death is a persona event. The player stays at the table.
    const p = world.personas[a.personaId];
    if (!p) return;
    const actor = meP(world, a);
    const may = a.personaId === actor || R.hasPower(world, actor, 'arrest') || world.players[a.playerId]?.moderator;
    if (!may) return notice(world, a.playerId, 'You cannot end that life.');
    p.alive = false; p.died = world.clock.tick; p.cause = a.cause || 'unrecorded';
    const seat = R.seatOf(world, p.id);
    if (seat) A.vacate(world, seat, 'death');
    log(world, 'death', `${p.name} is dead. ${a.cause || ''}`.trim(), { actors: [p.id], weight: 4 });
    log(world, 'system', obituaryLine(world, p), { weight: 1 });
    // A death closes the dates and finishes the life the article was written
    // about halfway through. Somebody who held the chair is written up again.
    if (world.bios?.[p.id]) reviseBio(world, p.id, 'on the death of its subject');
  },

  /**
   * Publish your memoirs.
   *
   * The last move available to somebody with no office left, and the only one
   * that reaches back into what the histories already say. See
   * media.publishMemoir for the weight, and chronicle.reviseBio for why the
   * article is rewritten afterwards: changing what it says is the whole point
   * of writing one.
   */
  MEMOIR(world, a) {
    const pid = meP(world, a);
    const res = M.publishMemoir(world, { authorId: pid, title: a.title, chapters: a.chapters });
    if (!need(world, a, res)) return;
    if (world.bios?.[pid]) reviseBio(world, pid, 'after its subject published their own account');
    notice(world, a.playerId, `“${res.value.title}” is published. The histories are revised.`, 'ok');
  },

  // --- chronicle ----------------------------------------------------------
  ANNOTATE(world, a) { annotate(world, a.entryId, meP(world, a), a.text, a.stance); },
  HISTORIAN_VOTE(world, a) {
    world.historianVotes = world.historianVotes || {};
    const byPersona = (world.historianVotes[a.personaId] = world.historianVotes[a.personaId] || {});
    const arr = (byPersona[a.attribute] = byPersona[a.attribute] || []);
    const existing = arr.find((v) => v.by === a.playerId);
    if (existing) existing.score = +a.score;
    else arr.push({ by: a.playerId, score: +a.score });
  },

  // Drafting is the one activity where real time and canon time diverge
  // badly: nobody wants a fortnight of history per sentence typed.
  DRAFTING(world, a) {
    world.drafting = world.drafting || {};
    if (a.on) world.drafting[a.playerId] = Date.now();
    else delete world.drafting[a.playerId];
  },

  // The ballot box slows the clock the same way drafting does. Refreshed by the
  // elections view while it is open; expires on its own when the player leaves.
  DELIBERATE(world, a) {
    world.deliberating = world.deliberating || {};
    if (a.on) world.deliberating[a.playerId] = Date.now();
    else delete world.deliberating[a.playerId];
  },

  PING(world, a) {
    const pl = world.players[a.playerId];
    if (pl) pl.lastSeen = Date.now();
  },

  // A player closing their tab must not be able to freeze the table. Their
  // persona stays in the world — it simply becomes one the AI runs — and any
  // motion waiting on them is re-counted so a wipe or pause can still carry.
  LEAVE(world, a) { removePlayer(world, a.playerId, 'leaves the table'); },

  CHAT(world, a) {
    const said = meP(world, a);
    const channel = a.channel || 'floor';

    // You may only speak in a room you may stand in. The channel arrives in the
    // action, so without this the closed rooms were closed only in the sense
    // that their tab did not render.
    if (!R.mayHear(world, said, channel)) return notice(world, a.playerId, 'You are not in that room.');

    // The conduct floor applies to a spoken line exactly as it does to a
    // headline or a clause. A slur is refused at the door — the line is never
    // said, in any room, closed ones included: a private channel is still this
    // table. Incitement is said, and priced.
    const conduct = CONDUCT.scan(a.text);
    if (conduct.ok === false) return notice(world, a.playerId, CONDUCT.REFUSAL);

    // The title is stamped when the line is spoken, not read off the speaker
    // later: a room is a record, and what the President said stays something
    // the President said after they leave office.
    const msg = { id: uid('m'), personaId: said, title: R.titleOf(world, said), text: a.text, ts: Date.now(), tick: world.clock.tick, channel };
    if (conduct.tier === 'incite') msg.disrepute = conduct.grounds;
    world.chat.push(msg);
    if (world.chat.length > 300) world.chat.shift();
    world.lastActivity = Date.now();

    if (conduct.tier === 'incite' && said) sayingIt(world, a, said, channel, conduct.grounds);
  },

  END_SEASON(world, a) {
    if (!world.players[a.playerId]?.moderator) return notice(world, a.playerId, 'Only a moderator may close the Season.');
    endSeason(world, a.epitaph);
  },

  // --- table motions: things no single player should decide alone ---------
  // 2/22/22 is in this codebase as an invariant, not an anecdote. Pausing and
  // wiping the world are table decisions, so they go to the table — unless
  // there is nobody else at it.
  TABLE_MOTION(world, a) {
    const active = activePlayers(world);
    const mine = world.players[a.playerId];
    if (!mine) return;
    if (world.motion && !world.motion.closed)
      return notice(world, a.playerId, 'A motion is already before the table.');

    const m = {
      id: uid('mo'), kind: a.kind, by: a.playerId, opened: Date.now(),
      closes: Date.now() + 60000, votes: { [a.playerId]: 'yea' },
      needed: Math.floor(active.length / 2) + 1, eligible: active.length,
      payload: a.payload || {}, closed: false, passed: false,
    };
    world.motion = m;

    if (active.length <= 1) { resolveMotion(world, m, true); return; }
    // Tabling a pause is table business too — see OUT_OF_GAME below. The motion
    // still opens, is still voted on, and still shows in the header; it simply
    // does not go into the country's history.
    if (!OUT_OF_GAME.has(m.kind)) {
      log(world, 'system', `${mine.name} moves to ${motionLabel(m)}. ${m.needed} of ${active.length} active players must agree.`, { weight: 2 });
    }
  },

  MOTION_VOTE(world, a) {
    const m = world.motion;
    if (!m || m.closed) return notice(world, a.playerId, 'No motion is open.');
    if (!world.players[a.playerId]) return;
    m.votes[a.playerId] = a.ballot;
    reevaluateMotion(world);
  },

  MOTION_CANCEL(world, a) {
    const m = world.motion;
    if (!m || m.closed) return;
    if (m.by !== a.playerId) return notice(world, a.playerId, 'Only the player who moved it may withdraw it.');
    m.closed = true; m.passed = false; m.withdrawn = true;
  },

  // --- moderation: outside the fiction, always ----------------------------
  MOD(world, a) {
    if (!world.players[a.playerId]?.moderator)
      return notice(world, a.playerId, 'Moderation is not an in-game power, and no office grants it.');
    // 'fire_event' and 'phase' are gone: a moderator cannot hand the republic a
    // crisis, and cannot drop it into collapse. The director paces the Season and
    // the Season ends by a table wipe or by the government's own doing.
    if (a.op === 'set_speed') world.clock.ticksPerYear = clamp(+a.value, 20, 3000);
    else if (a.op === 'set_canon') world.canon = a.value;
    else if (a.op === 'grant_mod') { const p = world.players[a.target]; if (p) p.moderator = !!a.value; }
    else if (a.op === 'timeout') {
      // A platform action against a *player*, recorded outside the Chronicle.
      world.modLog = world.modLog || [];
      world.modLog.push({ ts: Date.now(), by: a.playerId, op: 'timeout', target: a.target, note: a.note || '' });
      const pl = world.players[a.target];
      if (pl) pl.mutedUntil = Date.now() + 5 * 60 * 1000;
    }
    if (a.op !== 'timeout') log(world, 'system', `[moderator] ${a.op} ${a.value ?? a.eventId ?? ''}`.trim());
  },
};

// A focused tab pings every 20s — but browsers throttle a background tab's
// timers to roughly once a minute, so a player who merely switches tabs can
// go quiet for 60s+ while very much still at the table. The cutoff has to
// sit safely above that throttle floor or alt-tabbing costs you your seat
// (verified in play: a backgrounded founder was pruned mid-Season at 45s).
// A closed tab still leaves promptly: pagehide fires a LEAVE.
const GONE_AFTER = 150000;

// --- founding: ready-up and the transition to a live Season ---------------

/**
 * What still stands between the convention and a live Season, said in a
 * sentence. A founder cannot ready up — and the Season cannot begin — until
 * this passes.
 */
function readyGate(world) {
  // Offices left at zero seats are an intention, not a state; a constitution of
  // nothing but zeros is not yet a government.
  if (!world.constitution.offices.some((o) => o.seats > 0))
    return { ok: false, reason: 'Every office has zero seats. A state needs at least one.' };
  // No founder sits out the founding: an unclaimed founder is a signal the
  // convention isn't finished, not a citizen to be seated by default.
  const unseated = Object.values(world.players).filter(
    (pl) => !world.seats.some((s) => s.personaId === pl.personaId));
  if (unseated.length)
    return { ok: false, reason: `Every founder must take an office first. Still unseated: ${unseated.map((p) => p.name).join(', ')}.` };
  return { ok: true };
}

/** Unanimity among the living: every tab still at the table has readied up. */
function allReady(world) {
  const active = activePlayers(world);
  return active.length > 0 && active.every((p) => p.ready);
}

/** Withdraw everyone's standing consent — the setup they agreed to changed. */
function clearReady(world) {
  for (const pl of Object.values(world.players)) pl.ready = false;
}

/**
 * Called each host tick during the convention so the leave-edge resolves: if
 * the last founder who hadn't readied simply closes their tab, the founders who
 * *did* consent are not left staring at a full ready meter that never fires.
 */
export function beginSeasonIfReady(world) {
  if (world.phase !== 'convention') return;
  if (readyGate(world).ok && allReady(world)) beginSeason(world);
}

/**
 * The convention adjourns and the republic starts breathing: drop the empty
 * offices, redraw the districts to match the chamber the founders wrote, stamp
 * the founding terms, and flip the world live.
 */
/**
 * Give every persona a home district, spreading the founders one to a district
 * before doubling any of them up — a table of three founders should be three
 * separate constituencies, not three neighbours.
 *
 * A founder who has already claimed a district chair keeps that district: the
 * chair they took at the convention is the seat they mean to hold, so it decides
 * where they live rather than the other way round.
 */
export function assignHomeDistricts(world) {
  const ds = world.districts;
  if (!ds.length) return;
  const count = Object.fromEntries(ds.map((d) => [d.id, 0]));

  // A claimed district chair settles that founder's home before anyone is spread.
  for (const seat of world.seats) {
    if (!seat.district || !seat.personaId) continue;
    const p = world.personas[seat.personaId];
    if (!p) continue;
    p.district = seat.district;
    if (count[seat.district] != null) count[seat.district]++;
  }

  // Then the rest, always into whichever district is currently the emptiest, so
  // the first pass puts one person in each before a second lands anywhere.
  const rest = Object.values(world.personas).filter((p) => !p.district);
  // Players first, so the founders are the ones guaranteed distinct districts.
  rest.sort((a, b) => (a.playerId ? 0 : 1) - (b.playerId ? 0 : 1));
  for (const p of rest) {
    const home = ds.reduce((a, b) => (count[b.id] < count[a.id] ? b : a), ds[0]);
    p.district = home.id;
    count[home.id]++;
  }
}

function beginSeason(world) {
  const dropped = world.constitution.offices.filter((o) => o.seats < 1).map((o) => o.name);
  if (dropped.length) {
    world.constitution.offices = world.constitution.offices.filter((o) => o.seats > 0);
    R.repairConstitution(world.constitution);
    world.seats = world.seats.filter((s) => R.office(world, s.office));
  }
  // The map is re-cut to the constitution the founders actually wrote — but to
  // the chamber that *represents states*, not the one whose seats are
  // apportioned. The House can be forty-five seats over twenty states; reading
  // the district count off it would have cut the country into forty-five pieces
  // and given the Senate forty-five members.
  //
  // And the seats are then dealt across those states **once**, by
  // assignDistrictSeats, which is the same function that dealt them at world
  // creation. It used to be a second, different round-robin here, which is where
  // "a district drawn at ratification" came from: the chair a founder took at the
  // convention was not necessarily the electorate they ended up sitting for.
  const c0 = world.constitution;
  const districted = c0.offices.find((o) => o.electorate === 'district' && o.seats > 0 && !o.apportioned)
    || c0.offices.find((o) => o.electorate === 'district' && o.seats > 0);
  if (districted) {
    const changed = reshapeDistricts(world, districted.seats);
    assignDistrictSeats(world);
    if (changed) log(world, 'founding', `${world.nation} is cut into ${world.districts.length} states, one per seat of the ${districted.name}.`);
  }

  // Everyone lives somewhere. A district seat is filled by the people who live
  // in that district, so a persona without a home district can never win one —
  // which is exactly what used to happen to founders, who were created with no
  // district at all and were then filtered straight out of every district race
  // they stood in. Assign homes now, after the map has been re-partitioned to
  // match the constitution, so the districts being handed out are the real ones.
  assignHomeDistricts(world);

  world.phase = 'live';
  world.clock.tick = 1;
  const c = world.constitution;
  const readied = Object.values(world.players).filter((p) => p.ready).length
    || Object.keys(world.players).length;
  if (dropped.length) log(world, 'founding', `Established without ${dropped.join(' or ')}: the convention gave it no seats.`);
  log(world, 'founding', `${c.name} is ratified by ${readied} founder(s). ${world.nation} exists.`, { weight: 6 });
  log(world, 'founding', c.preamble, { weight: 2 });
  // Anything still empty gets a seated citizen; a state cannot wait.
  fillVacantSeats(world);
  // Every seat starts its term at the founding — including the chairs the
  // founders took for themselves. Without this a player-held office had a null
  // termEnds and never came up for election, so a founding president ruled for
  // the life of the Season and no presidential vote ever fired.
  for (const seat of world.seats) {
    const o = R.office(world, seat.office);
    if (!o || !seat.personaId) continue;
    if (seat.termEnds == null) {
      seat.since = 1;
      seat.termEnds = 1 + R.termTicks(world, o);
    }
    // The founding term counts against the limit — separately from the clock
    // above, because a chair a founder claimed from a seated citizen already
    // carries that citizen's termEnds and would be skipped by the guard.
    //
    // A president who takes the chair at ratification and is then elected twice
    // has served three terms, and the constitution allows two. Without this the
    // founding term was free and the first president of every republic got an
    // extra one nobody else did. Recorded, not honeymooned — the oath's own bump
    // is rules.honeymoonNudge, and it fires at the oath.
    if (R.termLimitOf(o)) R.recordTerm(world, seat.personaId, o.id);
  }
  // Every founder starts with a printing press. A paper is the one lever a
  // player holds regardless of which chair they took (or lost), so hand each
  // seated player one at the founding rather than making them found it by hand.
  const paperNames = ['Ledger', 'Herald', 'Tribune', 'Gazette', 'Dispatch', 'Sentinel', 'Courier', 'Beacon'];
  // Most nations are named "The Something", so pasting the name straight into
  // "The X Ledger" produced "The The Silver Republic Ledger".
  const bare = bareNation(world.nation);
  let pn = 0;
  for (const pl of Object.values(world.players)) {
    const pid = pl.personaId;
    if (!pid || M.outletsOf(world, pid).length) continue;
    M.foundOutlet(world, { name: `The ${bare} ${paperNames[pn++ % paperNames.length]}`, ownerPersonaId: pid });
  }

  for (const o of c.offices) {
    const holders = R.holders(world, o.id).map((h) => h.name).join(', ');
    if (holders) log(world, 'office', `${o.name}: ${holders}.`);
  }
}

/** Players still counted for table motions — those whose tab is alive. */
export function activePlayers(world) {
  const cut = Date.now() - GONE_AFTER;
  return Object.values(world.players).filter((p) => (p.lastSeen || p.joined || 0) > cut);
}

/** Take a player off the board. Their persona persists, now run by the AI. */
export function removePlayer(world, playerId, why = 'leaves the table') {
  const pl = world.players[playerId];
  if (!pl) return;
  const per = world.personas[pl.personaId];
  // Leave a note on the persona saying who was playing it. A reload comes
  // through here — `pagehide` dispatches LEAVE — and the JOIN a second later
  // needs to be able to find its way back. See reclaimable().
  if (per) {
    per.playerId = null;
    per.synthetic = true;
    per.wasPlayer = { id: playerId, color: pl.color, moderator: !!pl.moderator, at: Date.now() };
  }
  delete world.players[playerId];
  delete (world.drafting || {})[playerId];
  delete (world.deliberating || {})[playerId];
  log(world, 'system', `${pl.name} ${why}. Their persona passes to the republic.`, { weight: 1 });
  // Hand moderation to someone still present, so the table is never leaderless.
  if (pl.moderator) {
    const heir = Object.values(world.players)[0];
    if (heir) heir.moderator = true;
  }
  reevaluateMotion(world);
}

/**
 * Called each tick by the host: any player whose tab has gone silent is
 * removed, so a closed tab can't hold a wipe or pause hostage.
 */
export function prunePlayers(world) {
  const cut = Date.now() - GONE_AFTER;
  for (const p of Object.values(world.players)) {
    if ((p.lastSeen || p.joined || 0) <= cut) removePlayer(world, p.id, 'has left');
  }
}

/**
 * When the electorate changes under an open motion — someone leaves, or is
 * pruned — re-count it against who is actually still here, and carry or fail
 * it if the new arithmetic already decides it.
 */
export function reevaluateMotion(world) {
  const m = world.motion;
  if (!m || m.closed) return;
  const activeIds = new Set(activePlayers(world).map((p) => p.id));
  const yea = Object.entries(m.votes).filter(([id, v]) => v === 'yea' && activeIds.has(id)).length;
  const nay = Object.entries(m.votes).filter(([id, v]) => v === 'nay' && activeIds.has(id)).length;
  m.eligible = Math.max(1, activeIds.size);
  m.needed = Math.floor(m.eligible / 2) + 1;
  if (yea >= m.needed) resolveMotion(world, m, true);
  else if (nay > m.eligible - m.needed) resolveMotion(world, m, false);
}

export const MOTIONS = {
  pause: { label: 'pause the world', verb: 'Pause' },
  resume: { label: 'resume the world', verb: 'Resume' },
  reset: { label: 'wipe this Season and start over', verb: 'Reset' },
  end: { label: 'end the Season now', verb: 'End' },
};
const motionLabel = (m) => MOTIONS[m.kind]?.label || m.kind;

/**
 * Stopping the clock is not something that happens in the republic.
 *
 * The Chronicle is the record of a country, written from inside it, and a
 * pause is four people agreeing to get a coffee. It was landing in the history
 * between a war and an impeachment — and worse, it is the one entry that
 * accumulates, so a table that broke for lunch twice a session ended up with a
 * record that was half its own scheduling. Wiping and ending the Season stay:
 * a Season that was abandoned is a fact about the Season.
 */
const OUT_OF_GAME = new Set(['pause', 'resume']);

function resolveMotion(world, m, passed) {
  m.closed = true; m.passed = passed;
  const solo = m.eligible <= 1;
  if (!passed) {
    if (!OUT_OF_GAME.has(m.kind)) log(world, 'system', `The motion to ${motionLabel(m)} fails.`, { weight: 2 });
    return;
  }
  if (m.kind === 'pause') {
    world.paused = { since: Date.now(), by: m.by };
  } else if (m.kind === 'resume') {
    world.paused = null;
  } else if (m.kind === 'reset') {
    world.resetApproved = { at: Date.now(), by: m.by };
    log(world, 'system', `The table agrees to wipe the Season.`, { weight: 3 });
  } else if (m.kind === 'end') {
    // Ending is a table decision, exactly like wiping. Unlike a wipe, the
    // record survives — so the motion passing simply ends it, no second click.
    endSeason(world, m.payload?.epitaph);
  }
}

function obituaryLine(world, p) {
  const acts = world.chronicle.filter((e) => e.actors.includes(p.id)).length;
  return `${p.name}: ${acts} acts of record, final approval ${Math.round(p.approval)}%.`;
}

/**
 * The three conditions a persona does not act from, and what to call them.
 *
 * Death, exile and imprisonment are the game's three ways of taking somebody
 * off the board — the whole design of losing rests on them (see NEW_PERSONA,
 * which will only roll you a fresh persona once one of the three is true). Two
 * of the three are recoverable: a pardon lifts imprisonment and exile can be
 * reversed, so this blocks acting *while* in the state rather than assuming it
 * is the end.
 */
const incapableBy = (p) => (!p ? null
  : !p.alive ? 'dead'
    : p.exiled ? 'in exile'
      : p.imprisoned ? 'in prison' : null);

/**
 * What still works from there.
 *
 * Everything out-of-game — the table's own admin, presence, moderation — plus
 * the one action that is the way back in. A player whose persona has just been
 * executed is not locked out of the table; they are one click from a new one.
 */
const OUT_OF_BODY = new Set([
  'JOIN', 'LEAVE', 'PING', 'SET_NAME', 'NEW_PERSONA', 'MOD',
  'TABLE_MOTION', 'MOTION_VOTE', 'MOTION_CANCEL', 'SET_TIMESCALE',
  'DRAFTING', 'DELIBERATE', 'ACKNOWLEDGE',
]);

/**
 * Whether this action is refused because of the state of the persona taking it.
 *
 * Individual handlers already asked this in places — nominate() will not let a
 * dead persona stand, company.mayFound will not let an exile trade — but only
 * in places. The gaps were the consequential ones: a dead persona could draft a
 * bill, put it on the floor, watch it pass into law, and vote on the floor of
 * the chamber while it did. The rollcall printed the corpse's name against a
 * yea. Asking once, here, is the only way this stays true of every action
 * rather than of the ones somebody remembered.
 */
function refusedForState(world, action) {
  if (OUT_OF_BODY.has(action.type)) return null;
  const p = world.personas[world.players[action.playerId]?.personaId];
  const state = incapableBy(p);
  if (!state) return null;
  // Speaking is not acting, and a game about betrayal should let somebody send
  // word from a cell. The dead say nothing.
  if (action.type === 'CHAT' && state !== 'dead') return null;
  return state === 'dead'
    ? `${p.name} is dead. Roll a new persona to carry on — you keep your reputation.`
    : `${p.name} is ${state}, and cannot act from there.`;
}

export function apply(world, action) {
  const h = HANDLERS[action.type];
  if (!h) { console.warn('unknown action', action.type); return world; }
  const refused = refusedForState(world, action);
  if (refused) notice(world, action.playerId, refused);
  else try { h(world, action); } catch (e) { console.error('action failed', action, e); notice(world, action.playerId, 'That action failed: ' + e.message); }
  const actor = world.players[action.playerId];
  if (actor) actor.lastSeen = Date.now();
  world.lastActivity = Date.now();
  world.rev = (world.rev || 0) + 1;
  return world;
}

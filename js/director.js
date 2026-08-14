// The drama engine.
//
// Every Silver death certificate reads the same: boredom. The director watches
// the pulse of the Season and, during lulls, injects an event calibrated to the
// canon dial. Events are prompts, not scripts — they demand a response and then
// get out of the way.

import { uid, clamp, pick, rng, chance, money, moneyExact, byId, nudgeMood, nudgeMoodAll, nudgeApproval } from './util.js';
import { log } from './chronicle.js';
import { CANON } from './rules.js';
import * as R from './rules.js';
import * as A from './acts.js';
import { recomputeEconomy, BUILDINGS } from './world.js';

const needs = (world, tag) => !tag || (CANON[world.canon]?.allow || []).includes(tag);

/**
 * Answering a crisis with an intrigue action has to leave the trace that action
 * would normally leave, or the Intrigue tab shows nothing and the choice looks
 * like it did nothing. `world.investigations` is the only thing that tab reads
 * for inquiries, and `world.intel` the only thing it reads for what was learned.
 */
function fileInquiry(world, byId, result, extra = {}) {
  world.investigations = world.investigations || [];
  world.investigations.push({ id: uid('inv'), by: byId || null, tick: world.clock.tick, result, ...extra });
}
function fileIntel(world, text) {
  world.intel = world.intel || [];
  world.intel.push({ id: uid('int'), text, tick: world.clock.tick });
}

// --- Inquests — an investigation that ends ---------------------------------
// Opening an investigation used to set `underInvestigation` on a persona and
// leave it there. It cost them 0.8 merit in every assembly vote they ever
// brought again, for the rest of the Season, with no charge, no hearing and no
// way to answer it. An open file that never closes is not a check on power, it
// is a permanent sentence handed down by a crisis card.
//
// So a file has a clock and a finding. It runs about half a canon year and then
// concludes one of three ways — charges, no finding, or cleared — weighed
// against what the world actually records about the subject rather than a coin
// toss. Charges leave a mark the chamber and the court can both act on. Being
// cleared costs the officeholder who opened it, because a failed prosecution
// should.

const inquestTicks = (world) => Math.max(60, Math.round((world.clock.ticksPerYear || 240) * 0.55));

/** Open a file on someone. */
export function openInquest(world, { subjectId, byId, over }) {
  const p = world.personas[subjectId];
  if (!p) return null;
  world.inquests = world.inquests || [];
  if (world.inquests.some((q) => q.subjectId === subjectId && !q.finding)) return null; // already open
  p.underInvestigation = true;
  const q = {
    id: uid('inq'), subjectId, byId: byId || null, over: over || 'the file',
    opened: world.clock.tick, due: world.clock.tick + inquestTicks(world),
    finding: null, concludedAt: null,
  };
  world.inquests.push(q);
  return q;
}

/**
 * What the record says about them. Not a verdict on the crisis card that opened
 * the file — a reading of everything they have actually done since.
 */
function weighInquest(world, q) {
  const p = world.personas[q.subjectId];
  const reasons = [];
  let score = 0.34;
  if (p.reputation < 0) { score += Math.min(0.24, -p.reputation * 0.05); reasons.push('a reputation already in the ledger'); }
  else if (p.reputation > 2) { score -= Math.min(0.16, p.reputation * 0.03); reasons.push('a clean public record'); }
  if ((world.turned || []).includes(p.id)) { score += 0.22; reasons.push('money that has changed hands'); }
  const con = (world.conspiracies || []).find((c) => c.exposed && c.members?.includes(p.id));
  if (con) { score += 0.26; reasons.push(`their name inside ${con.name}`); }
  if ((world.spies || []).some((s) => s.ownerPersonaId === p.id && s.exposed)) { score += 0.14; reasons.push('an agent of theirs already burned'); }
  // Their own acts. A law of theirs the court has struck is the plainest thing a
  // prosecutor can hold up.
  const struck = (world.laws || []).concat(Object.keys(world.documents || {}))
    .map((id) => world.documents[id]).filter((d) => d && d.authorId === p.id && d.struck).length;
  if (struck) { score += Math.min(0.18, struck * 0.09); reasons.push('an act of theirs already struck down'); }
  if ((p.saidDisrepute || []).length) { score += 0.1; reasons.push('what they have said on the record'); }
  // Nothing in the record is decisive on its own, so the roll matters — but it is
  // a roll on top of the record, not instead of it.
  score += (rng(world) - 0.5) * 0.3;
  return { score: clamp(score, 0, 1), reasons };
}

/** Close every file whose clock has run out. */
export function tickInquests(world) {
  for (const q of world.inquests || []) {
    if (q.finding || world.clock.tick < q.due) continue;
    const p = world.personas[q.subjectId];
    if (!p) { q.finding = 'lapsed'; q.concludedAt = world.clock.tick; continue; }
    const { score, reasons } = weighInquest(world, q);
    const opener = world.personas[q.byId];
    const why = reasons.length ? reasons.slice(0, 2).join(' and ') : 'nothing either way';
    q.concludedAt = world.clock.tick;
    p.underInvestigation = false;

    if (score >= 0.62) {
      q.finding = 'charged';
      p.charges = [...(p.charges || []), 'corruption'];
      p.reputation = clamp((p.reputation || 0) - 2, -10, 10);
      nudgeApproval(p, -14);
      bump(world, -3);
      fileInquiry(world, q.byId, `Closed on ${p.name} with charges: ${why}.`, { subject: p.id, finding: 'charged' });
      log(world, 'intrigue', `The file on ${p.name} closes with a charge of corruption — ${why}. It is the chamber's business now, and the court's.`,
        { actors: [p.id], weight: 4 });
    } else if (score <= 0.34) {
      q.finding = 'cleared';
      p.reputation = clamp((p.reputation || 0) + 0.5, -10, 10);
      nudgeApproval(p, 8);
      // A prosecution that finds nothing is itself an act with a cost. Whoever
      // opened it wears it — otherwise opening files on rivals would be free.
      if (opener && opener.id !== p.id) {
        nudgeApproval(opener, -6);
        opener.reputation = clamp((opener.reputation || 0) - 0.5, -10, 10);
      }
      fileInquiry(world, q.byId, `Closed on ${p.name} with no case to answer: ${why}.`, { subject: p.id, finding: 'cleared' });
      log(world, 'intrigue', `${p.name} is cleared. The file found ${why}, and the investigation is now the story`
        + (opener && opener.id !== p.id ? `, along with ${opener.name} for opening it.` : '.'),
        { actors: [p.id, opener?.id].filter(Boolean), weight: 3 });
    } else {
      q.finding = 'inconclusive';
      nudgeApproval(p, -3);
      fileInquiry(world, q.byId, `Closed on ${p.name} without a finding: ${why}.`, { subject: p.id, finding: 'inconclusive' });
      log(world, 'intrigue', `The file on ${p.name} closes without a finding. ${why[0].toUpperCase()}${why.slice(1)} — and no charge either way. It will be remembered as unproven, which is not untrue.`,
        { actors: [p.id], weight: 2 });
    }
  }
}

/** The file open on someone, if there is one. */
export const openInquestOn = (world, personaId) =>
  (world.inquests || []).find((q) => q.subjectId === personaId && !q.finding) || null;

export const EVENTS = [
  {
    id: 'recession', title: 'The bottom falls out', tag: null, weight: 3,
    intro: (w) => `Receipts are down across ${pick(w, w.districts).name}. Two factories are on short shifts and the credit agency has called twice.`,
    options: [
      { label: 'Stimulus: spend 12M on public works', cost: 12e6, apply: (w) => { w.economy.treasury -= 12e6; w.economy.slump = 0.4; bump(w, 3); } },
      { label: 'Austerity: cut programs, hold the line', apply: (w) => { w.programs = []; w.economy.slump = 1.1; bump(w, -5); recomputeEconomy(w); } },
      { label: 'Do nothing and say it is cyclical', apply: (w) => { w.economy.slump = 1.5; bump(w, -3); } },
    ],
    ignore: (w) => { w.economy.slump = 1.8; bump(w, -7); log(w, 'crisis', 'The recession deepens while the government says nothing. Unemployment climbs.', { weight: 3 }); },
  },
  {
    id: 'housing', title: 'Encampment on the steps', tag: null, weight: 3,
    intro: (w) => {
      const d = w.districts.slice().sort((a, b) => b.homeless - a.homeless)[0];
      return `${d.homeless.toLocaleString()} people in ${d.name} have nowhere to sleep, and about two hundred of them are now sleeping in front of the assembly building.`;
    },
    options: [
      { label: 'Emergency housing appropriation (8M)', cost: 8e6, apply: (w) => { w.economy.treasury -= 8e6; const d = worst(w, 'homeless'); d.homeless = Math.round(d.homeless * 0.6); nudgeMood(d, 7); } },
      { label: 'Clear the encampment', apply: (w) => { const d = worst(w, 'homeless'); nudgeMood(d, -9); d.order += 6; log(w, 'crisis', `The encampment in ${d.name} is cleared before dawn.`, { weight: 2 }); } },
      { label: 'Meet with them publicly', apply: (w) => { const d = worst(w, 'homeless'); nudgeMood(d, 3); d.salience.housing = clamp(d.salience.housing + 0.25, 0, 1.6); } },
    ],
    ignore: (w) => { const d = worst(w, 'homeless'); nudgeMood(d, -8); d.salience.housing = 1.5; log(w, 'crisis', `The encampment in ${d.name} becomes permanent. It has a name now.`, { weight: 2 }); },
  },
  {
    id: 'scandal', title: 'A document surfaces', tag: null, weight: 3,
    intro: (w) => {
      const t = randomOfficeholder(w);
      return `An envelope has reached three newsrooms: a ledger page, initialled, appearing to put ${t ? t.name : 'a senior officeholder'} on both sides of a public contract.`;
    },
    setup: (w, ev) => { const t = randomOfficeholder(w); ev.subject = t?.id || null; },
    options: [
      {
        label: 'Open an investigation',
        apply: (w, ev, byId) => {
          const p = w.personas[ev.subject];
          if (p) { nudgeApproval(p, -6); openInquest(w, { subjectId: p.id, byId, over: 'the ledger page' }); }
          bump(w, 2);
          fileInquiry(w, byId, p
            ? `Opened into ${p.name} over the ledger page. The file is open, they know it, and it will report.`
            : 'Opened over the ledger page. No name is on the file yet.', { subject: ev.subject || null });
          log(w, 'intrigue', `An investigation is opened into ${p?.name || 'a senior officeholder'} over the ledger page.`,
            { actors: [ev.subject].filter(Boolean), weight: 3 });
        },
      },
      { label: 'Denounce it as a forgery', apply: (w, ev) => { const p = w.personas[ev.subject]; nudgeApproval(p, -2); bump(w, -2); } },
      { label: 'Say nothing', apply: (w, ev) => { const p = w.personas[ev.subject]; nudgeApproval(p, -12); bump(w, -4); } },
    ],
    ignore: (w, ev) => { const p = w.personas[ev.subject]; nudgeApproval(p, -15); bump(w, -5); log(w, 'crisis', 'The ledger page runs on every front page. Nobody has answered it.', { weight: 3 }); },
  },
  {
    id: 'eruption', title: 'Kiln Hill is venting', tag: null, weight: 1,
    intro: (w) => `Ash on the washing lines in three districts. The geologists were asked in Year ${Math.max(1, (w.clock.foundingYear))} for a monitoring budget and did not get one.`,
    options: [
      { label: 'Evacuate two districts (6M)', cost: 6e6, apply: (w) => { w.economy.treasury -= 6e6; bump(w, 4); } },
      { label: 'Issue advisories only', apply: (w) => { bump(w, -3); damage(w, 2); } },
    ],
    ignore: (w) => { bump(w, -9); damage(w, 5); log(w, 'crisis', 'The eruption takes a quarter of Kiln Hill with it.', { weight: 4 }); },
  },
  {
    id: 'canada', title: 'Canada is moving', tag: 'war', weight: 2,
    intro: (w) => `Canada has moved three divisions to the border and its radio now calls ${w.nation} "the disputed territories."`,
    // Moving three divisions to the border *is* the hostility. Before this, the
    // number on the World tab did not move until we answered — so a player who
    // checked the board the moment the crisis broke saw a neighbour at peace
    // while its radio was calling their country disputed territory. The
    // responses still move it from here; this is the ground it moves from.
    setup: (w) => {
      const f = byId(w.foreign, 'canada');
      if (f) f.hostility = Math.min(100, f.hostility + 18);
    },
    options: [
      { label: 'Mobilize (10M)', cost: 10e6, apply: (w) => { w.economy.treasury -= 10e6; w.military.units += 3; const f = byId(w.foreign, 'canada'); f.hostility -= 8; bump(w, -2); } },
      // Talking has to be worth doing. This used to take back 15 of the 18 the
      // crisis had just added, so the bar on the World tab still sat higher
      // after negotiating than before Canada moved, and the one response that
      // is supposed to defuse things read as having failed.
      { label: 'Open negotiations', apply: (w) => { const f = byId(w.foreign, 'canada'); f.hostility = Math.max(0, f.hostility - 28); bump(w, 2); log(w, 'war', 'Talks open with Canada. The divisions stay put, but the radio changes its tone.', { weight: 2 }); } },
      // Clamped, like every other write to this number. These two were not, and
      // a card answered badly twice put Canada's hostility at 112 — off the
      // end of a bar that runs to a hundred, and past the point where anything
      // diplomatic could bring it back inside a Season.
      { label: 'Denounce them publicly', apply: (w) => { const f = byId(w.foreign, 'canada'); f.hostility = clamp(f.hostility + 12, 0, 100); bump(w, 4); } },
    ],
    ignore: (w) => { const f = byId(w.foreign, 'canada'); f.hostility = clamp(f.hostility + 25, 0, 100); log(w, 'war', 'Canada reads silence as invitation. Border posts are taken overnight.', { weight: 4 }); },
  },
  {
    id: 'spycaught', title: 'A courier is stopped', tag: 'spy', weight: 2,
    intro: (w) => `A man was stopped at the Harborlight tollgate with a folded map of the assembly building and a list of names in an unknown hand.`,
    options: [
      {
        label: 'Interrogate him',
        apply: (w, ev, byId) => {
          const s = (w.spies || []).find((x) => x.active);
          if (s) { s.exposure = clamp(s.exposure + 35, 0, 100); }
          bump(w, 1);
          fileInquiry(w, byId, s
            ? `The courier talked. An agent in the field is now badly exposed.`
            : 'The courier talked, and named nobody the state has heard of.');
          fileIntel(w, s
            ? 'A courier broke under questioning. Anyone running an agent should assume they are burned.'
            : 'A courier broke under questioning and gave up nothing that maps to a known name.');
        },
      },
      { label: 'Release him and follow him', apply: (w) => { fileIntel(w, 'A courier was released under surveillance. Someone will meet him.'); } },
      {
        label: 'Hang him',
        apply: (w) => {
          bump(w, -6);
          fileIntel(w, 'The courier was hanged before questioning. Whatever he knew died on the tollgate road.');
          log(w, 'death', 'The courier is executed on the tollgate road. He never gave a name.', { weight: 3 });
        },
      },
    ],
    ignore: (w) => { w.intel.push({ id: uid('int'), text: 'The courier walked out of the tollhouse during the shift change.', tick: w.clock.tick }); },
  },
  {
    id: 'nexus', title: 'The Nexus cell', tag: 'occult', weight: 1,
    intro: (w) => `Four bodies in the Terraces, arranged. The mark is the one from the old file everyone agreed was a hoax.`,
    options: [
      {
        label: 'Raid the meeting house',
        apply: (w, ev, byId) => {
          bump(w, 3); damage(w, 1);
          fileInquiry(w, byId, 'The meeting house was raided. Papers, robes, and initials nobody can match to a name.');
          fileIntel(w, 'Seized at the Nexus meeting house: initials. Someone on the list sits in this government.');
        },
      },
      { label: 'Infiltrate quietly', apply: (w) => { fileIntel(w, 'An agent is inside the Nexus cell. They meet on the eighth.'); } },
      {
        label: 'Suppress the story',
        apply: (w) => {
          bump(w, -1); w.suppressed = (w.suppressed || 0) + 1;
          fileIntel(w, 'The Terraces killings were kept out of the papers. Whoever did it knows the state blinked.');
        },
      },
    ],
    ignore: (w) => { bump(w, -6); log(w, 'crisis', 'Four more in the Terraces. The mark is on the assembly door now.', { weight: 3 }); },
  },
  {
    id: 'strike', title: 'The yards stop', tag: null, weight: 2,
    intro: (w) => `Every crane in Ironside is stationary. The union wants income tax rolled back and a housing bill on the floor by Friday.`,
    options: [
      // The tax the union wants rolled back is the chamber's to set, never the
      // executive's — so there is no unilateral cut on this card, whatever
      // powers a President has accrued. Relief comes one of two ways: declare a
      // state of emergency and govern through it, or put the cut to the chamber.
      // Declaring one here answers a real crisis, so it is not the naked grab
      // that declaring on nothing is (see declareEmergency, emergencyCause).
      { label: 'Declare a state of emergency', power: 'emergency',
        apply: (w, ev, personaId) => {
          declareEmergency(w, personaId, 'The yards are stopped and the republic\'s industry is at a standstill.');
        } },
      // For an executive that does not hold the tax power itself: the strike
      // becomes the reason the bill exists. A one-point cut is drafted on the
      // spot and put to the chamber under the answerer's name. The card is
      // resolved either way — the crisis was answered — but what happens next
      // is on the floor, which is what "refer" means. See acts.CLAUSES.SET_TAX
      // for the mechanic the bill carries.
      { label: 'Refer a cut to the assembly',
        apply: (w, ev, personaId) => {
          const cur = (w.economy.taxes.income || 0) * 100;
          const to = Math.max(0, cur - 1);
          const doc = A.createDoc(w, {
            type: 'bill', title: 'The Ironside Wage Relief Act', authorId: personaId,
            preamble: 'The yards being stopped and the union having demanded relief, the chamber is asked to cut the rate of income tax by one point.',
            clauses: [
              { kind: 'PROSE', text: 'Whereas Ironside is stopped and the strike spreads if left alone.' },
              { kind: 'SET_TAX', tax: 'income', rate: to },
            ],
          });
          if (doc?.id) A.introduce(w, doc.id, personaId, 90);
          // A referral is not a settlement; it is a promise to try. Small,
          // because the mood is not moved by a piece of paper, it is moved by
          // whether the paper passes.
          bump(w, 1);
          log(w, 'crisis', `The Ironside Wage Relief Act is laid before the chamber. The strike waits on the vote.`,
            { actors: [personaId].filter(Boolean), docId: doc?.id, weight: 2 });
        } },
      { label: 'Break the strike', apply: (w) => { bump(w, -8); worst(w, 'unemployment').order += 10; } },
      { label: 'Wait them out', apply: (w) => { w.economy.slump = 0.6; bump(w, -2); } },
    ],
    ignore: (w) => { w.economy.slump = 1.2; bump(w, -6); log(w, 'crisis', 'The strike spreads to the port. Nothing moves.', { weight: 3 }); },
  },
  {
    id: 'fire', title: 'Fire in the Fourth Ward', tag: null, weight: 2,
    intro: (w) => `Two blocks of the Fourth Ward went up before midnight. The sewer works that would have carried it was voted down.`,
    options: [
      { label: 'Rebuild at public cost (5M)', cost: 5e6, apply: (w) => { w.economy.treasury -= 5e6; bump(w, 5); } },
      { label: 'Leave it to the insurers', apply: (w) => { bump(w, -5); damage(w, 2); } },
    ],
    ignore: (w) => { bump(w, -7); damage(w, 3); },
  },
];

function worst(w, key) { return w.districts.slice().sort((a, b) => b[key] - a[key])[0]; }
function bump(w, n) { nudgeMoodAll(w, n); }
function damage(w, n) {
  const built = w.city.parcels.filter((p) => p.building);
  for (let i = 0; i < n && built.length; i++) {
    const p = pick(w, built);
    p.building = null; p.landValue = Math.round(p.landValue * 0.7);
  }
  recomputeEconomy(w);
}
function randomOfficeholder(w) {
  const seated = w.seats.filter((s) => s.personaId).map((s) => w.personas[s.personaId]).filter(Boolean);
  // `pick`, not Math.random: which officeholder a crisis lands on is a decision
  // the simulation makes, and every decision the simulation makes comes off
  // world.rngState. See the note on util.rng.
  return seated.length ? pick(w, seated) : null;
}

/**
 * Which crises this Season can still produce: allowed by the canon dial, and
 * not already lived through. A crisis is a story beat, and the second telling
 * is never the first — the same ledger page surfacing twice reads as the engine
 * repeating itself rather than the nation having a history.
 */
export function unfiredEvents(world) {
  const fired = new Set(world.firedEvents || []);
  return EVENTS.filter((e) => needs(world, e.tag) && !fired.has(e.id));
}

/** Fire an event by id (used by the director and by moderators). */
export function fire(world, eventId) {
  const tpl = EVENTS.find((e) => e.id === eventId);
  if (!tpl) return { ok: false, reason: 'No such event.' };
  // Once lived through, a crisis is spent for the rest of the Season — however
  // it was fired, so a moderator cannot hand out the same one twice either.
  world.firedEvents = world.firedEvents || [];
  if (world.firedEvents.includes(tpl.id)) return { ok: false, reason: `${tpl.title} has already happened this Season. A crisis does not repeat.` };
  world.firedEvents.push(tpl.id);
  const ev = {
    uid: uid('ev'), id: tpl.id, title: tpl.title,
    text: tpl.intro(world),
    options: tpl.options.map((o, i) => ({ i, label: o.label, cost: o.cost || 0 })),
    opened: world.clock.tick, deadline: world.clock.tick + 120,
    resolved: null, resolvedBy: null, choice: null,
  };
  if (tpl.setup) tpl.setup(world, ev);
  world.events.unshift(ev);
  world.directorCooldown = 220;
  log(world, 'crisis', `${tpl.title}. ${ev.text}`, { weight: 3 });
  return { ok: true, value: ev };
}

export function respond(world, evUid, optionIndex, personaId) {
  const ev = world.events.find((e) => e.uid === evUid);
  if (!ev || ev.resolved) return { ok: false, reason: 'That crisis is closed.' };
  if (ev.notice) return { ok: false, reason: 'That is a notice. It takes no response but acknowledgement.' };
  // The chair answers. See rules.mayAnswerCrisis — this is the door, and it is
  // here rather than in the UI because the card renders for the whole republic
  // and only one person in it is being asked the question.
  if (!R.mayAnswerCrisis(world, personaId)) {
    const head = R.headOffice(world);
    return { ok: false, reason: `This is put to the ${head?.name || 'executive'}, and you do not hold that office.` };
  }
  const tpl = EVENTS.find((e) => e.id === ev.id);
  // A card with no template behind it takes no options, and asking for one
  // threw rather than refusing.
  const opt = tpl?.options?.[optionIndex];
  if (!opt) return { ok: false, reason: 'No such response.' };
  // An option that exercises a constitutional power needs that power. Money
  // already went through this door (below); everything else walked straight
  // past it, so a President could cut a rate of taxation from a crisis card
  // that the constitution reserves to the chamber.
  if (opt.power && !R.hasPower(world, personaId, opt.power)) {
    return { ok: false, reason: `That answer exercises ${R.powerLabel(opt.power).toLowerCase()}, and your office does not hold it. Put it to the chamber instead.` };
  }
  if (opt.cost) {
    if (!R.hasPower(world, personaId, 'spend'))
      return { ok: false, reason: `That response costs ${moneyExact(opt.cost)} and your office does not hold the power to disburse.` };
    const rule = R.spendRule(world, opt.cost);
    if (rule.requires && !(world.emergency && world.emergency.active))
      return { ok: false, reason: `${R.spendClauseText(world, opt.cost)} Declare an emergency or pass a bill.` };
    if (opt.cost > world.economy.treasury)
      return { ok: false, reason: `The treasury holds ${moneyExact(world.economy.treasury)}.` };
  }
  // Who answered is passed through: an option that opens an investigation files
  // it under their name, the way one opened from the Intrigue tab would be.
  opt.apply(world, ev, personaId);
  // `|| 1`, not the bare tick. `resolved` holds the tick a card was closed on and
  // is read as a flag in twenty places across the director, intrigue and the UI —
  // and tick 0 is a real tick, so a crisis answered on the republic's first
  // second stamped itself 0, read everywhere as still open, and could be answered
  // a second time. The same trap the ballot seal fell into; there the reader was
  // fixed, here there are too many readers to be sure of catching them all, so
  // the stamp is made truthy instead. Nothing reads this back as a time.
  ev.resolved = world.clock.tick || 1; ev.resolvedBy = personaId; ev.choice = optionIndex;
  recomputeEconomy(world);
  log(world, 'crisis', `${world.personas[personaId]?.name || 'The government'} responds to ${ev.title.toLowerCase()}: ${opt.label}.`,
    { actors: [personaId].filter(Boolean), weight: 2 });
  return { ok: true };
}

/**
 * A notice: something that has already happened to you, filed on the Nation tab
 * beside the crises because that is where you look when the country wants you.
 *
 * It is not a crisis and must not be treated as one. There is nothing to
 * choose, so it carries no options; nothing resolves against you, so it carries
 * no deadline and never expires; and it does not lend the emergency power or
 * hold the director's queue, because a thing you have merely not clicked yet is
 * not an unanswered demand. You read it and press acknowledge.
 */
export function notice(world, title, text) {
  const ev = {
    uid: uid('ev'), id: null, notice: true, title, text,
    options: [], opened: world.clock.tick, deadline: null,
    resolved: null, resolvedBy: null, choice: null,
  };
  world.events.unshift(ev);
  return ev;
}

/** The only response a notice takes: you have seen it. */
export function acknowledge(world, evUid, personaId) {
  const ev = world.events.find((e) => e.uid === evUid);
  if (!ev) return { ok: false, reason: 'No such notice.' };
  if (!ev.notice) return { ok: false, reason: 'That is a crisis, not a notice. It wants an answer.' };
  if (ev.resolved) return { ok: false, reason: 'Already acknowledged.' };
  // Filing it clears the card for everybody, so it is the chair's to file.
  if (!R.mayAnswerCrisis(world, personaId)) {
    const head = R.headOffice(world);
    return { ok: false, reason: `The ${head?.name || 'executive'} files these. You may read it.` };
  }
  ev.resolved = world.clock.tick || 1; ev.resolvedBy = personaId; ev.choice = -1;
  return { ok: true };
}

/** Called each tick. Watches the pulse; injects when the pulse drops. */
export function tickDirector(world) {
  tickInquests(world);
  // Expire unanswered crises.
  for (const ev of world.events) {
    if (!ev.resolved && !ev.notice && world.clock.tick > ev.deadline) {
      const tpl = EVENTS.find((e) => e.id === ev.id);
      ev.resolved = world.clock.tick || 1; ev.choice = -1; ev.ignored = true;
      tpl?.ignore?.(world, ev);
      recomputeEconomy(world);
    }
  }
  // A state of emergency is not indefinite: it lapses on its own when its
  // constitutional clock runs out, and the power then needs time to recover.
  if (world.emergency?.active && world.emergency.ends && world.clock.tick >= world.emergency.ends) {
    expireEmergency(world);
  }
  if (world.phase !== 'live') return;
  world.directorCooldown--;

  // Pulse = weighted acts in the last 60 ticks.
  const since = world.clock.tick - 120;
  const pulse = world.chronicle.filter((e) => e.tick >= since && e.kind !== 'system')
    .reduce((a, e) => a + e.weight, 0);
  world.pulse = pulse;
  const open = world.events.filter((e) => !e.resolved && !e.notice).length;
  if (world.directorCooldown > 0 || open >= 2) return;
  const quiet = pulse < 6;
  if (!quiet && !chance(world, 0.002)) return;

  // Every crisis this canon allows has already been lived through: the nation
  // gets its quiet, rather than the same envelope reaching the newsrooms twice.
  const pool = unfiredEvents(world);
  const weighted = pool.flatMap((e) => Array(e.weight).fill(e));
  if (!weighted.length) { world.crisesSpent = true; return; }
  fire(world, pick(world, weighted).id);
}

// What counts as a genuine emergency: an open crisis on the board, an active
// uprising, or a nation already in acute distress. Absent all three, the power
// is a naked convenience and the constitution won't lend it.
export function emergencyCause(world) {
  // A notice is not a crisis: leaving one unread must not unlock the power.
  const openCrisis = (world.events || []).some((e) => !e.resolved && !e.notice);
  const uprising = !!(world.uprising && !world.uprising.resolved);
  const ds = world.districts || [];
  const avgMood = ds.length ? ds.reduce((s, d) => s + (d.mood ?? 50), 0) / ds.length : 50;
  const distress = avgMood < 35; // mood runs 0..100; below 35 is real unrest
  if (openCrisis) return { ok: true, why: 'an unanswered crisis' };
  if (uprising) return { ok: true, why: 'an active uprising' };
  if (distress) return { ok: true, why: 'a nation in acute distress' };
  return { ok: false };
}

/**
 * What the country is actually suffering from, as a set of tags.
 *
 * Emergency powers answer a situation, and the situation has a shape: a foreign
 * army is not a flood and neither one is an empty treasury. This is the ground
 * truth a stated justification gets measured against.
 */
export function emergencyFacts(world) {
  const facts = new Set();
  const open = (world.events || []).filter((e) => !e.resolved);
  if (open.length) facts.add('crisis');
  for (const e of open) {
    const tpl = EVENTS.find((x) => x.id === e.id);
    if (tpl?.tag === 'war' || e.id === 'canada') facts.add('foreign');
    if (tpl?.tag === 'spy' || tpl?.tag === 'coup') facts.add('foreign');
    if (e.id === 'recession') facts.add('money');
    if (e.id === 'eruption' || e.id === 'fire') facts.add('disaster');
    if (e.id === 'strike' || e.id === 'housing') facts.add('order');
  }
  for (const f of world.foreign || []) {
    if (f.atWar) facts.add('foreign');
    if (f.hostility >= 60) facts.add('foreign');
  }
  if (world.uprising && !world.uprising.resolved) { facts.add('rising'); facts.add('order'); }
  const ds = world.districts || [];
  const avg = (k, d0) => (ds.length ? ds.reduce((t, d) => t + (d[k] ?? d0), 0) / ds.length : d0);
  if (avg('mood', 50) < 35) facts.add('order');
  if (avg('order', 50) < 35) facts.add('order');
  const eco = world.economy || {};
  if (eco.treasury < 0 || (eco.slump || 0) > 1) facts.add('money');
  return facts;
}

// What a stated justification is claiming, read off its own words. The presets
// in the UI are written to land on these; free text is matched the same way, so
// a player who types their own reason is judged by what they actually said.
const CLAIM_WORDS = [
  ['foreign', /foreign power|invasion|invade|border|at war|canada|mexico|the sab|mobiliz|enemy|hostile power|abroad/i],
  ['rising', /armed rising|insurrection|rebellion|uprising|coup|mutiny|sedition/i],
  ['order', /public order|disorder|riot|looting|unrest|breakdown|lawless|street/i],
  ['money', /treasury|spending rule|fiscal|budget|recession|credit|insolven|cannot pay|payroll/i],
  ['disaster', /disaster|relief|flood|fire|eruption|earthquake|storm|epidemic|contagion/i],
];

export function emergencyClaims(reason) {
  const claims = new Set();
  for (const [tag, re] of CLAIM_WORDS) if (re.test(reason || '')) claims.add(tag);
  return claims;
}

/**
 * Was this justification a pretext?
 *
 * Only a specific claim can be false. "A crisis is running ahead of the
 * legislature" asserts nothing about *which* crisis, so it is unfalsifiable and
 * goes unpunished — that is the honest procedural reason, and the power exists
 * for it. But naming a foreign power when no foreign power is moving, or
 * disaster relief when nothing has burned, is a lie told to take a power with,
 * and the country is entitled to notice.
 *
 * Note this cannot fire unless emergencyCause() already said yes: there has to
 * be a real emergency to declare *and* a false story told about it. Declaring
 * one out of nothing is refused outright, and always was.
 */
export function emergencyPretext(world, reason) {
  const claims = emergencyClaims(reason);
  if (!claims.size) return null;                    // nothing specific asserted
  const facts = emergencyFacts(world);
  const met = [...claims].filter((c) => facts.has(c));
  if (met.length) return null;                      // at least one claim is true
  return { claimed: [...claims], actual: [...facts] };
}

const PRETEXT_WORDS = {
  foreign: 'a foreign power moving against us',
  rising: 'an armed rising',
  order: 'a breakdown of public order',
  money: 'a treasury that cannot answer',
  disaster: 'a disaster needing relief',
};

// How fast the penalties of a naked emergency ease as approval climbs past 55%,
// and the baseline chance one draws a court suit at once.
const EMERGENCY_APPROVAL_K = 15;
const EMERGENCY_COURT_CHANCE = 0.2;

export function declareEmergency(world, personaId, reason) {
  const c = world.constitution.emergency;
  if (!c) return { ok: false, reason: 'This constitution provides no emergency power.' };
  if (!R.hasPower(world, personaId, 'emergency')) return { ok: false, reason: 'Your office does not hold the emergency power.' };
  if (world.emergency?.active) return { ok: false, reason: 'A state of emergency is already in force.' };
  // The declaration is entered into the record; it may not be left blank.
  if (!reason || !reason.trim()) return { ok: false, reason: 'State a reason for the emergency — it is entered into the Chronicle under your name.' };
  // The power recovers slowly: you cannot chain one emergency into the next.
  if (world.emergencyCooldownUntil && world.clock.tick < world.emergencyCooldownUntil) {
    const left = world.emergencyCooldownUntil - world.clock.tick;
    return { ok: false, reason: `The last emergency is too recent — the power has not recovered. Try again in ${left} tick(s).` };
  }
  // It need not answer a real crisis — a president may declare one on nothing at
  // all — but doing so is a naked grab, and it is dear. What it costs eases the
  // more the country actually approves of the government: a popular leader is
  // given the benefit of the doubt, and it falls away exponentially above 55%.
  const cause = emergencyCause(world);
  const noCause = !cause.ok;
  const nat = (world.districts || []).reduce((a, d) => a + (d.mood || 50), 0) / ((world.districts || []).length || 1);
  const scale = Math.exp(-Math.max(0, nat - 55) / EMERGENCY_APPROVAL_K);   // 1 at/under 55%, decaying above
  world.emergency = {
    active: true, by: personaId, started: world.clock.tick,
    ends: world.clock.tick + Math.round(c.maxYears * world.clock.ticksPerYear), reason, noCause,
  };
  nudgeMoodAll(world, -3 * (noCause ? scale : 1));
  log(world, 'crisis', `A state of emergency is declared by ${world.personas[personaId]?.name} (${noCause ? 'no crisis in force' : cause.why}): ${reason.trim()}. ${c.suspendsLegislature ? 'The legislature is suspended.' : 'The legislature continues to sit.'}`, { actors: [personaId], weight: 4 });

  const p = world.personas[personaId];
  if (noCause) {
    // Declared on nothing. It carries the penalties of a pretext, scaled by how
    // much the country is willing to forgive: it hurts approval, it hands the
    // opposition grounds to move for removal (npc.tickChamberImpeach reads this),
    // and it may put the president before the court at once — at least a fifth of
    // the time, and less the more popular they are.
    world.emergency.pretext = { claimed: [], actual: [] };
    if (p) {
      nudgeApproval(p, -12 * scale);
      p.reputation = clamp((p.reputation || 0) - 2 * scale, -10, 10);
      p.saidDisrepute = p.saidDisrepute || [];
      p.saidDisrepute.push({ tick: world.clock.tick, channel: 'emergency', grounds: ['declared a state of emergency with no crisis to answer'] });
    }
    nudgeMoodAll(world, -6 * scale);
    log(world, 'press', 'The emergency answers no crisis the country can see — the legislature sat, the streets were calm, and the powers were taken anyway. The papers have the declaration and the record side by side.', { actors: [personaId], weight: 4 });
    if (chance(world, EMERGENCY_COURT_CHANCE * scale)) world.emergency.courtOrdered = world.clock.tick || 1;
  } else {
    // A real crisis is in force — but the *stated* ground may still be a lie. The
    // declaration stands either way; a court undoes an emergency, not a
    // bookkeeping check. What a false story costs is everything else.
    const pretext = emergencyPretext(world, reason);
    if (pretext) {
      world.emergency.pretext = pretext;
      if (p) {
        nudgeApproval(p, -12);
        p.reputation = clamp((p.reputation || 0) - 2, -10, 10);
        p.saidDisrepute = p.saidDisrepute || [];
        p.saidDisrepute.push({
          tick: world.clock.tick, channel: 'emergency',
          grounds: [`declared an emergency on ${PRETEXT_WORDS[pretext.claimed[0]] || 'a stated ground'} that was not happening`],
        });
      }
      nudgeMoodAll(world, -6);
      const said = PRETEXT_WORDS[pretext.claimed[0]] || 'the ground stated';
      log(world, 'press',
        `The emergency was declared on ${said}. There is ${pretext.actual.length ? 'no such thing happening — what the country is actually facing is ' + (cause.why) : 'no such thing happening'}. The papers have the declaration and the record side by side.`,
        { actors: [personaId], weight: 4 });
    }
  }
  return { ok: true };
}

// After an emergency ends — by hand or by its own clock — the power sits idle
// for a recovery period equal to its maximum duration, so it can't be toggled.
function setEmergencyCooldown(world) {
  const c = world.constitution.emergency;
  const recover = Math.round((c?.maxYears || 1) * world.clock.ticksPerYear);
  world.emergencyCooldownUntil = world.clock.tick + recover;
}

export function endEmergency(world, personaId) {
  if (!world.emergency?.active) return { ok: false, reason: 'No emergency in force.' };
  world.emergency.active = false;
  world.emergency.endedAt = world.clock.tick;
  setEmergencyCooldown(world);
  log(world, 'crisis', `The state of emergency is lifted.`, { actors: [personaId].filter(Boolean), weight: 2 });
  return { ok: true };
}

function expireEmergency(world) {
  world.emergency.active = false;
  world.emergency.endedAt = world.clock.tick;
  setEmergencyCooldown(world);
  log(world, 'crisis', `The state of emergency lapses — its constitutional term is spent.`, { weight: 2 });
}

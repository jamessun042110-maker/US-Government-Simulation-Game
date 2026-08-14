// The court that acts on its own.
//
// A supreme court is not a "strike" button on the executive's desk. It does not
// reach out and delete a law because a player felt like it; it waits for a case,
// hears it, splits, decides by majority, and — this is the part that makes it a
// court rather than a veto — writes down *why*, so the next case is argued
// against the last one.
//
// So: cases arrive on their own. A low chance whenever the executive or the
// legislature reaches past what the constitution granted them, and a lower
// chance at any time at all, because litigants are not only found where there is
// genuine overreach. The justices then decide, and the holding becomes
// precedent that bends every case after it.

import { uid, clamp, rng, chance, pick, moneyExact, nudgeMoodAll, nudgeApproval } from './util.js';
import { log, canonDate, regnal } from './chronicle.js';
import * as R from './rules.js';
import { revokeLaw } from './acts.js';

// How long a case is argued before the court hands down its judgment. Long
// enough that a player justice gets to read the thing and vote.
export const ARGUMENT_TICKS = 52;

// Per-tick odds a case is filed. Deliberately small: the court should feel like
// weather, not a metronome. Overreach roughly quadruples the rate.
const P_OVERREACH = 0.005;
const P_SPONTANEOUS = 0.0011;

const MAX_OPEN = 2; // the docket does not become a queue of homework

function notice(world, playerId, text, tone = 'ok') {
  if (!playerId) return;
  world.notices = world.notices || [];
  world.notices.push({ id: uid('nt'), playerId, text, tone, ts: Date.now() });
  if (world.notices.length > 60) world.notices.shift();
}

// --- Who the court is ------------------------------------------------------

/**
 * The office that reviews laws. Where several offices hold `strike_law` — an
 * autocracy vests everything in one person — the bench is the one that looks
 * most like a bench: a dedicated court, else the most seats, else the office
 * carrying the fewest other powers.
 */
export function courtOffice(world) {
  const cands = R.offices(world).filter((o) => (o.powers || []).includes('strike_law'));
  if (!cands.length) return null;
  const dedicated = cands.find((o) => o.id === 'justice');
  if (dedicated) return dedicated;
  return cands.slice().sort((a, b) =>
    (b.seats || 1) - (a.seats || 1) || (a.powers.length - b.powers.length))[0];
}

export function justices(world) {
  const o = courtOffice(world);
  return o ? R.holders(world, o.id) : [];
}

export const isJustice = (world, personaId) =>
  !!personaId && justices(world).some((j) => j.id === personaId);

// --- Doctrine — what a case is *about* -------------------------------------

// A case is never merely about one document. It is about a kind of act, and
// that is what precedent attaches to: strike an arrest order once and every
// arrest order after it is argued in the shadow of that holding.
const DOCTRINE = {
  ARREST: { id: 'ARREST', name: 'detention by order', weight: 3 },
  EXILE: { id: 'EXILE', name: 'exile by order', weight: 3 },
  GRANT_POWER: { id: 'GRANT_POWER', name: 'the enlargement of an office', weight: 3 },
  CREATE_OFFICE: { id: 'CREATE_OFFICE', name: 'the creation of an office', weight: 2 },
  AMEND: { id: 'AMEND', name: 'amendment of the constitution itself', weight: 3 },
  APPROPRIATE: { id: 'APPROPRIATE', name: 'the appropriation of public money', weight: 2 },
  SET_TAX: { id: 'SET_TAX', name: 'the power of taxation', weight: 1 },
  REDISTRICT: { id: 'REDISTRICT', name: 'the drawing of districts', weight: 2 },
  DECLARE_WAR: { id: 'DECLARE_WAR', name: 'the war power', weight: 3 },
  CALL_ELECTION: { id: 'CALL_ELECTION', name: 'the calling of elections', weight: 2 },
  REMOVE: { id: 'REMOVE', name: 'removal from office', weight: 3 },
  EMERGENCY: { id: 'EMERGENCY', name: 'the emergency power', weight: 4 },
  GENERAL: { id: 'GENERAL', name: 'the limits of the granted power', weight: 1 },
};

function doctrineOfDoc(world, doc) {
  let best = null;
  for (const c of doc.clauses || []) {
    const d = DOCTRINE[c.kind];
    if (d && (!best || d.weight > best.weight)) best = d;
  }
  return best || DOCTRINE.GENERAL;
}

// --- Overreach — the reason a case gets filed ------------------------------

/**
 * How far past its granted authority an act reaches, 0..1, with the grounds a
 * plaintiff would actually plead. This is the trigger for the higher case rate,
 * and it also weighs on the merits once the court sits.
 */
/**
 * How lopsided the vote that carried this act was, 0..1 — 0 at a bare majority
 * or a decree (which no chamber voted on at all), 1 at unanimity.
 *
 * An act carried 9–1 is not the same target as one that scraped through 5–4:
 * the wider the majority, the harder it is to find a plaintiff, a theory, and a
 * bench willing to say the republic got it wrong.
 */
export function marginOf(doc) {
  if (!doc || doc.type === 'order') return 0;
  const t = doc.tally;
  const cast = t ? (t.yea || 0) + (t.nay || 0) : 0;
  if (cast < 3) return 0;
  return clamp((t.yea / cast - 0.5) / 0.5, 0, 1);
}

/**
 * The deference a lopsided vote still commands, 0..1 — and how fast it drains.
 *
 * A bench does not overturn last month's near-unanimous act; it may well
 * overturn the same act four years on, when the chamber that passed it has been
 * replaced twice over and the country has stopped caring. So the majority buys
 * time, not immunity: full weight the day it passes, nothing at all once the
 * window closes, and the window is as long as the majority was wide — up to two
 * canon years at unanimity, nothing at a bare 50%.
 *
 * It decays linearly. A cliff would mean an act that was safe on Tuesday is
 * struck on Wednesday for no reason anyone in the world could point to.
 */
export function mandateOf(world, doc) {
  const margin = marginOf(doc);
  if (margin <= 0) return 0;
  const since = doc.promulgated;
  if (since == null) return 0;
  const window = margin * 2 * (world.clock.ticksPerYear || 240);
  if (window <= 0) return 0;
  const age = world.clock.tick - since;
  return clamp(margin * (1 - age / window), 0, 1);
}

export function overreachOf(world, doc) {
  const grounds = [];
  let score = 0;
  let rights = false; // does the act collide with an enumerated right?
  const author = world.personas[doc.authorId];
  const byOrder = doc.type === 'order';

  for (const c of doc.clauses || []) {
    // Liberty. The sharpest ground there is, and sharper still by decree.
    if (c.kind === 'ARREST' || c.kind === 'EXILE') {
      const verb = c.kind === 'EXILE' ? 'exiles a citizen' : 'detains a citizen';
      score += byOrder ? 0.42 : 0.24;
      grounds.push(`it ${verb}${byOrder ? ' by executive decree, without trial' : ''}`);
      const right = R.rightBlocking(world, c.kind === 'EXILE' ? 'ARREST_NOCHARGE' : 'ARREST_SPEECH')
        || R.rightBlocking(world, 'ARREST_NOCHARGE');
      if (right) { score += 0.2; rights = true; grounds.push(`it cannot be squared with ${right.name}`); }
      // Nothing written covers it — but if the republic kept the rights it
      // never enumerated, the bench has somewhere to stand. Weaker than a
      // named right, and `rights` stays false, so a wide majority still
      // discounts it below: a right the court must construct does not put an
      // act beyond the reach of the people who passed it.
      else if (R.retainsUnenumerated(world)) {
        score += 0.12;
        grounds.push('no enumerated right reaches it, but liberty of the person is among those the people retained');
      }
    }
    // Self-dealing: an office voting itself more power, or writing the rules
    // that constrain it. Courts exist very largely for this.
    if (c.kind === 'GRANT_POWER' && !c.revoke) {
      score += 0.22;
      const o = R.office(world, c.office);
      const selfDealt = author && R.officesOf(world, author.id).some((x) => x.id === c.office);
      if (selfDealt) { score += 0.24; grounds.push(`it enlarges the very office its author holds`); }
      else grounds.push(`it enlarges the ${o?.name || 'office'} beyond its founding grant`);
    }
    if (c.kind === 'AMEND') {
      const guard = /impeachment|amendment|override|quorum/.test(String(c.path || ''));
      score += guard ? 0.34 : 0.14;
      if (guard) grounds.push('it loosens a check that exists to restrain its own author');
      else grounds.push('it alters the constitution rather than legislating under it');
    }
    if (c.kind === 'REMOVE') { score += 0.26; grounds.push('it removes an officeholder without the trial the constitution requires'); }
    if (c.kind === 'DECLARE_WAR' && byOrder) { score += 0.3; grounds.push('war is declared without the chamber'); }
    if (c.kind === 'REDISTRICT') { score += 0.16; grounds.push('the districts are redrawn by the people who stand in them'); }
    if (c.kind === 'CALL_ELECTION' && byOrder) { score += 0.14; grounds.push('the timing of an election is set by decree'); }
  }

  // Money by decree, past the line the constitution drew.
  const cost = (doc.clauses || []).reduce((s, c) =>
    s + (c.kind === 'APPROPRIATE' ? (+c.amount || 0) : 0), 0);
  if (byOrder && cost > 0) {
    const rule = R.spendRule(world, cost);
    if (rule.requires) { score += 0.34; grounds.push('it spends what the constitution says only the chamber may spend'); }
    const a = R.allowance(world);
    if (a && cost > a.cap) { score += 0.18; grounds.push('it exceeds the discretionary allowance'); }
  }

  // An act that ranks the people it governs. This is the one ground that does
  // not depend on which office signed it or under what procedure: no majority
  // reaches it, so the score is set high enough that a challenge is close to
  // certain and the bench has something plain to write about.
  if (doc.disrepute?.length) {
    score += 0.7;
    rights = true;
    for (const g of doc.disrepute) grounds.push(g);
    const eq = R.rightBlocking(world, 'EQUAL_PROTECTION');
    if (eq) grounds.push(`it cannot be squared with ${eq.name}`);
    else if (R.retainsUnenumerated(world)) {
      grounds.push('this constitution never wrote down equal protection, and never had to: it is among the rights the people retained');
    }
  }

  // An order signed under an emergency is an order signed by a power that was
  // lent, not granted — and the loan is reviewable.
  if (byOrder && doc.underEmergency) {
    score += 0.2;
    grounds.push('it rests on emergency powers rather than on the office’s own grant');
  }

  // What the chamber did about it. An act carried 9–1 is not the same target as
  // one that scraped through 5–4: the wider the majority, the harder it is to
  // find a plaintiff, a theory and a bench willing to say the republic got it
  // wrong. This scales the trigger, not the merits — a lopsided vote cannot
  // launder an act that collides with a right, so it never touches those.
  if (!rights) score -= marginOf(doc) * 0.2;

  return { score: clamp(score, 0, 1), grounds, rights };
}

/** The same question asked of a live state of emergency. */
function emergencyOverreach(world) {
  const em = world.emergency;
  if (!em?.active) return null;
  const grounds = ['the emergency power is being used to govern rather than to answer a crisis'];
  let score = 0.3;
  const ran = world.clock.tick - (em.started || 0);
  if (ran > world.clock.ticksPerYear) { score += 0.25; grounds.push('it has now run longer than a canon year'); }
  if (world.constitution.emergency?.suspendsLegislature) { score += 0.2; grounds.push('the legislature stands suspended while it lasts'); }
  return { score: clamp(score, 0, 1), grounds };
}

// --- Precedent -------------------------------------------------------------

/** The controlling holding on a doctrine — the most recent one wins. */
export function precedentOn(world, doctrineId) {
  const ps = (world.precedents || []).filter((p) => p.doctrine === doctrineId && !p.overruled);
  return ps.length ? ps[ps.length - 1] : null;
}

export const doctrineName = (id) => DOCTRINE[id]?.name || 'the granted power';

// --- Filing ----------------------------------------------------------------

/** Everything in force that a court could be asked to look at, and has not already. */
function reviewable(world) {
  return (world.laws || []).map((id) => world.documents[id])
    .filter((d) => d && !alreadyBefore(world, { kind: 'doc', docId: d.id }));
}

// Each declaration of emergency is its own act, so each is separately
// reviewable — keyed by when it began, or the first case would settle the
// question for every emergency a republic ever declares.
const emergencyTarget = (world) => ({ kind: 'emergency', docId: 'em:' + (world.emergency?.started ?? 0) });

const openCases = (world) => (world.cases || []).filter((c) => c.status === 'argued');

/**
 * Has this act already had its day in court? Not merely "is it on the docket" —
 * an act that has been decided is settled, and a court that reheard the same
 * order every few ticks would be a slot machine, not a judiciary. The way to
 * revisit a holding is a fresh act raising the question again.
 */
function alreadyBefore(world, target) {
  return (world.cases || []).some((c) => c.status !== 'lapsed'
    && c.target.kind === target.kind && c.target.docId === target.docId);
}

/**
 * A plaintiff: somebody with standing and a reason. Preferring a member of the
 * party that lost the vote is not cynicism, it is how litigation actually
 * arrives.
 */
function findPlaintiff(world, doc) {
  const author = doc && world.personas[doc.authorId];
  const pool = Object.values(world.personas).filter((p) =>
    p.alive && !p.exiled && !p.imprisoned && p.id !== doc?.authorId && !isJustice(world, p.id));
  if (!pool.length) return null;
  const opposed = pool.filter((p) => author && p.party && p.party !== author.party);
  return pick(world, opposed.length ? opposed : pool);
}

// An emergency target carries a synthetic key, not a document id — only a real
// document should ever be linked from the Chronicle.
const docOf = (target) => (target.kind === 'doc' ? target.docId : undefined);

export function fileCase(world, target, why) {
  world.cases = world.cases || [];
  const doc = docOf(target) ? world.documents[target.docId] : null;
  const doctrine = target.kind === 'doc' ? doctrineOfDoc(world, doc)
    : target.kind === 'emergency' ? 'EMERGENCY' : 'GENERAL';
  const doctrineId = typeof doctrine === 'string' ? doctrine : doctrine.id;
  const plaintiff = findPlaintiff(world, doc);
  const subject = target.kind === 'emergency'
    ? `the state of emergency declared by ${world.personas[world.emergency?.by]?.name || 'the executive'}`
    : target.kind === 'person' ? `the conduct of ${world.personas[target.personaId]?.name || 'the respondent'}`
      : `“${doc.title}”`;

  const c = {
    id: uid('case'),
    target,
    // "In re:" with the colon, throughout — the docket should not mix two styles.
    title: target.kind === 'emergency' ? 'In re: the Emergency'
      : target.kind === 'person' ? `${world.personas[plaintiff?.id]?.name || 'A citizen'} v. ${world.personas[target.personaId]?.name || 'the respondent'}`
        : `In re: ${doc.title}`,
    subject,
    doctrine: doctrineId,
    grounds: why.grounds.slice(0, 3),
    merit: why.score,
    rights: !!why.rights,
    plaintiffId: plaintiff?.id || null,
    respondentId: doc?.authorId || world.emergency?.by || null,
    opened: world.clock.tick,
    openedAt: canonDate(world),
    argued: world.clock.tick + ARGUMENT_TICKS,
    status: 'argued',
    votes: {},      // personaId -> 'strike' | 'uphold'
    opinions: {},   // personaId -> written reason
    ruling: null,
    decidedAt: null,
  };
  world.cases.push(c);

  const pr = precedentOn(world, c.doctrine);
  log(world, 'court', `${world.personas[c.plaintiffId]?.name || 'A citizen'} brings suit against ${subject}: ${c.grounds[0] || 'it exceeds the power granted'}. The court takes the case.`
    + (pr ? ` ${pr.cite} is cited.` : ''), { actors: [c.plaintiffId].filter(Boolean), docId: docOf(target), weight: 3 });

  for (const j of justices(world)) {
    if (j.playerId) notice(world, j.playerId, `A case is before you: ${c.title}. Hear it and decide it in The Supreme Court.`, 'ok');
  }
  return c;
}

// --- Suits between people --------------------------------------------------

/**
 * A court that only reviews statutes is half a court. These are the claims one
 * person may bring against another, and each one is weighed against what the
 * world actually records — whether the plaintiff is in fact in a cell, whether
 * the defendant's own acts overreach, whether their paper actually ran the
 * story. A pleading is an assertion; the merits come from the record.
 */
export const CLAIMS = {
  wrongful_detention: {
    label: 'Wrongful detention',
    doctrine: 'ARREST',
    blurb: 'They had me taken and held without lawful cause.',
    ground: 'the detention was ordered without the cause the constitution requires',
    weigh(world, plaintiff, defendant) {
      let score = 0.12; let rights = false;
      const grounds = [];
      if (plaintiff.imprisoned) { score += 0.4; grounds.push('the plaintiff is being held now'); }
      // An order in force, signed by the defendant, naming the plaintiff.
      const order = (world.laws || []).map((id) => world.documents[id]).find((d) => d
        && d.authorId === defendant.id
        && (d.clauses || []).some((c) => c.kind === 'ARREST' && c.persona === plaintiff.id));
      if (order) { score += 0.22; grounds.push(`it rests on “${order.title}”, signed by the defendant`); }
      const due = R.rightBlocking(world, 'ARREST_NOCHARGE');
      if (due && plaintiff.imprisoned && !(plaintiff.charges || []).length) {
        score += 0.25; rights = true; grounds.push(`no charge is recorded, and ${due.name} forbids that`);
      }
      return { score, rights, grounds };
    },
    remedy(world, plaintiff) {
      if (plaintiff.imprisoned) {
        plaintiff.imprisoned = false;
        plaintiff.charges = [];
        log(world, 'court', `${plaintiff.name} is released by order of the court.`, { actors: [plaintiff.id], weight: 3 });
      }
    },
  },
  abuse_of_office: {
    label: 'Abuse of office',
    doctrine: 'GENERAL',
    blurb: 'They used their office against me rather than for the republic.',
    ground: 'the office was used as a private instrument',
    weigh(world, plaintiff, defendant) {
      let score = 0.1; const grounds = [];
      const offices = R.officesOf(world, defendant.id);
      if (!offices.length) return { score: 0.05, rights: false, grounds: ['the defendant holds no office at all'] };
      grounds.push(`the defendant holds the ${offices.map((o) => o.name).join(' and ')}`);
      // Their own acts are the evidence: the worst thing they have in force.
      let worst = 0; let worstDoc = null;
      for (const id of world.laws || []) {
        const d = world.documents[id];
        if (!d || d.authorId !== defendant.id) continue;
        const o = overreachOf(world, d);
        if (o.score > worst) { worst = o.score; worstDoc = d; }
      }
      if (worstDoc) { score += worst * 0.6; grounds.push(`“${worstDoc.title}” is theirs`); }
      if (world.emergency?.active && world.emergency.by === defendant.id) {
        score += 0.18; grounds.push('they are governing under their own declared emergency');
      }
      return { score, rights: false, grounds };
    },
  },
  defamation: {
    label: 'Defamation',
    doctrine: 'GENERAL',
    blurb: 'They put a falsehood about me into print.',
    ground: 'the statement was false and it was published anyway',
    weigh(world, plaintiff, defendant) {
      let score = 0.12; const grounds = [];
      const outlets = (world.media?.outlets || []).filter((o) => o.ownerPersonaId === defendant.id).map((o) => o.id);
      const art = (world.media?.articles || []).find((a) => outlets.includes(a.outletId)
        && a.targetType === 'persona' && a.targetId === plaintiff.id && (a.dir || 0) < 0);
      if (art) { score += 0.3; grounds.push(`their paper ran “${art.headline}”`); }
      else grounds.push('the plaintiff points to no printed statement');
      // A free press is a defence, not an aggravation: where the right exists,
      // the plaintiff is arguing uphill and the court should say so.
      const press = R.rightBlocking(world, 'SEIZE_PRESS');
      if (press) { score -= 0.22; grounds.push(`${press.name} weighs against the claim`); }
      return { score, rights: false, grounds };
    },
  },
  incitement: {
    label: 'Incitement',
    doctrine: 'GENERAL',
    blurb: 'They stood up in a room of this republic and said I was not a person.',
    ground: 'a class of citizens was denied its humanity in the open',
    // The one claim that needs no statute behind it: what was said is either on
    // the record or it is not. A line spoken in a public room is worse than one
    // spoken in a closed one, and a pattern is worse than a slip — but a closed
    // room is not a defence, only a discount.
    weigh(world, plaintiff, defendant) {
      const said = defendant.saidDisrepute || [];
      if (!said.length) return { score: 0.05, rights: false, grounds: ['nothing of the kind is on the defendant’s record'] };
      const grounds = [];
      const open = said.filter((s) => s.channel === 'floor');
      let score = 0.2 + Math.min(0.35, said.length * 0.09) + (open.length ? 0.25 : 0.06);
      const last = said[said.length - 1];
      grounds.push(open.length
        ? `${regnal(defendant)} said it in open session on ${(open[open.length - 1]).date}: ${(open[open.length - 1]).grounds[0]}`
        : `it was said in a closed room on ${last.date}: ${last.grounds[0]}`);
      if (said.length > 1) grounds.push(`the record shows ${said.length} such occasions, not one`);
      let rights = false;
      const eq = R.rightBlocking(world, 'EQUAL_PROTECTION');
      if (eq) { rights = true; score += 0.15; grounds.push(`it cannot be squared with ${eq.name}`); }
      // Their own acts, if they wrote the same thing into law, are the pattern.
      const inLaw = (world.laws || []).map((id) => world.documents[id])
        .find((d) => d && d.authorId === defendant.id && d.disrepute?.length);
      if (inLaw) { score += 0.2; grounds.push(`they put it in “${inLaw.title}” as well`); }
      return { score: clamp(score, 0, 1), rights, grounds };
    },
  },
  public_money_private_interest: {
    label: 'Public money to a private interest',
    doctrine: 'APPROPRIATE',
    blurb: 'They spent the republic\'s money on somebody it suited them to save.',
    ground: 'public money was disbursed to a business the defendant had an interest in',
    /**
     * The one claim in this list where the record does nearly all of the work.
     *
     * Catching a failing employer is a legitimate act of government and this
     * does not say otherwise — a rescue with nothing behind it scores at the
     * floor and the bench will throw it out. What is weighed is the connection
     * the world already recorded when the cheque was signed: see
     * acts.bailoutInterest, and world.rescues, which stores what it found on
     * the day rather than what is true now.
     */
    weigh(world, plaintiff, defendant) {
      const mine = (world.rescues || []).filter((r) => r.by === defendant.id);
      if (!mine.length) return { score: 0.04, rights: false, grounds: ['the defendant has signed for no rescue at all'] };
      const grounds = [];
      let score = 0.1;
      const conflicted = mine.filter((r) => r.interest);
      grounds.push(conflicted.length
        ? `the defendant signed for ${mine.length} ${mine.length === 1 ? 'rescue' : 'rescues'}, ${conflicted.length} of them not disinterested`
        : `the defendant signed for ${mine.length} ${mine.length === 1 ? 'rescue' : 'rescues'}, and the record shows nothing behind any of them`);
      if (!conflicted.length) return { score: clamp(score, 0, 1), rights: false, grounds };

      // The worst single one carries the claim; a pattern of them aggravates it.
      const worst = conflicted.slice().sort((a, b) => (b.interest.weight || 0) - (a.interest.weight || 0))[0];
      score += (worst.interest.weight || 0) * 0.55;
      grounds.push(`${moneyExact(worst.amount)} went into ${worst.companyName}, and ${worst.interest.grounds.join('; ')}`);
      if (conflicted.length > 1) {
        score += Math.min(0.15, (conflicted.length - 1) * 0.06);
        grounds.push(`it is not the only one — the record carries ${conflicted.length}`);
      }
      // Money handed over without the chamber ever voting on it is worse than
      // money the chamber was asked for and granted.
      const undebated = (world.discretionLog || []).some((x) => x.by === defendant.id
        && /^rescue of /.test(x.purpose || '') && x.purpose.includes(worst.companyName));
      if (undebated) { score += 0.12; grounds.push('and it never went to the chamber; it came out of the allowance'); }
      // A rescue that saved almost nobody was not about the jobs.
      if ((worst.staff || 0) < 25) {
        score += 0.1;
        grounds.push(`${worst.staff || 0} ${worst.staff === 1 ? 'person worked' : 'people worked'} there`);
      }
      return { score: clamp(score, 0, 1), rights: false, grounds };
    },
  },
  breach_of_faith: {
    label: 'Breach of faith',
    doctrine: 'GENERAL',
    blurb: 'They gave me their word in the open and broke it.',
    ground: 'an undertaking was given and not kept',
    weigh() {
      // Nothing in the record can settle this one. It rests on the pleading and
      // on whatever the bench thinks of the two of them.
      return { score: 0.2, rights: false, grounds: ['the claim rests on the pleading alone'] };
    },
  },
};

const suitKey = (defendantId, claim) => `suit:${defendantId}:${claim}`;
const SUIT_COOLDOWN = 120; // ticks before the same claim may be brought again

/** A player brings an action against another person. */
export function fileSuit(world, plaintiffId, defendantId, claimKind, pleading) {
  const claim = CLAIMS[claimKind];
  if (!claim) return { ok: false, reason: 'No such claim.' };
  const plaintiff = world.personas[plaintiffId];
  const defendant = world.personas[defendantId];
  if (!plaintiff || !defendant) return { ok: false, reason: 'No such person.' };
  if (plaintiffId === defendantId) return { ok: false, reason: 'You cannot sue yourself.' };
  if (!plaintiff.alive || plaintiff.exiled) return { ok: false, reason: 'You cannot bring an action.' };
  if (!defendant.alive) return { ok: false, reason: `${defendant.name} is beyond the court's reach.` };
  if (!justices(world).length) return { ok: false, reason: 'No court sits to hear it.' };
  if (!pleading || !pleading.trim()) return { ok: false, reason: 'State your claim — it is read into the record.' };

  const key = suitKey(defendantId, claimKind);
  const prior = (world.cases || []).filter((c) => c.target.kind === 'person' && c.target.docId === key
    && c.plaintiffId === plaintiffId);
  if (prior.some((c) => c.status === 'argued')) return { ok: false, reason: 'That action is already before the court.' };
  const last = prior[prior.length - 1];
  if (last && world.clock.tick - (last.decidedAt || 0) < SUIT_COOLDOWN) {
    return { ok: false, reason: `The court has only just decided this between you. Try again in ${SUIT_COOLDOWN - (world.clock.tick - last.decidedAt)} tick(s).` };
  }

  const why = claim.weigh(world, plaintiff, defendant);
  why.score = clamp(why.score, 0, 1);
  why.grounds = [pleading.trim(), ...why.grounds];

  const c = fileCase(world, { kind: 'person', docId: key, personaId: defendantId }, why);
  c.claim = claimKind;
  c.doctrine = claim.doctrine;
  c.plaintiffId = plaintiffId;
  c.respondentId = defendantId;
  c.title = `${plaintiff.name} v. ${defendant.name}`;
  c.subject = `${claim.label.toLowerCase()} by ${defendant.name}`;
  log(world, 'court', `${plaintiff.name} brings an action against ${defendant.name} for ${claim.label.toLowerCase()}: “${pleading.trim()}”`,
    { actors: [plaintiffId, defendantId], weight: 3 });
  const dp = defendant.playerId;
  if (dp) notice(world, dp, `${plaintiff.name} has sued you for ${claim.label.toLowerCase()}. The Supreme Court is open to you while the case is live — answer it there.`, 'error');
  if (plaintiff.playerId) notice(world, plaintiff.playerId, 'The hearing for your action is open in Chambers.', 'ok');
  return { ok: true, value: c };
}

/** The defendant answers. It is read alongside the pleading. */
export function answerSuit(world, caseId, personaId, text) {
  const c = (world.cases || []).find((x) => x.id === caseId);
  if (!c) return { ok: false, reason: 'No such case.' };
  if (c.status !== 'argued') return { ok: false, reason: 'That case is decided.' };
  if (c.respondentId !== personaId) return { ok: false, reason: 'You are not the respondent.' };
  if (!text || !text.trim()) return { ok: false, reason: 'Say something in your defence.' };
  c.answer = text.trim();
  log(world, 'court', `${world.personas[personaId]?.name} answers in ${c.title}: “${c.answer}”`,
    { actors: [personaId], weight: 2 });
  return { ok: true };
}

/**
 * A justice takes up a law of their own motion. This is the honest version of
 * the old "strike" button: one justice can put a question to the court, but
 * only the court can answer it.
 */
export function takeUp(world, docId, personaId, reason) {
  const doc = world.documents[docId];
  if (!doc || doc.status !== 'law') return { ok: false, reason: 'Only a law in force can be reviewed.' };
  if (!isJustice(world, personaId)) return { ok: false, reason: 'Only a justice of the court may take up a case.' };
  if (alreadyBefore(world, { kind: 'doc', docId })) return { ok: false, reason: 'That act is already before the court.' };
  const why = overreachOf(world, doc);
  if (reason && reason.trim()) why.grounds = [reason.trim(), ...why.grounds];
  if (!why.grounds.length) why.grounds = ['it reaches past the power the constitution granted'];
  const c = fileCase(world, { kind: 'doc', docId }, why);
  c.certBy = personaId;
  log(world, 'court', `${world.personas[personaId]?.name} takes up “${doc.title}” of the court's own motion.`,
    { actors: [personaId], docId, weight: 2 });
  return { ok: true, value: c };
}

// --- Chambers — the closed-door room, one thread per case ------------------

/**
 * Who may go behind the door. The justices always; a party to a live case only
 * for as long as they are a party, and — see `chamberCases` — only into the one
 * thread that is theirs. A hearing is private, not secret from its own parties.
 */
export function mayEnterChamber(world, personaId) {
  if (!personaId) return false;
  if (isJustice(world, personaId)) return true;
  return (world.cases || []).some((c) => c.status === 'argued'
    && (c.plaintiffId === personaId || c.respondentId === personaId));
}

/** The threads this person may actually read. */
export function chamberCases(world, personaId) {
  const all = world.cases || [];
  if (isJustice(world, personaId)) {
    // The bench sees the whole docket, and the recent record of what it decided.
    return all.filter((c) => c.status === 'argued' || c.status === 'decided').slice(-12).reverse();
  }
  // A party sees their own live case, and nothing else that is going on in there.
  return all.filter((c) => c.status === 'argued'
    && (c.plaintiffId === personaId || c.respondentId === personaId)).reverse();
}

export const mayEnterThread = (world, c, personaId) =>
  !!personaId && !!c && (isJustice(world, personaId)
    || (c.status === 'argued' && (c.plaintiffId === personaId || c.respondentId === personaId)));

export function speakInChamber(world, caseId, personaId, text) {
  const c = (world.cases || []).find((x) => x.id === caseId);
  if (!c) return { ok: false, reason: 'No such case.' };
  if (!mayEnterThread(world, c, personaId)) return { ok: false, reason: 'That hearing is closed to you.' };
  if (!text || !text.trim()) return { ok: false, reason: 'Say something.' };
  if (c.status !== 'argued' && !isJustice(world, personaId)) {
    return { ok: false, reason: 'That case is decided; the hearing is closed.' };
  }
  c.thread = c.thread || [];
  c.thread.push({
    id: uid('cm'), personaId, title: R.titleOf(world, personaId), text: text.trim(), ts: Date.now(), tick: world.clock.tick,
    // Who is speaking shapes how it reads: the bench, or one of the parties.
    role: isJustice(world, personaId) ? 'bench'
      : c.plaintiffId === personaId ? 'plaintiff' : 'respondent',
  });
  if (c.thread.length > 200) c.thread.shift();
  return { ok: true };
}

// --- Judgment --------------------------------------------------------------

/**
 * How a justice who is not a player votes. The merits carry the most weight,
 * but a court is made of people who were appointed by someone, and stare
 * decisis is real: the controlling holding moves a justice hard.
 */
function synthVote(world, c, j) {
  const respondent = world.personas[c.respondentId];
  let p = 0.16 + c.merit * 0.62;

  const pr = precedentOn(world, c.doctrine);
  if (pr) p += pr.ruling === 'struck' ? 0.26 : -0.26;

  // Sincerity is the hidden dial the assembly already votes on; a justice with
  // little of it is the one who remembers who appointed them.
  const sincere = j.sincerity ?? 0.6;
  const seat = R.seatOf(world, j.id);
  const o = seat && R.office(world, seat.office);
  if (o?.appointedBy && respondent && R.officesOf(world, respondent.id).some((x) => x.id === o.appointedBy)) {
    p -= 0.3 * (1 - sincere);
  }
  if (respondent && j.party && j.party === respondent.party) p -= 0.22 * (1 - sincere);

  // An act the country hates is an act that finds its constitutional problem.
  const ds = world.districts || [];
  const mood = ds.length ? ds.reduce((s, d) => s + (d.mood ?? 50), 0) / ds.length : 50;
  p += (50 - mood) / 100 * 0.18;

  // A fresh, lopsided mandate holds the bench back — striking down what the
  // chamber has just carried nine to one costs the court something, and the
  // justices know it. It drains away as the vote recedes into history; see
  // mandateOf. Not applied to a rights case, which is decided below on grounds
  // no majority reaches.
  const doc = c.target?.kind === 'doc' ? world.documents[c.target.docId] : null;
  if (doc) p -= mandateOf(world, doc) * 0.3;

  // A written right is the one thing a justice is least free to explain away.
  // Loyalty can shade a judgment; it should not be able to read a clause of the
  // constitution out of it entirely, so this both lifts the odds and sets a floor.
  if (c.rights) return chance(world, clamp(p + 0.24, 0.4, 0.97)) ? 'strike' : 'uphold';
  return chance(world, clamp(p, 0.04, 0.94)) ? 'strike' : 'uphold';
}

/** A player justice hands down their vote and their opinion. */
export function castOpinion(world, caseId, personaId, vote, opinion) {
  const c = (world.cases || []).find((x) => x.id === caseId);
  if (!c) return { ok: false, reason: 'No such case.' };
  if (c.status !== 'argued') return { ok: false, reason: 'That case is decided.' };
  if (!isJustice(world, personaId)) return { ok: false, reason: 'Only a justice of the court may decide a case.' };
  if (!['strike', 'uphold'].includes(vote)) return { ok: false, reason: 'A justice votes to strike or to uphold.' };
  c.votes[personaId] = vote;
  if (opinion && opinion.trim()) c.opinions[personaId] = opinion.trim();
  log(world, 'court', `${world.personas[personaId]?.name} votes to ${vote === 'strike' ? 'strike' : 'uphold'} in ${c.title}.`,
    { actors: [personaId], weight: 1 });
  // A full bench does not sit on its hands waiting for a clock — counting only
  // the justices who may actually hear it, since a recused party never votes.
  const bench = sittingBench(world, c);
  if (bench.length && bench.every((j) => c.votes[j.id])) decideCase(world, c);
  return { ok: true };
}

/**
 * The justices who may actually hear a case. Nobody sits in judgment on their
 * own quarrel, so a justice who is a party to it steps down — which can leave
 * the bench empty, and a case nobody impartial can hear is one that lapses.
 */
export function sittingBench(world, c) {
  return justices(world).filter((j) => j.id !== c.plaintiffId && j.id !== c.respondentId);
}
export const recusedFrom = (world, c) =>
  justices(world).filter((j) => j.id === c.plaintiffId || j.id === c.respondentId);

export function decideCase(world, c) {
  const bench = sittingBench(world, c);
  const recused = recusedFrom(world, c);
  if (recused.length && !c.recused) {
    c.recused = recused.map((j) => j.id);
    // "in ${c.title}" against a docket that styles every case "In re: …" read
    // "recuses themselves in In re: the Emergency". A case is recused *from*,
    // and the doubled word goes with the preposition.
    log(world, 'court', `${recused.map((j) => j.name).join(' and ')} ${recused.length > 1 ? 'recuse themselves' : 'recuses themselves'} from ${c.title}.`,
      { actors: c.recused, weight: 1 });
  }
  if (!bench.length) {
    c.status = 'lapsed';
    c.decidedAt = world.clock.tick;
    log(world, 'court', `${c.title} lapses: ${recused.length ? 'every justice is a party to it' : 'no court sits to hear it'}.`, { weight: 2 });
    return c;
  }
  for (const j of bench) if (!c.votes[j.id]) c.votes[j.id] = synthVote(world, c, j);

  const votes = bench.map((j) => c.votes[j.id]);
  const strike = votes.filter((v) => v === 'strike').length;
  const uphold = votes.length - strike;
  const struck = strike > uphold;

  c.status = 'decided';
  c.ruling = struck ? 'struck' : 'upheld';
  c.tally = { strike, uphold };
  c.decidedAt = world.clock.tick;

  // The majority's reasoning, in the court's own voice where no player wrote one.
  const writer = bench.find((j) => c.votes[j.id] === (struck ? 'strike' : 'uphold') && c.opinions[j.id])
    || bench.find((j) => c.votes[j.id] === (struck ? 'strike' : 'uphold'));
  c.authorId = writer?.id || null;
  const isSuit = c.target.kind === 'person';
  c.opinion = (writer && c.opinions[writer.id])
    || (isSuit
      ? (struck
        ? `Judgment for ${world.personas[c.plaintiffId]?.name || 'the plaintiff'}. ${CLAIMS[c.claim]?.ground ? CLAIMS[c.claim].ground[0].toUpperCase() + CLAIMS[c.claim].ground.slice(1) : 'The claim is made out'}, and the record bears it out.`
        : `Judgment for ${world.personas[c.respondentId]?.name || 'the respondent'}. A grievance honestly felt is not the same as a wrong the law will name, and this court will not make it one.`)
      : (struck
        ? `The power claimed here was never granted. ${c.grounds[0] ? c.grounds[0][0].toUpperCase() + c.grounds[0].slice(1) : 'It exceeds the founding grant'}, and no clause of this constitution supplies it.`
        : `The act sits inside the grant. That it is unwelcome is not the same as that it is unlawful, and the remedy for the former lies at the ballot.`));

  // Effect.
  if (c.target.kind === 'person') {
    const claim = CLAIMS[c.claim];
    const plaintiff = world.personas[c.plaintiffId];
    const defendant = world.personas[c.respondentId];
    if (struck) {
      // Judgment for the plaintiff. The court cannot remove anyone — that is
      // impeachment's work — but a finding against you is on the record and the
      // country reads it.
      nudgeApproval(defendant, -9);
      if (defendant) defendant.reputation = (defendant.reputation || 0) - 1;
      nudgeApproval(plaintiff, 3);
      if (claim?.remedy && plaintiff) claim.remedy(world, plaintiff, defendant, c);
    } else if (plaintiff) {
      // Bringing an action you lose is its own statement about you.
      nudgeApproval(plaintiff, -4);
    }
  } else if (struck) {
    if (c.target.kind === 'emergency') {
      if (world.emergency?.active) {
        world.emergency.active = false;
        world.emergency.endedAt = world.clock.tick;
        world.emergency.struck = true;
        const recover = Math.round((world.constitution.emergency?.maxYears || 1) * world.clock.ticksPerYear);
        world.emergencyCooldownUntil = world.clock.tick + recover;
      }
    } else {
      const doc = world.documents[c.target.docId];
      if (doc && doc.status === 'law') revokeLaw(world, doc);
    }
  }

  // Precedent. This is the whole point: the holding outlives the case.
  world.precedents = world.precedents || [];
  const nth = world.precedents.length + 1;
  const prev = precedentOn(world, c.doctrine);
  const p = {
    id: uid('prec'),
    caseId: c.id,
    cite: `${c.title} (${c.openedAt || canonDate(world)})`,
    title: c.title,
    doctrine: c.doctrine,
    doctrineName: doctrineName(c.doctrine),
    ruling: c.ruling,
    holding: isSuit
      ? (struck
        ? `On ${CLAIMS[c.claim]?.label.toLowerCase() || 'the claim'}: where ${CLAIMS[c.claim]?.ground || 'the claim is made out'}, judgment goes to the plaintiff.`
        : `On ${CLAIMS[c.claim]?.label.toLowerCase() || 'the claim'}: not every grievance is a wrong the law will name.`)
      : (struck
        ? `On ${doctrineName(c.doctrine)}: the constitution does not reach this far. ${c.grounds[0] ? 'The court held that ' + c.grounds[0] + '.' : ''}`.trim()
        : `On ${doctrineName(c.doctrine)}: the act lies within the grant, and stands.`),
    opinion: c.opinion,
    tally: c.tally,
    tick: world.clock.tick,
    date: canonDate(world),
    n: nth,
    overrules: prev && prev.ruling !== c.ruling ? prev.id : null,
  };
  // A court that reverses itself says so out loud.
  if (p.overrules) {
    const old = world.precedents.find((x) => x.id === p.overrules);
    if (old) old.overruled = p.id;
  }
  world.precedents.push(p);
  c.precedentId = p.id;

  // The majority's number first, always. Printed strike-first regardless of who
  // won, a 2–1 decision to uphold came out reading "upholds the act, 1–2".
  const tally = struck ? `${strike}–${uphold}` : `${uphold}–${strike}`;
  log(world, 'court', `${c.title}: the court ${isSuit ? (struck ? 'finds for the plaintiff' : 'finds for the respondent') : (struck ? 'strikes the act down' : 'upholds the act')}, ${tally}. ${c.opinion}`
    + (p.overrules ? ' It overrules its own earlier holding.' : ''),
    { actors: [c.authorId, c.plaintiffId, c.respondentId].filter(Boolean), docId: docOf(c.target), weight: 4 });

  // The country notices a court that stands up to the government — but a
  // quarrel between two people is not a constitutional moment.
  if (struck && !isSuit) nudgeMoodAll(world, 1.2);
  return c;
}

// --- The tick --------------------------------------------------------------

export function tickCourt(world) {
  if (world.phase !== 'live') return;
  world.cases = world.cases || [];
  world.precedents = world.precedents || [];

  // Hand down judgment in anything that has been argued long enough.
  for (const c of world.cases) {
    if (c.status === 'argued' && world.clock.tick >= c.argued) decideCase(world, c);
  }

  if (openCases(world).length >= MAX_OPEN) return;
  if (!justices(world).length) return; // no bench, no docket

  const pool = reviewable(world);

  // 1) Overreach draws a suit. Look at what is actually in force, worst first.
  const graded = pool.map((doc) => ({ doc, why: overreachOf(world, doc) }))
    .filter((x) => x.why.score > 0.18 && !alreadyBefore(world, { kind: 'doc', docId: x.doc.id }))
    .sort((a, b) => b.why.score - a.why.score);

  const em = emergencyOverreach(world);
  // An emergency declared on no crisis at all may be hauled up at once: the
  // declaration itself rolled the dice and set the flag (director.declareEmergency).
  // File it and clear the flag, jumping the queue.
  if (world.emergency?.active && world.emergency.courtOrdered && em && !alreadyBefore(world, emergencyTarget(world))) {
    world.emergency.courtOrdered = false;
    return void fileCase(world, emergencyTarget(world), em);
  }
  if (em && !alreadyBefore(world, emergencyTarget(world))) {
    graded.unshift({ doc: null, why: em, emergency: true });
  }

  if (graded.length) {
    const top = graded[0];
    // Precedent that already condemned this doctrine makes the next suit likelier.
    const doctrineId = top.emergency ? 'EMERGENCY' : doctrineOfDoc(world, top.doc);
    const pr = precedentOn(world, typeof doctrineId === 'string' ? doctrineId : doctrineId.id);
    const boost = pr ? (pr.ruling === 'struck' ? 1.8 : 0.45) : 1;
    if (chance(world, P_OVERREACH * (0.4 + top.why.score) * 2 * boost)) {
      return void fileCase(world,
        top.emergency ? emergencyTarget(world) : { kind: 'doc', docId: top.doc.id },
        top.why);
    }
  }

  // 2) And at any time at all, someone sues anyway. Litigants are not only
  //    produced by genuine overreach — this is the lower chance.
  if (pool.length && chance(world, P_SPONTANEOUS)) {
    const doc = pick(world, pool);
    if (alreadyBefore(world, { kind: 'doc', docId: doc.id })) return;
    const why = overreachOf(world, doc);
    // The same deference applies to the suit nobody had a reason to bring: it is
    // hardest of all to raise a crowd against an act the chamber was nearly
    // unanimous about. Scored acts already carry this in `why.score`.
    if (!why.rights && marginOf(doc) > 0 && chance(world, marginOf(doc) * 0.6)) return;
    if (!why.grounds.length) {
      why.grounds = [pick(world, [
        'it reaches past the power the constitution granted',
        'it was enacted without the process the constitution requires',
        'it burdens a citizen who never consented to it',
        'its terms are too vague to be law at all',
      ])];
    }
    fileCase(world, { kind: 'doc', docId: doc.id }, why);
  }
}

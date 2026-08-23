// Views. Everything the player touches.

import { el, esc, money, moneyExact, num, pct, clamp, sum, timeAgo, bareNation, flagSvg, PALETTE, POLITICAL_BASE_AGE } from './util.js';
import * as R from './rules.js';
import * as A from './acts.js';
import * as M from './media.js';
import * as I from './intrigue.js';
import * as D from './director.js';
import * as CT from './court.js';
import * as C from './chronicle.js';
import * as ACT from './actions.js';
import { BUILDINGS, ZONES, PARTIES, FOREIGN } from './world.js';
import * as GEO from './geo.js';
import { ALASKA, HAWAII, CENTRAL_AMERICA } from './atlas.js';
import * as MACRO from './macro.js';
import * as CO from './company.js';
import { nationalApproval, approvalDrivers, approvalByDistrict, DRAFT_SLOWDOWN, openElections, pactHolds, interestRate } from './sim.js';
import { tutorialModal, tutorialMount, markTutorialSeen } from './tutorial.js';
import * as TH from './theme.js';
import * as SC from './scene.js';
import { pixText } from './pixfont.js';
import * as DEP from './depts.js';
export { tutorialSeen } from './tutorial.js';

// Transient UI state. Never synced; this is what *this* tab is looking at.
export const S = {
  view: 'nation',
  draft: null,          // document being composed
  parcel: null,
  conId: null,
  chat: '',
  composeNote: null,   // why clauses vanished when the document type changed
  article: { angle: 'attack', targetType: 'office' },
  modal: null,
  seen: 0,
  adv: {},             // which "Advanced" disclosures the user has opened
  conventionDoc: false, // the convention's document page, behind the seating one
  electionMin: false,  // ballot docked to the corner instead of taking the screen
};

let CTX = null; // {world, me, playerId, dispatch, net}

export function mount(ctx) { CTX = ctx; tutorialMount(() => CTX.rerender(true)); }

/**
 * The modals a player has to ask for, as against the ones the game puts up.
 *
 * The distinction matters exactly once, and it matters a lot: an open election
 * claims the screen on every render, and it must not claim it back from a
 * dialog somebody opened deliberately. See modalDuringPolls.
 */
export const OWN_MODALS = ['join', 'ask', 'compose', 'bio', 'persona', 'rank'];

/**
 * Which modal should be up while the polls are open.
 *
 * An election takes the screen because the republic is held behind it, and it
 * outranks the tutorial and the inauguration for the same reason. It does not
 * outrank the player. app.js reasserts this on every render — about once a
 * second — and it used to reassert 'election' over whatever was up, so anything
 * opened from behind a minimised ballot was gone before it could be read. Most
 * visibly: "Wipe and start over" opens a confirm and the confirm evaporates, so
 * a Season could not be ended for as long as a ballot was open. Nothing in the
 * engine says that — TABLE_MOTION takes a reset during an election perfectly
 * happily, and a solo wipe never reaches the engine at all. It was this rule.
 *
 * Returns the modal to show. When an owned dialog closes, `current` goes null
 * and the ballot comes back, docked or full exactly as it was.
 */
export function modalDuringPolls(current, polls) {
  if (polls) return OWN_MODALS.includes(current) ? current : 'election';
  return current === 'election' ? null : current;
}
const w = () => CTX.world;
const me = () => CTX.world.personas[CTX.world.players[CTX.playerId]?.personaId] || null;

/**
 * What a seat is called on the map: its congressional district if it has one,
 * and its state if it does not.
 *
 * A House seat carries a numbered district — TX-2 — because Texas holds several
 * and the number is the only thing telling them apart. A Senate seat carries the
 * state's name, because a senator represents the whole of it and a number would
 * imply a line through the state that nobody drew.
 */
const seatWhere = (world, seat) => {
  if (!seat?.district) return '';
  const state = world.districts.find((d) => d.id === seat.district)?.name || '';
  return seat.cd ? `${seat.cd} · ${state}` : state;
};

/** The short form, for a column that has the state written beside it already. */
const seatCd = (world, seat) => seat?.cd
  || (seat?.district ? (world.districts.find((d) => d.id === seat.district)?.name || '') : '');
const myPlayer = () => CTX.world.players[CTX.playerId] || null;
const go = (type, payload = {}) => CTX.dispatch({ type, ...payload });

/**
 * The fiscal-effect words for a document, split the way the treasury will
 * actually pay: what leaves at signing, and what a recurring program draws
 * across every year it stands. The line used to promise a lump sum for a
 * recurring appropriation — money the balance was never going to show leaving
 * — and the treasury read as a ledger that had stopped keeping books.
 */
const fiscalPhrase = (world, d) => {
  const { now, yearly } = A.docCostSplit(world, d);
  if (!now && !yearly) return null;
  const parts = [];
  if (now) parts.push(`${moneyExact(-now)} at signing`);
  if (yearly) parts.push(`${moneyExact(-yearly)} a year, drawn as it runs`);
  return { now, yearly, total: now + yearly, text: parts.join(' · ') };
};

const NAV = [
  ['nation', '◈', 'Nation'],
  // The tab id stays 'assembly' — it is on saves and in every other module, and
  // it is the legislature's id in the constitution besides. 'Congress' is what
  // the player reads, and it is the name that survives the chamber being split
  // in two, where 'House' would not.
  ['assembly', '⚖', 'Congress'],
  // No public Treasury tab. The books belong to the Department of the Treasury,
  // and the country is not entitled to read them over the Secretary's shoulder —
  // which is the whole reason the chamber has to vote itself a copy.
  // The tab id stays 'city' — it is on saves and in every other module. The
  // label is what the player reads, and "City" implied one settlement in a
  // country that has several. This tab is the domestic geography of the
  // republic, so it says that.
  ['city', '⌂', 'Domestic'],
  // Every icon in this list is a typographic mark, not a picture. The two that
  // were emoji — a globe here and an eye on Intrigue — rendered in the system's
  // colour emoji font, so they came out full-colour and a size and a half too
  // big beside marks drawn in the UI's own type. A meridian circle and a circle
  // half in shadow say the same things in the same ink.
  ['world', '⊕', 'World'],
  ['press', '❝', 'Press'],
  ['offices', '★', 'Offices'],
  // The court has no public gallery. The bench sees this tab always; a party to
  // a live case sees it while their case is live and not a moment longer; nobody
  // else knows it is there. Suing somebody is in Intrigue.
  ['chambers', '⚖', 'The Supreme Court', (world, p) => CT.mayEnterChamber(world, p?.id)],
  ['oval', '◉', 'Oval Office', (world, p) => canOval(world, p)],
  // The chambers' own rooms — one each. The legislature was the only branch with
  // nowhere private to talk, which made it the only one that could not whip a
  // vote; and one shared room let each chamber read the other's whip count,
  // which is the opposite of what a cloakroom is for. Labels are rewritten in
  // navFor from the chamber's own name.
  ['cloakroom', '⬒', 'House Cloakroom', (world, p) => R.mayEnterCloakroom(world, p?.id, R.chambers(world)[0])],
  ['cloakroom_upper', '⬒', 'Senate Cloakroom', (world, p) => {
    const up = world.constitution?.legislature?.upperChamber;
    return !!up && R.mayEnterCloakroom(world, p?.id, up);
  }],
  // Not an office at all — a house. The Vice President's, and nobody else's
  // unless asked. There is nothing to do in it, which is the point of it.
  ['mansion', '⌂', "Vice President's Mansion", (world, p) => R.mayEnterMansion(world, p?.id)],
  // The two departments. Narrower than the Oval Office: the secretary who runs
  // the building and the President who appointed them, and nobody else — an
  // invitation to the war room is a decision about the war, and the Oval Office
  // is where those get made.
  ['state', '⚑', 'Department of State', (world, p) => R.mayEnterDept(world, p?.id, 'state')],
  ['defense', '⬢', 'Department of Defense', (world, p) => R.mayEnterDept(world, p?.id, 'defense')],
  ['exchequer', '⛃', 'Department of the Treasury', (world, p) => R.mayEnterDept(world, p?.id, 'exchequer')],
  // Not an office of the republic at all — a building you own. It appears for
  // the founder and for anyone on the payroll, and it is *named* for whatever
  // storey the company can currently afford: see company.STAGES. A player who
  // has never won an election can spend a whole Season in here.
  ['company', '▤', 'The Basement', (world, p) => CO.mayEnterCompany(world, p?.id)],
  // No Elections tab. An election is not a place you visit, it is the one event
  // that stops the republic — it arrives as a modal and holds the clock until the
  // count. See electionModal().
  ['intrigue', '◑', 'Intrigue'],
  ['chronicle', '§', 'Chronicle'],
  ['season', '⚙', 'Season'],
];

// Who may enter the Oval Office: the President always, the cabinet by default,
// and anyone the President has personally invited. Everyone else never sees the tab.
const canOval = (world, p) => R.mayEnterOval(world, p?.id);

// --- Invitations into a closed room ----------------------------------------

/** What a room is called in a sentence, matching the engine's phrasing. */
const roomName = (world, room) =>
  (room === 'oval' ? 'the Oval Office' : `the ${R.office(world, room)?.name || room}'s department`);

/**
 * The offers waiting on your answer, as cards you can actually answer.
 *
 * Accepting is what starts the two months, so this is not a notification — it
 * is the thing itself, and it has to be somewhere you cannot miss it.
 */
function invitationCards(world) {
  const p = me();
  if (!p) return [];
  return R.pendingInvites(world, p.id).map(({ room, invite }) => {
    const left = R.inviteAnswerLeft(world, invite);
    return el('div', { class: 'crisis', style: { marginBottom: '14px' } },
      el('div', { class: 'spread' },
        el('b', {}, `You are invited into ${roomName(world, room)}`),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm primary', onclick: () => go('ACCEPT_INVITE', { room }) }, 'Accept'),
          el('button', { class: 'btn sm ghost', onclick: () => go('DECLINE_INVITE', { room }) }, 'Decline'))),
      el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
        left == null ? '' : `The offer lapses in ${C.canonSpan(world, left)}. `,
        `Accept and the room is open for ${R.OVAL_INVITE_MONTHS} months from today.`));
  });
}

/** One line on a room's door list: a guest, and how long they have. */
function inviteRow(world, room, g, h, mayManage) {
  const pending = R.invitePending(g);
  const left = pending ? R.inviteAnswerLeft(world, g) : R.inviteLeft(world, g);
  return el('div', { class: 'spread small', style: { padding: '3px 0' } },
    el('span', {}, h.name, pending ? ' — asked, no answer yet' : ' — visiting',
      el('span', { class: 'tiny dimmer' },
        left == null ? '' : pending ? ` · offer lapses in ${C.canonSpan(world, left)}` : ` · lapses in ${C.canonSpan(world, left)}`)),
    mayManage
      ? el('button', {
        class: 'btn sm ghost',
        onclick: () => go(room === 'oval' ? 'UNINVITE_OVAL' : 'UNINVITE_DEPT', { room, personaId: h.id }),
      }, pending ? 'withdraw' : 'remove')
      : null);
}

/**
 * A department's door: the two keyholders, whoever is visiting, and the invite
 * control if you are one of the two people who can open it.
 */
function deptRoster(world, room) {
  const p = me();
  const mayInvite = !!p && R.mayInviteToDept(world, p.id, room);
  const invited = R.roomInvites(world, room)
    .map((g) => ({ g, h: world.personas[g.id] })).filter((x) => x.h);
  // Plurality of office lets one person hold both chairs; list them once.
  const seen = new Set();
  const keyholders = ['president', room].flatMap((oid) => R.holders(world, oid)
    .filter((h) => !seen.has(h.id) && seen.add(h.id))
    .map((h) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
      el('span', {}, h.name, ' — ', R.office(world, oid)?.name),
      el('span', { class: 'tag gold' }, 'by office'))));

  return [
    el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } },
      'The Secretary and President hold a key by office; either may ask somebody in, '
      + `an invitation runs ${R.OVAL_INVITE_MONTHS} months from acceptance.`),
    ...keyholders,
    ...invited.map(({ g, h }) => inviteRow(world, room, g, h, mayInvite)),
    mayInvite
      ? el('label', { class: 'field', style: { marginTop: '8px' } }, el('span', {}, 'Invite someone in'),
        select([['', 'choose…'], ...rosterOptions(Object.values(world.personas)
          .filter((x) => x.alive && !x.exiled && !R.deptByOffice(world, x.id, room)
            && !R.roomInvites(world, room).some((g) => g.id === x.id)))], '',
        (v) => v && go('INVITE_DEPT', { room, personaId: v })))
      : null,
  ];
}

// --- Shell -----------------------------------------------------------------

export function renderHeader(root) {
  const world = w();
  const app = nationalApproval(world);
  const e = world.economy;
  const bal = e.revenueYr - e.spendYr;
  root.replaceChildren(...kids(
    // The wordmark is drawn, not set: the same 5x7 grid the rooms and the title
    // screen are drawn on. See pixfont.js.
    // Stacked, like the title screen's, so the header and the way in agree.
    // One line of eighteen letters in 88px is a four-pixel letter; two lines
    // keep the glyph the size it was and cost the header nothing in width.
    el('div', { class: 'brand', title: 'State of the Union' },
      el('div', { class: 'brand-top', html: pixText('STATE OF THE', { ink: 'currentColor' }) }),
      el('div', { html: pixText('UNION', { ink: 'currentColor' }) })),
    el('span', { class: 'tag ' + (world.phase === 'live' ? 'green' : world.phase === 'collapse' ? 'red' : 'gold') }, world.phase),
    world.emergency?.active ? el('span', { class: 'tag red', title: world.emergency.reason || '' }, 'emergency') : null,
    world.atThePolls ? el('span', { class: 'tag blue', title: 'Canon time stops while the ballot is open.' }, 'at the polls') : null,
    world.paused ? el('span', { class: 'tag red' }, 'paused') : null,
    // Pause/resume motions get their own header control below; the tag covers
    // the motions that still live only on the Season tab (reset, end).
    world.motion && !world.motion.closed && world.motion.kind !== 'pause' && world.motion.kind !== 'resume'
      ? el('span', { class: 'tag gold' }, 'motion on the table') : null,
    el('span', { class: 'tiny dimmer mono' }, C.canonDate(world)),
    pauseControl(world),
    speedControl(world),
    (() => {
      const homeless = sum(world.districts, (d) => d.homeless);
      return el('div', { class: 'ticker' },
        stat('Approval', app.toFixed(0) + '%', '', gradeColor(clamp(app / 100, 0, 1)),
          () => { S.view = 'nation'; CTX.rerender(true); }),
        stat('Treasury', money(e.treasury), '', gradeColor(clamp(0.5 + e.treasury / 2e8, 0, 1))),
        stat('Balance/yr', (bal >= 0 ? '+' : '') + money(bal), '', gradeColor(clamp(0.5 + bal / 2e7, 0, 1))),
        stat('Unemployed', pct(e.unemployment), '', gradeColor(clamp(1 - e.unemployment / 0.2, 0, 1))),
        stat('Homeless', num(homeless), '', gradeColor(clamp(1 - homeless / 2500, 0, 1))),
      );
    })(),
    // Outside the ticker so they stay pinned at the right and reachable however
    // narrow the window gets — the stats clip first.
    el('span', { class: 'hostpill' + (CTX.net.isHost ? ' host' : ''), title: 'One tab hosts and runs the tick. Open another to add a player.' },
      (CTX.net.isHost ? '● host' : '○ client') + ' · ' + CTX.net.livePeers() + ' tab' + (CTX.net.livePeers() === 1 ? '' : 's')),
    // Light/dark. Follows the machine until you say otherwise; the title says
    // which of those two things is currently true.
    (() => {
      const dark = TH.resolvedTheme() === 'dark';
      const pref = TH.themePref();
      return el('button', {
        class: 'btn sm', 'aria-label': dark ? 'Switch to the light theme' : 'Switch to the dark theme',
        title: (dark ? 'Dark' : 'Light') + (pref === 'system' ? ' — following your system. Click to set it yourself.' : ' — your choice. Click to flip.'),
        onclick: () => { TH.toggleTheme(); CTX.rerender(true); },
      }, dark ? '☀' : '☾');
    })(),
    el('button', {
      class: 'btn sm', title: 'How to play',
      onclick: () => { S.tutPage = 0; S.modal = 'tutorial'; CTX.rerender(true); },
    }, '? How to play'),
  ));
}

// replaceChildren() turns a null child into the literal text "null" — unlike
// el(), which drops it. Anything conditional must be filtered before it lands.
const kids = (...n) => n.flat(3).filter((x) => x != null && x !== false);

// --- The roster order ------------------------------------------------------
// Every list of people reads the same way: the people at the table first, then
// the cast, each alphabetical by surname. In a list of tens of thousands of
// citizens the handful you are actually playing with should never be somewhere
// in the middle of it.
const surname = (n) => {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').toLowerCase();
};
export function byRoster(a, b) {
  const world = w();
  // Rank first, on the same scale the convention ranks chairs by, so a list of
  // people reads in the same order as the list of seats: the President at the top,
  // then the Vice President, the bench, the secretaries, the chamber, and private
  // citizens last.
  const ar = world ? R.prestigeOf(world, a?.id) : -1;
  const br = world ? R.prestigeOf(world, b?.id) : -1;
  if (ar !== br) return br - ar;
  // Then the people at the table, ahead of the cast. A seat at the table is what
  // counts, not whether the engine spawned them: a founder who rolls a new persona
  // after an exile is still a founder.
  const ap = a?.playerId || !a?.synthetic ? 0 : 1;
  const bp = b?.playerId || !b?.synthetic ? 0 : 1;
  if (ap !== bp) return ap - bp;
  // Then by surname, which is how a register is kept.
  return surname(a?.name).localeCompare(surname(b?.name))
    || String(a?.name || '').localeCompare(String(b?.name || ''));
}
/** A persona list in roster order. */
const roster = (list) => list.slice().sort(byRoster);

/**
 * How a person is named in a list: "Vice President Aurel Ferro", not "Aurel
 * Ferro". A dropdown of bare names asks you to remember who holds what before you
 * can pick, and the whole game is about who holds what — so the office comes with
 * the name everywhere a name is offered.
 */
export function styledName(world, p) {
  if (!p) return '';
  const t = R.titleOf(world, p.id);
  return t ? `${t} ${p.name}` : p.name;
}

/**
 * A persona list as `[id, label]` pairs for select(): titled, and in roster order.
 * `mark` appends "(player)" where the distinction matters more than the title does.
 */
function rosterOptions(list, { mark = false } = {}) {
  const world = w();
  return roster(list).map((x) => [x.id, styledName(world, x) + (mark && !x.synthetic ? ' (player)' : '')]);
}

/**
 * The pause lives in the header so the table can stop the clock from wherever
 * it is standing — mid-draft, mid-article — without a trip to the Season tab.
 * Same machinery as the Season tab: a table motion, majority of active
 * players, instant when solo. While a pause/resume motion is open the control
 * becomes the ballot, so nobody has to leave what they were writing to vote.
 */
function pauseControl(world) {
  if (!world.players[CTX.playerId]) return null;
  const m = world.motion && !world.motion.closed ? world.motion : null;
  const paused = !!world.paused;
  const solo = ACT.activePlayers(world).length <= 1;

  if (m && (m.kind === 'pause' || m.kind === 'resume')) {
    const yea = Object.values(m.votes).filter((v) => v === 'yea').length;
    const mine = m.votes[CTX.playerId];
    return el('span', { class: 'pausevote', title: `${world.players[m.by]?.name || 'A player'} moves to ${ACT.MOTIONS[m.kind].label}. ${m.needed} of ${m.eligible} must agree.` },
      el('b', {}, (m.kind === 'pause' ? 'Pause?' : 'Resume?') + ` ${yea}/${m.needed}`),
      el('button', { class: 'btn sm' + (mine === 'yea' ? ' primary' : ''), onclick: () => go('MOTION_VOTE', { ballot: 'yea' }) }, 'Yea'),
      el('button', { class: 'btn sm' + (mine === 'nay' ? ' danger' : ''), onclick: () => go('MOTION_VOTE', { ballot: 'nay' }) }, 'Nay'),
      m.by === CTX.playerId ? el('button', { class: 'btn sm ghost', onclick: () => go('MOTION_CANCEL', {}) }, '✕') : null);
  }

  return el('button', {
    class: 'btn sm' + (paused ? ' primary' : ''),
    disabled: !!m,
    title: m ? 'A motion is already before the table.'
      : paused ? (solo ? 'Resume the world.' : 'Move to resume — a majority of the table must agree.')
        : (solo ? 'Pauses the world: time, elections and crises stop, actions still work.'
          : 'Move to pause — a majority must agree. Time stops, actions still work.'),
    onclick: () => go('TABLE_MOTION', { kind: paused ? 'resume' : 'pause' }),
  }, paused ? '▶ Resume' : '⏸ Pause');
}

/**
 * The speed control. Solo only — a table runs at one tick a second, because a
 * shared world nobody can keep pace with is not shared. Alone there is nobody
 * to wait for, and a four-year term is a long time to sit through.
 *
 * Cycles 1× → 2× → 4× → 1×, so it is one button rather than a row of them.
 */
function speedControl(world) {
  if (!world.players[CTX.playerId]) return null;
  if (ACT.activePlayers(world).length > 1) return null;
  if (world.paused) return null;
  const scale = Math.max(1, Math.min(4, world.timeScale || 1));
  const next = scale >= 4 ? 1 : scale * 2;
  return el('button', {
    class: 'btn sm' + (scale > 1 ? ' primary' : ''),
    title: `${scale} tick${scale === 1 ? '' : 's'} a second. Click for ${next}×. Single player only.`,
    onclick: () => go('SET_TIMESCALE', { scale: next }),
  }, `⏩ ${scale}×`);
}

// A goodness value 0..1 → a colour on a smooth red→amber→green ramp. Used so the
// header stats drift in colour with their value instead of flipping at a cliff.
const gradeColor = (t) => `hsl(${Math.round(clamp(t, 0, 1) * 125)}, 68%, 46%)`;
const stat = (k, v, cls = '', color = null, onclick = null) => el('div',
  { class: 'stat ' + cls + (onclick ? ' clickable' : ''), onclick: onclick || undefined, title: onclick ? 'Open the approval breakdown' : '' },
  el('div', { class: 'v', style: color ? { color } : {} }, v), el('div', { class: 'k' }, k));

// Every persona carries a party (or sits independent): the country sorts itself
// by it at the polls and the chamber is whipped by it on the floor, so the record
// shows it plainly. One chip, in the party's own colour, wherever a name appears
// with room beside it. See world.PARTIES.
const partyChip = (persona) => {
  const party = persona?.party ? PARTIES.find((x) => x.id === persona.party) : null;
  return el('span', {
    class: 'tag' + (party ? '' : ' dim'),
    style: { marginLeft: '6px', ...(party ? { background: party.color, color: party.ink } : {}) },
    title: 'Party alignment',
  }, party ? party.name : 'Independent');
};

/**
 * What each tab is demanding of you right now. Keyed by an identity string so
 * a *new* demand can be told apart from one you have already looked at.
 */
function actionItems(world) {
  const open = world.events.filter((e) => !e.resolved);
  const floor = Object.values(world.documents).filter((d) => ['floor', 'override', 'vetoed'].includes(d.status));
  // A bill awaiting signature is not before the chamber any more. It is on one
  // person's desk, in a different room, and it badges that room.
  const desk = Object.values(world.documents).filter((d) => d.status === 'awaiting-signature');
  const rising = world.uprising && !world.uprising.resolved ? [world.uprising] : [];
  // A case you must actually decide reads differently from one you may merely
  // watch, so a justice's docket is keyed by whether they have voted yet.
  const p = me();
  const docket = (world.cases || []).filter((c) => c.status === 'argued');
  const mine = p && CT.isJustice(world, p.id) ? docket.filter((c) => !c.votes?.[p.id]) : [];
  // A crisis card is posted to the whole republic and always was — anyone may
  // read what is happening to the country. A *badge* is not a posting, it is a
  // demand, and it was being made of people who cannot answer: a justice, a
  // secretary, a private citizen all carried a red count for a question the
  // engine would refuse them (director.respond checks rules.mayAnswerCrisis).
  // Two people are told. The chair, because the question is put to them; and
  // the chamber, because the referral path — draft the appropriation, lay it on
  // the floor, `answers` on the doc — is the other way a crisis gets answered.
  // For everyone else the Nation tab is news, and news does not badge.
  const told = !!p && (R.mayAnswerCrisis(world, p.id) || inChamber(world, p));
  return {
    // Notices count — they are why you'd look — but they are not crises and
    // nothing is awaiting your response, so they say what they are.
    nation: ((notices, crises) => ({
      keys: told ? open.map((e) => e.uid) : [],
      label: () => (crises.length && notices.length
        ? `${crises.length} crisis to answer, and ${notices.length} notice`
        : crises.length ? `${crises.length} crisis to answer`
          : `${notices.length} notice to acknowledge`),
    }))(open.filter((e) => e.notice), open.filter((e) => !e.notice)),
    assembly: { keys: floor.map((d) => d.id + ':' + d.status), label: (n) => `${n} measure before the chamber` },
    // Only for the person who actually has to answer it — everyone else in the
    // room is a guest, and a badge they cannot clear is noise. Two demands land
    // on the President's desk here: a bill to sign, and a cabinet post to fill.
    oval: (() => {
      const veto = world.constitution.legislature?.vetoOffice;
      const bills = (p && veto && R.officesOf(world, p.id).some((o) => o.id === veto)) ? desk : [];
      // A cabinet post left empty is a standing demand exactly as a bill on the
      // desk is — the executive cannot run a department it has not staffed. The
      // at-will seats are never auto-filled (world.fillVacantSeats), so every
      // incoming President is sworn in over an empty cabinet and badged for it
      // until it is named. Only the appointer sees it, and an outstanding offer
      // already counts as answered.
      // ...but not before there is an administration to staff. A founder who
      // claims the chair at the convention holds an office that does not exist
      // yet: the constitution is still being argued, the seats they would be
      // filling may be struck from the document before the day is out, and the
      // Oval Office is not a room anyone can walk into until the oath is taken.
      // Badging them for three empty secretariats put a toast over the
      // convention offering to take them somewhere they could not act. The
      // republic is inaugurated once, at the founding oath (world.inaugurated,
      // stamped in actions.js), so every later President is still badged the
      // moment they take office.
      const cabinet = (world.inaugurated != null && p && R.hasPower(world, p.id, 'appoint'))
        ? world.seats.filter((s) => {
          const o = R.office(world, s.office);
          return o && o.atWill
            && R.officesOf(world, p.id).some((x) => x.id === o.appointedBy)
            && !(s.personaId && world.personas[s.personaId]?.alive)
            && !(world.nominations || []).some((n) => n.seatId === s.id);
        })
        : [];
      const keys = [...bills.map((d) => 'sign:' + d.id), ...cabinet.map((s) => 'seat:' + s.id)];
      return {
        keys,
        label: () => [
          bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'} to sign` : null,
          cabinet.length ? `${cabinet.length} cabinet seat${cabinet.length === 1 ? '' : 's'} to fill` : null,
        ].filter(Boolean).join(', '),
      };
    })(),
    // No entry for an election. It is a modal over everything, and the clock is
    // stopped behind it — nudging someone toward a tab that no longer exists,
    // from under a popup they cannot dismiss, was the worst of both.
    // The badge promised a rising and nothing else, on a tab that now also
    // carries the spy and war crises — count both, and say which it is.
    // A rising badges everyone: it is not a question put to the government, it
    // is a thing happening in the country that anyone may join or oppose. The
    // spy and war cards beside it are crises like any other, and go the same
    // way as the Nation tab's — to the people who can answer them.
    intrigue: ((ints) => ({
      keys: [...rising.map((u) => u.id), ...(told ? ints.map((ev) => ev.uid) : [])],
      label: (n) => (rising.length && !ints.length ? 'a rising is under way'
        : rising.length ? `a rising, and ${ints.length} matter to answer`
          : `${n} matter to answer`),
    }))(intrigueEvents(world).filter((ev) => !ev.resolved)),
    // The court's one tab. A justice with an unvoted case is told so; anyone else
    // who can see the tab is a party, and the count is their own hearing.
    chambers: mine.length
      ? { keys: mine.map((c) => c.id), label: (n) => `${n} case to vote on` }
      : ((cs) => ({
        keys: cs.map((c) => c.id),
        label: (n) => `${n} hearing before the court`,
      }))(p ? CT.chamberCases(world, p.id).filter((c) => c.status === 'argued') : []),
  };
}

// The rooms you can only be in because of the chair you hold. They are gated, so
// they appear and disappear as offices change hands.
//
// This list is an *order*, not a set. The pinned block reads down the ladder of
// the executive — the Oval Office, then the three departments in the order the
// constitution ranks their secretaries — and then the rooms that are somebody
// else's branch: the Vice President's house, the bench, the chamber's back room.
// NAV order is irrelevant here; a room's place among your own rooms is fixed.
// The company sits at the foot of the pinned block. It is a room you can only
// be in because of what you hold — which is the whole definition of this list —
// but what you hold is a building rather than a chair, so it comes after the
// offices of the republic and before everything the whole country can read.
const OFFICE_ROOMS = ['oval', 'state', 'defense', 'exchequer', 'mansion', 'chambers', 'cloakroom', 'cloakroom_upper', 'company'];

/**
 * The sidebar, with your own room first.
 *
 * An office-only tab used to appear wherever it happened to sit in NAV — the
 * Oval Office was ninth, under things a President barely looks at. The room that
 * exists *because* of the chair you hold is the room you live in while you hold
 * it, so for as long as you hold it, it goes to the top. It drops back into place
 * the moment the office does.
 */
function navFor(world, p) {
  const visible = NAV.filter(([, , , gate]) => !gate || gate(world, p))
    // The company's tab wears the name of the storey it is standing on, so the
    // sidebar reads "The Basement" until the day it reads "Headquarters".
    .map((item) => (item[0] === 'company'
      ? [item[0], item[1], CO.stageOf(CO.companyOf(world, p?.id)?.valuation || 0).tab, item[3]]
      : item))
    // Each cloakroom wears its chamber's name, so a constitution that named its
    // rooms something else says so in the sidebar — and a unicameral one, which
    // has exactly one, calls it what it always called it.
    .map((item) => {
      if (item[0] !== 'cloakroom' && item[0] !== 'cloakroom_upper') return item;
      const L = world.constitution?.legislature || {};
      const room = item[0] === 'cloakroom' ? L.chamber : L.upperChamber;
      const label = !R.isBicameral(world) ? 'The Cloakroom'
        : cloakLabel(R.office(world, room)?.name || 'Chamber');
      return [item[0], item[1], label, item[3]];
    });

  // A startup, at the first stage, closes everything else in the sidebar. The
  // hours are all-consuming — a founder in the basement is not also reading
  // press articles and touring the districts — and the game says so by giving
  // them one room. Season stays visible because it is meta control the player
  // must never be locked out of. The moment the company clears the basement,
  // the sidebar is theirs again.
  // An officeholder keeps their rooms regardless of the company's storey: the
  // republic's answer to a President with a company is divestment (see
  // acts.tickDivestOfficeholders), not locking them out of the Oval Office —
  // and the divest sweep runs a tick behind the seating, which was exactly
  // long enough for the basement to swallow the sidebar of a fresh President.
  const co = CO.companyOf(world, p?.id);
  const inGarage = co && CO.stageOf(co.valuation || 0).id === 'garage'
    && !R.officesOf(world, p?.id).length;
  if (inGarage) {
    return visible.filter(([id]) => id === 'company' || id === 'season');
  }

  const mine = visible.filter(([id]) => OFFICE_ROOMS.includes(id))
    .sort((a, b) => OFFICE_ROOMS.indexOf(a[0]) - OFFICE_ROOMS.indexOf(b[0]));
  if (!mine.length) return visible;
  return [...mine, ...visible.filter(([id]) => !OFFICE_ROOMS.includes(id))];
}

export function renderNav(root) {
  const world = w();
  const p = me();
  // A player entry pointing at a persona this snapshot does not carry is a
  // desync, not a state. Repainting from it would drop every office tab at
  // once while the public tabs stayed — the sidebar we already have is truer
  // than that, so keep it and let the next good snapshot repaint.
  if (!p && myPlayer()?.personaId) {
    console.error('nav: player persona missing from snapshot', myPlayer().personaId);
    return;
  }
  const items = actionItems(world);
  S.seenKeys = S.seenKeys || {};

  root.replaceChildren(
    ...navFor(world, p).map(([id, ico, label], i, arr) => {
      const item = items[id];
      const keys = item ? item.keys : [];
      const seen = S.seenKeys[id] || [];
      // Looking at a tab counts as having seen everything on it.
      if (S.view === id) S.seenKeys[id] = keys.slice();
      const fresh = S.view === id ? 0 : keys.filter((k) => !seen.includes(k)).length;

      // A rule under the last pinned room, so it reads as yours rather than as
      // the first of the general list.
      const lastPinned = OFFICE_ROOMS.includes(id) && !OFFICE_ROOMS.includes(arr[i + 1]?.[0]);
      return el('button', {
        class: (S.view === id ? 'on' : '') + (fresh ? ' fresh' : '') + (lastPinned ? ' pinned-last' : ''),
        'data-tab': id,
        title: keys.length && item ? item.label(keys.length) : '',
        onclick: () => { S.view = id; S.seenKeys[id] = keys.slice(); CTX.rerender(true); },
      },
        el('span', { class: 'ico' }, ico), label,
        keys.length ? el('span', { class: 'badge' + (fresh ? ' new' : '') }, String(keys.length)) : null);
    }),
    el('div', { class: 'who' },
      el('b', {}, p ? p.name : '—'),
      el('div', {}, p ? officeLine(world, p) : 'not seated'),
      el('div', { class: 'tiny dimmer' }, myPlayer()?.moderator ? 'moderator (out-of-game)' : 'player'),
    ),
  );
}

function officeLine(world, p) {
  const offs = R.officesOf(world, p.id);
  if (!offs.length) return p.imprisoned ? 'imprisoned' : p.exiled ? 'in exile' : 'private citizen';
  const line = offs.map((o) => o.name).join(', ');
  // Still the President, and still not able to do anything about it. The
  // buttons all go quiet while a summit runs — see rules.abroad — so the
  // sidebar has to say why, or it reads as the game having broken.
  if (R.abroad(world, p.id)) {
    return `${line} — abroad, back in ${C.canonSpan(world, world.summit.ends - world.clock.tick)}`;
  }
  return line;
}

export function renderView(root) {
  // A gated room can close under you — a case is decided and the Supreme Court is
  // no longer yours to enter, a President dismisses you from the cabinet. The tab
  // vanishes from the sidebar the same tick, so sitting on the view afterwards
  // leaves you staring at a locked door with nothing to click. Step back out to
  // the Nation instead.
  // A gated tab can close under you; a tab can also stop existing between
  // versions — a save from before the Treasury moved into its department still
  // remembers sitting on it. Either way, step back out to the Nation.
  const item = NAV.find(([id]) => id === S.view);
  if (!item || (item[3] && !item[3](CTX.world, me()))) S.view = 'nation';

  // The body carries the active view so CSS can theme each section's accent,
  // and the Season's regime colour so the whole game wears its government.
  document.body.dataset.view = S.view || 'nation';
  const bs = document.body.style;
  if (CTX.world?.brand) {
    // A regime's colour is picked against parchment; after dark it is lifted
    // until it can still carry the wordmark, without losing its hue.
    const dark = TH.resolvedTheme() === 'dark';
    const b = CTX.world.brand, bh = CTX.world.brandHi || CTX.world.brand;
    bs.setProperty('--brand', dark ? TH.liftForDark(b) : b);
    bs.setProperty('--brand-hi', dark ? TH.liftForDark(bh, 0.66) : bh);
  } else { bs.removeProperty('--brand'); bs.removeProperty('--brand-hi'); }
  const fn = VIEWS[S.view] || VIEWS.nation;
  const node = el('div', { class: 'wrap' });
  try { fn(node); } catch (err) { node.append(el('pre', { class: 'blocked' }, String(err && err.stack || err))); console.error(err); }
  root.replaceChildren(node);
}

// --- Nation ----------------------------------------------------------------

const VIEWS = {};

VIEWS.nation = (root) => {
  const world = w();
  if (world.phase === 'convention') return VIEWS.convention(root);
  const app = nationalApproval(world);
  const e = world.economy;

  root.append(
    el('h1', { class: 'page' }, world.nation),
  );

  // An invitation into a closed room is answered here, on the page you land on.
  // The room's own tab does not appear until you have said yes, so there is
  // nowhere else it could go.
  root.append(...invitationCards(world));

  const open = world.events.filter((ev) => !ev.resolved);
  if (open.length) {
    root.append(el('div', { class: 'stack', style: { marginBottom: '16px' } },
      ...open.map((ev) => crisisCard(ev))));
  }

  if (world.uprising && !world.uprising.resolved) root.append(uprisingCard());

  root.append(el('div', { class: 'grid g4', style: { marginBottom: '14px' } },
    bigStat('National approval', app.toFixed(1) + '%', app >= 50 ? 'green' : 'red', e.history.map((h) => h.approval), approvalBreakdown({ standing: false }), { center: 50, halfMin: 10 }),
    bigStat('Treasury', money(e.treasury), e.treasury >= 0 ? '' : 'red', e.history.map((h) => h.treasury), null, { center: 0 }),
    bigStat('Unemployment', pct(e.unemployment), e.unemployment > 0.09 ? 'red' : '', e.history.map((h) => h.unemployment), null, { invert: true, fmt: (v) => pct(v) }),
    bigStat('Homeless', num(sum(world.districts, (d) => d.homeless)), '', e.history.map((h) => h.homeless), null, { invert: true, fmt: (v) => num(Math.round(v)) }),
  ));

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      districtCard(),
      el('div', { class: 'card' }, el('h3', {}, 'The record, lately'),
        el('div', { class: 'chron' }, ...world.chronicle.slice(-14).reverse().map((entry) => chronRow(entry, false)))),
    ),
    el('div', { class: 'stack' },
      approvalCard(),
      el('div', { class: 'card' }, el('h3', {}, 'Government'),
        ...world.constitution.offices.map((o) => {
          const hs = R.holders(world, o.id);
          const ap = R.approvalOfOffice(world, o.id);
          const seats = world.seats.filter((s) => s.office === o.id).length;
          // Who holds it, when that is a thing you can read.
          //
          // This printed every holder's name, which is right for a President and
          // useless for a chamber: the House and the Senate put twenty names
          // apiece under their approval figure, and forty names nobody is
          // looking up buried the five offices on this card that a player
          // actually reads. Past a handful the interesting fact is not who they
          // are but how many chairs are full, and the Congress tab has the
          // roster, by chamber, for when the names are the question.
          const who = hs.length > 4
            ? `${hs.length} of ${seats} seats filled`
            : hs.map((h) => h.name).join(', ') || 'vacant';
          return el('div', { class: 'spread', style: { padding: '5px 0', borderBottom: '1px solid var(--rule-strong)' } },
            el('div', {}, el('div', { class: 'small' }, o.name),
              el('div', { class: 'tiny dimmer' }, who)),
            ap == null ? el('span', { class: 'tag red' }, 'vacant')
              : el('span', { class: 'mono small ' + (ap >= 50 ? 'green' : 'red') }, ap.toFixed(0) + '%'));
        })),
      el('div', { class: 'card' }, el('h3', {}, 'Foreign powers'),
        ...world.foreign.map((f) => el('div', { style: { padding: '5px 0' } },
          el('div', { class: 'spread' }, el('b', { class: 'small' }, f.name),
            el('span', { class: 'tag ' + (f.atWar ? 'red' : f.allied ? 'green' : '') }, f.atWar ? 'at war' : f.allied ? 'allied' : f.ideology)),
          el('div', { class: 'bar', style: { marginTop: '4px' } },
            el('i', { style: { width: f.hostility + '%', background: f.hostility > 60 ? 'var(--red)' : 'var(--gold-dim)' } })),
          el('div', { class: 'tiny dimmer' }, 'hostility ' + Math.round(f.hostility)))),
        world.military.wars.some((x) => world.foreign.find((f) => f.id === x.foreign)?.atWar)
          ? el('div', { class: 'tiny dim', style: { marginTop: '8px' } },
            'War exhaustion ' + pct(world.military.exhaustion, 0) + ' · ' + world.military.units + ' units') : null),
      el('div', { class: 'card' }, el('h3', {}, 'Pulse'),
        el('div', { class: 'row' }, el('span', { class: 'pulse' + ((world.pulse || 0) < 6 ? ' low' : '') }),
          el('span', { class: 'small dim' }, (world.pulse || 0) < 6
            ? 'Quiet. The director is looking for something to do.'
            : 'Active. ' + (world.pulse || 0) + ' weighted acts in the last minute.')),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'Next injection possible in ' + Math.max(0, world.directorCooldown) + ' ticks.')),
    ),
  ));
};

// One good↔bad color scale for the whole UI: stat sparks and city overlays all
// speak it. Poles are darker than the midpoint so the ramp survives red-green
// colorblindness by lightness alone (validated); direction/height carries the
// same signal, so color is never the only encoding.
function heat(t) {
  t = clamp(t, 0, 1);
  const R = [185, 28, 28], A = [226, 167, 19], G = [30, 126, 52]; // red, amber, green
  const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const c = t < 0.5 ? mix(R, A, t * 2) : mix(A, G, (t - 0.5) * 2);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function bigStat(label, value, cls, series, help, opts = {}) {
  const s = (series || []).slice(-40);
  // Scale to the series' own range, not to zero — otherwise every line that
  // moves by a few percent renders as a solid block.
  const lo = Math.min(...s), hi = Math.max(...s);
  const span = hi - lo;
  let bars;
  if (opts.center != null) {
    // A centered chart: the interesting fact is which side of the line you are
    // on (50% approval, $0 treasury), so bars grow up from the midline on the
    // good side and down into the red on the bad one.
    const half = Math.max(opts.halfMin || 1e-9, ...s.map((v) => Math.abs(v - opts.center)));
    bars = el('div', { class: 'spark center' }, ...s.map((v) => {
      const dev = (v - opts.center) / half; // -1..1
      return el('i', {}, el('b', { style: {
        [dev >= 0 ? 'bottom' : 'top']: '50%',
        height: Math.max(3, Math.abs(dev) * 46) + '%',
        background: heat(0.5 + dev / 2),
      } }));
    }));
  } else {
    bars = el('div', { class: 'spark' }, ...s.map((v) => {
      const t = span > 1e-9 ? (v - lo) / span : 0.5;
      return el('i', { style: {
        height: (span > 1e-9 ? 8 + t * 92 : 50) + '%',
        background: heat(opts.invert ? 1 - t : t),
      } });
    }));
  }
  // A tiny axis: the window's high and low, and the net change between them —
  // otherwise a range-scaled wiggle has no magnitude.
  if (opts.fmt && s.length > 1) {
    const d = s[s.length - 1] - s[0];
    const better = opts.invert ? d < 0 : d > 0;
    bars = el('div', { class: 'spark-row' }, bars,
      el('div', { class: 'spark-axis mono' },
        el('span', {}, opts.fmt(hi)),
        el('span', { class: Math.abs(d) < 1e-9 ? 'dim' : better ? 'green' : 'red' },
          (d >= 0 ? '+' : '−') + opts.fmt(Math.abs(d))),
        el('span', {}, opts.fmt(lo))));
  }
  return el('div', { class: 'card tight' + (help ? ' has-help' : '') },
    // A hover/focus "?" that reveals an explanation right where the number is,
    // instead of making the player hunt for the breakdown panel.
    help ? el('div', { class: 'help', tabindex: 0, title: 'What moves this number' },
      el('span', { class: 'help-q' }, '?'),
      el('div', { class: 'help-body' }, help)) : null,
    el('div', { class: 'tiny dimmer', style: { letterSpacing: '.1em', textTransform: 'uppercase' } }, label),
    el('div', { class: 'mono ' + cls, style: { fontSize: '22px', margin: '2px 0 6px' } }, value),
    bars);
}

// Why approval is where it is, and where it is heading — so a falling number
// is an argument the player can act on, not a mystery.
// The breakdown itself, without a card wrapper — reused by the Nation-page card
// and by the "?" popover that hangs off the National approval stat.
/**
 * What each row of the breakdown actually means, in words.
 *
 * The chart names the engine's own variables, and one of them was called
 * "Solvency" — which tells a player nothing about what to do next. It is
 * "Treasury" now, and every row carries the sentence that explains it.
 */
const DRIVER_WHY = {
  Unemployment: 'Out of work beyond the ~4% treated as normal. Jobs and relief money move it.',
  Housing: 'Nowhere to live beyond what the country tolerates. New housing moves it.',
  Taxes: 'What the tax burden costs in goodwill, beyond about 8%.',
  Order: 'Order against a settled 50. Police money and jails raise it, unrest lowers it.',
  Amenities: 'Parks, schools and hospitals close enough to use.',
  Health: 'Public health. Hospitals hold it up, neglect lets it slide.',
  War: 'War exhaustion. Every tick of war costs a little; peace recovers it slowly.',
  Emergency: 'A state of emergency is in force, and the country can tell.',
  Treasury: 'Years of spending in reserve. Full marks at two; drawing it down costs you, a deficit more.',
};

/**
 * Why the approval is what it is.
 *
 * Drawn twice: once in full, as the card in the Nation tab's right column, and
 * once folded into the `?` beside the National approval figure at the top of
 * the page. `standing` is what differs — the twenty-row district list belongs
 * in the card and not in the popover. It was in both, and at twenty states that
 * is a column of bars taller than the window hanging off a hover, restating
 * what the card two inches to the right already says.
 */
function approvalBreakdown({ standing = true } = {}) {
  const world = w();
  const { drivers, target, now, trend } = approvalDrivers(world);
  const arrow = trend > 0.4 ? '↑ rising' : trend < -0.4 ? '↓ falling' : '→ steady';
  const cls = trend > 0.4 ? 'green' : trend < -0.4 ? 'red' : 'dim';
  const maxAbs = Math.max(1, ...drivers.map((d) => Math.abs(d.value)));
  return el('div', {},
    el('div', { class: 'spread', style: { marginBottom: '8px' } },
      el('span', { class: 'small dim' }, `Now ${now.toFixed(0)}% · heading toward ${target.toFixed(0)}%`),
      el('span', { class: 'mono small ' + cls }, arrow)),
    ...drivers.map((d) => {
      const pos = d.value >= 0;
      return el('div', { class: 'meter', style: { margin: '4px 0' }, title: DRIVER_WHY[d.label] || '' },
        el('span', { class: 'lab' }, d.label),
        el('div', { class: 'bar', style: { background: 'transparent' } },
          el('i', { style: { width: (Math.abs(d.value) / maxAbs) * 100 + '%', background: pos ? 'var(--green)' : 'var(--red)' } })),
        el('span', { class: 'val ' + (pos ? 'green' : 'red') }, (pos ? '+' : '') + d.value.toFixed(1)));
    }),
    drivers.length ? null : el('div', { class: 'tiny dimmer' }, 'Nothing is moving opinion right now.'),
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      'Points of approval, weighted by population.'),
    standing ? districtStanding() : null);
}

/**
 * Where you stand, district by district.
 *
 * A national figure is an average and an average is the one number a politician
 * cannot campaign on. This says which rooms are cold — worst first, because
 * that is the order the work is in — and it is the same reading the chamber
 * uses when it votes on your bill (sim.approvalIn), so the page and the floor
 * cannot disagree about it.
 */
function districtStanding() {
  const world = w();
  const p = me();
  if (!p) return null;
  const rows = approvalByDistrict(world, p);
  if (!rows.length) return null;
  const nat = clamp(p.approval ?? 50, 0, 100);
  return el('div', { style: { marginTop: '12px', borderTop: '1px solid var(--rule)', paddingTop: '8px' } },
    el('div', { class: 'spread', style: { marginBottom: '6px' } },
      el('span', { class: 'small dim' }, 'How you read, district by district'),
      el('span', { class: 'tiny dimmer mono' }, `${nat.toFixed(0)}% nationally`)),
    ...rows.map((r) => {
      const v = r.approval;
      const tone = v >= 55 ? 'var(--green)' : v >= 40 ? 'var(--gold)' : 'var(--red)';
      return el('div', { class: 'meter', style: { margin: '3px 0' } },
        el('span', { class: 'lab' },
          el('span', { style: { color: r.district.color } }, '▍'), ' ', r.district.name,
          r.home ? el('span', { class: 'tiny dimmer' }, ' · your own') : null),
        el('div', { class: 'bar' }, el('i', { style: { width: v + '%', background: tone } })),
        el('span', { class: 'val mono' }, v.toFixed(0)));
    }),
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      'A district reads you through its own temper; its own people are kinder. '
      + 'It is what their member weighs when your bill reaches the floor.'));
}

function approvalCard() {
  return el('div', { class: 'card' }, el('h3', {}, 'Why the approval'), approvalBreakdown());
}

// Districts that hold or border water — computed live from the (stable) water
// geometry, so it stays right even after the chamber re-partitions the map.
function waterfrontDistricts(world) {
  const water = world.city?.water;
  if (!water || !water.length) return new Set();
  const W = world.city.w, H = world.city.h, out = new Set();
  for (const i of water) {
    const x = i % W, y = Math.floor(i / W);
    for (const [nx, ny] of [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = world.city.parcels[ny * W + nx];
      if (np) out.add(np.district);
    }
  }
  return out;
}

/**
 * Why one state's mood is what it is, on the row it belongs to.
 *
 * `sim.tickOpinion` has always written `d.moodParts` — the same named reasons
 * the national breakdown is summed out of, but for one state — and until now
 * nothing read it. A national average is the one number a politician cannot
 * campaign on, and twenty states means twenty different answers to "why": New
 * York is unhappy about housing and California about nothing in particular, and
 * you could not tell them apart from this page.
 *
 * A `?` rather than a row of its own, because it is an answer to a question you
 * only sometimes have, and twenty expanded breakdowns is the States table
 * twenty times over.
 */
function districtWhy(d) {
  const parts = Object.entries(d.moodParts || {})
    // Below a tenth of a point a row is noise wearing a label. The engine
    // computes every term every tick, so a state with no war and no emergency
    // still carries them at exactly zero.
    .filter(([, v]) => Math.abs(v) >= 0.05)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const maxAbs = Math.max(1, ...parts.map(([, v]) => Math.abs(v)));
  return el('div', { class: 'help inline', tabindex: 0, title: `Why ${d.name} feels the way it does` },
    el('span', { class: 'help-q' }, '?'),
    el('div', { class: 'help-body' },
      el('div', { class: 'spread', style: { marginBottom: '8px' } },
        el('b', { class: 'small' }, d.name),
        el('span', { class: 'tiny dimmer mono' }, d.moodTarget != null
          // Where it is and where it is going. The mood walks toward the target
          // a little each tick, so the gap between the two is the news.
          ? `${Math.round(d.mood)} → ${Math.round(d.moodTarget)}`
          : `${Math.round(d.mood)}`)),
      ...parts.map(([label, v]) => el('div', {
        class: 'meter', style: { margin: '4px 0' }, title: DRIVER_WHY[label] || '',
      },
        el('span', { class: 'lab' }, label),
        el('div', { class: 'bar', style: { background: 'transparent' } },
          el('i', { style: {
            width: (Math.abs(v) / maxAbs) * 100 + '%',
            background: v >= 0 ? 'var(--green)' : 'var(--red)',
          } })),
        el('span', { class: 'val ' + (v >= 0 ? 'green' : 'red') }, (v >= 0 ? '+' : '') + v.toFixed(1)))),
      parts.length ? null : el('div', { class: 'tiny dimmer' }, 'Nothing is pulling this state either way.'),
      el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
        'Points for and against, on top of the 58 a contented state sits at.')));
}

function districtCard() {
  const world = w();
  const wf = waterfrontDistricts(world);
  return el('div', { class: 'card' }, el('h3', {}, 'States'),
    el('table', { class: 't' },
      // The last column has no heading: it is one `?` per row, and "Why" over a
      // column of question marks is the label written twice.
      el('thead', {}, el('tr', {}, ...['State', 'Pop', 'Mood', 'Unemp', 'Homeless', 'Land', 'In Congress', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...world.districts.map((d) => {
        // A state sends a delegation, not a representative. This picked the
        // first seat it found for the state, which under a one-seat-per-state
        // House was the whole answer and under an apportioned one is a quarter
        // of it — Texas has four members and this named one of them, silently.
        const delegation = world.seats.filter((x) => x.district === d.id && x.personaId);
        const rep = delegation.length === 1 ? world.personas[delegation[0].personaId] : null;
        return el('tr', {},
          el('td', {}, el('span', { style: { color: d.color } }, '▍'), ' ', d.name,
            wf.has(d.id) ? el('span', { class: 'tiny', title: 'Waterfront — leans to trade and industry', style: { color: '#3f7fa8', marginLeft: '4px' } }, '≈') : null,
            d.seceded ? el('span', { class: 'tag red' }, 'seceded') : null),
          el('td', { class: 'mono' }, num(d.pop)),
          el('td', {}, el('div', { class: 'bar', style: { width: '64px' } },
            el('i', { style: { width: d.mood + '%', background: d.mood >= 50 ? 'var(--green)' : 'var(--red)' } })),
            el('span', { class: 'tiny dimmer mono' }, Math.round(d.mood))),
          el('td', { class: 'mono ' + (d.unemployment > 0.1 ? 'red' : '') }, pct(d.unemployment)),
          el('td', { class: 'mono' }, num(d.homeless)),
          el('td', { class: 'mono dim' }, '$' + d.landValue + 'k'),
          el('td', { class: 'small dim' },
            rep ? rep.name
              : delegation.length
                ? `${delegation.length} member${delegation.length === 1 ? '' : 's'}`
                : '—'),
          el('td', { class: 'whycell' }, districtWhy(d)));
      }))));
}

function crisisCard(ev) {
  const world = w();
  const p = me();
  // A notice reports rather than asks. Same slot on the Nation tab, because
  // that is where you look — but no clock, no options, and no line about it
  // resolving against you, since there is nothing left to resolve.
  // The card is posted to the whole republic — everyone can read what is
  // happening to the country. Answering it is the chair's, and only the chair's:
  // see rules.mayAnswerCrisis, which is the door the engine actually checks.
  const mine = R.mayAnswerCrisis(world, p?.id);
  const head = R.headOffice(world);
  if (ev.notice) {
    return el('div', { class: 'crisis filed' },
      el('div', { class: 'spread' }, el('h4', {}, ev.title),
        el('span', { class: 'tag mono' }, 'Notice')),
      el('p', { class: 'serif', style: { margin: '0 0 10px' } }, ev.text),
      mine
        ? el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => go('ACKNOWLEDGE', { evUid: ev.uid }) }, 'Acknowledge'))
        : null,
      el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
        mine
          ? 'Already happened. Acknowledging files it and clears the card.'
          : `Already happened. The ${head?.name || 'executive'} files it; you are reading it.`));
  }
  const left = ev.deadline - world.clock.tick;
  // Options you cannot afford under your own spending rules are the whole
  // reason the emergency power exists, so say so at the point of refusal
  // rather than leaving the player to find it.
  const blockedByMoney = mine && ev.options.some((o) => o.cost && p && !A.disburseGate(world, p.id, o.cost).ok);
  return el('div', { class: 'crisis' },
    el('div', { class: 'spread' }, el('h4', {}, ev.title),
      el('span', { class: 'tag red mono' }, left > 0 ? left + ' ticks to answer' : 'expiring')),
    el('p', { class: 'serif', style: { margin: '0 0 10px' } }, ev.text),
    // Everyone sees what is on the table. Only the chair may take one off it —
    // the rest of the republic reads the options and waits, which is most of
    // what it is like to not be the President.
    mine
      ? el('div', { class: 'row' }, ...ev.options.map((o) => {
        const gate = o.cost && p ? A.disburseGate(world, p.id, o.cost) : { ok: true, reasons: [] };
        return el('button', {
          class: 'btn' + (gate.ok ? '' : ' ghost'),
          title: gate.ok ? '' : gate.reasons.join(' '),
          onclick: () => go('RESPOND', { evUid: ev.uid, option: o.i }),
        }, o.label, o.cost ? el('span', { class: gate.ok ? 'dimmer' : 'red' }, ' · ' + money(o.cost)) : null);
      }))
      : el('div', {},
        el('div', { class: 'tiny dim', style: { marginBottom: '4px' } }, 'What is on the table:'),
        ...ev.options.map((o) => el('div', { class: 'small dim', style: { padding: '2px 0 2px 0.12in' } },
          '— ', o.label, o.cost ? el('span', { class: 'dimmer' }, ' · ' + money(o.cost)) : null)),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          head ? `The ${head.name} answers this one.` : 'There is no executive to answer it.')),
    // Two ways past a threshold you cannot reach: suspend it, or ask the
    // chamber. The emergency is the executive acting alone and paying for it in
    // approval; the bill is the constitutional answer, drafted for you and laid
    // on the floor in one click.
    //
    // They go in the same box, on the same line, because they are one choice
    // and not two. Sitting under the box, the referral read as a separate
    // afterthought that happened to be nearby — the emergency was the offer and
    // this was a footnote. Beside it, in plain white against the emergency's
    // red, it reads as the other half of the same question.
    blockedByMoney
      ? el('div', {},
        emergencyPrompt(ev.options.filter((o) => o.cost).map((o) => el('button', {
          class: 'btn sm',
          title: 'Drafts the appropriation and lays it before the chamber.',
          onclick: () => go('CREATE_DOC', {
            introduce: true,
            doc: {
              type: 'bill',
              title: `${ev.title} — appropriation`,
              preamble: `Whereas ${ev.title.toLowerCase()} requires an answer the executive cannot fund alone, `
                + `this chamber appropriates the sum needed for: ${o.label}.`,
              clauses: [{ kind: 'APPROPRIATE', amount: o.cost, purpose: `${ev.title}: ${o.label}` }],
              // The bill remembers what it was for. Without this the chamber
              // could pass the appropriation, the money could leave the
              // treasury, and the crisis would still expire against the
              // government for having been ignored — see acts.promulgate.
              answers: { evUid: ev.uid, option: o.i },
            },
          }),
          // The body by its own name. Every constitution names its chamber
          // differently — Assembly, Council, Ministers — and a button that
          // said "the chamber" was right nowhere in particular.
        }, `Refer to the ${R.office(world, world.constitution.legislature?.chamber)?.name || 'chamber'} — ${money(o.cost)}`))),
        el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
          'A bill takes a vote and time. An emergency takes neither and costs approval every tick.'))
      : null,
    el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      mine
        ? 'A prompt, not a script. Ignore it and it resolves against you.'
        : 'Ignored, it resolves against the republic, and the record says who held the chair.'));
}

/**
 * An emergency is nearly always declared for one of a handful of reasons, and
 * the Chronicle entry it writes reads better as a stated ground than as
 * whatever the executive typed in a hurry. These are offered first; the blank
 * field is still one choice away, because the interesting emergency is always
 * the one nobody anticipated.
 */
const EMERGENCY_REASONS = [
  'A crisis is outrunning the legislature and will not wait for a bill.',
  'The treasury cannot answer this under our own spending rules.',
  'Public order has broken down and must be restored before it spreads.',
  'A foreign power is moving against us.',
  'Disaster relief cannot wait for the floor.',
  'An armed rising is under way against this government.',
];

/**
 * The emergency power, surfaced wherever it is the answer to your problem.
 *
 * `alongside` is whatever else answers the same problem — on a crisis card,
 * the button that refers the appropriation to the chamber instead. It goes on
 * the same line as the declare button and inside the same red box, because the
 * player is choosing between them and not reading two separate offers.
 */
export function emergencyPrompt(alongside = null) {
  const world = w();
  const p = me();
  const c = world.constitution.emergency;
  const em = world.emergency;
  const others = [].concat(alongside || []).filter(Boolean);

  if (em && em.active) {
    const left = em.ends - world.clock.tick;
    const canEnd = p && R.hasPower(world, p.id, 'emergency');
    return el('div', { class: 'blocked', style: { marginTop: '10px' } },
      el('b', {}, 'A state of emergency is in force. '),
      `Declared by ${world.personas[em.by]?.name || 'the executive'}${em.reason ? ' — ' + em.reason : ''}. `,
      `Spending thresholds lift for ${Math.max(0, left)} more ticks. Approval falls while it lasts.`,
      canEnd || others.length
        ? el('div', { class: 'row', style: { marginTop: '8px' } },
          canEnd ? el('button', { class: 'btn sm', onclick: () => go('EMERGENCY', { on: false }) }, 'Lift the emergency') : null,
          ...others)
        : null);
  }
  if (!c) {
    return el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      'No emergency power here. Anything above your threshold goes to the floor.',
      others.length ? el('div', { class: 'row', style: { marginTop: '8px' } }, ...others) : null);
  }

  const office = R.office(world, c.office);
  const canDeclare = p && R.hasPower(world, p.id, 'emergency');
  return el('div', { class: 'blocked', style: { marginTop: '10px' } },
    `The ${office?.name || 'executive'} may declare an emergency, lifting the spending thresholds for up to ${c.maxYears} canon year(s)`,
    c.suspendsLegislature ? ' and suspends the legislature' : '', '. It costs approval while it runs.',
    canDeclare
      ? el('div', { class: 'row', style: { marginTop: '8px' } }, el('button', {
          class: 'btn sm danger', onclick: () => ask({
            title: 'Declare a state of emergency',
            body: `Spending thresholds lift for up to ${c.maxYears} year(s). Every district loses approval at once and keeps losing it. Recorded in your name.`,
            label: 'Declare it', danger: true,
            input: { label: 'Stated reason', presets: EMERGENCY_REASONS, placeholder: 'The encampment cannot wait for the Assembly.' },
            onConfirm: (reason) => go('EMERGENCY', { on: true, reason }),
          }),
        }, 'Declare a state of emergency'), ...others)
      // No emergency power in your hands, but the chamber is still there. The
      // referral must not disappear with the button it was standing next to.
      : el('div', {},
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          `Only the ${office?.name || 'executive'} holds that power. You do not.`),
        others.length ? el('div', { class: 'row', style: { marginTop: '8px' } }, ...others) : null));
}

function uprisingCard() {
  const world = w();
  const u = world.uprising;
  const check = I.supportCheck(world);
  const leader = world.personas[u.leaderId];
  const left = u.closes - world.clock.tick;
  return el('div', { class: 'crisis', style: { marginBottom: '14px' } },
    el('div', { class: 'spread' },
      el('h4', {}, u.kind === 'secession' ? 'Secession declared' : u.kind === 'revolution' ? 'A revolution is under way' : 'A rising is under way'),
      el('span', { class: 'tag red mono' }, left + ' ticks')),
    el('p', { class: 'serif', style: { margin: '0 0 8px' } }, `${leader?.name} — “${u.cause}”`),
    el('div', { class: 'votebar', style: { marginBottom: '6px' } },
      el('i', { class: 'n', style: { width: (check.share * 100) + '%' } }),
      el('i', { class: 'y', style: { width: (100 - check.share * 100) + '%' } })),
    el('div', { class: 'spread tiny dim' },
      el('span', {}, 'rising ' + Math.round(check.share * 100) + '%'),
      el('span', {}, 'government ' + Math.round(100 - check.share * 100) + '%')),
    el('div', { class: 'spread tiny', style: { margin: '4px 0 2px' } },
      el('span', { class: 'red' }, `movement ${Math.round(u.movement || 0)} recruited`),
      el('span', { class: 'dimmer' }, `public disapproval ${Math.round((u.grievance ?? 0) * 100)}% — it grows the movement`)),
    el('div', { class: 'tiny dimmer', style: { margin: '6px 0 10px' } },
      `players ${check.detail.players.rising.toFixed(0)}/${check.detail.players.loyal.toFixed(0)} · offices ${check.detail.offices.rising.toFixed(0)}/${check.detail.offices.loyal.toFixed(0)} · arms ${check.detail.arms.rising.toFixed(0)}/${check.detail.arms.loyal.toFixed(0)} · citizens ${check.detail.citizens.rising.toFixed(0)}/${check.detail.citizens.loyal.toFixed(0)} · movement ${(check.detail.movement || 0).toFixed(0)}`),
    // The leader is not offered a side. They are one — declared the moment they
    // raised the standard — so what they get here is the streets, and a line
    // saying which rising this is. Everyone else declares, and may turn.
    ((meId, mine) => el('div', { class: 'row' },
      el('button', { class: 'btn danger', onclick: () => go('RALLY', {}) }, 'Take to the streets'),
      meId && meId === u.leaderId
        ? el('span', { class: 'tag red', style: { alignSelf: 'center' } }, 'You are the rising')
        : el('button', {
          class: 'btn danger' + (mine === 'rising' ? ' primary' : ''),
          onclick: () => go('PLEDGE', { side: 'rising' }),
        }, mine === 'rising' ? 'Declared for the rising' : 'Declare for the rising'),
      meId && meId === u.leaderId ? null : el('button', {
        class: 'btn' + (mine === 'government' ? ' primary' : ''),
        onclick: () => go('PLEDGE', { side: 'government' }),
      }, mine === 'government' ? 'Declared for the government'
        : mine === 'rising' ? 'Turn to the government' : 'Declare for the government')))(me()?.id, u.pledges[me()?.id]));
}

// The secret organising phase — visible only to the head of government's rivals,
// and only to those who are actually in on a plot once one exists.
function plotCard() {
  const world = w();
  const meId = me()?.id;
  if (!meId) return null;
  const plot = world.plot;
  const isHead = meId === I.headId(world);

  if (!plot) {
    if (isHead) return null; // the head of government does not conspire against themselves
    return el('div', { class: 'card' }, el('h3', {}, 'Conspire in the dark'),
      el('p', { class: 'tiny dimmer' }, 'Recruit ministers one at a time; a comfortable one may refuse and run to the government. Then raise a revolution with the cabal behind you, or strike.'),
      el('input', { id: 'plotcause', placeholder: 'What you tell those you sound out', style: { marginBottom: '8px' } }),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => go('PLOT_START', { kind: 'revolution', cause: document.getElementById('plotcause').value }) }, 'Begin a revolution plot'),
        el('button', { class: 'btn danger', onclick: () => go('PLOT_START', { kind: 'coup', cause: document.getElementById('plotcause').value }) }, 'Begin a coup plot')));
  }

  const inPlot = plot.members.includes(meId);
  const invited = !!(plot.invited && plot.invited[meId]);
  if (!inPlot && !invited && !plot.exposed) return null; // secret to everyone else
  const recruitable = I.ministers(world)
    .filter((pid) => pid !== meId && !plot.members.includes(pid) && !(plot.invited && plot.invited[pid]))
    .map((pid) => [pid, world.personas[pid]?.name]);
  const odds = plot.kind === 'coup' ? I.coupOdds(world) : null;
  return el('div', { class: 'card' + (plot.forewarned ? '' : ' gold') },
    el('h3', {}, plot.kind === 'coup' ? 'The coup' : 'The revolution plot'),
    el('p', { class: 'serif tiny', style: { margin: '0 0 6px' } }, `“${plot.cause}”`),
    el('div', { class: 'spread tiny' },
      el('span', {}, `${plot.members.length} sworn` + (odds ? ` · ${odds.loyal} loyal ministers` : '')),
      el('span', { class: plot.forewarned ? 'red' : 'dimmer' }, plot.forewarned ? 'the government is forewarned' : `exposure ${Math.round(plot.exposure)}%`)),
    plot.kind === 'coup'
      ? el('div', { class: 'tiny', style: { margin: '4px 0' } },
          el('b', { class: odds.p > 0.55 ? 'green' : odds.p < 0.35 ? 'red' : '' }, `coup odds ${Math.round(odds.p * 100)}%`),
          el('span', { class: 'dimmer' }, ' — rises sharply with each minister who joins'))
      : el('div', { class: 'tiny dimmer', style: { margin: '4px 0' } }, 'More ministers sworn at launch, more leverage.'),
    inPlot ? el('label', { class: 'field', style: { marginBottom: 0 } }, el('span', {}, 'Sound out a minister'),
      select([['', 'choose…'], ...recruitable], '', (v) => v && go('PLOT_RECRUIT', { targetId: v }))) : null,
    invited ? el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { class: 'btn primary', onclick: () => go('PLOT_JOIN', {}) }, 'Join the plot'),
      el('button', { class: 'btn', onclick: () => go('PLOT_EXPOSE', {}) }, 'Betray it to the government')) : null,
    el('div', { class: 'row', style: { marginTop: '8px' } },
      (inPlot && meId === plot.leaderId && plot.kind === 'revolution') ? el('button', { class: 'btn danger', onclick: () => go('PLOT_LAUNCH', {}) }, 'Launch the revolution') : null,
      (inPlot && meId === plot.leaderId && plot.kind === 'coup') ? el('button', { class: 'btn danger', onclick: () => go('PLOT_STRIKE', {}) }, 'Give the order') : null,
      (inPlot && meId !== plot.leaderId) ? el('button', { class: 'btn', onclick: () => go('PLOT_EXPOSE', {}) }, 'Betray it') : null));
}

// --- Constitutional Convention ---------------------------------------------

/**
 * A folded-away "Advanced" section, the way the setup page hides ticks-per-year.
 *
 * The convention rebuilds on the tick like every other view, so a bare <details>
 * would slam itself shut under whoever had just opened it and started typing.
 * The open state lives in S.adv keyed by section, and is written back on toggle,
 * so it survives the rebuild.
 */
function advSection(key, label, ...children) {
  return el('details', {
    class: 'setup-adv',
    open: S.adv[key] ? '' : null,
    ontoggle: (e) => { S.adv[key] = e.target.open; },
  }, el('summary', {}, label), el('div', { style: { marginTop: '10px' } }, ...children));
}

/**
 * The way back out of the convention, at the foot of the right-hand column
 * under the button that begins the Season.
 *
 * Every screen from the title onward can be walked backwards, and this is the
 * last of them — but it is the first one with a world behind it. Going back
 * from the founding page closes a form; going back from here discards a
 * republic, and if anybody else is at the table it discards theirs too. So it
 * asks twice, and the second press says plainly what it is about to do. The
 * arming resets on the next repaint of this view, which is about a second, so
 * a stray click cannot leave a live delete sitting under the cursor.
 */
function conventionBack(world) {
  const others = Object.keys(world.players || {}).filter((id) => id !== CTX.playerId).length;
  if (!S.backArmed) {
    return el('div', { class: 'card conv-back' },
      el('button', {
        class: 'btn ghost sm', style: { width: '100%' },
        onclick: () => { S.backArmed = true; CTX.rerender(true); },
      }, '← Back'),
      el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
        'Return to the founding page. Nothing here has happened yet.'));
  }
  return el('div', { class: 'card conv-back armed' },
    el('div', { class: 'blocked', style: { marginBottom: '8px' } },
      'This discards the convention and the republic behind it',
      others ? `, for all ${others + 1} founders at the table` : '',
      '. The nation’s name and your details are kept.'),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn danger sm',
        onclick: () => { S.backArmed = false; CTX.abandonFounding?.(); },
      }, 'Discard and go back'),
      el('button', {
        class: 'btn ghost sm',
        onclick: () => { S.backArmed = false; CTX.rerender(true); },
      }, 'Stay here')));
}

/**
 * The convention, in two screens.
 *
 * This game is the United States, not a kit for inventing a country: the
 * government it opens with is the one the Constitution lays out — a President
 * and a Vice President, a House of 45 apportioned by population, a Senate of
 * twenty. So the screen a table actually has to walk through is the short one:
 * take a chair, pick a side, ready up. The document is still fully editable and
 * still compiles to the rules the engine enforces — it is one button away, on
 * its own page, for the table that means to argue about it.
 *
 * The two screens are one view because they share the constitution `c`, the
 * `push` that broadcasts it and the seat list that reads it. Which one is up
 * lives in S, not in the world: it is a fact about this player's screen, not
 * about the republic, and another tab's founder should not be dragged into the
 * document because you opened it.
 */
VIEWS.convention = (root) => {
  const world = w();
  const c = world.constitution;
  const docOpen = !!S.conventionDoc;
  const openDoc = (on) => { S.conventionDoc = on; CTX.rerender(true); };
  const docBack = () => el('div', { class: 'row' },
    el('button', { class: 'btn ghost sm', onclick: () => openDoc(false) },
      '← Back to the seating'));

  root.append(
    el('div', { class: 'setup-step' }, 'Before the Season begins'),
    el('h1', { class: 'page' }, docOpen ? 'Constitutional Convention' : 'Take your seat'),
    el('div', { class: 'tricolour left' }, el('i', {}), el('i', {}), el('i', {})),
    el('p', { class: 'sub' }, docOpen
      ? 'Every clause below compiles to a rule the engine enforces. Change it, then argue.'
      : 'The government is the one the Constitution sets out. Choose the chair you will hold and the party you will hold it for, then ready up.'),
  );

  const docCol = el('div', { class: 'stack' },
      el('div', { class: 'card' },
        el('h3', {}, 'Preamble'),
        el('textarea', { rows: 3, oninput: (e) => { c.preamble = e.target.value; }, value: c.preamble }, c.preamble),
        el('div', { class: 'tiny dimmer' }, 'Prose — the only part the engine will not enforce.')),

      el('div', { class: 'card' }, el('h3', {}, 'Offices and the powers attached to them'),
        el('p', { class: 'tiny dimmer', style: { marginTop: '-4px' } },
          'Strike any office you don’t want: set seats to 0, or Remove.'),
        // At-will cabinet posts aren't shown here — no one can hold one at the
        // founding; the President names them later from the Offices view.
        ...c.offices.map((o, oi) => o.atWill ? null : el('div', { class: 'office-card' + (o.seats > 0 ? '' : ' struck') },
          el('div', { class: 'office-head' },
            el('div', {},
              el('b', {}, o.name),
              o.seats > 0 ? null : el('span', { class: 'tag red', style: { marginLeft: '8px' } }, 'will not exist'),
              el('div', { class: 'tiny dimmer' }, o.seats > 0 ? R.describeOffice(world, o) : 'zero seats')),
            el('div', { class: 'row' },
              el('span', { class: 'tag' + (o.powers.length ? ' gold' : ' red') },
                o.powers.length ? o.powers.length + ' power' + (o.powers.length === 1 ? '' : 's') : 'no power'),
              el('button', { class: 'btn sm danger', onclick: () => strikeOffice(oi) }, 'Remove'))),

          // Stated in place, under the name, rather than in a dialog — the
          // warning has to be readable while you are still editing the field.
          o.seats > 0 ? null : el('div', { class: 'blocked', style: { margin: '2px 0 8px' } },
            `Zero seats: the ${o.name} will not exist in game. It stays in case you change your mind, dropped at ratification.`),

          el('div', { class: 'office-fields' },
            labeledNum('Seats', o.seats, (v) => setOfficeSeats(o, v), 0, R.seatCap(o.id)),
            o.termFollows
              ? el('label', { class: 'field', style: { marginBottom: 0 } }, el('span', {}, 'Term'),
                el('div', { class: 'small dim', style: { padding: '7px 0' } }, 'follows the ' + (R.office(world, o.termFollows)?.name || o.termFollows)))
              : labeledNum('Term (yrs)', o.termYears, (v) => { o.termYears = clamp(+v, 1, 40); push(); }),
            el('label', { class: 'field', style: { marginBottom: 0 } }, el('span', {}, 'Chosen by'),
              select(['election', 'appointment'], o.selection, (v) => { o.selection = v; push(); }))),
          o.electorate === 'district' && o.seats > 0
            ? el('div', { class: 'tiny dimmer', style: { marginTop: '-2px', marginBottom: '8px' } },
              `${o.seats} district${o.seats === 1 ? '' : 's'}, one member each — every chamber elected by district shares the map`)
            : null,

          // Folded away, one disclosure per office.
          //
          // Grouped rather than piled — five short named rows instead of one
          // wall of seventeen chips — but even grouped, five offices' worth of
          // chips open at once is most of the page, and a table reading the
          // document for the first time meets eighty toggles before it has read
          // a single clause. The template already grants a workable set; this is
          // for the table that means to argue about a particular power.
          // A term limit is the provision a table argues about only once it has
          // seen someone hold the office for twenty years, so it is folded away
          // — but it is here, and it is amendable afterwards.
          //
          // Only for an office one person holds. Term-limiting a chamber is a
          // different mechanic wearing the same name: the Assembly's seats turn
          // over district by district, so a limit there is a rule about seven
          // separate careers rather than about the office, and offering it
          // beside the presidency implied the two meant the same thing.
          o.selection === 'election' && !o.termFollows && o.seats === 1
            ? advSection('limit-' + o.id, `Advanced — term limit for the ${o.name}`
              + (R.termLimitOf(o) ? ` (${R.termLimitOf(o)})` : ' (none)'),
              el('div', { class: 'row' },
                labeledNum('Terms allowed', R.termLimitOf(o), (v) => { o.termLimit = clamp(+v, 0, 20); push(); CTX.rerender(true); }),
                el('div', { class: 'tiny dimmer', style: { maxWidth: '320px' } },
                  R.termLimitOf(o)
                    ? `No one may hold the ${o.name} more than ${R.termLimitOf(o)} time${R.termLimitOf(o) === 1 ? '' : 's'}. A deputy with under half a term left finishes someone else's; that does not count. Amendable in Season.`
                    : `Zero means no limit: held as long as the voters return them.`)))
            : null,

          // The qualification the real document spends one clause on and every
          // table forgets until someone is refused a chair for it. Folded away
          // beside the term limit for the same reason: it is a provision you
          // argue about once, when it has just cost you something.
          //
          // Only for an elected office. An appointment is the President's to
          // make and the age floor there is the President's problem, not the
          // constitution's — and the cabinet carries no minAge in the template.
          o.selection === 'election' && o.seats > 0
            ? advSection('minage-' + o.id, `Advanced — age for the ${o.name} (${R.minAgeFor(world, o.id)})`,
              el('div', { class: 'row' },
                labeledNum('Minimum age', R.minAgeFor(world, o.id),
                  (v) => { o.minAge = clamp(Math.floor(+v) || 0, POLITICAL_BASE_AGE, 90); push(); CTX.rerender(true); },
                  POLITICAL_BASE_AGE, 90),
                el('div', { class: 'tiny dimmer', style: { maxWidth: '320px' } },
                  `No one under ${R.minAgeFor(world, o.id)} may stand for the ${o.name} or sit in it.`
                  + ` ${POLITICAL_BASE_AGE} is the floor under the floor — nobody younger takes any office.`
                  + (o.ticket || o.termFollows
                    ? ` Running on another's ticket does not waive it.`
                    : '')
                  + ` It is asked afresh, so someone barred today stands the year they grow into it. Amendable in Season.`)))
            : null,

          advSection('powers-' + o.id, `Advanced — powers of the ${o.name} (${o.powers.length})`,
            el('div', { class: 'pow-groups' }, ...R.POWER_GROUPS.map((g) => el('div', { class: 'pow-group' },
              el('span', { class: 'pow-group-label' }, g.label),
              el('div', { class: 'pow-chips' }, ...g.ids.map((p) =>
                el('button', {
                  class: 'pow-chip' + (o.powers.includes(p) ? ' on' : ''),
                  onclick: () => { o.powers = o.powers.includes(p) ? o.powers.filter((x) => x !== p) : [...o.powers, p]; push(); },
                }, R.POWERS[p])))))))))),

      // Two numbers decide almost every vote this republic will ever take; the
      // other four, and the whole apparatus of the purse, are for the table that
      // wants to argue about them. They are all still here, and all still
      // editable — they are just not the first thing you have to read.
      el('div', { class: 'card' }, el('h3', {}, 'Thresholds'),
        fracRow('Ordinary legislation passes at', c, 'legislature.passFraction'),
        fracRow('Quorum on the floor', c, 'legislature.quorum'),
        advSection('thresholds', 'Advanced — override, amendment and impeachment',
          fracRow('Veto override', c, 'legislature.overrideFraction'),
          fracRow('Amendment of this constitution', c, 'amendment.fraction'),
          fracRow('Impeachment — adopt articles (opens a trial)', c, 'impeachment.fraction'),
          fracRow('Impeachment — convict at the trial', c, 'impeachment.convictFraction'))),

      el('div', { class: 'card' }, el('h3', {}, 'The purse'),
        el('p', { class: 'tiny dimmer', style: { marginTop: '-4px' } },
          'What the executive may spend without asking. Open it to argue about money.'),
        advSection('purse', 'Advanced — spending bands and discretion',
        el('div', { class: 'quote' },
          el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } },
            'Each band applies at or above its figure; the highest match governs.'),
          ...(c.spending || []).sort((a, b) => a.above - b.above).map((r, i) => el('div', { class: 'row', style: { margin: '4px 0' } },
            el('span', { class: 'small dim' }, 'above'),
            el('input', {
              type: 'number', style: { width: '120px' }, value: r.above, step: 1000000, min: 0,
              onchange: (e) => { r.above = Math.max(0, +e.target.value || 0); push(); CTX.rerender(true); },
            }),
            r.requires
              ? el('span', { class: 'small dim' }, 'requires')
              : el('span', { class: 'small dim' }, 'executive discretion'),
            r.requires ? el('input', {
              type: 'number', style: { width: '80px' }, value: r.requires.fraction, step: 0.05, min: 0.5, max: 1,
              onchange: (e) => { r.requires.fraction = clamp(+e.target.value || 0.5, 0.5, 1); push(); CTX.rerender(true); },
            }) : null,
            r.requires ? el('span', { class: 'small dim' }, 'of the ' + (R.office(world, r.requires.body)?.name || r.requires.body)) : null,
            el('button', {
              class: 'btn sm ghost', onclick: () => {
                r.requires = r.requires ? null : { body: c.legislature.chamber, fraction: 0.6 };
                push(); CTX.rerender(true);
              },
            }, r.requires ? 'no vote' : 'require a vote'),
            // 'remove' now removes the band itself, which is what it always
            // should have meant; the old button only cleared the requirement.
            (c.spending || []).length > 1 ? el('button', {
              class: 'btn sm danger', onclick: () => { c.spending.splice(c.spending.indexOf(r), 1); push(); CTX.rerender(true); },
            }, 'remove') : null)),
          el('button', {
            class: 'btn sm', style: { marginTop: '8px' }, onclick: () => {
              const top = Math.max(0, ...(c.spending || []).map((x) => x.above));
              c.spending.push({ above: top ? top * 2 : 1e6, requires: { body: c.legislature.chamber, fraction: 0.6 } });
              push(); CTX.rerender(true);
            },
          }, '+ add a threshold'),
          el('div', { class: 'row', style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--rule-strong)' } },
            el('span', { class: 'small dim' }, 'Discretionary allowance:'),
            el('input', {
              type: 'number', style: { width: '120px' }, step: 1000000, min: 0,
              value: c.discretion?.cap ?? 0,
              onchange: (e) => {
                c.discretion = c.discretion || { years: 1 };
                c.discretion.cap = Math.max(0, +e.target.value || 0);
                push(); CTX.rerender(true);
              },
            }),
            el('span', { class: 'small dim' }, 'per'),
            el('input', {
              type: 'number', style: { width: '70px' }, step: 1, min: 1,
              value: c.discretion?.years ?? 1,
              onchange: (e) => {
                c.discretion = c.discretion || { cap: 0 };
                c.discretion.years = Math.max(1, +e.target.value || 1);
                push(); CTX.rerender(true);
              },
            }),
            el('span', { class: 'small dim' }, 'canon year(s)')),
          el('div', { class: 'tiny dimmer' },
            'Total disbursable without a vote in a rolling window. Set 0 for no cap; a threshold then caps each payment.')))),

      ((named, open) => el('div', { class: 'card' }, el('h3', {}, 'Rights'),
        el('p', { class: 'tiny dimmer', style: { marginTop: '-4px' } },
          named.length
            ? `${named.length} enumerated. The court reads them, and no majority reaches past one.`
            : 'None enumerated.'),
        // One line, on the face of the card rather than behind Advanced, because
        // it is the single decision in this section that changes what the court
        // is *for*: whether a silence in the document is a permission.
        el('label', { class: 'spread', style: { padding: '6px 0', cursor: 'pointer', gap: '10px' } },
          el('div', {},
            el('b', { class: 'small' }, 'Rights retained'),
            el('div', { class: 'tiny dim serif' },
              'The court may find a right the founders never listed — weaker ground than an enumerated one, and a wide majority tells against it.')),
          el('input', {
            type: 'checkbox', checked: !!open,
            onchange: (e) => {
              c.rights = c.rights.filter((rt) => !(rt.open || rt.id === 'unenumerated'));
              if (e.target.checked) c.rights.push({ ...R.RIGHTS_CATALOG.unenumerated });
              push(); CTX.rerender(true);
            },
          })),
        advSection('rights', `Advanced — the ${named.length} enumerated right${named.length === 1 ? '' : 's'}`,
          ...named.map((rt) => el('div', { class: 'spread', style: { padding: '5px 0' } },
            el('div', {}, el('b', { class: 'small' }, rt.name), el('div', { class: 'tiny dim serif' }, rt.text)),
            el('button', {
              class: 'btn sm ghost',
              onclick: () => { c.rights = c.rights.filter((x) => x !== rt); push(); CTX.rerender(true); },
            }, 'strike'))),
          named.length ? null : el('div', { class: 'blocked' }, 'No enumerated rights. Nothing stops an arrest for words alone.'))))(
        c.rights.filter((rt) => !(rt.open || rt.id === 'unenumerated')),
        c.rights.some((rt) => rt.open || rt.id === 'unenumerated')),
  );

  // What the table is about to ratify, said in four lines rather than left to be
  // inferred from eighty toggles on the page behind the button. A summary read
  // off the live document, so it cannot drift from it.
  //
  // It takes the wide column and the chairs take the narrow one, which is the
  // shape the convention has always had — a document on the left, the table's
  // own business on the right. In one full-width stack the seat rows were a
  // metre of rule with a word at each end.
  const docSummary = el('div', { class: 'stack' },
      el('div', { class: 'card' },
        el('div', { class: 'spread' }, el('h3', {}, 'The government, as written'),
          el('button', { class: 'btn sm ghost', onclick: () => openDoc(true) }, 'Amend it →')),
        el('p', { class: 'tiny dim', style: { marginTop: '-2px' } },
          'The Constitution of the United States, as the engine enforces it. You do not have to touch any of it.'),
        ...c.offices.filter((o) => !o.atWill && o.seats > 0).map((o) => el('div', {
          class: 'spread small', style: { padding: '3px 0' },
        }, el('span', {}, o.name),
          el('span', { class: 'tiny dimmer' },
            `${o.seats} seat${o.seats === 1 ? '' : 's'} · `
            + (o.termFollows ? `term follows the ${R.office(world, o.termFollows)?.name || o.termFollows}`
              : `${o.termYears}-year term`)
            + (o.selection === 'election' ? '' : ' · appointed')))),
        el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
          `Ordinary legislation passes at ${Math.round((c.legislature.passFraction || 0) * 100)}%`
          + `, a veto is overridden at ${Math.round((c.legislature.overrideFraction || 0) * 100)}%`
          + `, and this document is amended at ${Math.round((c.amendment?.fraction || 0) * 100)}%.`)));

  const seatCol = el('div', { class: 'stack' },
      el('div', { class: 'card gold' + (Object.values(world.players).some((p) => !world.seats.some((s) => s.personaId === p.personaId)) ? ' cta-pulse' : '') },
        el('div', { class: 'spread' }, el('h3', {}, 'Take a seat'),
          ((n) => n ? el('span', { class: 'cta-bubble' }, `${n} still to be seated`) : null)(Object.values(world.players).filter((p) => !world.seats.some((s) => s.personaId === p.personaId)).length)),
        el('p', { class: 'tiny dim' }, 'Founders choose their chair — first come, binding for the first term. The rest are citizens’ until an election.'),
        el('div', { class: 'sel-list' }, ...(() => {
          // Founders see the chairs ranked by prestige — President first — rather
          // than in whatever order the seats were generated.
          const rank = (s) => R.PRESTIGE[s.office] ?? 30;
          const mineP = me();
          // At-will cabinet posts (Secretaries) are never claimed at the founding —
          // the President names them later — so they don't appear here.
          return world.seats.slice().filter((s) => !R.office(world, s.office)?.atWill).sort((a, b) => rank(b) - rank(a)).map((s) => {
          const o = R.office(world, s.office);
          const holder = s.personaId ? world.personas[s.personaId] : null;
          const mine = holder?.playerId === CTX.playerId;
          const otherFounder = holder?.playerId && !mine;
          // The districts do not move any more. Seats are dealt across the
          // states once — by population for the House, one each for the Senate —
          // and every House chair carries the numbered district it will actually
          // sit for, so the chair you take at the convention is the electorate
          // you answer to. This used to read "a district drawn at ratification",
          // which was true and was the problem.
          // Old enough for it. The constitution sets 25 for the House, 30 for
          // the Senate and 35 for both halves of the executive, and a chair you
          // cannot legally sit in should not be a button that looks live and
          // then refuses — it should say so, on the chair, before you reach for
          // it. SEAT_SELF enforces the same rule, because the screen is a
          // courtesy and the engine is the authority.
          const young = mineP ? R.eligibleByAge(world, mineP.id, s.office) : { ok: true };
          const barred = !young.ok && !mine;
          return el('button', {
            class: mine ? 'on' : otherFounder || barred ? 'locked' : '',
            title: otherFounder ? `Claimed by ${holder.name} — first come, first served.`
              : barred ? young.reason : '',
            onclick: () => { if (!otherFounder && !barred) go('SEAT_SELF', { seatId: s.id }); },
          }, el('div', { class: 'spread' },
            el('span', {}, o?.name, s.district ? ' — ' + seatWhere(world, s) : ''),
            mine ? el('span', { class: 'tag green' }, 'you')
              : otherFounder ? el('span', { class: 'tag red' }, holder.name)
                : barred ? el('span', { class: 'tag red' }, `${young.need}+`)
                  : el('span', { class: 'tiny dimmer' }, holder ? holder.name + ' · take' : 'take')),
            barred ? el('div', { class: 'tiny', style: { color: 'var(--red)', marginTop: '2px' } },
              `You are ${young.age}. The constitution sets ${young.need} for this office — eligible in ${young.years} year${young.years === 1 ? '' : 's'}.`) : null);
        }); })())),
      // The side of the aisle you woke up on. It used to be dealt: the founding
      // screen wrote every player in as a Democrat (see app.convene) and you
      // found out from a chip beside your name on the Offices tab, three screens
      // later. A party is the single fact about a politician the country sorts
      // itself by at the polls, so it belongs on the same page as the chair —
      // and it is the choice the inauguration is dressed in.
      //
      // Still changeable in Season, from Offices, at the usual cost of crossing
      // the floor. This is only where it is asked for the first time.
      (() => {
        const mineP = me();
        if (!mineP) return null;
        const chosen = PARTIES.find((x) => x.id === mineP.party);
        const pick = (id) => el('button', {
          class: 'btn sm' + ((id ? mineP.party === id : !mineP.party) ? ' primary' : ' ghost'),
          onclick: () => go('CHOOSE_PARTY', { party: id }),
        }, id ? PARTIES.find((x) => x.id === id).name : 'Independent');
        return el('div', { class: 'card' },
          el('div', { class: 'spread' }, el('h3', {}, 'Your party'),
            el('span', {
              class: 'tag',
              style: chosen ? { background: chosen.color, color: chosen.ink } : {},
            }, chosen ? chosen.name : 'Independent')),
          el('p', { class: 'tiny dim', style: { marginTop: '-2px' } },
            'Voters sort by district: a party candidate has that bloc behind them, an independent only the undecided. The inauguration flies your colours.'),
          el('div', { class: 'row' }, ...PARTIES.map((p) => pick(p.id)), pick(null)));
      })(),

      el('div', { class: 'card' }, el('h3', {}, 'Founders present'),
        ...Object.values(world.players).map((p) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, el('span', { style: { color: p.color } }, '● '), p.name),
          p.ready ? el('span', { class: 'tag green' }, 'ready ✓') : el('span', { class: 'tag' }, 'not ready'))),
        el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
          'Open a second tab to seat another player.')),
      (() => {
        const active = ACT.activePlayers(world);
        const readyCount = active.filter((p) => p.ready).length;
        const waiting = active.length - readyCount;
        const solo = active.length <= 1;
        const mineP = myPlayer();
        const iAmReady = !!mineP?.ready;
        const iAmSeated = !!mineP && world.seats.some((s) => s.personaId === mineP.personaId);
        const unseated = Object.values(world.players).filter(
          (p) => !world.seats.some((s) => s.personaId === p.personaId));
        const blocked = unseated.length > 0 || !iAmSeated;
        return el('div', { class: 'card gold' },
          el('h3', {}, 'Begin the Season'),
          el('p', { class: 'tiny dim' }, solo
            ? 'The Season begins when you ready up.'
            : 'Every founder must ready. Changing the constitution or a seat stands them all down.'),
          unseated.length
            ? el('div', { class: 'blocked', style: { marginBottom: '8px' } },
                'Every founder needs a chair first. Still unseated: ',
                unseated.map((p) => p.name).join(', '), '.')
            : null,
          !solo && !unseated.length
            ? el('div', { class: 'spread small', style: { margin: '2px 0 10px' } },
                el('span', { class: 'dim' }, 'Founders ready'),
                el('b', { class: readyCount === active.length ? 'green' : '' }, `${readyCount} / ${active.length}`))
            : null,
          el('button', {
            class: 'btn ' + (iAmReady ? 'ghost' : 'primary'), style: { width: '100%' },
            disabled: blocked,
            onclick: () => go('READY', { ready: !iAmReady }),
          }, !iAmSeated ? 'Take a chair before you can ready up'
            : unseated.length ? 'Waiting on the founders to be seated'
              : solo ? 'Ready up — begin the Season'
                : iAmReady ? "You're ready ✓ — click to stand down"
                  : 'Ready up'),
          el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
            !solo && iAmReady && waiting > 0
              ? `Waiting on ${waiting} more founder${waiting === 1 ? '' : 's'} to ready up.`
              : 'After the Season begins this takes an amendment, under the rules you just wrote.'));
      })(),
      conventionBack(world),
  );

  root.append(docOpen
    // The way back sits at both ends of the document: it is a long page, and a
    // table that has read to the bottom of it should not have to scroll back up
    // to get to the chairs.
    ? el('div', { class: 'stack' }, docBack(), docCol, docBack())
    : el('div', { class: 'split' }, docSummary, seatCol));

  function push() { go('SET_CONSTITUTION', { constitution: c }); }

  // Zero seats means "this office will not exist when we ratify" — it does not
  // rip the editor out from under you, because a 0 you typed may be a typo or
  // a step on the way to 10. The office is dropped at ratification instead.
  function setOfficeSeats(o, v) {
    o.seats = Math.max(0, Math.min(R.seatCap(o.id), Math.floor(+v || 0)));
    push();
    CTX.rerender(true);
  }

  function strikeOffice(i) {
    if (c.offices.filter((o) => o.seats > 0).length <= 1 && c.offices[i].seats > 0) return;
    c.offices.splice(i, 1);
    R.repairConstitution(c);
    push();
    CTX.rerender(true);
  }
  function fracRow(label, obj, path) {
    const v = R.getPath(obj, path);
    return el('div', { class: 'meter', style: { margin: '6px 0' } },
      el('span', { class: 'lab' }, label),
      el('input', {
        type: 'range', min: 0.34, max: 1, step: 0.01, value: v,
        oninput: (e) => { R.setPath(obj, path, +e.target.value); push(); },
      }),
      el('span', { class: 'val' }, R.fracText(v)));
  }
};

// Number fields commit on change/blur, not on every keystroke — otherwise
// clearing the box to retype sends an empty value straight into the rules.
const labeledNum = (label, value, onchange, min = 0, max = null) =>
  el('label', { class: 'field', style: { width: '92px', marginBottom: 0 } }, el('span', {}, label),
    el('input', {
      type: 'number', min, value, ...(max == null ? {} : { max }),
      onchange: (e) => onchange(e.target.value),
    }));

function select(options, value, onchange) {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  return el('select', { onchange: (e) => onchange(e.target.value) },
    ...opts.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) }, l)));
}

// --- Assembly --------------------------------------------------------------

VIEWS.assembly = (root) => {
  const world = w();
  const p = me();
  const docs = world.docOrder.map((id) => world.documents[id]).filter(Boolean);
  const floor = docs.filter((d) => ['floor', 'override', 'awaiting-signature', 'vetoed'].includes(d.status));
  const recent = docs.filter((d) => ['law', 'failed', 'struck'].includes(d.status)).slice(0, 12);
  // Order drafts live in the Oval Office, where they are signed.
  const drafts = docs.filter((d) => d.status === 'draft' && d.authorId === p?.id && d.type !== 'order');

  root.append(el('h1', { class: 'page' }, 'The Floor'),
    el('p', { class: 'sub' }, 'Every consequential act is a document: prose and executable effect.'));

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      floor.length ? null : el('div', { class: 'card dim small' }, 'Nothing is before the chamber.'),
      ...floor.map(docCard),
      drafts.length ? el('div', { class: 'card' }, el('h3', {}, 'Your drafts'),
        ...drafts.map((d) => el('div', { class: 'spread', style: { padding: '5px 0' } },
          el('span', { class: 'serif' }, d.title),
          el('div', { class: 'row' },
            el('button', { class: 'btn sm', onclick: () => { S.draft = d; S.modal = 'compose'; CTX.rerender(true); } }, 'edit'),
            el('button', { class: 'btn sm primary', onclick: () => go('INTRODUCE', { docId: d.id }) }, 'introduce'))))) : null,
      el('div', { class: 'card' }, el('h3', {}, 'Recently disposed of'),
        ...recent.map((d) => el('div', { class: 'spread', style: { padding: '5px 0', borderBottom: '1px solid var(--rule-strong)' } },
          el('div', {}, el('span', { class: 'serif' }, d.title),
            el('div', { class: 'tiny dimmer' }, d.promulgatedAt || d.date, ' · ', A.DOC_TYPES[d.type]?.label)),
          el('div', { class: 'row' },
            // The court reviews laws in force. Where a real bench sits, a single
            // justice may only put the question to it — the court answers. Where
            // one office holds every power (an autocracy), there is no bench to
            // convene and the holder strikes alone.
            strikeControl(d, p),
            statusTag(d)))),
        recent.length ? null : el('div', { class: 'dim small' }, 'Nothing yet.')),
    ),
    el('div', { class: 'stack' },
      // No button at all for someone who may move nothing here. A primary button
      // that exists only to explain why it will not work is worse than the
      // sentence on its own.
      ((mine) => el('div', { class: 'card' + (mine.length ? ' gold' : '') },
        mine.length
          ? el('button', {
            class: 'btn primary', style: { width: '100%' },
            onclick: () => { S.draft = newDraft(mine[0]); S.modal = 'compose'; CTX.rerender(true); },
          }, 'Draft a document')
          : null,
        el('div', { class: 'tiny dimmer', style: { marginTop: mine.length ? '8px' : '0' } },
          !p ? ''
            : mine.length ? 'You may put ' + mine.map((k) => A.DOC_TYPES[k].label.toLowerCase()).join(', ') + ' on the floor.'
              : R.mayPropose(world, p.id, 'bill').reason + ' Your office acts through the Oval Office instead.')))(proposable(world, p)),
      chatCard('floor'),
      // One card per chamber. A single undifferentiated list of forty names was
      // the old card doing the wrong thing twice over: it could not say which
      // room a member sat in, and a bill's roll only ever covers one of them.
      // No party dot. A coloured bullet beside every name promised a caucus
      // structure the game does not have — nothing in play is organised by
      // party, nobody whips one, and the legend for it existed nowhere. The
      // lean still bends how a member votes; it is simply not claiming to be
      // a bloc. The Offices table names the party in full for anyone curious.
      ...R.chambers(world).map((room) => el('div', { class: 'card' },
        el('h3', {}, R.office(world, room)?.name || 'The chamber'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '4px' } },
          ((o) => o ? `${o.seats} seats · ${o.termYears}-year terms` : '')(R.office(world, room))),
        ...world.seats.filter((s) => s.office === room).map((s) => {
          const h = s.personaId ? world.personas[s.personaId] : null;
          return el('div', { class: 'spread small', style: { padding: '3px 0' } },
            el('span', {},
              h ? h.name : el('i', { class: 'dimmer' }, 'vacant'),
              h && !h.synthetic ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'player') : null),
            el('span', { class: 'tiny dimmer' }, seatWhere(world, s)));
        }))),
    ),
  ));

  // And the room itself, at the foot of the page.
  //
  // Every other branch had one. The executive has the Oval Office, the bench
  // has its chambers, each department has a room drawn for it, and a founder
  // gets a basement that becomes a campus — the legislature, which is the
  // branch this whole game is about, had a list of documents and nowhere to
  // stand. It goes last rather than first because this page is work: the
  // paper is what you came for and the chamber is what you look up at.
  root.append(el('div', { class: 'card', style: { marginTop: '14px' } },
    officeWindow(world, 'chamber'),
    el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      'The floor, from the well, mace up while the chamber sits.')));
};

/**
 * What a player may do to a law in force from the floor. A justice of a real
 * court refers it to the bench; a lone holder of every power strikes it outright.
 */
function strikeControl(d, p) {
  const world = w();
  if (d.status !== 'law' || !p || !R.hasPower(world, p.id, 'strike_law')) return null;
  const bench = CT.justices(world);
  const collegial = bench.length > 1 || CT.isJustice(world, p.id);
  if (collegial) {
    if (!CT.isJustice(world, p.id)) return null;
    const pending = (world.cases || []).some((c) => c.status === 'argued' && c.target?.docId === d.id);
    if (pending) return el('span', { class: 'tag gold' }, 'before the court');
    return el('button', {
      class: 'btn sm', onclick: () => ask({
        title: `Take up “${d.title}”?`,
        body: 'The full court decides: every justice votes, the majority carries, the holding is precedent.',
        label: 'Take up the case',
        input: { label: 'The question presented (optional)', multiline: true, placeholder: 'it exceeds the powers this office was granted' },
        onConfirm: (reason) => go('COURT_TAKE_UP', { docId: d.id, reason }),
      }),
    }, 'Take up');
  }
  return el('button', {
    class: 'btn sm danger', onclick: () => ask({
      title: `Strike “${d.title}” as unconstitutional?`,
      body: 'No bench sits — this office holds the judicial power alone. The law falls at once; money spent does not return.',
      label: 'Strike it down', danger: true,
      input: { label: 'Opinion (optional)', placeholder: 'The clause exceeds the powers this office was granted.', multiline: true },
      onConfirm: (reason) => go('STRIKE', { docId: d.id, reason }),
    }),
  }, 'Strike');
}

function statusTag(d) {
  const map = { law: ['green', 'in force'], failed: ['red', 'failed'], struck: ['purple', 'struck down'], floor: ['gold', 'on the floor'], override: ['gold', 'override'], vetoed: ['red', 'vetoed'], 'awaiting-signature': ['blue', 'awaiting signature'], 'awaiting-assent': ['blue', 'with the other party'], refused: ['red', 'declined abroad'], draft: ['', 'draft'] };
  const [cls, label] = map[d.status] || ['', d.status];
  return el('span', { class: 'tag ' + cls }, label);
}

function docCard(d) {
  const world = w();
  const p = me();
  const t = ['floor', 'override'].includes(d.status) ? R.tally(world, d) : null;
  const req = d.requirement || R.voteRequirement(world, d);
  const roll = R.electorateFor(world, d);
  const iVote = p && roll.some((v) => v.personaId === p.id);
  const left = d.floorCloses ? d.floorCloses - world.clock.tick : 0;
  const fisc = fiscalPhrase(world, d);
  // The rooms it has already carried. A bill's second tally overwrites its
  // first, so without this the House vote simply disappears the moment the
  // Senate takes the bill up — and "carried the House 12–8, lost the Senate
  // 9–11" is the entire reason for having two chambers.
  const cleared = (d.chamberTallies || [])
    .map((c) => `${R.office(world, c.body)?.name || c.body} ${c.yea}–${c.nay}`).join(' · ');

  const node = el('div', { class: 'doc' },
    // Say plainly why this one is going to fail, rather than letting the author
    // watch the tally collapse and guess at it.
    // The grounds are written for a court opinion ("…because it ranks citizens
    // by blood"), so drop the leading pronoun when the sentence supplies it.
    d.disrepute?.length
      ? el('div', { class: 'blocked', style: { marginBottom: '8px' } },
        el('b', {}, 'Entered in the record as written. '),
        `This act ${d.disrepute.map((g) => g.replace(/^it /, '')).join(', and ')}. The chamber will not carry it, the districts punish anyone voting for it, and the court gets plain ground to strike it.`)
      : null,
    el('header', {},
      el('h4', {}, d.title),
      statusTag(d),
      left > 0 && ['floor', 'override'].includes(d.status) ? el('span', { class: 'tag mono' }, left + ' ticks') : null),
    el('div', { class: 'body' },
      d.preamble ? el('div', { class: 'quote' }, d.preamble) : null,
      // Once the vote is over the preamble is still worth keeping — reuse it as
      // the opening of a fresh bill, or copy it out to use anywhere.
      (d.preamble && ['law', 'failed', 'struck', 'vetoed'].includes(d.status)) ? el('div', { class: 'row', style: { margin: '2px 0 6px' } },
        el('button', { class: 'btn sm ghost', onclick: () => { S.draft = { ...newDraft(), preamble: d.preamble }; S.modal = 'compose'; CTX.rerender(true); } }, 'Reuse in a bill'),
        el('button', { class: 'btn sm ghost', onclick: (e) => { try { navigator.clipboard?.writeText(d.preamble); const b = e.currentTarget; b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); } catch (err) { /* clipboard unavailable */ } } }, 'Copy')) : null,
      ...d.clauses.map((c, i) => el('div', { class: 'clause', 'data-n': i + 1 }, A.clauseText(world, c))),
      fisc ? el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
        'Fiscal effect: ', fisc.text, ' · ', R.spendClauseText(world, fisc.total)) : null,
      cleared ? el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
        'Already carried: ', cleared) : null,
    ));

  const foot = el('footer', {});
  if (t) {
    foot.append(
      el('div', { class: 'spread tiny dim', style: { marginBottom: '5px' } },
        el('span', {}, req.label, ' — ', R.fracText(req.fraction), ' of the ', R.office(world, req.body)?.name || req.body),
        el('span', { class: 'mono' }, `${t.yea}–${t.nay}${t.abstain ? ' (' + t.abstain + ' abstaining)' : ''}`)),
      el('div', { class: 'votebar' },
        el('i', { class: 'y', style: { width: (t.cast ? (t.yea / t.eligible) * 100 : 0) + '%' } }),
        el('i', { class: 'n', style: { width: (t.cast ? (t.nay / t.eligible) * 100 : 0) + '%' } }),
        el('i', { class: 'a', style: { width: ((t.eligible - t.cast) / t.eligible) * 100 + '%' } })),
      el('div', { class: 'rollcall' }, ...roll.map((v) => {
        const per = world.personas[v.personaId];
        const b = d.votes[v.personaId];
        const seat = world.seats.find((s) => s.personaId === v.personaId);
        const dist = seatCd(world, seat) || null;
        return el('span', {
          // Abstain is a decision, not silence: grey it so it reads apart from a
          // member who simply has not voted yet (who stays in the default colour).
          class: (b === 'yea' ? 'y' : b === 'nay' ? 'n' : '') + (b === 'abstain' ? ' dimmer' : ''),
          title: `${per?.name || '?'}${dist ? ' — ' + dist : ''} · ${b || 'not yet voted'}`,
        }, per?.name?.split(' ')[0] || '?', b ? ' ' + b[0].toUpperCase() : '');
      })),
      el('div', { class: 'row', style: { marginTop: '9px' } },
        iVote ? el('button', { class: 'btn sm', onclick: () => go('VOTE', { docId: d.id, ballot: 'yea' }) }, 'Vote yea') : null,
        iVote ? el('button', { class: 'btn sm', onclick: () => go('VOTE', { docId: d.id, ballot: 'nay' }) }, 'Vote nay') : null,
        iVote ? el('button', { class: 'btn sm ghost', onclick: () => go('VOTE', { docId: d.id, ballot: 'abstain' }) }, 'Abstain') : null,
        !iVote ? el('span', { class: 'tiny dimmer' }, 'You hold no seat in this chamber.') : null,
        // The gavel, not the ballot. The Vice President votes in the Senate only
        // to break a tie but presides over it always, so the button appears for
        // them on a Senate measure and not on a House one — which is the engine's
        // answer too, and this only stops the player asking for a refusal.
        R.mayCloseFloor(world, p?.id, d).ok
          ? el('button', { class: 'btn sm ghost', onclick: () => {
            if (Object.keys(d.votes || {}).length === 0) {
              ask({ title: 'Call the question with no votes cast?', body: 'Nobody has voted — closing now decides the bill on an empty chamber.', label: 'Call it anyway', danger: true, onConfirm: () => go('CLOSE_FLOOR', { docId: d.id }) });
            } else go('CLOSE_FLOOR', { docId: d.id });
          } }, 'Call the question')
          : null),
    );
  } else if (d.status === 'awaiting-signature') {
    // The chamber's work is finished. Signing is an executive act and it
    // happens in the executive's room — putting the two buttons here made the
    // Assembly tab the place a President waited for their own bills, which is
    // backwards, and put a Veto control on the page the chamber is reading.
    const veto = world.constitution.legislature.vetoOffice;
    const mine = p && R.officesOf(world, p.id).some((o) => o.id === veto);
    foot.append(el('div', { class: 'row' },
      el('span', { class: 'tiny dim' }, 'Passed. On the desk of the ', R.office(world, veto)?.name || 'executive', '.'),
      mine ? el('button', {
        class: 'btn sm primary',
        onclick: () => { S.view = 'oval'; CTX.rerender(true); },
      }, 'Open the Oval Office') : null));
  } else if (d.status === 'vetoed') {
    foot.append(el('div', { class: 'row' },
      el('span', { class: 'tiny dim' }, 'Vetoed by ', world.personas[d.vetoedBy]?.name, '. Override requires ', R.fracText(world.constitution.legislature.overrideFraction), '.'),
      el('button', { class: 'btn sm', onclick: () => go('OVERRIDE', { docId: d.id }) }, 'Move to override')));
  }
  node.append(foot);
  // Why the (AI) ministers voted as they did — surfaced on the bill itself, so a
  // chamber of synthetic ministers isn't a black box and a failed bill explains
  // itself. Shown on open and closed bills alike.
  if (d.statements && Object.keys(d.statements).length) {
    node.append(el('div', { class: 'floor-say', style: { marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--rule-strong)' } },
      el('div', { class: 'tiny dim', style: { marginBottom: '3px' } }, 'Why the ministers voted'),
      ...Object.entries(d.statements).map(([pid, st]) => {
        const per = world.personas[pid];
        return el('div', { class: 'tiny', style: { padding: '2px 0 2px 0.1in' } },
          el('b', { class: st.ballot === 'yea' ? 'green' : st.ballot === 'nay' ? 'red' : 'dimmer' }, `${(per?.name || '?').split(' ')[0]} · ${st.ballot}`),
          el('span', { class: 'dim serif' }, ' — ' + st.text));
      })));
  }
  return node;
}

// `lockType` pins the composer to one kind of document — the Oval Office opens
// it on an executive order and the type picker goes away, because an order is
// not something you drift into from a bill.
const newDraft = (type = 'bill', lockType = false) => ({ type, title: '', preamble: '', clauses: [], lockType });

/**
 * The instruments this person may put on the floor.
 *
 * Rulings are the court's own and orders are signed in the Oval Office, so
 * neither is drafted from the chamber. What is left is filtered by the same
 * rules.mayPropose the engine enforces, so the chamber only ever offers what it
 * would actually accept.
 */
function proposable(world, p) {
  if (!p) return [];
  return Object.keys(A.DOC_TYPES)
    .filter((k) => !['ruling', 'order'].includes(k))
    .filter((k) => R.mayPropose(world, p.id, k).ok);
}

/** Leaving the editor releases the clock, however you leave it. */
export function closeComposer() {
  if (S.draftingSignalled) { S.draftingSignalled = false; go('DRAFTING', { on: false }); }
  S.modal = null; S.draft = null; S.composeNote = null;
  CTX.rerender(true);
}

// --- composer ---------------------------------------------------------------
export function composeModal() {
  const world = w();
  const p = me();
  const d = S.draft;
  const req = R.voteRequirement(world, d);
  const fisc = fiscalPhrase(world, d);

  if (!S.draftingSignalled) { S.draftingSignalled = true; go('DRAFTING', { on: true }); }

  const body = el('div', {},
    el('h2', {}, 'Draft'),
    el('p', { class: 'tiny dimmer' }, 'What you write in a clause is what the engine does.'),
    // Rulings are written by the court, not drafted here; orders are signed in
    // the Oval Office and reach this editor already pinned to their type.
    d.lockType
      ? el('div', { class: 'row', style: { margin: '12px 0' } },
        el('span', { class: 'tag gold' }, A.DOC_TYPES[d.type]?.label || d.type))
      : el('div', { class: 'row', style: { margin: '12px 0' } },
        // Only the instruments this person may actually move. Offering the
        // President "Articles of Impeachment" and then refusing in red once the
        // form is filled in tells them what they cannot do at the point it is
        // most annoying to learn it.
        ...Object.entries(A.DOC_TYPES).filter(([k]) => !['ruling', 'order'].includes(k))
          .filter(([k]) => !p || R.mayPropose(world, p.id, k).ok).map(([k, v]) =>
          el('button', {
            class: 'btn sm' + (d.type === k ? ' primary' : ' ghost'),
            onclick: () => {
              // Changing the instrument drops anything the new one cannot
              // enact, rather than carrying a dead clause to the floor.
              const keep = A.clausesFor(k);
              const dropped = d.clauses.filter((c) => !keep.includes(c.kind));
              d.clauses = d.clauses.filter((c) => keep.includes(c.kind));
              d.type = k;
              if (dropped.length) {
                S.composeNote = `${dropped.length} clause${dropped.length === 1 ? '' : 's'} removed — ${A.DOC_TYPES[k].label} cannot carry ${dropped.map((c) => (A.CLAUSES[c.kind]?.label || c.kind).toLowerCase()).join(', ')}.`;
              } else S.composeNote = null;
              CTX.rerender(true);
            },
          }, v.label))),
    S.composeNote ? el('div', { class: 'blocked', style: { marginBottom: '8px' } }, S.composeNote) : null,
    el('label', { class: 'field' }, el('span', {}, 'Title'),
      el('input', { value: d.title, oninput: (e) => (d.title = e.target.value), placeholder: 'An Act to…' })),
    el('label', { class: 'field' }, el('span', {}, 'Preamble'),
      el('textarea', { rows: 2, oninput: (e) => (d.preamble = e.target.value) }, d.preamble)),

    el('div', { class: 'card', style: { margin: '10px 0' } },
      el('h3', {}, 'Clauses'),
      ...d.clauses.map((c, i) => el('div', { style: { borderTop: i ? '1px solid var(--rule-strong)' : 'none', padding: '8px 0' } },
        el('div', { class: 'spread' },
          el('b', { class: 'small' }, A.CLAUSES[c.kind]?.label || c.kind),
          el('button', { class: 'btn sm ghost', onclick: () => { d.clauses.splice(i, 1); CTX.rerender(true); } }, 'remove')),
        clauseEditor(c),
        el('div', { class: 'clause', 'data-n': i + 1, style: { marginTop: '6px' } }, A.clauseText(world, c)))),
      el('div', { class: 'row', style: { marginTop: '10px' } },
        // Only what this kind of document can actually enact.
        select([['', '+ add a clause'], ...A.clausesFor(d.type).map((k) => [k, A.CLAUSES[k].label])], '', (v) => {
          if (!v) return;
          d.clauses.push(defaultClause(v));
          CTX.rerender(true);
        }))),

    req ? el('div', { class: 'allowed' },
      // A multi-seat office is a chamber of people: "majority of the Minister
      // seats", not "majority of the Minister".
      `Needs ${R.fracText(req.fraction)} of the ${(() => { const b = R.office(world, req.body); return b ? (b.seats > 1 ? b.name + ' seats' : b.name) : req.body; })()}. (${req.label})`)
      : el('div', { class: 'allowed' }, 'Takes effect when signed, if your office holds every power its clauses need.'),
    fisc ? el('div', { class: 'quote' }, 'Fiscal effect: ', fisc.text, '. Treasury holds ', moneyExact(world.economy.treasury), '.') : null,
    p && !R.mayPropose(world, p.id, d.type).ok
      ? el('div', { class: 'blocked' }, R.mayPropose(world, p.id, d.type).reason) : null,

    el('div', { class: 'row', style: { marginTop: '14px' } },
      el('button', { class: 'btn primary', onclick: () => { go('CREATE_DOC', { doc: { ...d }, introduce: true }); closeComposer(); } },
        d.type === 'order' ? 'Sign and issue' : 'Introduce on the floor'),
      el('button', { class: 'btn', onclick: () => { go('CREATE_DOC', { doc: { ...d }, introduce: false }); closeComposer(); } }, 'Save as draft'),
      el('button', { class: 'btn ghost', onclick: () => closeComposer() }, 'Cancel')),
  );
  return body;
}

function defaultClause(kind) {
  const world = w();
  const c = { kind };
  const vacant = world.city.parcels.find((p) => !p.building && !p.project);
  for (const f of A.CLAUSES[kind].fields) {
    if (f.def != null) c[f.k] = f.def;
    else if (f.t === 'select') c[f.k] = f.options[0][0];
    else if (f.t === 'district') c[f.k] = world.districts[0].id;
    else if (f.t === 'office') c[f.k] = world.constitution.offices[0].id;
    else if (f.t === 'foreign') c[f.k] = world.foreign[0].id;
    else if (f.t === 'company') c[f.k] = (world.companies || []).find((x) => !x.closed)?.id || '';
    else if (f.t === 'parcel') c[f.k] = (S.parcel != null && !world.city.parcels[S.parcel].building) ? S.parcel : (vacant ? vacant.i : 0);
    else if (f.t === 'powers') c[f.k] = [];
    else c[f.k] = '';
  }
  syncCost(c);
  return c;
}

// Keep the fiscal weight of a clause on the clause itself, so the vote
// threshold shown while drafting is the threshold that will actually apply.
function syncCost(c) {
  if (c.kind === 'BUILD') c.amount = BUILDINGS[c.building]?.cost || 0;
}

function clauseEditor(c) {
  const world = w();
  const spec = A.CLAUSES[c.kind];
  return el('div', { class: 'grid g2', style: { marginTop: '6px' } }, ...spec.fields.map((f) => {
    const set = (v) => { c[f.k] = v; syncCost(c); CTX.rerender(true); };
    if (f.t === 'textarea') return el('label', { class: 'field' }, el('span', {}, f.label), el('textarea', { rows: 2, oninput: (e) => (c[f.k] = e.target.value) }, c[f.k] || ''));
    if (f.t === 'text') return el('label', { class: 'field' }, el('span', {}, f.label), el('input', { value: c[f.k] || '', oninput: (e) => (c[f.k] = e.target.value) }));
    if (f.t === 'number') return el('label', { class: 'field' }, el('span', {}, f.label),
      el('input', { type: 'number', step: f.step || 1, min: f.min, max: f.max, value: c[f.k] ?? 0, oninput: (e) => (c[f.k] = e.target.value) }));
    if (f.t === 'check') return el('label', { class: 'field' }, el('span', {}, f.label),
      el('input', { type: 'checkbox', style: { width: 'auto' }, checked: !!c[f.k], onchange: (e) => set(e.target.checked) }));
    if (f.t === 'select') return el('label', { class: 'field' }, el('span', {}, f.label), select(f.options, c[f.k], set));
    if (f.t === 'district') return el('label', { class: 'field' }, el('span', {}, f.label), select(world.districts.map((d) => [d.id, d.name]), c[f.k], set));
    if (f.t === 'office') return el('label', { class: 'field' }, el('span', {}, f.label), select(world.constitution.offices.map((o) => [o.id, o.name]), c[f.k], set));
    if (f.t === 'foreign') return el('label', { class: 'field' }, el('span', {}, f.label), select(world.foreign.map((x) => [x.id, x.name]), c[f.k], set));
    // Companies in trouble first and named as such: a rescue clause is drafted
    // in a hurry, against a deadline somebody has just read in the Chronicle.
    if (f.t === 'company') {
      const live = (world.companies || []).filter((x) => !x.closed);
      const opts = live.map((co) => [co.id, `${co.name}${CO.distressOf(world, co) ? ' — in trouble' : ''}`]);
      return el('label', { class: 'field' }, el('span', {}, f.label),
        opts.length ? select(opts, c[f.k], set) : el('span', { class: 'tiny dim' }, 'No company is trading.'));
    }
    if (f.t === 'persona') return el('label', { class: 'field' }, el('span', {}, f.label),
      select(rosterOptions(Object.values(world.personas).filter((x) => x.alive), { mark: true }), c[f.k], set));
    if (f.t === 'parcel') {
      // Any vacant parcel is buildable: construction rezones the ground it
      // stands on when the bill passes, so a BUILD clause needs no separate
      // ZONE clause and no pre-zoned land. The label shows the rezone.
      const target = c.building ? BUILDINGS[c.building]?.zone : null;
      const opts = world.city.parcels
        .filter((pp) => !pp.building && !pp.project)
        .map((pp) => {
          const dn = world.districts.find((d) => d.id === pp.district)?.name;
          const zoneLabel = target && pp.zone !== target
            ? `${ZONES[pp.zone].label} → ${ZONES[target].label}`
            : ZONES[pp.zone].label;
          return [pp.i, `#${pp.i} — ${dn}, ${zoneLabel}`];
        });
      const pp = world.city.parcels[c[f.k]];
      const willRezone = target && pp && pp.zone !== target;
      return el('label', { class: 'field' }, el('span', {}, f.label),
        select(opts, c[f.k], set),
        willRezone
          ? el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
              `This land is ${ZONES[pp.zone].label}; passing the bill rezones it ${ZONES[target].label} and builds. No zoning clause needed.`)
          : null);
    }
    if (f.t === 'powers') return el('div', { class: 'field', style: { gridColumn: '1 / -1' } }, el('span', {}, f.label),
      el('div', { class: 'row' }, ...Object.entries(R.POWERS).map(([pw, label]) =>
        el('button', {
          class: 'btn sm' + ((c[f.k] || []).includes(pw) ? ' primary' : ' ghost'),
          onclick: () => set((c[f.k] || []).includes(pw) ? c[f.k].filter((x) => x !== pw) : [...(c[f.k] || []), pw]),
        }, label))));
    return null;
  }));
}

// --- Treasury --------------------------------------------------------------

/**
 * What the reader is holding.
 *
 * The Secretary and the President are looking at the live books. The chamber,
 * where it has voted itself a copy, is looking at a piece of paper with a date
 * on it — see acts.snapshotAccounts. Everything below reads from whichever of
 * the two this returns, so there is exactly one Treasury page and no way to
 * accidentally show a legislator a number nobody laid before them.
 */
function accountsSource(world, byOffice) {
  if (byOffice || !world.accountsCopy) {
    const e = world.economy;
    return { live: true, asOf: world.clock.tick, ...e, programs: world.programs || [], discretion: R.discretionUsed(world) };
  }
  return { live: false, ...world.accountsCopy };
}

function moneyFlowCard(a) {
  return el('div', { class: 'card' }, el('h3', {}, 'Where the money comes from'),
    ...Object.entries(a.breakdown || {}).map(([k, v]) => meterRow(k, v, a.revenueYr)),
    el('h3', { style: { marginTop: '16px' } }, 'Where it goes'),
    ...Object.entries(a.spendBreakdown || {}).map(([k, v]) => meterRow(k, v, a.spendYr)));
}

function taxCodeCard(world, p, a) {
  return el('div', { class: 'card' }, el('h3', {}, 'The tax code'),
    el('p', { class: 'tiny dimmer' }, 'Rates are documents. Changing one needs the power to tax; without it, file a SET_TAX bill.'),
    ...Object.entries(a.taxes || {}).map(([k, v]) => el('div', { class: 'meter', style: { margin: '8px 0' } },
      el('span', { class: 'lab' }, k),
      el('div', { class: 'bar' }, el('i', { style: { width: Math.min(100, v * 100 * 2.2) + '%' } })),
      el('span', { class: 'val' }, (v * 100).toFixed(1) + '%'))),
    p && R.hasPower(world, p.id, 'tax')
      ? el('div', { class: 'tiny green' }, 'Your office holds the power to tax; a bill with a rate clause binds.')
      : el('div', { class: 'tiny dimmer' }, 'Your office has no power to tax.'));
}

function underConstructionCard(world) {
  return el('div', { class: 'card' }, el('h3', {}, 'Under construction'),
    ...world.city.parcels.filter((x) => x.project).map((x) => {
      const b = BUILDINGS[x.project.building];
      return el('div', { style: { padding: '6px 0' } },
        el('div', { class: 'spread small' }, el('span', {}, b.name, ' — ', world.districts.find((d) => d.id === x.district)?.name),
          el('span', { class: 'mono dimmer' }, Math.round((x.project.progress / x.project.ticks) * 100) + '%')),
        el('div', { class: 'bar', style: { marginTop: '4px' } }, el('i', { style: { width: (x.project.progress / x.project.ticks) * 100 + '%' } })));
    }),
    world.city.parcels.some((x) => x.project) ? null : el('div', { class: 'dim small' }, 'Nothing under way.'));
}

function thresholdsCard(world, live) {
  return el('div', { class: 'card' }, el('h3', {}, 'Spending thresholds in force'),
    ...(world.constitution.spending || []).slice().sort((a, b) => a.above - b.above).map((r) => el('div', { class: 'small', style: { padding: '4px 0' } },
      el('span', { class: 'mono dim' }, '≥ ' + money(r.above)), ' — ',
      r.requires ? `${R.fracText(r.requires.fraction)} of the ${R.office(world, r.requires.body)?.name}` : 'executive discretion')),
    live ? allowanceMeter() : null,
    live ? emergencyPrompt() : null);
}

/**
 * The national debt: the stock, what it costs to carry, and what it is doing
 * to the price of carrying it.
 *
 * Debt used to be `-treasury`, which is to say it was the word for "overdrawn"
 * and nothing else. It is a stock now, so this is a page a finance ministry
 * would recognise: how much is owed, against how much the country produces,
 * what share of revenue the interest eats, and whether that is survivable.
 */
function debtCard(world, a, live) {
  const d = live ? MACRO.debtReading(world) : {
    debt: a.debt || 0,
    ratio: (a.debt || 0) / Math.max(1, a.gdp || 1),
    service: (a.debt || 0) * (a.marketRate || 0),
    share: ((a.debt || 0) * (a.marketRate || 0)) / Math.max(1, a.revenueYr || 1),
    verdict: '',
  };
  const row = (k, v, cls) => el('div', { class: 'spread', style: { padding: '4px 0' } },
    el('span', { class: 'small dim' }, k), el('span', { class: 'mono ' + (cls || '') }, v));
  return el('div', { class: 'card' }, el('h3', {}, 'The national debt'),
    row('Owed', moneyExact(d.debt), d.debt > 0 ? 'red' : 'green'),
    row('Against output', `${(d.ratio * 100).toFixed(0)}% of GDP`,
      d.ratio > 0.9 ? 'red' : d.ratio > 0.6 ? '' : 'green'),
    row('Interest, annual', money(d.service), d.service > 0 ? 'red' : ''),
    row('As a share of revenue', `${(d.share * 100).toFixed(1)}%`, d.share > 0.15 ? 'red' : ''),
    live && a.issuedYtd ? row('Issued this year', money(a.issuedYtd)) : null,
    live && a.repaidYtd ? row('Repaid this year', money(a.repaidYtd), 'green') : null,
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      d.verdict ? `The books call it ${d.verdict}. ` : '',
      'A shortfall is borrowed, not conjured: the treasury stops at zero and the hole shows here, '
      + 'costing interest as long as it is carried.'));
}

/**
 * The money market, and the three levers on it.
 *
 * This is the room's teaching surface: the supply of money, the rate it clears
 * at, the real rate underneath, and — for whoever is allowed to touch them —
 * the three tools in the order a course introduces them. Each says what it does
 * to the graph as well as what it does to the country, because the point of
 * having them is that a player can predict the second from the first.
 */
function monetaryCard(world, live) {
  const p = me();
  const e = world.economy;
  const mine = live && R.mayMoveRates(world, p?.id);
  const independent = R.bankIsIndependent(world);
  const row = (k, v, hint) => el('div', { class: 'spread', style: { padding: '4px 0' } },
    el('span', { class: 'small dim', title: hint || '' }, k), el('span', { class: 'mono' }, v));
  const pctOf = (v) => (v * 100).toFixed(2) + '%';

  const body = [
    row('Policy rate', pctOf(e.policyRate ?? 0), 'The rate the bank declares. It trades until the market clears there.'),
    row('The state borrows at', pctOf(e.marketRate ?? 0), 'The short rate, this republic’s credit spread, and a premium for the share of national savings the state absorbs.'),
    row('Real rate', pctOf(MACRO.realRate(world)), 'The nominal rate less expected inflation. The one investment answers to.'),
    el('div', { class: 'rule' }),
    row('Money supply', money(MACRO.moneySupply(world)), 'The base, times the multiplier the reserve ratio implies.'),
    row('Reserve requirement', ((e.reserveRatio ?? 0.1) * 100).toFixed(1) + '%'),
    row('Money multiplier', '×' + MACRO.moneyMultiplier(world).toFixed(1), 'One over the reserve ratio: what a dollar of reserves becomes once lent out.'),
  ];

  if (!mine) {
    body.push(el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      independent
        ? 'The bank is independent of this government. It leans against inflation and slack by its own rule, not the election coming.'
        : 'The bank answers to the Secretary of the Treasury and the President. You are neither.'));
    return el('div', { class: 'card' }, el('h3', {}, 'The money market'), ...body);
  }

  // The three tools. Free-typed where an amount is wanted, because a stepper
  // that re-renders on every keystroke eats the caret — see disburseCard.
  S.money = S.money || { rate: '', omo: '', reserve: '' };
  const tool = (title, why, control) => el('div', { style: { marginTop: '10px' } },
    el('div', { class: 'small' }, el('b', {}, title)),
    el('div', { class: 'tiny dimmer', style: { margin: '2px 0 5px' } }, why),
    control);

  const rateInput = el('input', {
    type: 'text', inputmode: 'decimal', placeholder: ((e.policyRate ?? 0) * 100).toFixed(2),
    style: { width: '80px' }, oninput: (ev) => { S.money.rate = ev.target.value; },
  });
  // Sized against the base rather than a fixed "5m", because the multiplier
  // means a small purchase is a large change in the supply: at a 10% reserve
  // ratio, buying a tenth of the base moves M by the whole of it. A hard-coded
  // suggestion sent every player straight to the zero bound on their first try.
  const step = Math.max(1e5, Math.round(((world.economy.monetaryBase || 0) * 0.05) / 1e5) * 1e5);
  const omoInput = el('input', {
    type: 'text', inputmode: 'decimal',
    placeholder: `${money(step)}  ·  -${money(step)}`,
    style: { width: '140px' }, oninput: (ev) => { S.money.omo = ev.target.value; },
  });

  body.push(
    tool('Set the policy target',
      'The bank trades until the market clears where you set it. Lower: cheaper credit, a wider output gap, more inflation, fewer out of work; higher reverses all four, over months.',
      el('div', { class: 'row' }, rateInput, el('span', { class: 'small dim' }, '%'),
        el('button', {
          class: 'btn sm primary',
          onclick: () => { const v = parseFloat(S.money.rate); if (Number.isFinite(v)) go('MONETARY', { tool: 'rate', value: v / 100 }); },
        }, 'Instruct the bank'))),
    tool('Open market operations',
      'Buy bonds and money is created: supply rises, the rate falls, public debt retires. Sell, and it leaves circulation.',
      el('div', { class: 'row' }, omoInput,
        el('button', {
          class: 'btn sm', onclick: () => { const v = parseAmount(S.money.omo); if (Number.isFinite(v)) go('MONETARY', { tool: 'omo', value: v }); },
        }, 'Execute'),
        el('span', { class: 'tiny dimmer' }, 'negative to sell'))),
    tool('Reserve requirement',
      'The bluntest of the three: it moves the multiplier, not the base — halve it and every dollar of reserves doubles at once.',
      el('div', { class: 'row' },
        ...[0.05, 0.1, 0.15, 0.25].map((r) => el('button', {
          class: 'btn sm' + (Math.abs((e.reserveRatio ?? 0.1) - r) < 1e-9 ? ' primary' : ' ghost'),
          onclick: () => go('MONETARY', { tool: 'reserve', value: r }),
        }, (r * 100).toFixed(0) + '%')))),
    el('div', { class: 'blocked', style: { marginTop: '10px' } },
      'This bank is not independent. Nothing stops you cutting into an election and paying the term after — '
      + 'the argument for the clause you did not adopt.'));

  return el('div', { class: 'card gold' }, el('h3', {}, 'The money market'), ...body);
}

/**
 * Output, prices and jobs — the three numbers a macro course is ultimately
 * about, and the trade-off between the last two.
 */
function outputCard(world, a, live) {
  const gap = live ? MACRO.outputGap(world) : (a.gap || 0);
  const infl = live ? (world.economy.inflation ?? 0) : (a.inflation || 0);
  const row = (k, v, cls, hint) => el('div', { class: 'spread', style: { padding: '4px 0' } },
    el('span', { class: 'small dim', title: hint || '' }, k), el('span', { class: 'mono ' + (cls || '') }, v));
  return el('div', { class: 'card' }, el('h3', {}, 'Output, prices and work'),
    row('Output gap', (gap * 100).toFixed(2) + '%', gap > 0.03 ? 'red' : gap < -0.03 ? 'red' : 'green',
      'How far output is above or below what the economy can sustain. Above, a boom showing as inflation; below, slack as unemployment.'),
    row('Inflation', (infl * 100).toFixed(2) + '%', Math.abs(infl - 0.02) > 0.03 ? 'red' : 'green',
      'Where prices are heading. The bank aims at 2%.'),
    row('Price level', (live ? world.economy.priceLevel : a.priceLevel ?? 100).toFixed(1),
      '', 'Indexed to 100 at the founding: 120 means everything costs a fifth more.'),
    live ? row('Unemployment', pct(world.economy.unemployment ?? 0), '',
      'The structural rate the map dictates, plus the cyclical part from the output gap.') : null,
    live ? row('— of which cyclical', ((world.economy.cyclical || 0) * 100).toFixed(2) + '%', '',
      'Okun’s law: output below potential puts people out of work, above it pulls them back. The part policy can reach.') : null,
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      'Cheap money buys lower unemployment, and inflation with it; '
      + 'squeezing it back out is paid for in jobs.'));
}

// The rating alone. What is owed against it has a card of its own now.
function creditCard(a) {
  return el('div', { class: 'card' }, el('h3', {}, 'Credit rating'),
    el('div', { class: 'meter' }, el('span', { class: 'lab' }, 'Credit'),
      el('div', { class: 'bar' }, el('i', { style: { width: (a.credit || 0) + '%' } })), el('span', { class: 'val' }, Math.round(a.credit || 0))),
    // Not "deficit" — a deficit is a year, a debt is a stock, and the two were
    // the same word here while debt was just a negative treasury. What the
    // rating is reacting to is the stock; the card beside this one prices it.
    a.debt
      ? el('div', { class: 'blocked', style: { marginTop: '8px' } },
        'The rating is carrying ', moneyExact(a.debt), ' of debt. Every point it slides adds to what the state pays to borrow.')
      : null);
}

/**
 * Free-typed amounts. The old field was a stepper that re-rendered the whole
 * view on every keystroke, so the caret died and you were reduced to clicking
 * the arrows in 100,000 increments. This one is plain text, accepts commas,
 * "$" and "1.5m" / "800k" shorthand, and updates the constitutional gate in
 * place without re-rendering anything around it.
 */
export function parseAmount(str) {
  const s = String(str).trim().toLowerCase().replace(/[$,\s]/g, '');
  const m = s.match(/^(-?\d*\.?\d+)([kmb])?$/);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return parseFloat(m[1]) * mult;
}

function disburseCard() {
  const world = w();
  const p = me();
  const gateBox = el('div', {});
  const hint = el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } });
  const goBtn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px' } });

  const amount = el('input', {
    type: 'text', inputmode: 'decimal', value: S.spend.raw ?? String(S.spend.amount ?? ''),
    placeholder: '800,000  ·  1.5m  ·  20000000',
    oninput: (e) => { S.spend.raw = e.target.value; refresh(); },
  });
  // What the purpose will be read as, said out loud before the money moves.
  // The parser behind this is a list of keywords, and while it was invisible the
  // honest player experience was "I disbursed millions and nothing happened" —
  // because an unmatched purpose really does buy a mood flicker and nothing
  // else. Now the categories are on the page, one click fills the field, and
  // the reading updates as you type.
  const reading = el('div', { class: 'tiny', style: { marginTop: '4px' } });
  const purpose = el('input', {
    value: S.spend.purpose, placeholder: 'Purpose — what the money is for',
    oninput: (e) => { S.spend.purpose = e.target.value; readBack(); },
  });
  const chips = el('div', { class: 'row', style: { gap: '4px', marginTop: '6px', flexWrap: 'wrap' } },
    ...A.SPEND_EFFECTS.map((eff) => el('button', {
      class: 'btn sm ghost', title: `e.g. “${eff.example}”`,
      onclick: () => { S.spend.purpose = eff.example; purpose.value = eff.example; readBack(); },
    }, eff.label)));

  function readBack() {
    const hits = A.readPurpose(S.spend.purpose);
    if (!S.spend.purpose.trim()) {
      reading.textContent = 'Untargeted money circulates and little else. Say what it is for.';
      reading.style.color = 'var(--dim)';
      return;
    }
    if (!hits.length) {
      reading.textContent = 'Reads as: nothing in particular — it circulates, lifts the mood, leaves no mark.';
      reading.style.color = 'var(--red)';
      return;
    }
    reading.textContent = 'Reads as: ' + hits.map((h) => h.label.toLowerCase()).join(' and ') + '.';
    reading.style.color = 'var(--green-text)';
  }

  function refresh() {
    const amt = parseAmount(amount.value);
    const valid = Number.isFinite(amt) && amt > 0;
    S.spend.amount = valid ? amt : 0;
    hint.textContent = valid ? moneyExact(amt) : amount.value.trim() ? 'Not a number.' : '';
    const g = valid && p ? A.disburseGate(world, p.id, amt) : { ok: false, reasons: [] };
    gateBox.className = !valid ? '' : g.ok ? 'allowed' : 'blocked';
    gateBox.replaceChildren(...(!valid ? []
      : g.ok ? [el('span', {}, 'Within your authority. ', R.spendClauseText(world, amt))]
      : g.reasons.map((r) => el('div', {}, r))));
    goBtn.disabled = !g.ok;
    goBtn.textContent = !valid ? 'Enter an amount'
      : g.ok ? 'Disburse ' + moneyExact(amt) : 'Blocked by the constitution';
  }
  goBtn.addEventListener('click', () => {
    if (goBtn.disabled) return;
    go('DISBURSE', { amount: S.spend.amount, purpose: S.spend.purpose });
    S.spend.raw = ''; amount.value = ''; refresh();
  });
  refresh();
  readBack();

  return el('div', { class: 'card gold' }, el('h3', {}, 'Disburse'),
    el('label', { class: 'field' }, el('span', {}, 'Amount'), amount, hint),
    el('label', { class: 'field' }, el('span', {}, 'Purpose'), purpose),
    reading, chips,
    gateBox, goBtn);
}

/** How much un-voted money is left in the rolling window. */
function allowanceMeter() {
  const world = w();
  const d = R.discretionUsed(world);
  if (!Number.isFinite(d.cap)) {
    return el('div', { class: 'blocked', style: { marginTop: '10px' } },
      'No discretionary allowance: nothing stops sub-threshold payments draining the treasury.');
  }
  const pctUsed = clamp((d.used / d.cap) * 100, 0, 100);
  return el('div', { style: { marginTop: '12px' } },
    el('div', { class: 'spread tiny' },
      el('span', { class: 'dimmer' }, `Discretionary allowance · rolling ${d.years} yr`),
      el('span', { class: 'mono ' + (d.remaining <= 0 ? 'red' : '') }, moneyExact(d.remaining) + ' left')),
    el('div', { class: 'bar', style: { marginTop: '4px' } },
      el('i', { style: { width: pctUsed + '%', background: pctUsed > 80 ? 'var(--red)' : 'var(--gold)' } })),
    el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
      `${moneyExact(d.used)} of ${moneyExact(d.cap)} committed without a vote`,
      d.resetsIn ? ` · oldest commitment ages out in ${d.resetsIn} ticks` : ''));
}

function meterRow(k, v, total) {
  return el('div', { class: 'meter', style: { margin: '5px 0' } },
    el('span', { class: 'lab' }, k),
    el('div', { class: 'bar' }, el('i', { style: { width: (total ? (v / total) * 100 : 0) + '%' } })),
    el('span', { class: 'val' }, money(v)));
}

// --- City ------------------------------------------------------------------

VIEWS.city = (root) => {
  const world = w();
  const p = me();
  const sel = S.parcel != null ? world.city.parcels[S.parcel] : null;
  // The map used to be four maps behind a row of toggles, which meant the
  // numbers you wanted to compare were never on screen together. There is one
  // map now — the city by district — and selecting anywhere on it opens the
  // district itself, where zoning, land value and mood are all readable at once.
  const selD = sel ? world.districts.find((x) => x.id === sel.district) : null;

  root.append(el('h1', { class: 'page' }, 'Domestic geography'),
    el('p', { class: 'sub' }, 'Zoning, districting and building. A jail lowers nearby land values, housing cuts homelessness once built.'));

  root.append(el('div', { class: 'split' },
    el('div', { class: 'card' },
      cityMap(world),
      el('div', { class: 'row tiny dimmer', style: { marginTop: '10px' } },
        ...world.districts.map((d) => el('span', {
          style: { cursor: 'pointer', opacity: !selD || selD.id === d.id ? 1 : 0.45 },
          title: 'Show ' + d.name,
          onclick: () => {
            const first = world.city.parcels.find((x) => x.district === d.id && !x.water);
            if (first) { S.parcel = first.i; CTX.rerender(true); }
          },
        }, el('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: d.color, borderRadius: '2px', marginRight: '4px' } }), d.name)))),

    el('div', { class: 'stack' },
      selD ? districtPanel(selD) : null,
      sel ? parcelInspector(sel) : el('div', { class: 'card dim small' }, 'Select a parcel to read its district.'),
      el('div', { class: 'card' }, el('h3', {}, 'District map & representation'),
        el('p', { class: 'tiny dimmer' }, 'District lines are electorates. Moving parcels between them is a REDISTRICT clause: gerrymandering is a bill.'),
        ...world.districts.map((d) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, el('span', { style: { color: d.color } }, '▍'), ' ', d.name),
          el('span', { class: 'mono dimmer' }, world.city.parcels.filter((x) => x.district === d.id).length + ' parcels · ' + num(d.pop))))),
    ),
  ));
};

/**
 * Everything the four map layers used to encode as colour, stated as numbers
 * for one district: its mood, what its land is worth, how it is zoned, and who
 * speaks for it. A colour ramp told you which district was worse; this tells
 * you by how much, and why.
 */
function districtPanel(d) {
  const world = w();
  const own = world.city.parcels.filter((x) => x.district === d.id);
  const land = own.filter((x) => !x.water);
  const avgLand = land.length ? Math.round(sum(land, (x) => x.landValue) / land.length) : 0;
  const built = land.filter((x) => x.building);
  const zoneMix = Object.entries(ZONES).map(([k, z]) => [z, land.filter((x) => x.zone === k).length])
    .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  // Everyone this state sends: its House members, by district, and its senator.
  const delegation = world.seats
    .filter((x) => x.district === d.id && x.personaId)
    .sort((a, b) => (R.PRESTIGE[b.office] ?? 30) - (R.PRESTIGE[a.office] ?? 30) || a.index - b.index);
  const rep = delegation[0] || null;
  const repP = rep ? world.personas[rep.personaId] : null;

  const bar = (label, val, tone) => el('div', { class: 'spread', style: { margin: '3px 0' } },
    el('span', { class: 'tiny dim' }, label),
    el('div', { class: 'bar', style: { width: '110px' } },
      el('i', { style: { width: clamp(val, 0, 100) + '%', background: tone } })),
    el('span', { class: 'tiny mono' }, Math.round(val)));

  return el('div', { class: 'card', style: { borderColor: d.color } },
    el('div', { class: 'spread' },
      el('h3', { style: { margin: 0 } }, el('span', { style: { color: d.color } }, '▍'), ' ', d.name),
      el('span', { class: 'tiny dimmer mono' }, num(d.pop) + ' people')),
    bar('Mood', d.mood ?? 50, (d.mood ?? 50) >= 50 ? 'var(--green)' : 'var(--red)'),
    bar('Order', d.order ?? 50, 'var(--blue)'),
    bar('Health', d.health ?? 50, 'var(--teal)'),
    el('div', { class: 'spread tiny', style: { marginTop: '8px' } },
      el('span', { class: 'dim' }, 'Land value · average'), el('span', { class: 'mono' }, '$' + avgLand + 'k')),
    el('div', { class: 'spread tiny' },
      el('span', { class: 'dim' }, 'Unemployment'),
      el('span', { class: 'mono ' + ((d.unemployment ?? 0) > 0.09 ? 'red' : '') }, ((d.unemployment ?? 0) * 100).toFixed(1) + '%')),
    el('div', { class: 'spread tiny' },
      el('span', { class: 'dim' }, 'Homeless'), el('span', { class: 'mono' }, num(d.homeless))),
    el('div', { class: 'spread tiny' },
      el('span', { class: 'dim' }, 'Median income'), el('span', { class: 'mono' }, '$' + num(d.income))),
    el('div', { class: 'spread tiny' },
      el('span', { class: 'dim' }, 'Built'), el('span', { class: 'mono' }, built.length + ' of ' + land.length + ' parcels')),
    el('div', { class: 'tiny dim', style: { marginTop: '8px' } }, 'Zoning'),
    el('div', { class: 'row tiny dimmer' },
      ...zoneMix.map(([z, n]) => el('span', {},
        el('span', { style: { display: 'inline-block', width: '9px', height: '9px', background: z.color, borderRadius: '2px', marginRight: '4px' } }),
        z.label, ' ', el('span', { class: 'mono' }, n)))),
    // The whole delegation, by chamber. One line per member, with the seat they
    // hold beside them — a numbered district for a representative, the state
    // itself for a senator. "Represented by <one name>" was the old line, and it
    // was accurate for exactly as long as a state held one seat.
    el('div', { style: { marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--rule)' } },
      el('div', { class: 'tiny dim', style: { marginBottom: '3px' } },
        delegation.length ? `In Congress — ${delegation.length} member${delegation.length === 1 ? '' : 's'}` : 'In Congress'),
      ...(delegation.length
        ? delegation.map((st) => el('div', { class: 'spread tiny', style: { padding: '1px 0' } },
          el('span', {}, world.personas[st.personaId]?.name || '—'),
          el('span', { class: 'dimmer mono' },
            `${R.ADDRESS?.[st.office] || R.office(world, st.office)?.name || st.office}${st.cd ? ' ' + st.cd : ''}`)))
        : [el('div', { class: 'tiny dimmer' }, 'vacant')])));
}

/** The smallest box holding two boxes. */
const boxUnion = (a, b) => {
  const x0 = Math.min(a.x0, b.x0), y0 = Math.min(a.y0, b.y0);
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

/**
 * The districts map: the republic's own territory, subdivided.
 *
 * It used to be the engine's parcel grid drawn literally — a field of squares,
 * coloured by district, inside a coastline that had been forced to stay clear of
 * the grid. So every district was a rectangle of rectangles, none of them shaped
 * by the coast, and a district's size said nothing about how many people lived in
 * it.
 *
 * Now the geometry comes from geo.js. The outline is Silver's actual border with
 * Canada and Mexico and its actual coast — the same polygon the world map
 * draws, at this scale. Inside it the districts are cut to their share of the
 * population, so a crowded district is small and tight and an empty one sprawls,
 * and each is cut again into its parcels. Nothing here is a square. The parcel
 * grid still exists in the engine, because that is how a REDISTRICT clause
 * addresses land; it is bookkeeping, and it is no longer the map.
 */
function cityMap(world) {
  const CG = GEO.cityGeometry(world);
  const G = CG.g;
  // Two maps of one country, and the difference between them is what a war took.
  //
  // `G` is the republic as it was founded, and the districts are cut from it and
  // stay cut from it: an electorate is a body of people, and land taken off a
  // beaten neighbour does not enrol anyone to vote in Harborlight. `GA` is the
  // republic as it stands, borders and all. Both are solved on the identical
  // coast, so the ground beyond the old frontier is ours without a single parcel
  // or district line moving under the player's feet.
  const GA = GEO.mapOf(world);
  // Identical when nothing has been ceded either way: `mapOf` hands back the same
  // cached map the districts were cut from.
  const moved = GA !== G;

  // Frame the republic, not the whole world. The frame is then widened to 4:3
  // about the same centre — the country is taller than it is wide, and a viewBox
  // that shape gives an SVG at width:100% a height taller than the card, which
  // simply crops the south coast off. Annexed ground is inside the country and so
  // has to be inside the frame: a border that moved off the top of the page has
  // not visibly moved at all.
  const e = moved ? boxUnion(CG.extent, GEO.landExtent(GA, 'us')) : CG.extent;
  const PAD = 12, ASPECT = 4 / 3;
  let fw = e.w + PAD * 2, fh = e.h + PAD * 2;
  if (fw / fh < ASPECT) fw = fh * ASPECT; else fh = fw / ASPECT;
  const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
  const vx = cx - fw / 2, vy = cy - fh / 2, vw = fw, vh = fh;

  const districtOf = (id) => world.districts.find((x) => x.id === id);
  const parts = [];
  parts.push('<defs>'
    // Four hard bands matching .citymap in the stylesheet, for the reason given
    // at the world map's `wsea`: the drawing is letterboxed inside its own box
    // and the CSS paints the margin, so a smooth ramp here meets flat
    // rectangles out there. Same water, same steps, no seam.
    + '<linearGradient id="csea" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#2f7f9a"/><stop offset="0.25" stop-color="#2f7f9a"/>'
    + '<stop offset="0.25" stop-color="#2a7490"/><stop offset="0.5" stop-color="#2a7490"/>'
    + '<stop offset="0.5" stop-color="#246881"/><stop offset="0.75" stop-color="#246881"/>'
    + '<stop offset="0.75" stop-color="#1c5c74"/><stop offset="1" stop-color="#1c5c74"/></linearGradient>'
    + `<clipPath id="cland"><path d="${GEO.pathOf(G.ring)}"/></clipPath>`
    + `<clipPath id="cmine"><path d="${GEO.pathOf(G.halves.us)}"/></clipPath>`
    // Ground that changed hands: the two silvers, one inside the other, as a
    // single even-odd path — the symmetric difference of the founding border and
    // the present one, which is every square inch a treaty moved and nothing
    // else. Intersected with whoever holds it now, it is either the land we took
    // or the land we gave up.
    + (moved
      ? `<clipPath id="cmoved"><path clip-rule="evenodd" d="${GEO.pathOf(GA.halves.us)} ${GEO.pathOf(G.halves.us)}"/></clipPath>`
        + `<clipPath id="cnow"><path d="${GEO.pathOf(GA.halves.us)}"/></clipPath>`
      : '')
    + '</defs>');
  parts.push(`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#csea)"/>`);
  for (let k = 1; k <= 4; k++) {
    const yy = (vy + vh * k / 5).toFixed(0);
    parts.push(`<path d="M${vx},${yy} q ${(vw / 4).toFixed(0)},5 ${(vw / 2).toFixed(0)},0 t ${(vw / 2).toFixed(0)},0" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1.6"/>`);
  }

  // The whole landmass in sand, so the beach shows outside every border.
  parts.push(`<path d="${GEO.pathOf(G.ring)}" fill="#e2d7bc" stroke="#d8c79a" stroke-width="6" stroke-linejoin="round"/>`);
  // What is not ours, muted — but in the same colours it wears on the World tab,
  // and named. Both maps draw the identical polygon at a uniform scale, so the
  // country really is the same shape in each; what made them look like two
  // different places was that the land across the border was anonymous sand
  // here and a named, coloured neighbour there. Now the border reads as the
  // same border on both.
  const NEIGHBOUR = { canada: '#dcb970', mexico: '#a9c6a2' };
  parts.push('<g clip-path="url(#cland)">');
  for (const id of ['canada', 'mexico']) {
    parts.push(`<path d="${GEO.pathOf(GA.halves[id])}" fill="${NEIGHBOUR[id]}" fill-opacity="0.5"/>`);
  }
  // Land taken from them. It is ours, so it is our colour — but it holds no
  // district and no parcel, because nothing about a conquest enrols a voter, and
  // the map says so by leaving it undivided.
  if (moved) {
    parts.push('<g clip-path="url(#cmoved)"><g clip-path="url(#cnow)">'
      + `<path d="${GEO.pathOf(G.ring)}" fill="#efe7d3"/></g></g>`);
  }
  parts.push('</g>');
  // Their names, placed where their land actually falls *on this map*. The
  // world map's label anchor is the middle of the whole country, which is off
  // the edge of a frame cropped to Silver — so the names never drew at all.
  // Sampling inside the frame puts each name on the strip of that country this
  // map can actually see.
  for (const id of ['canada', 'mexico']) {
    const f = (world.foreign || []).find((x) => x.id === id);
    if (!f) continue;
    const half = GA.halves[id];
    const seen = [];
    for (let y = vy + 8; y < vy + vh - 8; y += 6) {
      for (let x = vx + 8; x < vx + vw - 8; x += 6) {
        if (GEO.inPoly([x, y], half) && GEO.inPoly([x, y], G.ring)) seen.push([x, y]);
      }
    }
    if (seen.length < 6) continue;                 // barely on the page — leave it unnamed
    // The name goes where that country has the most room around it, not at the
    // centroid of what the frame can see.
    //
    // A centroid is the right answer for a blob and the wrong one for a band.
    // Canada on this map is a shallow strip across the top: its centroid sits
    // a pixel or two off the frontier, and a 7px name centred there lands half
    // in Canada and half in Silver, straddling the very line the map is drawn
    // to show. So each sampled point is scored by how far its own country
    // reaches above and below it — the smaller of the two, so a point hard
    // against a border scores nothing however deep the land runs the other way —
    // and the name goes to the best of them, nearest the middle of the frame
    // when several tie.
    const CELL = 6;
    const key = (x, y) => `${Math.round(x / CELL)}|${Math.round(y / CELL)}`;
    const grid = new Set(seen.map(([x, y]) => key(x, y)));
    const clearance = ([x, y]) => {
      const room = (dx, dy) => {
        let n = 0;
        while (n < 6 && grid.has(key(x + dx * CELL * (n + 1), y + dy * CELL * (n + 1)))) n++;
        return n;
      };
      // Vertical room is what a single line of type actually needs; horizontal
      // room breaks the ties between points in the same row of a band.
      return Math.min(room(0, -1), room(0, 1)) * 4 + Math.min(room(-1, 0), room(1, 0));
    };
    // Ties break *outward*, toward the rim of the frame.
    //
    // They used to break toward the middle of it, and the middle of this frame
    // is Silver — the map is cropped to the republic, so a neighbour only
    // appears as a band along one edge and "nearest the centre" is a synonym
    // for "hard against our border". Both names sat on the frontier for that
    // reason, reading as labels for the line rather than for the countries.
    //
    // Clearance still dominates at ten to one, so this cannot pull a name onto
    // the border it is there to stay off; it only decides between points that
    // are equally clear of one.
    const midX = vx + vw / 2, midY = vy + vh / 2;
    let spot = seen[0], bestScore = -Infinity;
    for (const pt of seen) {
      const score = clearance(pt) * 10
        + (Math.abs(pt[0] - midX) / vw + Math.abs(pt[1] - midY) / vh);
      if (score > bestScore) { bestScore = score; spot = pt; }
    }
    // Centred on the anchor rather than sitting on it: with the default
    // alphabetic baseline the whole name rides above the point that was chosen
    // for having room on both sides of it.
    parts.push(`<text x="${spot[0].toFixed(1)}" y="${spot[1].toFixed(1)}" text-anchor="middle"`
      + ` dominant-baseline="central"`
      + ` font-size="7" font-weight="800" fill="#4a3f28" fill-opacity="0.75"`
      + ` stroke="#e8dcc0" stroke-opacity="0.6" stroke-width="2" paint-order="stroke"`
      + ` pointer-events="none">${esc(f.name)}</text>`);
  }

  // Ours: districts, then their parcels, all clipped to the border and the coast
  // at once — so a coastal district is exactly the shape the coast leaves it.
  parts.push('<g clip-path="url(#cland)"><g clip-path="url(#cmine)">');
  for (const c of CG.cells) {
    const d = c.district;
    if (c.poly.length < 3) continue;
    parts.push(`<path d="${GEO.pathOf(c.poly)}" fill="${d.color}" fill-opacity="0.42"/>`);
    for (const pc of c.parcels) {
      if (pc.poly.length < 3 || !pc.parcel) continue;
      const pp = pc.parcel;
      if (pp.water) {
        parts.push(`<path data-i="${pp.i}" d="${GEO.pathOf(pc.poly)}" fill="#2f7f9a" stroke="#2f7f9a" stroke-width="1.2"/>`);
        continue;
      }
      const built = pp.building || pp.project;
      parts.push(`<path data-i="${pp.i}" d="${GEO.pathOf(pc.poly)}" fill="${d.color}"`
        + ` fill-opacity="${built ? 1 : 0.72}" stroke="#efe7d3" stroke-opacity="0.5" stroke-width="0.7"/>`);
      if (pp.building) {
        const ct = GEO.centroid(pc.poly);
        parts.push(`<circle cx="${ct[0].toFixed(1)}" cy="${ct[1].toFixed(1)}" r="1.6" fill="#2a2118" pointer-events="none"/>`);
      }
    }
  }
  // Ground under occupation. Over the parcels so it reads as a condition of the
  // land rather than a kind of zoning, and named — on this map the player is
  // looking at their own streets, so "occupied" is the whole story.
  const cbands = DEP.occupations(world, GA);
  if (cbands.length) {
    parts.push('<defs><pattern id="cmhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      + '<rect width="6" height="6" fill="none"/><rect width="2" height="6" fill="#141414" fill-opacity="0.32"/></pattern>'
      + ['us', 'canada', 'mexico'].map((id) =>
        `<clipPath id="cocc-${id}"><path d="${GEO.pathOf(GA.halves[id])}"/></clipPath>`).join('')
      + '</defs>');
    for (const b of cbands) {
      const loser = b.byUs ? b.foreign.id : 'us';
      parts.push(`<g clip-path="url(#cland)"><g clip-path="url(#cocc-${loser})">`);
      parts.push(`<path d="${GEO.pathOf(b.poly)}" fill="${b.byUs ? '#5b8fb0' : '#c2483c'}" fill-opacity="0.4"/>`);
      parts.push(`<path d="${GEO.pathOf(b.poly)}" fill="url(#cmhatch)"/>`);
      parts.push('</g></g>');
      const spot = GEO.labelSpotFrom(b.poly.filter(([x, y]) => x > vx && x < vx + vw && y > vy && y < vy + vh), 6);
      if (spot) {
        parts.push(`<text x="${spot.x.toFixed(1)}" y="${spot.y.toFixed(1)}" text-anchor="middle"`
          + ` font-size="6" font-weight="800" letter-spacing="0.6" fill="#3a2018"`
          + ` stroke="#e8dcc0" stroke-opacity="0.55" stroke-width="2" paint-order="stroke"`
          + ` pointer-events="none">${b.byUs ? 'HELD BY US' : 'OCCUPIED'}</text>`);
      }
    }
  }

  // District lines over the parcels, and the selected parcel picked out.
  for (const c of CG.cells) {
    if (c.poly.length < 3) continue;
    parts.push(`<path d="${GEO.pathOf(c.poly)}" fill="none" stroke="#33291c" stroke-opacity="0.55" stroke-width="1.1" stroke-linejoin="round" pointer-events="none"/>`);
  }
  if (S.parcel != null) {
    const hit = CG.cells.flatMap((c) => c.parcels).find((pc) => pc.parcel && pc.parcel.i === S.parcel);
    if (hit && hit.poly.length > 2) {
      parts.push(`<path d="${GEO.pathOf(hit.poly)}" fill="none" stroke="#e8622e" stroke-width="1.8" stroke-linejoin="round" pointer-events="none"/>`);
    }
  }
  parts.push('</g></g>');

  // The national border, inked heavily where it is a border and not a shore —
  // and behind it, where a treaty moved it, the frontier the republic was founded
  // with, dashed and pale. That is how an atlas says a border used to run
  // somewhere else, and it is the only thing on this map that explains why a
  // stretch of the country holds no districts.
  parts.push('<g clip-path="url(#cland)" pointer-events="none">');
  if (moved) {
    for (const b of [G.borders.a, G.borders.b]) {
      parts.push(`<path d="${GEO.lineOf(b)}" fill="none" stroke="#2e2416" stroke-opacity="0.32" stroke-width="1" stroke-dasharray="3 3" stroke-linejoin="round"/>`);
    }
  }
  for (const b of [GA.borders.a, GA.borders.b]) {
    parts.push(`<path d="${GEO.lineOf(b)}" fill="none" stroke="#2e2416" stroke-opacity="0.75" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  parts.push('</g>');

  // And a word on the new ground, so that undivided land inside our own border
  // reads as conquest rather than as a hole in the map. Memoised on the map
  // itself: finding it is a pass over the sampling grid, and this repaints on the
  // clock, while the answer can only change when a border does.
  if (moved) {
    if (GA.annexedSpot === undefined) {
      const got = GA.grid.pts.filter((p) => GEO.inPoly(p, GA.halves.us) && !GEO.inPoly(p, G.halves.us)
        && GEO.inPoly(p, GA.ring));
      GA.annexedSpot = got.length > 8 ? GEO.labelSpotFrom(got, GA.grid.step) : null;
    }
    if (GA.annexedSpot) {
      parts.push(`<text x="${GA.annexedSpot.x.toFixed(1)}" y="${GA.annexedSpot.y.toFixed(1)}" text-anchor="middle"`
        + ` font-size="6" font-weight="800" letter-spacing="0.6" fill="#3a2018"`
        + ` stroke="#e8dcc0" stroke-opacity="0.55" stroke-width="2" paint-order="stroke"`
        + ` pointer-events="none">ANNEXED</text>`);
    }
  }
  parts.push(`<path d="${GEO.pathOf(G.ring)}" fill="none" stroke="#26506a" stroke-opacity="0.45" stroke-width="1.3" stroke-linejoin="round" pointer-events="none"/>`);

  // Names, on the widest run of each district's own ground.
  //
  // **Two lines when one will not fit.** The size is solved against the room the
  // label has, which was the whole of the sizing rule and is not enough on its
  // own: "Pacific Northwest" is seventeen characters over a state a fraction the
  // width of Texas, so solving for width alone drove it below legibility and it
  // still ran out over Mountain West and the sea. Breaking the name in half buys
  // roughly double the size for the same room, which is the only thing that
  // actually fits a long name into a small state.
  //
  // The break is at the space nearest the middle, so "Pacific / Northwest" and
  // "Upper / Midwest" split where a reader would; a single-word name has no
  // break available and keeps whatever size it gets.
  for (const c of CG.cells) {
    if (!c.spot) continue;
    const name = c.district.name;
    const room = c.spot.w * 0.9;
    const sizeFor = (chars) => Math.min(6.5, room / Math.max(1, chars * 0.58));

    let lines = [name];
    let size = sizeFor(name.length);
    if (size < 3.4 && name.includes(' ')) {
      // The space closest to the middle of the string.
      let best = -1;
      for (let i = 0; i < name.length; i++) {
        if (name[i] !== ' ') continue;
        if (best < 0 || Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2)) best = i;
      }
      const two = [name.slice(0, best), name.slice(best + 1)];
      const wrapped = sizeFor(Math.max(two[0].length, two[1].length));
      if (wrapped > size) { lines = two; size = wrapped; }
    }

    const common = `text-anchor="middle" font-size="${size.toFixed(1)}" font-weight="800"`
      + ` letter-spacing="0.1" fill="#241708" stroke="#efe7d3" stroke-width="1.8"`
      + ` paint-order="stroke" pointer-events="none"`;
    if (lines.length === 1) {
      parts.push(`<text x="${c.spot.x.toFixed(1)}" y="${c.spot.y.toFixed(1)}" dominant-baseline="middle" ${common}>${esc(name)}</text>`);
    } else {
      // Centred on the spot as a block, so a two-line name sits where a one-line
      // name would rather than hanging below it.
      const top = c.spot.y - size * 0.5;
      parts.push(`<text x="${c.spot.x.toFixed(1)}" y="${top.toFixed(1)}" dominant-baseline="middle" ${common}>`
        + lines.map((l, i) => `<tspan x="${c.spot.x.toFixed(1)}" dy="${i ? size.toFixed(1) : 0}">${esc(l)}</tspan>`).join('')
        + `</text>`);
    }
  }

  // Alaska and Hawaii, cropped into the bottom-left the way every US map does
  // it. Both belong to the Pacific Northwest for representation; these are
  // drawings, not districts, so they carry no parcels and take no clicks.
  {
    const pn = CG.cells.find((c) => c.district.name === 'Pacific Northwest');
    const fill = pn?.district?.color || "#8aa0b8";
    const box = (x, y, w, h, label, inner) => `<g pointer-events="none">`
      + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#0d2233" fill-opacity="0.5"`
      + ` stroke="#26506a" stroke-opacity="0.5" stroke-width="0.5"/>${inner}`
      + `<text x="${x + w / 2}" y="${y + h - 1.4}" text-anchor="middle" font-size="2.6" font-weight="700"`
      + ` fill="#cfe0ee" letter-spacing="0.2">${label}</text></g>`;

    const ax = vx + 3, ay = vy + vh - 31, as = 0.72;
    const akPath = GEO.pathOf(ALASKA.map(([x, y]) => [ax + 2 + x * as, ay + 2 + y * as]));
    parts.push(box(ax, ay, 28, 25, 'ALASKA',
      `<path d="${akPath}" fill="${fill}" fill-opacity="0.85" stroke="#efe7d3" stroke-width="0.4"/>`));

    const hx = vx + 34, hy = vy + vh - 31, hs = 0.85;
    const hiInner = HAWAII.map((i) =>
      `<circle cx="${(hx + 2 + i.cx * hs).toFixed(1)}" cy="${(hy + 3 + i.cy * hs).toFixed(1)}"`
      + ` r="${(i.r * hs).toFixed(1)}" fill="${fill}" fill-opacity="0.85" stroke="#efe7d3" stroke-width="0.3"/>`).join('');
    parts.push(box(hx, hy, 21, 25, 'HAWAII', hiInner));
  }

  // Compass rose, out in the sea off the south-*east* — the south-west corner is
  // where the Alaska and Hawaii insets live now, and the rose was drawn on top
  // of Alaska.
  parts.push(compassRose(vx + vw - 12, vy + vh - 12, 7));

  const box = el('div', {
    class: 'citymap',
    onclick: (e) => {
      const t = e.target.closest && e.target.closest('[data-i]');
      if (t) { S.parcel = +t.getAttribute('data-i'); CTX.rerender(true); }
    },
  });
  box.innerHTML = `<svg viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" width="100%" style="display:block;max-height:540px" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
  return box;
}

/**
 * A compass rose, sized to whatever map is asking for one.
 *
 * Both maps carry the same one — the world map had no orientation mark at all,
 * and two maps of the same world should not disagree about which way north is.
 */
function compassRose(cx, cy, r) {
  const ink = '#efe7d3';
  const n = (v) => (+v).toFixed(1);
  return `<g pointer-events="none"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#0e3448" stroke="${ink}" stroke-width="${n(r * 0.13)}"/>`
    + `<path d="M${n(cx)},${n(cy - r * 0.79)} L${n(cx + r * 0.27)},${n(cy)} L${n(cx)},${n(cy + r * 0.79)} L${n(cx - r * 0.27)},${n(cy)} Z" fill="${ink}"/>`
    + `<text x="${n(cx)}" y="${n(cy - r * 1.21)}" text-anchor="middle" font-size="${n(r * 0.71)}" font-weight="800" fill="${ink}">N</text></g>`;
}

function parcelCell(pp) {
  const world = w();
  const d = world.districts.find((x) => x.id === pp.district);
  const bg = d?.color || '#333';

  const b = pp.building ? BUILDINGS[pp.building] : null;
  return el('div', {
    class: 'parcel' + (S.parcel === pp.i ? ' sel' : ''),
    style: { background: bg, opacity: pp.building || pp.project ? 1 : 0.55 },
    title: `#${pp.i} ${d?.name} · ${ZONES[pp.zone].label} · $${pp.landValue}k${b ? ' · ' + b.name : ''}`,
    onclick: () => { S.parcel = pp.i; CTX.rerender(true); },
  },
    b ? el('span', { class: 'glyph' }, glyph(pp.building)) : null,
    pp.project ? el('span', { class: 'prog' }, el('i', { style: { width: (pp.project.progress / pp.project.ticks) * 100 + '%' } })) : null,
  );
}

const GLYPH = { housing_low: '▤', housing_mid: '▥', factory: '⚙', offices: '▩', market: '⌗', park: '❦', school: '✎', hospital: '✚', sewer: '≈', parking: 'P', jail: '⌸', barracks: '⚔' };
const glyph = (k) => GLYPH[k] || '·';

function parcelInspector(pp) {
  const world = w();
  const p = me();
  const d = world.districts.find((x) => x.id === pp.district);
  if (pp.water) {
    return el('div', { class: 'card gold' },
      el('h3', {}, 'Parcel #' + pp.i),
      el('div', { class: 'small' }, (d?.name || 'Open water') + ' · water'),
      el('div', { class: 'quote' }, 'Water — nothing is built here. Districts along it lean to trade, and their land is worth more.'));
  }
  const b = pp.building ? BUILDINGS[pp.building] : null;
  const canZone = p && R.hasPower(world, p.id, 'zone');

  const node = el('div', { class: 'card gold' },
    el('h3', {}, 'Parcel #' + pp.i),
    el('div', { class: 'small' }, d?.name, ' · ', ZONES[pp.zone].label, ' · land value $', pp.landValue + 'k'),
    // Not `.quote`. That class sets EB Garamond with a gold rule down the side and
    // exists for the documents — constitutions, preambles, opinions of the court.
    // A building's jobs-and-upkeep line borrowing it meant clicking a district put
    // one line of serif in the middle of a panel of Space Grotesk.
    b ? el('div', { class: 'small', style: { marginTop: '6px' } },
      el('b', {}, b.name),
      el('span', { class: 'dim' }, ' — ', String(b.jobs), ' jobs, ', String(b.homes), ' homes, upkeep ', money(b.upkeep), '/yr')) : null,
    pp.project ? el('div', { class: 'small gold' }, 'Under construction: ' + BUILDINGS[pp.project.building].name + ' (' + Math.round((pp.project.progress / pp.project.ticks) * 100) + '%)') : null,
  );

  if (!b && !pp.project) {
    node.append(el('h3', { style: { marginTop: '14px' } }, 'Build here'));
    for (const [k, bb] of Object.entries(BUILDINGS)) {
      const gate = p ? A.disburseGate(world, p.id, bb.cost) : { ok: false, reasons: [] };
      node.append(el('div', { class: 'spread', style: { padding: '4px 0' } },
        el('div', {}, el('span', { class: 'small' }, glyph(k), ' ', bb.name),
          el('div', { class: 'tiny dimmer' }, money(bb.cost), ' · ', bb.years, ' yrs · ', bb.jobs, ' jobs', bb.homes ? ', ' + bb.homes + ' homes' : '')),
        el('button', {
          class: 'btn sm' + (gate.ok && canZone ? ' primary' : ''), disabled: !gate.ok || !canZone,
          title: !canZone ? 'Your office has no power to order construction.' : gate.reasons.join(' '),
          onclick: () => go('BUILD', { parcel: pp.i, building: k }),
        }, 'build')));
    }
    node.append(el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      canZone ? 'Above the executive threshold it goes to the floor as a BUILD clause.'
        : 'No power to zone. Put a BUILD clause in a bill.'));
    if (canZone) node.append(el('div', { class: 'row', style: { marginTop: '8px' } },
      ...Object.keys(ZONES).map((z) => el('button', { class: 'btn sm ghost', onclick: () => go('ZONE', { parcel: pp.i, zone: z }) }, ZONES[z].label))));
  }
  return node;
}

// --- Press -----------------------------------------------------------------

// The international map: Silver and the three foreign powers, as an actual map
// of neighbouring lands, with each nation's standing toward you.
VIEWS.world = (root) => {
  const world = w();
  const foreign = world.foreign || [];
  const relOf = (f) => f.absorbed ? { label: 'Annexed', color: '#8b8377' }
    : f.atWar ? { label: 'At war', color: '#d92d20' }
      : f.allied ? { label: 'Allied', color: '#2f9e44' }
        : f.hostility >= 55 ? { label: 'Hostile', color: '#e8582d' }
          : { label: 'Uneasy peace', color: '#b8892f' };

  // One continent, cut into three countries — see geo.js. The territories tile
  // the landmass exactly, so there is no open sea between Silver and either
  // neighbour and no unclaimed ground; the only land that belongs to nobody is
  // the beach, which is the outer half of the sand stroke on the coast.
  // Drawn on the borders as they stand, not as they were founded: `mapOf` solves
  // the same continent for the land each country holds after every cession the
  // Chronicle has recorded. The coast and the terrain are identical either side
  // of a treaty — only the lines between the countries move.
  const G = GEO.mapOf(world);
  const LAY = {
    us: { fill: '#efe7d3' },
    canada: { fill: '#dcb970' },
    mexico: { fill: '#a9c6a2' },
    // Clay, not the blue-grey it used to be. At '#9fb6c4' the archipelago read as
    // a patch of shallow water with a coastline drawn round it — the one power
    // on this map whose territory did not look like land.
    sab: { fill: '#d3a494' },
  };

  const parts = [];
  parts.push('<defs>'
    // Deeper than the city map's water on purpose: this is open ocean between
    // countries, not the shallows off one shoreline, and the land reads harder
    // against it at this scale.
    // Four hard bands, and they are the four the stylesheet paints behind the
    // graphic — see .citymap.ocean. The svg is width:100% under a max-height,
    // so on a wide window the drawing is letterboxed inside its own box and the
    // CSS bands are what fills the margin. This was a smooth two-stop ramp, so
    // at the edge of the drawing the sea went from a continuous gradient to
    // four flat rectangles in a visible step. Banded, they are the same water:
    // the seam falls inside a band rather than across one, and the only thing
    // that stops at the edge is the swell.
    //
    // The stops are doubled at each boundary because that is how you get a hard
    // step out of a gradient, and the fractions match the stylesheet exactly.
    + '<linearGradient id="wsea" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#1d5670"/><stop offset="0.25" stop-color="#1d5670"/>'
    + '<stop offset="0.25" stop-color="#184c63"/><stop offset="0.5" stop-color="#184c63"/>'
    + '<stop offset="0.5" stop-color="#134156"/><stop offset="0.75" stop-color="#134156"/>'
    + '<stop offset="0.75" stop-color="#0e3448"/><stop offset="1" stop-color="#0e3448"/></linearGradient>'
    // Every country is drawn as its half of the world and clipped to the coast,
    // which is what makes the border and the shoreline agree exactly.
    + `<clipPath id="wland"><path d="${GEO.pathOf(G.ring)}"/></clipPath>`
    // Softens the terrain washes. Blur bleeds past the coast; the land clip it
    // is drawn inside takes the overspill back off again.
    + '<filter id="softland" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5"/></filter>'
    + '<pattern id="wmhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width="6" height="6" fill="none"/><rect width="2" height="6" fill="#141414" fill-opacity="0.3"/></pattern>'
    + ['us', 'canada', 'mexico'].map((id) =>
      `<clipPath id="wocc-${id}"><path d="${GEO.pathOf(G.halves[id])}"/></clipPath>`).join('')
    + '</defs>');
  parts.push(`<rect x="0" y="0" width="${GEO.WORLD_W}" height="${GEO.WORLD_H}" fill="url(#wsea)"/>`);
  // The swell, run out past both edges of the frame so it reaches them rather
  // than starting and stopping a little way inside. It is clipped at the
  // viewport, which is what we want: waves to the edge of the drawing, and the
  // stylesheet's matching band beyond it.
  for (let k = 1; k <= 5; k++) {
    const yy = (GEO.WORLD_H * k / 6).toFixed(0);
    parts.push(`<path d="M-60,${yy} q 85,6 170,0 t 170,0 t 170,0" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>`);
  }

  // The land itself: sand, with a fat sand stroke straddling the coastline so the
  // outer half of it reads as beach once the countries are painted inside.
  const sand = (d) => `<path d="${d}" fill="#e2d7bc" stroke="#d8c79a" stroke-width="7" stroke-linejoin="round"/>`;
  // The isthmus first, and under everything: it is scenery, not a player, and it
  // is the only land on this map nobody can take. Drawn a shade greyer than the
  // countries and with no capital, no name and no standing — the eye should read
  // "the continent carries on" and then stop looking at it. See
  // atlas.CENTRAL_AMERICA for why it is not part of the continent proper.
  parts.push(sand(GEO.pathOf(CENTRAL_AMERICA)));
  parts.push(`<path d="${GEO.pathOf(CENTRAL_AMERICA)}" fill="#cfc7b0"/>`);
  parts.push(`<path d="${GEO.pathOf(CENTRAL_AMERICA)}" fill="none" stroke="#26506a" stroke-opacity="0.42" stroke-width="1.4" stroke-linejoin="round"/>`);
  parts.push(sand(GEO.pathOf(G.ring)));
  parts.push(sand(GEO.pathOf(G.sab)));

  parts.push('<g clip-path="url(#wland)">');
  for (const id of ['canada', 'mexico', 'us']) {
    parts.push(`<path d="${GEO.pathOf(G.halves[id])}" fill="${LAY[id].fill}"/>`);
  }
  // Ground currently held by somebody else's army: over the countries, under
  // the terrain and the names, hatched — occupation, not a redrawn border. The
  // districts, parcels and electorates underneath are untouched.
  for (const b of DEP.occupations(world, G)) {
    // Clipped to the loser's own territory. A border line runs the full width
    // of the map, so a band drawn off it unclipped spilled across the third
    // country as well — Canada cannot occupy ground inside Mexico by
    // fighting us.
    const loser = b.byUs ? b.foreign.id : 'us';
    parts.push(`<g clip-path="url(#wocc-${loser})">`);
    parts.push(`<path d="${GEO.pathOf(b.poly)}" fill="${b.byUs ? '#5b8fb0' : '#c2483c'}" fill-opacity="0.45"/>`);
    parts.push(`<path d="${GEO.pathOf(b.poly)}" fill="url(#wmhatch)"/>`);
    parts.push('</g>');
  }
  // Physical geography, laid over the political colour but well under the ink.
  //
  // Three things keep this from reading as stickers on a map. It is drawn with
  // opacity on the *group* rather than on each shape, so the overlapping blobs
  // of a range composite once instead of stacking into dark seams at every
  // join. It is blurred, because nothing in physical geography has a crisp
  // edge and a hard-edged 20% wash still reads as a decal. And the glyphs are
  // few — a map that labels every wood with three little trees is a board game.
  const T = G.terrain || {};
  const washes = [
    ['highland', T.highland, '#8a7a63', 0.17],
    ['desert', T.desert, '#dcb268', 0.36],
    ['forest', T.forest, '#3f6b3a', 0.32],
  ];
  for (const [, polys, fill, op] of washes) {
    if (!polys?.length) continue;
    parts.push(`<g opacity="${op}" filter="url(#softland)">`
      + polys.map((poly) => `<path d="${GEO.pathOf(poly)}" fill="${fill}"/>`).join('')
      + '</g>');
  }
  // Water is not a wash: a lake that reads as a smudge is worse than no lake.
  for (const poly of T.lake || []) {
    const d = GEO.pathOf(poly);
    parts.push(`<path d="${d}" fill="#2f7f9a" fill-opacity="0.9"/>`
      + `<path d="${d}" fill="none" stroke="#1c5c74" stroke-opacity="0.45" stroke-width="0.7"/>`);
  }
  // A sparse hand-drawn hint of what each wash is, not a legend.
  const GLYPH = {
    ridge: (x, y, s = 1) => {
      const w = 4 * s, h = 4 * s;
      return `<path d="M${(x - w).toFixed(1)},${(y + h / 2).toFixed(1)} l${w.toFixed(1)},${(-h).toFixed(1)} l${w.toFixed(1)},${h.toFixed(1)}"`
        + ` fill="none" stroke="#5c5240" stroke-opacity="0.62" stroke-width="${(0.95 * s).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
    },
    tree: (x, y) => `<path d="M${x.toFixed(1)},${(y + 3).toFixed(1)} l2.4,0 l-1.2,-4.6 z" fill="#2f5a2c" fill-opacity="0.55"/>`,
    dune: (x, y) => `<path d="M${(x - 5).toFixed(1)},${y.toFixed(1)} q2.5,-2 5,0 q2.5,2 5,0" fill="none" stroke="#9d7a41" stroke-opacity="0.55" stroke-width="0.8"/>`,
  };
  for (const g of T.glyphs || []) parts.push(GLYPH[g.kind]?.(g.x, g.y, g.s) || '');

  // The borders, inked only where there is land under them.
  for (const b of [G.borders.a, G.borders.b]) {
    parts.push(`<path d="${GEO.lineOf(b)}" fill="none" stroke="#2e2416" stroke-opacity="0.55" stroke-width="1.3" stroke-linejoin="round"/>`);
  }
  parts.push('</g>');
  parts.push(`<path d="${GEO.pathOf(G.sab)}" fill="${LAY.sab.fill}"/>`);
  // Islands taken off the league. It has no land frontier for a border to move
  // along, so what a cession does to the SAB is cut its archipelago in two: the
  // strait side, facing us, is ours and is drawn in our colour, with the new line
  // inked across the water it does not reach.
  if (G.sabTaken) {
    parts.push(`<defs><clipPath id="wsab"><path d="${GEO.pathOf(G.sab)}"/></clipPath></defs>`);
    parts.push(`<g clip-path="url(#wsab)"><path d="${GEO.pathOf(G.sabTaken.poly)}" fill="${LAY.us.fill}"/>`
      + `<path d="${GEO.lineOf(G.sabTaken.line)}" fill="none" stroke="#2e2416" stroke-opacity="0.55" stroke-width="1.3"/></g>`);
  }
  // A faint ink line on the shore of both landmasses.
  for (const d of [GEO.pathOf(G.ring), GEO.pathOf(G.sab)]) {
    parts.push(`<path d="${d}" fill="none" stroke="#26506a" stroke-opacity="0.42" stroke-width="1.4" stroke-linejoin="round"/>`);
  }

  // Capitals, names, standing.
  const relFor = {};
  for (const f of foreign) relFor[f.id] = relOf(f);
  // Bold sans runs about 0.6em per character — close enough to keep a name off
  // the border without measuring text we cannot measure inside a data URI.
  const fits = (text, size, width) => Math.min(size, (width * 0.92) / Math.max(1, text.length * 0.6));

  // No lift table any more.
  //
  // There was one, keyed by country, because Canada's name sat low in a wide
  // country: it covered its own capital ring and the standing underneath it —
  // "UNEASY PEACE" — crossed the border into Silver and painted its halo over
  // the line where Silver meets Mexico. Lifting that one label by four units
  // was a patch on the symptom, and it left Mexico's name crowded against
  // Silver because that is a different symptom of the same thing: labelSpot
  // used to return the widest row of the country, and the widest row of a
  // country with a straight border along one side is the row against the
  // border. It returns the point furthest from any frontier now — see
  // geo.labelSpotFrom — so there is nothing left to lift.
  // What is left of the league's islands, as a label anchor: the middle of the
  // ground west of the cut, so a partitioned SAB writes its name on the part it
  // still holds. Nothing is left to name once the whole archipelago is taken.
  //
  // Both branches used to write y = 150 and the whole-archipelago branch used a
  // hardcoded x = 41 as well, which is open Pacific eight hundred miles off Baja
  // — a country's name and its standing floating in empty sea a hundred and
  // fifty units from the island they belonged to, with nothing under them and no
  // label on the island itself. Measured off the drawing now, both ways.
  const sabSpot = () => {
    const b = GEO.bounds(G.sab);
    // On the islands, and allowed to overhang them.
    //
    // The archipelago is four times as wide as it is tall, so `fits` — which
    // scales a name to the clearance it is given — squeezes a name measured
    // against the island's own height down to about a third of what every other
    // country gets. So it is handed the width of open water it actually has
    // rather than the width of the land, which is what an atlas does with a
    // small island chain: the name runs out over the sea at both ends.
    //
    // Not below it, which was the first fix. There is now an isthmus down there
    // — see atlas.CENTRAL_AMERICA — and the name landed on Belize.
    const mid = (b.y0 + b.y1) / 2;
    if (!G.sabTaken) return { x: (b.x0 + b.x1) / 2, y: mid, w: 80, room: 12 };
    const cut = G.sabTaken.line[Math.floor(G.sabTaken.line.length / 2)][0];
    const w = cut - b.x0;
    return w < 10 ? null : { x: (b.x0 + cut) / 2, y: mid, w: Math.max(w, 44), room: 12 };
  };
  const label = (id, name, isPlayer) => {
    const L = LAY[id];
    const ring = isPlayer ? '#e8582d' : (relFor[id]?.color || '#b8892f');
    // Measured on the ground the country actually holds, so a name cannot drift
    // onto a neighbour or out to sea however the border fell. A power annexed out
    // of existence is not named at all: labelSpot falls back to the middle of the
    // frame when it is handed no land, which would leave a country's name and its
    // standing floating in open sea in the middle of somebody else's territory.
    // A neighbour's name is pushed out toward the rim, away from the ground we
    // hold — see geo.labelSpotFrom. The republic's own name is not: it belongs
    // in the middle of the republic, and there is nothing for it to be away
    // from. `sab` is across the water and never near our line either way.
    const spot = id === 'sab' ? sabSpot()
      : (G.share?.[id] ?? 1) > 0.004
        ? GEO.labelSpot(G, id, isPlayer ? {} : { away: GEO.landCentre(G, 'us') })
        : null;
    if (!spot) return;
    const sub = isPlayer ? 'YOU' : (relFor[id]?.label || '').toUpperCase();
    const nameSize = fits(name, 11, spot.w);
    const subSize = fits(sub, 7.5, spot.w);
    // The group is a capital ring, a name, and a line of standing under it —
    // about twenty-eight units tall — and it is centred on the spot rather than
    // hung off it. It used to run from five units above to twenty below, so the
    // point that had been so carefully chosen for having country in every
    // direction was the *top* of the label and everything after it drifted
    // toward the frontier. That is why Canada's standing came out on the line
    // between Silver and Mexico even after the placement was right: the
    // placement was right and the label was not sitting on it.
    //
    // Centred, and scaled to the clearance actually available, so a name in a
    // shallow country gets smaller rather than getting on somebody's border.
    const half = 14;
    const k = clamp((spot.room ?? half) / half, 0.55, 1);
    const capY = spot.y - 10 * k;
    const nameY = spot.y + 3 * k;
    const nSize = nameSize * Math.max(0.72, k);
    const sSize = subSize * Math.max(0.72, k);
    parts.push(`<circle cx="${spot.x.toFixed(1)}" cy="${capY.toFixed(1)}" r="${(2.6 * k).toFixed(1)}" fill="#241708"/><circle cx="${spot.x.toFixed(1)}" cy="${capY.toFixed(1)}" r="${(4.6 * k).toFixed(1)}" fill="none" stroke="#241708" stroke-width="0.8"/>`);
    parts.push(`<text x="${spot.x.toFixed(1)}" y="${nameY.toFixed(1)}" text-anchor="middle" font-size="${nSize.toFixed(1)}" font-weight="800" fill="#241708" stroke="${L.fill}" stroke-width="2.6" paint-order="stroke">${esc(name)}</text>`);
    parts.push(`<text x="${spot.x.toFixed(1)}" y="${(nameY + nSize + 1).toFixed(1)}" text-anchor="middle" font-size="${sSize.toFixed(1)}" font-weight="700" fill="${ring}" stroke="${L.fill}" stroke-width="2" paint-order="stroke">${sub}</text>`);
  };
  label('us', world.nation, true);
  for (const f of foreign) if (LAY[f.id]) label(f.id, f.name, false);

  // The same compass the city map carries, in the ocean off the south-west.
  parts.push(compassRose(16, GEO.WORLD_H - 16, 10));

  // `ocean` swaps the letterbox background to match this map's deeper water.
  const map = el('div', { class: 'citymap ocean' });
  map.innerHTML = `<svg viewBox="0 0 340 232" width="100%" style="display:block;max-height:520px" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;

  const bar = (label, val, max, color) => el('div', { class: 'spread', style: { margin: '3px 0' } },
    el('span', { class: 'tiny dim' }, label),
    el('div', { class: 'bar', style: { width: '92px' } }, el('i', { style: { width: clamp(val / max * 100, 0, 100) + '%', background: color } })),
    el('span', { class: 'tiny mono' }, val));

  root.append(
    el('h1', { class: 'page' }, 'The World'),
    el('p', { class: 'sub' }, `${world.nation} and its neighbours. Hostility drifts on its own — the fascist ones faster — and a treaty or war changes the board.`),
    el('div', { class: 'split' },
      el('div', { class: 'stack' }, el('div', { class: 'card' }, map)),
      el('div', { class: 'stack' }, ...foreign.map((f) => {
        const rel = relOf(f);
        return el('div', { class: 'card' },
          el('div', { class: 'spread' }, el('b', {}, f.name), el('span', { class: 'tag', style: { color: rel.color, borderColor: rel.color } }, rel.label)),
          el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } }, f.ideology),
          el('p', { class: 'small dim serif', style: { margin: '0 0 8px' } }, f.blurb),
          // A country that no longer holds any ground has no hostility to read
          // and no army to measure. It keeps its card, because it is still part
          // of the record of the Season — see acts.applyPeaceTerms.
          ...(f.absorbed ? [el('div', { class: 'small dim serif', style: { margin: '0' } },
            `Annexed entire, ${C.canonDate(world, f.absorbed)}. Only the ground now, and it is ours.`)]
            : [bar('Hostility', Math.round(f.hostility), 100, f.hostility >= 55 ? 'var(--red)' : 'var(--gold)'),
              bar('Strength', Math.round(f.strength), 200, 'var(--dim)')]),
          // Whether it is at war with you, and nothing more. The odds used to be
          // printed here — a percentage and the length of the decision window —
          // which turned a rearming neighbour into a dice roll you could read off
          // the page and plan around. The hostility bar is the tell.
          f.atWar ? el('div', { class: 'tiny red', style: { marginTop: '6px' } }, 'At war with you now.') : null,
          // The pact is a fact about the board, so it is stated; how much good
          // it is doing is not, for the same reason the odds are not printed.
          !f.atWar && pactHolds(world, f)
            ? el('div', { class: 'tiny', style: { marginTop: '6px', color: 'var(--gold-dim)' } },
              `Non-aggression pact, to ${C.canonDate(world, f.pact.ends)}.`) : null);
      }))));
};

VIEWS.press = (root) => {
  const world = w();
  const p = me();
  const mine = p ? M.outletsOf(world, p.id) : [];
  const a = S.article;
  a.outletId = a.outletId || mine[0]?.id;

  root.append(el('h1', { class: 'page' }, 'The Press'),
    el('p', { class: 'sub' }, 'Media shifts opinion by reach and credibility. A story citing the Chronicle lands harder, an uncited one costs you.'));

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      ...world.media.articles.slice(0, 14).map((art) => articleCard(art)),
      world.media.articles.length ? null : el('div', { class: 'card dim small' }, 'Nothing has been printed yet.')),

    el('div', { class: 'stack' },
      // A former head of government's memoir belongs with the rest of the press —
      // it is a thing you publish, and this is the publishing page. It shows only
      // for someone who held the chair and has since left it; memoirCard enforces
      // that gate and returns null otherwise. It used to sit on the Offices tab,
      // where a former president looking to write one never thought to find it.
      memoirCard(world, p),
      mine.length ? el('div', { class: 'card gold' }, el('h3', {}, 'Publish'),
        el('label', { class: 'field' }, el('span', {}, 'Outlet'),
          select(mine.map((o) => [o.id, `${o.name} — cred ${Math.round(o.credibility)}, reach ${pct(o.reach, 0)}`]), a.outletId, (v) => { a.outletId = v; CTX.rerender(true); })),
        el('label', { class: 'field' }, el('span', {}, 'Headline'),
          el('input', { value: a.headline || '', oninput: (e) => (a.headline = e.target.value), placeholder: 'DRUG PARK CRISIS IN THE FOURTH' })),
        el('label', { class: 'field' }, el('span', {}, 'Copy'),
          el('textarea', { rows: 3, oninput: (e) => (a.body = e.target.value) }, a.body || '')),
        el('label', { class: 'field' }, el('span', {}, 'Angle'),
          select(M.ANGLES.map((x) => [x.id, x.label + ' — ' + x.blurb]), a.angle, (v) => { a.angle = v; CTX.rerender(true); })),
        el('label', { class: 'field' }, el('span', {}, 'Target'),
          select([['office', 'An office'], ['persona', 'A person'], ['district', 'A district'], ['party', 'A party']], a.targetType, (v) => { a.targetType = v; a.targetId = null; CTX.rerender(true); })),
        el('label', { class: 'field' }, el('span', {}, 'Which'),
          select(targetOptions(a.targetType), a.targetId, (v) => { a.targetId = v; })),
        M.ANGLES.find((x) => x.id === a.angle)?.issue
          ? el('label', { class: 'field' }, el('span', {}, 'Issue'), select(M.ISSUES, a.issue || 'housing', (v) => (a.issue = v))) : null,
        el('label', { class: 'field' }, el('span', {}, 'Cite the record (optional)'),
          select([['', '— uncited —'], ...world.chronicle.slice(-40).reverse().map((e2) => [e2.id, `${e2.date} · ${e2.text.slice(0, 60)}`])], a.citedEntryId || '', (v) => { a.citedEntryId = v || null; CTX.rerender(true); })),
        a.citedEntryId ? el('div', { class: 'allowed' }, 'Cited. Impact ×1.35, and your credibility rises.')
          : el('div', { class: 'blocked' }, 'Uncited. Impact ×0.85, a one-in-three chance of costing six credibility.'),
        el('button', {
          class: 'btn primary', style: { width: '100%', marginTop: '10px' },
          onclick: () => { go('PUBLISH', { article: { ...a } }); a.headline = ''; a.body = ''; },
        }, 'Print it'))
        : null,

      el('div', { class: 'card' }, el('h3', {}, 'Your outlets'),
        ...mine.map((o) => el('div', { style: { padding: '5px 0' } },
          el('div', { class: 'spread' }, el('b', { class: 'small' }, o.name), el('span', { class: 'mono tiny' }, 'cred ' + Math.round(o.credibility))),
          el('div', { class: 'tiny dimmer' }, `reach ${pct(o.reach, 0)} · ${o.articles} articles · ${o.retractions} retraction(s)`))),
        // One press each, so once you have one there is nothing to found. The
        // engine refuses a second either way; this is so the form is not sitting
        // there inviting you to try.
        mine.length ? el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
          'One press each. To hold another you must take it by law.')
          : el('div', {},
            el('label', { class: 'field', style: { marginTop: '8px' } }, el('span', {}, 'Found a paper'),
              el('input', { id: 'newpaper', placeholder: 'e.g. The ' + bareNation(world.nation) + ' Ledger' })),
            select([['', 'National'], ...world.districts.map((d) => [d.id, d.name + ' (local: more reach, less breadth)'])], S.newPaperDistrict || '', (v) => (S.newPaperDistrict = v)),
            el('button', {
              class: 'btn', style: { width: '100%', marginTop: '8px' },
              onclick: () => {
                const n = document.getElementById('newpaper');
                go('FOUND_OUTLET', { name: n.value || 'The Daily', districtId: S.newPaperDistrict || null });
                n.value = '';
              },
            }, 'Found it')),
        R.rightBlocking(world, 'SEIZE_PRESS')
          ? el('div', { class: 'tiny green', style: { marginTop: '6px' } }, 'Protected: ' + R.rightBlocking(world, 'SEIZE_PRESS').name)
          : el('div', { class: 'tiny red', style: { marginTop: '6px' } }, 'No enumerated right protects the press here.')),

      el('div', { class: 'card' }, el('h3', {}, 'All outlets'),
        ...world.media.outlets.map((o) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, o.name, el('span', { class: 'dimmer' }, ' · ', world.personas[o.ownerPersonaId]?.name)),
          el('span', { class: 'mono tiny dimmer' }, Math.round(o.credibility))))),
    ),
  ));

  function targetOptions(kind) {
    if (kind === 'office') return world.constitution.offices.map((o) => [o.id, o.name]);
    if (kind === 'district') return world.districts.map((d) => [d.id, d.name]);
    if (kind === 'party') return PARTIES.map((p) => [p.id, p.name]);
    return rosterOptions(Object.values(world.personas).filter((x) => x.alive));
  }
};

function articleCard(art) {
  const world = w();
  const p = me();
  const outlet = world.media.outlets.find((o) => o.id === art.outletId);
  const cited = art.citedEntryId ? world.chronicle.find((e) => e.id === art.citedEntryId) : null;
  const impact = sum(art.impact || [], (r) => r.delta) / Math.max(1, (art.impact || []).length);
  return el('div', { class: 'card tight' },
    el('div', { class: 'paper' },
      el('div', { class: 'masthead' }, outlet?.name || 'Unknown'),
      el('h4', {}, art.headline),
      el('div', { class: 'byline' }, world.personas[art.authorId]?.name, ' · ', art.date),
      art.body ? el('p', {}, art.body) : null,
      el('div', { class: 'cite' }, cited ? `Cites the record: ${cited.date} — ${cited.text}` : 'Uncited.')),
    el('div', { class: 'spread', style: { marginTop: '8px' } },
      el('span', { class: 'tiny ' + (impact >= 0 ? 'green' : 'red') },
        `mean shift ${impact >= 0 ? '+' : ''}${impact.toFixed(2)} across districts`),
      el('div', { class: 'row' },
        art.suit ? el('span', { class: 'tag ' + (art.suit.win ? 'red' : '') }, art.suit.win ? 'retracted' : 'suit failed') : null,
        el('button', {
          class: 'btn sm ghost', onclick: () => ask({
            title: 'Rebut “' + art.headline + '”',
            body: 'A rebuttal halves the story’s remaining pressure.',
            label: 'Publish the rebuttal',
            input: { label: 'Your rebuttal', multiline: true, placeholder: 'The ledger page is a forgery, and the paper knows it.' },
            onConfirm: (t) => t && go('REBUT', { articleId: art.id, text: t }),
          }),
        }, 'rebut'),
        el('button', { class: 'btn sm ghost', onclick: () => go('SUE', { articleId: art.id }) }, 'sue for libel'))),
    art.rebuttals.length ? el('div', { class: 'tiny dim', style: { marginTop: '6px' } },
      ...art.rebuttals.map((r) => el('div', {}, `— ${world.personas[r.personaId]?.name}: ${r.text}`))) : null);
}

// --- Offices & elections ---------------------------------------------------

/**
 * The view out of an office-only room.
 *
 * It is decoration and it is meant to be — a private room with no weather in it
 * reads as a menu rather than a place. It sits at the foot of the room, wide, with
 * nothing written under it: you are meant to have finished the work above it and
 * be looking out, not reading a caption telling you what you are looking at.
 */
function officeWindow(world, which) {
  const box = el('div', { class: 'officewin pixscene' });
  box.innerHTML = SC.officeScene(world, which);
  return box;
}

/**
 * The Cloakroom: the chamber's own room, off the floor.
 *
 * The Assembly has a public floor and had nowhere private, which left the
 * legislature the only branch that could not talk without the press reading it —
 * the executive has the Oval Office and the bench has its chambers. Whips work in
 * cloakrooms; this is that room, open to anyone holding a seat in the chamber.
 */
// Lives in rules.js now, because a Cloakroom's chat channel has to be gated on
// exactly the same answer its tab is.
const inChamber = (world, p) => R.mayEnterCloakroom(world, p?.id);

/**
 * "House of Representatives" is the chamber's name; "House Cloakroom" is the
 * room's. A sidebar entry reading "House of Representatives Cloakroom" is four
 * words of chrome for one door, so the long form is trimmed to the short one
 * the building itself uses.
 */
const cloakLabel = (chamberName) =>
  `${String(chamberName).replace(/^(The )?House of Representatives$/i, 'House').replace(/^The /, '')} Cloakroom`;

/**
 * A cloakroom, for one chamber.
 *
 * Both tabs render through here: the room is the same room, and the only things
 * that differ are whose it is, who is standing in it, and which chat channel the
 * whispering goes into. Written once so the two cannot drift.
 */
function cloakroomView(root, which) {
  const world = w();
  const p = me();
  const L = world.constitution?.legislature || {};
  const room = which === 'upper' ? L.upperChamber : L.chamber;
  const o = R.office(world, room);
  const channel = which === 'upper' ? 'cloakroom_upper' : 'cloakroom';
  const bicameral = R.isBicameral(world);
  const upper = which === 'upper';
  const title = !bicameral ? 'The Cloakroom' : cloakLabel(o?.name || 'Chamber');

  root.append(el('div', { class: 'cloak' + (upper ? ' cloak-upper' : '') },
    el('h1', { class: 'page' }, title),
    // The two rooms say different things because they *are* different rooms. The
    // House's is a working room of four hundred-odd people on a two-year clock;
    // the Senate's is twenty people with six years in hand and a presiding
    // officer from the other branch standing in it. Same mechanic, and a player
    // who lands in the wrong one should know inside a sentence.
    el('p', { class: 'sub' }, !bicameral
      ? 'Off the record. Everyone with a seat hears it; nothing here is published or binding.'
      : upper
        ? `Off the record, at the other end of the building. The ${o?.name || 'chamber'} keeps its counsel for six years; nothing here is published or binding.`
        : `Off the record, off limits to the other chamber. Everyone with a seat in the ${o?.name || 'chamber'} hears it; nothing here is published or binding.`)));

  if (!room) { root.append(el('div', { class: 'card dim' }, 'This constitution has no such chamber.')); return; }
  if (!R.mayEnterCloakroom(world, p?.id, room)) {
    root.append(el('div', { class: 'card dim' },
      `Closed to you. It belongs to the ${o?.name || 'chamber'}.`));
    return;
  }

  // The room, at the top. Every office-gated tab opens on the place you are
  // standing in — you arrive somewhere before you start reading paperwork,
  // and a room that only appears once you have scrolled past the business is
  // a picture rather than a place.
  //
  // Each chamber gets its own window. They are at opposite ends of the Capitol
  // and they look at different cities out of it; drawing the same view twice
  // made the pair read as one room reached by two doors.
  root.append(officeWindow(world, upper ? 'balcony_upper' : 'balcony'));

  // Who is actually in here: this chamber's members, plus the presiding officer
  // where they preside. The Vice President is in the Senate's room and no other.
  const seated = world.seats.filter((s) => s.personaId && R.mayEnterCloakroom(world, s.personaId, room));
  const presiderName = (wld, rm) => {
    if (R.presidedChamber(wld) !== rm) return '';
    const st = wld.seats.find((x) => x.personaId && !R.chambers(wld).includes(x.office)
      && (R.office(wld, x.office)?.powers || []).includes('vote'));
    return st ? (R.office(wld, st.office)?.name || '') : '';
  };
  const presider = R.presidedChamber(world) === room
    ? world.seats.find((s) => s.personaId && !R.chambers(world).includes(s.office)
        && (R.office(world, s.office)?.powers || []).includes('vote'))
    : null;

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' }, chatCard(channel, bicameral
      ? `${title} — the ${o?.name || 'chamber'}${presiderName(world, room) ? ' and the ' + presiderName(world, room) : ''}`
      : undefined)),
    el('div', { class: 'card' }, el('h3', {}, upper ? 'Who is in the room' : 'Who is on the floor'),
      el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } },
        bicameral
          ? `The ${o?.name || 'chamber'}${presider ? ` and the ${R.office(world, presider.office)?.name}` : ''}, and nobody else. The other chamber has its own room and cannot read this one.`
          : 'Everyone with a voting seat reads this, whatever they said on the floor.'),
      // The right-hand column carries what actually distinguishes a member of
      // this chamber from a member of the other one. In the House that is the
      // numbered district they answer to — forty-five of them, and TX-3 is the
      // only thing separating two Texans. In the Senate every member is one
      // whole state and the interesting number is the clock: six years is long
      // enough that when a colleague next faces the voters is a fact you plan
      // around, and it is why the room is quieter than the other one.
      ...roster(seated.map((s) => world.personas[s.personaId]).filter(Boolean)).map((per) => {
        const seat = world.seats.find((s) => s.personaId === per.id && s.office === room);
        const note = !seat
          ? R.titleOf(world, per.id) || ''
          : upper
            ? `${seatCd(world, seat) || '—'}${seat.termEnds ? ' · to ' + C.canonDate(world, seat.termEnds) : ''}`
            : seatCd(world, seat) || '';
        return el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, per.name,
            per.playerId === CTX.playerId ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'you') : null),
          el('span', { class: 'tiny dimmer' }, note));
      }))));
}

VIEWS.cloakroom = (root) => cloakroomView(root, 'lower');
VIEWS.cloakroom_upper = (root) => cloakroomView(root, 'upper');

/**
 * A company about to fail, and the question of whether that is any of the
 * government's business.
 *
 * The distress window already existed and the executive had no way to see it,
 * let alone answer it — the Chronicle said an employer of four hundred had four
 * months and the treasury had no door. The card is deliberately not neutral
 * about the choice: it prints the jobs, the money, the deadline, and what the
 * country will think, and then leaves it alone. See acts.bailout.
 */
function rescueCard(world, p) {
  const failing = (world.companies || []).filter((co) => !co.closed && co.distress);
  if (!failing.length || !R.hasPower(world, p?.id, 'spend')) return null;
  return el('div', { class: 'card gold' },
    el('h3', {}, failing.length === 1 ? 'A company in trouble' : `${failing.length} companies in trouble`),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
      'Public money can keep a private business trading. The republic ranks with its creditors '
      + 'for what it puts in, and the country reads it in the Chronicle.'),
    ...failing.map((co) => {
      const staff = (co.employees || []).length;
      const left = Math.max(0, (co.distress.deadline || 0) - world.clock.tick);
      // What would actually cure it, which is both troubles at once and not
      // whichever is named on the card: a company that is short of wages *and*
      // underwater is not saved by a cheque for the wages.
      const need = Math.max(Math.round(co.unpaid || 0), Math.round(-CO.equity(world, co)), 0);
      const ask = Math.max(1e6, Math.round(need * 1.2 / 1e5) * 1e5);
      const gate = A.disburseGate(world, p?.id, ask);
      const interest = A.bailoutInterest(world, p?.id, co);
      return el('div', { style: { padding: '8px 0', borderTop: '1px solid var(--rule-strong)' } },
        el('div', { class: 'spread' }, el('b', { class: 'small' }, co.name),
          el('span', { class: 'tag red' }, co.distress.cause === 'illiquid' ? 'cannot make payroll' : 'owes more than it is worth')),
        el('div', { class: 'tiny dimmer', style: { margin: '3px 0 6px' } },
          `${staff} ${staff === 1 ? 'person' : 'people'} on the payroll · ${left} ticks left · `
          + `${moneyExact(need)} short · the country's mood moves ${bailoutMoodText(world, p?.id, co)} for it`),
        // Whose friend it is, said before the money moves rather than after. It
        // forbids nothing — see acts.bailoutInterest — but nobody should be able
        // to say afterwards that the room did not mention it.
        interest.conflicted ? el('div', { class: 'tiny', style: { margin: '0 0 6px', color: 'var(--red, #b33)' } },
          'This would not be a disinterested rescue: ' + interest.grounds.join('; ') + '.') : null,
        el('div', { class: 'row' },
          el('button', {
            class: 'btn sm', disabled: !gate.ok,
            title: gate.ok ? `Put ${moneyExact(ask)} of public money in` : gate.reasons.join(' '),
            onclick: () => go('BAILOUT', { companyId: co.id, amount: ask }),
          }, `Catch it — ${money(ask)}`),
          el('button', {
            class: 'btn sm ghost',
            title: 'Draft it as a bill and let the chamber answer for it',
            onclick: () => { S.view = 'assembly'; CTX.rerender(true); },
          }, 'Put it to the chamber')),
        !gate.ok ? el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } }, gate.reasons.join(' ')) : null);
    }));
}

/**
 * How the country's mood will move for a rescue, as a signed number.
 *
 * With the interest in it, because that is what the country will actually feel
 * — a figure here that quietly left it out would be the room lying about the
 * price of the button next to it.
 */
const bailoutMoodText = (world, personaId, co) => {
  const m = A.bailoutMood(world, co, A.bailoutInterest(world, personaId, co));
  return (m >= 0 ? '+' : '') + m.toFixed(1);
};

VIEWS.oval = (root) => {
  const world = w();
  const p = me();
  root.append(el('h1', { class: 'page' }, 'The Oval Office'),
    el('p', { class: 'sub' }, 'The executive’s private room, and who is let in.'));
  if (!canOval(world, p)) { root.append(el('div', { class: 'card dim' }, 'Closed to you.')); return; }

  // The room, at the top — see the note at VIEWS.cloakroom.
  root.append(ovalRoom(world));
  const isPrez = R.officesOf(world, p.id).some((o) => o.id === 'president');

  const acts = [];
  if (R.hasPower(world, p.id, 'emergency')) acts.push(world.emergency?.active
    ? el('button', { class: 'btn danger', onclick: () => go('EMERGENCY', { on: false }) }, 'Lift the state of emergency')
    : el('button', {
      class: 'btn danger', onclick: () => ask({
        title: 'Declare a state of emergency?', danger: true, label: 'Declare it',
        body: 'It answers a real crisis, costs approval while it runs, and lapses on its own.',
        input: { label: 'Reason (entered in the Chronicle)', presets: EMERGENCY_REASONS, multiline: true, placeholder: 'The situation in the harbour will not wait for a bill.' },
        onConfirm: (reason) => go('EMERGENCY', { on: true, reason }),
      }),
    }, 'Declare a state of emergency'));

  // The light switch is not in this column any more — it hangs on the wall beside
  // the room, in the same pixels. See ovalRoom() at the foot of this view.

  // The desk. A bill that has passed the chamber comes here to be signed, and
  // it is the one piece of business in the game with a person's name on it and
  // a clock running: until it is signed or vetoed the law does not exist.
  // It used to be answered from the Assembly tab, in the middle of the
  // chamber's own list, with a veto button on a page the chamber was reading.
  const vetoOffice = world.constitution.legislature.vetoOffice;
  const onMyDesk = vetoOffice && R.officesOf(world, p.id).some((o) => o.id === vetoOffice)
    ? world.docOrder.map((id) => world.documents[id]).filter((d) => d && d.status === 'awaiting-signature')
    : [];
  const deskCard = onMyDesk.length ? el('div', { class: 'card gold' },
    el('h3', {}, onMyDesk.length === 1 ? 'On your desk' : `On your desk — ${onMyDesk.length} bills`),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
      'Passed by the chamber and waiting on you. Neither signing nor vetoing can be undone.'),
    ...onMyDesk.map((d) => {
      const canSign = R.hasPower(world, p.id, 'promulgate');
      const canVeto = R.hasPower(world, p.id, 'veto');
      const fisc = fiscalPhrase(world, d);
      return el('div', { style: { padding: '8px 0', borderTop: '1px solid var(--rule-strong)' } },
        el('div', { class: 'spread' },
          el('b', { class: 'serif small' }, d.title),
          el('span', { class: 'tiny dimmer mono' }, d.tally ? `${d.tally.yea}–${d.tally.nay}` : '')),
        d.preamble ? el('p', { class: 'tiny dim serif', style: { margin: '3px 0 0' } }, d.preamble) : null,
        ...d.clauses.map((c, i) => el('div', { class: 'clause', 'data-n': i + 1 }, A.clauseText(world, c))),
        fisc ? el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'Fiscal effect: ', fisc.text, ' · ', R.spendClauseText(world, fisc.total)) : null,
        el('div', { class: 'row', style: { marginTop: '8px' } },
          el('button', { class: 'btn primary sm', disabled: !canSign, onclick: () => go('SIGN', { docId: d.id }) }, 'Sign into law'),
          el('button', { class: 'btn danger sm', disabled: !canVeto, onclick: () => go('VETO', { docId: d.id }) }, 'Veto'),
          el('button', {
            class: 'btn sm ghost',
            onclick: () => { S.view = 'assembly'; CTX.rerender(true); },
          }, 'Read the floor'),
          !canSign && !canVeto ? el('span', { class: 'tiny dimmer' }, 'Your office holds neither signature nor veto.') : null));
    })) : null;

  // Appointments are made here, behind the door, and reported by the Chronicle
  // once they are done. Offices shows the country who holds what; this is where
  // the choosing happens.
  const appointable = world.constitution.offices.filter((o) => o.selection === 'appointment');
  const mayAppoint = (o) => p && R.officesOf(world, p.id).some((x) => x.id === o.appointedBy) && R.hasPower(world, p.id, 'appoint');
  // Who is actually available. Yourself is off the list, and so is anyone the
  // constitution will not let hold a second office — the Vice President and the
  // bench, unless this republic has amended plurality of office in. The engine
  // refuses all of it anyway; offering a name and then refusing the click reads
  // as a bug rather than as a rule.
  const eligibleFor = (o) => Object.values(world.personas).filter((x) =>
    x.alive && !x.exiled && !x.imprisoned
    && (R.allowsPlurality(world) || x.id !== p?.id)
    && R.mayAlsoHold(world, x.id, o.id).ok);

  // Exactly what the sidebar badge counts (actionItems.oval): a seat this player
  // may appoint to, empty, with no offer already outstanding. The badge said
  // "3 cabinet seats to fill" and then the room it sent you to listed all six
  // appointive posts in one flat column with the three empty ones marked by the
  // word "vacant" in grey italics — so the number was on one screen and the
  // thing it counted was unfindable on the next. The convention already solved
  // this for the founding chairs; this is the same treatment, in the same red.
  const mustFill = (o, s, h, pending) => !!(mayAppoint(o) && o.atWill && !h && !pending);
  const openSeats = appointable.flatMap((o) => world.seats.filter((s) => s.office === o.id)
    .filter((s) => mustFill(o, s, s.personaId ? world.personas[s.personaId] : null,
      (world.nominations || []).find((n) => n.seatId === s.id))));

  const appointmentsCard = el('div', { class: 'card' + (openSeats.length ? ' cta-pulse' : '') },
    el('div', { class: 'spread' }, el('h3', {}, 'Appointments'),
      openSeats.length
        ? el('span', { class: 'cta-bubble' },
          `${openSeats.length} seat${openSeats.length === 1 ? '' : 's'} to fill`)
        : null),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
      'The cabinet and bench are filled here. A player must accept a post first.'),
    ...appointable.flatMap((o) => {
      const can = mayAppoint(o);
      return world.seats.filter((s) => s.office === o.id).map((s) => {
        const h = s.personaId ? world.personas[s.personaId] : null;
        const pending = (world.nominations || []).find((n) => n.seatId === s.id);
        const open = mustFill(o, s, h, pending);
        return el('div', { class: open ? 'seat-open' : '', style: { padding: '7px 0', borderTop: '1px solid var(--rule-strong)' } },
          el('div', { class: 'spread' },
            el('span', { class: 'small' }, el('b', {}, o.name), ' — ',
              h ? h.name : open ? el('b', { style: { color: 'var(--red-text)' } }, 'vacant')
                : el('i', { class: 'dimmer' }, 'vacant')),
            open ? el('span', { class: 'tag red' }, 'needs filling') : null,
            pending && !h ? el('span', { class: 'tag gold' }, 'awaiting acceptance') : null),
          // A nomination is not an appointment. While one is outstanding the
          // seat is neither filled nor free, and saying so is the whole point —
          // otherwise the room looks broken while someone thinks it over.
          pending && !h
            ? el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
              `${world.personas[pending.personaId]?.name || 'Your nominee'} has the offer and has not answered. The seat stays empty until they accept.`,
              can ? el('div', { style: { marginTop: '5px' } },
                el('button', { class: 'btn sm ghost', onclick: () => go('WITHDRAW_NOMINATION', { seatId: s.id }) }, 'withdraw the offer')) : null)
            : null,
          // An occupied post is filled before it is refilled: dismissal comes
          // first, so a replacement is never a single click that quietly
          // removes someone. A fixed-term seat cannot be cleared at all.
          can && !pending ? el('div', { class: 'row', style: { marginTop: '5px' } },
            // Forced, because naming a secretary has to land the moment you
            // pick the name. The periodic repaint is held while a form control
            // holds focus (app.busy → typingIn) — which is exactly the state a
            // <select> is in the instant after you choose from it — so the seat
            // stayed red, the card kept pulsing and the sidebar kept saying 3
            // until you clicked somewhere else to blur the dropdown.
            !h
              ? select([['', 'appoint…'], ...rosterOptions(eligibleFor(o))], '',
                (v) => { if (v) { go('APPOINT', { seatId: s.id, personaId: v }); CTX.rerender(true); } })
              : null,
            (o.atWill && h) ? el('button', { class: 'btn sm ghost', style: { color: 'var(--red)' }, onclick: () => go('DISMISS', { seatId: s.id }) }, 'dismiss') : null,
            (o.atWill && h) ? el('span', { class: 'tiny dimmer' }, 'dismiss before naming a successor') : null,
            (!o.atWill && h) ? el('span', { class: 'tiny dimmer' }, 'serves a fixed term — not dismissible') : null) : null);
      });
    }),
    appointable.length ? null : el('div', { class: 'tiny dimmer' }, 'This constitution fills no office by appointment.'),
    appointable.some(mayAppoint) ? null
      : el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } }, 'You do not hold the power of appointment.'));

  // Executive orders are drafted and signed here. They take effect the moment
  // they are signed — no chamber, no vote — and the Chronicle publishes them at
  // once, which is the only check on an instrument that fast.
  const mayOrder = p && R.mayPropose(world, p.id, 'order');
  const orderDrafts = world.docOrder.map((id) => world.documents[id])
    .filter((d) => d && d.type === 'order' && d.status === 'draft' && d.authorId === p?.id);
  const recentOrders = world.docOrder.map((id) => world.documents[id])
    .filter((d) => d && d.type === 'order' && d.status !== 'draft').slice(0, 6);

  const ordersCard = el('div', { class: 'card' }, el('h3', {}, 'Executive orders'),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
      'An order takes effect when you sign it, if your office holds every power its clauses need. The court may review it.'),
    mayOrder?.ok
      ? el('button', {
        class: 'btn primary', style: { width: '100%' },
        onclick: () => { S.draft = newDraft('order', true); S.modal = 'compose'; CTX.rerender(true); },
      }, 'Draft an executive order')
      : el('div', { class: 'blocked' }, mayOrder?.reason || 'Executive orders need an office with executive power.'),
    orderDrafts.length ? el('div', { style: { marginTop: '10px' } },
      el('div', { class: 'tiny dim' }, 'Unsigned drafts'),
      ...orderDrafts.map((d) => el('div', { class: 'spread', style: { padding: '4px 0' } },
        el('span', { class: 'serif small' }, d.title),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm', onclick: () => { S.draft = { ...d, lockType: true }; S.modal = 'compose'; CTX.rerender(true); } }, 'edit'),
          el('button', { class: 'btn sm primary', onclick: () => go('INTRODUCE', { docId: d.id }) }, 'sign'))))) : null,
    recentOrders.length ? el('div', { style: { marginTop: '10px' } },
      el('div', { class: 'tiny dim' }, 'Signed'),
      ...recentOrders.map((d) => el('div', { class: 'spread', style: { padding: '4px 0' } },
        el('div', {}, el('span', { class: 'serif small' }, d.title),
          el('div', { class: 'tiny dimmer' }, d.promulgatedAt || d.date)),
        statusTag(d)))) : null);

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      deskCard,
      rescueCard(world, p),
      el('div', { class: 'card' }, el('h3', {}, 'Executive actions'),
        acts.length ? el('div', { class: 'row' }, ...acts) : el('div', { class: 'tiny dimmer' }, 'You hold none of the executive powers just now.'),
        el('div', { class: 'tiny dimmer', style: { marginTop: '10px' } }, 'Treaties and war live in World. Here the executive names its people and signs orders.')),
      ordersCard,
      // The room's conversation is the point of the room, so it gets the wide
      // column. Appointments are a list you visit occasionally — they sit on
      // the right with the door, rather than pushing the chat below the fold.
      chatCard('oval')),
    el('div', { class: 'stack' },
      appointmentsCard,
      el('div', { class: 'card' }, el('h3', {}, 'Who may enter'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } }, 'The President and cabinet are always admitted; others by invitation.'),
        ...R.OVAL_KEY_OFFICES.flatMap((oid) => R.holders(world, oid).map((h) =>
          el('div', { class: 'spread small', style: { padding: '3px 0' } },
            el('span', {}, h.name, ' — ', R.office(world, oid)?.name), el('span', { class: 'tag gold' }, 'cabinet')))),
        ...R.ovalGuests(world).map((g) => ({ g, h: world.personas[g.id] })).filter((x) => x.h)
          .map(({ g, h }) => inviteRow(world, 'oval', g, h, isPrez)),
        isPrez ? el('label', { class: 'field', style: { marginTop: '8px' } }, el('span', {}, 'Invite someone'),
          select([['', 'choose…'], ...rosterOptions(Object.values(world.personas)
            .filter((x) => x.alive && !x.exiled && !R.ovalByOffice(world, x.id)
              && !R.ovalGuests(world).some((g) => g.id === x.id)))], '',
          (v) => v && go('INVITE_OVAL', { personaId: v }))) : null,
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          `An offer lapses in ${R.INVITE_ANSWER_MONTHS} month unanswered; accepted, the room is open ${R.OVAL_INVITE_MONTHS} months. The Vice President also holds a key by office.`))),
  ));

  // The survey. Cosmetic — nothing in the simulation reads the drawing — but it
  // is the picture of the country everyone has been looking at all Season, so
  // it is the President's to order and rationed to once every two canon years.
  //
  // Five offices hold a key to this room and only one of them may commission it.
  // The Vice President is in here by right and has no business redrawing the
  // country; so the card says who it belongs to rather than offering a button
  // the engine will refuse.
  {
    const last = world.mapRedrawnAt;
    const wait = ACT.MAP_REDRAW_YEARS * world.clock.ticksPerYear;
    const left = last == null ? 0 : Math.max(0, wait - (world.clock.tick - last));
    const mayOrder = R.hasPower(world, p.id, 'spend');
    root.append(el('div', { class: 'card' },
      el('h3', {}, 'The national survey'),
      el('p', { class: 'small dim serif', style: { margin: '0 0 8px' } },
        'Coast, border and interior come from one survey. Order it again: same name, same history, new shape.'),
      el('div', { class: 'row' },
        mayOrder
          ? el('button', {
            class: 'btn' + (left ? ' ghost' : ''),
            title: left ? `Last ordered ${C.canonDate(world, last)}.` : 'Redraw the coast, border and terrain.',
            onclick: () => go('REDRAW_MAP', {}),
          }, 'Order the survey redrawn')
          : el('span', { class: 'tiny dimmer' }, 'The survey is the President’s to commission.'),
        mayOrder && left
          ? el('span', { class: 'tiny dimmer' }, `Again in ${C.canonSpan(world, left)}.`)
          : mayOrder
            ? el('span', { class: 'tiny dimmer' }, `Once every ${ACT.MAP_REDRAW_YEARS} years.`)
            : null)));
  }

};

/**
 * The room, and the switch on the wall next to it.
 *
 * The switch is only worth offering once the light is doing something — in high
 * summer there is nothing to turn off — but once it is offered it sits against
 * the frame, so pressing it and seeing the room change is one glance and not
 * two. It is shared, so the room goes dark for everybody admitted to it.
 */
function ovalRoom(world) {
  const lightsOn = world.ovalLights !== false;
  const row = el('div', { class: 'roomrow' }, officeWindow(world, 'oval'));
  if (SC.palette(world).dim > 0.25 || !lightsOn) {
    const sw = el('button', {
      class: 'pxswitch',
      title: lightsOn ? 'Work by the windows' : 'Put the lights back on',
      'aria-label': lightsOn ? 'Turn off the lights' : 'Turn the lights on',
      onclick: () => go('OVAL_LIGHTS', { on: !lightsOn }),
    });
    sw.innerHTML = SC.lightSwitch(world, lightsOn);
    row.append(sw);
  }
  return row;
}

// --- The Vice President's Mansion ------------------------------------------
// The one room in the republic with no business in it. Every other private room
// exists so that something can be done out of sight — a light switched, a case
// heard, a vote whipped — and each of them is a page of controls with a view
// attached. This is a view with a guest list attached, and nothing else.
//
// That is deliberate. The vice presidency is an office with almost no powers, so
// the room that comes with it is a room and not an instrument: somewhere to sit
// with whoever you have asked up, and be seen to have asked them.

/**
 * The Department of State: the room where a war is prevented, or is not.
 *
 * Everything here moves one number — the hostility of a foreign power — and the
 * three ways of moving it are deliberately not ranked. Reassurance is free and
 * slight. Pressing them costs goodwill and buys the only plain-language reading
 * of another country's intentions the game offers. Terms cost real money and
 * work. Which of those is correct depends on what you are trying to do, which
 * is the whole of foreign policy.
 */
/**
 * What the hostility bar buys, in the terms the player cares about.
 *
 * Hostility has always decided whether a power signs a treaty — see
 * depts.weighAssent — but the consequence was invisible, so a Secretary spending
 * a year of audiences bringing Canada from 62 to 48 had no way to know what
 * they had bought. Both treaties, because the two are different asks and the
 * difference is the interesting part: a power will often promise not to attack
 * you long before it will promise to fight for you.
 *
 * A qualitative lean, not a percentage. A department reads a power's willingness
 * from across the table; it does not quote you a number, and a precise figure on
 * the page turned diplomacy into a slot machine the player pulled until it paid.
 * The word tracks the same odds the colour does — see depts.weighAssent — so the
 * signal is still there to read, only without the false precision.
 */
function treatyOdds(world, f) {
  if (f.atWar) return null;
  const ask = (kind) => DEP.weighAssent(world, { clauses: [{ kind, party: f.id }] });
  const na = ask('TREATY_NONAGGRESSION');
  if (na.ok === false) {
    return el('div', { class: 'tiny', style: { color: 'var(--red)', marginTop: '2px' } }, na.reason);
  }
  const def = ask('TREATY_DEFENSE');
  const lean = (r) => (r.chance >= 0.75 ? 'likely' : r.chance >= 0.35 ? 'uncertain' : 'unlikely');
  const tone = (r) => (r.chance >= 0.75 ? 'var(--green-text)' : r.chance >= 0.35 ? 'var(--gold)' : 'var(--red)');
  return el('div', { class: 'tiny', style: { marginTop: '2px' } },
    el('span', { class: 'dim' }, 'Would sign · '),
    el('span', { style: { color: tone(na) } }, 'non-aggression ', lean(na)),
    el('span', { class: 'dimmer' }, ' · '),
    el('span', { style: { color: tone(def) } }, 'mutual defence ', lean(def)),
    (na.reasons || []).length
      ? el('div', { class: 'dimmer' }, (na.reasons || []).join(', '))
      : null);
}

/**
 * The head of state going in person.
 *
 * It sits under the ambassador's row because it is the same three pieces of
 * business through a different door, and the player should be able to see the
 * choice: wait for the delegation the department can summon once a year, or
 * spend a week of the President's own time and go now. Only the chair sees it,
 * because only the chair can do it.
 */
function summitRow(world, p, f) {
  if (!p) return null;
  const may = DEP.maySummon(world, p.id, f.id);
  const head = R.headOffice(world);
  // Not the chair: no row at all, rather than a button that explains itself.
  if (!head || !R.officesOf(world, p.id).some((o) => o.id === head.id)) return null;
  const weeks = R.summitTicks(world);
  if (may.ok === false) {
    return el('div', { class: 'tiny dimmer', style: { marginTop: '5px' } }, may.reason);
  }
  return el('div', { style: { marginTop: '5px' } },
    el('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } },
      ...Object.entries(DEP.APPROACHES).map(([k, a]) => el('button', {
        class: 'btn sm ghost',
        title: `Go to ${f.name} yourself and ${a.label.toLowerCase()}. ${a.blurb}`
          + (a.cost ? ` Costs ${money(a.cost)}.` : ''),
        onclick: () => go('SUMMIT', { foreignId: f.id, kind: k }),
      }, '✈ ', a.label.replace(/ them$/, ''), a.cost ? el('span', { class: 'dimmer' }, ' · ' + money(a.cost)) : null))),
    el('div', { class: 'tiny dimmer' },
      `Go yourself, no waiting on their delegation. Costs a week abroad, `
      + `${C.canonSpan(world, weeks)} with none of your office’s powers. Once a year.`));
}

VIEWS.state = (root) => {
  const world = w();
  const p = me();
  root.append(el('h1', { class: 'page' }, 'The Department of State'),
    el('p', { class: 'sub' }, 'Where the republic talks to powers it would rather not fight.'));
  if (!R.mayEnterDept(world, p?.id, 'state')) {
    root.append(el('div', { class: 'card dim' }, 'Not open to you.'));
    return;
  }

  // The room, at the top — see the note at VIEWS.cloakroom.
  root.append(officeWindow(world, 'state'));

  const envoys = DEP.envoys(world);
  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      ...(world.foreign || []).map((f) => {
        const e = envoys[f.id];
        const here = DEP.audienceOpen(world, e);
        const left = DEP.recallLeft(world, e);
        return el('div', { class: 'card' },
          el('div', { class: 'spread' }, el('b', {}, f.name),
            el('span', { class: 'tag' + (f.atWar ? ' red' : '') },
              f.atWar ? 'at war' : here ? 'in the building' : 'not received')),
          el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } }, e.name, ' · ', f.ideology),
          // The hostility bar is the tell, exactly as on the World tab.
          el('div', { class: 'spread', style: { margin: '3px 0' } },
            el('span', { class: 'tiny dim' }, 'Hostility'),
            el('div', { class: 'bar', style: { width: '92px' } },
              el('i', { style: { width: clamp(f.hostility, 0, 100) + '%', background: f.hostility >= 55 ? 'var(--red)' : 'var(--gold)' } })),
            el('span', { class: 'tiny mono' }, Math.round(f.hostility))),
          // What that bar is actually worth, said as the thing the player wants
          // it for. The hostility number has always decided whether a treaty is
          // signed; nothing on the page ever said so, so moving it was an act
          // of faith. This is the room whose entire job is moving it.
          treatyOdds(world, f),
          e.said ? el('p', { class: 'small serif', style: { margin: '8px 0 0' } }, e.said) : null,
          here
            ? el('div', {},
              el('div', { class: 'row', style: { marginTop: '8px' } },
                ...Object.entries(DEP.APPROACHES).map(([k, a]) => el('button', {
                  class: 'btn sm' + (e.spoke ? ' ghost' : ''),
                  title: a.blurb + (a.cost ? ` · ${money(a.cost)}` : ''),
                  onclick: () => go('ENVOY_TALK', { foreignId: f.id, kind: k }),
                }, a.label, a.cost ? el('span', { class: 'dimmer' }, ' · ' + money(a.cost)) : null))),
              el('div', { class: 'row', style: { marginTop: '6px' } },
                el('button', { class: 'btn sm ghost', onclick: () => go('DISMISS_ENVOY', { foreignId: f.id }) }, 'Show them out'),
                el('span', { class: 'tiny dimmer' }, e.spoke ? 'That audience is spent.' : 'One piece of business per audience.')))
            : el('div', {},
              el('div', { class: 'row', style: { marginTop: '8px' } },
                el('button', {
                  class: 'btn sm' + (f.atWar || left > 0 ? ' ghost' : ''),
                  onclick: () => go('RECEIVE_ENVOY', { foreignId: f.id }),
                }, 'Ask them in'),
                left > 0 ? el('span', { class: 'tiny dimmer' }, `Will not return for ${C.canonSpan(world, left)}.`) : null),
              summitRow(world, p, f)));
      })),
    el('div', { class: 'stack' },
      chatCard('state'),
      el('div', { class: 'card' }, el('h3', {}, 'The department'),
        ...deptRoster(world, 'state')))));
};

/**
 * The Department of Defense: the room where a war is won before it starts.
 *
 * Three levers, and all three are things you do *in peacetime*. Raising
 * divisions costs money you would rather spend elsewhere; putting them on a
 * border means taking them off another; drawing a plan takes staff time and
 * then goes stale. A war fought by a country that did none of it is fought at
 * six-tenths — see depts.effectiveness — which is the argument for the room.
 */
/**
 * The Department of the Treasury — the only place the books exist.
 *
 * There was a public Treasury tab once, sitting in the sidebar for anybody to
 * read. That made the chamber's power to demand the accounts meaningless: it
 * was voting itself a copy of something already pinned to the wall. The tab is
 * this room now. The Secretary and the President see the live ledger and the
 * disbursement controls; the chamber, having passed a resolution carrying
 * DEMAND_ACCOUNTS, sees a dated copy of the same page and nothing it can touch;
 * everyone else sees a closed door.
 */
VIEWS.exchequer = (root) => {
  const world = w();
  const p = me();
  const open = world.accountsOpenUntil != null && world.clock.tick < world.accountsOpenUntil;
  const byOffice = R.mayEnterDept(world, p?.id, 'exchequer');
  const byResolution = open && inChamber(world, p);
  S.spend = S.spend || { amount: 0, raw: '', purpose: '' };
  root.append(el('h1', { class: 'page' }, 'The Department of the Treasury'),
    el('p', { class: 'sub' }, byOffice
      ? 'The books as they stand. The interface won’t disburse what the constitution forbids.'
      : 'The books, as they stood when the chamber asked.'));
  if (!byOffice && !byResolution) {
    root.append(el('div', { class: 'card dim' },
      'Not open to you. The chamber may vote itself a copy of the accounts by resolution.'));
    return;
  }

  // The room, at the top — see the note at VIEWS.cloakroom.
  root.append(officeWindow(world, 'exchequer'));

  const a = accountsSource(world, byOffice);
  const live = a.live;
  // A copy says so at the top, before a single figure. Nobody should quote a
  // number off this page in debate without knowing how old it is.
  if (!live) {
    root.append(el('div', { class: 'blocked', style: { marginBottom: '12px' } },
      `A copy of the accounts, laid before the chamber on ${C.canonDate(world, a.at)}, true only for that day. `
      + `The chamber keeps it until ${C.canonDate(world, world.accountsOpenUntil)}; anything newer takes another resolution.`));
  }

  const years = a.spendYr > 0 ? a.treasury / a.spendYr : 0;
  const row = (k, v, cls) => el('div', { class: 'spread', style: { padding: '4px 0' } },
    el('span', { class: 'small dim' }, k), el('span', { class: 'mono ' + (cls || '') }, v));

  root.append(el('div', { class: 'grid g3', style: { marginBottom: '14px' } },
    bigStat('Treasury', moneyExact(a.treasury), a.treasury >= 0 ? '' : 'red', (a.history || []).map((h) => h.treasury), null, { center: 0 }),
    bigStat('Revenue / yr', money(a.revenueYr), 'green', []),
    bigStat('Expenses / yr', money(a.spendYr), 'red', [])));

  root.append(el('div', { class: 'grid g2' },
    el('div', { class: 'card' }, el('h3', {}, 'The vault'),
      row('In the treasury', moneyExact(a.treasury), a.treasury > 0 ? 'green' : 'red'),
      row('Revenue, annual', money(a.revenueYr)),
      row('Spending, annual', money(a.spendYr)),
      row('Balance', (a.revenueYr - a.spendYr >= 0 ? '+' : '') + money(a.revenueYr - a.spendYr),
        a.revenueYr - a.spendYr >= 0 ? 'green' : 'red'),
      row('Cover', `${years.toFixed(2)} years`, years >= 2 ? 'green' : years < 0.5 ? 'red' : ''),
      row('Credit rating', Math.round(a.credit || 0)),
      live ? row('Cost of borrowing', `${(interestRate(world) * 100).toFixed(1)}%`) : null,
      a.debt > 0 ? row('Debt', moneyExact(a.debt), 'red') : null,
      el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
        'Cover is the approval chart’s Treasury: years of spending in reserve.')),
    el('div', { class: 'card' }, el('h3', {}, 'Standing commitments'),
      (a.programs || []).length
        ? el('div', {}, ...(a.programs || []).map((pr) => row(pr.name, money(pr.cost) + '/yr')))
        : el('div', { class: 'dim small' }, 'No recurring programs. Everything spent is spent once.'),
      el('div', { class: 'rule' }),
      row('Discretion used', money(a.discretion.used)),
      row('Discretion left', money(a.discretion.remaining)),
      el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
        open
          ? `The chamber holds a copy of these accounts until ${C.canonDate(world, world.accountsOpenUntil)}.`
          : 'The chamber may demand these accounts by resolution.'))));

  // The money side. The debt and the money market sit together above the
  // ordinary business of the department, because between them they set the
  // price of everything below: what the state pays to borrow is what the
  // interest line costs, and what the bank does with the rate is what the
  // output gap does to prices and to how many people are working.
  root.append(el('div', { class: 'grid g2', style: { marginTop: '12px' } },
    debtCard(world, a, live),
    monetaryCard(world, live)));

  root.append(el('div', { class: 'split', style: { marginTop: '12px' } },
    el('div', { class: 'stack' },
      outputCard(world, a, live),
      moneyFlowCard(a),
      taxCodeCard(world, p, a),
      live ? underConstructionCard(world) : null),
    el('div', { class: 'stack' },
      live ? disburseCard() : null,
      thresholdsCard(world, live),
      creditCard(a),
      el('div', { class: 'card' }, el('h3', {}, 'The department'),
        ...deptRoster(world, 'exchequer'),
        byResolution && !byOffice
          ? el('div', { class: 'blocked', style: { marginTop: '8px' } },
            'A copy on the chamber\'s resolution, not the building itself.')
          : null),
      // No chat in the Treasury. The Secretary who answers the President is
      // in the Oval Office; the department is a room to read the books in, not
      // a room to talk shop in. If the chamber wants a word with the Secretary
      // it is a summons on the floor.
    )));

};

/**
 * The private sector, from the Offices tab: what you can be instead.
 *
 * Deliberately on this page rather than tucked into a menu. Offices is where a
 * player goes to find out what there is to hold, and until now the honest
 * answer for somebody who had lost an election was "nothing, wait four years".
 */
/**
 * Money of your own, and the politics you can do with it.
 *
 * Political money used to be a company's alone: a founder who sold up had the
 * proceeds in his pocket and no channel to spend them through, and someone who
 * had never founded anything had none at all. The pots and the caps are the same
 * ones the company gives into — see company.purseOf — so a personal cheque is
 * exactly as public, and exactly as capped, as a corporate one.
 */
function ownMoneyCard(world, p) {
  const wallet = Math.max(0, Math.round(p?.wallet || 0));
  if (!p || wallet < 1e6) return null;
  const give = Math.min(5e6, wallet);
  return el('div', { class: 'card', style: { marginBottom: '14px' } },
    el('h3', {}, 'Money of your own'),
    el('p', { class: 'small dim serif', style: { margin: '0 0 8px' } },
      `You have ${moneyExact(wallet)} that is yours, not any company's. `
      + 'It gives to a party as a company\'s does, to the same $100M ceiling and public record. '
      + 'A campaign takes it from the ballot, while an election is open.'),
    el('div', { class: 'row' },
      ...PARTIES.map((party) => el('button', {
        class: 'btn sm ghost',
        onclick: () => go('DONATE_PARTY', { party: party.id, amount: give, from: 'wallet' }),
      }, `${party.name} · ${money(give)}`,
      el('span', { class: 'dimmer' }, ' · ' + (CO.partyInfluence(world, party.id) * 100).toFixed(1) + '%')))));
}

function privateSectorCard(world, p) {
  if (!p) return null;
  const co = CO.companyOf(world, p.id);
  if (co) {
    const stage = CO.stageOf(co.valuation || 0);
    return el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('div', { class: 'spread' }, el('b', {}, co.name),
        el('span', { class: 'tag gold' }, co.founderId === p.id ? 'yours' : 'you work here')),
      el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
        `${stage.title} · worth ${moneyExact(CO.valuation(world, co))}`,
        co.public ? ' · listed' : ''),
      el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn sm primary', onclick: () => { S.view = 'company'; CTX.rerender(true); } },
          'Go to ' + stage.tab.toLowerCase())));
  }
  // Hidden from anybody holding an office. A sitting member with a company is
  // not a founder with a conflict of interest, they are the conflict of
  // interest — and the game already has lobbying, which is the version of that
  // arrangement it wants to be about.
  if (R.officesOf(world, p.id).length) {
    return el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('h3', {}, 'The private sector'),
      el('p', { class: 'small dim serif', style: { margin: '0 0 4px' } },
        'Closed to you while you hold an office of this republic. Leave the chair and it opens; '
        + 'until then, money reaches you across a table.'));
  }
  S.newco = S.newco || '';
  S.newcoSector = S.newcoSector || CO.SECTORS[0].id;
  return el('div', { class: 'card', style: { marginBottom: '14px' } },
    el('h3', {}, 'The private sector'),
    el('p', { class: 'small dim serif', style: { margin: '0 0 8px' } },
      'Another way to have your way here, needing nobody’s vote: '
      + 'a quarter of a million of your own money, a basement, and whatever the government’s economy lets you keep.'),
    // "On top of the quarter-million" is what this said, and it has not been
    // true since founding-and-selling stopped being a living: `found` takes the
    // *greater* of the seed and the wallet, because adding them minted money —
    // W' = 225,000 + 0.9W, converging on $2.25M in twenty clicks with no tick
    // passing. The card should say what the engine does.
    (p.wallet || 0) > 0 ? el('div', { class: 'tiny green', style: { margin: '0 0 8px' } },
      `You have ${moneyExact(p.wallet)} put by. The next one is founded on that or the quarter-million, whichever is more.`) : null,
    // A failure follows the person, not the company. It is on the public record
    // and the people who lend money have read it — see company.creditMarked.
    (p.bankruptcies || 0) > 0 ? el('div', { class: 'tiny red', style: { margin: '0 0 8px' } },
      `You have put ${p.bankruptcies === 1 ? 'a company' : `${p.bankruptcies} companies`} into liquidation owing ${moneyExact(p.writtenOff || 0)}. `
      + (CO.creditMarked(world, p.id)
        ? 'While that is fresh, anybody lending to the next one lends half what they would.'
        : 'It is old enough that lenders have stopped counting it against you.')) : null,
    el('div', { class: 'row' },
      el('input', {
        placeholder: 'What it will be called', style: { flex: 1 },
        oninput: (ev) => { S.newco = ev.target.value; },
      })),
    // The line of business, chosen once and for good. This is the decision that
    // makes it your company rather than a savings account: it fixes which of
    // the government's numbers is the one you watch, and no two of them want
    // the same budget.
    el('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, 'What it will do'),
    el('div', { class: 'stack', style: { gap: '4px' } },
      ...CO.SECTORS.map((s) => el('button', {
        class: 'btn sm' + (S.newcoSector === s.id ? '' : ' ghost'),
        style: { textAlign: 'left', width: '100%' },
        onclick: () => { S.newcoSector = s.id; CTX.rerender(true); },
      },
      el('b', {}, s.name), el('span', { class: 'dimmer' }, ' — ', s.blurb),
      el('div', { class: 'tiny dimmer' }, 'Watch: ', s.watch)))),
    el('button', {
      class: 'btn primary', style: { width: '100%', marginTop: '10px' },
      onclick: () => { if (S.newco.trim()) go('FOUND_COMPANY', { name: S.newco, sector: S.newcoSector }); },
    }, 'Found it'),
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      'Your worth is earnings times one over the real rate of interest; '
      + 'the tax code owns your margin, the output gap your growth. You will start reading Treasury.'));
}

/**
 * The memoir, from the Offices tab.
 *
 * The last move available to somebody with no office left, and the only one
 * that reaches back into what the histories already say — so it belongs beside
 * the private sector on the page a player goes to when they have lost.
 *
 * The one thing this card has to do honestly is show the ceiling. A chapter is
 * a tenth of a press article and twelve is the most anybody will read, so the
 * whole book is worth a little over one article — and the point of the feature
 * is that the player can *feel* that before they write it, rather than publish
 * expecting their legacy rewritten and find a paragraph moved. So the price is
 * printed on the tin, in articles, and it moves as they drag the length.
 */
function memoirCard(world, p) {
  if (!p || !p.alive) return null;
  // Written after office, by somebody who held the chair, once.
  if (!R.heldHeadOffice(world, p.id)) return null;
  const mine = (world.memoirs || []).find((m) => m.authorId === p.id);
  if (mine) {
    return el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('div', { class: 'spread' }, el('b', {}, '“' + mine.title + '”'),
        el('span', { class: 'tag gold' }, mine.chapters + (mine.chapters === 1 ? ' chapter' : ' chapters'))),
      el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
        `Published ${mine.date}. The article about you was revised after.`),
      el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn sm ghost', onclick: () => { S.view = 'chronicle'; CTX.rerender(true); } },
          'Read what it says now')));
  }
  if (R.officesOf(world, p.id).length) return null;   // not from the chair

  S.memoir = S.memoir || '';
  S.memoirChapters = S.memoirChapters || 6;
  const n = clamp(Math.round(S.memoirChapters), M.MEMOIR_MIN_CHAPTERS, M.MEMOIR_MAX_CHAPTERS);

  // The length, and what it buys, on one row. Deliberately *not* a rerender on
  // drag: the whole point of the row is that you pull it and watch the price
  // move, and rebuilding the page under the thumb drops the drag.
  const priced = (k) => `worth about ${(k * M.MEMOIR_WEIGHT).toFixed(1)} of one press article`
    + (k === M.MEMOIR_MAX_CHAPTERS ? ' — as far as it goes' : '');
  function lengthRow(start) {
    const val = el('span', { class: 'val mono' }, String(start));
    const price = el('div', { class: 'tiny dimmer', style: { marginTop: '2px' } }, priced(start));
    return el('div', { style: { margin: '12px 0 0' } },
      el('div', { class: 'meter' },
        el('span', { class: 'lab' }, 'Chapters'),
        el('input', {
          type: 'range', min: M.MEMOIR_MIN_CHAPTERS, max: M.MEMOIR_MAX_CHAPTERS, step: 1, value: start,
          oninput: (ev) => {
            S.memoirChapters = +ev.target.value;
            val.textContent = String(S.memoirChapters);
            price.textContent = priced(S.memoirChapters);
          },
        }),
        val),
      price);
  }

  return el('div', { class: 'card', style: { marginBottom: '14px' } },
    el('h3', {}, 'Your own account of it'),
    el('p', { class: 'small dim serif', style: { margin: '0 0 8px' } },
      'The histories have decided what your tenure was worth. One thing is left: '
      + 'write the version where you were right.'),
    el('div', { class: 'row' },
      el('input', {
        // Bound, not just written to: the page rerenders as the republic ticks,
        // and an unbound box loses what has been typed into it.
        placeholder: 'What the book is called', style: { flex: 1 }, maxlength: 60, value: S.memoir,
        oninput: (ev) => { S.memoir = ev.target.value; },
      })),
    lengthRow(n),
    el('button', {
      class: 'btn primary', style: { width: '100%', marginTop: '10px' },
      // S.memoirChapters, not the `n` captured at render: the slider moves
      // without a rerender, so the closure's copy is a tick behind the thumb.
      onclick: () => { if (S.memoir.trim()) go('MEMOIR', { title: S.memoir, chapters: S.memoirChapters }); },
    }, 'Publish it'),
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      'A chapter carries a tenth of a newspaper’s — a book about yourself is the least credible '
      + 'account there is. Its virtue is reach: every chapter lands the '
      + 'same day in every district, and nobody answers back. Write one and the article '
      + 'about you is rewritten.'));
}

/**
 * A card on the founder's desk.
 *
 * Deliberately the crisis card's shape, down to the clock in the corner. It is
 * the same lesson from the other side of the table: something has arrived, the
 * answers all cost you, and not answering is an answer with a worse price.
 */
function companyCard(world, co) {
  const ev = CO.openEvent(co);
  if (!ev) return null;
  const left = ev.deadline - world.clock.tick;
  return el('div', { class: 'crisis', style: { marginBottom: '12px' } },
    el('div', { class: 'spread' }, el('h4', {}, ev.title),
      el('span', { class: 'tag red mono' }, left > 0 ? left + ' ticks to answer' : 'expiring')),
    el('p', { class: 'serif', style: { margin: '0 0 10px' } }, ev.text),
    el('div', { class: 'row' }, ...ev.options.map((o) => {
      const afford = !o.cost || (co.cash || 0) >= o.cost;
      return el('button', {
        class: 'btn' + (afford ? '' : ' ghost'),
        title: afford ? '' : `The company holds ${moneyExact(co.cash || 0)}.`,
        onclick: () => go('COMPANY_ANSWER', { uid: ev.uid, option: o.i }),
      }, o.label, o.cost ? el('span', { class: afford ? 'dimmer' : 'red' }, ' · ' + money(o.cost)) : null);
    })),
    el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      'Left alone it settles itself, and not in your favour.'));
}

/**
 * The company is in trouble, and there is a clock on it.
 *
 * The old failure was a silent counter: cash read zero for four and a half
 * months and then the company closed, with nothing anywhere on the page saying
 * that anything was wrong. This is the same shape as every other thing in this
 * game that will not wait — the crisis card, the company card, the bill on the
 * floor — and it says which of the two failures this is, because they are cured
 * by different moves. Wages that cannot be met need cash from anywhere; a
 * company that owes more than it is worth cannot repay its way out, because
 * cash and debt come off together and the difference does not move.
 */
function distressCard(world, co) {
  if (!co.distress) return null;
  const left = co.distress.deadline - world.clock.tick;
  const eq = CO.equity(world, co);
  const illiquid = co.distress.cause === 'illiquid';
  return el('div', { class: 'crisis', style: { marginBottom: '12px' } },
    el('div', { class: 'spread' },
      el('h4', {}, illiquid ? 'It cannot make payroll' : 'It owes more than it is worth'),
      el('span', { class: 'tag red mono' }, left > 0 ? left + ' ticks to fix it' : 'winding up')),
    el('p', { class: 'serif', style: { margin: '0 0 10px' } },
      illiquid
        ? `${moneyExact(co.unpaid || 0)} of wages went unpaid this tick and there is nothing left to borrow against. `
          + 'Cash from anywhere fixes it: your own money, a building sold, a smaller payroll, harvesting the margin.'
        : `${co.name} owes ${moneyExact(co.borrowed || 0)} against a business worth ${moneyExact(Math.max(0, CO.enterprise(world, co) + (co.cash || 0)))}. `
          + 'Repaying will not help: cash and debt come off together and the gap does not move. Outside money, a sold '
          + 'asset or a better business will.'),
    el('div', { class: 'spread small' },
      el('span', { class: 'dim' }, illiquid ? 'Short by' : 'Underwater by'),
      el('span', { class: 'mono red' }, moneyExact(illiquid ? (co.unpaid || 0) : -eq))),
    el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      `Still like this in ${Math.max(0, left)} ticks and it is wound up: assets broken up, lenders `
      + 'paid first, and whatever is left — if anything — is yours.'));
}

/**
 * Somebody wants to buy it.
 *
 * The card that gives a failing company its third ending. Two of them were
 * already here — sell it yourself at the haircut, or watch the clock in the card
 * above this one run out — and neither is somebody else deciding the business is
 * worth having. This one is, and the price is the same price anybody else's
 * company would be bought at, so it is not a mercy.
 *
 * It states what the founder actually walks away with and what the buyer is
 * taking on, because the difference between those two is the whole reason a
 * company that owes more than it is worth sells for nothing.
 */
function bidCard(world, co) {
  const bid = CO.openBid(co);
  if (!bid) return null;
  const left = bid.deadline - world.clock.tick;
  const buyer = (world.companies || []).find((c) => c.id === bid.buyerId);
  const founder = world.personas?.[buyer?.founderId];
  return el('div', { class: 'crisis', style: { marginBottom: '12px' } },
    el('div', { class: 'spread' }, el('h4', {}, `${bid.buyerName} wants to buy ${co.name}`),
      el('span', { class: 'tag red mono' }, left > 0 ? left + ' ticks to answer' : 'expiring')),
    el('p', { class: 'serif', style: { margin: '0 0 10px' } },
      `${founder ? founder.name + ' has' : 'They have'} offered ${moneyExact(bid.toSeller)} for the whole of it`
      + `${bid.debt ? `, and will take on the ${moneyExact(bid.debt)} it owes` : ''}. `
      + `The ${bid.staff} ${bid.staff === 1 ? 'person' : 'people'} in the building `
      + `${bid.staff === 1 ? 'keeps their job' : 'keep their jobs'}; the buildings, the order book and `
      + 'anything the treasury put in go with them. '
      + (bid.trouble
        ? 'They bid what winding it up would fetch, which is what the alternative pays.'
        : 'They bid what it is worth as a going concern.')),
    el('div', { class: 'spread small' },
      el('span', { class: 'dim' }, 'To you, after the creditors'),
      el('span', { class: 'mono' }, moneyExact(bid.toSeller))),
    el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', { class: 'btn', onclick: () => go('COMPANY_ANSWER_BID', { uid: bid.uid, accept: true }) },
        'Sell it', el('span', { class: 'dimmer' }, ' · ' + money(bid.toSeller))),
      el('button', { class: 'btn ghost', onclick: () => go('COMPANY_ANSWER_BID', { uid: bid.uid, accept: false }) },
        'It is not for sale')),
    el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      bid.trouble
        ? 'Saying no does not stop the clock above. Saying nothing is saying no.'
        : 'Saying nothing is saying no, and the offer will not come again soon.'));
}

/**
 * The company.
 *
 * The other career, and the room it is run out of. Everything on this page is
 * downstream of a number the government sets: the multiple your earnings trade
 * at is one over the real rate of interest, so the central bank owns your
 * valuation; the tax code owns your margin; the output gap owns your growth.
 * The page says so at each figure rather than in a paragraph at the top,
 * because the moment worth having is a founder watching their own net worth
 * move when the Treasury raises rates.
 */
VIEWS.company = (root) => {
  const world = w();
  const p = me();
  const co = CO.companyOf(world, p?.id);
  if (!co) { root.append(el('div', { class: 'card dim' }, 'You have no company.')); return; }
  const isFounder = co.founderId === p?.id;
  const stage = CO.stageOf(co.valuation || 0);
  const next = CO.nextStage(co.valuation || 0);
  const val = CO.valuation(world, co);
  const eps = CO.earnings(world, co);

  const sector = CO.sectorOf(co);
  const stance = CO.stanceOf(co);
  root.append(el('h1', { class: 'page' }, co.name),
    el('p', { class: 'sub' }, sector.name, ' — ', sector.short, '. ', stage.blurb));

  // Whatever has arrived goes above everything, including the room. A card with
  // a clock on it is the one thing on this page that will not wait — and a
  // company being wound up in four months outranks a card about a big order.
  const trouble = distressCard(world, co);
  if (trouble) root.append(trouble);
  if (isFounder) { const offer = bidCard(world, co); if (offer) root.append(offer); }
  if (isFounder) { const card = companyCard(world, co); if (card) root.append(card); }

  // The room, unlike the departments — you are looking at what the company has
  // bought itself, and that is the readout the page is about.
  root.append(officeWindow(world, 'co_' + stage.id));

  const row = (k, v, cls, hint) => el('div', { class: 'spread', style: { padding: '4px 0' } },
    el('span', { class: 'small dim', title: hint || '' }, k), el('span', { class: 'mono ' + (cls || '') }, v));

  root.append(el('div', { class: 'grid g3', style: { margin: '12px 0' } },
    bigStat('Valuation', moneyExact(val), val > 0 ? '' : 'red', (co.history || []).map((h) => h.v), null, { center: 0 }),
    bigStat('Revenue / yr', money(co.revenue || 0), 'green', []),
    bigStat('Cash', moneyExact(co.cash || 0), (co.cash || 0) > 0 ? '' : 'red', [])));

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      el('div', { class: 'card' }, el('h3', {}, 'The books'),
        row('Revenue, annual', money(co.revenue || 0)),
        row('Margin', ((co.margin ?? CO.MARGIN) * 100).toFixed(0) + '%'),
        row('Gross profit', money((co.revenue || 0) * (co.margin ?? CO.MARGIN))),
        row('Payroll', '−' + money(CO.wageBill(world, co)), CO.wageBill(world, co) ? 'red' : ''),
        (co.borrowed || 0)
          ? row('Interest', '−' + money((co.borrowed || 0) * (world.economy.marketRate ?? 0.04)), 'red')
          : null,
        // `earnings` is already net of payroll, interest and tax — the figure
        // below is the whole answer, not a subtotal to take something else off.
        row('Earnings, after tax', money(eps), eps >= 0 ? 'green' : 'red',
          'After wages, interest and the state. Profits are taxed as income — the Treasury\'s tax card is your rate.'),
        el('div', { class: 'rule' }),
        row('Borrowed', moneyExact(co.borrowed || 0), (co.borrowed || 0) ? 'red' : ''),
        // What the stake is actually worth, shown only when the answer is
        // "less than nothing". The Valuation stat above is floored at zero —
        // rightly, since it is a price — so without this line an insolvent
        // company reads as merely worthless rather than underwater, and the
        // difference is the whole of whether it is about to be wound up.
        CO.equity(world, co) < 0
          ? row('Underwater by', moneyExact(-CO.equity(world, co)), 'red',
            'What it owes, less everything it is and holds. Repaying does not move it — cash and debt fall together.')
          : null,
        row('At', ((world.economy.marketRate ?? 0) * 100).toFixed(2) + '%', '',
          'The rate the state borrows at. When the bank moves, your interest bill moves with it.'),
        row('Earnings multiple', '×' + CO.multiple(world).toFixed(1), '',
          'One over the real rate of interest, floored — monetary policy landing on your worth.'),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          next
            ? `${money(next.at - val)} of valuation from ${next.tab.toLowerCase()}.`
            : 'There is no larger building.')),

      // How it is being run. One lever, three settings, and the right setting
      // depends on what the government is doing — which keeps changing, which
      // is the whole reason it is a lever and not a founding choice.
      isFounder ? el('div', { class: 'card' }, el('h3', {}, 'How you are running it'),
        el('div', { class: 'stack', style: { gap: '4px' } },
          ...Object.values(CO.STANCES).map((s) => el('button', {
            class: 'btn sm' + (stance.id === s.id ? '' : ' ghost'),
            style: { textAlign: 'left', width: '100%' },
            onclick: () => go('COMPANY_STANCE', { stance: s.id }),
          },
          el('b', {}, s.label),
          el('span', { class: 'dimmer' }, '  ',
            (s.margin >= 0 ? '+' : '') + Math.round(s.margin * 100), ' pts margin · ',
            Math.round((s.ceiling - 1) * 100) >= 0 ? '+' : '', Math.round((s.ceiling - 1) * 100), '% capacity'),
          el('div', { class: 'tiny dimmer' }, s.blurb)))),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'Growth comes out of the margin: you pay for capacity you do not yet need. '
          + 'Harvesting buys it back by building nothing.')) : null,

      // What this particular business lives on. Not decoration: it is the line
      // that tells a founder which tab to open when they want to know why the
      // quarter went the way it did.
      el('div', { class: 'card' }, el('h3', {}, 'What moves you'),
        el('div', { class: 'spread', style: { padding: '4px 0' } },
          el('span', { class: 'small dim' }, sector.name),
          el('span', { class: 'mono' }, '×' + sector.demand(world).toFixed(2))),
        el('div', { class: 'tiny dimmer' }, 'Watch: ', sector.watch, '.'),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'This multiplies what the business could sell before anything else counts. '
          + 'Another line reads the opposite number off the same budget.')),

      // The politics of it. Available once there is money to do it with.
      isFounder ? lobbyCard(world, co) : null,
      // Political money past the chamber floor: a party's war chest here; a
      // candidate's campaign from the ballot when an election is open.
      isFounder ? el('div', { class: 'card' }, el('h3', {}, 'Political money'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
          'Give a party up to $100M, for as much as a per cent at the polls — or bankroll a candidate while an election is open. On the record, like lobbying.'),
        el('div', { class: 'row' },
          ...PARTIES.map((party) => el('button', {
            class: 'btn sm ghost', disabled: (co.cash || 0) < 5e6,
            onclick: () => go('DONATE_PARTY', { party: party.id, amount: 5e6 }),
          }, `${party.name} · $5M`,
          el('span', { class: 'dimmer' }, ' · ' + (CO.partyInfluence(world, party.id) * 100).toFixed(1) + '%')))),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'A per cent is the ceiling for a party or a campaign — but your own, bootstrapped, has none.')) : null,
      isFounder ? rivalsCard(world, co) : null),

    el('div', { class: 'stack' },
      isFounder ? el('div', { class: 'card gold' }, el('h3', {}, 'Raise money'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
          'Debt is fast, and compounds at whatever the central bank has set. '
          + 'A listing is slow, needs scale, and sells a quarter of the company for good.'),
        el('div', { class: 'row' },
          ...[250000, 1e6, 5e6].map((amt) => el('button', {
            class: 'btn sm', onclick: () => go('COMPANY_BORROW', { amount: amt }),
          }, 'Borrow ' + money(amt))),
          (co.borrowed || 0) ? el('button', {
            class: 'btn sm ghost', onclick: () => go('COMPANY_BORROW', { amount: co.borrowed, repay: true }),
          }, 'Repay all') : null),
        // Your own money, which until now could only be spent on founding the
        // *next* company — so a founder watching this one drown with a million
        // in their pocket had no way to reach for it. It is also the only cure
        // for negative equity that does not require the business to get better.
        (p.wallet || 0) > 0 ? el('div', { style: { marginTop: '10px' } },
          el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } },
            `You have ${moneyExact(p.wallet)} of your own. Money you put in is the company's; you get it back only as it is worth more.`),
          el('div', { class: 'row' },
            ...[0.25, 0.5, 1].map((frac) => el('button', {
              class: 'btn sm ghost',
              onclick: () => go('COMPANY_INJECT', { amount: Math.round((p.wallet || 0) * frac) }),
            }, frac === 1 ? 'Put all of it in' : `Put in ${moneyExact(Math.round((p.wallet || 0) * frac))}`)))) : null,
        el('div', { style: { marginTop: '10px' } },
          co.public
            ? el('div', {},
              el('div', { class: 'allowed' },
                `Listed. ${num(co.shares)} shares at ${moneyExact(CO.sharePrice(world, co))} — `
                + `you hold ${num(co.founderShares)} (${Math.round((co.founderShares / co.shares) * 100)}%), worth ${moneyExact(CO.sharePrice(world, co) * co.founderShares)}.`),
              (isFounder && co.founderShares > 0) ? el('div', { class: 'row', style: { marginTop: '8px' } },
                ...[0.1, 0.25].map((frac) => el('button', {
                  class: 'btn sm ghost',
                  onclick: () => go('SELL_SHARES', { shares: Math.round(co.founderShares * frac) }),
                }, `Sell ${Math.round(frac * 100)}%`, el('span', { class: 'dimmer' }, ' · ' + moneyExact(Math.round(CO.sharePrice(world, co) * co.founderShares * frac)))))) : null,
              (isFounder && co.founderShares > 0) ? el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
                'Selling shares is money into your own account, not the company\'s; it dilutes your holding without losing control.') : null)
            : el('div', {},
              el('button', {
                class: 'btn primary', style: { width: '100%' },
                disabled: val < CO.IPO_MINIMUM,
                onclick: () => ask({
                  title: `Take ${co.name} public?`,
                  body: 'A quarter of the company is sold to the public and the money lands on the balance sheet. '
                    + 'It cannot be undone, and from then on your worth is a number other people set every second.',
                  label: 'List it',
                  onConfirm: () => go('COMPANY_IPO', {}),
                }),
              }, val < CO.IPO_MINIMUM
                ? `Listing needs ${money(CO.IPO_MINIMUM)}`
                : 'Go public'),
              el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
                `Worth ${moneyExact(val)} today.`)))) : null,

      // Sell up and walk away. The whole business, not a slice — this is the
      // exit an IPO is not. Only the founder, and the net is the market price
      // less the haircut for selling in a hurry.
      isFounder ? el('div', { class: 'card' }, el('h3', {}, 'Sell the company'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
          'The whole of it, to a buyer, for good. You keep the proceeds — '
          + 'and are free to start another, or stand for an office you could not hold while you ran this.'),
        // A sale is not a way out of a debt: the buyer takes the company with
        // what it owes inside it, which is why nobody buys one that owes more
        // than it is worth. See company.sell.
        CO.equity(world, co) < 0
          ? el('div', { class: 'dim small' },
            `Nobody buys it while it is ${moneyExact(-CO.equity(world, co))} underwater — a buyer would pay `
            + 'for the privilege of taking on the debts. Trade out, put your own money in, or let it go under.')
          : el('button', {
            class: 'btn primary', style: { width: '100%' },
            onclick: () => ask({
              title: `Sell ${co.name}?`,
              body: `Worth ${moneyExact(val)} today. A quick sale takes ${Math.round(CO.SALE_HAIRCUT * 100)}% off, `
                + `so you would walk away with about ${moneyExact(Math.round(val * (1 - CO.SALE_HAIRCUT)))}. It cannot be undone.`,
              label: 'Sell it',
              onConfirm: () => go('SELL_COMPANY', {}),
            }),
          }, `Sell for about ${moneyExact(Math.round(val * (1 - CO.SALE_HAIRCUT)))}`)) : null,

      el('div', { class: 'card' }, el('h3', {}, 'The payroll'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } },
          'Everyone here can walk in. Nobody holding an office of the republic can be on it.'),
        el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', { class: 'dim' }, `Buildings — ${(co.employees || []).length}/${CO.capacityOf(co)} desks filled`
            + (CO.managersOf(co) ? `, ${CO.managersOf(co)} manager${CO.managersOf(co) === 1 ? '' : 's'} at 4× wage` : '')),
          el('span', { class: 'mono' }, String(co.buildings || 1))),
        el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, world.personas[co.founderId]?.name, ' — founder'),
          el('span', { class: 'tag gold' }, 'owner')),
        ...(co.employees || []).map((id) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, world.personas[id]?.name || '—'),
          isFounder ? el('button', { class: 'btn sm ghost', onclick: () => go('COMPANY_FIRE', { personaId: id }) }, 'let go') : null)),
        // Two ways to hire, and the first one is the one you will use. The
        // republic's persona list is its political cast; the district has
        // twenty-four thousand other people in it, and at the founding every
        // named persona already holds a seat.
        isFounder ? el('div', { style: { marginTop: '10px' } },
          el('button', {
            class: 'btn primary', style: { width: '100%' },
            disabled: (co.cash || 0) < CO.wageOf(co),
            onclick: () => go('COMPANY_HIRE', {}),
          }, (co.cash || 0) < CO.wageOf(co) ? 'No cash for a salary' : 'Take somebody on'),
          ((free) => free.length
            ? el('label', { class: 'field', style: { marginTop: '8px' } },
              el('span', {}, 'Or somebody in particular'),
              select([['', 'choose…'], ...rosterOptions(free)], '',
                (v) => v && go('COMPANY_HIRE', { personaId: v })))
            : null)(Object.values(world.personas).filter((x) => x.alive && !x.exiled && !x.imprisoned
              && !x.synthetic && x.id !== co.founderId && !(co.employees || []).includes(x.id)
              && !R.officesOf(world, x.id).length))) : null,
        isFounder ? el('div', { class: 'row', style: { marginTop: '8px' } },
          el('button', {
            class: 'btn ghost', style: { flex: 1 },
            disabled: (co.cash || 0) < CO.BUILDING_COST,
            onclick: () => go('COMPANY_BUY_BUILDING', {}),
          }, `Buy a building · ${money(CO.BUILDING_COST)} — room for 20 more, and a manager`),
          // And out again. Shrinking to survive is the move a company in
          // trouble has, and it costs: a building sold against the clock
          // fetches rather less than it cost, and the desks go with it.
          (co.buildings || 1) > 1 ? el('button', {
            class: 'btn ghost', style: { flex: 1 },
            onclick: () => ask({
              title: 'Sell a building?',
              body: `It fetches ${money(Math.round(CO.BUILDING_COST * CO.BREAKUP_BUILDING))}, less than the ${money(CO.BUILDING_COST)} it cost — `
                + `and the room goes with it. ${Math.max(0, (co.employees || []).length - (CO.capacityOf(co) - CO.BUILDING_CAP))} of the people here would be let go.`,
              label: 'Sell it',
              onConfirm: () => go('COMPANY_SELL_BUILDING', {}),
            }),
          }, `Sell one · ${money(Math.round(CO.BUILDING_COST * CO.BREAKUP_BUILDING))}`) : null) : null,
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          `${money(CO.wageOf(co))} a head, a year${co.wagePremium ? ` — ${Math.round(co.wagePremium * 100)}% over the going rate, which is what settling with the floor cost you` : ""}. Every hire raises the ceiling on what the business can earn.`),
        // What the payroll does to the country, stated in people.
        //
        // It has always been exactly one for one — see world.recomputeEconomy —
        // and it has always been invisible: forty hires out of a labour force
        // of eleven thousand move the headline by a third of a point, which is
        // a rounding error on a figure printed to one decimal. The founder had
        // no way to see that the private sector was inside the country's
        // numbers rather than beside them, which is the one thing company.js
        // exists to be.
        ((n) => n ? el('div', { class: 'tiny', style: { marginTop: '4px', color: 'var(--green-text)' } },
          `${n} ${n === 1 ? 'person is' : 'people are'} on this payroll — `
          + `${n} fewer out of work in ${world.districts.find((d) => d.id === co.district)?.name || world.nation}, `
          + 'one for one.') : null)((co.employees || []).length)),

      chatCard('floor'))));
};

/**
 * Lobbying, and the reason it is not hidden.
 *
 * A company with money can put it behind a member's vote on a measure actually
 * before the chamber. It buys a lean, never the vote — a member who thinks the
 * bill is a disaster still votes against it — and every penny of it is minuted
 * in the Chronicle, written onto the member's file, and readable by the court.
 * A game where money moves votes quietly is a game about cynicism. This one is
 * about what a republic does once it can see the money moving.
 */
/**
 * The other companies in the country, and what it would cost to own one.
 *
 * A failing business used to have exactly one ending — wound up, everyone home,
 * the buildings sold against the clock — because nobody in the game could buy
 * anything. The price here is what the alternative pays out: break-up value for
 * a company in trouble, the going-concern valuation for one that is not, less
 * the debt, which the buyer takes on. See company.acquire.
 */
function rivalsCard(world, co) {
  const others = (world.companies || []).filter((c) => !c.closed && c.id !== co.id);
  if (!others.length) return null;
  return el('div', { class: 'card' }, el('h3', {}, 'The other companies'),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
      'What it would cost to own one. The debt comes with it, and so do the people.'),
    ...others.map((t) => {
      const price = CO.acquisitionPrice(world, t);
      const staff = (t.employees || []).length;
      const theirs = !!world.personas[t.founderId]?.playerId;
      const pending = CO.openBid(t);
      const can = (co.cash || 0) >= price.toSeller && !pending;
      return el('div', { style: { padding: '7px 0', borderTop: '1px solid var(--rule-strong)' } },
        el('div', { class: 'spread' }, el('b', { class: 'small' }, t.name),
          t.distress ? el('span', { class: 'tag red' }, 'in trouble') : el('span', { class: 'tag' }, CO.stageOf(t.valuation || 0).title)),
        el('div', { class: 'tiny dimmer', style: { margin: '3px 0 6px' } },
          `${staff} on the payroll · ${moneyExact(price.gross)} of business · ${moneyExact(price.debt)} owed`),
        // A player's company cannot be taken, so the same money is offered
        // instead and they answer it. See actions.COMPANY_ACQUIRE.
        el('button', {
          class: 'btn sm', disabled: !can,
          title: pending ? `${pending.buyerName} has an offer on the table already`
            : can ? (theirs ? `Offer ${moneyExact(price.toSeller)}; it is theirs to refuse`
              : `Pay ${moneyExact(price.toSeller)} and take on ${moneyExact(price.debt)} of debt`)
              : `You hold ${moneyExact(co.cash || 0)}; the owners want ${moneyExact(price.toSeller)}`,
          onclick: () => go('COMPANY_ACQUIRE', { companyId: t.id }),
        }, theirs ? `Make an offer — ${money(price.toSeller)}`
          : price.toSeller > 0 ? `Buy it — ${money(price.toSeller)}` : 'Take it off their hands'),
        theirs ? el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
          'Somebody\'s own company. It can be bid for, not bought over their head.') : null);
    }));
}

function lobbyCard(world, co) {
  const floor = world.docOrder.map((id) => world.documents[id]).filter((d) => d && d.status === 'floor');
  // Both chambers are worth buying. A measure that has cleared the House is in
  // front of the Senate, and a lobby list that only knew about the first room
  // would go blank at exactly the moment the money mattered most.
  const rooms = R.chambers(world);
  const members = world.seats.filter((s) => rooms.includes(s.office) && s.personaId)
    .map((s) => world.personas[s.personaId]).filter(Boolean);
  S.lobby = S.lobby || { doc: '', who: '', amount: '' };

  return el('div', { class: 'card' }, el('h3', {}, 'Lobbying'),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
      'Money buys a thumb on the scale and nothing more — and it is minuted in the Chronicle, '
      + 'written onto the member\'s file, and admissible against both of you.'),
    !floor.length
      ? el('div', { class: 'dim small' }, 'Nothing before the chamber to lobby about.')
      : el('div', {},
        el('label', { class: 'field' }, el('span', {}, 'The measure'),
          select([['', 'choose…'], ...floor.map((d) => [d.id, d.title])], S.lobby.doc,
            (v) => { S.lobby.doc = v; })),
        el('label', { class: 'field' }, el('span', {}, 'The member'),
          select([['', 'choose…'], ...members.map((m) => [m.id, `${m.name} — ${money(CO.lobbyCost(world, m.id))} and up`])],
            S.lobby.who, (v) => { S.lobby.who = v; })),
        el('label', { class: 'field' }, el('span', {}, 'How much'),
          el('input', {
            type: 'text', inputmode: 'decimal', placeholder: '250k  ·  1m',
            oninput: (ev) => { S.lobby.amount = ev.target.value; },
          })),
        el('button', {
          class: 'btn primary', style: { width: '100%' },
          onclick: () => {
            const amt = parseAmount(S.lobby.amount);
            if (!S.lobby.doc || !S.lobby.who || !Number.isFinite(amt)) return;
            go('COMPANY_LOBBY', { docId: S.lobby.doc, personaId: S.lobby.who, amount: amt });
          },
        }, 'Pay it'),
        (co.lobbySpend || 0)
          ? el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
            `${moneyExact(co.lobbySpend)} spent this way so far, all of it in the record.`)
          : null));
}

/**
 * Raising an army the executive cannot pay for on its own say-so.
 *
 * A division is $6M, well past any discretionary threshold, so "Raise 1" used to
 * dispatch MOBILIZE, be refused by the spending gate, and leave the player with
 * an error and no idea what to do about it. The constitutional answer was always
 * a bill — so press the button and you get the bill: drafted, laid on the floor,
 * and the chamber opened in front of you, the way the crisis card's "refer to the
 * chamber" already works. Under the threshold it is still an order, not a debate.
 */
function raiseDivisions(world, n) {
  const cost = n * DEP.DIVISION_COST;
  const rule = R.spendRule(world, cost);
  const needsVote = !!rule.requires && !(world.emergency && world.emergency.active);
  if (!needsVote) return go('MOBILIZE', { count: n });
  go('CREATE_DOC', {
    introduce: true,
    doc: {
      type: 'bill',
      title: `An Act to raise ${n} division${n === 1 ? '' : 's'}`,
      preamble: `The defence of ${world.nation} requiring more of the army than the executive may `
        + `fund of its own authority, this chamber is asked to raise ${n} division${n === 1 ? '' : 's'} `
        + `at ${money(cost)}.`,
      clauses: [{ kind: 'RAISE_DIVISIONS', count: n }],
    },
  });
  // Where the bill now is. Sending the player after it is the whole point of
  // the button — the paperwork is done, the argument is not.
  S.view = 'assembly';
  CTX.rerender(true);
}

VIEWS.defense = (root) => {
  const world = w();
  const p = me();
  root.append(el('h1', { class: 'page' }, 'The Department of Defense'),
    el('p', { class: 'sub' }, 'Below ground, lit by its own screens.'));
  if (!R.mayEnterDept(world, p?.id, 'defense')) {
    root.append(el('div', { class: 'card dim' }, 'Not open to you.'));
    return;
  }
  root.append(officeWindow(world, 'defense'));

  const m = world.military;
  const reserve = DEP.inReserve(world);
  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      ...(world.foreign || []).map((f) => {
        const plan = DEP.planFor(world, f.id);
        const eff = DEP.effectiveness(world, f.id);
        const on = DEP.committedTo(world, f.id);
        return el('div', { class: 'card' },
          el('div', { class: 'spread' }, el('b', {}, f.name),
            el('span', { class: 'tag mono' + (f.atWar ? ' red' : '') },
              f.atWar ? 'at war' : `strength ${Math.round(f.strength)}`)),
          el('div', { class: 'spread small', style: { marginTop: '6px' } },
            el('span', { class: 'dim' }, 'Divisions on this border'),
            el('span', { class: 'row' },
              el('button', { class: 'btn sm ghost', onclick: () => go('DEPLOY', { foreignId: f.id, count: Math.max(0, on - 1) }) }, '−'),
              el('span', { class: 'mono' }, String(on)),
              el('button', { class: 'btn sm ghost', onclick: () => go('DEPLOY', { foreignId: f.id, count: on + 1 }) }, '+'))),
          // The cost of leaving them there, stated where the decision is made.
          // Massing divisions is the strongest thing this room can do to a war
          // it might have to fight, and the strongest thing it can do *to* the
          // chance of having to fight one. The player should be able to read
          // both off the same card. See depts.borderMenace.
          (!f.atWar && on > 0) ? el('div', { class: 'tiny', style: { marginTop: '4px', color: 'var(--gold)' } },
            `${f.name} reads ${on} division${on === 1 ? '' : 's'} on its frontier as a threat`
            + `${f.allied ? ' — muted, as an ally' : ''}: hostility climbs `
            + `${(DEP.borderMenace(world, f.id) * (world.clock.ticksPerYear || 240)).toFixed(1)} a year while they stay.`) : null,
          // A beaten power waiting on terms. The window is the leverage, so it
          // says how long is left — see acts.dictateTerms.
          ((d) => d ? el('div', { class: 'card gold', style: { marginTop: '6px', padding: '8px' } },
            el('div', { class: 'small' }, el('b', {}, d.total ? `${f.name} capitulates without terms` : `${f.name} awaits terms`)),
            el('div', { class: 'tiny dimmer', style: { margin: '2px 0 6px' } },
              `${Math.max(0, d.until - world.clock.tick)} ticks to dictate a settlement, or the guns simply stop.`
              + (d.total ? ' There is no government left to argue: as much of it as you care to hold, up to all of it.' : '')),
            el('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } },
              ...(d.total ? [[A.territoryLeft(world, f), 0], [A.territoryLeft(world, f), 1e7], [30, 1e7]]
                : [[10, 0], [0, 1e7], [10, 1e7]]).map(([cede, indemnity]) => el('button', {
                class: 'btn sm',
                onclick: () => go('DICTATE_TERMS', { foreignId: f.id, cede, indemnity }),
              }, cede >= 100 && indemnity ? `Annex it, and ${money(indemnity)}`
                : cede >= 100 ? 'Annex the whole country'
                  : cede && indemnity ? `${cede}% and ${money(indemnity)}`
                    : cede ? `Take ${cede}% of their land` : `Demand ${money(indemnity)}`))),
            // The third answer. Refusing a surrender is a decision with a price
            // on it, so the price is on the button — see acts.pressOn.
            d.total ? null : el('div', { style: { marginTop: '6px' } },
              el('button', {
                class: 'btn sm danger',
                onclick: () => go('PRESS_ON', { foreignId: f.id }),
              }, 'Refuse, and press on'),
              el('div', { class: 'tiny dimmer', style: { marginTop: '3px' } },
                `No terms: the front gives back ${A.PRESS_SETBACK}, they rally and mobilise, the pacts go home, `
                + 'and the war ends only when one army is spent outright. Win it and the whole country is on the table.'))) : null)(
            (world.dictate || []).find((x) => x.foreignId === f.id)),
          // Volunteers only go to a war, so the row only exists during one.
          // Committed here they fight at full weight instead of being thinned
          // across every border — see depts.sendVolunteers.
          (f.atWar && (m.volunteers || 0) > 0) ? ((vAt) => el('div', { class: 'spread small', style: { marginTop: '4px' } },
            el('span', { class: 'dim' }, 'Volunteers at this front'),
            el('span', { class: 'row' },
              el('button', {
                class: 'btn sm ghost',
                onclick: () => go('SEND_VOLUNTEERS', { foreignId: f.id, count: Math.max(0, vAt - 1) }),
              }, '−'),
              el('span', { class: 'mono' }, String(vAt)),
              el('button', {
                class: 'btn sm ghost',
                title: `${DEP.volunteersHome(world)} still at home. At the front they fight at full weight, and fall first.`,
                onclick: () => go('SEND_VOLUNTEERS', { foreignId: f.id, count: vAt + 1 }),
              }, '+'))))(DEP.volunteersAt(world, f.id)) : null,
          // What the enemy's own army is doing, once you are fighting them.
          f.atWar ? el('div', { class: 'small', style: { marginTop: '6px' } },
            el('span', { class: 'dim' }, 'Their army — '),
            el('span', { class: 'mono' }, `${DEP.enemyDivisions(f)} divisions`),
            el('span', { class: 'tiny dimmer' }, `, ${DEP.enemyDisposition(world, DEP.liveWar(world, f.id))}`),
            // What they are worth in the line is not what they number: a country
            // that hates you fights harder than its headcount, and the war has
            // always counted it that way without telling anybody.
            Math.round(DEP.enemyWeight(f)) > DEP.enemyDivisions(f)
              ? el('div', { class: 'tiny', style: { color: 'var(--red-text)' } },
                `They fight like ${Math.round(DEP.enemyWeight(f))} — that is what the front is decided on.`) : null) : null,
          (f.atWar && DEP.liveWar(world, f.id)?.landing)
            ? el('div', { class: 'tiny green', style: { marginTop: '4px' } },
              `${world.foreign.find((x) => x.id === DEP.liveWar(world, f.id).landing.ally)?.name || 'An ally'} `
              + `has a force ashore in their territory — ${Math.round(DEP.landingRamp(world, DEP.liveWar(world, f.id)) * 100)}% established.`)
            : null,
          el('div', { class: 'small', style: { marginTop: '6px' } },
            plan
              ? plan.ready
                ? el('span', {}, `${DEP.POSTURES[plan.posture]?.label} plan on file — `,
                  el('span', { class: 'mono' }, Math.round(plan.strength * 100) + '%'),
                  el('span', { class: 'tiny dimmer' }, ' of its value left'))
                : el('span', { class: 'dim' }, 'The staff are still drawing it.')
              : el('span', { class: 'dim' }, 'No plan against this power.')),
          el('div', { class: 'row', style: { marginTop: '6px' } },
            ...Object.entries(DEP.POSTURES).map(([k, po]) => el('button', {
              class: 'btn sm' + (plan?.posture === k ? '' : ' ghost'), title: po.blurb,
              onclick: () => go('DRAFT_PLAN', { foreignId: f.id, posture: k }),
            }, po.label))),
          // Bombing runs, when there is an air force and a war to fly them into;
          // and an allied landing, when a war is on, none is ashore yet, and an
          // overseas ally is free to send one.
          (f.atWar && ((m.airforce || 0) > 0 || (!DEP.liveWar(world, f.id)?.landing
            && (world.foreign || []).some((a2) => a2.allied && !a2.atWar && a2.id !== f.id))))
            ? el('div', { class: 'row', style: { marginTop: '6px' } },
              (m.airforce || 0) > 0 ? el('button', {
                class: 'btn sm red ghost', title: 'Fly the wings at their cities — wears down their will to fight, and their army.',
                onclick: () => go('BOMB', { foreignId: f.id }),
              }, `Bomb ${f.name}'s cities`) : null,
              (!DEP.liveWar(world, f.id)?.landing && (world.foreign || []).some((a2) => a2.allied && !a2.atWar && a2.id !== f.id))
                ? el('button', {
                  class: 'btn sm ghost', title: 'An overseas ally puts a force ashore behind their line — weak at first, stronger as it digs in.',
                  onclick: () => go('LAND_ALLIES', { foreignId: f.id }),
                }, 'Land an allied force') : null) : null,
          el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
            `Fought at ${Math.round(eff.factor * 100)}% — ${Math.round(eff.share * 100)}% of the army is here${eff.plan ? ', plan +' + Math.round(eff.plan * 100) : ''}.`));
      })),
    el('div', { class: 'stack' },
      el('div', { class: 'card' }, el('h3', {}, 'The army'),
        el('div', { class: 'spread small' }, el('span', { class: 'dim' }, 'Divisions'), el('span', { class: 'mono' }, String(m.units))),
        el('div', { class: 'spread small' }, el('span', { class: 'dim' }, 'In reserve'), el('span', { class: 'mono' }, String(reserve))),
        // Paid for and not yet in the field. Without this the treasury emptied
        // and nothing appeared, which reads as a bug rather than as training.
        DEP.formingCount(world)
          ? el('div', { class: 'spread small' }, el('span', { class: 'dim' }, 'Mustering'),
            el('span', { class: 'mono gold' }, String(DEP.formingCount(world))))
          : null,
        el('div', { class: 'spread small' }, el('span', { class: 'dim' }, 'Volunteers'), el('span', { class: 'mono' }, String(m.volunteers || 0))),
        el('div', { class: 'spread small' }, el('span', { class: 'dim' }, 'Air wings'), el('span', { class: 'mono' }, String(m.airforce || 0))),
        el('div', { class: 'spread small' }, el('span', { class: 'dim' }, 'War exhaustion'), el('span', { class: 'mono' }, Math.round((m.exhaustion || 0) * 100) + '%')),
        // Theirs, beside ours. The enemy has always worn down at the same rate
        // we do — sim.tickWar accrues it on the war, and it is what decides
        // whether they sue for terms or capitulate outright — but it was never
        // shown anywhere, so from the player's side a losing enemy looked
        // tireless and surrender arrived out of nowhere. It is the single most
        // useful number in a war and it was the one number not on the page.
        ...(m.wars || []).filter(DEP.stillFighting).map((x) => {
          const foe = (world.foreign || []).find((ff) => ff.id === x.foreign);
          const pctv = Math.round((x.exhaustion || 0) * 100);
          return el('div', { class: 'spread small' },
            el('span', { class: 'dim' }, `${foe?.name || 'The enemy'} exhaustion`),
            el('span', { class: 'mono' + (pctv >= 90 ? ' green' : '') },
              pctv + '%' + (pctv >= 90 ? ' — near breaking' : '')));
        }),
        el('div', { class: 'row', style: { marginTop: '8px' } },
          ...[1, 3].map((n) => el('button', {
            class: 'btn sm',
            title: `${money(n * DEP.DIVISION_COST)}. Past what the executive may spend alone, `
              + 'this drafts the bill and lays it before the chamber.',
            onclick: () => raiseDivisions(world, n),
          }, `Raise ${n}`, el('span', { class: 'dimmer' }, ' · ' + money(n * DEP.DIVISION_COST))))),
        el('div', { class: 'row', style: { marginTop: '6px' } },
          ...[1, 5].map((n) => el('button', {
            class: 'btn sm ghost', onclick: () => go('MOBILIZE_VOLUNTEERS', { count: n }),
          }, `Volunteers ${n}`, el('span', { class: 'dimmer' }, ' · ' + money(n * DEP.VOLUNTEER_COST))))),
        el('div', { class: 'row', style: { marginTop: '6px' } },
          ...[1, 2].map((n) => el('button', {
            class: 'btn sm ghost', onclick: () => go('COMMISSION_AIR', { count: n }),
          }, `Air wing${n === 1 ? '' : 's'} ${n}`, el('span', { class: 'dimmer' }, ' · ' + money(n * DEP.AIRWING_COST))))),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'Divisions cost to raise and keep; the reserve fights anywhere, those in place better. '
          + 'Volunteers: a tenth the strength at a fraction of the price, no vote needed, first to fall. '
          + 'Air wings add weight at the front, or bomb an enemy\'s cities.')),
      el('div', { class: 'card' }, el('h3', {}, 'The department'),
        ...deptRoster(world, 'defense')),
      chatCard('defense'))));

  // The front itself, at the foot of the room, once there is one.
  const wars = (world.foreign || []).filter((f) => DEP.liveWar(world, f.id));
  if (wars.length) root.append(...wars.map((f) => frontMap(world, f)));
};

/**
 * The front: the border, where it has moved to, and what is standing on it.
 *
 * Same geography as the World and City maps, cropped to the two countries
 * either side of this war, so the ground here is the same ground there. The
 * band is the territory currently held — see depts.occupiedBand — and the
 * pawns are the divisions actually committed to this border, which is the one
 * number in this room the player sets directly.
 */
function frontMap(world, f) {
  const g = GEO.mapOf(world);
  const war = DEP.liveWar(world, f.id);
  const band = DEP.occupiedBand(g, f.id, war.front);
  const line = f.id === 'canada' ? g.borders?.a : f.id === 'mexico' ? g.borders?.b : null;
  const box = el('div', { class: 'card' });

  if (!line) {
    box.append(el('h3', {}, `The war with ${f.name}`),
      el('p', { class: 'small dim serif', style: { margin: 0 } },
        `${f.name} shares no land border with us — the war is fought at sea and on other coasts, and no ground changes hands.`));
    return box;
  }

  const NEIGHBOUR = { canada: '#dcb970', mexico: '#a9c6a2' };
  const parts = [];
  parts.push(`<defs><clipPath id="fmland-${f.id}"><path d="${GEO.pathOf(g.ring)}"/></clipPath>`
    + `<pattern id="fmhatch-${f.id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<rect width="6" height="6" fill="none"/><rect width="2" height="6" fill="#141414" fill-opacity="0.28"/></pattern>`
    + ['us', f.id].map((id) => `<clipPath id="fmocc-${f.id}-${id}"><path d="${GEO.pathOf(g.halves[id])}"/></clipPath>`).join('')
    + `</defs>`);
  parts.push(`<rect x="0" y="0" width="${GEO.WORLD_W}" height="${GEO.WORLD_H}" fill="#1c5c74"/>`);
  parts.push(`<path d="${GEO.pathOf(g.ring)}" fill="#e2d7bc" stroke="#d8c79a" stroke-width="5" stroke-linejoin="round"/>`);
  parts.push(`<g clip-path="url(#fmland-${f.id})">`);
  parts.push(`<path d="${GEO.pathOf(g.halves[f.id])}" fill="${NEIGHBOUR[f.id] || '#cfc2a2'}" fill-opacity="0.55"/>`);
  parts.push(`<path d="${GEO.pathOf(g.halves.us)}" fill="#efe7d3" fill-opacity="0.5"/>`);
  if (band) {
    // Held ground: the winner's colour, hatched, so it reads as occupation
    // rather than as a redrawn country.
    const loser = band.byUs ? f.id : 'us';
    parts.push(`<g clip-path="url(#fmocc-${f.id}-${loser})">`);
    parts.push(`<path d="${GEO.pathOf(band.poly)}" fill="${band.byUs ? '#5b8fb0' : '#c2483c'}" fill-opacity="0.5"/>`);
    parts.push(`<path d="${GEO.pathOf(band.poly)}" fill="url(#fmhatch-${f.id})"/>`);
    parts.push('</g>');
  }
  // The border and everything standing on it, clipped to the coast: the border
  // polyline runs well past the landmass on both sides (that overshoot is what
  // makes the halves close cleanly), and drawn unclipped it put a dashed line
  // and a row of divisions out in open water.
  parts.push(`<path d="${GEO.pathOf(line)}" fill="none" stroke="#33291c" stroke-opacity="0.7" stroke-width="1.6" stroke-dasharray="5 3"/>`);

  // The divisions, strung along our side of the line.
  const ours = DEP.committedTo(world, f.id);
  const step = Math.max(1, Math.floor(line.length / (ours + 1)));
  for (let i = 1; i <= ours && i * step < line.length; i++) {
    const [x, y] = line[i * step];
    const oy = f.id === 'canada' ? y + 7 : y;
    const ox = f.id === 'canada' ? x : x - 7;
    parts.push(`<g><rect x="${(ox - 2).toFixed(1)}" y="${(oy - 1).toFixed(1)}" width="5" height="3" fill="#33291c"/>`
      + `<rect x="${(ox - 1).toFixed(1)}" y="${(oy - 5).toFixed(1)}" width="3" height="4" fill="#4a6fa5"/></g>`);
  }
  // And theirs, on the other side, scaled off the strength they actually have.
  const theirs = Math.max(1, Math.round(f.strength / 30));
  const tstep = Math.max(1, Math.floor(line.length / (theirs + 1)));
  for (let i = 1; i <= theirs && i * tstep < line.length; i++) {
    const [x, y] = line[i * tstep];
    const oy = f.id === 'canada' ? y - 7 : y;
    const ox = f.id === 'canada' ? x : x + 7;
    parts.push(`<g><rect x="${(ox - 2).toFixed(1)}" y="${(oy - 1).toFixed(1)}" width="5" height="3" fill="#33291c"/>`
      + `<rect x="${(ox - 1).toFixed(1)}" y="${(oy - 5).toFixed(1)}" width="3" height="4" fill="#c2483c"/></g>`);
  }

  parts.push('</g>');

  const holding = !band ? 'The line has not moved.'
    : band.byUs ? `We are holding ground inside ${f.name}.`
      : `${f.name} is holding ground inside ${world.nation}.`;
  box.append(
    el('div', { class: 'spread' }, el('h3', {}, `The front with ${f.name}`),
      el('span', { class: 'tag mono ' + (war.front > 0 ? 'green' : war.front < 0 ? 'red' : '') },
        (war.front > 0 ? '+' : '') + Math.round(war.front))),
    el('div', { class: 'citymap', style: { marginTop: '8px' },
      html: `<svg viewBox="0 0 ${GEO.WORLD_W} ${GEO.WORLD_H}" width="100%" style="display:block;max-height:300px" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>` }),
    el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { class: 'btn sm ghost', onclick: () => go('DEPLOY', { foreignId: f.id, count: Math.max(0, ours - 1) }) }, '− division'),
      el('span', { class: 'mono small' }, `${ours} on this border`),
      el('button', { class: 'btn sm ghost', onclick: () => go('DEPLOY', { foreignId: f.id, count: ours + 1 }) }, '+ division')),
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      `${holding} Ground held shows on the World and City maps, and returns when the war ends.`));
  return box;
}

VIEWS.mansion = (root) => {
  const world = w();
  const p = me();
  root.append(el('h1', { class: 'page' }, "The Vice President's Mansion"),
    el('p', { class: 'sub' }, 'The residence. Nothing decided here is binding.'));
  if (!R.mayEnterMansion(world, p?.id)) {
    root.append(el('div', { class: 'card dim' }, 'A private house. You have not been asked up.'));
    return;
  }
  const isVP = R.officesOf(world, p.id).some((o) => o.id === 'vp');
  const vp = R.holders(world, 'vp')[0];

  root.append(officeWindow(world, 'mansion'));
  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' }, chatCard('mansion')),
    el('div', { class: 'stack' },
      el('div', { class: 'card' }, el('h3', {}, 'Who is up here'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } },
          isVP ? 'Your house. No office holds a key, not even the President; a new Vice President starts empty.'
            : `${vp ? vp.name : 'The Vice President'} asked you up. You are a guest, and can be shown out.`),
        vp ? el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, vp.name, ' — ', R.office(world, 'vp')?.name || 'Vice President'),
          el('span', { class: 'tag gold' }, 'host')) : null,
        ...(world.mansionHost === vp?.id ? (world.mansionInvites || []) : [])
          .map((id) => world.personas[id]).filter(Boolean).map((h) =>
            el('div', { class: 'spread small', style: { padding: '3px 0' } },
              el('span', {},
                el('span', {}, h.name, ' — invited'),
                h.playerId === CTX.playerId ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'you') : null),
              isVP ? el('button', { class: 'btn sm ghost', onclick: () => go('UNINVITE_MANSION', { personaId: h.id }) }, 'show out') : null)),
        isVP ? el('label', { class: 'field', style: { marginTop: '8px' } }, el('span', {}, 'Ask someone up'),
          select([['', 'choose…'], ...rosterOptions(Object.values(world.personas)
            .filter((x) => x.alive && !x.exiled && !R.mayEnterMansion(world, x.id)))], '',
          (v) => v && go('INVITE_MANSION', { personaId: v }))) : null))));
};

// --- The Supreme Court — one closed room, and a docket inside it -----------
// There used to be two tabs. "The Court" was a public gallery — the docket, the
// bench, the reports, the vote buttons, and a form for suing people, all visible
// to the entire table — and "Chambers" was the closed hearing behind it. That
// split gave the game a public room whose only real occupants were three
// justices, and it put the act of suing somebody on the far side of the app from
// everything else you do to your rivals.
//
// There is one room now, and it is shut. The bench lives here. A party to a live
// case is let in, sees their own case and nothing else, and is put back out the
// moment judgment lands — CT.mayEnterChamber is the whole rule, and the tab does
// not appear in the sidebar for anyone else. Bringing an action moved to
// Intrigue, where the rest of the knives are. What the court has *held* is
// public and belongs to the public record, so the reports are in the Chronicle.

VIEWS.chambers = (root) => {
  const world = w();
  const p = me();
  const onBench = p && CT.isJustice(world, p.id);
  const co = CT.courtOffice(world);
  const bench = CT.justices(world);

  root.append(el('h1', { class: 'page' }, co?.name || 'The Supreme Court'),
    el('p', { class: 'sub' }, onBench
      ? 'Cases arrive on their own, usually when an office overreaches its grant. Majority rules.'
      : 'You are party to a case, so this door is open — your hearing, until the court decides.'));

  if (!CT.mayEnterChamber(world, p?.id)) {
    root.append(el('div', { class: 'card dim' }, 'Closed to you.'));
    return;
  }

  // The room, at the top — see the note at VIEWS.cloakroom.
  root.append(officeWindow(world, 'court'));

  if (onBench && !bench.length) root.append(el('div', { class: 'crisis', style: { marginBottom: '14px' } },
    el('b', {}, 'No court sits.'),
    el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
      'Until the bench is filled, no case is heard and suits lapse.')));

  const cases = CT.chamberCases(world, p.id);

  // One block per case: the pleading, the closed hearing, and — for the bench —
  // the vote. They were on separate tabs, which meant reading the argument and
  // deciding it were two different places.
  const caseBlock = (c) => {
    const left = Math.max(0, (c.argued || 0) - world.clock.tick);
    const pr = CT.precedentOn(world, c.doctrine);
    const myVote = p ? c.votes?.[p.id] : null;
    const decided = c.status === 'decided';
    const suit = c.target?.kind === 'person';
    const iAmParty = p && (c.plaintiffId === p.id || c.respondentId === p.id);
    const parties = [c.plaintiffId, c.respondentId].map((id) => world.personas[id]?.name).filter(Boolean);

    const head = el('div', {},
      el('div', { class: 'spread' },
        el('b', { class: 'serif' }, c.title),
        decided ? el('span', { class: 'tag ' + (c.ruling === 'struck' ? 'purple' : 'green') },
          suit
            ? (c.ruling === 'struck' ? `for the plaintiff ${c.tally?.strike}–${c.tally?.uphold}` : `for the respondent ${c.tally?.uphold}–${c.tally?.strike}`)
            : (c.ruling === 'struck' ? `struck ${c.tally?.strike}–${c.tally?.uphold}` : `upheld ${c.tally?.uphold}–${c.tally?.strike}`))
          : c.status === 'lapsed' ? el('span', { class: 'tag red' }, 'lapsed')
            : el('span', { class: 'tag gold' }, `${left} ticks to judgment`)),
      el('div', { class: 'tiny dimmer', style: { margin: '2px 0 8px' } },
        // A suit's title already names the parties; don't say it twice.
        suit ? (CT.CLAIMS[c.claim]?.label || 'a claim')
          : `${parties.join(' v. ') || 'In re: the act'} · on ${CT.doctrineName(c.doctrine)}`,
        ' · filed ', c.openedAt || '',
        ' · heard by ', CT.sittingBench(world, c).map((j) => j.name).join(', ') || 'nobody'),
      el('div', { class: 'quote' }, 'The complaint: ', c.subject, ' — ', (c.grounds || []).join('; '), '.'),
      c.answer ? el('div', { class: 'quote', style: { marginTop: '6px' } }, 'The answer: ', c.answer) : null,
      // The respondent gets to speak before the bench decides.
      (c.status === 'argued' && p && c.respondentId === p.id && !c.answer)
        ? el('button', {
          class: 'btn sm', style: { marginTop: '8px' }, onclick: () => ask({
            title: `Answer ${c.title}?`,
            body: 'Your answer is read into the record beside the pleading.',
            label: 'Enter it',
            input: { label: 'Your answer', multiline: true, placeholder: 'What actually happened.' },
            onConfirm: (text) => go('COURT_ANSWER', { caseId: c.id, text }),
          }),
        }, 'Answer this claim') : null,
      (c.recused || []).length ? el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
        'Recused: ', c.recused.map((id) => world.personas[id]?.name).filter(Boolean).join(', ')) : null,
      pr && !decided ? el('div', { class: 'allowed', style: { marginTop: '8px' } },
        'Controlling precedent: ', el('b', {}, pr.cite), ' — ', pr.holding) : null,
      decided ? el('div', { class: 'clause', style: { marginTop: '8px' } },
        el('div', { class: 'tiny dimmer' }, 'Opinion of the court',
          c.authorId ? ` · ${world.personas[c.authorId]?.name}` : ''),
        c.opinion) : null,
      // How the bench split — a court is people, and the record shows it. Only
      // the justices who may actually hear it: a recused party never votes.
      (decided || Object.keys(c.votes || {}).length) ? el('div', { style: { marginTop: '8px' } },
        ...CT.sittingBench(world, c).map((j) => {
          const v = c.votes?.[j.id];
          return el('div', { class: 'spread small', style: { padding: '2px 0' } },
            el('span', {}, j.name, j.playerId === CTX.playerId ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'you') : null),
            el('span', { class: 'tiny ' + (v === 'strike' ? 'red' : v === 'uphold' ? 'green' : 'dimmer') },
              v === 'strike' ? 'to strike' : v === 'uphold' ? 'to uphold' : 'has not voted'));
        })) : null,
      // A justice who is a party to the case has stood down and casts no vote.
      (c.status === 'argued' && onBench && !iAmParty)
        ? el('div', { class: 'row', style: { marginTop: '10px' } },
          el('button', {
            class: 'btn sm danger', onclick: () => ask({
              title: suit ? `Find for ${world.personas[c.plaintiffId]?.name || 'the plaintiff'}?` : `Strike the act in ${c.title}?`,
              label: suit ? 'Find for the plaintiff' : 'Vote to strike', danger: true,
              body: 'Your vote is entered with your opinion. Judgment comes when all have voted.',
              input: { label: 'Opinion (optional)', multiline: true, placeholder: suit ? 'The record bears the claim out.' : 'The power claimed here was never granted.' },
              onConfirm: (opinion) => go('COURT_VOTE', { caseId: c.id, vote: 'strike', opinion }),
            }),
          }, myVote === 'strike' ? (suit ? 'Voted for the plaintiff' : 'Voted to strike') : (suit ? 'For the plaintiff' : 'Strike it down')),
          el('button', {
            class: 'btn sm', onclick: () => ask({
              title: suit ? `Find for ${world.personas[c.respondentId]?.name || 'the respondent'}?` : `Uphold the act in ${c.title}?`,
              label: suit ? 'Find for the respondent' : 'Vote to uphold',
              body: 'Your vote is entered on the record with your opinion.',
              input: { label: 'Opinion (optional)', multiline: true, placeholder: suit ? 'A grievance is not yet a wrong.' : 'The act sits inside the grant.' },
              onConfirm: (opinion) => go('COURT_VOTE', { caseId: c.id, vote: 'uphold', opinion }),
            }),
          }, myVote === 'uphold' ? (suit ? 'Voted for the respondent' : 'Voted to uphold') : (suit ? 'For the respondent' : 'Uphold it')),
          c.target?.docId ? el('button', {
            class: 'btn sm ghost', onclick: () => { S.view = 'assembly'; CTX.rerender(true); },
          }, 'Read the act') : null) : null,
      decided
        ? el('div', { class: 'allowed', style: { margin: '8px 0 0' } }, 'Judgment is handed down. The record stays; the room does not.')
        : el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
          onBench
            ? 'The parties to this case can read the hearing below.'
            : 'The bench and the other party read this. Nothing is published.'));

    return textRoom({
      key: 'case-' + c.id,
      title: null,
      messages: (c.thread || []).slice(-60),
      // Only the bench ever sees a decided case in here, and it may still add to
      // the record after judgment.
      placeholder: decided ? 'note for the record…' : 'speak in chambers…',
      send: (text) => go('COURT_SPEAK', { caseId: c.id, text }),
      header: head,
    });
  };

  const docket = cases.length
    ? cases.map(caseBlock)
    : [el('div', { class: 'card dim small' }, onBench
      ? 'Nothing is before the court. It does not look for work.'
      : 'No hearing is open. The room is empty.')];

  // The bench is worth showing to a party too: these are the people deciding.
  const side = el('div', { class: 'stack' },
    el('div', { class: 'card' }, el('h3', {}, 'The bench'),
      ...bench.map((j) => {
        const seat = R.seatOf(world, j.id);
        return el('div', { class: 'spread small', style: { padding: '3px 0' } },
          el('span', {}, j.name,
            j.playerId === CTX.playerId ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'you') : null),
          el('span', { class: 'tiny dimmer' },
            seat?.termEnds != null
              ? `term ends ${C.canonDate(world, seat.termEnds)}` : 'life'));
      }),
      bench.length ? null : el('div', { class: 'tiny dimmer' }, 'Vacant. The bench is filled by appointment.'),
      onBench ? el('div', { class: 'allowed', style: { marginTop: '8px' } },
        'You sit on this court. Cases before it are yours to decide.') : null),
    el('div', { class: 'card' }, el('h3', {}, 'The reports'),
      el('div', { class: 'tiny dimmer' },
        'What this court has held is kept in the Chronicle.'),
      el('button', {
        class: 'btn sm ghost', style: { marginTop: '8px' },
        onclick: () => { S.view = 'chronicle'; CTX.rerender(true); },
      }, 'Read the reports')));

  root.append(el('div', { class: 'split' }, el('div', { class: 'stack' }, ...docket), side));
};

VIEWS.offices = (root) => {
  const world = w();
  const p = me();
  root.append(el('h1', { class: 'page' }, 'Offices'),
    el('p', { class: 'sub' }, 'What each office may do is enforced, not convention. Powers are granted or revoked by bill.'));

  // No pointer to the ballot: while an election is open it is in front of you and
  // the clock is stopped, so this view is not reachable anyway.

  const myNom = (world.nominations || []).find((n) => n.personaId === p?.id);
  if (myNom) {
    const no = R.office(world, world.seats.find((s) => s.id === myNom.seatId)?.office);
    root.append(el('div', { class: 'crisis', style: { marginBottom: '14px' } },
      el('div', { class: 'spread' },
        el('b', {}, `You are nominated ${no?.name || 'to office'}`),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm primary', onclick: () => go('ACCEPT_POST', { seatId: myNom.seatId }) }, 'Accept'),
          el('button', { class: 'btn sm ghost', onclick: () => go('DECLINE_POST', { seatId: myNom.seatId }) }, 'Decline'))),
      el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
        `Nominated by ${world.personas[myNom.by]?.name}. Accept the department, or decline.`)));
  }

  // The other career, offered on the page about careers. A republic where the
  // only way to matter is to hold one of the chairs below is a republic with a
  // very short list of things to be — and losing an election should not be the
  // end of a player's Season.
  // Through `kids`, because both of these return null when they have nothing to
  // say — and `Element.append` stringifies whatever is not a Node, so a card
  // that declined to draw itself printed the word "null" on the page. `el`
  // filters its children; `append` does not, and that difference is the trap.
  root.append(...kids(privateSectorCard(world, p), ownMoneyCard(world, p)));

  // Party affiliation. A politician chooses a side, or none — and running without
  // one means running without a bloc, which is a hard road at the polls.
  if (p) {
    root.append(el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('div', { class: 'spread' }, el('b', {}, 'Your party'),
        el('span', { class: 'tag', style: p.party ? { background: PARTIES.find((x) => x.id === p.party)?.color, color: PARTIES.find((x) => x.id === p.party)?.ink } : {} },
          PARTIES.find((x) => x.id === p.party)?.name || 'Independent')),
      el('div', { class: 'tiny dimmer', style: { margin: '4px 0 8px' } },
        'Voters sort by district: a party candidate has that bloc behind them, an independent only the undecided.'),
      el('div', { class: 'row' },
        ...PARTIES.map((party) => el('button', {
          class: 'btn sm' + (p.party === party.id ? ' primary' : ' ghost'),
          onclick: () => go('CHOOSE_PARTY', { party: party.id }),
        }, party.name)),
        el('button', { class: 'btn sm' + (!p.party ? ' primary' : ' ghost'), onclick: () => go('CHOOSE_PARTY', { party: null }) }, 'Independent'))));
  }

  root.append(el('div', { class: 'grid g2' }, ...world.constitution.offices.map((o) => {
    const seats = world.seats.filter((s) => s.office === o.id);
    return el('div', { class: 'card' },
      el('div', { class: 'spread' }, el('b', {}, o.name), el('span', { class: 'tiny dimmer' }, R.describeOffice(world, o))),
      el('div', { class: 'row', style: { margin: '8px 0' } },
        ...o.powers.map((pw) => el('span', { class: 'tag gold' }, R.powerLabel(pw))),
        o.powers.length ? null : el('span', { class: 'tag red' }, 'no enumerated power')),
      // Offices is the public record of who holds what — not the place where
      // appointments are made. An appointive seat simply reads vacant until the
      // President fills it from the Oval Office; the filling is his business,
      // and the Chronicle reports it when it is done.
      ...seats.map((s) => {
        const h = s.personaId ? world.personas[s.personaId] : null;
        const pending = (world.nominations || []).find((n) => n.seatId === s.id);
        return el('div', { class: 'spread', style: { padding: '5px 0', borderTop: '1px solid var(--rule-strong)' } },
          el('div', {},
            el('span', { class: 'small' }, h ? h.name : el('i', { class: 'dimmer' }, 'vacant'),
              h && !h.synthetic ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'player') : null,
              h ? partyChip(h) : null),
            el('div', { class: 'tiny dimmer' },
              (s.district ? seatWhere(world, s) + ' · ' : ''),
              h ? `approval ${Math.round(h.approval)}%` : '',
              s.termEnds != null
          ? ` · term ends ${C.canonDate(world, s.termEnds)} (in ${C.canonSpan(world, s.termEnds - world.clock.tick)})` : '')),
          el('div', { class: 'row' },
            (!h && pending) ? el('span', { class: 'tag gold' }, 'nomination pending') : null,
            (h && p && h.id === p.id) ? el('button', { class: 'btn sm ghost', style: { color: 'var(--red)' }, onclick: () => go('RESIGN', { seatId: s.id }) }, 'resign') : null));
      }),
      o.selection === 'appointment'
        ? el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
          `Filled by appointment of the ${R.office(world, o.appointedBy)?.name || o.appointedBy}.`)
        : null);
  })));

  root.append(el('div', { class: 'card', style: { marginTop: '14px' } }, el('h3', {}, 'Personas'),
    el('p', { class: 'tiny dimmer' }, 'Execution, exile and imprisonment happen to characters, not people. A killed president rolls a new one.'),
    el('table', { class: 't' },
      // The party column names each persona's alignment. It was once removed on
      // the grounds that the republic had no parties to name — but it does now:
      // the country sorts itself by party at the polls, the chamber is whipped
      // along party lines (sim.syntheticBallot, OPPOSITION_WHIP), and each party
      // holds an ideology across the legislation it sees (world.PARTIES). A
      // disposition that decides votes is a fact of the record, not a private one.
      el('thead', {}, el('tr', {}, ...['Name', 'Party', 'Standing', 'State', 'Line', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...roster(Object.values(world.personas).filter((x) => !x.synthetic || R.seatOf(world, x.id))).slice(0, 40).map((x) => {
        return el('tr', {},
          el('td', {}, x.name, x.playerId === CTX.playerId ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'you') : null),
          el('td', {}, partyChip(x)),
          el('td', { class: 'mono' }, Math.round(x.approval) + '%'),
          el('td', {}, !x.alive ? el('span', { class: 'tag red' }, 'dead') : x.exiled ? el('span', { class: 'tag red' }, 'exiled')
            : x.imprisoned ? el('span', { class: 'tag red' }, 'imprisoned') : el('span', { class: 'tag green' }, 'free')),
          el('td', { class: 'tiny dimmer' }, x.gen > 1 ? C.roman(x.gen) : ''),
          // Only when you are actually out of the game. The engine has always
          // refused a fresh persona for a living, free one; the button offered
          // it anyway, so the answer to "can I start over?" was a click and an
          // error rather than a plain no.
          el('td', {}, x.playerId === CTX.playerId && (!x.alive || x.exiled || x.imprisoned)
            ? el('button', { class: 'btn sm ghost', onclick: () => { S.modal = 'persona'; CTX.rerender(true); } }, 'new persona') : null));
      })))));
};

// The dedicated ballot box. Being here slows the clock, and lays candidacy and
// voting out plainly rather than tucking them under the office list.
/**
 * The ballot, as a popup the republic waits on.
 *
 * There was an Elections tab, and it was the wrong shape for what an election is.
 * A tab is somewhere you might wander; an election is the one event that stops
 * everything else. So the clock now halts the moment a ballot opens (sim.tick
 * returns early while any election is open) and this modal is put in front of
 * every player until the count. Nothing is happening behind it — that is the
 * point, and the modal says so.
 *
 * It is sticky: there is no close button and clicking the backdrop will not
 * dismiss it, because there is nothing else to do and no time in which to do it.
 * The count comes as soon as every player has submitted.
 */
function electionModal() {
  const world = w();
  const p = me();
  const open = ballotOrder(world, openElections(world));
  if (!open.length) return el('div', {}, 'The count is in.');

  const waiting = Object.values(world.players).filter((pl) => {
    const per = pl.personaId ? world.personas[pl.personaId] : null;
    return per && per.alive && !per.exiled && !per.imprisoned
      && open.some((e) => e.sealed?.[pl.personaId] == null);
  });

  return el('div', {},
    el('div', { class: 'spread' },
      el('h2', {}, open.length === 1 ? 'The republic goes to the polls' : `${open.length} elections are open`),
      el('button', {
        class: 'btn sm ghost',
        title: 'Put the ballot in the corner and use the rest of the game',
        onclick: () => { S.electionMin = true; CTX.rerender(true); },
      }, 'Minimise')),
    // Not "nothing moves" — the countdown beside this line plainly does. What is
    // held is the republic; the ballot has a clock of its own and that is the
    // only thing running.
    el('p', { class: 'sub' },
      'The republic is held while the ballot is open: no crisis, no treasury, no term running out.'),
    el('div', { class: 'stack' }, ...open.map((e) => electionCard(e, true))),
    waiting.length
      ? el('div', { class: 'tiny dimmer', style: { marginTop: '12px' } },
        'Waiting on ', waiting.map((pl) => pl.name).join(', '), ' to submit. The count follows immediately.')
      : el('div', { class: 'allowed', style: { marginTop: '12px' } },
        'Every ballot is in. The count is under way.'),
    el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
      'The citizenry votes alongside you, weighted by the constitution.'));
}

/**
 * The ballot, docked.
 *
 * An election takes the screen because the republic is held behind it — but a
 * minute is a long time to stare at a modal you have already voted in, and the
 * board is worth watching while the count comes. Minimised, the ballot keeps its
 * countdown in the corner and gives everything else back.
 */
function electionDock() {
  const world = w();
  const p = me();
  const open = openElections(world);
  if (!open.length) return el('div', {});
  const soonest = open.slice().sort((a, b) =>
    ((a.runs ?? 60) - (a.age ?? 0)) - ((b.runs ?? 60) - (b.age ?? 0)))[0];
  const left = Math.max(0, (soonest.runs ?? 60) - (soonest.age ?? 0));
  const unsealed = p ? open.filter((e) => e.sealed?.[p.id] == null).length : 0;

  return el('div', { class: 'election-dock' },
    el('div', { class: 'spread' },
      el('b', { class: 'small' }, open.length === 1
        ? 'Election — ' + (R.office(world, soonest.office)?.name || '')
        : `${open.length} elections open`),
      el('span', { class: 'tag mono' }, left + 's')),
    el('div', { class: 'tiny dimmer', style: { margin: '4px 0 8px' } },
      unsealed ? `${unsealed} ballot${unsealed === 1 ? '' : 's'} still yours to submit.`
        : 'Your ballot is in. The republic is held until the count.'),
    el('button', {
      class: 'btn sm' + (unsealed ? ' primary' : ''),
      style: { width: '100%' },
      onclick: () => { S.electionMin = false; CTX.rerender(true); },
    }, unsealed ? 'Open the ballot' : 'Show the count'));
}

/**
 * The order the races appear in when several are open at once.
 *
 * Every fourth year the presidency and the vice presidency fall due alongside
 * the whole chamber, and the modal listed them in whatever order the engine
 * happened to schedule them — so the one vote that decides who runs the country
 * could be the fifth thing on a page of district contests. National offices
 * come first, then everything else by the seniority of the chair, which is the
 * same ladder the roster and the Government card already read down.
 */
function ballotOrder(world, open) {
  const rank = (e) => {
    const o = R.office(world, e.office);
    return [o?.electorate === 'district' ? 1 : 0, -(R.PRESTIGE[e.office] ?? 30)];
  };
  return open.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1]
      || String(R.office(world, a.office)?.name).localeCompare(String(R.office(world, b.office)?.name));
  });
}

/**
 * The ballot itself, laid out the way the seats are actually filled.
 *
 * A national office is one race and reads as a list. A district office is not:
 * it is one contest per seat, all of them run at the same moment, and you are
 * an elector in exactly one. The old flat list put every candidate in the
 * republic under a single heading with a vote button beside each, which said
 * the chamber was elected at large — and it let you spend your ballot on a
 * race you have no part in.
 *
 * So it is sectioned by district, your own first with the buttons live, the
 * others below it as the results you will be reading later. The engine agrees:
 * closeElection has always counted a district seat against its own field only.
 */
function ballotRows(world, e, o, p, sealed) {
  const row = (c, votable) => {
    const per = world.personas[c.personaId];
    const mine = e.ballots[p?.id] === c.personaId;
    // The party, named in full under the candidate.
    //
    // The ballot gave a name and an approval figure and nothing else, so the one
    // question a voter actually asks — which of these two is on my side — could
    // not be answered from the ballot at all. You had to leave the election,
    // find them in the Offices table, and come back.
    //
    // Named rather than dotted, and that is the same call the chamber list
    // makes a few hundred lines up: a coloured bullet beside every name promises
    // a caucus structure this game does not have. A word does not. It is also
    // the only place in the game where the party is load-bearing for a decision
    // the player is making *right now*, which is why it is worth the line.
    const party = PARTIES.find((x) => x.id === per?.party);
    return el('div', { class: 'spread', style: { padding: '4px 0' } },
      el('span', { class: 'small' }, per?.name,
        per && !per.synthetic ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, 'player') : null,
        per?.id === p?.id ? el('span', { class: 'tag green', style: { marginLeft: '6px' } }, 'you') : null,
        el('span', { class: 'tiny dimmer', style: { display: 'block' } },
          party?.name || 'Independent',
          // A district has a lean of its own, and a candidate running against it
          // is doing something worth seeing on the ballot.
          (c.district && world.districts.find((d) => d.id === c.district)?.lean
            && party && world.districts.find((d) => d.id === c.district).lean !== party.id)
            ? ' · against the district’s lean' : '')),
      el('div', { class: 'row' },
        el('span', { class: 'tiny dimmer mono' }, 'appr ' + Math.round(per?.approval || 0)),
        sealed
          ? el('span', { class: 'tag ' + (mine ? 'green' : '') }, mine ? 'your vote' : '—')
          : votable
            ? el('button', {
              class: 'btn sm' + (mine ? ' primary' : ''),
              onclick: () => go('BALLOT', { electionId: e.id, candidateId: c.personaId }),
            }, mine ? 'your vote' : 'vote')
            : el('span', { class: 'tiny dimmer' }, 'not your district'),
        // A former head of government may lend a candidate their name — worth a
        // little at the count, and shown only to someone who has a name to lend.
        (p && R.heldHeadOffice(world, p.id)
          && !R.officesOf(world, p.id).some((of) => of.id === R.headOffice(world)?.id))
          ? el('button', {
            class: 'btn sm ghost' + ((c.endorsedBy || []).includes(p.id) ? ' primary' : ''),
            title: 'Former heads of government may endorse; it is worth a little at the count.',
            onclick: () => go('ENDORSE', { electionId: e.id, candidatePersonaId: c.personaId }),
          }, (c.endorsedBy || []).includes(p.id) ? 'endorsed' : 'endorse')
          : null,
        // A company's founder can put its money behind a candidate here — and
        // anyone with money of their own can put that behind one, which is the
        // channel a founder who sold up used to have no way to reach.
        (p && CO.foundedBy(world, p.id)) ? el('button', {
          class: 'btn sm ghost',
          title: 'Bankroll this campaign from your company — capped at $10M for a per cent, unless you bootstrap your own.',
          onclick: () => go('DONATE_CAMPAIGN', { candidatePersonaId: c.personaId, amount: 5e6 }),
        }, 'bankroll') : null,
        (p && (p.wallet || 0) >= 1e6) ? el('button', {
          class: 'btn sm ghost',
          title: `Back this campaign with ${moneyExact(Math.min(1e6, p.wallet))} of your own — the same $10M cap and public record.`,
          onclick: () => go('DONATE_CAMPAIGN', { candidatePersonaId: c.personaId, amount: 1e6, from: 'wallet' }),
        }, 'give $1M') : null));
  };

  if (o?.electorate !== 'district') return e.candidates.map((c) => row(c, true));

  const home = p?.district || null;
  const heading = (text, note) => el('div', {
    class: 'spread',
    style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--rule-strong)' },
  }, el('b', { class: 'small' }, text), note ? el('span', { class: 'tiny dimmer' }, note) : null);

  const groups = world.districts
    .map((d) => ({ id: d.id, name: d.name, field: e.candidates.filter((c) => c.district === d.id) }))
    .filter((g) => g.field.length);
  // A candidate from nowhere still has to appear somewhere, or they vanish off
  // a ballot they are standing on.
  const stray = e.candidates.filter((c) => !world.districts.some((d) => d.id === c.district));
  // Your own seat first. You are voting in one race; the rest is the board.
  groups.sort((a, b) => (b.id === home) - (a.id === home) || a.name.localeCompare(b.name));

  const out = [];
  if (home && !groups.some((g) => g.id === home)) {
    out.push(el('div', { class: 'blocked', style: { marginTop: '6px' } },
      `Nobody has stood for ${world.districts.find((d) => d.id === home)?.name || 'your district'} yet. `
      + 'You have no vote to cast until somebody does.'));
  }
  if (!home) {
    out.push(el('div', { class: 'blocked', style: { marginTop: '6px' } },
      'You are from no district, so no seat here is yours to fill.'));
  }
  for (const g of groups) {
    const yours = g.id === home;
    out.push(heading(g.name, yours ? 'your seat' : null));
    out.push(...g.field.map((c) => row(c, yours)));
  }
  if (stray.length) {
    out.push(heading('Standing from no district', null));
    out.push(...stray.map((c) => row(c, false)));
  }
  return out;
}

function electionCard(e, big = false) {
  const world = w();
  const p = me();
  const o = R.office(world, e.office);
  // Counted off the election's own age, not the canon clock — the canon clock is
  // stopped, and a countdown that never moved was worse than none.
  const left = Math.max(0, (e.runs ?? 30) - (e.age ?? 0));
  const standing = e.candidates.some((c) => c.personaId === p?.id);
  const sealed = !!p && e.sealed?.[p.id] != null; // the seal stores a tick, and tick 0 is real
  // Whether the constitution will let this persona hold the office again — the
  // term limit, and the age of majority for the head office. The engine has
  // always refused them at the nomination (sim.nominate → rules.mayHoldAgain),
  // but the ballot offered the button anyway, so a term-limited president was
  // invited to declare and then told no. Ask the same question the engine asks.
  const may = p ? R.mayHoldAgain(world, p.id, e.office) : { ok: false };
  const eligible = p && !p.synthetic && p.alive && !p.exiled && !p.imprisoned && may.ok;
  const nominating = (e.age ?? 0) < 4; // the field is still forming

  return el('div', { class: 'card gold' },
    el('div', { class: 'spread' }, el('b', {}, 'Election — ' + o.name),
      el('span', { class: 'tag mono' }, left + 's to the count')),
    el('div', { class: 'tiny dimmer', style: { margin: '4px 0 10px' } },
      `Citizen weight ${world.constitution.elections.citizenWeight}× · player weight ${world.constitution.elections.playerWeight}×`),

    // A pending invitation to join a candidate's ticket (e.g. run for VP).
    ((nom) => nom ? el('div', { style: { margin: '0 0 10px', padding: '8px 10px', border: '2px solid var(--line)', borderRadius: '10px', background: '#f7edd0' } },
      el('div', { class: 'small' }, `${world.personas[nom.candidate]?.name} asks you to run for ${R.office(world, nom.office)?.name} on their ticket.`),
      el('div', { class: 'row', style: { marginTop: '6px' } },
        el('button', { class: 'btn sm primary', onclick: () => go('ACCEPT_POST', { ticket: e.id }) }, 'Accept'),
        el('button', { class: 'btn sm ghost', onclick: () => go('DECLINE_POST', { ticket: e.id }) }, 'Decline'))) : null)((world.nominations || []).find((n) => n.ticket === e.id && n.personaId === p?.id)),

    // A district office is contested district by district: you stand where you
    // live, against the field for that one seat, and nowhere else.
    ((home) => o.electorate === 'district'
      ? el('div', { class: 'tiny dimmer', style: { margin: '-6px 0 10px' } },
        home
          ? `Seats are contested district by district. You are from ${home.name}, so you stand for its seat.`
          : 'Seats are contested district by district, and you are from none.')
      : null)(p?.district ? world.districts.find((d) => d.id === p.district) : null),

    // Candidacy. A ticket office (President) lets you name a running mate.
    el('div', { class: 'row', style: { marginBottom: '10px' } },
      standing
        ? el('span', { class: 'tag green' }, 'You are standing in this election.')
        : eligible
          ? (R.ticketMateOffice(world, e.office)
            ? el('div', { class: 'row' },
              select([['', `running mate for ${R.office(world, R.ticketMateOffice(world, e.office))?.name}…`], ...rosterOptions(Object.values(world.personas).filter((x) => x.alive && !x.exiled && x.id !== p.id))], (S.runMate || {})[e.id] || '', (v) => { S.runMate = S.runMate || {}; S.runMate[e.id] = v; }),
              el('button', { class: 'btn primary sm', onclick: () => go('NOMINATE', { electionId: e.id, runningMate: (S.runMate || {})[e.id] || null }) }, 'Declare your candidacy'))
            : el('button', { class: 'btn primary sm', onclick: () => go('NOMINATE', { electionId: e.id }) }, 'Declare your candidacy'))
          // Say *why* they cannot stand when the constitution is the reason —
          // "has served 2 terms, and the constitution allows 2" is the answer to
          // the question the player is actually asking.
          : el('span', { class: 'tiny dimmer' }, !p ? 'No persona.' : (may.ok ? 'Your persona cannot stand.' : may.reason)),
      nominating ? el('span', { class: 'tiny dimmer' }, 'Nominations still opening…') : null),

    el('div', { class: 'tiny dimmer', style: { marginBottom: '4px' } }, 'The ballot:'),
    ...ballotRows(world, e, o, p, sealed),
    e.candidates.length ? null : el('div', { class: 'dim small' }, 'No one has stood yet.'),

    // Finish before the polls do. Until you submit, a ballot is just a pencil
    // mark — and the page goes on holding canon time down on your behalf.
    sealed
      ? el('div', { class: 'tiny green', style: { marginTop: '8px' } },
        'Submitted and final. Counted when the polls close.')
      : e.ballots[p?.id]
        ? el('div', { style: { marginTop: '8px' } },
          el('button', {
            class: 'btn primary sm',
            onclick: () => go('SEAL_BALLOT', { electionId: e.id }),
          }, 'Submit your ballot'))
        : null);
}

// --- Intrigue --------------------------------------------------------------

// Which of the director's crises are intrigue's business rather than the
// nation's ledger. Read off the event template's own canon tag, so adding an
// event to the director puts it in the right room automatically.
const INTRIGUE_TAGS = ['spy', 'war', 'coup', 'occult'];
function intrigueEvents(world) {
  return (world.events || []).filter((ev) => {
    const tpl = D.EVENTS.find((t) => t.id === ev.id);
    return tpl && INTRIGUE_TAGS.includes(tpl.tag);
  });
}

VIEWS.intrigue = (root) => {
  const world = w();
  const p = me();
  const mine = world.conspiracies.filter((c) => c.members.includes(p?.id));
  const spy = (world.spies || []).find((s) => s.ownerPersonaId === p?.id && s.active);
  const canInvestigate = p && (R.hasPower(world, p.id, 'arrest') || R.hasPower(world, p.id, 'strike_law') || R.hasPower(world, p.id, 'impeach'));

  root.append(el('h1', { class: 'page' }, 'Intrigue'),
    el('p', { class: 'sub' }, 'Betrayal is a mechanic, not an alt account. Private rooms are private, but leave a trail.'));

  // A spy taken at the border or a rising in the streets is this tab's business,
  // but both only ever appeared on Nation — the sidebar even badged this tab
  // "a rising is under way" and then showed nothing about it when you arrived.
  // They belong in both places, answerable from either.
  const openIntrigue = intrigueEvents(world).filter((ev) => !ev.resolved);
  if (openIntrigue.length) root.append(el('div', { class: 'stack', style: { marginBottom: '16px' } },
    ...openIntrigue.map((ev) => crisisCard(ev))));
  if (world.uprising && !world.uprising.resolved) root.append(uprisingCard());

  root.append(el('div', { class: 'split' },
    el('div', { class: 'stack' },
      ...mine.map(conspiracyCard),
      el('div', { class: 'card' }, el('h3', {}, 'Open a private room'),
        el('div', { class: 'row' },
          el('input', { id: 'conname', placeholder: 'An understanding', style: { flex: 1 } }),
          el('button', {
            class: 'btn primary', onclick: () => {
              const n = document.getElementById('conname');
              go('CONSPIRE', { name: n.value || 'An understanding' }); n.value = '';
            },
          }, 'Open')),
        el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
          'Every message may leave a fragment; every member raises exposure.')),

      // The chair that commands the apparatus does not also get a private
      // agent — anything covert in the President's name is done by somebody
      // they can disown, and the button read as a bug when it appeared and
      // then refused. Hide the whole card for that office rather than explain
      // its absence; the office is the explanation.
      p && p.id === I.headId(world) && !spy ? null
      : el('div', { class: 'card' }, el('h3', {}, 'Your agent'),
        spy ? el('div', {},
          el('div', { class: 'spread' }, el('b', {}, spy.coverName), el('span', { class: 'mono small ' + (spy.exposure > 60 ? 'red' : '') }, 'exposure ' + Math.round(spy.exposure) + '%')),
          el('div', { class: 'bar', style: { margin: '6px 0 10px' } }, el('i', { style: { width: spy.exposure + '%', background: spy.exposure > 60 ? 'var(--red)' : 'var(--gold)' } })),
          el('div', { class: 'stack' }, ...Object.entries(I.MISSIONS).map(([k, m]) => el('div', { class: 'spread' },
            el('div', {}, el('span', { class: 'small' }, m.label), el('div', { class: 'tiny dimmer' }, m.blurb, ' · +', m.risk, '% exposure')),
            el('div', { class: 'row' },
              ['observe', 'turn', 'plant'].includes(k)
                ? select([['', 'target…'], ...rosterOptions(world.seats.filter((s) => s.personaId).map((s) => world.personas[s.personaId]).filter(Boolean))], S.spyTarget || '', (v) => (S.spyTarget = v))
                : null,
              el('button', { class: 'btn sm', onclick: () => go('MISSION', { kind: k, targetId: S.spyTarget }) }, 'run'))))),
          el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } }, 'If the agent is taken, your name goes in the record.'))
          : el('div', {},
              el('div', { class: 'row' },
                el('input', { id: 'cover', placeholder: 'Cover name — “The Courier”', style: { flex: 1 } }),
                el('button', {
                  class: 'btn', onclick: () => {
                    const n = document.getElementById('cover');
                    go('RUN_AGENT', { coverName: n.value || 'The Courier' }); n.value = '';
                  },
                }, 'Run an agent')),
              el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } }, 'A covert persona with an exposure risk, not an alt account.'))),
    ),

    el('div', { class: 'stack' },
      plotCard(),

      // Suing somebody belongs here. It used to be on a public "The Court" tab,
      // which put the most calculated move you can make against a rival in a
      // reading room, next to the reports. A writ is an instrument, the same as a
      // spy or a leak, and this is the drawer the instruments live in.
      el('div', { class: 'card' }, el('h3', {}, 'Bring an action'),
        el('div', { class: 'tiny dimmer', style: { marginBottom: '8px' } },
          'A suit against a person, not a law. The court weighs it against the record; a justice who is party stands down.'),
        p ? el('div', {},
          el('label', { class: 'field' }, el('span', {}, 'Against'),
            select([['', 'choose…'], ...rosterOptions(Object.values(world.personas)
              .filter((x) => x.alive && !x.exiled && x.id !== p.id && (!x.synthetic || R.seatOf(world, x.id))))],
            S.suitTarget || '', (v) => { S.suitTarget = v; })),
          el('label', { class: 'field' }, el('span', {}, 'Claim'),
            select(Object.entries(CT.CLAIMS).map(([k, v]) => [k, v.label]), S.suitClaim || 'abuse_of_office',
              (v) => { S.suitClaim = v; CTX.rerender(true); })),
          el('div', { class: 'tiny dimmer', style: { margin: '-4px 0 8px' } },
            CT.CLAIMS[S.suitClaim || 'abuse_of_office']?.blurb || ''),
          el('label', { class: 'field' }, el('span', {}, 'Your pleading'),
            el('textarea', { id: 'pleading', rows: 2, placeholder: 'What they did, and why it is a wrong the law should name.' })),
          el('button', {
            class: 'btn primary', style: { width: '100%' },
            onclick: () => go('SUE_PERSON', {
              personaId: S.suitTarget, claim: S.suitClaim || 'abuse_of_office',
              pleading: document.getElementById('pleading')?.value,
            }),
          }, 'File the action'))
          : el('div', { class: 'tiny dimmer' }, 'You need a persona to bring an action.')),

      el('div', { class: 'card' }, el('h3', {}, 'Investigations'),
        canInvestigate
          ? el('button', { class: 'btn primary', style: { width: '100%' }, onclick: () => go('INVESTIGATE', {}) }, 'Open an investigation')
          : el('div', { class: 'tiny dimmer' }, 'Requires an office with power to arrest, try, or strike.'),
        (world.investigations || []).length ? null : el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } }, 'No investigations opened yet.'),
        // Files still open, and when they report. An investigation with no
        // reporting date is just a rumour with a filing cabinet.
        ...(world.inquests || []).filter((q) => !q.finding).map((q) => el('div', {
          class: 'tiny', style: { padding: '5px 0', borderTop: '1px solid var(--line2)' },
        },
          el('span', { class: 'tag red' }, 'open'), ' ',
          el('b', {}, world.personas[q.subjectId]?.name || 'A name'), ' — ', q.over, '. ',
          el('span', { class: 'dimmer' }, `Reports in ${Math.max(0, q.due - world.clock.tick)} ticks.`))),
        ...(world.investigations || []).slice(-6).reverse().map((iv) => el('div', { class: 'tiny', style: { padding: '4px 0', borderTop: '1px solid var(--line2)' } },
          el('span', { class: 'dimmer' }, (world.personas[iv.by]?.name || 'Someone') + ': '),
          iv.result || `looked (roll ${Math.round(iv.roll || 0)}).`))),

      el('div', { class: 'card' }, el('h3', {}, 'Known conspiracies'),
        ...world.conspiracies.filter((c) => c.exposed).map((c) => el('div', { style: { padding: '5px 0' } },
          el('b', { class: 'small red' }, c.name),
          el('div', { class: 'tiny dim' }, c.members.map((m) => world.personas[m]?.name).join(', ')))),
        world.conspiracies.some((c) => c.exposed) ? null : el('div', { class: 'dim small' }, 'None exposed. That is not the same as none existing.')),

      // What became of the ones already answered — so the tab reflects the
      // whole affair, not only the moment it was still a live question.
      ((settled) => settled.length ? el('div', { class: 'card' }, el('h3', {}, 'Settled affairs'),
        ...settled.map((ev) => el('div', { style: { padding: '5px 0', borderTop: '1px solid var(--line2)' } },
          el('div', { class: 'spread' }, el('b', { class: 'small' }, ev.title),
            el('span', { class: 'tag ' + (ev.ignored ? 'red' : 'green') }, ev.ignored ? 'ignored' : 'answered')),
          el('div', { class: 'tiny dimmer' },
            ev.ignored ? 'Nobody answered it. It resolved against the government.'
              : `Answered: ${ev.options?.[ev.choice]?.label || 'a decision was taken'}.`)))) : null)(
        intrigueEvents(world).filter((ev) => ev.resolved).slice(-5).reverse()),

      el('div', { class: 'card' }, el('h3', {}, 'Your intelligence'),
        ...(world.intel || []).filter((x) => !x.owner || x.owner === p?.id).slice(-8).reverse().map((x) =>
          el('div', { class: 'small', style: { padding: '4px 0', borderBottom: '1px solid var(--rule-strong)' } }, x.text)),
        (world.intel || []).length ? null : el('div', { class: 'dim small' }, 'Nothing.')),

      el('div', { class: 'card' }, el('h3', {}, 'Raise a standard'),
        el('p', { class: 'tiny dimmer' }, 'A rising turns on a support check — allegiance, arms, sympathy — over a real-time window. Not from government.'),
        el('div', { class: 'spread tiny', style: { margin: '2px 0 8px' } },
          el('span', { class: 'dim' }, 'Public approval'),
          el('b', { class: nationalApproval(world) <= 45 ? 'red' : nationalApproval(world) >= 60 ? 'green' : '' }, `${Math.round(nationalApproval(world))}%`)),
        el('input', { id: 'cause', placeholder: 'Cause', style: { marginBottom: '8px' } }),
        el('div', { class: 'row' },
          el('button', {
            class: 'btn danger', onclick: () => go('UPRISING', { kind: 'revolution', cause: document.getElementById('cause').value }),
          }, 'Lead a revolution'),
          el('button', {
            class: 'btn danger', onclick: () => go('UPRISING', { kind: 'coup', cause: document.getElementById('cause').value }),
          }, 'Raise a rising'),
          el('button', {
            class: 'btn danger', onclick: () => go('UPRISING', {
              kind: 'secession', cause: document.getElementById('cause').value,
              districts: [world.districts[world.districts.length - 1].id],
            }),
          }, 'Declare secession'))),
    ),
  ));
};

// A conspiracy is a room like any other, and now behaves like one: same
// component as the floor and the Oval Office, so a whisper appears the instant
// it is sent instead of waiting for you to click elsewhere. What is different
// is the cost — every line here raises exposure — so that stays on the card.
function conspiracyCard(c) {
  const world = w();
  return textRoom({
    key: 'con-' + c.id,
    title: null,
    cardClass: 'card',
    messages: c.messages.slice(-40),
    placeholder: 'whisper…',
    send: (text) => go('WHISPER', { conId: c.id, text }),
    header: el('div', {},
      el('div', { class: 'spread' }, el('b', {}, c.name),
        el('span', { class: 'mono tiny ' + (c.exposure > 55 ? 'red' : 'dimmer') }, 'exposure ' + Math.round(c.exposure) + '%')),
      el('div', { class: 'bar', style: { margin: '6px 0' } },
        el('i', { style: { width: c.exposure + '%', background: c.exposure > 55 ? 'var(--red)' : 'var(--gold-dim)' } })),
      el('div', { class: 'tiny dim' }, 'In the room: ', c.members.map((m) => world.personas[m]?.name).join(', ')),
      c.exposed ? el('div', { class: 'blocked', style: { marginTop: '8px' } }, 'Exposed. Everything below is now public record.') : null,
      el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
        'Every line raises exposure, and may leave a fragment for an investigation.')),
    extra: el('div', { class: 'row', style: { marginTop: '8px' } },
      select([['', 'invite…'], ...rosterOptions(Object.values(world.personas).filter((x) => x.alive && !c.members.includes(x.id)))], '',
        (v) => v && go('CONSPIRE_INVITE', { conId: c.id, personaId: v })),
      el('button', { class: 'btn sm danger', onclick: () => go('LEAK', { conId: c.id }) }, 'leak it')),
  });
}

// --- Chronicle -------------------------------------------------------------

VIEWS.chronicle = (root) => {
  const world = w();
  S.chronFilter = S.chronFilter || 'all';
  const entries = world.chronicle.filter((e) => S.chronFilter === 'all' || e.kind === S.chronFilter).slice().reverse();

  // The record IS a newspaper: masthead, dateline, a lead story, and the rest
  // of the news in columns. Same entries, same contest button — dressed as the
  // front page the citizens of the nation would actually read.
  root.append(el('div', { class: 'np-masthead' },
    el('div', { class: 'np-rule double' }),
    el('h1', { class: 'np-title' }, `The ${bareNation(world.nation)} Chronicle`),
    el('div', { class: 'np-dateline' },
      `${C.canonDate(world)} · ${world.seasonName} · ${world.chronicle.length} acts of record · rival accounts side by side`),
    el('div', { class: 'np-rule' })));

  root.append(el('div', { class: 'np-sections' },
    el('button', { class: S.chronFilter === 'all' ? 'on' : '', onclick: () => { S.chronFilter = 'all'; CTX.rerender(true); } }, 'everything'),
    ...Object.keys(C.KINDS).map((k) => el('button', { class: S.chronFilter === k ? 'on' : '', onclick: () => { S.chronFilter = k; CTX.rerender(true); } }, k)),
    el('span', { style: { marginLeft: 'auto' } }),
    el('button', { class: 'btn sm ghost', onclick: () => C.download(`${world.nation}-${world.seasonName}.md`, C.exportChronicle(world)) }, 'Export the history')));

  // The lead: the weightiest of the latest dozen entries gets the headline.
  const pool = entries.slice(0, 12);
  const lead = pool.length ? pool.reduce((a, b) => ((b.weight || 1) > (a.weight || 1) ? b : a), pool[0]) : null;
  const rest = entries.filter((e) => e !== lead).slice(0, 249);

  root.append(el('div', { class: 'split' },
    el('div', { class: 'card np-page' },
      lead ? el('div', { class: 'np-lead' }, chronRow(lead, true)) : el('div', { class: 'dim small' }, 'Nothing has happened yet. It will.'),
      el('div', { class: 'np-cols' }, ...rest.map((e) => chronRow(e, true)))),
    el('div', { class: 'stack' },
      presidentialRankings(world),
      courtReports(world),
      el('div', { class: 'card np-box' }, el('h3', {}, 'Obituaries'),
        ...Object.values(world.personas).filter((p) => !p.alive).slice(0, 6).map((p) =>
          el('div', { class: 'small serif', style: { padding: '6px 0', borderBottom: '1px solid var(--rule-strong)' } }, C.obituary(world, p))),
        Object.values(world.personas).some((p) => !p.alive) ? null : el('div', { class: 'dim small' }, 'Nobody has died yet.')),
      el('div', { class: 'card np-box' }, el('h3', {}, 'Laws in force'),
        ...world.laws.map((id) => world.documents[id]).filter(Boolean).map((d) => el('div', { class: 'small', style: { padding: '3px 0' } },
          el('span', { class: 'serif' }, d.title), el('span', { class: 'tiny dimmer' }, ' · ', d.promulgatedAt)))),
    ),
  ));
};

/**
 * The historians' table. It ranks holders of the top chair and nobody else, and
 * says so — the old box was headed "Historian rankings" and listed whoever had
 * ever held any office at all, which put a first-term Rep. above a two-term
 * President on Crisis Leadership and meant nothing.
 */
/**
 * The encyclopaedia entry on a former head of government.
 *
 * Two versions when both exist: the one written on the way out, and the one
 * written twelve years later. Showing them together is the point — a legacy is
 * an argument that moves, and the pair of paragraphs is the argument moving.
 */
/**
 * An article, rendered.
 *
 * `composeBio` returns { lede, sections } now — the old one-paragraph version
 * was all a paragraph could hold, and the republic records enough about a
 * tenure to write the rest of it. A save from before that holds a bare string
 * here, so both shapes read: a string is simply the lede with nothing under it.
 */
function bioBody(article) {
  if (!article) return [el('p', { class: 'dim' }, 'No article.')];
  if (typeof article === 'string') {
    return [el('p', { class: 'serif', style: { lineHeight: '1.65' } }, article)];
  }
  // The lede, then the life, in one paragraph. A heading is only drawn if the
  // article still has one — an old save from when this had eleven sections
  // reads exactly as it did, and a new one has a single unheaded section.
  return [
    el('p', { class: 'serif', style: { lineHeight: '1.7', fontSize: '105%' } }, article.lede),
    ...(article.sections || []).flatMap((s) => [
      s.h ? el('h3', { style: { margin: '14px 0 2px' } }, s.h) : null,
      ...s.p.map((para) => el('p', { class: 'serif', style: { lineHeight: '1.65', margin: '10px 0 0' } }, para)),
    ].filter(Boolean)),
  ];
}

function bioModal() {
  const world = w();
  const p = world.personas[S.bioPersona];
  const bio = world.bios?.[S.bioPersona];
  if (!p || !bio) return el('div', {}, 'No article.');
  const row = C.computeRanking(world).find((r) => r.persona.id === p.id);
  return el('div', { class: 'stack' },
    el('div', { class: 'spread' },
      el('h2', { style: { margin: 0 } }, p.name),
      el('button', { class: 'btn sm ghost', onclick: () => { S.modal = null; CTX.rerender(true); } }, 'Close')),
    el('div', { class: 'tiny dimmer' },
      row ? `${C.heldAs(row)} of ${world.nation}` : world.nation,
      bio.final ? ' · article revised with hindsight' : ' · written on leaving office'),
    el('div', { class: 'rule' }),
    ...bioBody(bio.final ? bio.finalText : bio.text),
    bio.final && bio.text
      ? el('details', { style: { marginTop: '10px' } },
        el('summary', { class: 'tiny dimmer' }, 'The article as it stood when they left office'),
        el('div', { class: 'dim', style: { fontSize: '92%' } }, ...bioBody(bio.text)))
      : null,
    !bio.final
      ? el('div', { class: 'tiny dimmer' },
        'A legacy is rewritten twelve years after the tenure ends.')
      : null);
}

function presidentialRankings(world) {
  const rows = C.computeRanking(world);
  const head = R.headOffice(world);
  return el('div', { class: 'card np-box' },
    el('h3', {}, C.rankingLabel(world)),
    el('p', { class: 'tiny dimmer' }, head
      ? `Every ${head.name} of ${world.nation}, on the thirteen attributes — computed from their tenure, arguable by the table.`
      : 'This constitution has no executive to rank.'),
    ...rows.slice(0, 8).map((r, i) => el('div', {
      class: 'spread', style: { padding: '4px 0', cursor: 'pointer' },
      title: `${C.heldAs(r)}${r.sitting ? ' — sitting' : ''} · ${r.acts} acts of record`,
      onclick: () => { S.rankPersona = r.persona.id; S.modal = 'rank'; CTX.rerender(true); },
    },
      el('span', { class: 'small' }, `${i + 1}. `, r.persona.name,
        el('span', { class: 'tiny dimmer' }, ' ', C.heldAs(r), r.sitting ? ', sitting' : ''),
        // The article history keeps on them, once they are out of the chair.
        world.bios?.[r.persona.id]
          ? el('button', {
            class: 'btn sm ghost', style: { marginLeft: '8px' },
            title: 'The encyclopaedia entry',
            onclick: (ev) => { ev.stopPropagation(); S.bioPersona = r.persona.id; S.modal = 'bio'; CTX.rerender(true); },
          }, world.bios[r.persona.id].final ? 'bio ✓' : 'bio')
          : null),
      el('span', { class: 'mono ' + (r.overall > 60 ? 'green' : r.overall < 40 ? 'red' : '') }, r.overall))),
    rows.length ? null : el('div', { class: 'dim small' },
      head ? `Nobody has been ${head.name} yet. The historians are waiting.` : null));
}

/**
 * The reports. What the court has held is public even though the court itself is
 * a closed room, so the holdings sit with the rest of the public record rather
 * than behind the door that only the bench and a live party can open.
 */
function courtReports(world) {
  const reports = (world.precedents || []).slice().reverse();
  const decided = (world.cases || []).filter((c) => c.status === 'decided').slice(-6).reverse();
  return el('div', { class: 'card np-box' }, el('h3', {}, 'The reports'),
    el('p', { class: 'tiny dimmer' },
      'What the court has held. A later case on the same question argues against these.'),
    reports.length ? null : el('div', { class: 'dim small' }, 'No precedent yet. The first case decided writes the first line.'),
    ...reports.map((pr) => el('div', { style: { padding: '7px 0', borderTop: '1px solid var(--rule-strong)', opacity: pr.overruled ? 0.5 : 1 } },
      el('div', { class: 'spread' },
        el('b', { class: 'small serif' }, pr.cite),
        el('span', { class: 'tag ' + (pr.ruling === 'struck' ? 'purple' : 'green') }, pr.ruling)),
      el('div', { class: 'tiny' }, pr.holding),
      pr.overruled ? el('div', { class: 'tiny red' }, 'Overruled.') : null)),
    decided.length ? el('div', { class: 'tiny dimmer', style: { marginTop: '10px', paddingTop: '6px', borderTop: '1px solid var(--rule)' } }, 'Lately decided') : null,
    ...decided.map((c) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
      el('span', { class: 'serif' }, c.title),
      el('span', { class: 'tiny ' + (c.ruling === 'struck' ? 'red' : 'green') },
        `${c.ruling === 'struck' ? 'struck' : 'upheld'} ${c.tally?.strike ?? 0}–${c.tally?.uphold ?? 0}`))));
}

function chronRow(e, interactive) {
  const world = w();
  const k = C.KINDS[e.kind] || C.KINDS.system;
  const row = el('div', { class: 'ch ' + k.cls },
    el('span', { class: 'd' }, e.date),
    el('span', { class: 'i' }, k.icon),
    el('div', {}, el('span', { class: 't' }, e.text),
      ...e.annotations.map((a) => el('div', { class: 'ann' },
        el('b', {}, world.personas[a.personaId]?.name || 'Anonymous'), a.stance === 'dispute' ? ' disputes this: ' : ' notes: ', a.text)),
      // The contest button appears only where there is an interpretation to
      // contest — a player-influenced entry. The record of a bare event (an
      // oath taken, a term ending, a citizen dying, an NPC secretary signing)
      // has nothing a player can dispute the meaning of. See chronicle.log.
      interactive && e.player ? el('button', {
        class: 'btn sm ghost contest', style: { marginTop: '3px', padding: '2px 6px', fontSize: '11px' },
        onclick: () => ask({
          title: 'Contest the record',
          body: e.text + '\n\nThe entry itself is permanent. Your account sits beside it.',
          label: 'Enter it in the record',
          input: { label: 'Your account of this event', multiline: true },
          onConfirm: (t) => t && go('ANNOTATE', { entryId: e.id, text: t, stance: 'dispute' }),
        }),
      }, 'contest') : null));
  return row;
}

// --- Season ----------------------------------------------------------------

VIEWS.season = (root) => {
  const world = w();
  root.append(el('h1', { class: 'page' }, 'The Season'),
    el('p', { class: 'sub' }, 'Seasons are designed to end. Collapse is not failure but the third act.'));

  root.append(el('div', { class: 'grid g2' },
    el('div', { class: 'card' }, el('h3', {}, 'This Season'),
      kv('Nation', world.nation), kv('Season', world.seasonName),
      kv('Constitution', world.constitution.name),
      kv('Canon dial', R.CANON[world.canon]?.label + ' — ' + R.CANON[world.canon]?.blurb),
      kv('Compressed time', `${world.clock.ticksPerYear} seconds per canon year (${(world.clock.ticksPerYear / 60).toFixed(1)} real minutes)`),
      kv('Elapsed', `${world.clock.tick} ticks · ${C.canonDate(world)}`),
      kv('Recorded acts', String(world.chronicle.length)),
      kv('Phase', world.phase)),

    el('div', { class: 'card' }, el('h3', {}, 'Players at the table'),
      ...Object.values(world.players).map((p) => el('div', { class: 'spread small', style: { padding: '4px 0' } },
        el('span', {}, el('span', { style: { color: p.color } }, '● '), p.name,
          p.moderator ? el('span', { class: 'tag purple', style: { marginLeft: '6px' } }, 'moderator') : null),
        el('span', { class: 'tiny dimmer' }, world.personas[p.personaId]?.name))),
      el('div', { class: 'quote', style: { marginTop: '10px' } },
        'No office grants moderation, and nobody can delete the nation.')),

    tableCard(),

    el('div', { class: 'card' }, el('h3', {}, 'Export'),
      el('p', { class: 'tiny dimmer' }, 'The endgame is the history: every act, vote, betrayal and death becomes chronicle.'),
      el('button', { class: 'btn primary', onclick: () => C.download(`${world.nation}-${world.seasonName}.md`, C.exportChronicle(world)) }, 'Download the chronicle'),
      el('div', { class: 'tiny dimmer', style: { marginTop: '8px' } },
        'Starting a new Season lives under “The table” above — not one player’s to do to the rest.')),
  ));

  if (world.phase === 'ended') {
    root.append(el('div', { class: 'card gold', style: { marginTop: '14px' } },
      el('h3', {}, 'Epitaph'), el('div', { class: 'quote' }, world.epitaph)));
  }
};

/**
 * Pausing and wiping are table decisions, not personal ones. Alone you simply
 * do them; with company you move and the table decides. 2/22/22 is the reason
 * no single player can end everyone else's Season.
 */
function tableCard() {
  const world = w();
  const active = ACT.activePlayers(world);
  const solo = active.length <= 1;
  const m = world.motion && !world.motion.closed ? world.motion : null;
  const paused = !!world.paused;

  const box = el('div', { class: 'card' }, el('h3', {}, 'The table'),
    el('div', { class: 'tiny dimmer', style: { marginBottom: '10px' } },
      solo
        ? 'Only you are active. Pausing and resetting take effect at once.'
        : `${active.length} players active. Pausing or resetting needs ${Math.floor(active.length / 2) + 1} to agree.`));

  if (m) {
    const yea = Object.values(m.votes).filter((v) => v === 'yea').length;
    const nay = Object.values(m.votes).filter((v) => v === 'nay').length;
    const mine = m.votes[CTX.playerId];
    box.append(
      el('div', { class: 'crisis', style: { marginBottom: '10px' } },
        el('b', {}, `${world.players[m.by]?.name || 'A player'} moves to ${ACT.MOTIONS[m.kind]?.label || m.kind}.`),
        el('div', { class: 'small dim', style: { margin: '6px 0' } },
          `${yea} for, ${nay} against — ${m.needed} of ${m.eligible} needed.`),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm' + (mine === 'yea' ? ' primary' : ''), onclick: () => go('MOTION_VOTE', { ballot: 'yea' }) }, 'Agree'),
          el('button', { class: 'btn sm' + (mine === 'nay' ? ' danger' : ''), onclick: () => go('MOTION_VOTE', { ballot: 'nay' }) }, 'Oppose'),
          m.by === CTX.playerId ? el('button', { class: 'btn sm ghost', onclick: () => go('MOTION_CANCEL', {}) }, 'Withdraw') : null)));
  }

  box.append(el('div', { class: 'row' },
    paused
      ? el('button', { class: 'btn primary', disabled: !!m, onclick: () => go('TABLE_MOTION', { kind: 'resume' }) },
          solo ? 'Resume the world' : 'Move to resume')
      : el('button', { class: 'btn', disabled: !!m, onclick: () => go('TABLE_MOTION', { kind: 'pause' }) },
          solo ? 'Pause the world' : 'Move to pause'),
    el('button', {
      class: 'btn danger', disabled: !!m,
      onclick: () => ask({
        title: solo ? 'Wipe this Season?' : 'Move to wipe this Season?',
        body: solo
          ? `${world.nation} — ${world.chronicle.length} recorded acts — will be erased from every open tab. Download the chronicle first to keep it.`
          : `This puts it to the table: ${Math.floor(active.length / 2) + 1} of ${active.length} active players must agree before anything is erased.`,
        label: solo ? 'Wipe it' : 'Put it to the table', danger: true,
        // Solo needs no table vote: the dialog is the one and only confirmation,
        // so wipe immediately rather than making the player press a second button.
        onConfirm: () => { if (solo) { CTX.net.wipeEverywhere(); location.reload(); } else go('TABLE_MOTION', { kind: 'reset' }); },
      }),
    }, solo ? 'Wipe and start over' : 'Move to reset the Season'),
    world.phase === 'live' || world.phase === 'collapse'
      ? el('button', {
          class: 'btn danger', disabled: !!m,
          onclick: () => ask({
            title: solo ? 'End the Season?' : 'Move to end the Season?',
            body: solo
              ? 'The world stops and the record closes, still browsable and exportable.'
              : `This puts it to the table: ${Math.floor(active.length / 2) + 1} of ${active.length} active players must agree. The record is kept.`,
            label: solo ? 'End it' : 'Put it to the table', danger: true,
            input: { label: 'Epitaph (optional)', placeholder: 'It was always going to end like this.', multiline: true },
            onConfirm: (ep) => go('TABLE_MOTION', { kind: 'end', payload: { epitaph: ep } }),
          }),
        }, solo ? 'End the Season' : 'Move to end the Season')
      : null));

  if (paused) box.append(el('div', { class: 'blocked', style: { marginTop: '10px' } },
    'Paused. Time, elections and crises stop; actions still work.'));

  if (world.resetApproved) box.append(el('div', { class: 'allowed', style: { marginTop: '10px' } },
    'The table has agreed to wipe the Season.',
    el('div', { style: { marginTop: '8px' } },
      el('button', { class: 'btn danger sm', onclick: () => { CTX.net.wipeEverywhere(); location.reload(); } }, 'Wipe it now'))));

  return box;
}

const kv = (k, v) => el('div', { class: 'spread small', style: { padding: '3px 0' } },
  el('span', { class: 'dimmer' }, k), el('span', { style: { textAlign: 'right' } }, v));

// --- Chat + modals ---------------------------------------------------------

/**
 * One text room, wherever it appears — the floor, the Oval Office, or a
 * conspiracy's private channel. Every room in the game behaves the same way:
 * the message lands the moment you press Enter, the caret stays where it is so
 * you can keep talking, and the log follows the newest line.
 *
 * The forced rebuild is the load-bearing part. The render loop deliberately
 * skips any view you are typing into so it cannot clobber a field mid-keystroke
 * — which is exactly the state you are in when you hit Enter, so a room that
 * only dispatched showed you nothing until you clicked away.
 *
 * `send(text)` dispatches; everything else is presentation.
 */
/** "President James Sun", or just the name for a private citizen. */
function speakerName(m) {
  const world = w();
  const p = world.personas[m.personaId];
  if (!p) return '?';
  const t = m.title !== undefined ? m.title : R.titleOf(world, m.personaId);
  return t ? `${t} ${p.name}` : p.name;
}

function textRoom({ key, title, messages, send, placeholder = 'Speak…', stamp = true, extra = null, header = null, cardClass = 'card' }) {
  const world = w();
  const inputId = 'roomin-' + key;
  const logId = 'roomlog-' + key;

  const onKey = (e) => {
    const text = e.target.value;
    if (e.key !== 'Enter' || !text.trim()) return;
    e.target.value = '';
    send(text);
    CTX.rerender(true);
    const box = document.getElementById(inputId);
    if (box) box.focus();
    const log = document.getElementById(logId);
    if (log) log.scrollTop = log.scrollHeight;
  };

  return el('div', { class: cardClass },
    title ? el('h3', {}, title) : null,
    header,
    el('div', { class: 'chatbox' },
      el('div', { class: 'chatlog', id: logId }, ...messages.map((m) => el('div', { class: 'msg' },
        // Titles are stamped when the line is spoken. Lines from before that
        // fall back to the speaker's office now, which is the best available
        // guess for a log that predates the stamp.
        el('b', {}, speakerName(m)), ' ', m.text,
        // A line that crossed the conduct floor is marked in the room it was
        // said in, so nobody has to take anyone's word for what was said.
        m.disrepute?.length
          ? el('span', { class: 'tag red', title: `On the record: ${m.disrepute.join('; ')}.` }, 'on the record')
          : null,
        stamp && m.ts ? el('span', { class: 'tm' }, timeAgo(m.ts)) : null))),
      el('input', { id: inputId, placeholder, style: { marginTop: '8px' }, onkeydown: onKey })),
    extra);
}

function chatCard(channel, titleOverride) {
  const world = w();
  const titles = {
    floor: 'The floor',
    oval: 'Oval Office — private',
    cloakroom: 'The House Cloakroom — the House only',
    cloakroom_upper: 'The Senate Cloakroom — the Senate and the chair',
    mansion: 'The Mansion — the Vice President and guests',
    // A department is no longer only its two keyholders; either of them can ask
    // somebody in, and whoever is in the building can hear the room.
    state: 'The Department of State — the Secretary, the President and their guests',
    defense: 'The Department of Defense — the Secretary, the President and their guests',
    exchequer: 'The Department of the Treasury — the Secretary, the President and their guests',
  };
  // The same door the engine checks (rules.mayHear), asked again on the way in.
  // The views that call this are already behind a gate, so this should never
  // fail — but the reader used to filter on the channel name alone, and a room
  // whose privacy depends on nobody navigating to it is not private.
  if (!R.mayHear(world, me()?.id, channel)) {
    return el('div', { class: 'card dim' }, 'That room is closed to you.');
  }
  return textRoom({
    key: 'chan-' + channel,
    title: titleOverride || titles[channel] || 'Chat',
    messages: world.chat.filter((m) => m.channel === channel).slice(-60),
    send: (text) => go('CHAT', { text, channel }),
  });
}

/**
 * In-app confirm / prompt. Native confirm() and prompt() are auto-dismissed by
 * embedded browsers and can be switched off by the user mid-session, which
 * silently turns destructive buttons into dead ones. Nothing here uses them.
 */
export function ask({ title, body, label = 'Confirm', danger = false, input = null, onConfirm }) {
  // With presets, the first one is selected rather than leaving the field blank:
  // the common case should be one click.
  S.ask = {
    title, body, label, danger, input, onConfirm,
    value: input?.value || (input?.presets?.length ? input.presets[0] : ''),
    custom: false,
  };
  S.modal = 'ask';
  CTX.rerender(true);
}

function askModal() {
  const a = S.ask;
  if (!a) return el('div', {}, 'Nothing to confirm.');
  const done = () => { S.modal = null; S.ask = null; CTX.rerender(true); };
  return el('div', {},
    el('h2', {}, a.title),
    a.body ? el('p', { class: 'sub' }, a.body) : null,
    // Where the same few reasons come up over and over, offer them — and keep
    // the blank field one choice away, because the interesting reason is always
    // the one nobody wrote down in advance.
    a.input?.presets?.length
      ? el('label', { class: 'field' }, el('span', {}, a.input.label),
        select([...a.input.presets.map((t) => [t, t]), ['__own__', 'Write my own…']],
          a.custom ? '__own__' : a.value,
          (v) => {
            if (v === '__own__') { a.custom = true; a.value = ''; } else { a.custom = false; a.value = v; }
            CTX.rerender(true);
          }))
      : null,
    a.input && (!a.input.presets?.length || a.custom)
      ? el('label', { class: 'field' },
        el('span', {}, a.input.presets?.length ? 'In your own words' : a.input.label),
        a.input.multiline
          ? el('textarea', { rows: 3, placeholder: a.input.placeholder || '', oninput: (e) => (a.value = e.target.value) }, a.value)
          : el('input', {
              value: a.value, placeholder: a.input.placeholder || '',
              oninput: (e) => (a.value = e.target.value),
              onkeydown: (e) => { if (e.key === 'Enter') { const v = a.value; done(); a.onConfirm(v); } },
            }))
      : null,
    el('div', { class: 'row', style: { marginTop: '14px' } },
      el('button', {
        class: 'btn ' + (a.danger ? 'danger' : 'primary'),
        onclick: () => { const v = a.value; done(); a.onConfirm(v); },
      }, a.label),
      el('button', { class: 'btn ghost', onclick: done }, 'Cancel')));
}

export function renderModal(root) {
  if (!S.modal) { root.replaceChildren(); return; }
  const close = () => {
    if (S.modal === 'compose') return closeComposer();
    if (S.modal === 'tutorial') markTutorialSeen();
    S.modal = null; CTX.rerender(true);
  };
  // Minimised, the ballot is not a modal at all: no backdrop, nothing blocked.
  if (S.modal === 'election' && S.electionMin) {
    root.replaceChildren(electionDock());
    return;
  }
  let body;
  if (S.modal === 'ask') body = askModal();
  else if (S.modal === 'tutorial') body = tutorialModal();
  else if (S.modal === 'compose') body = composeModal();
  else if (S.modal === 'persona') body = personaModal();
  else if (S.modal === 'rank') body = rankModal();
  else if (S.modal === 'join') body = joinModal();
  else if (S.modal === 'bio') body = bioModal();
  else if (S.modal === 'inauguration') body = inaugurationModal();
  else if (S.modal === 'election') body = electionModal();
  // Sticky: no backdrop dismissal, because there is nothing behind it to go back
  // to. During an election that is literally true — the clock is stopped.
  const sticky = S.modal === 'join' || S.modal === 'inauguration' || S.modal === 'election';
  root.replaceChildren(el('div', {
    class: 'modal-bg' + (S.modal === 'inauguration' ? ' inaug-bg' : ''),
    onclick: (e) => { if (e.target.classList.contains('modal-bg') && !sticky) close(); },
  }, el('div', { class: 'modal' + (S.modal === 'inauguration' ? ' inaug-modal' : '') }, body)));
  if (S.modal === 'join') focusJoinName();
}

// Seen-once per Season, per device — a reload doesn't replay it, a new Season does.
/**
 * Which tenure we are in, as a key.
 *
 * The oath was shown once per Season, so only the founding president ever got
 * one — every successor took office to a wall of numbers. A term is the person
 * and the day they took the chair, so a re-elected president gets a second
 * inauguration and a successor gets their own.
 */
export function termKey(world) {
  const head = R.headOffice(world);
  const seat = head && world.seats.find((s) => s.office === head.id && s.personaId);
  if (!seat) return null;
  return `${seat.personaId}@${seat.since ?? 0}`;
}

/** How recently this term began — an old oath is not news. */
export function termAge(world) {
  const head = R.headOffice(world);
  const seat = head && world.seats.find((s) => s.office === head.id && s.personaId);
  if (!seat) return Infinity;
  return world.clock.tick - (seat.since ?? 0);
}

export function inaugurationSeen(world) {
  const key = termKey(world);
  if (!key) return true;                      // nobody is in the chair to swear in
  try { return sessionStorage.getItem(`usgov.inaug.${world.seasonId}.${key}`) === '1'; } catch { return false; }
}
function markInaugurated(world) {
  const key = termKey(world);
  if (!key) return;
  try { sessionStorage.setItem(`usgov.inaug.${world.seasonId}.${key}`, '1'); } catch { /* no storage */ }
}

// A short ceremonial beat between ratification and the dashboard, so the Season
// opens on a moment instead of a wall of numbers.
function inaugurationModal() {
  const world = w();
  const eo = I.execOffice(world);
  const head = world.personas[I.headId(world)];
  const canon = R.CANON?.[world.canon];
  const oaths = [
    'I accept this office, its powers, and the blame bundled with them.',
    'I will govern as written, and answer for it as recorded.',
    'No grand promises — I will read the budget and try not to make it worse.',
    'This office is a loan, not a gift. I mean to give it back intact.',
    'I will hold the line until the voters, or the plotters, decide otherwise.',
    'I swear to keep to the constitution, at least while anyone is watching.',
  ];
  // Keyed to the tenure, so each president opens with a different line rather
  // than the whole century swearing the same one.
  let key = 0; const sid = String(termKey(world) || world.seasonId || world.nation);
  for (let i = 0; i < sid.length; i++) key = (key * 31 + sid.charCodeAt(i)) >>> 0;
  const current = S.inaugLine != null ? S.inaugLine : oaths[key % oaths.length];
  const iAmHead = !!(head && head.playerId === CTX.playerId);
  // Whether the oath has actually been taken yet — the thing everyone else is
  // waiting on, and the thing that starts the calendar.
  const sworn = world.inaugurated != null;
  const setLine = (line) => { S.inaugLine = line; const ln = document.getElementById('inaugLine'); if (ln) ln.textContent = '“' + (line || '…') + '”'; };

  // Only the first head of government founds the republic. world.inaugurated is
  // stamped once, at that first oath, and never again (see actions.js), so a null
  // here means this is the founding and anything else means a later administration
  // taking office in a republic that already stands.
  const founding = world.inaugurated == null;
  return el('div', { class: 'inaug' },
    // The tableau is rasterised in scene.js now, on the same grid and out of the
    // same seasonal palette as the room the new President is about to walk into.
    // The colours the building is dressed in are the incoming administration's
    // — the party of whoever is taking the oath, which at the founding is the
    // chair you chose your side for at the convention. A president who sits
    // independent is sworn in under the national flag alone.
    el('div', {
      class: 'inaug-scene',
      html: SC.inaugurationScene(world, head?.gender || 'x',
        PARTIES.find((x) => x.id === head?.party)?.color || null),
    }),
    el('div', { class: 'inaug-kicker' }, founding ? 'The founding of' : 'A new administration of'),
    el('h1', { class: 'inaug-nation' }, world.nation),
    el('div', { class: 'inaug-sub serif' }, world.constitution.name + (canon ? ' · ' + canon.label : '')),
    el('div', { class: 'inaug-rule' }),
    el('p', { class: 'inaug-oath serif' }, head
      ? `${head.name} rises to take the oath as ${eo?.name || 'head of government'}.`
      : 'The offices are filled, and the Season begins.'),
    el('p', { class: 'inaug-line serif', id: 'inaugLine' }, `“${current || '…'}”`),
    // The words are the head of government's to choose, and nobody else's. Every
    // other player watches somebody else be sworn in — which is what everybody
    // else does at an inauguration. Offering the whole table a picker implied a
    // vote on the oath, and only one of the choices was ever going to be entered
    // in the Chronicle anyway.
    iAmHead
      ? el('div', { class: 'inaug-choose' },
        el('div', { class: 'tiny dimmer', style: { marginBottom: '6px' } }, 'Your words go in the Chronicle'),
        el('div', { class: 'inaug-oaths' }, ...oaths.map((o) => el('button', {
          class: 'btn sm oath ' + (o === current ? 'on' : ''),
          onclick: (e) => {
            setLine(o);
            for (const b of e.currentTarget.parentElement.children) b.className = 'btn sm oath';
            e.currentTarget.className = 'btn sm oath on';
            const custom = document.getElementById('inaugCustom'); if (custom) custom.value = '';
          },
        }, o))),
        el('input', {
          id: 'inaugCustom', class: 'inaug-custom', placeholder: 'Or write your own…',
          value: oaths.includes(current) ? '' : (current || ''),
          oninput: (e) => {
            setLine(e.target.value);
            for (const b of document.querySelectorAll('.inaug-oaths .btn')) b.className = 'btn sm oath';
          },
        }))
      : el('div', { class: 'tiny dimmer' }, head ? `${head.name} chooses the words.` : null),
    world.constitution.preamble ? el('p', { class: 'inaug-preamble serif' }, world.constitution.preamble) : null,
    // Nobody walks out of the inauguration before it has happened. The clock is
    // held at the first tick until the oath is taken (see sim.tick), so a guest
    // who dismissed this early was not skipping ahead — they were leaving
    // themselves staring at a stopped world with no way back to the room. The
    // one being sworn in is the only one who can end it.
    iAmHead || !head || sworn
      ? el('button', { class: 'btn primary', style: { marginTop: '18px' }, onclick: () => {
        const line = (S.inaugLine != null ? S.inaugLine : oaths[key % oaths.length]).trim();
        if (iAmHead && line) go('OATH', { line });
        markInaugurated(world); S.inaugLine = null; S.modal = null; CTX.rerender(true);
      } }, iAmHead ? 'Take office' : 'Enter the republic')
      : el('div', { class: 'inaug-wait tiny dimmer', style: { marginTop: '18px' } },
        `Waiting on ${head.name} to take the oath. The calendar has not started.`));
}

function personaModal() {
  const world = w();
  const old = me();
  return el('div', {},
    el('h2', {}, 'A new persona'),
    el('p', { class: 'sub' }, 'Death, exile and imprisonment happen to characters, not players. Roll a new persona, keeping reputation.'),
    el('label', { class: 'field' }, el('span', {}, 'Name'), el('input', { id: 'pname', value: old?.name || '' })),
    el('label', { class: 'field' }, el('span', {}, 'A line about them'), el('textarea', { id: 'pbio', rows: 2 })),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn primary', onclick: () => {
          go('NEW_PERSONA', { name: document.getElementById('pname').value, bio: document.getElementById('pbio').value, inherit: true });
          S.modal = null; CTX.rerender(true);
        },
      }, 'Continue the line'),
      el('button', {
        class: 'btn', onclick: () => {
          go('NEW_PERSONA', { name: document.getElementById('pname').value, bio: document.getElementById('pbio').value, inherit: false });
          S.modal = null; CTX.rerender(true);
        },
      }, 'A stranger, unrelated'),
      el('button', { class: 'btn ghost', onclick: () => { S.modal = null; CTX.rerender(true); } }, 'Cancel')));
}

function rankModal() {
  const world = w();
  const row = C.computeRanking(world).find((r) => r.persona.id === S.rankPersona);
  if (!row) return el('div', {}, 'No record.');
  return el('div', {},
    el('h2', {}, row.persona.name),
    el('p', { class: 'sub' }, `${C.heldAs(row)}${row.sitting ? ', sitting' : ''} · ${row.acts} acts of record · overall ${row.overall}`),
    ...C.ATTRIBUTES.map((a) => el('div', { class: 'meter', style: { margin: '7px 0' } },
      el('span', { class: 'lab' }, a),
      el('input', {
        type: 'range', min: 1, max: 100, value: row.scores[a],
        onchange: (e) => go('HISTORIAN_VOTE', { personaId: row.persona.id, attribute: a, score: +e.target.value }),
      }),
      el('span', { class: 'val' }, row.scores[a]))),
    el('div', { class: 'quote' }, C.obituary(world, row.persona)),
    el('button', { class: 'btn', onclick: () => { S.modal = null; CTX.rerender(true); } }, 'Close'));
}

function joinModal() {
  const world = w();
  // The rejection has to survive a re-render: clicking the button moves focus
  // off the input, the modal repaints, and a message set on the DOM node alone
  // would vanish before it could be read. So it lives in UI state, cleared only
  // when the player edits the field.
  const engineReason = (world.rejoin || {})[CTX.playerId]?.reason;
  const shown = S.joinError || engineReason;
  const input = el('input', {
    id: 'joinname', placeholder: 'e.g. John Smith', value: S.joinName || '',
    oninput: (e) => { S.joinName = e.target.value; if (S.joinError) { S.joinError = null; CTX.rerender(true); } },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } },
  });

  function submit() {
    const n = (S.joinName || input.value).trim();
    if (!n) { S.joinError = 'Enter a name to take a seat.'; return CTX.rerender(true); }
    // Check against the table we can see, so the rejection is instant rather
    // than a round-trip; the engine enforces it regardless.
    if (ACT.nameTaken(world, n, CTX.playerId)) {
      S.joinError = `The name “${n}” is already taken at this table. Choose another.`;
      return CTX.rerender(true);
    }
    S.joinError = null; S.joinName = '';
    go('JOIN', { name: n });
    S.modal = null; CTX.rerender(true);
  }

  return el('div', {},
    el('h2', {}, 'Take a seat'),
    el('p', { class: 'sub' }, 'Each browser tab is one player. Open another to bring someone else in.'),
    shown ? el('div', { class: 'blocked', style: { marginBottom: '10px' } }, shown) : null,
    el('label', { class: 'field' }, el('span', {}, 'Your name'), input),
    el('div', { class: 'tiny dimmer', style: { margin: '-4px 0 10px' } },
      'What the table calls you.'),
    Object.values(world.players).length
      ? el('div', { class: 'tiny dimmer', style: { marginBottom: '10px' } },
          'Already at the table: ', Object.values(world.players).map((p) => p.name).join(', '))
      : null,
    el('button', { class: 'btn primary', onclick: submit }, 'Enter the convention'));
}

// The join box is the first thing a second tab sees, so the caret starts in it.
export function focusJoinName() {
  const f = document.getElementById('joinname');
  if (f && document.activeElement !== f && document.activeElement === document.body) f.focus();
}

const NAV_LABEL = Object.fromEntries(NAV.map(([id, , label]) => [id, label]));

export function renderNotices(root) {
  const world = w();
  const mine = (world.notices || []).filter((n) => n.playerId === CTX.playerId && Date.now() - n.ts < 7000);

  // Something demanding an answer has appeared on a tab you are not looking
  // at. Say so once, and offer to take you there.
  const items = actionItems(world);
  S.alertSeen = S.alertSeen || {};
  // An alert is a tap on the shoulder about a room you are not in. Once you are
  // in that room it has done its job, however you got there — the "Go to"
  // button cleared it, but walking over yourself left it sitting in the corner
  // pointing at the tab you were already reading.
  S.alerts = (S.alerts || []).filter((a) => Date.now() - a.ts < 45000 && a.tab !== S.view);
  // One thing, one alert. A war or spy crisis is an open event, so it counts on
  // the Nation tab *and* appears under Intrigue — and the player got two toasts
  // about the single card they had not read yet. The Nation tab is where the
  // crisis is actually answered, so it wins, and any other tab pointing at the
  // same event stays quiet.
  const claimed = new Set(items.nation?.keys || []);
  const tabs = ['nation', ...Object.keys(items).filter((t) => t !== 'nation')];
  for (const tab of tabs) {
    const item = items[tab];
    if (!item) continue;
    const known = S.alertSeen[tab] || [];
    let fresh = item.keys.filter((k) => !known.includes(k));
    S.alertSeen[tab] = item.keys.slice();
    if (tab !== 'nation') fresh = fresh.filter((k) => !claimed.has(k));
    if (!fresh.length || S.view === tab || !world.players[CTX.playerId]) continue;
    S.alerts.push({ id: fresh[0], tab, text: item.label(fresh.length), ts: Date.now() });
  }

  root.replaceChildren(
    ...S.alerts.slice(-2).map((a) => el('div', { class: 'alert' },
      el('div', {}, el('b', {}, NAV_LABEL[a.tab] || a.tab), ' — ', a.text),
      el('div', { class: 'row', style: { marginTop: '7px' } },
        el('button', { class: 'btn sm primary', onclick: () => { S.view = a.tab; S.alerts = S.alerts.filter((x) => x !== a); CTX.rerender(true); } }, `Go to ${NAV_LABEL[a.tab] || a.tab}`),
        el('button', { class: 'btn sm ghost', onclick: () => { S.alerts = S.alerts.filter((x) => x !== a); CTX.rerender(true); } }, 'Ignore')))),
    ...mine.slice(-3).map((n) => el('div', { class: n.tone === 'ok' ? 'ok' : '' }, n.text)));
}

// The constitution is configuration. This module compiles a constitution
// document into enforced rules, and answers every "may I?" question the rest
// of the engine asks. Nothing else in the codebase is allowed to decide who
// can spend, appoint, veto or arrest — it asks here, and the answer always
// carries the clause it came from, so the UI can quote the law back at you.

import { byId, clamp, nudgeApproval, dayIndex, nextDay, yearAt, tickOf, currentAge, POLITICAL_BASE_AGE, midThe } from './util.js';

// The price of a clause is declared once, on the clause (see acts.CLAUSES),
// and the vote threshold reads that same declaration. This used to be a third
// hand-kept copy of the price list, and it had drifted: BUILD read `cl.amount`
// (a field BUILD clauses don't have) and RAISE_DIVISIONS wasn't priced at all,
// so both slipped under the chamber's spending threshold. acts.js hands its
// clauseCost in when it loads — importing it here would close a module cycle
// through world.js that trips acts' eager use of BUILDINGS.
let clausePrice = () => 0;
export const _setClausePrice = (fn) => { clausePrice = fn; };

export const POWERS = {
  propose_bill: 'Propose bills',
  vote: 'Vote on the floor',
  veto: 'Veto legislation',
  promulgate: 'Sign bills into law',
  spend: 'Disburse from the treasury',
  tax: 'Set rates of taxation',
  appoint: 'Appoint to office',
  pardon: 'Pardon',
  arrest: 'Order arrest & detention',
  emergency: 'Declare a state of emergency',
  declare_war: 'Declare war',
  sign_treaty: 'Sign treaties',
  command_military: 'Command the armed forces',
  strike_law: 'Strike laws as unconstitutional',
  zone: 'Zone land & order construction',
  impeach: 'Bring articles of impeachment',
};

/**
 * The powers, grouped the way a founder actually thinks about them. Seventeen
 * chips in one undifferentiated wall is a list you scan; five short rows with
 * names on them is a set of decisions you can make one at a time — and the
 * grouping itself teaches what separation of powers means here.
 */
export const POWER_GROUPS = [
  { label: 'Lawmaking', ids: ['propose_bill', 'vote', 'veto', 'promulgate'] },
  { label: 'Money', ids: ['spend', 'tax'] },
  { label: 'Executive', ids: ['appoint', 'zone', 'emergency', 'command_military', 'sign_treaty', 'declare_war'] },
  { label: 'Justice', ids: ['arrest', 'pardon', 'strike_law', 'impeach'] },
];

export const MAX_SEATS = 20;

/**
 * How large each chair may be made at the convention.
 *
 * One ceiling for everything was 20, which let a table found a republic with
 * twenty presidents. That is not a constitution anyone has to live inside; it
 * is a way of finding out what the engine does when the executive is a crowd,
 * and the answer was nothing interesting. These are the shapes the rest of the
 * game is written for: one head of state, a deputy or two behind them, a bench
 * small enough to name and odd enough to decide, and a chamber that fits on
 * the floor.
 *
 * An office the convention invents is not in this table and keeps the general
 * ceiling. The cap is a maximum, not a requirement — zero seats still means
 * "this office will not exist", and that is still allowed for all of them.
 */
export const SEAT_CAP = {
  president: 1, premier: 1,
  vp: 2,
  justice: 13, magistrate: 13,
  ag: 1,
  assembly: 60, council: 20, senate: 20,
};
export const seatCap = (officeId) => SEAT_CAP[officeId] ?? MAX_SEATS;

export const CANON = {
  grounded: { label: 'Grounded municipal', blurb: 'Budgets, zoning, scandal. No magic, no nukes.', allow: [] },
  cold: { label: 'Cold war', blurb: 'Spies, coups, foreign powers, conventional war.', allow: ['spy', 'war', 'coup'] },
  hot: { label: 'Anything goes', blurb: 'Nukes, bioweapons, Nexus cells, god-tier Hellhounds.', allow: ['spy', 'war', 'coup', 'wmd', 'occult'] },
};

// ---------------------------------------------------------------------------
// Templates — the arc of Silver is a group iterating through political science
// one collapse at a time. Ship the whole spectrum and let them find out.
// ---------------------------------------------------------------------------

const RIGHTS = {
  press: { id: 'press', name: 'Freedom of the Press', text: 'No office shall abridge the founding or publication of a newspaper.', blocks: ['SEIZE_PRESS'] },
  speech: { id: 'speech', name: 'Freedom of Speech', text: 'No citizen shall be detained for words alone.', blocks: ['ARREST_SPEECH'] },
  dueProcess: { id: 'dueProcess', name: 'Due Process', text: 'No detention without charge recorded in the Chronicle.', blocks: ['ARREST_NOCHARGE'] },
  property: { id: 'property', name: 'Property', text: 'No taking of land without compensation at assessed value.', blocks: ['SEIZE_LAND'] },
  assembly: { id: 'assembly', name: 'Assembly', text: 'Citizens may organize, petition, and demonstrate.', blocks: ['BAN_FACTION'] },
  equalProtection: { id: 'equalProtection', name: 'Equal Protection', text: 'No law shall rank citizens by race, blood or ancestry, nor set the state against a people for what they are.', blocks: ['EQUAL_PROTECTION'] },
  // The one right that names nothing. Every other entry here blocks a specific
  // act, which means a constitution's silences are permissions: whatever the
  // founders did not think to write down, a later majority may do. This says
  // the silence is not a permission and hands the question to the bench.
  //
  // It blocks nothing by itself, deliberately. What it does is let the court
  // reach an act that collides with no *written* right — at a lower weight
  // than a written one, and without the protection from a landslide that a
  // written right carries, because a right the bench has to construct is a
  // harder argument than a right it can point at.
  unenumerated: {
    id: 'unenumerated', name: 'Rights Retained', open: true, blocks: [],
    text: 'The rights written here are not all there are. Where this constitution is silent, its silence denies nothing, and the court shall say what the people kept.',
  },
};

export const TEMPLATES = [
  {
    id: 'elective-autocracy',
    label: 'Elective Autocracy',
    // Archived for now: kept in code (and still resolves for any saved world on
    // it) but withheld from the picker via PICKABLE_TEMPLATES.
    archived: true,
    // Each regime has a colour identity: it draws its card at the convention
    // and becomes the Season's brand once the world is founded, so an
    // autocracy and a republic are told apart at a glance.
    color: '#8c1d18', colorHi: '#a3251f', // imperial wine
    blurb: "Mini's original sin. One office, all powers, elected forever. Fast, decisive, doomed.",
    build: (nation) => ({
      name: `Charter of ${midThe(nation)}`,
      template: 'elective-autocracy',
      preamble: `We, the founders of ${nation}, vest the whole executive, legislative and judicial power of the state in one office, and trust to the character of the one who holds it.`,
      offices: [
        { id: 'president', name: 'President', seats: 1, selection: 'election', termYears: 6, electorate: 'nation', termLimit: 2,
          powers: ['propose_bill', 'vote', 'promulgate', 'spend', 'tax', 'appoint', 'pardon', 'arrest', 'emergency', 'declare_war', 'sign_treaty', 'command_military', 'zone', 'strike_law'] },
        { id: 'minister', name: 'Minister', seats: 3, selection: 'appointment', appointedBy: 'president', termYears: 6,
          powers: ['propose_bill', 'vote', 'zone'] },
      ],
      legislature: { chamber: 'minister', proposalRights: ['president', 'minister'], passFraction: 0.5, quorum: 0.34, vetoOffice: 'president', overrideFraction: 1.01 },
      spending: [{ above: 0, requires: null }],
      discretion: { cap: 4e10, years: 1 },
      elections: { citizenWeight: 1, playerWeight: 3 },
      rights: [RIGHTS.property],
      impeachment: { proposalRights: ['minister'], fraction: 1.0, tries: 'minister', appliesTo: ['president'] },
      amendment: { fraction: 0.5, chamber: 'minister', alsoRequires: ['president'] },
      judiciary: null,
      emergency: { office: 'president', suspendsLegislature: true, maxYears: 4 },
      // Who holds the interest rate. An independent bank follows the Taylor
      // rule and ignores the calendar; a bank under the chair does whatever the
      // chair wants, which before an election is always the same thing. Both
      // are real constitutional choices and the game scores neither as correct
      // — see macro.tickMacro, which reads only `independent`.
      centralBank: { independent: false, office: 'exchequer' },
    }),
  },
  {
    id: 'parliamentary-council',
    label: 'Parliamentary Council',
    color: '#44576b', colorHi: '#52687f', // council slate
    // Archived for now: the definition is preserved and still resolves for any
    // existing world on this template, but it is hidden from the convention's
    // selection UI (see PICKABLE_TEMPLATES). Drop this flag to bring it back.
    archived: true,
    blurb: 'A council that chooses its own head and can un-choose them in an afternoon. Volatile by design.',
    build: (nation) => ({
      name: `Constitution of the ${nation} Council`,
      template: 'parliamentary-council',
      preamble: `The sovereign power of ${midThe(nation)} resides in the Council, which shall answer to the districts, and in the Premier, who shall answer to the Council.`,
      offices: [
        { id: 'council', name: 'Council', seats: 7, selection: 'election', termYears: 3, electorate: 'district',
          powers: ['propose_bill', 'vote', 'impeach', 'tax'] },
        { id: 'premier', name: 'Premier', seats: 1, selection: 'appointment', appointedBy: 'council', termYears: 3,
          powers: ['spend', 'appoint', 'promulgate', 'command_military', 'sign_treaty', 'zone', 'emergency'] },
        { id: 'magistrate', name: 'Magistrate', seats: 1, selection: 'appointment', appointedBy: 'council', termYears: 6,
          powers: ['strike_law', 'pardon', 'arrest'] },
      ],
      legislature: { chamber: 'council', proposalRights: ['council', 'premier'], passFraction: 0.5, quorum: 0.5, vetoOffice: null, overrideFraction: 0.5 },
      spending: [{ above: 0, requires: null }, { above: 5e9, requires: { body: 'council', fraction: 0.5 } }],
      discretion: { cap: 1.2e10, years: 1 },
      elections: { citizenWeight: 1, playerWeight: 2 },
      rights: [RIGHTS.press, RIGHTS.speech, RIGHTS.assembly, RIGHTS.equalProtection],
      impeachment: { proposalRights: ['council'], fraction: 0.5, tries: 'council', appliesTo: ['premier', 'magistrate'] },
      amendment: { fraction: 0.6, chamber: 'council', alsoRequires: [] },
      judiciary: { office: 'magistrate', canStrike: true },
      emergency: { office: 'premier', suspendsLegislature: false, maxYears: 1 },
      // Who holds the interest rate — see the note on the first template.
      centralBank: { independent: true, office: 'exchequer' },
    }),
  },
  {
    id: 'federal-republic',
    label: 'Federal Republic with Judiciary',
    color: '#2f6fdb', colorHi: '#4680e4', // federal blue
    blurb: 'Separated powers, a court that can strike your law, a 3/5 rule on big money. Slow. Survivable.',
    build: (nation) => ({
      name: `Constitution of ${midThe(nation)}`,
      template: 'federal-republic',
      preamble: `We the People of ${midThe(nation)}, in order to bind our own hands against our own worst hours, ordain and establish this Constitution.`,
      offices: [
        // **Apportioned, not one per state.** The House had twenty seats, one
        // for each state, which made it the Senate with a shorter term — the
        // same twenty people representing the same twenty electorates, and no
        // answer to why there were two chambers at all. The whole point of the
        // lower house is that it represents *people*: a state gets seats in
        // proportion to how many live there, so Texas sends five members and
        // the Great Plains sends one, and the two chambers finally disagree
        // about who the country is.
        //
        // `apportioned` is what says so. world.js divides these seats across the
        // states by population (Huntington–Hill, the real method), and each one
        // gets a numbered congressional district — TX-1, TX-2 — that is fixed at
        // the founding and does not move again.
        //
        // Forty-five, not four hundred and thirty-five: every member is a
        // simulated person with a party, an approval and a vote, and the floor
        // has to stay readable on one screen.
        //
        // The id stays `assembly` now that the chamber *has* been split in two,
        // and deliberately: `RIGHTS.assembly` is the freedom to assemble, and a
        // rename of the office id is a string sweep that cannot tell the two
        // apart. The label is what a player reads, and it reads "House".
        { id: 'assembly', name: 'House of Representatives', seats: 45, selection: 'election', termYears: 2, electorate: 'district', apportioned: true, minAge: 25,
          powers: ['propose_bill', 'vote', 'impeach', 'tax', 'declare_war'] },
        // The upper chamber, and **the chamber that decides how many states
        // there are**: it is the one house whose size is the number of states,
        // so world.js reads the map's district count off it rather than off the
        // House, whose seats are apportioned and therefore say nothing about how
        // many electorates exist.
        //
        // One per state rather than two, because a district election is one
        // contest per seat filtered to that seat's district (see
        // sim.closeElection) — two seats in one district with no way to tell
        // their fields apart would run the same race twice and return the same
        // winner twice. The House gets round that by giving every seat its own
        // numbered district; the Senate has no districts to give.
        //
        // Six years against the House's two, so a senator sits three House
        // elections away from the mood of the moment.
        // `cohorts: 3` is the Senate's three classes. The seats are dealt into
        // three groups at the founding and one group goes to the country every
        // two years, so the chamber turns over continuously and is never
        // dissolved — the whole point of the institution, and the reason a
        // Senate outlasts the wave that elected a House. Everything else in the
        // engine leaves `cohorts` unset and polls as one body.
        { id: 'senate', name: 'Senate', seats: 20, selection: 'election', termYears: 6, cohorts: 3, electorate: 'district', minAge: 30,
          powers: ['propose_bill', 'vote', 'impeach', 'tax', 'declare_war'] },
        // No `arrest`. The President of the United States does not detain
        // anybody: law officers do, under a warrant, and they answer to the
        // Attorney General — who holds the power here. The pardon stays, because
        // that one really is the President's alone (Article II §2).
        { id: 'president', name: 'President', seats: 1, selection: 'election', termYears: 4, electorate: 'nation', successor: 'vp', termLimit: 2, minAge: 35,
          powers: ['spend', 'appoint', 'promulgate', 'veto', 'pardon', 'command_military', 'sign_treaty', 'emergency', 'propose_bill', 'zone'] },
        // The Vice President is elected on the President's ticket (ticket:
        // 'president' — no separate ballot; a running mate wins or loses with the
        // President), serves out that term (termFollows) and succeeds to the office
        // if the President is removed (see President.successor). appointedBy lets the
        // President fill a mid-term VP vacancy by appointment.
        { id: 'vp', name: 'Vice President', seats: 1, selection: 'election', electorate: 'nation', ticket: 'president', appointedBy: 'president', termFollows: 'president', minAge: 35,
          powers: ['vote', 'propose_bill'] },
        // The cabinet secretaries hold their department's power in full, but serve
        // entirely at the President's pleasure: unfilled at the founding, never
        // auto-seated, no fixed term, named or dismissed at will (atWill). Hidden
        // from the convention panel since no one can hold one at the start.
        { id: 'state', name: 'Secretary of State', seats: 1, selection: 'appointment', appointedBy: 'president', atWill: true,
          powers: ['sign_treaty'] },
        { id: 'defense', name: 'Secretary of Defense', seats: 1, selection: 'appointment', appointedBy: 'president', atWill: true,
          powers: ['command_military'] },
        // The Attorney General runs the Department of Justice and holds the
        // power of arrest, which is where it belongs: in the United States the
        // executive does not detain anybody, law officers do, and they answer
        // to this chair. Everything else about the post is the same contract
        // the other secretaries sit under — named and dismissed at will, no
        // fixed term, unfilled at the founding.
        { id: 'ag', name: 'Attorney General', seats: 1, selection: 'appointment', appointedBy: 'president', atWill: true,
          powers: ['arrest'] },
        { id: 'exchequer', name: 'Secretary of the Treasury', seats: 1, selection: 'appointment', appointedBy: 'president', atWill: true,
          powers: [] },
        // `forLife` rather than a term. The Constitution gives judges their
        // offices "during good Behaviour" — no clock, and that is the whole
        // point of the branch: a bench that has to be reappointed is a bench
        // with something to lose by ruling against the person who appoints it.
        // A twelve-year term was a real proposal for the real Court and has
        // never been the law. Three seats rather than nine stays a scale
        // simplification; the tenure was not one.
        { id: 'justice', name: 'Supreme Court', seats: 3, selection: 'appointment', appointedBy: 'president', forLife: true,
          powers: ['strike_law'] },
      ],
      // `chamber` is where a measure starts and `upperChamber` is where it goes
      // next; a constitution that leaves `upperChamber` null is unicameral and
      // behaves exactly as it did before the split. Bills originate in the House
      // whoever files them — the simplification that keeps the stage a counter
      // rather than a direction, and the one the revenue clause would force
      // anyway.
      legislature: { chamber: 'assembly', upperChamber: 'senate', proposalRights: ['assembly', 'senate', 'president'], passFraction: 0.5, quorum: 0.5, vetoOffice: 'president', overrideFraction: 0.667 },
      spending: [
        { above: 0, requires: null },
        { above: 1e9, requires: { body: 'assembly', fraction: 0.5 } },
      ],
      discretion: { cap: 5e9, years: 1 },
      elections: { citizenWeight: 1, playerWeight: 1.5 },
      rights: [RIGHTS.press, RIGHTS.speech, RIGHTS.dueProcess, RIGHTS.property, RIGHTS.assembly, RIGHTS.equalProtection],
      // Two stages, and now two rooms: the House adopts articles at 1/2, which
      // opens a trial, and the Senate sits as the court and convicts at 2/3 to
      // remove. `convicts` is the trial's chamber; a unicameral constitution
      // leaves it null and the same body does both, as it always did.
      // `appliesTo` is the civil officers of the United States, and that is
      // not the same list as "everybody with a chair". *Blount* settled in 1797
      // that a member of Congress is not a civil officer and cannot be
      // impeached; each chamber expels its own by two thirds instead, under
      // Article I §5. The two chambers came off this list with that case.
      impeachment: { proposalRights: ['assembly'], fraction: 0.5, convictFraction: 0.667, tries: 'assembly', convicts: 'senate', appliesTo: ['president', 'vp', 'state', 'defense', 'exchequer', 'ag', 'justice'] },
      amendment: { fraction: 0.75, chamber: 'assembly', alsoRequires: [] },
      judiciary: { office: 'justice', canStrike: true },
      emergency: { office: 'president', suspendsLegislature: false, maxYears: 1 },
      // Who holds the interest rate — see the note on the first template.
      centralBank: { independent: true, office: 'exchequer' },
    }),
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[2];

/**
 * The offices a person of a given age could not hold, under a template.
 *
 * For the founding screen, which has no world behind it yet and so cannot ask a
 * live constitution. It reads the template rather than repeating the numbers,
 * so the warning under the age box and the rule the engine enforces cannot
 * drift apart — there is only the one place either of them comes from.
 */
export function officesBarredAt(age, templateId = 'federal-republic') {
  const t = templateById(templateId);
  if (!t) return [];
  return (t.build('The United States').offices || [])
    .filter((o) => (+o.minAge || 0) > age && o.selection === 'election')
    .map((o) => ({ id: o.id, name: o.name, minAge: +o.minAge }))
    .sort((a, b) => a.minAge - b.minAge || a.name.localeCompare(b.name));
}

// Templates a founder may pick at the Constitutional Convention. Archived
// templates remain in TEMPLATES (so saved worlds and templateById still resolve
// them) but are withheld from the selection UI.
export const PICKABLE_TEMPLATES = TEMPLATES.filter((t) => !t.archived);

// The office elected on a given office's ticket — e.g. the VP on the President's.
export const ticketMateOffice = (world, officeId) => (world.constitution.offices.find((o) => o.ticket === officeId) || {}).id || null;

// --- Queries against a live constitution -----------------------------------

export const office = (world, id) => byId(world.constitution.offices, id);
export const offices = (world) => world.constitution.offices;

/** Personas currently seated in an office. */
export function holders(world, officeId) {
  return world.seats.filter((s) => s.office === officeId && s.personaId)
    .map((s) => world.personas[s.personaId]).filter(Boolean);
}
export function seatOf(world, personaId) {
  return world.seats.find((s) => s.personaId === personaId) || null;
}
export function officesOf(world, personaId) {
  return world.seats.filter((s) => s.personaId === personaId)
    .map((s) => office(world, s.office)).filter(Boolean);
}

/**
 * How offices outrank one another when someone holds more than one, and when a
 * list of chairs wants the important ones first. A President who also sits on
 * something else is still addressed as President.
 */
export const PRESTIGE = { president: 100, premier: 95, vp: 92, justice: 85, magistrate: 78, state: 74, defense: 72, exchequer: 70, ag: 69, senate: 68, council: 62, assembly: 60, minister: 48 };

// The powers that make an office the executive rather than a member of one.
const EXECUTIVE_POWERS = ['appoint', 'promulgate', 'command_military', 'veto', 'pardon', 'emergency', 'sign_treaty', 'spend'];

/**
 * Which chair is the presidency — whatever this constitution happens to call it.
 *
 * Found by what the office can do, not by its id, because a constitution written
 * at the convention may have no office called "President" at all. The single seat
 * holding the most of the executive powers is the one history will hold
 * responsible; PRESTIGE settles a tie.
 */
export function headOffice(world) {
  const offices = world.constitution?.offices || [];
  const score = (o) => o.powers.filter((p) => EXECUTIVE_POWERS.includes(p)).length;
  const ranked = offices.filter((o) => score(o) > 0)
    .sort((a, b) => (b.seats === 1) - (a.seats === 1)
      || score(b) - score(a)
      || (PRESTIGE[b.id] ?? 30) - (PRESTIGE[a.id] ?? 30));
  return ranked[0] || null;
}

/**
 * Who answers for the republic when something happens to it.
 *
 * The chair, and nobody else. A crisis card is the executive being handed a
 * decision — evacuate the district, meet the strikers, deny the ledger page —
 * and every one of those answers is an act of government that lands in the
 * Chronicle under a name. Nothing enforced it: `respond` checked the powers an
 * individual *option* needed, so the options that cost nothing and exercise no
 * enumerated power were open to the whole republic. A justice of the Supreme
 * Court could clear the President's crises off the board from the Nation tab,
 * and the record would say they had.
 *
 * Found through headOffice, so this is the presidency under whatever name this
 * constitution gave it. If the chair is empty, nobody answers — and the crisis
 * resolves against the republic on its deadline, which is the honest outcome
 * of having no executive.
 */
export function mayAnswerCrisis(world, personaId) {
  if (!personaId) return false;
  const head = headOffice(world);
  return !!head && officesOf(world, personaId).some((o) => o.id === head.id);
}

/** "Presidential rankings", or whatever this republic calls the chair. */
export function headOfficeLabel(world) {
  const o = headOffice(world);
  if (!o) return 'Executive rankings';
  return o.id === 'president' ? 'Presidential rankings' : `Rankings of the ${o.name}`;
}

/** Everyone who holds or has held that chair. */
export function heldHeadOffice(world, personaId) {
  const head = headOffice(world);
  if (!head) return false;
  return [...world.seats, ...(world.pastSeats || [])]
    .some((s) => s.office === head.id && s.personaId === personaId);
}

/**
 * How a holder of an office is addressed, which is not always the office's own
 * name: a member of the Assembly is a Rep., not an "Assembly". An office the
 * players invented at the convention has no entry here and is addressed by its
 * name, which is the best guess available.
 */
export const ADDRESS = {
  president: 'President', vp: 'Vice President', premier: 'Premier',
  justice: 'Justice', magistrate: 'Magistrate',
  state: 'Secretary of State', defense: 'Secretary of Defense', ag: 'Attorney General',
  assembly: 'Rep.', senate: 'Sen.', council: 'Councillor', minister: 'Minister',
};

/**
 * Who may enter the Oval Office: the President always, the cabinet by default, and
 * anyone the President has personally invited.
 *
 * It lives here rather than in the UI because the engine needs it too — the light
 * switch in that room is a real action, and an action has to be able to say no.
 */
export function mayEnterOval(world, personaId) {
  if (!personaId) return false;
  if (ovalByOffice(world, personaId)) return true;
  return inviteAdmits(world, ovalGuests(world).find((x) => x.id === personaId));
}

/**
 * The chairs that carry a key to the Oval Office.
 *
 * Exported because the room has to *say* who may walk in, and the Oval Office
 * view was keeping its own copy of this list to say it with — a copy that had
 * lost the Treasury. The Secretary of the Treasury could open the door the
 * whole time; the door simply never listed them, so the one secretary whose
 * department the President argues with most looked like a guest who had not
 * been asked. One list, read by the rule and by the room.
 */
export const OVAL_KEY_OFFICES = ['president', 'vp', 'state', 'defense', 'exchequer', 'ag'];

/** Admitted by the chair they hold, rather than by invitation. */
export function ovalByOffice(world, personaId) {
  const offs = officesOf(world, personaId).map((o) => o.id);
  return offs.some((id) => OVAL_KEY_OFFICES.includes(id));
}

// --- Invitations to a closed room ------------------------------------------
/**
 * An invitation has two clocks on it, and they measure different things.
 *
 * The first is the offer. It sits there until the person answers, and if they
 * never do it goes away after a month — an unanswered invitation used to hang
 * in the world forever, so a President could paper the republic with offers and
 * every one of them stayed live until it was individually withdrawn.
 *
 * The second is the visit, and it does not start until they say yes. Two
 * months, counted from the acceptance rather than from the asking, because the
 * point of the limit is that an invitation is to a conversation and not to a
 * standing key — and a guest who took three weeks to reply should still get the
 * conversation they were offered.
 *
 * Nobody with an office on the door appears on any of these lists; they are
 * admitted by the chair they hold and their key does not expire.
 */
export const OVAL_INVITE_MONTHS = 2;
export const INVITE_ANSWER_MONTHS = 1;
const monthTicks = (world, months) =>
  Math.max(1, Math.round(((world.clock.ticksPerYear || 240) / 12) * months));
export const ovalInviteTicks = (world) => monthTicks(world, OVAL_INVITE_MONTHS);
export const inviteAnswerTicks = (world) => monthTicks(world, INVITE_ANSWER_MONTHS);

/** The rooms somebody can be asked into. A department is one of them now. */
export const INVITABLE_ROOMS = ['oval', 'state', 'defense', 'exchequer', 'ag'];

/**
 * One room's list, normalised.
 *
 * Three shapes have to read the same way. The oldest is a bare persona id, from
 * before invitations were stamped at all. The next is { id, at }, from before
 * they had to be answered — no `acceptedAt` key means the guest was let in on
 * the spot, so that is how it is read, and an old Season does not lose its
 * visitors halfway through. The current shape carries `acceptedAt: null` until
 * the guest answers.
 */
export function roomInvites(world, room) {
  const raw = room === 'oval' ? world.ovalInvites : (world.deptInvites || {})[room];
  return (raw || []).map((e) => (typeof e === 'string' ? { id: e, at: null } : e))
    .filter((e) => e && e.id);
}

export function setRoomInvites(world, room, list) {
  if (room === 'oval') { world.ovalInvites = list; return; }
  world.deptInvites = world.deptInvites || {};
  world.deptInvites[room] = list;
}

/** Every room this person has been asked into and has not yet answered for. */
export function pendingInvites(world, personaId) {
  if (!personaId) return [];
  return INVITABLE_ROOMS
    .filter((room) => room === 'oval' || deptExists(world, room))
    .map((room) => ({ room, invite: roomInvites(world, room).find((g) => g.id === personaId) }))
    .filter(({ invite }) => invite && invitePending(invite) && !inviteExpired(world, invite));
}

/** Asked, but has not said yes or no. A legacy entry has no such state. */
export const invitePending = (g) => !!g && g.acceptedAt === null;

/** When the two-month visit started: the acceptance, or the asking on old data. */
const acceptedFrom = (g) => (g.acceptedAt === undefined ? g.at : g.acceptedAt);

/** Ticks left for the guest to answer, or null if this is not an open offer. */
export function inviteAnswerLeft(world, g) {
  if (!invitePending(g) || g.at == null) return null;
  return Math.max(0, inviteAnswerTicks(world) - (world.clock.tick - g.at));
}

/** Ticks left on an accepted invitation, or null if it has no stamp yet. */
export function inviteLeft(world, g) {
  if (!g || invitePending(g)) return null;
  const from = acceptedFrom(g);
  if (from == null) return null;
  return Math.max(0, ovalInviteTicks(world) - (world.clock.tick - from));
}

/** True once either clock has run out — the offer's, or the visit's. */
export function inviteExpired(world, g) {
  const left = invitePending(g) ? inviteAnswerLeft(world, g) : inviteLeft(world, g);
  return left !== null && left <= 0;
}

/** The only question the doors ask: does this entry open one? */
export function inviteAdmits(world, g) {
  return !!g && !invitePending(g) && !inviteExpired(world, g);
}

// The Oval Office's own list, under the name the rest of the code knows it by.
export const ovalGuests = (world) => roomInvites(world, 'oval');
export const ovalInviteLeft = (world, guest) => inviteLeft(world, guest);
export const ovalInviteExpired = (world, guest) => inviteExpired(world, guest);

/**
 * Who may enter the Vice President's Mansion: the Vice President, and only the
 * people the Vice President has asked in.
 *
 * Deliberately narrower than the Oval. The Oval is where the executive works, so
 * the cabinet has the run of it; the Mansion is where the Vice President lives,
 * and nobody holds a key to it by virtue of an office. Not even the President —
 * who can, of course, be invited like anybody else.
 *
 * A constitution with no vice presidency has no mansion either, and the tab
 * simply never appears; the gate returns false for everyone and that is that.
 */
export function mayEnterMansion(world, personaId) {
  if (!personaId) return false;
  if (officesOf(world, personaId).some((o) => o.id === 'vp')) return true;
  // The guest list belongs to the Vice President who wrote it, not to the office.
  // Rather than clear it from each of the several places a seat can change hands —
  // election, appointment, succession, coup — it is stamped with its host and goes
  // dead the moment somebody else is living there.
  const vp = holders(world, 'vp')[0];
  if (!vp || world.mansionHost !== vp.id) return false;
  return (world.mansionInvites || []).includes(personaId);
}

/**
 * The chamber the presiding officer presides over — the Senate, or the only
 * chamber there is. The Vice President is President of the Senate; they do not
 * sit in the House and have no business in its cloakroom.
 */
export const presidedChamber = (world) => {
  const L = world?.constitution?.legislature || {};
  return L.upperChamber || L.chamber || null;
};

/** Does this person preside over a chamber without sitting in one? (The VP.) */
function presides(world, personaId) {
  const rooms = chambers(world);
  return officesOf(world, personaId).some((o) => !rooms.includes(o.id) && (o.powers || []).includes('vote'));
}

/**
 * Who may be in a cloakroom.
 *
 * There is one per chamber, because a cloakroom is not a lounge for the
 * legislature at large — it is the room off *your* floor, where your side counts
 * its own votes. One shared room let a senator read the House's whip count and a
 * representative read the Senate's, which is the opposite of what the room is
 * for: the two chambers are checks on each other, and a check that shares a
 * back room is not much of one.
 *
 * The Vice President is in the Senate's and only the Senate's. They preside over
 * it and break its ties (see tieBreaker); they hold nothing in the House.
 *
 * `chamberId` omitted asks the looser question — may they enter *any* cloakroom
 * — which is what the chat gate and the old callers want.
 */
export function mayEnterCloakroom(world, personaId, chamberId = null) {
  if (!personaId) return false;
  const mine = officesOf(world, personaId).map((o) => o.id);
  const presiding = presides(world, personaId);
  if (!chamberId) return chambers(world).some((r) => mine.includes(r)) || presiding;
  if (mine.includes(chamberId)) return true;
  return presiding && chamberId === presidedChamber(world);
}

/**
 * Who may hear — and therefore speak in — a given chat channel.
 *
 * Every closed room's door in one place, because the room gates and the chat
 * gate have to be the same gate. Before this, `CHAT` took whatever channel name
 * the action named and filed the line under it, and the reader filtered by
 * channel with no check at all: the only thing keeping the Oval Office private
 * was that the tab did not render. A dispatch typed into the console could both
 * read the room and speak into it.
 *
 * An unknown channel is refused rather than allowed. A new room has to come and
 * say who it is for.
 */
export function mayHear(world, personaId, channel) {
  if (channel === 'floor') return true;
  if (!personaId) return false;
  if (channel === 'oval') return mayEnterOval(world, personaId);
  // One channel per chamber. `cloakroom` is the lower chamber's — the name a
  // unicameral constitution keeps, and the one already on saved worlds — and
  // `cloakroom_upper` is the Senate's.
  if (channel === 'cloakroom') return mayEnterCloakroom(world, personaId, world.constitution?.legislature?.chamber || null);
  if (channel === 'cloakroom_upper') {
    const up = world.constitution?.legislature?.upperChamber;
    return !!up && mayEnterCloakroom(world, personaId, up);
  }
  if (channel === 'mansion') return mayEnterMansion(world, personaId);
  if (channel === 'state') return mayEnterDept(world, personaId, 'state');
  if (channel === 'defense') return mayEnterDept(world, personaId, 'defense');
  if (channel === 'exchequer') return mayEnterDept(world, personaId, 'exchequer');
  if (channel === 'ag') return mayEnterDept(world, personaId, 'ag');
  return false;
}

/**
 * Who may enter a department: the secretary who runs it, the President, and
 * whoever either of them has asked in and who has said yes.
 *
 * Still narrower than the Oval Office, because the two people who answer for
 * the building are the only two who hold a key to it. But a department that
 * nobody could ever be brought into was a room with no reason to have a door:
 * a Secretary of State could not put an ambassador in front of the President
 * without the conversation happening somewhere else entirely. An invitation
 * runs two months from the moment it is accepted and then the visitor is out
 * again, which is the difference between a meeting and a staff appointment.
 *
 * A constitution that never created the office has no such building, and the
 * tab does not exist.
 */
export function deptExists(world, officeId) {
  return !!office(world, officeId);
}

/** The two people who hold a key to this building by the chair they sit in. */
export function deptByOffice(world, personaId, officeId) {
  const offs = officesOf(world, personaId).map((o) => o.id);
  return offs.includes(officeId) || offs.includes('president');
}

export function mayEnterDept(world, personaId, officeId) {
  if (!personaId || !deptExists(world, officeId)) return false;
  if (deptByOffice(world, personaId, officeId)) return true;
  return inviteAdmits(world, roomInvites(world, officeId).find((g) => g.id === personaId));
}

/**
 * Who may move the interest rate.
 *
 * The one economic lever in the game whose owner is a constitutional question
 * rather than an enumerated power. An independent bank answers to nobody at the
 * table: it follows the Taylor rule, leans against inflation and the output gap,
 * and does not care that there is an election in four months. A bank under the
 * chair does what the chair says — which, four months before an election, is
 * always to cut. Neither is scored as the correct answer. The second one wins
 * the election and pays for it in the term after.
 */
export function mayMoveRates(world, personaId) {
  const cb = world.constitution?.centralBank;
  if (!personaId || !cb || cb.independent !== false) return false;
  const offs = officesOf(world, personaId).map((o) => o.id);
  return offs.includes(cb.office || 'exchequer') || offs.includes('president');
}

/** Whether this republic's bank answers to anybody. */
export const bankIsIndependent = (world) => world.constitution?.centralBank?.independent !== false;

/** Who may open this building to a visitor: its Secretary, or the President. */
export function mayInviteToDept(world, personaId, officeId) {
  return !!personaId && deptExists(world, officeId) && deptByOffice(world, personaId, officeId);
}

/**
 * How senior this person is, on the same scale the convention ranks chairs by —
 * so a list of people falls into the same order as the list of seats. Their most
 * senior office counts; a private citizen sorts below every officeholder.
 */
export function prestigeOf(world, personaId) {
  const offs = officesOf(world, personaId);
  if (!offs.length) return -1;
  return Math.max(...offs.map((o) => PRESTIGE[o.id] ?? 30));
}

/** The title a persona is addressed by — their most senior office, or null. */
export function titleOf(world, personaId) {
  const offs = officesOf(world, personaId);
  if (!offs.length) return null;
  const best = offs.slice().sort((a, b) => (PRESTIGE[b.id] ?? 30) - (PRESTIGE[a.id] ?? 30))[0];
  return best ? (ADDRESS[best.id] || best.name) : null;
}

/**
 * Does this persona hold `power`? Returns the granting office, or null.
 * Emergency powers can temporarily widen this — and the widening is logged.
 */
/**
 * How long a head of state is out of the country for a summit. A week.
 *
 * Short in ticks and expensive in the only currency the office actually has.
 * See depts.summon and `abroad` below: while it runs they hold none of their
 * powers, so a crisis that breaks that week breaks without a government.
 */
export const summitTicks = (world) => Math.max(1, Math.round((world.clock.ticksPerYear || 240) / 52));

/** Is this persona out of the country right now? */
export function abroad(world, personaId) {
  const s = world.summit;
  return !!(s && s.by === personaId && world.clock.tick < s.ends);
}

export function grantOf(world, personaId, power) {
  if (!personaId) return null;
  const p = world.personas[personaId];
  if (!p || !p.alive || p.imprisoned || p.exiled) return null;
  // Abroad is the same kind of fact as imprisoned: they still hold the office,
  // they are simply not there to exercise it. Putting it here rather than at
  // twenty call sites means every gate in the game already honours it — the
  // crisis card, the chequebook, the pen, the order to break ground.
  if (abroad(world, personaId)) return null;
  for (const o of officesOf(world, personaId)) {
    if (o.powers.includes(power)) return o;
  }
  const em = world.emergency;
  if (em && em.active) {
    const eo = world.constitution.emergency;
    if (eo && officesOf(world, personaId).some((o) => o.id === eo.office)) {
      // Not `arrest`. A state of emergency in the United States unlocks money,
      // land and the legislative initiative — the National Emergencies Act is a
      // budgeting instrument — and it does not hand the executive the power to
      // detain people. That was the one item on this list with no statute
      // behind it, and the one that mattered most.
      if (['spend', 'zone', 'propose_bill'].includes(power)) {
        return { ...office(world, eo.office), viaEmergency: true };
      }
    }
  }
  return null;
}
export const hasPower = (world, personaId, power) => !!grantOf(world, personaId, power);

/** The spending rule that applies to an amount, with the clause text. */
export function spendRule(world, amount) {
  const rules = [...(world.constitution.spending || [])].sort((a, b) => a.above - b.above);
  let match = rules[0] || { above: 0, requires: null };
  for (const r of rules) if (amount >= r.above) match = r;
  return match;
}

/**
 * A per-band ceiling is not a limit — it is a payment size. Without a rate
 * limit the executive can authorise $900k, then another $900k, forever, and a
 * "$1M needs the Assembly" rule means nothing. Every constitution therefore
 * carries a discretionary allowance: how much may be disbursed without a vote
 * over a rolling window of canon years.
 */
export function allowance(world) {
  const a = world.constitution.discretion;
  if (!a || !a.cap) return null;
  return { cap: a.cap, years: a.years || 1 };
}

/** What the executive has already spent inside the current window. */
export function discretionUsed(world) {
  const a = allowance(world);
  if (!a) return { used: 0, remaining: Infinity, cap: Infinity, resetsIn: 0 };
  const span = a.years * world.clock.ticksPerYear;
  const since = world.clock.tick - span;
  const used = (world.discretionLog || [])
    .filter((d) => d.tick > since)
    .reduce((s, d) => s + d.amount, 0);
  const oldest = (world.discretionLog || []).filter((d) => d.tick > since)[0];
  return {
    used, cap: a.cap, remaining: Math.max(0, a.cap - used), years: a.years,
    resetsIn: oldest ? Math.max(0, oldest.tick + span - world.clock.tick) : 0,
  };
}

export function spendClauseText(world, amount) {
  const r = spendRule(world, amount);
  if (!r.requires) return 'No vote required at this amount.';
  const body = office(world, r.requires.body);
  return `Disbursements at or above ${fmtThreshold(r.above)} need a ${fracText(r.requires.fraction)} vote of the ${body ? body.name : r.requires.body}.`;
}
const fmtThreshold = (n) => (n >= 1e6 ? '$' + n / 1e6 + 'M' : '$' + n.toLocaleString());
export function fracText(f) {
  const known = { 0.5: 'simple majority', 0.6: '3/5', 0.667: '2/3', 0.75: '3/4', 1: 'unanimous' };
  const k = Object.keys(known).find((k) => Math.abs(+k - f) < 0.005);
  return k ? known[k] : Math.round(f * 100) + '%';
}

// --- The chambers ----------------------------------------------------------
//
// A measure is in front of one room at a time. `legislature.chamber` is where it
// starts and `legislature.upperChamber` is where it goes next; a constitution
// that names only the first is unicameral, and every function below collapses to
// what it did before the split. `doc.chamberStage` is the index into that list —
// absent or 0 for the lower chamber, 1 for the upper — and acts.closeFloor is
// what advances it.

/** The legislative chambers, in the order a measure passes through them. */
export function chambers(world) {
  const L = world?.constitution?.legislature || {};
  return [L.chamber, L.upperChamber].filter(Boolean);
}

export const isBicameral = (world) => chambers(world).length > 1;

/** The chamber a measure is in front of right now. */
export function stageChamber(world, doc) {
  const ch = chambers(world);
  if (!ch.length) return null;
  return ch[Math.min(doc?.chamberStage || 0, ch.length - 1)];
}

/**
 * The chamber a measure goes to after passing the one it is in, or null if it
 * has cleared the legislature. Null too when the next room has nobody in it: an
 * empty chamber is not a veto, and a measure should not be trapped by a body
 * that does not exist to vote on it.
 */
export function nextChamber(world, doc) {
  const ch = chambers(world);
  const next = ch[(doc?.chamberStage || 0) + 1];
  return next && bodySeated(world, next) ? next : null;
}

/**
 * A body named by a template or a spending clause. Honoured as written — a
 * constitution may point a requirement at any office it likes — unless it names
 * the chamber a measure starts in, in which case the measure's own stage decides
 * which of the two rooms it is actually standing in.
 */
function stagedBody(world, named, doc) {
  const L = world?.constitution?.legislature || {};
  return named === L.chamber ? (stageChamber(world, doc) || named) : named;
}

/**
 * Voting requirement for a document, derived from its kind and its clauses.
 * Returns null when no seated body can try it — a constitution with no
 * legislature is a legitimate thing to write, and measures under it take
 * effect on signature alone.
 */
export function voteRequirement(world, doc) {
  const req = voteRequirementRaw(world, doc);
  return req && bodySeated(world, req.body) ? req : null;
}

function voteRequirementRaw(world, doc) {
  const c = world.constitution;
  if (doc.type === 'amendment')
    return { body: stagedBody(world, c.amendment.chamber, doc), fraction: c.amendment.fraction, quorum: 0.5, also: c.amendment.alsoRequires || [], label: 'Constitutional amendment' };
  if (doc.type === 'impeachment') {
    // The two phases are two rooms, not two readings: the House brings the
    // articles and the Senate tries them. Each phase votes once, so neither
    // stages — `convicts` falling back to `tries` is the unicameral case, where
    // the same chamber does both as it always did.
    const trial = !!doc.trialPhase;
    return { body: trial ? (c.impeachment.convicts || c.impeachment.tries) : c.impeachment.tries, quorum: 0.5, also: [],
      fraction: trial ? (c.impeachment.convictFraction || 0.75) : c.impeachment.fraction,
      label: trial ? 'Conviction at the impeachment trial' : 'Articles of impeachment' };
  }
  // Advice and consent, and only the upper chamber's: a treaty is ratified in
  // one room, not two. Unicameral constitutions ratify where they legislate.
  if (doc.type === 'treaty')
    return { body: c.legislature.upperChamber || c.legislature.chamber, fraction: 0.5, quorum: 0.5, also: [], label: 'Ratification' };
  if (doc.type === 'order') return null; // executive orders do not go to a vote

  // A bill takes the strictest requirement any of its clauses demands.
  let frac = c.legislature.passFraction, body = stageChamber(world, doc) || c.legislature.chamber, why = 'Ordinary legislation';
  for (const cl of doc.clauses) {
    const amt = clausePrice(world, cl);
    if (amt > 0) {
      const r = spendRule(world, amt);
      if (r.requires && r.requires.fraction > frac) {
        // The threshold raises the bar; it does not pull the bill back into the
        // room it has already left. A spending rule that names the originating
        // chamber (which is what every template writes) still follows the stage,
        // so a $2M appropriation needs three fifths of *whichever* chamber is
        // sitting on it. Only a rule naming some other body overrides that.
        frac = r.requires.fraction; body = stagedBody(world, r.requires.body, doc);
        why = `Appropriation of ${fmtThreshold(r.above)} or more`;
      }
    }
  }
  return { body, fraction: frac, quorum: c.legislature.quorum, also: [], label: why };
}

/** Who may put this document on the floor. */
export function mayPropose(world, personaId, type) {
  const c = world.constitution;
  const mine = officesOf(world, personaId).map((o) => o.id);
  if (type === 'impeachment') {
    const ok = c.impeachment.proposalRights.some((r) => mine.includes(r));
    return ok ? { ok: true } : { ok: false, reason: `Only the ${c.impeachment.proposalRights.map((r) => office(world, r)?.name || r).join(' or ')} may bring articles of impeachment.` };
  }
  if (type === 'order') {
    const g = grantOf(world, personaId, 'spend') || grantOf(world, personaId, 'appoint') || grantOf(world, personaId, 'emergency');
    return g ? { ok: true, office: g } : { ok: false, reason: 'Executive orders require an office with executive power.' };
  }
  const rights = c.legislature.proposalRights;
  const ok = rights.some((r) => mine.includes(r)) || hasPower(world, personaId, 'propose_bill');
  return ok ? { ok: true } : { ok: false, reason: `Only the ${rights.map((r) => office(world, r)?.name || r).join(' or ')} may propose legislation.` };
}

/**
 * Who may call the question — close the floor before its clock runs out.
 *
 * Three ways in, and the third is the Vice President's:
 *
 * - the author, who can withdraw their own measure from debate;
 * - an office holding the power to call, which is the executive's gavel;
 * - **the presiding officer of the room the measure is standing in.** The Vice
 *   President is President of the Senate, and a presiding officer who cannot
 *   move to a vote is not presiding over anything. It is deliberately narrow:
 *   `presidedChamber` is the Senate alone, so a VP cannot gavel the House, and
 *   a measure that has moved on to the second chamber is tested against where
 *   it is *now* rather than where it started.
 *
 * The room is read off `voteRequirement`, like everything else that votes — so
 * a new kind of measure gets this rule for free, and a treaty (Senate only)
 * lands in the VP's hands without a special case.
 */
export function mayCloseFloor(world, personaId, doc) {
  if (!personaId || !doc) return { ok: false, reason: 'No measure.' };
  if (doc.authorId === personaId) return { ok: true };
  // The `call_election` power used to open this door too, which was the second
  // and quieter thing wrong with it: an office granted the power to set an
  // election date could also move the question on anybody's measure. Both are
  // gone; the floor is the author's and the presiding officer's.
  const req = voteRequirement(world, doc);
  if (req && presides(world, personaId) && req.body === presidedChamber(world)) return { ok: true };
  return {
    ok: false,
    reason: 'Only the author or the chamber\u2019s presiding officer may close the floor early.',
  };
}

/** Eligible voters on a document, and their weights. */
export function electorateFor(world, doc) {
  const req = voteRequirement(world, doc);
  if (!req) return [];
  return world.seats.filter((s) => s.office === req.body && s.personaId)
    .map((s) => ({ personaId: s.personaId, seat: s.id, weight: 1 }));
}

/**
 * The officer who breaks a tie in a chamber vote — a Vice President, by the
 * 'vote' power. Not part of the ordinary electorate (never in the roll), they
 * weigh in only when the chamber is split evenly. Returns the first seated
 * office-holder outside the voting body whose office carries the power.
 *
 * Two things guard the search now that there is a second chamber, both of which
 * it got wrong the moment the Senate was given a 'vote' power of its own:
 *
 * - **Skip every chamber, not just the voting one.** The scan is over
 *   `world.seats` in seat order, so with the House on the floor the first seat
 *   outside it carrying 'vote' was a *senator*, and a tied House bill was being
 *   settled by whichever senator happened to sit first in the array.
 * - **The tie-break belongs to the upper chamber.** The Vice President presides
 *   over the Senate and breaks ties there; the House elects its own Speaker and
 *   settles its own business. A unicameral constitution has one room and the
 *   tie-breaker keeps it, exactly as before.
 */
export function tieBreaker(world, doc) {
  const req = voteRequirement(world, doc);
  if (!req) return null;
  const rooms = chambers(world);
  if (isBicameral(world) && req.body !== world.constitution.legislature.upperChamber) return null;
  for (const s of world.seats) {
    if (!s.personaId || s.office === req.body || rooms.includes(s.office)) continue;
    const o = office(world, s.office);
    if (o && (o.powers || []).includes('vote')) return { personaId: s.personaId, office: s.office };
  }
  return null;
}

export function tally(world, doc) {
  const req = voteRequirement(world, doc);
  if (!req) return null;
  const roll = electorateFor(world, doc);
  let yea = 0, nay = 0, abstain = 0;
  for (const v of roll) {
    const b = doc.votes[v.personaId];
    if (b === 'yea') yea += v.weight; else if (b === 'nay') nay += v.weight; else abstain += v.weight;
  }
  // A chamber split evenly is decided by the tie-breaking officer (the VP), whose
  // ballot is not otherwise counted — so a 3–3 is not left to pass on the letter
  // of "half the votes cast". Only on an exact tie, and only if they voted.
  const tied = yea === nay && yea + nay > 0;
  let tieBroken = null;
  if (tied) {
    const tb = tieBreaker(world, doc);
    const b = tb && doc.votes[tb.personaId];
    if (b === 'yea' || b === 'nay') {
      if (b === 'yea') yea += 1; else nay += 1;
      tieBroken = { personaId: tb.personaId, office: tb.office, ballot: b };
    }
  }
  const cast = yea + nay;
  const eligible = roll.length || 1;
  const quorumMet = (cast + abstain * 0) / eligible >= (req.quorum || 0) || cast / eligible >= (req.quorum || 0);
  const share = cast ? yea / cast : 0;
  // An equally divided chamber that nobody broke has not carried the measure.
  //
  // At a simple-majority bar `share >= 0.5` is true of a dead tie, so 10–10 read
  // as a pass on the letter of "half the votes cast" — which is the bug the
  // tie-breaker was added to kill, and which came straight back the moment the
  // tie-break was confined to the chamber the Vice President actually presides
  // over. The House has no such officer, and a motion needs *more than* half.
  // A tie the tie-breaker settled is not a tie any more and is unaffected.
  const deadlocked = tied && !tieBroken;
  return {
    req, yea, nay, abstain, cast, eligible, share, quorumMet, tieBroken, deadlocked,
    passes: quorumMet && cast > 0 && !deadlocked && share >= req.fraction - 1e-9,
    needed: Math.ceil(req.fraction * Math.max(cast, Math.ceil(eligible * (req.quorum || 0)))),
  };
}

/** Rights check: does any enumerated right block this action? */
export function rightBlocking(world, code) {
  return (world.constitution.rights || []).find((r) => (r.blocks || []).includes(code)) || null;
}

/** The catalogue, so the convention and the clause menu offer the same list. */
export const RIGHTS_CATALOG = RIGHTS;

/**
 * Has this republic kept the rights it never wrote down?
 *
 * If so the court may reach an act that no enumerated right touches. See
 * court.overreachOf — it is a weaker ground than a named right and stays
 * vulnerable to a wide majority, which is the difference between a right the
 * founders wrote and one the bench is asked to find.
 */
export function retainsUnenumerated(world) {
  return (world.constitution.rights || []).some((r) => r.open || r.id === 'unenumerated');
}

// --- amendments patch the running rules ------------------------------------
export function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const nk = parts[i + 1];
    if (cur[k] == null) cur[k] = /^\d+$/.test(nk) ? [] : {};
    cur = cur[k];
  }
  cur[parts.at(-1)] = value;
  return obj;
}
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Human-readable description of an amendment target, for the floor. */
export const AMENDABLE = [
  { path: 'legislature.passFraction', label: 'Fraction to pass ordinary legislation', kind: 'fraction' },
  { path: 'legislature.quorum', label: 'Quorum on the floor', kind: 'fraction' },
  { path: 'legislature.overrideFraction', label: 'Fraction to override a veto', kind: 'fraction' },
  { path: 'amendment.fraction', label: 'Fraction to amend this constitution', kind: 'fraction' },
  { path: 'impeachment.fraction', label: 'Fraction to adopt articles of impeachment', kind: 'fraction' },
  { path: 'impeachment.convictFraction', label: 'Fraction to convict at the impeachment trial', kind: 'fraction' },
  { path: 'elections.citizenWeight', label: 'Weight of the citizenry in elections', kind: 'weight' },
  { path: 'elections.playerWeight', label: 'Weight of enfranchised players in elections', kind: 'weight' },
  { path: 'spending.1.above', label: 'Threshold at which spending needs a vote', kind: 'money' },
];

/**
 * Offices can be struck at the convention — you should not need a Marshal to
 * have a republic. Everything that pointed at the removed office has to be
 * repaired, or the constitution compiles into rules that reference a body that
 * does not exist. Called after any structural edit.
 */
export function repairConstitution(c) {
  const ids = c.offices.map((o) => o.id);
  const has = (id) => !!id && ids.includes(id);
  const firstWith = (power) => (c.offices.find((o) => o.powers.includes(power)) || c.offices[0] || {}).id || null;

  const L = c.legislature;
  if (!has(L.chamber)) L.chamber = firstWith('vote');
  // A second chamber that was struck at the convention, or that ended up being
  // the same room as the first (strike the House and `firstWith('vote')` hands
  // `chamber` the Senate, which is already the upper one), collapses back to a
  // unicameral legislature. Left alone it would make every bill pass one room
  // twice — a second reading dressed as a second chamber.
  if (!has(L.upperChamber) || L.upperChamber === L.chamber) L.upperChamber = null;
  if (L.vetoOffice && !has(L.vetoOffice)) L.vetoOffice = null;
  L.proposalRights = (L.proposalRights || []).filter(has);
  if (!L.proposalRights.length && L.chamber) L.proposalRights = [L.chamber];

  for (const o of c.offices) {
    // The per-office ceiling, enforced here as well as in the editor — a
    // constitution can arrive from a saved Season, a template, an amendment or
    // another player's tab, and only one of those routes goes through the
    // number field.
    o.seats = Math.max(0, Math.min(seatCap(o.id), Math.floor(+o.seats || 0)));
    // The age floor, for the same reason. Above 90 is an office nobody living
    // qualifies for, which is a way of striking it that leaves it on the page.
    if (o.minAge != null) {
      const n = Math.floor(+o.minAge);
      o.minAge = Number.isFinite(n) ? clamp(n, POLITICAL_BASE_AGE, 90) : POLITICAL_BASE_AGE;
    }
    if (o.selection === 'appointment' && !has(o.appointedBy)) {
      const appointer = firstWith('appoint');
      if (appointer && appointer !== o.id) o.appointedBy = appointer;
      else { o.selection = 'election'; o.appointedBy = null; }
    }
  }

  // Every *unapportioned* district-elected office holds exactly one seat per
  // district, and they all agree on how many districts there are.
  //
  // A district election is one contest per seat filtered to that seat's own
  // district (sim.closeElection), so two unapportioned seats in one district is
  // not a bigger chamber — it is the same race run twice, returning the same
  // winner to both, and no race at all somewhere else. An apportioned chamber is
  // exempt because it solves that problem a different way: its seats carry a
  // numbered congressional district of their own, so several of them can share a
  // state and still hold separate elections.
  //
  // The reference is the first unapportioned district office — the Senate — and
  // it is the one that says how many states exist. Zero seats still means "this
  // office will not exist", so an abolished chamber is skipped rather than
  // resurrected at the other one's size.
  const districted = c.offices.filter((o) => o.electorate === 'district' && o.seats > 0);
  const perState = districted.filter((o) => !o.apportioned);
  if (perState.length > 1) for (const o of perState.slice(1)) o.seats = perState[0].seats;
  // And an apportioned chamber cannot be smaller than the number of states: every
  // state gets at least one member of the lower house.
  const states = perState.length ? perState[0].seats : (districted[0]?.seats || 0);
  if (states) for (const o of districted) if (o.apportioned && o.seats < states) o.seats = states;
  // A staggered chamber cannot have more classes than it has chairs — a fourth
  // class of nothing is a class that never polls — and a single class is the
  // same thing as no stagger at all, so it is written as none.
  for (const o of c.offices) {
    if (o.cohorts == null) continue;
    const n = Math.floor(+o.cohorts) || 1;
    o.cohorts = n <= 1 ? null : Math.min(n, Math.max(1, o.seats || 1));
    if (o.cohorts == null) delete o.cohorts;
  }

  if (c.impeachment) {
    if (!has(c.impeachment.tries)) c.impeachment.tries = L.chamber;
    // The court that hears the trial. Struck, or the same room that brought the
    // articles, and there is no second stage to speak of — voteRequirementRaw
    // falls back to `tries` and one chamber does both.
    if (!has(c.impeachment.convicts) || c.impeachment.convicts === c.impeachment.tries) c.impeachment.convicts = null;
    c.impeachment.proposalRights = (c.impeachment.proposalRights || []).filter(has);
    if (!c.impeachment.proposalRights.length && L.chamber) c.impeachment.proposalRights = [L.chamber];
    c.impeachment.appliesTo = (c.impeachment.appliesTo || []).filter(has);
  }
  if (c.amendment) {
    if (!has(c.amendment.chamber)) c.amendment.chamber = L.chamber;
    c.amendment.alsoRequires = (c.amendment.alsoRequires || []).filter(has);
  }
  if (c.judiciary && !has(c.judiciary.office)) c.judiciary = null;
  if (c.emergency && !has(c.emergency.office)) c.emergency = null;
  for (const r of c.spending || []) {
    if (r.requires && !has(r.requires.body)) {
      if (L.chamber) r.requires.body = L.chamber; else r.requires = null;
    }
  }
  return c;
}

/**
 * Apportion `seats` between populations, by the method the United States
 * actually uses.
 *
 * Huntington–Hill: every state starts with one seat, and each remaining seat
 * goes to whichever state has the highest priority value pop / sqrt(n(n+1)),
 * where n is the number it already holds. That divisor is the geometric mean of
 * n and n+1, which is what makes the method minimise the *relative* difference
 * in people-per-seat rather than the absolute one — a small state is not
 * rounded away.
 *
 * Written out rather than approximated with a largest-remainder rule because it
 * is not much longer and it is the real answer; the whole atlas is built on the
 * same principle.
 *
 * Returns a seat count per population, in the order given, summing to `seats`.
 * Never returns a zero: a state with nobody living in it still sends a member,
 * because a district with no representative is an electorate with no voice — the
 * exact fault the twenty-state split was made to fix.
 */
export function apportion(pops, seats) {
  const n = pops.length;
  if (!n) return [];
  const out = new Array(n).fill(1);
  if (seats <= n) return out;                     // one each and no more to give
  // A max-heap would be tidier; n is twenty and the loop runs forty times.
  for (let given = n; given < seats; given++) {
    let best = 0, bestPri = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = out[i];
      const pri = (Math.max(0, pops[i]) || 0) / Math.sqrt(k * (k + 1));
      // Ties break toward the earlier state, which is the atlas's own order, so
      // the apportionment is deterministic rather than dependent on float noise.
      if (pri > bestPri + 1e-12) { bestPri = pri; best = i; }
    }
    out[best]++;
  }
  return out;
}

/** A body that holds no seats cannot try anything. */
export const bodySeated = (world, officeId) =>
  !!officeId && world.seats.some((s) => s.office === officeId);

export function termTicks(world, o) {
  return Math.round((o.termYears || 4) * world.clock.ticksPerYear);
}

/**
 * How many classes an office's seats are dealt into — the Senate's three.
 *
 * One means the whole body goes to the country together, which is what every
 * office but the Senate does and what the Senate itself did until now: twenty
 * seats all expiring on the same day, so every sixth year the entire upper
 * chamber was up and in between it was untouchable. A staggered chamber turns
 * over continuously, which is the whole argument for having one.
 */
export const cohortsOf = (o) => Math.max(1, Math.floor(+(o?.cohorts || 1)) || 1);

/**
 * Which seats one election is actually for.
 *
 * An election used to be the office and nothing else, so anything that asked
 * "whose chairs are on this ballot" answered "all of them". With classes it is
 * the office *and* the class, and `e.cohort == null` still means the whole body
 * — which is what every election in an unstaggered republic carries.
 */
export const seatsUpIn = (world, e) => world.seats.filter((s) =>
  s.office === e.office && (e.cohort == null || (s.cohort ?? null) === e.cohort));

/** Is there already a ballot open for these chairs? */
export const electionOpenFor = (world, officeId, cohort = null) =>
  (world.elections || []).some((e) => e.office === officeId && e.status === 'open'
    && (e.cohort ?? null) === cohort);

// --- When a term begins and ends -------------------------------------------
// Not "four years after whatever afternoon you happened to be sworn in". A
// republic has days for this, and they are different days for different
// branches: the executive changes hands on the twentieth of January, the
// chamber opens its session on the sixth. Before this a term simply ran
// termYears from the tick it started, so a president who came in mid-term
// through succession pushed every subsequent inauguration off the calendar for
// the rest of the Season and the country's dates slowly stopped meaning
// anything.

/** Inauguration day — the executive, and the successor who inherits it. */
export const INAUGURATION_DAY = dayIndex(0, 20);
/** The day the chamber's session opens. */
export const SESSION_DAY = dayIndex(0, 6);

/** Which of those days this office turns over on. */
export function swearingDay(world, officeId) {
  const o = office(world, officeId);
  if (!o) return INAUGURATION_DAY;
  // The chamber and anything else that votes on the floor keeps its own date.
  if ((o.powers || []).includes('vote')) return SESSION_DAY;
  return INAUGURATION_DAY;
}

/**
 * When a term that began at `startTick` runs out.
 *
 * The office's own swearing-in day, `termYears` later — snapped to the nearest
 * one, not the first after. "First after" chopped a whole calendar year off
 * short-term offices: an Assembly term of two years from Jan 20, 2029 lands
 * naturally on Jan 20, 2031, and the next SESSION_DAY (Jan 6) after that is Jan
 * 6, 2032 — a full year of extra tenure the two-year term was not supposed to
 * have. The president's four-year term is unaffected because its natural end
 * *is* an inauguration day. See tests/midterm.mjs.
 */
export function termEndTick(world, o, startTick) {
  // No end. `atWill` serves at the appointer's pleasure and `forLife` during
  // good behaviour — neither has a term, and a null here is what keeps
  // sim.tickTerms from ever calling an election or a caretaker for the seat.
  if (!o || o.atWill || o.forLife) return null;
  const natural = startTick + termTicks(world, o);
  const day = swearingDay(world, o.id);
  const after = nextDay(world, natural, day);
  const before = tickOf(world, yearAt(world, after) - 1, day);
  return (after - natural) <= (natural - before) ? after : before;
}

/** Polling day: the first Tuesday-ish of November, which here is the 6th. */
export const ELECTION_DAY = dayIndex(10, 6);

/**
 * When the country goes to the polls for a term ending at `termEnds`.
 *
 * The November before it, not the morning it expires. An election held on the
 * day a term runs out leaves nobody in the chair while the votes are counted —
 * which the engine papered over with a sixty-tick "caretaker" extension nobody
 * had voted for. A republic settles the succession months in advance and then
 * waits, and the waiting is the interesting part: a defeated president holds
 * every power of the office until January.
 */
export function electionCallTick(world, termEnds) {
  const endYear = yearAt(world, termEnds);
  const sameYear = tickOf(world, endYear, ELECTION_DAY);
  return sameYear < termEnds ? sameYear : tickOf(world, endYear - 1, ELECTION_DAY);
}

export function powerLabel(p) { return POWERS[p] || p; }

// --- Incompatible offices --------------------------------------------------

/**
 * Whether one person may hold two given offices at once.
 *
 * Three of these are separation of powers rather than etiquette. A justice who
 * sits in the cabinet reviews their own government's acts. A Vice President who
 * takes a department is the successor auditing the administration they would
 * inherit — and is answerable, at will, to the person they stand behind. And a
 * President who appoints themselves has taken a second office without an
 * election, which is why that one is refused at the point of appointment too.
 *
 * All of it is default, not doctrine: `constitution.plurality` set true means a
 * convention or an amendment has decided that this republic allows a person to
 * hold more than one office, and the engine stops arguing.
 */
export const allowsPlurality = (world) => !!world.constitution?.plurality;

export function mayAlsoHold(world, personaId, officeId) {
  if (allowsPlurality(world)) return { ok: true };
  const o = office(world, officeId);
  if (!o) return { ok: true };
  const held = officesOf(world, personaId);
  if (!held.length) return { ok: true };
  // Only appointive posts are guarded: winning an election is the electorate's
  // business, and a person elected to two things has been chosen twice.
  if (o.selection !== 'appointment') return { ok: true };
  const clash = held.find((h) => h.id !== o.id);
  if (!clash) return { ok: true };
  const name = world.personas[personaId]?.name || 'They';
  // A judge in the cabinet is the sharpest case, so it is named as itself.
  if (judicialOffice(world, clash.id)) {
    return { ok: false, reason: `${name} sits on the ${clash.name}, which reviews the government's acts, and cannot serve in it. Amend the constitution for plurality of office.` };
  }
  return { ok: false, reason: `${name} already holds the ${clash.name}, and no person may hold two. Amend the constitution for plurality of office.` };
}

/** Is this office the bench, or a seat on it? */
export function judicialOffice(world, officeId) {
  const j = world.constitution?.judiciary;
  if (j?.office && j.office === officeId) return true;
  return hasPowerInOffice(world, officeId, 'strike_law');
}

/** Does the office itself carry this power, whoever holds it? */
export function hasPowerInOffice(world, officeId, power) {
  const o = office(world, officeId);
  return !!o && (o.powers || []).includes(power);
}

// --- Term limits -----------------------------------------------------------

/**
 * How many terms this office allows one person, or 0 for no limit.
 *
 * Set at the convention and amendable afterwards, because a term limit is
 * exactly the kind of provision a president with the votes goes looking for.
 */
export const termLimitOf = (o) => Math.max(0, Math.round(+(o?.termLimit || 0)));

/** Terms this persona has counted against a given office. */
export const termsHeld = (p, officeId) => (p?.terms && p.terms[officeId]) || 0;

/**
 * Whether a partial term — one entered by succession rather than by election —
 * counts against the limit.
 *
 * This is the 22nd Amendment's rule, which exists so that a Vice President who
 * inherits a term nearly over is not thereby half spent. There it is written as
 * two years of a four-year term; here, where a term can be any length a
 * convention votes for, it is more than half of the term remaining. Succeed
 * early and you have effectively served that term; succeed late and you have
 * merely finished someone else's.
 */
export function partialTermCounts(world, o, remaining) {
  return remaining > termTicks(world, o) / 2;
}

/**
 * May this persona stand for (or be seated in) this office again?
 *
 * Returns { ok } or { ok: false, reason }, so the refusal can be printed
 * wherever it is asked — the ballot, the nomination, the seating.
 */
/**
 * The age the constitution sets for an office.
 *
 * Article I sets twenty-five for the House and thirty for the Senate; Article II
 * sets thirty-five for the President, and the Twelfth Amendment carries that
 * same bar to the Vice President by making anyone ineligible for the one
 * ineligible for the other. That is why the VP's floor is thirty-five and not
 * something of its own — it is the President's, quoted.
 *
 * Any office the convention invents, and every office in the older templates,
 * falls back to the age of majority: nobody under eighteen holds anything.
 */
export const minAgeFor = (world, officeId) => {
  const o = office(world, officeId);
  const n = Math.floor(+o?.minAge);
  return Number.isFinite(n) && n > 0 ? Math.max(n, POLITICAL_BASE_AGE) : POLITICAL_BASE_AGE;
};

/**
 * Is this person old enough for this office *today*?
 *
 * Today is the operative word. Age is not a disqualification the way a spent
 * term limit is — it expires. Someone barred at twenty-four is barred from the
 * House until the year they turn twenty-five and no longer, so this is asked
 * fresh at every gate rather than recorded against the persona once.
 */
export function eligibleByAge(world, personaId, officeId) {
  const o = office(world, officeId);
  const p = world.personas[personaId];
  if (!o || !p) return { ok: true };
  const need = minAgeFor(world, officeId);
  const age = currentAge(world, p);
  if (age >= need) return { ok: true };
  return {
    ok: false, age, need, years: need - age,
    reason: `${p.name || 'They'} is ${age}; the constitution sets ${need} for the ${o.name}.`
      + ` Eligible in ${need - age} year${need - age === 1 ? '' : 's'}.`,
  };
}

export function mayHoldAgain(world, personaId, officeId) {
  const o = office(world, officeId);
  const p = world.personas[personaId];
  // The constitution's age for the office. Checked before the term limit so it
  // bites on the ballot, the nomination and the seating alike — and checked
  // against the age they are now, because unlike a spent term limit this one
  // runs out on its own. See util.POLITICAL_BASE_AGE, which is also the floor
  // every other age effect measures from.
  const old_enough = eligibleByAge(world, personaId, officeId);
  if (!old_enough.ok) return { ok: false, reason: old_enough.reason };
  const limit = termLimitOf(o);
  if (!limit) return { ok: true };
  const held = termsHeld(p, officeId);
  if (held < limit) return { ok: true };
  return {
    ok: false,
    reason: `${p?.name || 'They'} has served ${held} term${held === 1 ? '' : 's'} as ${o.name}, and the constitution allows ${limit}. Amend it, or stand aside.`,
  };
}

/**
 * A term begins. Recorded on *taking* the office, not on leaving it — a
 * sitting president is spending their term and the count has to say so while
 * they are still in the chair.
 *
 * Called from every route into a chair — won at the polls, taken on a ticket,
 * succeeded to on a vacancy — which makes it the one place that can say what
 * starting a term does to somebody. And it does something: the country gives a
 * new government the benefit of the doubt. Approval steps toward a better
 * starting position, because the person being sworn in is not yet the reason
 * anything is the way it is. Whether they keep it is the next hundred days'
 * business — see sim.honeymoon, the other half of this.
 *
 * A step toward 62 rather than a flat bonus, so a wildly popular figure does
 * not lose standing by winning and an unpopular one does not arrive beloved.
 */
export const HONEYMOON_START = 62;

// Record a term against a persona, with no honeymoon. Used where the term is
// counted at the moment it is won at the polls — the honeymoon belongs to the
// swearing-in weeks later, not to election night.
export function recordTerm(world, personaId, officeId) {
  const p = world.personas[personaId];
  if (!p) return;
  p.terms = p.terms || {};
  p.terms[officeId] = (p.terms[officeId] || 0) + 1;
}

// The honeymoon: on the day a government actually takes power, the country gives
// it the benefit of the doubt. Split out from countTerm so a term already
// recorded at the ballot still gets its honeymoon when the winner is sworn in.
export function honeymoonNudge(p) {
  if (!p) return;
  // Through the one lever, like every other effect on opinion — see
  // util.nudgeApproval and the guard in tests/opinion.mjs.
  nudgeApproval(p, (HONEYMOON_START - (p.approval ?? 50)) * 0.5);
}

export function countTerm(world, personaId, officeId) {
  recordTerm(world, personaId, officeId);
  honeymoonNudge(world.personas[personaId]);
}

export function describeOffice(world, o) {
  const n = o.seats > 1 ? `${o.seats} seats` : 'single office';
  const sel = o.selection === 'election' ? `elected by ${o.electorate === 'district' ? 'district' : 'the whole nation'}`
    : o.selection === 'appointment' ? `appointed by the ${office(world, o.appointedBy)?.name || o.appointedBy}`
    : 'hereditary';
  // An office whose term follows another has no termYears of its own, and
  // printing it gave every Vice President an "undefined-year term".
  const term = o.termFollows
    ? `term follows the ${office(world, o.termFollows)?.name || o.termFollows}`
    : o.atWill ? 'serves at will'
      : o.forLife ? 'for life, during good behaviour'
        : o.termYears ? `${o.termYears}-year term` : 'no fixed term';
  return `${n}, ${sel}, ${term}`;
}

/**
 * An administration bill: legislation the head of government brought themselves,
 * as opposed to a bill introduced from the floor by a legislator. The government
 * is credited with carrying its own programme and rebuked for losing it (see
 * acts.closeFloor), and the Chronicle names the two differently. Scoped to bills
 * — an amendment or a treaty is its own kind of thing. Read off the author's
 * office at the time the question is asked, which is when it matters.
 */
export function isAdministrationBill(world, doc) {
  if (!doc || doc.type !== 'bill') return false;
  const author = world.personas[doc.authorId];
  if (!author) return false;
  const head = headOffice(world)?.id;
  return !!head && officesOf(world, author.id).some((o) => o.id === head);
}

export function approvalOfOffice(world, officeId) {
  const hs = holders(world, officeId);
  if (!hs.length) return null;
  return clamp(hs.reduce((a, p) => a + (p.approval ?? 50), 0) / hs.length, 0, 100);
}

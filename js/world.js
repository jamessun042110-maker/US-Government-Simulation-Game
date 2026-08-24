// Genesis. Builds the map, the citizenry, the ledger and the offices.

import { rng, range, pick, clamp, uid, sum, mulberry32, hashSeed, PALETTE, youthOf, YOUTH_APPROVAL } from './util.js';
import { templateById, termEndTick, apportion, cohortsOf } from './rules.js';
import { initMacro } from './macro.js';
import { STATE_NAMES, isCoastal, LAKES, STATES, FEDERAL_DISTRICT, codeOf, peopleOf, democratOf, joblessOf, roughOf, homeValueOf, incomeOf } from './atlas.js';
import { cityGeometry, inPoly, bounds } from './geo.js';

export const ZONES = {
  unzoned: { label: 'Unzoned', color: '#2a2a2e' },
  residential: { label: 'Residential', color: '#3f6b4a' },
  commercial: { label: 'Commercial', color: '#3f5d7a' },
  industrial: { label: 'Industrial', color: '#6b5030' },
  civic: { label: 'Civic', color: '#5a4a70' },
  park: { label: 'Park', color: '#2f7a4a' },
};

// Costs, timers and consequences lifted straight from the December transcripts:
// land prices vary by district, parking earns, low-income housing measurably
// reduces the homeless, and the jail lowers property values next to the bank.
export const BUILDINGS = {
  housing_low: { name: 'Public Housing', zone: 'residential', cost: 8e9, years: 1.2, jobs: 60000, homes: 900000, upkeep: 4e8, land: -6, mood: 2, tag: 'housing' },
  housing_mid: { name: 'Housing Development', zone: 'residential', cost: 1.2e10, years: 1.0, jobs: 40000, homes: 620000, upkeep: 2e8, land: 4, mood: 1, tag: 'housing' },
  factory: { name: 'Industrial Works', zone: 'industrial', cost: 1.5e10, years: 1.6, jobs: 900000, homes: 0, upkeep: 6e8, land: -9, mood: -2, output: 2.6e10, tag: 'jobs' },
  offices: { name: 'Commercial District', zone: 'commercial', cost: 1.8e10, years: 1.4, jobs: 700000, homes: 0, upkeep: 5e8, land: 7, mood: 0, output: 3.4e10, tag: 'jobs' },
  market: { name: 'Retail District', zone: 'commercial', cost: 6e9, years: 0.7, jobs: 240000, homes: 0, upkeep: 2e8, land: 3, mood: 2, output: 9e9, tag: 'jobs' },
  park: { name: 'Parkland', zone: 'park', cost: 2e9, years: 0.4, jobs: 12000, homes: 0, upkeep: 1.5e8, land: 11, mood: 5, tag: 'amenity' },
  school: { name: 'Schools', zone: 'civic', cost: 9e9, years: 1.1, jobs: 130000, homes: 0, upkeep: 9e8, land: 6, mood: 5, tag: 'amenity' },
  hospital: { name: 'Hospitals', zone: 'civic', cost: 2e10, years: 1.8, jobs: 420000, homes: 0, upkeep: 1.6e9, land: 5, mood: 6, tag: 'amenity' },
  sewer: { name: 'Water and Sewer', zone: 'civic', cost: 6e9, years: 0.9, jobs: 70000, homes: 0, upkeep: 3e8, land: 2, mood: 3, tag: 'infra' },
  parking: { name: 'Roads and Transit', zone: 'commercial', cost: 1.5e9, years: 0.3, jobs: 18000, homes: 0, upkeep: 6e7, land: -2, mood: -1, revenue: 4.2e8, tag: 'revenue' },
  jail: { name: 'Corrections', zone: 'civic', cost: 1.2e10, years: 1.3, jobs: 180000, homes: 0, upkeep: 1.2e9, land: -16, mood: -3, order: 8, tag: 'order' },
  barracks: { name: 'Garrison', zone: 'civic', cost: 1e10, years: 1.2, jobs: 300000, homes: 0, upkeep: 1.4e9, land: -6, mood: -1, units: 2, tag: 'military' },
};

/**
 * What one formation costs to keep under arms for a year.
 *
 * Named and exported because it is not only a line in the budget — it is the
 * number a government has to be able to answer before it raises anything, and
 * `npc.warBill` reads it to ask whether the country can carry the army it is
 * about to buy. A division costs `depts.DIVISION_COST` ($60bn) once and this
 * every year afterwards, which is three and a half times its own price
 * annually: the standing bill, not the purchase, is what decides a defence
 * budget, and a caller that weighs only the purchase arms the republic into a
 * permanent deficit it cannot then legislate its way out of.
 *
 * It was $2.1e11, and that was the largest single number in the budget: four
 * formations came to $840bn a year — **68% of all federal spending and 76% of
 * everything the republic raised** — which is what the founding deficit of
 * -$136bn actually was, and why no republic could ever afford the army it needed
 * to win a war. The real United States spends about 12.6% of federal outlays on
 * defence.
 *
 * At $3.85e10 the founding establishment of four is 14% of revenue, a wartime
 * army of ten is 35% (about what a major war has historically cost), and the
 * republic opens within a few billion of break-even — which is where
 * ADMINISTRATION_PER_HEAD was always meant to put it.
 */
export const UPKEEP_PER_FORMATION = 3.85e10;

export const MAX_DISTRICTS = 20;

/**
 * The year the calendar starts at, and with chronicle.FOUNDING_DAY the moment
 * the republic is founded: the twentieth of January, 2029.
 *
 * Nothing in the engine reads the number — it is added to the elapsed years and
 * printed — so it is free to be whatever reads best, and a date just over the
 * horizon reads like a country that could exist rather than like the first year
 * of the world.
 */
export const FOUNDING_YEAR = 2029;
// The districts are states now, and their names come from the atlas rather than
// from a list kept here — the same twenty that own polygons on the map. Two
// lists would be two things to keep in step, and the one that drifted would be
// this one, because nothing draws it.
//
// The order matters and is the atlas's: a district's name and its ground are
// matched by index, so New England is seated first because New England is the
// first polygon.
const DISTRICT_NAMES = STATE_NAMES;
// American names, where Silver's were invented — Aurel Karsk and Yseult
// Wolstenholme belonged to a country that did not exist.
//
// The size is load-bearing and is the reason this is not a shorter list of more
// familiar names. Fifty against forty is two thousand combinations for the four
// hundred and fifty people a Season creates; the previous list ran out about two
// thirds of the way through every game, and the fallback appended a counter, so
// a third of the citizenry ended up called "Vess Ferro 301" in a Chronicle whose
// whole promise is that these people are remembered.
//
// The surnames are drawn across the immigrations that actually built the
// country rather than from one of them, because a legislature that is forty
// Millers and Smiths is not a United States anyone lives in.
const FIRST = ['James', 'Maria', 'Robert', 'Aisha', 'Michael', 'Elena', 'David', 'Grace', 'Daniel', 'Rosa',
  'Thomas', 'Naomi', 'Andrew', 'Clara', 'Samuel', 'Imani', 'Benjamin', 'Sofia', 'Nathaniel', 'Ruth',
  'Marcus', 'Adeline', 'Elijah', 'Priya', 'Caleb', 'Miriam', 'Isaiah', 'Yolanda', 'Vincent', 'Harriet',
  'Julian', 'Camille', 'Theodore', 'Beatrice', 'Franklin', 'Delia', 'Hollis', 'Josephine', 'Everett', 'Lucille',
  'Amos', 'Winifred', 'Silas', 'Cordelia', 'Abraham', 'Ida', 'Ezra', 'Frances', 'Gideon', 'Alma'];
const LAST = ['Sun', 'Whitfield', 'Okonkwo', 'Reyes', 'Calloway', 'Nakamura', 'Brennan', 'Delgado',
  'Ashford', 'Pemberton', 'Vasquez', 'Lindgren', 'Boone', 'Achebe', 'Marchetti', 'Kwan',
  'Fairbanks', 'Castellanos', 'Thorne', 'Abernathy', 'Mendoza', 'Sinclair', 'Osei', 'Kowalski',
  'Hargrove', 'Ferraro', 'Bautista', 'Lockhart', 'Nguyen', 'Prentice', 'Salazar', 'Underwood',
  'Chandler', 'Ibarra', 'Weatherby', 'Amadi', 'Kirkpatrick', 'Solano', 'Rothstein', 'Maddox'];
// The two parties, and a country that mostly sorts itself between them.
//
// They are the Democratic and Republican parties now, not the Liberal and
// Conservative ones the generic republic shipped with. The ids went with the
// names — `democrat` / `republican` — because an id that disagrees with every
// label on screen is a second vocabulary to keep in your head, and `atlas`'s
// per-state vote share went with them (`democratOf`), which is what that number
// has always literally been: the Democratic share of the 2020 two-party vote.
//
// `lean` is the party's consistent stance on the issues a bill can touch (see
// sim.syntheticBallot), signed the same way a bill's clauses are: positive
// spend/tax = for spending and taxing, positive order = for order. The signs are
// the politics — a Democrat spends, taxes to pay for it, is wary of the order
// apparatus and warm to rights; a Republican is the mirror. syntheticBallot
// reads these on every relevant clause, so a member votes their party's line as
// a matter of course, and the opposition whips against the government's bills on
// top of it. Keep the two rows opposed and roughly balanced.
//
// The colours are blue and red, the way the country reads them, rather than
// Silver's gold and indigo — a chip nobody has to be taught, and the two the
// inauguration's bunting is dyed with. Both are dark enough to want light type
// on them, which is what `ink` is: it used to be a literal '#111' beside every
// use of `color`, and that pairing only held while the palette was pale.
export const PARTIES = [
  { id: 'democrat', name: 'Democratic', color: '#2f6fdb', ink: '#ffffff', lean: { spend: 0.6, order: -0.35, tax: 0.5, rights: 0.5 } },
  { id: 'republican', name: 'Republican', color: '#b22234', ink: '#ffffff', lean: { spend: -0.5, order: 0.45, tax: -0.5, rights: -0.4 } },
];

/**
 * A district's voters, sorted between the parties. `partisan[id]` is the share
 * firmly with or leaning to each party; the rest are undecided, and the fully
 * undecided do not vote. A district leaning one way starts with more of its
 * people there, but it is never a lock — the balance shifts with how the
 * government and the district's own representatives perform (see tickAffiliation).
 */
export function seedPartisan(world, leanId) {
  const other = PARTIES.find((p) => p.id !== leanId)?.id;
  const home = range(world, 0.32, 0.5);
  const away = range(world, 0.18, 0.32);
  const partisan = { [leanId]: home };
  if (other) partisan[other] = away;
  return { partisan, undecided: Math.max(0.02, 1 - home - away) };
}

/** The share of a district's voters who are not with either party at the founding. */
const UNDECIDED_AT_FOUNDING = 0.26;

/**
 * The same thing, but for a state that is a real place — seeded off how that
 * place actually votes rather than off a coin.
 *
 * `atlas.democratOf` is the Democratic share of the two-party vote; the committed
 * two-thirds-odd of the electorate is split in that proportion and the rest is
 * left undecided. So the Deep South opens Republican, New England opens
 * Democratic, and Virginia opens on a knife edge — which is what those places are.
 *
 * The jitter is small and deliberate. Without it every Season deals the same
 * twenty splits to the tenth of a point and the map becomes a table to memorise;
 * with it, the three states that really are within a point of even can break
 * either way, and nothing else moves enough to matter. It draws on `world.rngState`
 * like everything else here, so Seasons still differ — see the handoff.
 */
export function seedPartisanFor(world, stateName) {
  const st = STATES.find((x) => x.name === stateName);
  if (!st) return null;
  const lib = clamp(democratOf(st) + range(world, -0.025, 0.025), 0.05, 0.95);
  const committed = 1 - UNDECIDED_AT_FOUNDING;
  const partisan = { democrat: committed * lib, republican: committed * (1 - lib) };
  const leanId = partisan.democrat >= partisan.republican ? 'democrat' : 'republican';
  return { partisan, undecided: UNDECIDED_AT_FOUNDING, lean: leanId };
}

export const FOREIGN = [
  { id: 'canada', name: 'Canada', ideology: 'fascist', hostility: 34, strength: 120, blurb: 'A rearming neighbour that reads restraint as invitation.' },
  { id: 'sab', name: 'The Caribbean League', ideology: 'mercantile league', hostility: 12, strength: 70, blurb: 'The islands south of Florida, self-governing as one trading bloc. No army to speak of, and a tariff schedule with opinions.' },
  { id: 'mexico', name: 'Mexico', ideology: 'republic', hostility: 4, strength: 85, blurb: 'Sister republic. Signs things. Means about half of them.' },
];

/**
 * A name nobody in this republic is already using.
 *
 * Two thousand combinations against the four hundred and fifty people a Season
 * creates, so the plain form nearly always lands. When it does not, a country
 * disambiguates the way countries do — a middle initial — rather than by
 * numbering its citizens.
 *
 * `usedNames` was a plain array searched with `includes`, which is a linear scan
 * per attempt and sixty attempts per person; it is a Set now, and the fallback
 * *records* what it returns. It did not, so `usedNames.length` stuck at the
 * moment the pool ran dry and the counter it appended stopped changing: three
 * separate citizens were all called "Nella Ferro 320".
 */
const INITIALS = 'ABCDEFGHIJKLMNOPRSTVW';

export function personName(world) {
  if (!(world.usedNameSet instanceof Set)) {
    world.usedNameSet = new Set(world.usedNames || []);
  }
  const taken = world.usedNameSet;
  const keep = (n) => {
    taken.add(n);
    // Mirrored to the array so the name survives JSON — a Set does not.
    world.usedNames = world.usedNames || [];
    world.usedNames.push(n);
    return n;
  };
  for (let i = 0; i < 40; i++) {
    const n = `${pick(world, FIRST)} ${pick(world, LAST)}`;
    if (!taken.has(n)) return keep(n);
  }
  // Still colliding: give them a middle initial, which is what a country with
  // more people than names actually does.
  for (let i = 0; i < 40; i++) {
    const first = pick(world, FIRST);
    const last = pick(world, LAST);
    const mid = INITIALS[Math.floor(rng(world) * INITIALS.length)];
    const n = `${first} ${mid}. ${last}`;
    if (!taken.has(n)) return keep(n);
  }
  // A republic may simply contain two people of the same name. Recorded either
  // way, so nothing downstream assumes the list tracks the population.
  return keep(`${pick(world, FIRST)} ${pick(world, LAST)}`);
}

/**
 * The four colleges of the republic, most prestigious first.
 *
 * `share` is the fraction of the political class that went there, and it runs
 * the opposite way to prestige on purpose: Argent turns out a handful of
 * people a year and Northgate turns out everyone else. That trade is the whole
 * mechanic. An Argent degree opens with the country's goodwill and the
 * treasury's confidence, and it hands every newspaper in the republic a stick;
 * a Northgate degree opens with nothing and finds a classmate in every chamber.
 */
export const COLLEGES = [
  // The ids are deliberately unchanged. `argent` and `northgate` are named in
  // tests that measure the college-bond premium between the top and bottom of
  // this list, and renaming an id to match a label would have broken a
  // measurement for a cosmetic reason.
  { id: 'argent', name: 'Harvard University', prestige: 4, share: 0.07,
    blurb: 'Older than the country. Opens doors, and invites resentment through each.' },
  { id: 'meridian', name: 'Georgetown University', prestige: 3, share: 0.15,
    blurb: 'Where the foreign service is trained, and where it recruits.' },
  { id: 'harborlight', name: 'Rutgers University', prestige: 2, share: 0.28,
    blurb: 'Engineers, surveyors, county road commissioners. Builds things; distrusts speeches.' },
  // The only college whose name is not fixed. `stateCollegeName` in this module
  // resolves it against the player's home state, so a founder from Ohio Valley
  // went to Ohio Valley State University and one from Texas did not.
  { id: 'northgate', name: 'State University', prestige: 1, share: 0.50,
    blurb: 'The one most people went to. No cachet, and a classmate in every room.' },
];

export const collegeById = (id) => COLLEGES.find((c) => c.id === id) || null;

/**
 * The state university, named for a state.
 *
 * Three of the four colleges are real places with fixed names. The fourth is
 * "the one most people actually went to", and in the United States that is not
 * one institution — it is fifty, each named for where you are from. So it is the
 * only college whose name is resolved rather than stored.
 */
export const stateCollegeName = (stateName) => (stateName ? `${stateName} State University` : 'State University');

/**
 * What to call a person's college. Everything shown to a player goes through
 * here rather than reading `college.name`, because for one of the four that
 * field is a template and not an answer.
 */
export function collegeNameFor(world, persona) {
  const c = collegeById(typeof persona === 'string' ? persona : persona?.college);
  if (!c) return '';
  if (c.id !== 'northgate') return c.name;
  const d = world?.districts?.find((x) => x.id === persona?.district);
  return stateCollegeName(d?.name);
}

/** Draw a college the way the country's intakes actually run. */
export function rollCollege(world) {
  let r = rng(world);
  for (const c of COLLEGES) { r -= c.share; if (r <= 0) return c.id; }
  return COLLEGES[COLLEGES.length - 1].id;
}

export const GENDERS = [
  { id: 'f', label: 'Woman' },
  { id: 'm', label: 'Man' },
  { id: 'x', label: 'Neither' },
];

/**
 * Temperament: how a member sounds, and how they lean.
 *
 * The chamber used to speak with one voice — statements were picked from a pool
 * keyed only by topic and direction, so seven members answering the same bill
 * gave the same three answers. A temperament gives each of them a register of
 * their own, and it is not only cosmetic: each one bends the two ledgers a vote
 * is decided on, so the way a member talks and the way they vote agree.
 */
export const TEMPERAMENTS = [
  { id: 'blunt', label: 'Blunt', merit: 0, interest: 0.15,
    blurb: 'Says the quiet part. Votes their interest and does not pretend otherwise.' },
  { id: 'lawyerly', label: 'Lawyerly', merit: 0.25, interest: -0.1,
    blurb: 'Reads the clause before the room. Moved by the argument, slowly.' },
  { id: 'folksy', label: 'Folksy', merit: 0.1, interest: 0.05,
    blurb: 'Talks about their state because it is genuinely what they think about.' },
  { id: 'firebrand', label: 'Firebrand', merit: -0.15, interest: 0.3,
    blurb: 'Loud, partisan, and reliable in exactly one direction.' },
  { id: 'wonk', label: 'Wonk', merit: 0.35, interest: -0.2,
    blurb: 'Wants the number. Unbuyable and slightly exhausting.' },
  { id: 'weary', label: 'Weary', merit: 0.05, interest: -0.05,
    blurb: 'Has seen this bill before, under another name. Hard to move either way.' },
];

/**
 * A member's temperament — and one for anybody who predates the field.
 *
 * A world saved before temperaments existed has personas without one, and
 * defaulting them all to the first entry would put a whole chamber back into a
 * single voice. Deriving it from the persona's own id instead gives an old save
 * the same spread as a new one, deterministically, without a migration.
 */
export function temperamentOf(p) {
  if (!p) return TEMPERAMENTS[0];
  const found = TEMPERAMENTS.find((t) => t.id === p.temperament);
  if (found) return found;
  let h = 0;
  const id = String(p.id || '');
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TEMPERAMENTS[h % TEMPERAMENTS.length];
}

export function makePersona(world, { name, playerId = null, synthetic = false, party = null, district = null, lineage = null, gen = 1, minAge = 0 }) {
  const id = uid('per');
  const p = {
    id, name: name || personName(world), playerId, synthetic,
    party: party || pick(world, PARTIES).id,
    district, alive: true, exiled: false, imprisoned: false,
    born: world.clock.tick, died: null, cause: null,
    // Everyone in the republic has an age, a college and a gender — the player
    // picks theirs at the founding, everyone else is dealt one here.
    // Thirty-four to sixty-seven, but never younger than the chair they are
    // being dealt. The roll's floor is 34 and the President's is 35, so exactly
    // one year of it produced a head of state the constitution said could not
    // hold the office — rare enough to survive a long time and wrong every time
    // it happened.
    age: Math.max(minAge, 34 + Math.floor(rng(world) * 34)),
    college: rollCollege(world),
    gender: pick(world, GENDERS).id,
    temperament: pick(world, TEMPERAMENTS).id,
    approval: 50, reputation: 0, lineage: lineage || id, gen,
    // Hidden: how much this person actually votes on the reasons they give in
    // public, versus private interest (party, pork, a quiet arrangement). Low
    // sincerity means the stated reason is a fig leaf. Never surfaced in the
    // UI — only a member's record over many votes reveals who keeps their word.
    sincerity: 0.25 + rng(world) * 0.7,
    traits: [], bio: '', spy: null,
  };
  // A persona minted for somebody at a keyboard is marked as such, permanently
  // and independently of whether anybody is holding it right now. `playerId`
  // is cleared the moment they close the tab; this is what lets a returning
  // player be told apart from an NPC who happens to have rolled their name.
  // See actions.reclaimable.
  if (playerId) p.everPlayer = true;
  // Younger politicians arrive a shade better liked — an unspent, unblamed face
  // the country reads generously. Measured from the age of majority, so it is
  // fullest at eighteen and gone by the end of a working life. A state of
  // affairs, not a reaction, so it is written straight rather than nudged.
  p.approval = clamp(50 + YOUTH_APPROVAL * youthOf(world, p), 0, 100);
  world.personas[id] = p;
  return p;
}

export function newWorld(opts) {
  const {
    nation = 'The United States', templateId = 'federal-republic', canon = 'cold',
    ticksPerYear = 240, districtCount = 6, seedPop = 331e6, treasury = 700e9,
    seasonName = 'Season I',
  } = opts || {};

  const constitution = templateById(templateId).build(nation);
  // Districts exist to elect representatives, so draw exactly as many as the
  // constitution's district chamber has seats — never conjure an extra one at
  // ratification. Fall back to the requested count if nothing is district-elected.
  //
  // **Which chamber, though.** The House's seats are apportioned by population
  // now, so its size says nothing about how many electorates there are: forty-five
  // seats do not mean forty-five states. The Senate's does — one seat per state
  // is what an upper house *is* — so the map is cut to the first district-elected
  // chamber that is not apportioned, and only falls back to an apportioned one if
  // that is all the constitution has.
  const districted = constitution.offices.find((o) => o.electorate === 'district' && o.seats > 0 && !o.apportioned)
    || constitution.offices.find((o) => o.electorate === 'district' && o.seats > 0);
  const nDistricts = clamp(districted ? districted.seats : districtCount, 2, MAX_DISTRICTS);

  const world = {
    version: 1,
    rev: 0, // bumped by every tick and every applied action; the UI renders on it
    seasonId: uid('season'),
    seasonName,
    nation,
    canon,
    createdAt: Date.now(),
    rngState: (Math.random() * 2 ** 31) | 0,
    phase: 'convention',
    // Year 1 read as a creation myth — the republic founded at the beginning of
    // time, with nothing behind it. It has a city, a water table and three
    // citizens per district before anyone takes a seat, so it has a past;
    // the calendar should say so. FOUNDING_YEAR is the only place it is set.
    clock: { tick: 0, ticksPerYear, foundingYear: FOUNDING_YEAR },
    // The regime's colour identity becomes the Season's brand: the UI reads it
    // into --brand so an autocracy and a republic look different at a glance.
    brand: templateById(templateId).color || null,
    brandHi: templateById(templateId).colorHi || null,
    constitution,
    players: {},
    personas: {},
    seats: [],
    districts: [],
    city: { w: 12, h: 8, parcels: [] },
    economy: {
      treasury,
      taxes: { income: 0.06, sales: 0.04, property: 0.012, tariff: 0.0 },
      revenueYr: 0, spendYr: 0, gdp: 0, unemployment: null, structural: 0.05,
      history: [], debt: 0, credit: 72,
      // The money side is filled in by macro.initMacro once the map has been
      // built and there is a GDP to scale it against — see the foot of newWorld.
    },
    documents: {},
    docOrder: [],
    laws: [],
    // The docket and the reports. Cases arrive on their own; what the court
    // decides in one becomes the precedent argued in the next.
    cases: [],
    precedents: [],
    media: { outlets: [], articles: [] },
    chronicle: [],
    chat: [],
    events: [],
    elections: [],
    military: { units: 4, volunteers: 0, airforce: 0, funding: 1.0, exhaustion: 0, wars: [] },
    foreign: JSON.parse(JSON.stringify(FOREIGN)),
    conspiracies: [],
    // Declared here like everything else the world is made of. It was not, so a
    // freshly founded republic had no `companies` at all until the first thing
    // that touched it wrote `world.companies = world.companies || []`, and any
    // reader that iterated it before then threw on undefined.
    companies: [],
    intel: [],
    uprising: null,
    plot: null,
    emergency: null,
    lastActivity: Date.now(),
    directorCooldown: 180,
    endedAt: null,
    epitaph: null,
  };

  // --- districts + parcels -------------------------------------------------
  for (let i = 0; i < nDistricts; i++) {
    const name = DISTRICT_NAMES[i] || `District ${i + 1}`;
    // Real politics where the state is a real place, a coin only where it is
    // not — which under this atlas means never, but a constitution with more
    // district chambers than the atlas has states would run off the end of
    // DISTRICT_NAMES and land here.
    const st = STATES.find((x) => x.name === name) || null;
    const part = seedPartisanFor(world, name) || (() => {
      const leanId = pick(world, PARTIES).id;
      return { ...seedPartisan(world, leanId), lean: leanId };
    })();
    const leanId = part.lean;
    world.districts.push({
      id: 'd' + (i + 1), n: i + 1,
      name,
      color: PALETTE[i % PALETTE.length],
      pop: 0, homes: 0, jobs: 0, homeless: 0,
      // The census baseline — what the republic inherits on day one. Filled by
      // seedCensus below, once the districts exist to be filled.
      basePop: 0, baseHomes: 0, baseJobs: 0,
      income: st ? incomeOf(st) : Math.round(range(world, 21000, 52000)),
      mood: Math.round(range(world, 44, 62)),
      unemployment: null,
      // The median home, in thousands of dollars — a real figure per state, not
      // a roll. `recomputeEconomy` re-derives this as the mean of the district's
      // parcels, so the parcels are seeded off it too and the two agree.
      landValue: st ? homeValueOf(st) : Math.round(range(world, 40, 140)),
      order: Math.round(range(world, 45, 70)),
      health: Math.round(range(world, 45, 70)),
      lean: leanId,
      partisan: part.partisan,
      undecided: part.undecided,
      salience: { jobs: range(world, .5, 1), housing: range(world, .3, 1), taxes: range(world, .3, 1), order: range(world, .3, 1), amenity: range(world, .2, .8) },
      history: [],
    });
  }

  // The District of Columbia, which is not one of them.
  //
  // It is kept off `world.districts` on purpose. That array is "the states": the
  // Senate takes its seat count from it, Huntington-Hill apportions the House
  // across it, and `assignDistrictSeats` deals a chair for every entry. A
  // twenty-first member would quietly give the district two senators and a
  // congressman, which is the one thing about Washington that is not true.
  //
  // So it lives here instead, with exactly the two things the presidential count
  // needs - a population and a party split - in the same shape a district uses,
  // so `partisanOf` reads it without knowing it is not a state. Three electoral
  // votes, per the Twenty-third Amendment. See electoral.js.
  {
    const lib = clamp(FEDERAL_DISTRICT.democrat + range(world, -0.025, 0.025), 0.05, 0.95);
    const committed = 1 - UNDECIDED_AT_FOUNDING;
    const partisan = { democrat: committed * lib, republican: committed * (1 - lib) };
    world.dc = {
      id: 'dc', name: FEDERAL_DISTRICT.name, code: FEDERAL_DISTRICT.code,
      pop: Math.round(FEDERAL_DISTRICT.people * 1e6),
      electors: FEDERAL_DISTRICT.electors,
      lean: partisan.democrat >= partisan.republican ? 'democrat' : 'republican',
      partisan,
      undecided: UNDECIDED_AT_FOUNDING,
      mood: Math.round(range(world, 44, 62)),
    };
  }

  // One parcel per congressional district.
  //
  // It was a 12×8 grid of 96 squares cut into horizontal bands, which made a
  // parcel a fifth of a state and nothing else — an arbitrary unit with no
  // meaning outside this file. California could not be five times Montana
  // because the grid did not have five times the ground to give it, and a
  // building "in California" was in a fifth of California for no reason anyone
  // could say.
  //
  // A congressional district is the unit the country actually divides itself
  // into, so it is the unit the map divides itself into: one parcel each,
  // forty-five of them, dealt out by the same Huntington–Hill apportionment
  // that deals out the seats (rules.apportion). California gets five, Texas
  // four, the Mountain West one — so the parcels are proportional to population
  // for free, because that is the whole of what apportionment means. And they
  // are the *same* division: parcel `TX-3` is the ground that returns the
  // member sitting for TX-3, and `assignDistrictSeats` numbers both.
  //
  // `x` and `y` survive as a position *within the state* — a small grid laid
  // over the state's own parcels — because a handful of things still ask which
  // parcels are near which. Across state lines they mean nothing and nothing
  // asks; see sim.neighbours.
  const seats = houseSeatsPer(world);
  let idx = 0;
  world.districts.forEach((d, di) => {
    const n = Math.max(1, seats[di] || 1);
    const cols = Math.ceil(Math.sqrt(n));
    for (let k = 0; k < n; k++) {
      const seeded = rng(world);
      const zone = seeded < 0.42 ? 'residential' : seeded < 0.62 ? 'commercial' : seeded < 0.74 ? 'industrial' : seeded < 0.8 ? 'civic' : 'unzoned';
      world.city.parcels.push({
        i: idx++, x: k % cols, y: Math.floor(k / cols), district: d.id,
        // The numbered district this ground is, matching seat.cd. One-based,
        // like every congressional district anybody has ever said out loud.
        cd: k + 1,
        zone,
        building: null, project: null,
        // Priced properly by priceParcels once every parcel knows its state.
        landValue: Math.round(d.landValue * range(world, 0.7, 1.35)),
        pop: 0,
      });
    }
  });
  world.city.seats = world.city.parcels.length;

  // No partitionParcels: a parcel is born knowing its state, because it *is* a
  // congressional district of that state. The banded partition it replaced was
  // the only reason the grid had to be a rectangle.
  //
  // Before the water, not after: carveWater asks the map where the lakes fall,
  // and the map cannot answer until every district's ground is settled. This
  // only ever fires when the partition has left a district empty, but a water
  // parcel handed to another state afterwards is a lake in the wrong place.
  ensureEveryDistrictHasLand(world);

  // Lay the lakes before anything is built on the land.
  carveWater(world);

  // Land is priced off the state it is in, which needs partitionParcels to have
  // said which state that is.
  priceParcels(world);

  // Seed the existing stock deliberately, so the nation opens with problems
  // worth governing: housing a little short of the population, and rather
  // fewer jobs than there are people who want one.
  seedStock(world, seedPop);
  // And the census last, because it is the remainder: whatever the country has
  // that is not standing on the grid.
  seedCensus(world, seedPop);
  distributePopulation(world, seedPop);

  // --- seats ---------------------------------------------------------------
  for (const o of world.constitution.offices) {
    for (let s = 0; s < o.seats; s++) {
      world.seats.push({
        id: `${o.id}#${s + 1}`, office: o.id, index: s, personaId: null,
        district: null, cd: null, termEnds: null, since: null,
      });
    }
  }
  assignDistrictSeats(world);
  fillVacantSeats(world, true);
  seedCitizenry(world);
  recomputeEconomy(world);
  // The money side, scaled against the output the map actually produces. It has
  // to come after recomputeEconomy or the money supply is sized against a GDP
  // of zero and the republic opens with an interest rate at the floor.
  world.economy = initMacro(world.economy, world.economy.gdp);
  return world;
}

/** The share of a population that is in the labour force, looking for work or in it. */
export const LABOUR_SHARE = 0.48;

/**
 * What the ordinary business of government costs, per person, per year.
 *
 * Set so a founding republic under the default constitution opens at close to
 * break-even: about $1.1T of revenue against about $1.1T of spending. That is
 * the position the game wants — solvent, and unable to do anything new without
 * deciding where the money comes from.
 *
 * It was $1,150, which put administration at 31% of spending against the army's
 * 68% — a federal government that spent two thirds of its money on four
 * divisions and a third on everything else it does. Both numbers moved together:
 * the army came down to a realistic 14% share (see UPKEEP_PER_FORMATION) and
 * this came up to absorb the room, so the *balance* is unchanged at roughly zero
 * and only the shape of the budget is different. Without moving this too, cutting
 * the army would have handed the republic a $650bn surplus and taken money back
 * out of the game as a constraint, which is the exact thing this constant exists
 * to prevent.
 *
 * For scale it is still low: real non-defence federal spending is about $17,800
 * a head. The game's whole budget envelope is roughly a quarter of the real one
 * (revenue is 4.9% of GDP where the real figure is 18.1%), and that is a
 * deliberate simplification rather than an error — but it is why this reads
 * small against the country it is charging.
 */
export const ADMINISTRATION_PER_HEAD = 2800;

/**
 * The country the republic inherits, before it has built anything.
 *
 * This is the change that let the numbers on the Nation tab be real ones.
 * Population used to be a *consequence of the map*: `distributePopulation` set
 * a district's people to its share of the housing standing on its parcels, and
 * the parcels are ninety-six squares for the whole United States, so a state
 * held four or five of them. One building either way was a third of a state's
 * population. California could not be seven times Montana because it did not
 * have seven times the parcels, and every derived figure — unemployment, the
 * homeless count, apportionment — inherited that error.
 *
 * So the stock the country already has is seeded from the census directly, per
 * state, and the parcel grid carries what gets *built on top of it*. That is
 * also the honest reading of what the grid is: nobody founding a republic in
 * 2029 is deciding where three hundred million people live. They are deciding
 * what to add.
 *
 * Four real facts, one per line, and every one of them checkable:
 *
 * - **people** — `atlas.peopleOf`, the 2020 census. A state's share of the
 *   country is its share of the population, exactly, and it does not move with
 *   the map.
 * - **jobless** — the state's real unemployment rate, turned into a number of
 *   jobs. Great Plains 2.8%, California 5.3%.
 * - **rough** — people sleeping rough or sheltered, per ten thousand. This is
 *   the widest real spread in the country and the flat 8%-of-everybody the
 *   seeder used before hid all of it.
 * - **homeValue** — the median home, which every parcel in the state is then
 *   priced against.
 *
 * The building system is untouched and means more than it did: housing built in
 * Michigan now comes off Michigan's homeless count instead of moving Michigan's
 * population, which is what building housing actually does.
 */
function seedCensus(world, pop) {
  const ds = world.districts;
  const st = ds.map((d) => STATES.find((x) => x.name === d.name) || null);
  const weight = st.map((x) => (x ? peopleOf(x) : 1));
  const wTotal = weight.reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    const mine = world.city.parcels.filter((p) => p.district === d.id);
    const built = (key) => sum(mine, (p) => (p.building ? BUILDINGS[p.building][key] : 0));
    const people = pop * (weight[i] / wTotal);
    const rough = st[i] ? roughOf(st[i]) : 20;
    const jobless = st[i] ? joblessOf(st[i]) : 0.04;
    d.basePop = Math.round(people);
    // Housing for everyone the state does not leave on the street, and work for
    // everyone in the labour force who is not out of it — **less whatever is
    // already standing on the grid**. The stock seedStock laid down is part of
    // the country, not an addition to it: counted twice, every state opened with
    // a housing surplus and nobody sleeping rough, which is the one number on
    // the Nation tab that has to be true on day one.
    d.baseHomes = Math.max(0, Math.round(people * (1 - rough / 10000)) - built('homes'));
    d.baseJobs = Math.max(0, Math.round(people * LABOUR_SHARE * (1 - jobless)) - built('jobs'));
  }
}

/**
 * Every parcel priced off the state it is actually in.
 *
 * This ran inside the parcel loop, before `partitionParcels` had assigned any of
 * them, so the whole country was priced off `districts[0]` — and then
 * `recomputeEconomy` averaged those parcels back into each district's landValue
 * and overwrote every state's own figure with New England's on the first tick.
 */
function priceParcels(world) {
  for (const p of world.city.parcels) {
    const d = world.districts.find((x) => x.id === p.district) || world.districts[0];
    p.landValue = Math.round(d.landValue * range(world, 0.7, 1.35));
  }
}

/**
 * Lay down the founding building stock — what stands on the grid on day one.
 *
 * Not the country's housing any more: `seedCensus` carries that. This is the
 * visible development, so that the map opens with something on it and every
 * state has ground that is doing something. Targets are a share of what the
 * census already provides rather than of the population, because chasing the
 * population here is what used to make one building worth a third of a state.
 */
function seedStock(world, pop) {
  // A couple of per cent of the country, so the grid opens with something on it
  // and a state's parcels differ from each other — and no more, because the
  // seeder is not deciding where three hundred million people live. `seedCensus`
  // runs afterwards and takes this off the baseline, so what is laid here is
  // part of the country rather than a surplus on top of it.
  const homeTarget = pop * 0.02;
  const jobTarget = pop * LABOUR_SHARE * 0.02;
  const byDistrict = world.districts.map((d) => world.city.parcels.filter((p) => p.district === d.id));
  let homes = 0, jobs = 0, guard = 0;

  const place = (parcels, key) => {
    const b = BUILDINGS[key];
    const free = parcels.filter((p) => !p.building && !p.water); // nothing is built on the water
    if (!free.length) return false;
    const p = pick(world, free);
    p.building = key; p.zone = b.zone;
    homes += b.homes; jobs += b.jobs;
    return true;
  };

  // Housing first, spread so that no district starts empty — but **weighted by
  // how many people actually live there**, not dealt flat.
  //
  // A flat round-robin makes population a function of parcel count, and parcel
  // count is a function of *land*. So the Great Plains came out more populous
  // than California and the Mountain West more populous than New York, which is
  // survivable as scenery and fatal the moment a chamber is apportioned by
  // population: the empty half of the country got the seats.
  //
  // Weighted by the atlas's census, a state's housing goes in proportion to its
  // people, and the parcel it has to stand on is the only cap. That cap still
  // bites — California has four parcels and thirty-nine million people — so this
  // does not reproduce the census, it just stops the map arguing with it.
  const weight = world.districts.map((d) => peopleOf(STATES.find((x) => x.name === d.name)) || 1);
  const wTotal = weight.reduce((a, b) => a + b, 0) || 1;
  // No density lever here. The obvious one — give the crowded states the taller
  // building — does not exist to be pulled: `housing_mid` is *fewer* homes than
  // `housing_low` in this model (620 against 900), so biasing California toward
  // apartments would have given it fewer people, not more. The mix stays as it
  // was and the weighting is done by count alone.
  //
  // Every state gets a roof before any state gets a second one. This is the
  // "no district starts empty" promise the flat round-robin used to make for
  // free, and the weighted pass below cannot make it: the Mountain West's share
  // of the country is one per cent, so on entitlement alone it reached the end
  // of the housing budget with nothing built and no population at all — an
  // electorate with no electors, which is the exact fault the twenty-state split
  // was made to fix.
  for (let i = 0; i < byDistrict.length; i++) {
    place(byDistrict[i], rng(world) < 0.55 ? 'housing_low' : 'housing_mid');
  }
  // And the rest by entitlement. Fractions are carried between passes so a small
  // state still gets its turn instead of being rounded away every time round.
  const owed = weight.map(() => 0);
  while (homes < homeTarget && guard++ < 400) {
    for (let i = 0; i < byDistrict.length; i++) {
      if (homes >= homeTarget) break;
      owed[i] += (weight[i] / wTotal) * byDistrict.length;
      if (owed[i] < 1) continue;
      owed[i] -= 1;
      place(byDistrict[i], rng(world) < 0.55 ? 'housing_low' : 'housing_mid');
    }
  }
  // Civic stock next, unevenly distributed — as it always is. It employs
  // people too, so it has to be counted before the jobs target is chased.
  for (const parcels of byDistrict) {
    if (rng(world) < 0.7) place(parcels, 'sewer');
    if (rng(world) < 0.5) place(parcels, 'school');
    if (rng(world) < 0.4) place(parcels, 'park');
    if (rng(world) < 0.25) place(parcels, 'parking');
  }
  place(byDistrict[0], 'hospital');
  place(byDistrict[byDistrict.length - 1], 'jail');

  guard = 0;
  while (jobs < jobTarget && guard++ < 400) {
    for (const parcels of byDistrict) {
      if (jobs >= jobTarget) break;
      // Close the last of the gap with small employers, so the opening
      // unemployment figure lands where it was aimed instead of overshooting.
      //
      // Measured against the works itself rather than against a literal. This
      // read `gap > 900`, which was a factory's jobs when a factory employed
      // nine hundred people; the rescale took it to nine hundred thousand and
      // left the threshold behind, so the gap — now counted in millions — was
      // over it always and `market` was never once placed. Twenty-five founding
      // worlds seeded no retail at all and overshot the jobs target by 383,000
      // on average and 882,000 at worst. Written this way it cannot rot again:
      // the question is "is there more than a whole factory left to place", and
      // the factory answers it.
      const gap = jobTarget - jobs;
      const r = rng(world);
      place(parcels, gap > BUILDINGS.factory.jobs ? (r < 0.45 ? 'factory' : 'offices') : 'market');
    }
  }
  for (const p of world.city.parcels) if (!p.building && !p.water && rng(world) < 0.45) p.zone = 'unzoned';
}

/**
 * Lay the river across the map, and the lake in its corner.
 *
 * Water is the one thing on this map that is not the republic's doing. Every
 * other feature of the city — districts, zoning, what is built where — is
 * argued over and changed; the river was there first and stays put through the
 * re-partition at ratification. It also gives each district a reason to be what
 * it is: the waterfront trades and works, so it opens hungrier for jobs and
 * worth a little more per parcel.
 *
 * It is drawn from a fixed stream rather than the world's, so it is the same
 * river in every Season. It used to come off `rng(world)`, which meant wiping
 * and starting again moved the water — and the water is the part of the map a
 * player is supposed to learn once and then know. The grid is a constant 12×8,
 * but the seed is keyed on the dimensions anyway so a differently shaped city
 * would get its own consistent river rather than this one, clipped.
 */
function carveWater(world) {
  // **Water goes where there is water, and only where it has a name.**
  //
  // Two versions ago this carved a river clean across the grid and dropped a
  // two-by-two lake in a corner, which is a good river for a city of twelve
  // parcels by eight. The grid is the whole country now, so that was replaced
  // with: every state the sea or a Great Lake touches loses one or two of its
  // parcels to water, picked at random.
  //
  // Which is still wrong, and wrong in the way a reader can see. It put a teal
  // blot in the middle of Texas, another somewhere in the Carolinas, another in
  // the Deep South — inland lakes that are not there, in states whose only water
  // is a coastline three hundred miles away, and a different set of them every
  // time the grid changed. On an invented continent that reads as landscape. On
  // this one the reader knows there is no lake in the middle of Texas.
  //
  // So the dice are gone. A parcel is water if the ground it is drawn on is
  // actually inside one of the atlas's named lakes — the five Great Lakes and
  // the Great Salt Lake, which is the whole list, because the atlas's rule is
  // that a lake is on the map only if it can be named. `cityGeometry` is the
  // same subdivision the domestic map draws, so a water parcel is now the parcel
  // the lake is genuinely sitting on, and not merely one in the right state.
  // Measured by area, not by centre. There are forty-five parcels for the whole
  // country — one per congressional district — so one of them is the size of a
  // small state and no lake on earth contains a parcel's midpoint — testing the centre found nothing at all. What
  // is being asked is "is this parcel mostly lake", so the parcel is sampled on a
  // grid and the answer is the fraction of it under water.
  // A quarter of the parcel under water, and at the scale the parcels are drawn
  // at now, nothing reaches it — which is the correct answer rather than a
  // failure of the threshold. A parcel is a congressional district, and no
  // congressional district in the United States is mostly lake: the lakiest of
  // ours is New York's third at 17% and Michigan's first at 13%, both of which
  // are lakeshore districts full of people, not stretches of open water.
  //
  // The rule is kept because it is the right rule and it is scale-free: `water`
  // means "there is nothing here to build on", and if the ground is ever cut
  // finer than a district again, the parcels that are genuinely lake will be
  // marked and stay unbuildable. What draws the Great Lakes on the map is the
  // lakes themselves (ui.cityMap reads atlas.LAKES), not this.
  const LAKE_SHARE = 0.25;
  const lakeBoxes = LAKES.map((l) => ({ lake: l, b: bounds(l.poly) }));
  const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

  const geom = cityGeometry(world);
  const wet = new Set();
  const byDistrict = new Map();
  for (const cell of geom.cells || []) {
    for (const pc of cell.parcels || []) {
      if (!pc.parcel || !pc.poly || pc.poly.length < 3) continue;
      const pb = bounds(pc.poly);
      // Almost every parcel is nowhere near a lake, and sampling all of them is
      // a quarter of a million point-in-polygon tests for four answers. The box
      // check throws out everything but the dozen that could possibly qualify.
      const near = lakeBoxes.filter((lb) => overlaps(pb, lb.b));
      if (!near.length) continue;
      let inside = 0, under = 0;
      for (let y = pb.y0; y <= pb.y1; y += 0.4) {
        for (let x = pb.x0; x <= pb.x1; x += 0.4) {
          if (!inPoly([x, y], pc.poly)) continue;
          inside++;
          if (near.some((lb) => inPoly([x, y], lb.lake.poly))) under++;
        }
      }
      if (!inside || under / inside < LAKE_SHARE) continue;
      const list = byDistrict.get(cell.district.id) || [];
      list.push(pc.parcel.i);
      byDistrict.set(cell.district.id, list);
    }
  }
  // Never take a state's last buildable ground. Lake Michigan covers a great
  // deal of Michigan on this projection, and a state that is entirely water is a
  // state nobody can govern.
  //
  // One parcel, not two. A parcel is a congressional district now, so a state
  // with one seat has one parcel and there is no second to hold back — under
  // the old rule the Mountain West could never be given a lake, and Michigan,
  // which has three, could only ever be given one. What has to be true is that
  // a state keeps somewhere to build.
  for (const [id, list] of byDistrict) {
    const owned = world.city.parcels.filter((p) => p.district === id).length;
    const keep = Math.max(0, Math.min(list.length, owned - 1));
    for (const i of list.slice().sort((a, b) => a - b).slice(0, keep)) wet.add(i);
  }

  world.city.water = [...wet].sort((a, b) => a - b);
  for (const p of world.city.parcels) p.water = wet.has(p.i);

  // The port character, from the atlas's own fact rather than from where the
  // dice happened to land. `isCoastal` is the authored answer to "does the sea
  // or a Great Lake touch this state" — fifteen of the twenty — and it is a
  // better one than adjacency to a water parcel ever was: a coastal state has a
  // working port whether or not any of its parcels came out wet.
  for (const d of world.districts) {
    if (!isCoastal(d.name)) continue;
    d.salience.jobs = clamp(d.salience.jobs + 0.15, 0, 1.2);
    d.landValue = Math.round(d.landValue * 1.08);
  }
}

/** Population follows housing; homelessness is the gap. */
/**
 * Cut the map into `n` contiguous districts of roughly equal size.
 *
 * The old version laid a cols×rows grid over the city and clamped any spare cell
 * onto the last district — so seven districts on a 3×3 grid gave six of them one
 * cell and the seventh three, which is a district with double the land and double
 * the population of its neighbours for no reason anyone chose.
 *
 * Instead the districts are dealt across horizontal bands as evenly as they go
 * (7 → 3, 2, 2) and each band is split into that many columns. Every district is
 * one rectangle, they tile the city exactly, and the largest is never more than
 * one parcel-row bigger than the smallest.
 */
/**
 * Deal the ground out again after the map has changed.
 *
 * Every state gets as many parcels as it has congressional districts, which is
 * what `houseSeatsPer` says and what the House itself is apportioned by. A
 * state that kept its name and its seats keeps its parcels intact — the
 * buildings on them, the zoning, the prices — because there is nothing to
 * change about ground that did not move. A state that gained a seat gets a new
 * empty parcel; one that lost a seat loses its last, and whatever was standing
 * on it goes with it, which is what losing a district means.
 */
export function remintParcels(world) {
  const want = houseSeatsPer(world);
  const kept = [];
  world.districts.forEach((d, di) => {
    const n = Math.max(1, want[di] || 1);
    const own = world.city.parcels.filter((p) => p.district === d.id)
      .sort((a, b) => (a.cd || 0) - (b.cd || 0));
    for (let k = 0; k < n; k++) {
      const cols = Math.ceil(Math.sqrt(n));
      const p = own[k] || {
        district: d.id, zone: 'unzoned', building: null, project: null,
        landValue: Math.round(d.landValue || 100), pop: 0,
      };
      p.district = d.id; p.cd = k + 1;
      p.x = k % cols; p.y = Math.floor(k / cols);
      kept.push(p);
    }
  });
  kept.forEach((p, i) => { p.i = i; });
  world.city.parcels = kept;
  world.city.seats = kept.length;
  // The water indices are parcel ids and the ids have just been rewritten.
  world.city.water = kept.filter((p) => p.water).map((p) => p.i);
}

export function partitionParcels(world, n) {
  const { w, h } = world.city;

  // How the districts are dealt across `bands` horizontal strips, remainder to
  // the top. The index of each district is then band-offset plus column.
  const layout = (bands) => {
    const perBand = Array.from({ length: bands }, (_, r) =>
      Math.floor(n / bands) + (r < n % bands ? 1 : 0)).filter((c) => c > 0);
    const firstOf = []; let acc = 0;
    for (const c of perBand) { firstOf.push(acc); acc += c; }
    return { perBand, firstOf };
  };
  const indexOf = (L, x, y) => {
    const band = Math.min(L.perBand.length - 1, Math.floor((y / h) * L.perBand.length));
    const cols = L.perBand[band];
    return Math.min(n - 1, L.firstOf[band] + Math.min(cols - 1, Math.floor((x / w) * cols)));
  };

  // Pick the band count by measuring what it actually produces rather than
  // assuming √n. The parcel grid is coarse (12×8), so the arithmetic that looks
  // even in the abstract often is not: three districts over two bands gives
  // 24/24/48, and over one band gives 32/32/32. Score by the spread in real
  // parcel counts, and break ties toward the squarest districts.
  let best = null;
  for (let bands = 1; bands <= Math.min(n, h); bands++) {
    const L = layout(bands);
    const counts = new Array(n).fill(0);
    for (const p of world.city.parcels) counts[indexOf(L, p.x, p.y)]++;
    if (counts.some((c) => c === 0)) continue;
    const spread = Math.max(...counts) - Math.min(...counts);
    // Aspect of a typical district, as a ratio ≥ 1.
    const cw = w / L.perBand[0], ch = h / L.perBand.length;
    const aspect = Math.max(cw / ch, ch / cw);
    if (!best || spread < best.spread || (spread === best.spread && aspect < best.aspect)) {
      best = { L, spread, aspect };
    }
  }
  const L = (best || { L: layout(Math.max(1, Math.round(Math.sqrt(n)))) }).L;
  for (const p of world.city.parcels) p.district = world.districts[indexOf(L, p.x, p.y)].id;
}

/**
 * No district without land.
 *
 * A partition that misses a district is a silent failure — the district keeps its
 * name, its colour and its seat in the chamber, and simply has nowhere in it, so
 * it reports no people and no unemployment while still returning a member. The
 * partition above is correct now, but this is cheap and it turns any future
 * arithmetic slip into a visible redraw rather than a phantom electorate.
 *
 * Anything landless is given parcels off whichever district has the most, taken
 * from the edge nearest the taker so the result stays contiguous.
 */
export function ensureEveryDistrictHasLand(world) {
  const parcels = world.city.parcels;
  const held = (id) => parcels.filter((p) => p.district === id);
  let fixed = 0;
  for (const d of world.districts) {
    if (held(d.id).length) continue;
    const biggest = world.districts
      .map((x) => ({ x, own: held(x.id) }))
      .filter((e) => e.own.length > 2)
      .sort((a, b) => b.own.length - a.own.length)[0];
    if (!biggest) break;
    // Hand over a corner of it: the parcels furthest from that district's own
    // centre, so what it keeps stays in one piece.
    const cx = sum(biggest.own, (p) => p.x) / biggest.own.length;
    const cy = sum(biggest.own, (p) => p.y) / biggest.own.length;
    const take = biggest.own
      .slice()
      .sort((a, b) => ((b.x - cx) ** 2 + (b.y - cy) ** 2) - ((a.x - cx) ** 2 + (a.y - cy) ** 2))
      .slice(0, Math.max(1, Math.floor(biggest.own.length / 3)));
    for (const p of take) p.district = d.id;
    fixed++;
  }
  return fixed;
}

/**
 * Where the country's people are, and how many of them have a roof.
 *
 * **A state's population is its census share and does not move with the map.**
 * It used to be its share of the housing standing on its parcels, which made
 * one building worth a third of a state — see seedCensus for why that had to go.
 *
 * What building housing does now is take people off the street in the state it
 * was built in, which is what building housing actually does. A district's
 * homeless is its own people minus its own roofs: local, so a shelter programme
 * in Michigan is felt in Michigan and nowhere else, and so the six-to-one spread
 * between New York and Virginia that the atlas records survives into the game
 * instead of being averaged into one national rate and dealt back out.
 */
export function distributePopulation(world, total) {
  const parcels = world.city.parcels;
  const ds = world.districts;
  // A Season founded before the census existed has no `basePop` on any district,
  // and the share below would then be 1/20 for every one of them — the country
  // dealt out in twenty equal heaps, which is worse than the parcel-count
  // guess it replaced. Take a census off the atlas and the population the save
  // already carries.
  //
  // It will still be a strange republic: its treasury was denominated before
  // the thousandfold rescale and will not cover a year of administration. An
  // old save is worth loading to read, not to keep playing.
  if (!ds.some((d) => d.basePop)) seedCensus(world, sum(ds, (d) => d.pop) || 331e6);
  const byD = new Map(ds.map((d) => [d.id, []]));
  for (const p of parcels) byD.get(p.district)?.push(p);

  const censusTotal = sum(ds, (d) => d.basePop || 0);
  const target = total ?? (censusTotal || sum(ds, (d) => d.pop));

  for (const d of ds) {
    const mine = byD.get(d.id) || [];
    const built = sum(mine, (p) => (p.building ? BUILDINGS[p.building].homes : 0));
    const share = censusTotal ? (d.basePop || 0) / censusTotal : 1 / ds.length;
    d.pop = Math.round(target * share);
    d.homes = (d.baseHomes || 0) + built;
    d.jobs = (d.baseJobs || 0) + sum(mine, (p) => (p.building ? BUILDINGS[p.building].jobs : 0));
    d.homeless = Math.max(0, d.pop - d.homes);

    // The people are spread over the district's ground, and a parcel with
    // housing on it holds more of them than one without. This is the picture on
    // the city map, not an input to anything: a parcel's population used to be
    // its share of the national housing stock, so once the census carried the
    // country every unbuilt parcel read as empty ground with nobody on it.
    const weightOf = (p) => (p.water ? 0 : 1 + (p.building ? BUILDINGS[p.building].homes : 0) / 4e6);
    const wTotal = sum(mine, weightOf) || 1;
    for (const p of mine) p.pop = Math.round(d.pop * (weightOf(p) / wTotal));

    // Relief housing disbursed from the treasury persists across this recompute —
    // people a shelter programme took off the street stay off it until the
    // structural deficit is itself cleared. Without this, homelessness snapped
    // back to the map's raw figure the next time any building opened, and a
    // disbursal that plainly housed people "did nothing". Trimmed to the current
    // deficit so relief can never bank below zero. See acts.SPEND_EFFECTS housing.
    const relief = Math.min(d.shelterRelief || 0, d.homeless);
    d.homeless -= relief;
    d.shelterRelief = relief;
  }
}

/**
 * Which state each district seat represents, and — for an apportioned chamber —
 * which numbered congressional district inside it.
 *
 * **The districts are stable.** This used to be a round-robin done twice: once
 * at world creation and again at ratification, where `beginSeason` re-cut the
 * map to the House's seat count and re-dealt every seat across it. That is where
 * "a district drawn at ratification" came from, and it meant the electorate a
 * founder took a chair in was not necessarily the one they ended up sitting for.
 * The states are the atlas's twenty and they do not move; the seats are dealt
 * across them once, by population, and the numbering that comes out is fixed for
 * the Season.
 *
 * An unapportioned chamber (the Senate) gets one seat per state, in the atlas's
 * order. An apportioned one (the House) gets its seats divided by Huntington–Hill
 * and each seat named `CODE-n` — TX-1, TX-2, TX-3 — where CODE is the region's
 * own code from the atlas. A state holding a single seat is still numbered: it is
 * `MI-1`, not `MI`, because "the third district of Texas" and "the district of
 * Michigan" should read as the same kind of thing.
 *
 * Idempotent, and safe to run again after the map changes.
 */
/**
 * How many congressional districts each state has — which is how many parcels.
 *
 * The same Huntington–Hill apportionment that deals out the House's seats, over
 * the same populations, so a state's ground and a state's delegation cannot
 * disagree about how many pieces it is in. Read off `atlas.peopleOf` rather than
 * `d.pop`, because this runs before `distributePopulation` has put anybody
 * anywhere — the census is the source of truth for both, so both get the same
 * answer.
 *
 * Falls back to one parcel each if the constitution has no apportioned chamber:
 * a table that struck the House at the convention still has a country, and a
 * country still has ground in it.
 */
function houseSeatsPer(world) {
  const ds = world.districts || [];
  if (!ds.length) return [];
  const house = (world.constitution?.offices || [])
    .find((o) => o.apportioned && o.electorate === 'district' && o.seats > 0);
  if (!house) return ds.map(() => 1);
  const pops = ds.map((d) => {
    const st = STATES.find((x) => x.name === d.name);
    return st ? peopleOf(st) : 1;
  });
  return apportion(pops, Math.max(ds.length, house.seats));
}

export function assignDistrictSeats(world) {
  const ds = world.districts || [];
  if (!ds.length) return;
  const codeFor = (d) => codeOf(STATES.find((x) => x.name === d.name)) || (d.name || '?').slice(0, 2).toUpperCase();

  for (const o of world.constitution.offices) {
    if (o.electorate !== 'district') continue;
    const mine = world.seats.filter((s) => s.office === o.id).sort((a, b) => a.index - b.index);
    if (!mine.length) continue;

    // Which class each chair sits in, for a chamber that turns over in parts.
    // Dealt round-robin across the seats in index order, so a state's chairs
    // land in different classes wherever a state holds more than one — which is
    // what keeps a whole state from going to the polls at once. `null` for an
    // office that polls as one body, which is every office but the Senate.
    //
    // Here rather than at the founding because this is the one place seats are
    // laid out, it is idempotent, and it runs again at ratification: a class
    // stamped anywhere else would be lost the moment the map was re-cut.
    const cohorts = cohortsOf(o);
    mine.forEach((seat, i) => { seat.cohort = cohorts > 1 ? i % cohorts : null; });

    if (!o.apportioned) {
      // One per state, in the atlas's order, and no congressional district — a
      // senator represents the whole state and numbering them would imply a line
      // drawn through it that does not exist.
      mine.forEach((seat, i) => {
        seat.district = ds[i % ds.length].id;
        seat.cd = null;
      });
      continue;
    }

    // Population at the moment the seats are cut. Zero everywhere is a legitimate
    // state of the world — seats are laid out before the citizenry in some paths —
    // and apportion() handles it by giving everybody the same one seat.
    const share = apportion(ds.map((d) => d.pop || 0), mine.length);
    let k = 0;
    ds.forEach((d, i) => {
      const code = codeFor(d);
      for (let n = 1; n <= share[i]; n++) {
        const seat = mine[k++];
        if (!seat) return;
        seat.district = d.id;
        seat.cd = `${code}-${n}`;
      }
    });
    // Any seat the apportionment could not place — only possible if the office
    // has more seats than apportion was asked for, which repairConstitution
    // prevents — still gets a home rather than sitting district-less.
    for (; k < mine.length; k++) {
      const d = ds[k % ds.length];
      mine[k].district = d.id;
      mine[k].cd = `${codeFor(d)}-x`;
    }
  }
}

/** How many seats of an office a state holds. Read by the map and the roster. */
export const seatsOfDistrict = (world, officeId, districtId) =>
  world.seats.filter((s) => s.office === officeId && s.district === districtId);

export function fillVacantSeats(world, initial = false) {
  for (const seat of world.seats) {
    // Exile is a disqualification, not merely a death that has not happened
    // yet. Checking only `alive` let this seat somebody the republic had thrown
    // out, and tickTerms then vacated them again on the next tick — a chair
    // filled and emptied for ever, with an exile holding office in between.
    const sitting = seat.personaId && world.personas[seat.personaId];
    if (sitting && sitting.alive && !sitting.exiled) continue;
    const o = world.constitution.offices.find((x) => x.id === seat.office);
    if (o?.atWill) continue; // cabinet posts are staffed only by deliberate appointment, never auto-seated
    const d = seat.district ? world.districts.find((x) => x.id === seat.district) : null;
    // A seated citizen is old enough for the chair they are seated in.
    const needAge = Math.max(0, Math.floor(+o?.minAge) || 0);
    const p = makePersona(world, { synthetic: true, district: seat.district, party: d ? d.lean : null, minAge: needAge });
    p.bio = `Seated citizen. ${o ? o.name : 'Office'}${d ? ' for ' + d.name : ''}.`;
    seat.personaId = p.id;
    seat.since = world.clock.tick;
    seat.termEnds = termEndTick(world, o || { id: seat.office, termYears: 4 }, world.clock.tick);
  }
}

export function totalPop(world) { return sum(world.districts, (d) => d.pop); }

/**
 * Representation is per district, so the map has to follow the constitution:
 * one district per seat in whichever chamber is elected by district. Called at
 * ratification, once the founders have settled how many seats there are.
 *
 * Existing parcels are re-partitioned rather than regenerated — the city that
 * was seeded stays standing, the lines through it move.
 */
export function reshapeDistricts(world, count) {
  const target = Math.max(1, Math.min(MAX_DISTRICTS, Math.round(count)));
  const pop = totalPop(world) || 331e6;
  if (world.districts.length === target) return false;

  const old = world.districts;
  const next = [];
  for (let i = 0; i < target; i++) {
    // Reuse a district wholesale where we can, so names, mood and history survive.
    const keep = old[i];
    next.push(keep || {
      id: 'd' + (i + 1), n: i + 1,
      name: DISTRICT_NAMES[i] || `District ${i + 1}`,
      color: PALETTE[i % PALETTE.length],
      pop: 0, homes: 0, jobs: 0, homeless: 0,
      basePop: 0, baseHomes: 0, baseJobs: 0,
      // A district drawn here is still one of the atlas's states, so it takes
      // that state's real figures like every other one. It used to take a random
      // income and a flat land value of 90, which made a redrawn map a different
      // country from the one it replaced.
      income: incomeOf(STATES.find((x) => x.name === (DISTRICT_NAMES[i] || ''))) || 70000,
      mood: Math.round(range(world, 44, 62)),
      unemployment: null, structural: null,
      landValue: homeValueOf(STATES.find((x) => x.name === (DISTRICT_NAMES[i] || ''))) || 300,
      order: 55, health: 55,
      lean: pick(world, PARTIES).id,
      salience: { jobs: range(world, .5, 1), housing: range(world, .3, 1), taxes: range(world, .3, 1), order: range(world, .3, 1), amenity: range(world, .2, .8) },
      history: [],
    });
  }
  world.districts = next;
  // Every district carries a partisan split, including a reused one from an old
  // save that predates the party system and any freshly-drawn one above.
  for (const d of world.districts) {
    if (d.partisan) continue;
    const part = seedPartisanFor(world, d.name)
      || seedPartisan(world, d.lean || PARTIES[0].id);
    d.partisan = part.partisan; d.undecided = part.undecided;
    if (part.lean) d.lean = part.lean;
  }

  // Re-cut the ground for the states that now exist.
  //
  // This used to call `partitionParcels`, which sliced the old 12×8 rectangle
  // into contiguous bands. There is no rectangle: a parcel is a congressional
  // district, dealt out by apportionment, so the number of them changes with the
  // number of states and the way they divide changes with the census. Minting
  // them again is the only honest answer — and anything standing on ground that
  // still belongs to the same state stays standing on it.
  remintParcels(world);
  ensureEveryDistrictHasLand(world);
  // The map has moved, so the census has to be taken again: parcels have changed
  // hands, a district may be new, and the baseline is defined as whatever a state
  // has that is not standing on the grid. Without this a freshly drawn district
  // carries no basePop, `distributePopulation` gives it none of the country, and
  // the republic acquires an electorate with no electors — the exact fault the
  // twenty-state split was made to fix.
  priceParcels(world);
  seedCensus(world, pop);
  distributePopulation(world, pop);
  recomputeEconomy(world);
  return true;
}

/** Rebuild every derived economic figure from the map and the tax code. */
/**
 * People who are not in the government.
 *
 * The republic used to open with exactly as many personas as it had seats, and
 * every one of them sat in one. That made a whole class of things unplayable
 * rather than hard: the President's appointment dropdowns were empty, so the
 * cabinet could only ever be filled by poaching a member of the chamber; a
 * founder had nobody to hire; and a challenger in an election had to be an
 * incumbent of something. A country consisting entirely of officeholders is
 * not a country, it is a committee.
 *
 * Three per district, which fills the cabinet and the bench several times over,
 * gives every election a field of outsiders, and staffs the first year of a
 * company — without minting so many names that the roster stops being a cast
 * you can keep in your head.
 */
const CITIZENS_PER_DISTRICT = 3;

function seedCitizenry(world) {
  for (const d of world.districts) {
    for (let i = 0; i < CITIZENS_PER_DISTRICT; i++) {
      makePersona(world, { synthetic: true, district: d.id });
    }
  }
}

/**
 * How many people a site employs while it is being built.
 *
 * Construction used to employ nobody: only finished buildings counted toward
 * jobs, so a five-year programme of public works was five years of the money
 * leaving the treasury with no one put to work, and then a step change on the
 * day the ribbon was cut. That is exactly backwards from the reason a
 * government orders public works in a slump.
 *
 * Estimated off the cost, because that is the honest driver — a bigger site is
 * a bigger crew — at a figure that makes a single ordinary building worth
 * something a district can feel without one project fixing unemployment on its
 * own. A $15M factory carries about 190 people for the year and a half it
 * takes; the park down the road carries 25. The crew goes home when the
 * building opens, which is when its permanent jobs start counting instead.
 */
export const CONSTRUCTION_COST_PER_WORKER = 80000;
export const constructionCrew = (project) =>
  (project ? Math.round((project.cost || 0) / CONSTRUCTION_COST_PER_WORKER) : 0);

export function recomputeEconomy(world) {
  const e = world.economy, t = e.taxes;
  let gdp = 0, wages = 0, land = 0, upkeep = 0, extra = 0, jobs = 0, homes = 0, units = 0;
  let building = 0;
  for (const p of world.city.parcels) {
    // A site under construction is a payroll before it is a building.
    if (p.project) { const crew = constructionCrew(p.project); jobs += crew; building += crew; }
    // Every parcel is taxable ground whether or not anything stands on it. This
    // sat below the `continue` and so counted only the built ones, which put the
    // whole country's land base at about a twentieth of what it is and made the
    // property rate a dial connected to nothing.
    //
    // A parcel is a ninety-sixth of the United States, and `landValue` is the
    // median home there in thousands of dollars — so the multiplier is what
    // turns one into the other, and it is set so the national land base comes
    // out around twenty-three trillion, which is roughly what it is.
    land += p.landValue * 7e8;
    const b = p.building ? BUILDINGS[p.building] : null;
    if (!b) continue;
    gdp += b.output || 0;
    upkeep += b.upkeep || 0;
    extra += b.revenue || 0;
    jobs += b.jobs; homes += b.homes;
    units += b.units || 0;
  }
  e.constructionJobs = building;
  // The private sector employs people, and until now the labour market did not
  // notice. A founder could hire forty people out of a district and its
  // unemployment would not move by a hundredth of a point — which made
  // company.js a scoreboard running beside the country rather than inside it,
  // and it is the one thing that file exists not to be. Payroll is payroll.
  const staff = sum(world.companies || [], (c) => (c.closed ? 0 : (c.employees || []).length));
  e.privateJobs = staff;
  jobs += staff;
  // The work the country already had. Without it the whole United States is
  // employed by whatever the seeder dropped on ninety-six squares, and national
  // unemployment pins to the 60% ceiling on the first tick — see seedCensus.
  const inherited = sum(world.districts, (d) => d.baseJobs || 0);
  jobs += inherited;
  homes += sum(world.districts, (d) => d.baseHomes || 0);
  const pop = totalPop(world);
  const labor = pop * LABOUR_SHARE;
  // Structural unemployment is what the map dictates: people who want work,
  // minus jobs that exist. The headline figure drifts toward it, and a slump
  // pushes the headline above it until the slump passes.
  e.structural = clamp(1 - jobs / Math.max(labor, 1), 0.012, 0.6);
  if (e.unemployment == null) e.unemployment = e.structural;
  for (const d of world.districts) {
    const dl = d.pop * LABOUR_SHARE;
    // The crew on a site in this district counts here too, so a public works
    // programme is felt where the ground is broken and not only nationally.
    //
    // And so does a company's payroll, in the district the company is actually
    // in. The national count above has always included private jobs, but the
    // *local* term counted only buildings on the map — so forty people hired in
    // Kiln Hill moved the national figure by forty and moved Kiln Hill by the
    // 60% share of it that every district got equally. The one district where
    // those forty people live and work saw almost none of it, which is the same
    // complaint the national fix answered one level up: payroll is payroll, and
    // it happens somewhere.
    const dj = (d.baseJobs || 0)
      + sum(world.city.parcels.filter((p) => p.district === d.id),
        (p) => (p.building ? BUILDINGS[p.building].jobs : 0) + constructionCrew(p.project))
      + sum(world.companies || [], (c) => (!c.closed && c.district === d.id ? (c.employees || []).length : 0));
    // People commute. A district with no factories is not 70% unemployed; it
    // is somewhat worse off than the city it sits in.
    const local = clamp(1 - dj / Math.max(dl, 1), 0.01, 0.7);
    // Weighted toward the local figure rather than the national one. At 60/40
    // the blend flattened the country: the atlas records a real spread from the
    // Great Plains' 2.8% to California's 5.3%, and what came out the other side
    // was 3.6 to 4.6 — every state within a point of the average, which is the
    // opposite of what a map of American unemployment looks like. People commute,
    // so the national term stays; it just does not get to be the bigger half.
    d.structural = clamp(e.structural * 0.4 + local * 0.6, 0.008, 0.55);
    if (d.unemployment == null) d.unemployment = d.structural;
    d.landValue = Math.round(
      sum(world.city.parcels.filter((p) => p.district === d.id), (p) => p.landValue) /
      Math.max(1, world.city.parcels.filter((p) => p.district === d.id).length));
  }
  wages = sum(world.districts, (d) => d.pop * LABOUR_SHARE * (1 - d.unemployment) * d.income);
  // Output is about twice the wage bill: labour's share of it is a little over
  // half, and the rest is profit, rent and the state. It was `wages * 0.9`, which
  // put national output *below* national pay — survivable while the whole economy
  // was twenty-four thousand people and plainly wrong once it is the real one.
  gdp += wages * 1.9;
  e.gdp = gdp;
  const income = wages * t.income * 0.93;
  const sales = wages * 0.62 * t.sales;
  const property = land * t.property;
  const tariff = 8e11 * t.tariff;
  e.revenueYr = income + sales + property + tariff + extra;
  e.breakdown = { income, sales, property, tariff, other: extra };
  const payroll = world.seats.length * 3e7;
  // The bill that arrives whether or not the chamber votes: the schools, the
  // courts, the roads, the pensions and the administration the republic
  // inherits along with the country. Nothing in the game builds it and nothing
  // can strike it — it is what governing three hundred million people costs.
  //
  // Without it the founding budget ran a $385B surplus against a $1.25T revenue
  // and the treasury reached $2.9T inside six canon years, which takes money
  // out of the game as a constraint: every programme is affordable, so no
  // programme is a decision. With it the republic opens at roughly break-even
  // and any new spending has to come from somewhere.
  //
  // It scales with population, so annexing a country costs money to govern as
  // well as to take — which is the correct incentive and was free to get.
  const administration = totalPop(world) * ADMINISTRATION_PER_HEAD;
  const programs = sum(world.programs || [], (p) => p.cost || 0);
  // Upkeep scales with every formation under arms, not just the regular line:
  // a volunteer division is cheap (a third of a regular's keep) and an air wing
  // dear (three times it). Raise more and the standing bill rises with it.
  const milit = (world.military.units
    + (world.military.volunteers || 0) * 0.3
    + (world.military.airforce || 0) * 3) * UPKEEP_PER_FORMATION * world.military.funding;
  // Debt is priced at what the market actually charges this state: the short
  // rate the money market clears at, plus the credit spread, plus the premium
  // for crowding out. macro.tickMacro computes it and leaves it on marketRate;
  // the fallback is the old credit-rating-only formula, for the first recompute
  // of a world that has not ticked yet.
  const rate = e.marketRate
    ?? (0.03 + (1 - Math.min(1, Math.max(0, (e.credit ?? 72) / 100))) * 0.09);
  const interest = (e.debt || 0) * rate;
  e.interestRate = rate;
  e.spendYr = upkeep + payroll + programs + milit + interest + administration;
  e.spendBreakdown = { upkeep, payroll, programs, military: milit, interest, administration };
  world.stock = { jobs, homes, units };
  return e;
}

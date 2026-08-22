// Genesis. Builds the map, the citizenry, the ledger and the offices.

import { rng, range, pick, clamp, uid, sum, mulberry32, hashSeed, PALETTE, youthOf, YOUTH_APPROVAL } from './util.js';
import { templateById, termEndTick, apportion } from './rules.js';
import { initMacro } from './macro.js';
import { STATE_NAMES, isCoastal, LAKES, STATES, codeOf, peopleOf } from './atlas.js';
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
  housing_low: { name: 'Low-Income Housing', zone: 'residential', cost: 8e6, years: 1.2, jobs: 60, homes: 900, upkeep: 4e5, land: -6, mood: 2, tag: 'housing' },
  housing_mid: { name: 'Apartments', zone: 'residential', cost: 12e6, years: 1.0, jobs: 40, homes: 620, upkeep: 2e5, land: 4, mood: 1, tag: 'housing' },
  factory: { name: 'Factory', zone: 'industrial', cost: 15e6, years: 1.6, jobs: 900, homes: 0, upkeep: 6e5, land: -9, mood: -2, output: 26e6, tag: 'jobs' },
  offices: { name: 'Office Block', zone: 'commercial', cost: 18e6, years: 1.4, jobs: 700, homes: 0, upkeep: 5e5, land: 7, mood: 0, output: 34e6, tag: 'jobs' },
  market: { name: 'Market Row', zone: 'commercial', cost: 6e6, years: 0.7, jobs: 240, homes: 0, upkeep: 2e5, land: 3, mood: 2, output: 9e6, tag: 'jobs' },
  park: { name: 'Public Park', zone: 'park', cost: 2e6, years: 0.4, jobs: 12, homes: 0, upkeep: 1.5e5, land: 11, mood: 5, tag: 'amenity' },
  school: { name: 'School', zone: 'civic', cost: 9e6, years: 1.1, jobs: 130, homes: 0, upkeep: 9e5, land: 6, mood: 5, tag: 'amenity' },
  hospital: { name: 'Hospital', zone: 'civic', cost: 20e6, years: 1.8, jobs: 420, homes: 0, upkeep: 1.6e6, land: 5, mood: 6, tag: 'amenity' },
  sewer: { name: 'Sewer Works', zone: 'civic', cost: 6e6, years: 0.9, jobs: 70, homes: 0, upkeep: 3e5, land: 2, mood: 3, tag: 'infra' },
  parking: { name: 'Parking Structure', zone: 'commercial', cost: 1.5e6, years: 0.3, jobs: 18, homes: 0, upkeep: 6e4, land: -2, mood: -1, revenue: 4.2e5, tag: 'revenue' },
  jail: { name: 'Jail', zone: 'civic', cost: 12e6, years: 1.3, jobs: 180, homes: 0, upkeep: 1.2e6, land: -16, mood: -3, order: 8, tag: 'order' },
  barracks: { name: 'Barracks', zone: 'civic', cost: 10e6, years: 1.2, jobs: 300, homes: 0, upkeep: 1.4e6, land: -6, mood: -1, units: 2, tag: 'military' },
};

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
// Two parties, and a country that mostly sorts itself between them. Liberal is
// yellow and spends, taxes and loosens; Conservative is purple and holds the
// line on all three. `lean` is the party's consistent stance on the issues a
// bill can touch (see sim.syntheticBallot), signed the same way a bill's clauses
// are: positive spend/tax = for spending and taxing, positive order = for order.
// Each party's ideology, as a lean across the kinds of legislation the chamber
// actually sees: spending, public order, taxation, and civil rights. The signs
// are the politics — a Liberal spends, taxes to pay for it, is wary of the order
// apparatus and warm to rights; a Conservative is the mirror. syntheticBallot
// reads these on every relevant clause, so a member votes their party's line as
// a matter of course, and the opposition whips against the government's bills on
// top of it. Keep the two rows opposed and roughly balanced.
export const PARTIES = [
  { id: 'liberal', name: 'Liberal', color: '#e0c020', lean: { spend: 0.6, order: -0.35, tax: 0.5, rights: 0.5 } },
  { id: 'conservative', name: 'Conservative', color: '#7d5ba6', lean: { spend: -0.5, order: 0.45, tax: -0.5, rights: -0.4 } },
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

export const FOREIGN = [
  { id: 'canada', name: 'Canada', ideology: 'fascist', hostility: 34, strength: 120, blurb: 'A rearming neighbour that reads restraint as invitation.' },
  { id: 'sab', name: 'The Antilles League', ideology: 'mercantile league', hostility: 12, strength: 70, blurb: 'An island trading bloc off the keys. Three ports and a tariff schedule with opinions.' },
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
    blurb: 'Older than the country. Opens doors, and invites resentment through every one of them.' },
  { id: 'meridian', name: 'Georgetown University', prestige: 3, share: 0.15,
    blurb: 'Where the foreign service is trained, and where it recruits.' },
  { id: 'harborlight', name: 'Rutgers University', prestige: 2, share: 0.28,
    blurb: 'Engineers, surveyors, county road commissioners. Builds things; distrusts speeches.' },
  // The only college whose name is not fixed. `stateCollegeName` in this module
  // resolves it against the player's home state, so a founder from Ohio Valley
  // went to Ohio Valley State University and one from Texas did not.
  { id: 'northgate', name: 'State University', prestige: 1, share: 0.50,
    blurb: 'The one most people actually went to. No cachet, and a classmate in every room.' },
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
    blurb: 'Talks about their district because that is genuinely what they think about.' },
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
    ticksPerYear = 240, districtCount = 6, seedPop = 24000, treasury = 60e6,
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
    const leanId = pick(world, PARTIES).id;
    const part = seedPartisan(world, leanId);
    world.districts.push({
      id: 'd' + (i + 1), n: i + 1,
      name: DISTRICT_NAMES[i] || `District ${i + 1}`,
      color: PALETTE[i % PALETTE.length],
      pop: 0, homes: 0, jobs: 0, homeless: 0,
      income: Math.round(range(world, 21000, 52000)),
      mood: Math.round(range(world, 44, 62)),
      unemployment: null,
      landValue: Math.round(range(world, 40, 140)),
      order: Math.round(range(world, 45, 70)),
      health: Math.round(range(world, 45, 70)),
      lean: leanId,
      partisan: part.partisan,
      undecided: part.undecided,
      salience: { jobs: range(world, .5, 1), housing: range(world, .3, 1), taxes: range(world, .3, 1), order: range(world, .3, 1), amenity: range(world, .2, .8) },
      history: [],
    });
  }

  // Parcels are created first and districted by partitionParcels() below, over the
  // districts that actually exist — `nDistricts`, taken from the constitution's
  // district chamber, not `districtCount`, the requested figure. Getting that
  // wrong is how a Season shipped with seven districts and a six-way partition:
  // the seventh held no parcel, so it had no land, no people and no unemployment
  // figure, and yet the Assembly had a seat for it and returned a member. An
  // electorate with no electors.
  const { w, h } = world.city;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = world.districts[0];
      const seeded = rng(world);
      const zone = seeded < 0.42 ? 'residential' : seeded < 0.62 ? 'commercial' : seeded < 0.74 ? 'industrial' : seeded < 0.8 ? 'civic' : 'unzoned';
      world.city.parcels.push({
        i: y * w + x, x, y, district: d.id, zone,
        building: null, project: null,
        landValue: Math.round(d.landValue * range(world, 0.7, 1.35)),
        pop: 0,
      });
    }
  }

  partitionParcels(world, nDistricts);
  // Before the water, not after: carveWater asks the map where the lakes fall,
  // and the map cannot answer until every district's ground is settled. This
  // only ever fires when the partition has left a district empty, but a water
  // parcel handed to another state afterwards is a lake in the wrong place.
  ensureEveryDistrictHasLand(world);

  // Lay the lakes before anything is built on the land.
  carveWater(world);

  // Seed the existing stock deliberately, so the nation opens with problems
  // worth governing: housing a little short of the population, and rather
  // fewer jobs than there are people who want one.
  seedStock(world, seedPop);
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

/**
 * Lay down the founding building stock. Targets, not dice: housing for about
 * 92% of the population and work for about 94% of the labour force. The gap is
 * the opening position — roughly 8% homeless and 6% unemployed — and it is the
 * first thing anyone will argue about.
 */
function seedStock(world, pop) {
  const homeTarget = pop * 0.92;
  const jobTarget = pop * 0.48 * 0.94;
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
      const gap = jobTarget - jobs;
      const r = rng(world);
      place(parcels, gap > 900 ? (r < 0.45 ? 'factory' : 'offices') : 'market');
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
  // Measured by area, not by centre. There are ninety-six parcels for the whole
  // country, so one of them is the size of a small state and no lake on earth
  // contains a parcel's midpoint — testing the centre found nothing at all. What
  // is being asked is "is this parcel mostly lake", so the parcel is sampled on a
  // grid and the answer is the fraction of it under water.
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
  for (const [id, list] of byDistrict) {
    const owned = world.city.parcels.filter((p) => p.district === id).length;
    const keep = Math.max(0, Math.min(list.length, owned - 2));
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

export function distributePopulation(world, total) {
  const parcels = world.city.parcels;
  let capacity = 0;
  for (const p of parcels) {
    const b = p.building ? BUILDINGS[p.building] : null;
    capacity += b ? b.homes : 0;
  }
  const target = total ?? sum(world.districts, (d) => d.pop);
  // Nobody lives in a home that does not exist. Everyone else is on the street.
  const housed = Math.min(target, capacity);
  for (const d of world.districts) { d.pop = 0; d.homes = 0; d.jobs = 0; }
  for (const p of parcels) {
    const b = p.building ? BUILDINGS[p.building] : null;
    if (!b) { p.pop = 0; continue; }
    const d = world.districts.find((x) => x.id === p.district);
    const share = capacity ? b.homes / capacity : 0;
    p.pop = Math.round(housed * share);
    d.pop += p.pop; d.homes += b.homes; d.jobs += b.jobs;
  }
  const overflow = Math.max(0, target - housed);
  for (const d of world.districts) {
    const share = housed ? d.pop / housed : 1 / world.districts.length;
    d.homeless = Math.round(overflow * share);
    d.pop += d.homeless;
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
export function assignDistrictSeats(world) {
  const ds = world.districts || [];
  if (!ds.length) return;
  const codeFor = (d) => codeOf(STATES.find((x) => x.name === d.name)) || (d.name || '?').slice(0, 3).toUpperCase();

  for (const o of world.constitution.offices) {
    if (o.electorate !== 'district') continue;
    const mine = world.seats.filter((s) => s.office === o.id).sort((a, b) => a.index - b.index);
    if (!mine.length) continue;

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
  const pop = totalPop(world) || 24000;
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
      income: Math.round(range(world, 21000, 52000)),
      mood: Math.round(range(world, 44, 62)),
      unemployment: null, structural: null,
      landValue: 90, order: 55, health: 55,
      lean: pick(world, PARTIES).id,
      salience: { jobs: range(world, .5, 1), housing: range(world, .3, 1), taxes: range(world, .3, 1), order: range(world, .3, 1), amenity: range(world, .2, .8) },
      history: [],
    });
  }
  world.districts = next;
  // Every district carries a partisan split, including a reused one from an old
  // save that predates the party system and any freshly-drawn one above.
  for (const d of world.districts) {
    if (!d.partisan) { const part = seedPartisan(world, d.lean || PARTIES[0].id); d.partisan = part.partisan; d.undecided = part.undecided; }
  }

  // Re-partition the map into `target` contiguous blocks so districts stay
  // geographically coherent — which is what makes gerrymandering meaningful.
  partitionParcels(world, target);
  ensureEveryDistrictHasLand(world);
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
    const b = p.building ? BUILDINGS[p.building] : null;
    if (!b) continue;
    gdp += b.output || 0;
    upkeep += b.upkeep || 0;
    extra += b.revenue || 0;
    jobs += b.jobs; homes += b.homes;
    units += b.units || 0;
    land += p.landValue * 1e5;
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
  const pop = totalPop(world);
  const labor = pop * 0.48;
  // Structural unemployment is what the map dictates: people who want work,
  // minus jobs that exist. The headline figure drifts toward it, and a slump
  // pushes the headline above it until the slump passes.
  e.structural = clamp(1 - jobs / Math.max(labor, 1), 0.012, 0.6);
  if (e.unemployment == null) e.unemployment = e.structural;
  for (const d of world.districts) {
    const dl = d.pop * 0.48;
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
    const dj = sum(world.city.parcels.filter((p) => p.district === d.id),
      (p) => (p.building ? BUILDINGS[p.building].jobs : 0) + constructionCrew(p.project))
      + sum(world.companies || [], (c) => (!c.closed && c.district === d.id ? (c.employees || []).length : 0));
    // People commute. A district with no factories is not 70% unemployed; it
    // is somewhat worse off than the city it sits in.
    const local = clamp(1 - dj / Math.max(dl, 1), 0.01, 0.7);
    d.structural = clamp(e.structural * 0.6 + local * 0.4, 0.008, 0.55);
    if (d.unemployment == null) d.unemployment = d.structural;
    d.landValue = Math.round(
      sum(world.city.parcels.filter((p) => p.district === d.id), (p) => p.landValue) /
      Math.max(1, world.city.parcels.filter((p) => p.district === d.id).length));
  }
  wages = sum(world.districts, (d) => d.pop * 0.48 * (1 - d.unemployment) * d.income);
  gdp += wages * 0.9;
  e.gdp = gdp;
  const income = wages * t.income * 0.93;
  const sales = wages * 0.62 * t.sales;
  const property = land * t.property;
  const tariff = 34e6 * t.tariff;
  e.revenueYr = income + sales + property + tariff + extra;
  e.breakdown = { income, sales, property, tariff, other: extra };
  const payroll = world.seats.length * 1.1e5;
  const programs = sum(world.programs || [], (p) => p.cost || 0);
  // Upkeep scales with every formation under arms, not just the regular line:
  // a volunteer division is cheap (a third of a regular's keep) and an air wing
  // dear (three times it). Raise more and the standing bill rises with it.
  const milit = (world.military.units
    + (world.military.volunteers || 0) * 0.3
    + (world.military.airforce || 0) * 3) * 9e5 * world.military.funding;
  // Debt is priced at what the market actually charges this state: the short
  // rate the money market clears at, plus the credit spread, plus the premium
  // for crowding out. macro.tickMacro computes it and leaves it on marketRate;
  // the fallback is the old credit-rating-only formula, for the first recompute
  // of a world that has not ticked yet.
  const rate = e.marketRate
    ?? (0.03 + (1 - Math.min(1, Math.max(0, (e.credit ?? 72) / 100))) * 0.09);
  const interest = (e.debt || 0) * rate;
  e.interestRate = rate;
  e.spendYr = upkeep + payroll + programs + milit + interest;
  e.spendBreakdown = { upkeep, payroll, programs, military: milit, interest };
  world.stock = { jobs, homes, units };
  return e;
}

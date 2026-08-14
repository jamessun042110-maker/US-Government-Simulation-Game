// Genesis. Builds the map, the citizenry, the ledger and the offices.

import { rng, range, pick, clamp, uid, sum, mulberry32, hashSeed, PALETTE, youthOf, YOUTH_APPROVAL } from './util.js';
import { templateById, termEndTick } from './rules.js';
import { initMacro } from './macro.js';

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
const DISTRICT_NAMES = ['Old Quarter', 'Ironside', 'Harborlight', 'Fourth Ward', 'The Terraces', 'Kiln Hill',
  'Northgate', 'Silverfield', 'Cinderway', 'Low Bridge', 'Saltmarket', 'The Pales', 'Greyhithe', 'Foundry Row',
  'Candlewick', 'Ashford', 'Bellgate', 'Rookery', 'Thornfield', 'Quayside'];
// Twenty first names against sixteen surnames is three hundred and twenty
// people, and a Season creates four hundred and fifty. The republic ran out of
// names about two thirds of the way through every game it has ever played, and
// personName's fallback appended a counter — so a third of the citizenry ended
// up called "Vess Ferro 301", and the Chronicle, whose whole promise is that
// these people are remembered, wrote them down that way.
const FIRST = ['Aurel', 'Toma', 'Vess', 'Mireille', 'Hollis', 'Dax', 'Renna', 'Ivo', 'Sable', 'Corin',
  'Nella', 'Bram', 'Odile', 'Kit', 'Pell', 'Yara', 'Osric', 'Juno', 'Wren', 'Casimir',
  'Anselm', 'Beatrix', 'Cato', 'Delphine', 'Emeric', 'Fenn', 'Greta', 'Halcyon', 'Isolde', 'Jorun',
  'Katria', 'Lorne', 'Maren', 'Nikolai', 'Oriel', 'Perrin', 'Quintus', 'Rosalind', 'Silas', 'Thea',
  'Ulric', 'Verity', 'Wilhelmina', 'Xavier', 'Yseult', 'Zoran', 'Alaric', 'Bettine', 'Cormac', 'Dorothea'];
const LAST = ['Sun', 'Hellhound', 'Karsk', 'Vaile', 'Ostrander', 'Bell', 'Marchetti', 'Kwan',
  'Duras', 'Ferro', 'Amsel', 'Renke', 'Tolliver', 'Ash', 'Voss', 'Quill',
  'Achterberg', 'Brandt', 'Calder', 'Dunmore', 'Eskeland', 'Fairweather', 'Gallowglass', 'Harrowgate',
  'Ingermann', 'Jarrow', 'Kesteven', 'Lindqvist', 'Mordaunt', 'Nightingale', 'Oakhurst', 'Pellinore',
  'Rookwood', 'Strand', 'Thackeray', 'Underhill', 'Valchek', 'Wolstenholme', 'Yarrow', 'Zeleny'];
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
  { id: 'goldland', name: 'Goldland', ideology: 'fascist', hostility: 34, strength: 120, blurb: 'A rearming neighbour that reads restraint as invitation.' },
  { id: 'sab', name: 'The SAB', ideology: 'mercantile league', hostility: 12, strength: 70, blurb: 'Three ports and a tariff schedule with opinions.' },
  { id: 'electrum', name: 'Electrum', ideology: 'republic', hostility: 4, strength: 85, blurb: 'Sister republic. Signs things. Means about half of them.' },
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

function personName(world) {
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
  { id: 'argent', name: 'Argent College', prestige: 4, share: 0.07,
    blurb: 'Four hundred years old, six hundred students. Opens doors and invites resentment.' },
  { id: 'meridian', name: 'Meridian School of Government', prestige: 3, share: 0.15,
    blurb: 'Where the civil service is trained, and where it recruits.' },
  { id: 'harborlight', name: 'Harborlight Polytechnic', prestige: 2, share: 0.28,
    blurb: 'Engineers, surveyors, harbourmasters. Builds things; distrusts speeches.' },
  { id: 'northgate', name: 'Northgate State', prestige: 1, share: 0.50,
    blurb: 'The one most people actually went to. No cachet, and a classmate in every room.' },
];

export const collegeById = (id) => COLLEGES.find((c) => c.id === id) || null;

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

export function makePersona(world, { name, playerId = null, synthetic = false, party = null, district = null, lineage = null, gen = 1 }) {
  const id = uid('per');
  const p = {
    id, name: name || personName(world), playerId, synthetic,
    party: party || pick(world, PARTIES).id,
    district, alive: true, exiled: false, imprisoned: false,
    born: world.clock.tick, died: null, cause: null,
    // Everyone in the republic has an age, a college and a gender — the player
    // picks theirs at the founding, everyone else is dealt one here.
    age: 34 + Math.floor(rng(world) * 34),
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
    nation = 'Silver', templateId = 'federal-republic', canon = 'cold',
    ticksPerYear = 240, districtCount = 6, seedPop = 24000, treasury = 60e6,
    seasonName = 'Season I',
  } = opts || {};

  const constitution = templateById(templateId).build(nation);
  // Districts exist to elect representatives, so draw exactly as many as the
  // constitution's district chamber has seats — never conjure an extra one at
  // ratification. Fall back to the requested count if nothing is district-elected.
  const districted = constitution.offices.find((o) => o.electorate === 'district' && o.seats > 0);
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

  // Lay the river and lakes before anything is built on the land.
  carveWater(world);

  // Seed the existing stock deliberately, so the nation opens with problems
  // worth governing: housing a little short of the population, and rather
  // fewer jobs than there are people who want one.
  seedStock(world, seedPop);
  ensureEveryDistrictHasLand(world);
  distributePopulation(world, seedPop);

  // --- seats ---------------------------------------------------------------
  for (const o of world.constitution.offices) {
    for (let s = 0; s < o.seats; s++) {
      world.seats.push({
        id: `${o.id}#${s + 1}`, office: o.id, index: s, personaId: null,
        district: o.electorate === 'district' ? world.districts[s % world.districts.length].id : null,
        termEnds: null, since: null,
      });
    }
  }
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

  // Housing first, spread round-robin so no district starts empty.
  while (homes < homeTarget && guard++ < 400) {
    for (const parcels of byDistrict) {
      if (homes >= homeTarget) break;
      place(parcels, rng(world) < 0.55 ? 'housing_low' : 'housing_mid');
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
  const { w, h } = world.city;
  const at = (x, y) => y * w + x;
  const water = new Set();
  // A private, world-independent stream. Nothing here touches world.rngState.
  const roll = mulberry32(hashSeed(`silver/water/${w}x${h}`));
  const span = (lo, hi) => lo + roll() * (hi - lo);
  const horizontal = w >= h;
  if (horizontal) {
    let yy = Math.round(span(h * 0.32, h * 0.68));
    for (let x = 0; x < w; x++) {
      yy = clamp(yy + Math.round(span(-1.2, 1.2)), 1, h - 2);
      water.add(at(x, yy));
      if (roll() < 0.3) water.add(at(x, clamp(yy + 1, 0, h - 1)));
    }
  } else {
    let xx = Math.round(span(w * 0.32, w * 0.68));
    for (let y = 0; y < h; y++) {
      xx = clamp(xx + Math.round(span(-1.2, 1.2)), 1, w - 2);
      water.add(at(xx, y));
      if (roll() < 0.3) water.add(at(clamp(xx + 1, 0, w - 1), y));
    }
  }
  if (roll() < 0.55) {
    const lx = roll() < 0.5 ? 0 : w - 2, ly = roll() < 0.5 ? 0 : h - 2;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) water.add(at(clamp(lx + dx, 0, w - 1), clamp(ly + dy, 0, h - 1)));
  }
  // About half the water is dropped back to land at the start of every game.
  // The river was overwhelming the small city grid — a full spine plus a lake
  // corner meant a coastal district in the middle of the map, with a strip too
  // narrow to build in on either side. Thinned deterministically off the same
  // stream, so the same river stays the same river between Seasons; what
  // remains is a coast rather than a wall of water, and construction has the
  // room it needs.
  const thinned = new Set();
  for (const i of water) if (roll() < 0.5) thinned.add(i);
  world.city.water = [...thinned];
  for (const p of world.city.parcels) if (thinned.has(p.i)) p.water = true;
  // Waterfront districts (holding or bordering water) open with a working-port
  // character: a touch hungrier for jobs and worth a little more per parcel.
  const wf = new Set();
  for (const i of thinned) {
    const x = i % w, y = Math.floor(i / w);
    for (const [nx, ny] of [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = world.city.parcels[at(nx, ny)];
      if (np) wf.add(np.district);
    }
  }
  for (const d of world.districts) {
    if (!wf.has(d.id)) continue;
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
    const p = makePersona(world, { synthetic: true, district: seat.district, party: d ? d.lean : null });
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

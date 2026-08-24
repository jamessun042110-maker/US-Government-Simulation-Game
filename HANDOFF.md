# State of the Union — handoff, Aug 23 2026 (second pass)

Paste-into-a-new-session context for **State of the Union**, a simplified United
States government simulator. It is a fork of the *Silver: The Living Republic*
prototype, rewrapped and rebuilt as the US. It was called *The Union* until
Aug 23; the storage keys and the console namespace are still `usgov.*` and
`__usgov`, which is correct — they name the game's domain, not its title.

The live code is this repo — `/Users/james/Claude Code/congressional app
challenge`, GitHub `jamessun042110-maker/US-Government-Simulation-Game`. **The
folder name contains spaces: quote every path.**

**State:** branch **`main`**, clean, **nine commits on top of `e505e7e`** and
**not pushed** (`e505e7e` and everything before it *is* pushed). Suite:
**2,338 passed / 0 failed, 130 files**, ~35k lines of JS — of which 512 are
generated (`worldmap.js`).

**Do not write "the whole per-file sweep is green" without measuring it over
repeated runs.** The previous handoff said exactly that, "with no exceptions",
and it was wrong: `runoff.mjs` was failing 5 runs in 24 and `company.mjs` 3 in
12, both pre-existing. A single clean sweep tells you nothing about a file that
fails one time in five. Three flaky files and six engine bugs were fixed on top
of that sweep — see "What a hundred republics said".

**Check the branch before you commit.** This document used to say `bicameral-congress`,
clean, not merged and not pushed. Partway through the session that produced the
work below, something *outside* that session checked out `main`, fast-forward
merged `bicameral-congress` into it, and pushed to `origin/main`. There is no
hook in `.git/hooks` and no `.claude/settings.json` in the repo, so it was most
likely another Claude session or an editor integration — it was never diagnosed.
`bicameral-congress` still points at `7accfe6`. Read `git branch --show-current`
immediately before committing rather than trusting what you read at session
start.

**What the Aug 22 work was,** in the order it will matter to you: the country
is seeded from the real United States and the money scaled to match (see "The
census, and the money" — this is the big one, and it touched `world.js`,
`atlas.js`, `rules.js`, `acts.js`, `depts.js`, `sim.js`, `npc.js`, `director.js`);
state codes went from three letters to two; the Vice President gained the Senate
gavel and lost the national survey; the two cloakrooms were given different rooms
to stand in; age floors became editable at the convention; the island power was
renamed and its label pulled back out of the Pacific; Central America was drawn;
and player-facing prose was cut by 4.7%.

**Then, on top of that (Aug 23), twenty-four commits.** Read `git log` for the
full account; the short version, grouped:

- **The name and the founding.** Renamed **State of the Union**. The convention
  is a seating page with the document behind a button; you pick your party
  there rather than being dealt one, and the inauguration flies its colours.
  See "The founding, and the side you take".
- **The government became the US government.** The Senate turns over in three
  classes; appointments need the Senate's advice and consent; the bench sits for
  life and cannot strike a law alone; exile, calling elections by decree,
  attainder-by-bill and presidential arrest are gone; there is an Attorney
  General and a Department of Justice. See "What is American about it now".
- **The map became the map.** Real Great Lakes, a real Canadian coastline,
  Florida's rounded tip, the Hawaiian islands, Alaska on the world map, named
  oceans — and **one parcel per congressional district**, which is the change
  with the most downstream reach. See "The map, and the ground under it".
- **Balance the census rescale had left behind.** Jobs spending, foreign policy,
  partisanship and two dead rate thresholds. See "Rates written for
  twenty-four thousand people".

**And then five more commits, which is where this file now stands.** In the
order they will matter to you:

- **The map became a map.** Seven faults, most of them one fault — a state
  polygon and the coastline beside it disagreeing about where the shore is. The
  Gulf sliver was 568 cells of coastal Mississippi and Alabama belonging to no
  state. Michigan is two peninsulas now, the Canadian frontier stopped running
  through Duluth and across the Upper Peninsula, Washington has the Strait of
  Juan de Fuca, the Rio Grande has the Big Bend, and there are islands in the
  Caribbean. See "The map, and the ground under it".
- **The World tab is a map of the world** — 204 countries, generated from
  Natural Earth rather than hand-authored, in a second projection. See "Two
  projections".
- **The Electoral College**, and a District of Columbia that has three votes and
  no congressman. This is the first of three stages of the campaign work; the
  other two are not started. See "What is American about it now" and "Still to
  do".
- **The game runs at half speed** — and *not* by doubling `ticksPerYear`, which
  is a trap. See "The clock".
- **Three more stale rates**, including one that made `broke` true on 34.7% of
  all ticks. See "Rates written for twenty-four thousand people".

---

## Read this before you run anything

**The machine has 8 GB of RAM and lives in swap.** Measured Aug 9: 8.09 GB of a
9.2 GB swap file in use. It is permanently near its ceiling.

- Run single test files while iterating. Run the full suite when you have
  something to verify, **not as a heartbeat**.
- **Stop your dev server before you finish** (`preview_stop`).
- Disk is not the constraint. Memory is.

**Never run a background suite while you are still editing source.** A partial
edit reads exactly like a regression.

**`preview_start` reads `/Users/james/Downloads/.claude/launch.json`, not this
repo's.** The entry is `usgov`, on port 8825. The repo's own
`.claude/launch.json` is not what the tool consults.

**`preview_stop` wants the `serverId` from `preview_list`**, not the `previewId`
that `preview_start` hands back. They look alike and only one works.

---

## What the game is

A persistent United States you govern and betray each other over. Tens of
thousands of simulated citizens live in it and vote. One browser tab is one
player; time runs on its own; a Season is one full run from founding to
collapse. The Chronicle remembers what you did, and the presidential articles it
writes are the payoff.

Two careers on the same board: hold an office, or found a company. The two are
mutually exclusive.

## Run it

```bash
python3 "/Users/james/Claude Code/congressional app challenge/devserver.py" 8825
```

Always use `devserver.py` — it sends `Cache-Control: no-store`, and a cached ES
module after an edit gives white screens and phantom missing-export errors. The
`ws://…/ws` console error is expected without `node server.js`.

## Tests

```bash
sh "/Users/james/Claude Code/congressional app challenge/tests/run-all.sh"
```

`run-all.sh` prints FAIL lines under the file that produced them, so `tail` will
miss them. To find which file failed:

```sh
cd "/Users/james/Claude Code/congressional app challenge/tests"
N=~/.local/node-v22.11.0-darwin-arm64/bin/node
for f in *.mjs; do o=$($N $f 2>&1); echo "$o" | grep -qE '^FAIL|Error' && { echo "$f"; echo "$o" | grep '^FAIL'; }; done
```

**Grep for `Error` as well as `^FAIL`.** A test with a syntax error prints no
FAIL lines at all, and a loop that only greps `^FAIL` counts it as a pass. That
happened here: a duplicate `const` in shelter.mjs read as twelve clean runs.

---

## The shape of the thing

One chain runs through the whole engine, and most confusion is a step of it
missed:

```
constitution.offices  →  world.seats  →  seat.district  →  world.districts
    (the document)        (the chairs)      (the map)         (the states)
```

- **The constitution is data**, built from a template in `rules.js` and editable
  at the convention. `repairConstitution` is the one place that makes an edited
  document coherent again, and it runs after every structural change.
- **`world.seats` is one row per chair.** A seat carries `office`, `index`,
  `personaId`, `district`, and — for the House — `cd`, its numbered
  congressional district.
- **`world.districts` is the twenty states.** They are also the economic unit:
  population, mood, unemployment, land value and parcels all hang off a district.
- **Everything that votes goes through `rules.voteRequirement`.** The roll, the
  tally, the quorum, the tie-break and every legislative view ask it who the
  body is. That single indirection is why bicameralism landed in one function.
  The one deliberate exception is the Twelfth Amendment's contingent election,
  which counts by state delegation rather than by head — see "What is American
  about it now".

There is a second chain now, for anything that counts an *electorate* rather than
a chamber:

```
sim.appealsIn(place)  →  sim.splitIn(place)  →  electoral.countCollege
  (how they'd vote)       (how it divides)        (who wins the state)
```

**`place` is a state, `world.dc`, or `null` for the whole country.** Write a new
kind of count against `splitIn` and it is per-state for free — which is how the
Electoral College landed without touching the vote model.

---

## What changed from Silver

### The atlas — `js/atlas.js`

**The source of truth for all geography.** Written in **degrees** and projected
once, so every coordinate can be held against a real map and checked.
`P(25.8, -80.2)` is Miami; `[216.3, 159.7]` is not checkable by anyone.

- **It imports nothing.** `geo.js` imports it, so importing back would be the
  first module cycle in the codebase. The frame size is repeated as two numbers,
  with a test that the two definitions agree.
- The projection is equirectangular with a **0.8 latitude correction**. Without
  it the country comes out half again as wide as it is tall. Texas is the tell —
  it is close to square on the ground, so the test asserts that ratio rather
  than any single coordinate.
- **Alaska has its own projection** (`AK`), also in degrees, with a **0.47**
  correction — at 62°N a degree of longitude is under half a degree of latitude,
  and without it the state comes out twice as wide as it is tall.
- `ringsAt(north, south)` reassembles all three countries at any frontier
  displacement. **This is the whole annexation mechanism.**

**Four things in the atlas look alike and are not:**

| field | what it is | example |
|---|---|---|
| `codeOf` | the region's own code — map label *and* district numbering | `NE`, `TX` — **two letters, unique across the twenty**, and `tests/atlas.mjs` checks both |
| `postalOf` | the real states a region was merged from | `ME · NH · VT · MA · RI · CT` |
| `peopleOf` | 2020 census, millions, per region | California 39.5 |
| `liberalOf` | Liberal share of the 2020 two-party vote | California 0.65, Mountain West 0.35 |
| `joblessOf` | the real unemployment rate | Great Plains 0.028, California 0.053 |
| `roughOf` | homeless per ten thousand | New York 52, Virginia 8 |
| `homeValueOf` | the median home, in thousands | California 780, South Central 200 |
| `incomeOf` | median household income, in dollars | New England 89,000 |

**`abbr` is gone, and `code` is two letters.** There used to be two identifiers
per state that disagreed: `abbr`, a two-letter map label invented per region, and
`code`, three letters for numbering districts. The three-letter form existed so a
merged region could never collide with one of the fifty real postal codes — but
the fifty do not exist in this game, only the twenty do, so the only collisions
that matter are among themselves. There is one identifier now, `codeOf`, and
`tests/atlas.mjs` checks that all twenty are two capitals and all twenty are
distinct. A merged region is initials (`CR` Carolinas, `UP` Upper South); an
unmerged one keeps its real postal code (`NY`, `TX`, `CA`).

### Twenty states

Fifty merged to twenty — not arbitrary, `MAX_DISTRICTS` was already 20. New
York, Florida, Texas, California, Michigan and Illinois stay whole; the rest are
regional. See `DESIGN-us.md` for the table.

### Geography facts that cost time

- **Territory is *land*** — a polygon intersected with the continent. The country
  polygons are closed far off-frame on purpose and their raw areas are mostly
  ocean. A test that compares `area(poly)` is measuring the sea, and one did.
- **Ours is the fall-through.** `geo.js` counts shares as
  `canada ? canada : mexico ? mexico : us`. A neighbour's claim is positively
  established by its polygon; whatever neither holds is the United States. With
  Mexico last instead, annexing Canada handed Mexico 30.9% of the continent.
- **`CONTINENT_RING` uses a 2-unit margin, not `OUT`.** Country polygons want a
  generous closure because the coast clips them. The continent *defines* land, so
  a generous closure counts ocean as territory — Canada came out at 79.7%.
- **Both neighbours' coasts are clamped to their own frontier** — `held()` for
  Canada, `heldSouth()` for Mexico, in `ringsAt`. Without it a frontier driven
  past the coastline folds the ring through itself and ray-casting reports the
  XOR. Canada was annexed outright and kept 9.8% of the map in scattered pieces;
  Mexico did the same for 2% the moment the Yucatán was drawn, because a
  peninsula that runs back *north* gets cut off and left behind.
- Shares at the founding: **Canada 49%, US 41.7%, Mexico 9.3%**. Measured, not
  targeted — the 49th parallel is where it is, and Mexico has its Yucatán now.

---

## Congress

Full design in `DESIGN-us.md` §3. **The House and the Senate are different
shapes on purpose**, and most of the subtlety is in keeping them that way.

|  | House (`assembly`) | Senate (`senate`) |
|---|---|---|
| seats | **45**, apportioned | **20**, one per state |
| term | 2 years | 6 years |
| district | numbered `TX-1` on `seat.cd` | the state, no `cd` |
| `office.apportioned` | `true` | absent |
| `office.cohorts` | absent | **3** — the classes |

### The Senate's three classes

`office.cohorts` is how many groups a chamber's seats are dealt into, and only
the Senate has it. `world.assignDistrictSeats` stamps `seat.cohort` round-robin
so no class is a bloc of neighbouring states; `actions.beginSeason` cuts the
*first* terms to a third, two thirds and the whole, which is how the real Senate
was started in 1789 and is the only moment the classes can be set. After the
first count everybody serves the full six and the classes stay two years apart.

**An election is keyed on `(office, cohort)`, not on the office.** That one line
in `acts.scheduleElection` was the whole of the old behaviour: the first senator
whose term came up opened a ballot that swallowed all twenty. Nominations, the
no-bare-seat guarantee and the count read **`rules.seatsUpIn(world, e)`**, so
the two thirds who are not up are not entered, not counted and not unseated. If
you add anything that walks "the seats of this election", walk that.

Measured over eight canon years: classes 1, 2 and 3 poll at 1.8, 3.8 and 5.8
years, carrying 7, 7 and 6 seats — **about 92% of the time**. `senateclasses.mjs`
fails the other 8%, with all three classes reading 6.0 years, which means the
first-term cut did not happen at all. It is a guarantee failing, so it is a bug
and not a sample; see "Known rough edges".

### How a measure moves

- **`legislature.chamber` is still the first chamber**, not a pair.
  `legislature.upperChamber` is the second, and `null` means unicameral. Nothing
  that read `chamber` had to change meaning.
- **A measure stands in one room at a time.** `doc.chamberStage` indexes
  `R.chambers(world)`; `acts.closeFloor` advances it, reusing the two-stage shape
  the impeachment trial already had. **If you add a new kind of vote, route it
  through `voteRequirement` and it is bicameral for free.**
- Bills and amendments pass both, House first. A treaty is the **Senate's alone**.
  The **House impeaches, the Senate tries**. A veto is overridden only by both,
  at the override fraction, starting again from the House.
- **Bills originate in the House whoever files them**, senators included.
- `doc.chamberTallies` keeps the rooms a measure has already carried, because
  `doc.tally` is overwritten by the second chamber's count.

### How the seats are dealt

- **`world.assignDistrictSeats` is the only place it happens** — at world
  creation and again at ratification. It used to be two different round-robins,
  which is where "a district drawn at ratification" came from: the chair you took
  at the convention was not necessarily the electorate you sat for.
- An **apportioned** office is divided across the states by **Huntington–Hill**
  (`rules.apportion`, the real method) and each seat gets a numbered district.
  An **unapportioned** one gets one seat per state and no `cd`.
- **The Senate decides how many states there are.** `world.js` and
  `actions.beginSeason` read the district count off the first district-elected
  chamber that is *not* apportioned. Reading it off the House would cut the
  country into forty-five pieces.
- `repairConstitution` forces every **unapportioned** district office to the same
  seat count, and floors an apportioned one at the number of states. It does
  *not* force them all equal — that rule is what apportionment had to escape.

### Three rules that bite if you touch this

- **An apportioned chamber runs one contest per seat.** `sim.nominate` stamps
  `cand.seatId` and `closeElection` cuts the field by it. Without that, four
  Texas seats see one field and return the same person four times. The guarantee
  that no seat goes to the count empty checks **per seat** for an apportioned
  office and per district otherwise, and it passes the seat id explicitly so it
  fills the bare seat rather than the earliest empty one.
- **Do not give the Senate two seats per state** without first making district
  elections multi-winner. Two unapportioned seats in one district is the same
  race run twice, returning the same winner twice.
- **`rules.mayCloseFloor` says who may call the question**: the author, an office
  with `call_election`, or **the presiding officer of the room the measure is
  standing in** — which is how the Vice President moves the Senate to a vote
  without being able to gavel the House. It reads the room off `voteRequirement`,
  so a new kind of measure gets the rule for free.
- **A tie fails** (`tally.deadlocked`) unless a tie-breaker settles it, and the
  VP only breaks ties in the Senate. Confining the tie-break without the deadlock
  rule silently restores the 10–10-passes bug in the House. The tie-break scan
  also skips **every** chamber, not just the voting one — the Senate holds a
  `vote` power, so a tied House bill was otherwise settled by whichever senator
  sat first in `world.seats`.

**The office id of the House is still `assembly`**, deliberately: a rename is a
string sweep that cannot tell it from `RIGHTS.assembly`, the freedom to assemble.

---

## The census, and the money

**The United States in this game is the real one, to the extent the engine can
carry it.** This replaced a country that was a consequence of the map.

### What is authored

`atlas.js` holds six real facts per state beside the polygon — population,
Liberal vote share, unemployment, homeless per ten thousand, median home value
and median income — and each is checkable against the real place. They are held
to the same standard as the geography: a reader can look up California's 0.65 and
the Great Plains' 2.8% and say whether the file is lying.

### What the engine does with them

```
atlas facts  →  world.seedCensus  →  d.basePop / d.baseHomes / d.baseJobs
                                          ↓
                          distributePopulation  →  d.pop, d.homeless
                                          ↓
                            recomputeEconomy   →  unemployment, GDP, revenue
```

- **`d.basePop` is a state's census share of the national population, and it does
  not move with the map.** It used to be a state's share of the *housing standing
  on its parcels* — and there are 96 parcels for the whole country, so a state
  held four or five and one building either way was a third of its population.
  California could not be seven times Montana because it did not have seven times
  the ground.
- **`baseHomes` and `baseJobs` are the stock the republic inherits**, computed as
  the census target *minus whatever `seedStock` laid on the grid*. Order matters
  and it is the reverse of what it used to be: `priceParcels` → `seedStock` →
  `seedCensus` → `distributePopulation`. Counted the other way round the country
  opens with a housing surplus and nobody sleeping rough.
- **The grid is the marginal layer.** Building housing in Michigan takes people
  off Michigan's street; it does not move Michigan's population. That is what
  building housing actually does, and it is why the lever still means something
  against 331 million people.
- **`d.landValue` is the median home in thousands of dollars.** `recomputeEconomy`
  re-derives it as the mean of the district's parcels, so the parcels are priced
  off their own state — they were priced off `districts[0]` for the whole country
  once, which quietly gave every state New England's prices on the first tick.

### The money

Everything the government spends went up a thousandfold with the population.
`BUILDINGS` costs, upkeep, output, homes and jobs; the executive spending gate
(`$1M` → **`$1B`**); the discretionary cap (`$5M` → **`$5B`**); divisions, air
wings, NPC bills and the director's crisis cards. A founding republic now reads
GDP ≈ $22.4T, revenue ≈ $1.25T, spend ≈ $1.24T.

**Two things were deliberately *not* scaled, and both are load-bearing:**

- **`company.js`.** A company is a company: $250k of seed capital and a $30M
  listing floor are realistic for one, and nothing about the federal budget makes
  a startup a thousand times bigger. Scaling it broke eleven test files and
  modelled nothing.
- **`VOLUNTEER_COST`** went to **$900M**, not $9B, so it stays *under* the $1B
  executive gate. That relationship is the whole point of the volunteer division
  — see the comment in `depts.js`.

**`ADMINISTRATION_PER_HEAD` is new, and it is what makes money a constraint
again.** $1,150 a head a year — the schools, courts, roads, pensions and
administration the republic inherits along with the country. Nothing builds it
and nothing can strike it. Without it the founding budget ran a $385B surplus and
the treasury reached $2.9T inside six canon years, which takes money out of the
game: every programme is affordable, so no programme is a decision. With it a
republic opens at about break-even ($1.25T against $1.24T) and then does what
governments do — two unattended 4,000-tick runs both went into deficit, borrowed,
and one clawed back to a $1.35T debt at credit 68 while the other reached $7.9T
at credit 5. It scales with population, so annexing a country costs money to
govern as well as to take.

**A disbursement now buys a headcount, not a percentage.** `SPEND_EFFECTS`
housing used to rehouse a *share* of the worst district's homeless, which meant
the sum disbursed decided nothing; it buys places at `acts.COST_PER_REHOUSING`
now, the way the jobs programme has always bought posts at `COST_PER_JOB`.

**Buildings were renamed, not just rescaled.** At this scale a "building" is a
programme covering a state's worth of ground, so `Parking Structure` is
`Roads and Transit` and `Jail` is `Corrections`. The keys are unchanged.

### Party lean

`world.seedPartisanFor` seeds a state's split from `atlas.liberalOf`: 74% of the
electorate committed in proportion to the real two-party vote, 26% undecided, and
a ±2.5-point jitter so Virginia, the Upper Midwest and the Southwest — the three
that really are within a point of even — can break either way. It was
`pick(world, PARTIES)`, a coin flip per state, which meant Texas came up Liberal
as often as California did.

---

## Ages, water, cloakrooms

- **`office.minAge` is the constitution's qualification** — 25 House, 30 Senate,
  35 President, and 35 VP because the Twelfth Amendment makes anyone ineligible
  for the one ineligible for the other. `rules.eligibleByAge` is the gate;
  `mayHoldAgain` calls it, so it bites on the ballot, the nomination and the
  seating alike. **It expires** — someone barred today is eligible the year they
  grow into it — so it is asked fresh every time and never stamped on a persona.
- **The convention can move it.** Every elected office carries an
  `Advanced — age for the …` disclosure beside its term limit, clamped to
  `POLITICAL_BASE_AGE`–90, and `repairConstitution` clamps it again for the
  routes that do not pass through the number field. `rules.officesBarredAt` still
  reads the hardcoded `federal-republic` template, which is correct only because
  it is used on the founding screen, *before* a constitution exists to edit.
- **Anything that mints a persona for a chair must pass `minAge`.**
  `makePersona` rolls from 34 and the executive asks 35, so one synthetic in
  thirty-four was refused by `nominate` on the way in, silently. That cost an
  empty presidential ballot about once in twelve republics. `fillVacantSeats`
  and `sim`'s challenger-maker both pass it now. **This is the trap to remember
  if you add another qualification.**
- **Water is where a *named* lake is.** `carveWater` used to thin one or two
  random parcels out of every coastal state, which put an inland lake in the
  middle of Texas. It now samples each parcel's drawn polygon against
  `atlas.LAKES` and takes the ones ≥25% under water. Testing the parcel's
  **centre** finds nothing at all — a parcel is the size of a small state.
- **`cityGeometry` is called during `newWorld`** now, because `carveWater` needs
  the drawn geometry, and `ensureEveryDistrictHasLand` moved ahead of it: a water
  parcel handed to another state afterwards is a lake in the wrong place.
- The **port character** comes from `atlas.isCoastal` — the authored answer to
  "does the sea or a Great Lake touch this state" — not from adjacency to a water
  parcel. Fifteen states have a port; three have water parcels.
- **One cloakroom per chamber, and they no longer look alike.**
  `mayEnterCloakroom(world, id, chamberId)`; channels `cloakroom` (lower) and
  `cloakroom_upper`. The VP is in the Senate's and no other — see
  `presidedChamber`. `cloakroomView(root, which)` is still one function: what
  differs is the window (`balcony` looks west down the Mall at the Capitol,
  `balcony_upper` looks east across First Street at the Court — same balustrade,
  different city), the accent (brown for the House, wine for the Senate, in
  `css/app.css`), and the roster's right-hand column, which shows the numbered
  district in the House and the term's end in the Senate.

---

## The founding, and the side you take

**The convention is two screens now, and the one you land on is the short one.**
This game is the United States, not a kit for inventing a country: the government
it opens with is the one the Constitution lays out. So `VIEWS.convention`
(`js/ui.js`) renders **Take your seat** by default — a four-line summary of the
standing document, the seat list, the party picker, the roster and the ready-up —
and the whole clause-by-clause editor sits behind **Amend it →**.

- **Which screen is up lives in `S.conventionDoc`, not in the world.** It is a
  fact about your screen, not about the republic; another tab's founder should
  not be dragged into the document because you opened it. Both screens are one
  view because they share the constitution `c`, the `push` that broadcasts it,
  and the seat list that reads it — `docCol` and `seatCol` are built either way
  and only one is appended.
- **Nothing was taken away.** Every clause is still editable and still compiles
  to a rule the engine enforces; the summary card is read off the live document,
  so it cannot drift from it. An age floor changed behind the button shows up on
  the chair in front of it.

**Ready-up sits under the summary, not at the bottom of the roster.** It used to
be the fourth card in the right-hand column, below the seat list, the party
picker and the roster — about eight hundred pixels down, off the bottom of a
laptop screen — while the document column beside it was 232px with three quarters
of a screen of nothing under it. It is `beginCard` now, appended to `docSummary`
at that column's full width: the page reads in the order the decision is made,
and it is about two hundred pixels shorter for it.

**A founder picks their party at the seating, beside the chair.** It used to be
dealt: `app.convene` wrote every player in as a Liberal and you found out from a
chip on the Offices tab three screens later. The picker dispatches the
`CHOOSE_PARTY` that already existed. **`CHOOSE_PARTY` returns before it logs when
`world.phase === 'convention'`** — at the founding this is a first answer, not a
defection, and without that a founder trying both buttons writes the history of a
career spent crossing the floor.

**The inauguration is dressed in the new administration's colours.**
`scene.inaugurationScene(world, gender, partyColor)` — `ui.inaugurationModal`
passes the colour of the party of whoever is taking the oath, or `null` for an
independent.

- **The Stars and Stripes is not repainted.** It is the country's flag, not the
  administration's, and recolouring it reads as a different flag rather than as a
  different president. What changes is what an inauguration actually changes:
  `partyFlag` hangs the party's colours over both wings, the crowd's hand-held
  flags take it, and so does the confetti.
- **The party is part of the cache key** (`INAUG_BG`). Without it the second
  administration is sworn in under the first one's flags until the season turns.
- Two of the five confetti colours and every flag in the crowd were mixed from
  **`FLAG.hoist` / `FLAG.fly`, keys the Stars and Stripes does not have** —
  leftovers from Silver's two-colour flag. That is why the crowd waved green.
  The three that this file used to say still survived in `js/scene.js` (lines
  ~1789, ~2589, ~2615) are **gone** — checked Aug 24, the only `FLAG.hoist` /
  `FLAG.fly` / `FLAG.disc` mentions left in that file are the comments recording
  the fix. Nothing reads those keys any more.

**Party colours are blue and red** (`world.PARTIES`), and each party carries an
**`ink`** for type laid on that colour — the chips used to hardcode `'#111'`
beside every use of `color`, which only held while the palette was pale.

---

## What is American about it now

The fork inherited a *generic* republic's instruments and kept them after it
became the United States. Most of the Aug 23 work is taking them out and
putting the real procedure in. If you are about to add a mechanic, the question
this section answers is "would that be legal".

**Advice and consent** (`acts.sendUp`, `rules.confirmingChamber`). The President
names somebody and a **nomination** goes to the Senate floor — a document like
any other, so it inherits the roll, the quorum, the tally and the tie-break,
which for the Senate is the Vice President's. `legislature.confirms` names the
chamber; `repairConstitution` points it somewhere real if a table strikes the
Senate, and a constitution carrying no such chamber seats appointees outright,
**which is every Season saved before this**. A player nominee answers twice:
once themselves, once through the chamber. A confirmation is `status:
'confirmed'` — not a law, never on the statute book, never sent for signature.

**The Senate turns over in thirds.** `office.cohorts` is how many classes a
chamber's seats are dealt into. See "Congress" below.

**The bench sits for life** (`office.forLife`, and `termEndTick` returns null
for it as it does for `atWill`), and **one justice cannot strike a law** — the
engine refuses when the bench holds more than one, and points at
`COURT_TAKE_UP`. A one-seat court keeps the direct route.

**Gone entirely:** exile; `CALL_ELECTION` and the `call_election` power (which
also silently conferred the power to close any floor); `arrest` from the
presidency and from the emergency widening. **Gone from an ordinary bill:**
ARREST (attainder, Art. I §9), PARDON (the President's alone, Art. II §2) and
REDISTRICT (Art. IV §3 — it stays on an amendment). **Members of Congress are
not impeachable** (*Blount*, 1797); each chamber expels its own.

**The Attorney General** holds `arrest`, because in the United States the
executive does not detain anybody — law officers do. The Department of Justice
is the fourth cabinet room; its tab id is **`ag`**, not `justice`, which is the
Supreme Court's office id. It is listed *after* the Secretary of the Treasury in
the template, because **the order of `constitution.offices` is the order the Oval
Office's Appointments card reads the cabinet out in** — it filters that array and
keeps its sequence, so the document is also the layout of that screen. Reordering
it is not cosmetic: it changes seat order, which changes what the RNG is consumed
on. See `termlimit.mjs` under "The flakes".

**The presidency is decided by the Electoral College** (`js/electoral.js`), and
the District of Columbia votes in it. This replaced a national popular vote with
a runoff.

- **Electors are counted, not configured.** Article II says "the whole Number of
  Senators and Representatives to which the State may be entitled", so the
  college reads the chairs — and a table that amends the chambers at the
  convention moves the college with them for free. That is 45 representatives
  plus **one** senator each, because two senators per state would be the same
  district election run twice (see "Congress"). **Sixty-five, plus DC's three, is
  sixty-eight**, and a majority is 35.
- **`world.dc` is not a state and is deliberately not in `world.districts`.**
  That array *is* "the states": the Senate takes its seat count from it,
  Huntington–Hill apportions the House across it, and `assignDistrictSeats` deals
  a chair for every entry. A twenty-first member would quietly give Washington
  two senators and a congressman, which is the one thing about it that is not
  true. It carries a population and a party split in the shape a district uses,
  so `partisanOf` reads it without knowing it is not one.
- **The vote model is a function of *place*.** `splitIn(place)` in
  `sim.closeElection` asks the same question of one state at a time, so party fit
  is read off that state's lean; the college counts twenty-one answers.
  `referendum` still reads the *seat*, because whether a race is a verdict on the
  government is a fact about the office and not about which state is counting.
  **If you add anything that counts votes, add it there and it is per-state for
  free.**
- **A player's ballot is cast where they are from** — `persona.district`, or DC
  for anyone the republic has not placed — and is worth `PLAYER_BALLOT_SHARE`
  (1%) of what that state actually casts.
- **Nobody with a majority goes to the House**, under the Twelfth Amendment, and
  **each state delegation casts one vote**, so Montana's single member weighs the
  same as all of California's and an evenly split delegation abstains. It is the
  one vote in the game counted by state rather than by head, which is why it is
  written out rather than routed through `voteRequirement`.

**Still not American, and known:** a vacant presidency with no VP still calls a
special election (there is no Speaker or President pro tem to succeed to it);
amendments take effect on the chambers' vote with no state ratification, though
the twenty ratifiers are sitting right there in `world.districts`; the VP and the
President can both introduce legislation directly; and there is no primary — a
candidate simply appears on the general ballot. See "Still to do".

---

## The map, and the ground under it

**One parcel is one congressional district.** Forty-five of them, dealt out by
the same Huntington–Hill apportionment that deals out the House's seats, so
California has five and the Mountain West has one and parcel `TX-3` is the
ground that returns the member sitting for TX-3. This replaced a 12×8 grid of
ninety-six squares cut into bands, which made a parcel a fifth of a state and
nothing else.

Three things follow, and they are the ones that will surprise you:

- **`partitionParcels` is not called at the founding any more.** A parcel is
  born knowing its state. `world.remintParcels` is what runs when the map
  changes — it keeps the ground that did not move, and everything standing on
  it.
- **`sim.neighbours` returns the rest of the state.** The grid's eight-square
  rule had nothing left to describe; what a jail in TX-3 reaches is Texas.
  `parcel.x`/`y` are a position *within* a state now and mean nothing across
  the line.
- **`carveWater` marks nothing.** The lakiest congressional district in the
  country is New York's third at 17% under water, and the threshold is 25%. That
  is the correct answer — no real congressional district is mostly lake — and
  the rule is kept because it is scale-free. **What draws the Great Lakes is the
  lakes** (`atlas.LAKES`, read by `ui.cityMap`), not wet parcels.

**The shapes are real now.** The Great Lakes were five ellipses out of
`lakeRing`; they are drawn. Canada's twenty-three-vertex coastline became a
real one — the Inside Passage, Hudson Bay with James Bay hanging off it, Ungava
Bay, the Gulf of St Lawrence, the Gaspé, Nova Scotia and the Bay of Fundy.
**There is no Newfoundland**: it is an island and `ringsAt` returns one ring,
so attaching it would either weld it to Labrador or fold the ring through
itself. Florida's southern end is round. Hawaii is six island outlines, not six
discs. `atlas.SEAS` names four bodies of water on both maps.

### The coastlines, and the fault they all shared

Seven faults were fixed in one pass and six of them were the same fault: **a
state polygon and the coastline beside it disagreeing about where the shore is.**
Where they disagree, the ground between them belongs to no state — it is inside
`US_RING` and inside no `STATES` entry, so it draws as bare continent and no
district owns it.

**Find them with a grid sweep, not with your eyes.** Walk `US_RING`'s interior
on a fine grid, drop every point that falls in some state's polygon, and cluster
what is left. That is how the sliver below was located to the vertex after
staring at the map failed to place it, and it turned up six more nobody had
noticed. The lakes show up in the same sweep and are *correct* — the frontier
runs through the middle of them, so the water between a shoreline and the border
is legitimately stateless. Read the clusters, do not just count them.

- **The Gulf sliver** (the one this file's predecessor listed as still open) was
  568 cells — the whole of coastal Mississippi and Alabama, Gulfport to Mobile.
  `COAST_ATLANTIC` ran the delta straight to Mobile in one segment and cut off
  the Mississippi Sound, while Deep South and South Central met at a junction on
  the Pearl River that **was not on the coastline at all**. The coast has the
  sound now and Deep South follows it vertex for vertex. Florida's panhandle
  starts at Perdido Bay, where Alabama actually ends, rather than at Mobile Bay.
- **Michigan** was one blob with a flat top: the Upper Peninsula was a ruled line
  at 46.5°N with no Keweenaw and no Whitefish Point, and the two halves were
  welded together straight across open water. It is two peninsulas joined at the
  Straits of Mackinac now, with the Keweenaw, the Thumb and Saginaw Bay.
- **The Canadian frontier ran from Lake of the Woods to Duluth** and then
  straight to the Soo. Duluth is two hundred miles inside the country, so the
  line cut clean across the Upper Peninsula on its way. It runs the boundary
  waters, through Superior north of Isle Royale, down Huron under Manitoulin, the
  St Clair and Detroit rivers, across Erie to the Niagara, through Ontario to the
  Thousand Islands, up the St Lawrence, along the 45th parallel and over the
  height of land into Maine — which gives Maine back the north-east corner two
  straight lines had been cutting off.
- **Washington** had no north coast. The frontier began at the 49th parallel and
  the national ring closed straight from there to Cape Flattery: one diagonal
  through the Olympic Peninsula and everything else in the way. It leaves the
  Pacific at the mouth of the Strait of Juan de Fuca now and turns north through
  Haro Strait to Point Roberts.
- **The Rio Grande** was three straight segments and the Big Bend — the one
  stretch of that border anybody can draw from memory — was not among them.
- **The lakes are drawn on the states' own vertices** rather than a fifth of a
  degree off them, so Lake Michigan stopped taking a bite out of the Lower
  Peninsula. Green Bay and the Door Peninsula exist.

**When you move a shared edge, move both sides in the same commit.** Every one of
these is two or three files agreeing: `COAST_*`/`BORDER_*`, the states either
side, and often a lake. `tests/atlas.mjs` will not catch a disagreement — it
checks codes, ratios and tiling tolerance, and a 0.2° seam passes all three.

### The Caribbean, and the District of Columbia

**`atlas.CARIBBEAN`** is Cuba, Hispaniola, Jamaica, Puerto Rico and three Bahamas
islands, in real degrees. **Scenery**, and outside `CONTINENT_RING` for exactly
the reason `CENTRAL_AMERICA` is: land that neither neighbour positively claims
becomes the United States, so an archipelago that annexes itself the moment it is
drawn is worse than no archipelago. It is **not** the Caribbean League — that is
a power with ground that can be taken off it, and its polygon is still the single
roughened ellipse `sabCut` needs (`geo.js`). This is the geography underneath.

**`atlas.FEDERAL_DISTRICT`** is Washington, drawn as the real diamond with the
Virginia side retroceded. At map scale it is a third of a frame unit across —
thinner than the stroke that would draw it — so `cityMap` blows it up eight times
around its own centre and labels it with its three electors. It carries no
district colour because it is not a state.

**`geo.interiorPoint`, not `geo.centroid`, for "somewhere in this state."** The
area centroid of a concave state can be well outside it — Florida's is in the
Gulf, in the crook between the panhandle and the peninsula, and it was only ever
inside because the peninsula used to be drawn fat enough to catch it. Labels,
district sites and the test that a state stands on the continent all ask for the
interior point.

**Alaska is `ALASKA_WORLD` on the world map** — placed, not projected. The main
projection puts 168°W a hundred units off the left edge, so a true position is
impossible without moving the frame and shrinking the country the game is about.
It is set against Canada's western boundary, which is where Alaska is, and the
frontier between them really is a straight line (the 141st meridian).

---

## Two projections

There are two now and they answer different questions. Keeping them separate is
deliberate.

| | `atlas.P` | `worldproj.PW` |
|---|---|---|
| covers | North America | the globe |
| frame | 340 × 232 | 720 × 360, cropped to 84°N–58°S |
| scale | 3.6 x / 4.3 y units per degree, corrected at 37°N | 2 units per degree, plain |
| used by | everything the engine **counts** | the World tab, and nothing else |

**Nothing is measured in the world frame.** Parcels, districts, frontiers and
land shares are all in the atlas's. Re-anchoring the atlas globally would shrink
the United States to a fifth of the frame and invalidate every hand-checked
coordinate in `atlas.js` at once, to gain nothing — the Domestic map wants the
country filling the page.

**Anything that has to appear on the world map converts through degrees**, which
is what `atlas.unP` has always been for. `worldproj.toWorld(g)` moves a whole
geography across in one call: everything the World tab draws hangs off that
object and everything it *positions* is computed from those same polygons, so the
twenty-odd call sites never learn that anything moved.

Two things it carries and one it does not, and the reasons are the interesting
part:

- **The grid comes.** `geo.labelSpot` and `geo.landCentre` walk `g.grid.pts` to
  decide where a country's name and capital go, and points from the wrong frame
  put a name in the ocean. Its `step` and `cell` are rescaled by a factor
  **measured** rather than assumed — the two frames differ in scale *and* in
  latitude correction, so the honest way to get it is to project a known span and
  look at what comes out.
- **Terrain does not.** Its glyphs are authored at fixed sizes for a frame where
  the United States filled the page: a ridge is four units wide, which is now
  most of Colorado. Every consumer already guards for their absence.
- **`isIn` does not.** It is a point test closing over the *atlas*-frame
  polygons, and one that silently answers in the wrong frame is worse than one
  that is not there.

### `js/worldmap.js` is generated. Do not hand-edit it.

204 sovereign states and countries — the 196 plus the handful whose status
depends on who is asked — from Natural Earth's public-domain 50m admin-0 set.
8,717 points, 139KB.

```bash
curl -sL -o /tmp/ne50.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
node tools/buildworld.mjs /tmp/ne50.geojson > js/worldmap.js
```

**The thing to audit is `tools/buildworld.mjs`, not its output.** The atlas is
hand-written in degrees precisely so every coordinate can be held against a real
map and checked; that discipline does not survive contact with two hundred
countries, because nobody can type Indonesia from memory and nobody could check
it if they did. So the rest of the world is generated and the *script* is what a
reader verifies.

Two traps it already fell into, both fixed and both worth knowing if you retune
the tolerance:

- **Simplification must never delete a country.** At 0.18° the Vatican, Monaco,
  San Marino, Nauru, Tuvalu, the Maldives and the Seychelles all collapsed below
  three points and fell out of the file — ten of them. Each ring falls back
  through finer tolerances, and one that still will not survive is drawn as a
  dot.
- **One path per country, not one path for all of them.** Under `evenodd` a ring
  inside another cancels it, so Lesotho was a hole in South Africa and the
  Vatican and San Marino were holes in Italy; under `nonzero` the answer depends
  on which way Natural Earth happened to wind them. Separate paths have no fill
  rule to get wrong.

`worldproj.WORLD_SEAS` names fifteen oceans and seas. `atlas.SEAS` still names
four and they are all in North America, because that is all its frame can see.

---

## The clock

**One tick is one second.** `ticksPerYear` is therefore also how many seconds a
canon year takes to play: 240, so four minutes — except that
**`app.MS_PER_TICK` is 2000**, so it is eight. That constant is the only thing
that sets the speed of the game.

**Do not slow the game down by raising `ticksPerYear`.** It looks equivalent and
it is not. A tick is the unit nearly everything else in the engine is written in
— slumps decay 0.004 a tick, unemployment closes 6% of its gap a tick, the NPCs
look up every 12, a bill sits on the floor for 90, the court hears argument for
52 — so doubling the ticks in a year runs every one of those twice as often per
canon year. Measured over six canon years at 480: inflation came out 58% lower,
the policy rate 55% lower, the output gap three times wider. The same republic,
run twice as hot. Slowing the wall clock changes none of it.

**`util.tickScale(world)` is `240 / ticksPerYear`**, and the continuous economic
rates in `sim.tickEconomy` and `macro.tickMacro` are written against it. At the
default it is exactly 1, so it changes nothing today — but the setup screen lets
a table pick any rate from 20 to 3000, and at anything but 240 those rates were
quietly wrong. **The discrete cadences are not covered yet**: `npc.CADENCE`,
`DEPT_CADENCE`, `IMPEACH_CADENCE`, `floorTicks`, `ARGUMENT_TICKS`,
`AUDIENCE_TICKS` and friends are still raw tick counts, so `ticksPerYear` is not
a free parameter. If you want it to be, that is the list.

---

## Rates written for twenty-four thousand people

**This is the live category of bug in this codebase, and there are more of
them.** The census rescale moved the population from twenty-four thousand to
331 million and the money up a thousandfold — but every *rate* underneath moved
too, and a threshold calibrated against the old country silently became either
never-true or always-true. **Eight have been found.** The first four:

- **The NPC build trigger** asked whether more than **3%** of the country slept
  outside. The real figure is 0.2%, so no unattended government ever built
  anything again. Measured against 0.2% now.
- **The Housing row of `districtMoodTarget`** asked the same question with the
  same 3%, so it was exactly zero in every state in every Season and Housing had
  never once appeared in the approval breakdown. Against 0.4% now, and **capped
  at 12 points** — the band is narrow and the tail is long, and a slope steep
  enough to make half a point matter turns a housing fire into ninety points and
  a collapsed republic.
- **`reliefBoost` decayed by a flat 0.0015 a tick**, which is twenty-five times
  what a $5B works programme buys. Proportional now.
- **`econlink.mjs` pinned the treasury at $400M** to guarantee solvency. The
  cheapest building costs $1.5B.

And three more, found by re-reading this section and doing what it says:

- **`checkCollapse` called the government broke below −$40M.** Against $1.24T of
  annual spending that is three thousandths of one per cent — crossed on the
  first sustained deficit and never recovered from. Measured across five
  unattended republics and 14,832 ticks it was **true on 34.7% of all ticks**,
  and since collapse needs three of five reasons, one of the five was simply
  free and the "third act begins" warning fired on any single other one. It is
  three months of `spendYr` now (`sim.BROKE_MONTHS`, `sim.isBroke`), a figure
  picked by measuring: an ordinary deficit bottoms out between half a month and
  two months of overdraft, deeper than three happens on 0.6% of ticks, deeper
  than four never happens by accident. `tests/broke.mjs`.
- **`chronicle.headlineFact` scored the national debt at `abs(dd) / 1e7`.** That
  function picks one candidate to be a president's lede and scores them against
  each other — unemployment and inflation in percentage points, nought to
  fifteen. A trillion-dollar debt movement scored a hundred thousand, so **the
  headline fact of every presidency was the debt**, whatever else had happened.
  Its $50M floor excluded nothing either. Debt is scored in points of output now
  and discretionary spending as a share of a year's revenue.
- **`chronicle`'s `money0` printed millions whatever the number was**, so a
  biography read "The reserve fell by $740315M". The same stale scale arriving as
  prose rather than as arithmetic. It uses `moneyish` — $740.3bn.

**If a number in this codebase is a percentage or a sum compared against a
literal, ask what country that literal was written for.** Three of the seven were
found by grepping for money literals in comparisons
(`grep -rnE "[<>]=?\s*-?[0-9.]+e[0-9]+" js/*.js`) and asking that question of
each hit. `company.js` is the deliberate exception and its literals are correct —
see "The money".

---

## Naming

`Silver` → `The United States`, `goldland` → `canada`, `electrum` → `mexico`,
the island power `sab` → **The Caribbean League** (the id is still `sab`, from
the pre-rewrap "The SAB"),
and the power id for our own country is **`us`**, not `silver`. Storage keys and
the console namespace are `usgov.*` and `__usgov`.

**`util.midThe`** is the mirror of `withThe`: a name that already carries a
capitalised article, dropped mid-sentence. Without it the founding document read
"Constitution of the Republic of **The** United States".

---

## What a hundred republics said

Aug 24. A hundred games were run headless — a character with a set temperament
and party seated in each of the nine offices in turn, forty canon years apiece,
four thousand canon years in total — twice over: once checking invariants and
once censusing what the engine actually *did*. `play.mjs` and `play2.mjs` in the
session scratchpad; they are worth rebuilding if they are gone.

**The invariant pass found nothing, and that is a real result.** No crash, no
non-finite number anywhere in the economy or the districts, no ghost personas,
no seat count disagreeing with the document, no election stuck open, no chair
left vacant at year forty, in any of the hundred.

**The coverage pass found six bugs**, and the method is the transferable part:
*census what fires, and read the zeroes.* A mechanic that never happens in four
thousand canon years is either dead code or a bug. That is how all of these
surfaced, and it is the same trick that found the `market` branch.

- **Not one treaty was ever ratified.** 800 filed, 776 refused. `npc.sueForPeace`
  files a peace only while `f.atWar` and the ministry answers sixty ticks later,
  so a war that ended in between left the overture standing with nothing to
  settle — and `tickAssent` wrote that down as the *power refusing*, and shut
  the door on them for two years. The republic was being punished with
  diplomatic silence for its war ending. `weighAssent` marks those answers
  `moot` now; they lapse instead, and nobody is locked out.
- **A fire destroyed fifteen million homes and made nobody homeless.**
  `distributePopulation` owns `d.homes`, and the only thing that ever called it
  was a project *finishing*. Housing gained moved homelessness; housing lost
  never did.
- **No retail was ever seeded**, in any world: `gap > 900` where 900 was a
  factory's jobs before the thousandfold rescale.
- **A republic in deficit stopped building and never raised another division.**
  Every NPC spending decision gated on cash in hand, and deficit is the designed
  normal. An unattended United States lost 34 wars of 34.
- **An army raised for a war was kept for ever.** Volunteers demobilise;
  the regular line never did.
- **69% of nominations were duplicates**, and the same gap let one person be
  confirmed to two cabinet posts at once.

**Numbers to compare against, per 100 games of 40 years.** Both columns are
measured on the committed tree — the "after" is the final validation run, not
the best intermediate one:

| | before | after |
|---|---|---|
| crashes / non-finite / invariant breaks | 0 | 0 |
| republics collapsing | 24 | **16** |
| laws passed | 435 | **1,037** |
| buildings opened | 250 | **763** |
| nominations filed | 559 | **343** (the duplicates are gone) |
| treaties lapsing honestly | 0 | 246 |
| **wars won** | **0** | **0** |

**Read that last row.** The war fixes are real — an intermediate configuration
measured 46 wars won and 31 annexations where there had been 0 and 1 — but the
constants that produced it also took collapse from 24 in 100 to 71, and a
republic that always collapses is worse than one that always loses its wars. The
committed constants buy stability back and hand the victories back with it. The
gain this session banked is everything *except* the war: a government that keeps
governing while in deficit, legislates two and a half times as much, builds
three times as much, and no longer collapses as often. Winning a war still needs
the balance decision below.

**Two cautions if you rerun this.** `world.elections` is a *rolling window*, not
a history — it is pruned, so counting `w.elections.length` at year forty says
nothing and briefly convinced this session that elections had stopped. Count by
id into a Set. And a tally's fields are `yea`/`nay`, not `yes`/`no`; reading the
wrong one makes every vote look unrecorded.

### The open question this session did not answer

**The United States cannot win a war, and money is not why.** Spending can buy
victories — 46 of them in a hundred games — but only at a rate of borrowing that
collapses seven republics in ten, so the committed constants do not buy them and
the shipped game still wins none. The model is what is against it:
`depts.enemyWeight` scales with hostility, Canada's hostility climbs to 100 and
pins there, so Canada is worth 8-10 in the line by the time the shooting starts
while the republic can afford about four formations. Beating that needs roughly
six, at `UPKEEP_PER_FORMATION` — $210bn each, every year — which is 113% of
everything the republic raises, permanently.

Spending more does not fix it. Every capital share measured bought more collapse
and no more victories: at a 0.35 share, 11 of 20 republics collapsed and none
won; at 1.0, 15 of 20 collapsed and three won.

So the question is a balance one and it belongs to the owner, not to a session
at three in the morning. It is one of:

- **the army is priced too dear** — four formations cost three quarters of
  federal revenue at the founding, before the republic does anything at all,
  where the real figure is about 13%; or
- **revenue is too thin** — the game raises 5.6% of GDP where the real federal
  government raises about 19%, which makes *everything* unaffordable and is why
  `ADMINISTRATION_PER_HEAD` bites as hard as it does; or
- **hostility should not double a neighbour's divisions**, only their
  willingness to use them.

Pick one deliberately. Changing any of them moves the whole economy, which is
why this session changed none of them and fixed only the gate that was
plainly wrong.

## Still to do

**Queued, not started:**

1. **The campaign, stages two and three.** The Electoral College is in; the rest
   of it is specified and not built. Design decisions already taken with the
   owner, so build to these rather than re-asking:
   - **Primaries are sequential, a few states at a time** — states poll in a
     fixed order over several in-game weeks with delegates awarded
     proportionally, so early states carry momentum the way the real calendar
     does. A campaign may be declared **at any time** before the election.
   - **A Campaign Office tab**, visible only to a declared candidate, pinned with
     the department tabs but below every official government room.
   - **Polling** off approval, prominence, track record and press appearances;
     **polling maps drawn at the candidate's discretion, for a price**;
     **fundraising**; **ads** that move it, for a price; **rallies** costing a day
     of in-office time and **events** costing a week, each for a corresponding
     boost. Polling near the election should converge on the simulated NPC vote.
   - The vote weighting is already built and is the model to follow:
     `PLAYER_BALLOT_SHARE`, 1% of a state's cast, in the state the persona is
     from.
2. **Play a full Season end to end.** Still the biggest gap by a distance, and
   every handoff this forked from has said so: one hand-played presidency found
   four faults nothing else had. It is more urgent than it was, not less — every
   bill now takes two floor cycles, the presidency is decided by a college, and
   the canon year takes eight minutes. Nothing has been played at that pace.
3. **Balance after 7 → 65 legislators, and after the thousandfold rescale.**
   Quorum, pass fractions and floor votes run across a 45-seat House *and* a
   20-seat Senate, and a bill needs both. The founding accounts read plausibly
   ($22.4T output, $1.25T revenue, $1.24T spending) and unattended runs behave,
   but the director's crisis costs, NPC bill sizes and the pace at which the
   treasury drains are all untested by a player.
4. **Hunt the rest of the stale rates.** Eight found, three of them in one
   earlier session and an eighth on Aug 24 (`seedStock`'s `gap > 900`, which
   meant no Retail District was ever seeded in any world). The Aug 24 sweep of
   the documented grep found nothing else in the money literals — `npc.js`'s
   `1e8` floors and `acts.js`'s `1e9` were all correctly rescaled — so the
   remaining ones, if any, are *rates and shares* rather than sums — which is
   the harder half and where the last three came from. There is no reason to
   think eight is the number. The recipe and the grep are in "Rates written for
   twenty-four thousand people", and the complementary method — census what
   fires across a hundred games and read the zeroes — is in "What a hundred
   republics said".
5. **Icons and the per-view palette.** `--brand` is federal blue and the parties
   are blue and red, so the wordmark, the default accent and every party chip
   agree with the title screen. What is left is the **per-view accent scopes**
   further down `css/app.css`: Congress is still Silver's purple, and the rest of
   the tabs each carry a colour chosen against the old palette. `--silver` /
   `--silver-dim` also survive as token names — those are greys and the name is
   the only thing wrong with them.
6. **Re-apportionment never happens.** The House is apportioned once, at the
   founding, so a state whose population moves keeps the seats it started with —
   **and now its ground and its electors too**, since a parcel is a congressional
   district and the college counts chairs. `world.remintParcels` is the half that
   exists; what is missing is anything that calls it on a decennial census.
7. **A state's House delegation votes as a bloc.** Every congressional district
   in a state draws on the same electorate, so TX-1 and TX-3 break the same way.
   Real delegations are mixed — and this now matters more than it did, because a
   contingent election is decided *by* delegations. What is left is giving a
   parcel its own partisan split rather than reading its state's.
8. **The DOJ is a room with one thing in it.** The Attorney General holds
   `arrest` and the department shows who is being held and on what. Charging,
   investigating and dropping a case are not written. Laid out symmetrically with
   the other three departments — `rules.js` × 8 sites, `ui.js` × 3, `scene.js`
   × 3, plus an `npc.js` runner if you want an NPC AG to act on its own.
9. **What is left of the un-American.** A presidency vacant with no VP goes to a
   special election; amendments need no state ratification; the VP and President
   can both introduce legislation. See the end of "What is American about it
   now".

**Known rough edges:**

- **The suite is green, and the "no exceptions" claim was not true.** The
  previous handoff said the per-file sweep was clean with no exceptions. It was
  not: `runoff.mjs` failed 5 runs in 24 and `company.mjs` 3 in 12, both measured
  in a stashed tree before this session touched anything. Both are fixed. If you
  are about to write that sentence again, **measure it over repeated runs first**
  — a single clean sweep says nothing about a file that fails one time in five.
- **`senateclasses.mjs` is fixed** — it was the age trap a fourth time.
  `SEAT_SELF` asks `eligibleByAge`, `makePersona` rolls from 34, the presidency
  asks 35, so about one founder in thirty-four was refused the chair; a founder
  with no chair fails `readyGate`, which makes `READY` a silent no-op, so the
  world never left `convention` and `beginSeason` — where the first terms are
  cut — never ran. 13 in 300 before, 0 in 60 after. The setup now asserts it
  produced a live republic, because a convention that never adjourned came back
  as three unrelated-looking failures and none of them named the cause.
- **A two-way presidential race has no college majority about 13% of the time**
  — 8 in 60 measured — because 68 electors is an even number and a country near
  50–50 lands on 34–34. The House then decides (7 of those 8) and a deadlocked
  House falls back to a runoff (1 of 8). It is faithful — an even college is
  exactly why the Twelfth Amendment exists — but it is far more frequent than
  the twice-in-history the real one manages, and if it grates the fix is one
  line in `electoral.electorsOf`.
- **The Strait of Juan de Fuca draws as land.** Washington's north coast is
  correct and the frontier runs mid-strait, so the water between them is
  legitimately stateless — but nothing paints it, and the Domestic map fills bare
  continent with land colour. The Great Lakes have the same shape of problem and
  solve it with `atlas.LAKES`; the strait is not in that list because `LAKES`
  also feeds `carveWater`, and adding a sea to it would let a Washington parcel
  come out as water. Same for Puget Sound, which is why the state has no Sound.
- **The country is the real one**, seeded per state from `atlas.js` rather than
  from dice. Treat the whole census change as unplayed: it is verified by tests
  and unattended runs, not by a Season.
- `Chronicle` has no `h1.page`. Pre-existing, not breakage.
- Two of the three constitution templates are archived (`PICKABLE_TEMPLATES`).
  `federal-republic` is the only one a table can pick.

## Architecture notes that still bite

- **Working dir resets to `/Users/james/Downloads` after every shell command.**
  Use absolute paths and quote them — this project's path has spaces.
- **zsh does not word-split unquoted parameter expansions.** `sed $FILES` with a
  newline-separated list passes the whole list as one filename and silently
  changes nothing. Use `| tr '\n' '\0' | xargs -0`.
- **BSD sed has no `\b`.** A `s/\bfoo: /bar: /g` silently does nothing on macOS.
  For anything structural a python heredoc that asserts its anchor is present
  beats sed outright: it fails loudly when the anchor has moved, which is exactly
  when a silent no-op would cost you an hour.
- **The engine is the authority, the screen is a courtesy.** Actions arrive from
  other tabs and are applied straight to the world, so a check that lives only in
  a disabled button is not a check. Every gate needs an engine half.
- **`tick 0` is a real tick and is falsy.** Stamp flags `world.clock.tick || 1`.
- **Several engine functions return `{ok, …}`, not a boolean.**
- **Module cycles are avoided deliberately.** `util.js` imports nothing;
  `atlas.js` imports nothing; `worldmap.js` (generated) imports nothing.
  `worldproj.js` imports only `atlas`. `world.js` imports `geo.js` (added for
  `carveWater`) — safe, because `geo.js` reaches only `util` and `atlas`.
  `electoral.js` imports only `rules`, on purpose: it owns the *arithmetic* of
  the college and never touches appeal, partisanship or turnout, so there is
  exactly one place that decides how a citizen votes and it is `sim.js`.
- **`world.rngState` is seeded from `Math.random()`.** Seasons are *not*
  reproducible. **Never diagnose a difference between two runs as a regression**,
  and never assert on a single sample — see the flakes below.

### Field names

- **`world.dc`** is the federal district and is **not** in `world.districts`. Any
  loop that means "the states" wants `world.districts`; anything that means
  "everywhere that votes for President" wants both.
- An election carries **`e.college`** (`{need, total, tally, byState}`) when the
  Electoral College decided it, and **`e.contingent`** when the House did.
- Wars live in `world.military.wars`, and the key is `war.foreign`.
- Biographies live in `world.bios[personaId]`; `bio.text` is `{lede, body,
  sections}`, and `sections` duplicates `body`.
- `world.annexed` is a map of `foreignId → percent` and goes **negative** when we
  are the ones who ceded.
- `company.found(world, personaId, name, officesOf, sector)` takes positional
  arguments.
- A seat is `{id, office, index, personaId, district, cd, termEnds, since}`.

---

## Testing from automation

- The browser pane reports `document.hidden === true`, so **the clock does not
  advance**. `__usgov.render(true)` forces a paint; `__usgov.world`,
  `__usgov.dispatch({type:…})`, `__usgov.playerId`.
- **The commonest false alarm is a stale saved world, not a stale module.** A
  page loads its Season from `localStorage` at init, so a world founded before
  your edit comes back looking exactly like cached code — identical symptoms.
  Found a fresh republic before you go module-hunting.
- **Clearing `localStorage` from the running page does not stick.** The live page
  writes its world back before you can reload. Clear and reload in *one*
  expression, then wait a round-trip before doing anything else:
  ```js
  Object.keys(localStorage).filter(k=>k.startsWith('usgov')).forEach(k=>localStorage.removeItem(k)); location.reload();
  ```
- **A reload after >150s away drops you on the join screen** (`GONE_AFTER`).
- **A Season saved before the rescale is not worth keeping.** Its treasury was
  denominated when the country held 24,000 people and will not cover a year of
  administration now. `distributePopulation` backfills a census onto it so it at
  least keeps its people in the right states rather than dealing them out in
  twenty equal heaps — but load an old save to read it, not to play it. Wipe and
  found again.
- **A saved Season keeps the constitution it was founded under**, for ever. An
  in-progress world has no Senate and never will; `repairConstitution` nulls its
  `upperChamber` so it stays unicameral and correct. **To see anything
  constitutional you changed, found a new republic.**
- **Driving the founding from the console** is far faster than the UI. Fill
  `#foundername` and dispatch an `input` event, click Convene, then:
  ```js
  __usgov.dispatch({type:'SEAT_SELF', seatId: someSeat.id});
  __usgov.dispatch({type:'READY'});
  __usgov.dispatch({type:'RATIFY'});
  ```
- **The founding tableau blocks on the NPC President's oath**, and the oath needs
  the clock. Set `world.paused = true` before it clears and the modal has no
  buttons and waits for ever. Let it run a second, click "Enter the republic",
  *then* pause.
- **Set `world.paused = true`** rather than clicking Pause — the button files a
  table motion.
- **Walk every tab after touching ui.js.** Nine views, four department rooms and
  the cloakroom.
- **Two shortcuts that save a lot of clicking.** `localStorage.setItem('usgov.tutorialSeen','1')`
  before you start skips the welcome modal for good. And the inauguration tableau
  cannot be dismissed while the world is paused (it needs the clock), so when you
  only want to look at a map, inject
  `<style>.modal-bg{display:none !important}</style>` and read the page behind it
  rather than fighting the oath.
- **The page repaints on a ~900ms timer**, so DOM you edit by hand is gone by the
  next screenshot. To inspect a map closely, render it yourself from the modules
  into a standalone page and open *that* — `tools/mapcheck.mjs` is the worked
  example, and a viewBox argument makes it a zoom lens.
- **A cache-busted `import('/js/atlas.js?x=1')` is safe** *because atlas.js
  imports nothing*. Doing it to a module with dependencies gives you the fresh
  module over cached deps and a confusing missing-export error. Prefer a fresh
  tab.
- `tools/mapcheck.mjs` renders the atlas to SVG. **It earns its keep**: every
  numeric test passed while Canada drew as a wedge pointing at Seattle and
  Mexico painted the Pacific as its own territory. Areas and adjacencies cannot
  see that; an eye can. For one shape, injecting an SVG overlay into the live
  page and screenshotting is quicker — **size the viewBox to the pane's aspect**
  or you will diagnose a crop as a fold, which cost time here.

---

## The flakes, and the lesson

Every one was a claim about a **tendency** measured on a **single sample**.

- **`hiring.mjs`** took `districts[0]` and tripled its population to clear the
  unemployment floor. `local` is `clamp(1 - jobs/labour, 0.01, 0.7)` — clamped at
  **both** ends, so raising the multiplier overshoots into the ceiling. It now
  picks the district nearest the middle of the range and needs no calibration.
- **`shelter.mjs`** asserted homelessness was lower than a sample taken before
  the recompute. The relief is often one person and the recompute's own baseline
  moves by about that much, so a perfect relief could come back equal. It
  measures against the counterfactual now — same world, relief cleared.
- **`allterms.mjs`** asked whether presidencies end for more than one reason and
  read it off one republic, which can legitimately spend its whole history
  turning presidents out at the polls. Pooled across three.
- **`chamber.mjs`** waited for a seated member to file a bill, on one Season.
  Four things have to line up inside the window — the 1-in-360 draw, a House
  member rather than a senator, a clear floor (a bicameral bill occupies it for
  two full cycles), and a grievance bad enough to produce an appropriation. One
  republic in six never got there. Pooled across three.

- **`candidacy.mjs`** was the same age trap the executive ballot was, one level
  up. The block asserts a *guarantee* — a player incumbent is not entered against
  their will, and may enter themselves — and set it up by writing a founder
  straight into the presidential seat. `makePersona` rolls from 34 and the
  presidency asks 35, so about one run in thirty the founder was 34 and
  `nominate` refused them: `A B is 34; the constitution sets 35 for the
  President.` The setup now raises the persona's age the way `fillVacantSeats`
  does. Twenty-five consecutive clean runs after.

- **`termlimit.mjs`** was the age trap a third time, and it is worth knowing how
  it surfaced: **reordering two cabinet posts in `rules.js` exposed it.** The
  office order changes the seat order, which changes what the RNG is consumed on,
  which changes the founder's rolled age. Every claim in the file is about term
  limits, but `mayHoldAgain` asks `eligibleByAge` first and returns *its* reason,
  so a founder who rolled 34 against a presidency asking 35 failed "may stand
  with no terms served" for a reason with nothing to do with terms. A latent
  1-in-34 became 2 in 25. The setup puts the age out of the way now; 0 in 60.
  **If an unrelated change makes a test flaky, suspect the dice, not the change.**
- **`biodates.mjs`** asserted that the economy section reports unemployment and
  inflation. `economyLine` prints a movement only if it is worth printing — the
  floor is a tenth of a point — and the rescaled economy is *stable*: national
  unemployment sits near its structural rate and a four-year tenure can drift
  less than that, at which the engine is right to say nothing and the assertion
  is wrong to demand it. The setup starts unemployment three points high and
  prices hot, so the movement is real. It also pinned the unit as `M`, which only
  made sense while the formatter printed millions whatever the number was.
- **`macro.mjs`** was the one this file's predecessor called real, and it was —
  but not where anyone was looking. It was not the finance path; the test was
  **reading one line of a two-line ledger**. A republic coming out of a spiral is
  deep in overdraft, and a treasury below zero is borrowing that has already
  happened and is simply not on the debt line yet. The next year-close moves it
  there, lifting the debt stock by as much as $1.7T without a further penny being
  spent — so the "before" reading was taken ahead of that reclassification and
  the "after" behind it, and a government that ran a $2T surplus could be
  recorded as sinking deeper. It measures **net liabilities** (`debt - treasury`)
  now, which is invariant to the move: `financeDeficit` and `settleBorrowing`
  each shift the same sum between the two lines. What changes the total is the
  flow, and the flow is the surplus. **When a money test misbehaves, check
  whether the quantity it names is the quantity it reads.**

**And one that was not a flake.** `emptyballot.mjs` asserts a **guarantee** —
every ballot carries somebody — so a single failure was a real bug, and it was
the age gate refusing a 34-year-old challenger for a 35+ office. Read what the
test claims before you widen anything: **a guarantee that fails once is a bug; a
tendency that fails once is a sample.**

**The method is the point.** Each was fixed by asking what the test actually
claims and measuring *that*, not by widening a tolerance until it passed.

---

## Verified clean — do not re-hunt

- The twenty states tile the country to within 0.4%, and no state contains
  another's centre.
- Annexation moves real frontiers in both directions, and a power can be annexed
  off the continent entirely (0.0% left) without touching the third country.
- **Water parcels sit only on named lakes** — four of them, in New York, Michigan
  and the Upper Midwest. No state without a Great Lake has any.
- A **45-seat House** apportioned one to five per state, every seat with a unique
  numbered district, and **45 distinct winners** from a single election — no state
  returns the same person to two of its seats. The apportionment now lands on the
  census every Season — California 5, Texas 4, Mid-Atlantic 4, Mountain West 1 —
  and `tests/census.mjs` asserts the ordering, which the old dice would not carry.
- **The country reads as the country.** 331.0M people, every state within 1% of
  its census share; unemployment 4.1% national over a 3.3–4.8% spread; 675k
  sleeping rough with California at 182k and New York at 105k against the real
  181k and 103k. GDP $22.4T, revenue $1.25T, spending $1.24T.
  **Land value is the exception — do not pin it to a figure.** A parcel is
  jittered across 0.7–1.35 of its state's median and a state holds four or five
  parcels, so a state's seeded price swings tens of per cent between Seasons
  (California came out $759k one run and $893k the next). The authored medians in
  `atlas.js` are what is stable; `tests/census.mjs` asserts the *rank order*
  across the twenty for exactly this reason, and a per-state tolerance there
  failed about one Season in five before it was rewritten.
- **State codes are two letters and unique across the twenty**, the six unmerged
  states keep their real postal codes, and congressional districts number off
  them (`NE-1`, `TX-4`).
- **The Vice President** may call the question in the Senate and not in the
  House, and may not commission the national survey.
- A bill hand-carried through both chambers in the browser: the floor card reads
  "Already carried: House of Representatives 45–0" and "simple majority of the
  Senate" over a completely different roll, then tells the President to "Sign or
  veto it in the Oval Office".
- The age gate refuses a 26-year-old the Senate ("Eligible in 4 years") and the
  presidency, and admits them to the House.
- A House member sees only the House Cloakroom; a senator sees only the Senate's,
  with the Vice President in the room.
- **All thirteen sidebar views** — Oval Office, the three departments, Nation,
  Congress, Domestic, World, Press, Offices, Intrigue, Chronicle, Season — plus
  both cloakrooms render with no console errors beyond the expected websocket
  one. Walked tab by tab on a fresh republic.
- **The founding walked end to end on a fresh republic** after the rename: title
  screen, founding page, the seating screen, into the document behind
  **Amend it →** and back out again — the House's term changed to 3 years there
  and the summary card in front of the button said so — then a party picked, the
  presidency taken, ready up, and the oath. No console errors beyond the expected
  websocket one.
- **The inauguration flies the right colours in both directions.** Conservative
  came up red on both wings, in the crowd's flags and in the confetti;
  Liberal repainted all three blue on the next render, so the cache key is
  honest.
- **The Senate turns over in thirds and the classes hold.** Over eight canon
  years, classes 1, 2 and 3 polled at 1.8, 3.8 and 5.8 years carrying 7, 7 and 6
  seats; afterwards all twenty are on full six-year terms still two years apart.
- **Advice and consent works end to end in the browser.** The President names an
  Attorney General, the nomination goes to the Senate floor with the roll and
  the reasons, and the chair fills when it carries. Rejection leaves it empty.
- **Forty-five parcels and forty-five House seats, per state, with no
  mismatch** — California 5, Texas 4, Mid-Atlantic 4, Mountain West 1.
- **The country still reads as the country after all of it**: 331.0M people,
  4.06% unemployment, 674,716 sleeping rough.
- **All fourteen sidebar views** — the four departments now — walked tab by tab
  on a fresh republic with no console errors beyond the expected websocket one.
- **No uncovered ground in the country except water.** The grid sweep over
  `US_RING` leaves only the Great Lakes, Lake Michigan, Huron, Erie, Ontario and
  the Strait of Juan de Fuca — every one of them correctly stateless, because the
  frontier runs through the middle of them. The seven land clusters that used to
  be in that list are gone.
- **The Domestic map** carries the Great Lakes on the states' own shorelines,
  Michigan as two peninsulas, Green Bay and the Door Peninsula, the Caribbean
  islands, Central America, and Washington D.C. with its three electors. Canada's
  label sits on Canadian land rather than on Lake Huron.
- **The World tab draws 204 countries** with Alaska and Hawaii in true position,
  fifteen named seas, and the four powers painted over the basemap from the
  game's own geometry — so annexation still shows. No console errors beyond the
  expected websocket one.
- **The Electoral College**: 68 electors, a state's delegation plus DC's three, a
  majority at 35, winner-take-all, and the popular-vote winner *can* lose it.
  Twenty-one places vote. A tied delegation abstains in a contingent election and
  an odd one decides.
- **The collapse threshold discriminates**: 0 of 6 ordinary republics collapse
  over fourteen canon years, 6 of 6 spending five times revenue read as broke.
- **2,338 assertions green across 130 files**, and the per-file sweep is clean as
  well as the pooled run, **with no exceptions** — the first handoff in this
  lineage able to say that.

**And a trap that cost real time this session:** the browser serves stale ES
modules after an edit *even though `devserver.py` sends `Cache-Control:
no-store`*, and `location.reload()` does not clear them. A cache-busting query
on `index.html` does not help either — the module URLs are unchanged. **What
works is a different origin**: start a second `devserver.py` on another port
and navigate there. Symptom: you found a fresh republic and the world does not
have the field you just added.

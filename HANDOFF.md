# State of the Union — handoff, Aug 23 2026

Paste-into-a-new-session context for **State of the Union**, a simplified United
States government simulator. It is a fork of the *Silver: The Living Republic*
prototype, rewrapped and rebuilt as the US. It was called *The Union* until
Aug 23; the storage keys and the console namespace are still `usgov.*` and
`__usgov`, which is correct — they name the game's domain, not its title.

The live code is this repo — `/Users/james/Claude Code/congressional app
challenge`, GitHub `jamessun042110-maker/US-Government-Simulation-Game`. **The
folder name contains spaces: quote every path.**

**State:** branch `bicameral-congress`, **clean, twenty-four commits on top of
`9a2b3cc`.** Not merged to `main` and not pushed; `main` is still at `6bb31c8`,
a long way behind. Suite: **~2299 passed / 0 failed, 128 files** (`census.mjs`,
`senateclasses.mjs`, `judicialreview.mjs`, `adviceconsent.mjs` are the new
ones), ~33k lines of JS. One known failure remains and it is real — see
`macro.mjs` under "Known rough edges".

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
years, carrying 7, 7 and 6 seats.

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
  Three more of those survive in `js/scene.js` (lines ~1789, ~2589, ~2615) and
  are still drawing garbage colours.

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
Supreme Court's office id.

**Still not American, and known:** a vacant presidency with no VP still calls a
special election (there is no Speaker or President pro tem to succeed to it);
the presidency is decided by national popular vote with a runoff, not an
electoral college; amendments take effect on the chambers' vote with no state
ratification, though the twenty ratifiers are sitting right there in
`world.districts`; the VP and the President can both introduce legislation
directly.

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

## Rates written for twenty-four thousand people

**This is the live category of bug in this codebase, and there are more of
them.** The census rescale moved the population from twenty-four thousand to
331 million and the money up a thousandfold — but every *rate* underneath moved
too, and a threshold calibrated against the old country silently became either
never-true or always-true. Four have been found:

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

**If a number in this codebase is a percentage compared against a constant, ask
what country that constant was written for.**

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

## Still to do

**Queued, not started:**

1. **Play a full Season end to end.** The biggest gap by a distance, and the
   handoff this forked from was emphatic about it: one hand-played presidency
   found four faults nothing else had. Bicameralism makes it more urgent, not
   less — every bill now takes two floor cycles and nothing has been played at
   that pace.
2. **Balance after 7 → 65 legislators, and after the thousandfold rescale.**
   Quorum, pass fractions and floor votes run across a 45-seat House *and* a
   20-seat Senate, and a bill needs both. On top of that the whole money side
   moved up three orders of magnitude with the population — see "The census, and
   the money". The founding accounts were checked and read plausibly ($22.4T of
   output, $1.25T of revenue, $1.24T of spending, roughly break-even), and two
   unattended 4,000-tick runs behaved — but nothing downstream was retuned by
   hand: the director's crisis costs, NPC bill sizes and the pace at which the
   treasury actually drains are all untested by a player.
3. **Icons and the per-view palette.** `--brand` is federal blue now
   (`#2f6fdb` light, `#5b8ff0` dark) and the parties are blue and red, so the
   wordmark, the default accent and every party chip agree with the title
   screen. What is left is the **per-view accent scopes** further down
   `css/app.css`: Congress is still Silver's purple, and the rest of the tabs
   each carry a colour chosen against the old palette. `--silver` /
   `--silver-dim` also survive as token names — those are greys and the name is
   the only thing wrong with them.
4. **Hunt the rest of the stale rates.** Four thresholds written for a country
   of twenty-four thousand have been found and fixed; there is no reason to
   think they were the only four. See "Rates written for twenty-four thousand
   people" — the recipe is to look at every percentage compared against a
   literal and ask what country that literal was written for.
5. **Re-apportionment never happens.** The House is apportioned once, at the
   founding, so a state whose population moves keeps the seats it started with —
   **and now so does its ground**, since a parcel is a congressional district.
   `world.remintParcels` is the half of it that already exists; what is missing
   is anything that calls it on a decennial census. Real apportionment is
   decennial and a Season is about a generation, so it is a feature-shaped hole
   rather than a bug, but the hole is bigger than it was.
6. **A state's House delegation votes as a bloc.** Every congressional district
   in a state draws on the same electorate — there is no sub-state geography for
   voters — so TX-1 and TX-3 break the same way. Real delegations are mixed.
   **The parcels are now the districts**, which is the half of this that used to
   be missing: what is left is giving a parcel its own partisan split rather
   than reading its state's.
7. **The DOJ is a room with one thing in it.** The Attorney General holds
   `arrest` and the department shows who is being held and on what. Charging,
   investigating and dropping a case are not written. It was built to be filled
   in later and it is laid out symmetrically with the other three departments —
   `rules.js` × 8 sites, `ui.js` × 3, `scene.js` × 3, plus an `npc.js` runner if
   you want an NPC AG to act on its own, which nothing does yet.
8. **The presidency is still decided by popular vote**, amendments still need no
   state ratification, and a presidency vacant with no VP still goes to a special
   election. See the end of "What is American about it now" for the full list of
   what is left.

**Known rough edges:**

- **The country is the real one now, and that is new** — see "The census, and
  the money" above. Population, unemployment, homelessness, land price and party
  lean are seeded per state from `atlas.js` rather than from dice or parcel
  counts, so apportionment is stable across Seasons and `tests/census.mjs` can
  assert on it. Three rough edges that used to live in this list — population not
  matching the census, apportionment moving between Seasons, and per-district
  effects being diluted to nothing — went with it. Treat the whole change as
  unplayed: it is verified by tests and by two unattended runs, not by a Season.
- **`macro.mjs` fails about once in fifteen runs, and the line is captured.**
  It is the debt block:

  ```
  FAIL a real surplus pays it down | 10714724M -> 11138802M
  ```

  So a Season that was asked to run a surplus finished the year **$424B deeper
  in debt** — not a rounding error, and not a near miss. Measured at 2 failures
  in 20 runs, and 1 in 20 on the commit before the jobs work, so it is
  pre-existing and it is **far more frequent than the "once in seventy" this
  file used to claim**. It was never the rare flake it was written up as; it was
  under-sampled.

  **This is a claim about a guarantee, not a tendency** — the test names a
  surplus and asserts the debt falls — so by this file's own rule it is a bug
  and not a sample. The obvious suspect is that the surplus is being spent
  before `MACRO.financeDeficit` runs at the year's close (`sim.tickEconomy`),
  or that interest is charged against the opening balance rather than the
  closing one. Nobody has looked yet.
- `Chronicle` has no `h1.page`. Pre-existing, not breakage.
- Two of the three constitution templates are archived (`PICKABLE_TEMPLATES`).
  `federal-republic` is the only one a table can pick.

---

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
  `atlas.js` imports nothing. `world.js` imports `geo.js` (added for
  `carveWater`) — safe, because `geo.js` reaches only `util` and `atlas`.
- **`world.rngState` is seeded from `Math.random()`.** Seasons are *not*
  reproducible. **Never diagnose a difference between two runs as a regression**,
  and never assert on a single sample — see the flakes below.

### Field names

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
  the cloakroom; all green at `425cbd9`.
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
- **~2299 assertions green across 128 files**, and the per-file sweep is clean
  as well as the pooled run — with `macro.mjs` the one real exception, above.

**And a trap that cost real time this session:** the browser serves stale ES
modules after an edit *even though `devserver.py` sends `Cache-Control:
no-store`*, and `location.reload()` does not clear them. A cache-busting query
on `index.html` does not help either — the module URLs are unchanged. **What
works is a different origin**: start a second `devserver.py` on another port
and navigate there. Symptom: you found a fresh republic and the world does not
have the field you just added.

# The Union — handoff, Aug 22 2026

Paste-into-a-new-session context for **The Union**, a simplified United States
government simulator. It is a fork of the *Silver: The Living Republic*
prototype, rewrapped and rebuilt as the US.

The live code is this repo — `/Users/james/Claude Code/congressional app
challenge`, GitHub `jamessun042110-maker/US-Government-Simulation-Game`. **The
folder name contains spaces: quote every path.**

**State:** branch `bicameral-congress`, working tree clean. **Not merged to
`main`, and not pushed.** `main` is still at `6bb31c8`, two code commits behind:
`5777a20` (the second chamber) and `425cbd9` (the apportioned House, and ten
smaller things). Suite: **2202 passed / 0 failed, 124 files**, ~31k lines of JS.

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
| `abbr` | a map label, invented per region | Carolinas `CA` — collides with California |
| `codeOf` | the region's own code, for numbering districts | `NWE`, `TX` — merged regions are **three** letters so they can never collide with the fifty |
| `postalOf` | the real states a region was merged from | `ME · NH · VT · MA · RI · CT` |
| `peopleOf` | 2020 census, millions, per region | California 39.5 |

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
- **A tie fails** (`tally.deadlocked`) unless a tie-breaker settles it, and the
  VP only breaks ties in the Senate. Confining the tie-break without the deadlock
  rule silently restores the 10–10-passes bug in the House. The tie-break scan
  also skips **every** chamber, not just the voting one — the Senate holds a
  `vote` power, so a tied House bill was otherwise settled by whichever senator
  sat first in `world.seats`.

**The office id of the House is still `assembly`**, deliberately: a rename is a
string sweep that cannot tell it from `RIGHTS.assembly`, the freedom to assemble.

---

## Ages, water, cloakrooms

- **`office.minAge` is the constitution's qualification** — 25 House, 30 Senate,
  35 President, and 35 VP because the Twelfth Amendment makes anyone ineligible
  for the one ineligible for the other. `rules.eligibleByAge` is the gate;
  `mayHoldAgain` calls it, so it bites on the ballot, the nomination and the
  seating alike. **It expires** — someone barred today is eligible the year they
  grow into it — so it is asked fresh every time and never stamped on a persona.
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
- **One cloakroom per chamber.** `mayEnterCloakroom(world, id, chamberId)`;
  channels `cloakroom` (lower) and `cloakroom_upper`. The VP is in the Senate's
  and no other — see `presidedChamber`.

---

## Naming

`Silver` → `The United States`, `goldland` → `canada`, `electrum` → `mexico`,
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
2. **Balance after 7 → 65 legislators.** Quorum, pass fractions and floor votes
   run across a 45-seat House *and* a 20-seat Senate, and a bill needs both.
   Nothing was retuned. Expect the statute book to fill more slowly than it did.
3. **Icons and palette.** The title screen and the founding page are federal blue
   with a tricolour rule; the app proper is still Silver's indigo/gold.
   `css/app.css` still sets `--brand: var(--purple)` and carries `--silver` /
   `--silver-dim` as colour tokens — those are greys and the name is the only
   thing wrong with them.
4. **Senate elections are not staggered.** The real Senate turns over in thirds.
   Elections are scheduled per *office*, not per seat, so all twenty go to the
   country at once every six years. Staggering means per-seat scheduling.
5. **Re-apportionment never happens.** The House is apportioned once, at the
   founding, so a state whose population moves keeps the seats it started with.
   Real apportionment is decennial and a Season is about a generation, so this is
   a feature-shaped hole rather than a bug.
6. **A state's House delegation votes as a bloc.** Every congressional district
   in a state draws on the same electorate — there is no sub-state geography for
   voters — so TX-1 and TX-3 break the same way. Real delegations are mixed.
   Fixing it means electorates below state level, which is the parcel grid's job
   and a large change.

**Known rough edges:**

- **Simulated population does not match the census, and cannot.** `seedStock`
  weights housing by `atlas.peopleOf`, but there are 96 parcels for the whole
  country and a state holds four or five, so the parcel grid is the binding
  constraint. The ordering is roughly right — which is all apportionment needs —
  but expect a state to be a seat or two off what an American would guess.
- **Apportionment differs between Seasons.** Population seeding draws on
  `world.rngState`, so the same state can send four members in one Season and two
  in the next; currently the spread is one to five. Not a bug — but do not write
  a test that asserts a specific state's seat count.
- **The 20-district split diluted every per-district effect.** A housing
  disbursal rehouses about one person, because the relief is a share of the
  district's homeless. The executive spending door is capped at $1M, so you
  cannot simply spend more — above that it is a bill.
- **`macro.mjs` fails about once in seventy runs.** Seen once in a full sweep and
  not reproduced in 70 consecutive runs afterwards, so the failing assertion was
  never captured. **If you see it, save the FAIL line before doing anything else.**
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
  returns the same person to two of its seats.
- A bill hand-carried through both chambers in the browser: the floor card reads
  "Already carried: House of Representatives 45–0" and "simple majority of the
  Senate" over a completely different roll, then "has passed the Senate and is on
  your desk".
- The age gate refuses a 26-year-old the Senate ("Eligible in 4 years") and the
  presidency, and admits them to the House.
- A House member sees only the House Cloakroom; a senator sees only the Senate's,
  with the Vice President in the room.
- All nine views, the four department rooms and both cloakrooms render with no
  console errors beyond the expected websocket one.
- **2202 assertions green across 124 files.**

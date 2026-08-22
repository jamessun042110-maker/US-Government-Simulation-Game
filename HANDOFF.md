# The Union — handoff, Aug 14 2026 (a)

Paste-into-a-new-session context for **The Union**, a simplified United States
government simulator. It is a fork of the *Silver: The Living Republic*
prototype, rewrapped and rebuilt as the US.

The live code is this repo — `/Users/james/Claude Code/congressional app
challenge`, GitHub `jamessun042110-maker/US-Government-Simulation-Game`. **The
folder name contains spaces: quote every path.**

**Suite: 2202 passed / 0 failed, 124 files.** The bicameral work and the eleven
fixes after it are committed on branch `bicameral-congress` — **not merged to
`main`, and not pushed.**

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
`.claude/launch.json` is not what the tool consults. `http://localhost:8825`
is blocked from direct `navigate` — go through `preview_start` first.

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

## What changed from Silver

### The atlas — `js/atlas.js`

**New file, and the source of truth for all geography.** Written in **degrees**
and projected once, so every coordinate can be held against a real map and
checked. `P(25.8, -80.2)` is Miami; `[216.3, 159.7]` is not checkable by anyone.

- **It imports nothing.** `geo.js` imports it, so importing back would be the
  first module cycle in the codebase. The frame size is repeated as two numbers,
  with a test that the two definitions agree.
- The projection is equirectangular with a **0.8 latitude correction**. Without
  it the country comes out half again as wide as it is tall. Texas is the tell —
  it is close to square on the ground, so the test asserts that ratio rather
  than any single coordinate.
- `ringsAt(north, south)` reassembles all three countries at any frontier
  displacement. **This is the whole annexation mechanism.**

### Twenty states, not seven districts

Fifty merged to twenty — the target is not arbitrary, `MAX_DISTRICTS` was
already 20. New York, Florida, Texas, California, Michigan and Illinois stay
whole; the rest are regional. See `DESIGN-us.md` for the table.

The **Senate** has 20 seats, one per state — and it is the chamber `world.js`
reads the district count off. The **House** is apportioned across those states
and has 45. See "The House is apportioned" below.

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
- **Canada's coast is clamped to its own frontier** (`held()` in `ringsAt`).
  Without it, a frontier driven north crosses the coastline, the ring folds
  through itself, and ray-casting reports the XOR: a country annexed outright
  kept 9.8% of the map in scattered pieces.
- **Mexico's coast is clamped to its own frontier too** (`heldSouth`), and for the
  same reason Canada's is. It got away without one only while its outline stopped
  at the isthmus; drawing the Yucatán put a peninsula four degrees further south
  that runs back *north*, so a frontier pushed into that band cut the country in
  two and left the peninsula behind. Annexing both neighbours then left 2% of the
  continent in Mexican hands.
- Shares at the founding: **Canada 49%, US 41.7%, Mexico 9.3%**. Measured, not
  targeted — the 49th parallel is where it is, and Mexico gained the Yucatán.

### Ages, water, and the two cloakrooms

- **`office.minAge` is the constitution's qualification** — 25 House, 30 Senate,
  35 President, and 35 VP because the Twelfth Amendment makes anyone ineligible
  for the one ineligible for the other. `rules.eligibleByAge` is the gate;
  `mayHoldAgain` calls it, so it bites on the ballot, the nomination and the
  seating alike. **It expires** — someone barred today is eligible the year they
  grow into it — so it is asked fresh every time and never recorded on a persona.
- **Anything that mints a persona for a chair must pass `minAge`.**
  `makePersona` rolls from 34 and the executive asks 35, so one synthetic in
  thirty-four was silently refused. That cost an empty presidential ballot about
  once in twelve republics — `fillVacantSeats` and `sim`'s challenger-maker both
  pass it now.
- **Water is where a named lake is.** `carveWater` used to thin one or two
  *random* parcels out of every coastal state, which put an inland lake in Texas.
  It now samples each parcel's drawn polygon against `atlas.LAKES` and takes the
  ones ≥25% under water — four of them, on the Great Lakes. Testing the *centre*
  finds nothing: a parcel is the size of a small state.
- **`cityGeometry` is called during `newWorld` now** (carveWater needs it), and
  `ensureEveryDistrictHasLand` moved before it — a water parcel handed to another
  state afterwards is a lake in the wrong place.
- **One cloakroom per chamber.** `mayEnterCloakroom(world, id, chamberId)`;
  channels `cloakroom` (lower) and `cloakroom_upper`. The VP is in the Senate's
  and no other — `presidedChamber`.

### The House is apportioned

The two chambers were the same size, which made the lower one the Senate with a
shorter term. It is now **45 seats divided between the states by population**,
against the Senate's 20.

- **`office.apportioned` is the flag.** `world.assignDistrictSeats` divides an
  apportioned office's seats across the states by **Huntington–Hill**
  (`rules.apportion` — the real method) and gives each one a numbered
  congressional district on `seat.cd`: `TX-1`, `NWE-3`. An unapportioned district
  office gets one seat per state and no `cd`.
- **The Senate decides how many states there are.** `world.js` and
  `actions.beginSeason` read the district count off the first district-elected
  chamber that is *not* apportioned. Reading it off the House would cut the
  country into forty-five pieces.
- **Districts are stable.** `assignDistrictSeats` is the one place seats are
  dealt, called at world creation and again at ratification. It used to be two
  different round-robins, which is where "a district drawn at ratification" came
  from — the chair you took at the convention was not the electorate you sat for.
- **An apportioned chamber runs one contest per seat.** `sim.nominate` stamps
  `cand.seatId`, and `closeElection` cuts the field by it. Without that, four
  Texas seats saw one field and returned the same person four times.
- **Region codes are a third thing.** `atlas.codeOf` — not `abbr` (a map label
  that collides with real postal codes: the Carolinas' `CA` is California's) and
  not `postalOf` (a list, which cannot number a district). Merged regions carry
  invented **three**-letter codes so they can never collide with the fifty.
- **`atlas.peopleOf` is the 2020 census**, in millions, per region. `seedStock`
  weights housing by it. **It does not reproduce the census** and cannot: there
  are 96 parcels for the whole country, a parcel holds one building, and a state
  has four or five of them. It gets the ordering roughly right and stops the
  empty half of the country holding the most people, which is what an apportioned
  chamber needed. Expect a state to be a seat or two off what an American would
  guess.

### Two chambers

Full design in `DESIGN-us.md` §3. The parts that will bite:

- **`legislature.chamber` is still the first chamber**, not a pair.
  `legislature.upperChamber` is the second, and `null` means unicameral. Nothing
  that read `chamber` had to change meaning.
- **A measure stands in one room at a time.** `doc.chamberStage` indexes
  `R.chambers(world)`; `acts.closeFloor` advances it. Everything else goes
  through `R.voteRequirement`, so it follows the stage without knowing. **If you
  add a new kind of vote, route it through `voteRequirement` and it is bicameral
  for free.**
- **The office id of the House is still `assembly`.** Deliberately — a rename is
  a string sweep that cannot tell it from `RIGHTS.assembly`, the freedom to
  assemble. `senate` is the Senate.
- **The Senate is one seat per state, not two.** A district election is one
  contest per seat filtered to that district, so two seats in one district elect
  the same person twice. `repairConstitution` now forces every district-elected
  office to the same seat count for this reason. **Do not raise the Senate to 40
  without first making district elections multi-winner.**
- **A tie now fails** (`tally.deadlocked`) unless a tie-breaker settles it, and
  the VP only breaks ties in the Senate. Confining the tie-break without the
  deadlock rule silently restores the 10–10-passes bug in the House.
- **Bills originate in the House whoever files them**, including senators.
- `doc.chamberTallies` keeps the rooms a measure has already carried, because
  `doc.tally` is overwritten by the second chamber's count.

### Naming

`Silver` → `The United States`, `goldland` → `canada`, `electrum` → `mexico`,
and the power id for our own country is **`us`**, not `silver`. Storage keys and
the console namespace are `usgov.*` and `__usgov`.

**`util.midThe`** is the mirror of `withThe`: a name that already carries a
capitalised article, dropped mid-sentence. Without it the founding document read
"Constitution of the Republic of **The** United States".

---

## Still to do

**Queued, not started:**

1. **Play a full Season end to end.** Now the biggest gap by a distance, and the
   handoff this forked from was emphatic about it: one hand-played presidency
   found four faults nothing else had. Bicameralism makes this more urgent, not
   less — every bill now takes two floor cycles, and nothing has been played at
   that pace.
2. **Balance after 7 → 65 legislators.** Quorum, pass fractions and floor votes
   now run across a 45-seat House *and* a 20-seat Senate, and a bill needs both.
   Nothing was retuned. Expect the statute book to fill more slowly than it did.
3. **Icons and palette.** Still Silver's indigo/gold in the app proper. The title
   screen and the founding page are federal blue with a tricolour rule now; the
   rest is not. `css/app.css` still sets `--brand: var(--purple)`, and has
   `--silver` / `--silver-dim` as colour tokens — those are greys and the name is
   the only thing wrong with them.
4. **Senate elections are not staggered.** The real Senate turns over in thirds.
   Elections here are scheduled per *office*, not per seat, so all twenty seats
   go to the country at once every six years. Staggering means per-seat election
   scheduling, which is a real piece of work and was left alone.
5. **Re-apportionment never happens.** The House is apportioned once, at the
   founding. A state whose population moves over a Season keeps the seats it
   started with. Real apportionment is decennial; a Season is about a generation,
   so this is a feature-shaped hole rather than a bug.
6. **A state's House delegation votes as a bloc.** Every congressional district
   in a state draws on the same electorate — there is no sub-state geography for
   voters — so TX-1 and TX-3 are decided by the same partisanship and tend to
   break the same way. Real delegations are mixed. Fixing it means districts
   below state level, which is the parcel grid's job and a large change.

**Done since the fork:** bicameral Congress and an apportioned House (see
`DESIGN-us.md` §3), constitutional ages, real lake water, a redrawn Alaska, the
Yucatán, per-chamber cloakrooms.

**Known rough edges:**

- **The 20-district split diluted every per-district effect.** A housing
  disbursal now rehouses about one person, because the relief is a share of the
  district's homeless. The executive spending door is capped at $1M, so you
  cannot simply spend more — above that it is a bill.
- `Chronicle` has no `h1.page`. Pre-existing, not breakage.
- **`macro.mjs` fails about once in seventy runs.** Seen once in a full sweep and
  not reproduced in 70 consecutive runs afterwards, so the failing assertion was
  never captured. Do not go hunting it on a single sample — if you see it, save
  the FAIL line first.
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
- **The engine is the authority, the screen is a courtesy.** Actions arrive from
  other tabs and are applied straight to the world, so a check that lives only in
  a disabled button is not a check.
- **`tick 0` is a real tick and is falsy.** Stamp flags `world.clock.tick || 1`.
- **Several engine functions return `{ok, …}`, not a boolean.**
- **Module cycles are avoided deliberately.** `util.js` imports nothing;
  `atlas.js` imports nothing.
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

---

## Testing from automation

- The browser pane reports `document.hidden === true`, so **the clock does not
  advance**. `__usgov.render(true)` forces a paint; `__usgov.world`,
  `__usgov.dispatch({type:…})`, `__usgov.playerId`.
- **Reload after every source edit** — and note a reload only re-fetches modules
  the page imports fresh. Adding an export to `atlas.js` and importing
  `world.js?v=2` gives you the *cached* atlas and a confusing missing-export
  error. Navigate, don't cache-bust.
- **A reload after >150s away drops you on the join screen** (`GONE_AFTER`).
- **A saved Season keeps the constitution it was founded under.** An in-progress
  world has no Senate and never will — the constitution is per-world, and
  `repairConstitution` nulls `upperChamber` for it, so it stays unicameral and
  correct. **To see anything constitutional you changed, you must found a new
  republic.** This reads exactly like a stale module; it is not.
- **Clearing `localStorage` from the running page does not stick.** The live page
  writes its world back before you can reload, and you come back to the same
  Season. Clear and reload in *one* expression:
  `Object.keys(localStorage).filter(k=>k.startsWith('usgov')).forEach(k=>localStorage.removeItem(k)); location.reload();`
- **The convention's Begin/Ready buttons sit below the fold** and the pane's
  scroll can hang. `__usgov.dispatch({type:'READY'})` then `{type:'RATIFY'}` puts
  you in a live Season in one call.
- **Set `world.paused = true`** — clicking Pause files a table motion.
- **The oath modal comes up even with `w.inaugurated = 0`.**
- **Walk every tab after touching ui.js.** All nine are green at `c238fbd`.
- `tools/mapcheck.mjs` renders the atlas to SVG. **It earns its keep**: every
  numeric test passed while Canada drew as a wedge pointing at Seattle and
  Mexico painted the Pacific as its own territory. Areas and adjacencies cannot
  see that; an eye can.

---

## The three flakes, and the lesson

All three were claims about a **tendency** measured on a **single sample**. All
three got quieter as districts got smaller, so twenty states uncovered them
rather than causing them.

- **`hiring.mjs`** took `districts[0]` and tripled its population to clear the
  unemployment floor. `local` is `clamp(1 - jobs/labour, 0.01, 0.7)` — clamped at
  **both** ends, so raising the multiplier overshoots into the ceiling. `pop * 9`
  failed every run; an absolute 10,000 failed 14 in 15. It now picks the district
  nearest the middle of the range and needs no calibration.
- **`shelter.mjs`** asserted homelessness was lower than a sample taken before
  the recompute. The relief is often one person and the recompute's own baseline
  moves by about that much, so a perfect relief could come back equal. It
  measures against the counterfactual now — same world, relief cleared.
- **`allterms.mjs`** asked whether presidencies end for more than one reason and
  read it off one republic, which can legitimately spend its whole history
  turning presidents out at the polls. Pooled across three.

**The method is the point.** Each was fixed by asking what the test actually
claims and measuring *that*, not by widening a tolerance until it passed.

---

## Verified clean — do not re-hunt

- The twenty states tile the country to within 0.4%, and no state contains
  another's centre.
- Annexation moves real frontiers in both directions, and a power can be annexed
  off the continent entirely (0.0% left) without touching the third country.
- Water parcels appear only in the fifteen states with a sea or a Great Lake.
- All nine views render with no console errors, and so do the department rooms
  and both cloakrooms, on a bicameral world with a bill mid-passage.
- A 45-seat House apportioned 1–5 per state, every seat with a unique numbered
  district, and 45 distinct winners from a single election — no state returns the
  same person to two of its seats.
- A bill hand-carried through both chambers in the browser: House 20–0 → the
  floor card reads "Already carried: House of Representatives 20–0" and
  "simple majority of the Senate" over a completely different roll → Senate 20–0
  → "has passed the Senate and is on your desk".
- 2184 assertions green across 124 files.

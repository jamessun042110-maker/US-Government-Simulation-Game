# Silver → United States: the overhaul

The prototype is a fictional republic called Silver on an invented continent,
sharing it with Goldland and Electrum. This turns it into a simplified United
States without discarding the machinery that makes the game work.

The guiding constraint: **rewrap, don't rewrite.** The engine's good parts — the
executable constitution, the border solver that moves a frontier after a war, the
Chronicle that writes presidential articles — stay. What changes is what they are
pointed at.

## What was already there

`federal-republic` is the only selectable template (the other two are archived),
and it is already most of a US government: a President on a four-year term with a
two-term limit, veto, pardon and command of the military; a Vice President
elected on the ticket who actually succeeds; Secretaries of State, Defense and
the Treasury serving at will; a Supreme Court that can strike a law. Its preamble
already reads *"We the people of {nation}, in order to…"*.

So the institutional work is not "build a US government". It is one real gap —
**Congress is unicameral** — plus naming.

## The four decisions

| | Chosen |
| --- | --- |
| Congress | Full bicameral — House and Senate both pass every bill |
| Map | Real US outline, real (merged) state borders |
| Interior | Districts become states; the parcel grid becomes national territory |
| Framing | Contemporary second founding, 2029 start |

## 1. Geography

### Keeping annexation alive

Hand-authored borders would normally kill the war machinery. `world.cessions`,
`acts.applyPeaceTerms` and the presidential article that reports *a power annexed
out of existence* all assume borders that **move** — `cut()` solves a fractal
line against target land shares, and a cession changes the target.

The fix is to keep the offset and replace only the line. The international
borders become real coordinate polylines, but they keep `cut()`'s `lift`
mechanism: winning a war against Canada slides the real 49th-parallel frontier
north, through real geography, exactly as before. Nothing downstream of the
border knows the difference.

### The continent

`CONTINENT` — a hand-drawn silhouette roughened by `coast()` — becomes North
America. Three nations, two east–west bands rather than the old T-junction:

- **Canada** north of the 49th parallel and the Great Lakes (was Goldland, whose
  deep northern share already fits).
- **The United States** in the middle.
- **Mexico** south, tapering (was Electrum, which sat *east* of us — the reason
  the border topology has to change rather than just the names).

The coastline stays roughened rather than survey-accurate: the Pacific bulge of
California, the Gulf curve, the Florida peninsula and the Atlantic seaboard are
what make it readable at a glance, not vertex fidelity.

## 2. The twenty states

The instruction was to start from 50 and merge small or similar ones down to 20.
The merges keep the six most recognizable states whole — New York, Florida,
Texas, California, Michigan, Illinois — and combine the rest by region, since a
player who cannot find Rhode Island on a map can still find New England.

| # | Region | Merged from |
| --- | --- | --- |
| 1 | New England | ME, NH, VT, MA, RI, CT |
| 2 | New York | NY |
| 3 | Mid-Atlantic | NJ, PA, DE, MD, DC |
| 4 | Virginia | VA, WV |
| 5 | The Carolinas | NC, SC |
| 6 | Florida | FL |
| 7 | Deep South | GA, AL, MS |
| 8 | Upper South | KY, TN |
| 9 | Ohio Valley | OH, IN |
| 10 | Michigan | MI |
| 11 | Illinois | IL |
| 12 | Upper Midwest | WI, MN |
| 13 | Heartland | IA, MO |
| 14 | Great Plains | ND, SD, NE, KS |
| 15 | Texas | TX |
| 16 | South Central | AR, LA, OK |
| 17 | Mountain West | MT, ID, WY |
| 18 | Southwest | CO, UT, NV, AZ, NM |
| 19 | California | CA |
| 20 | Pacific Northwest | WA, OR, AK, HI |

Twenty is also `MAX_DISTRICTS`, which the engine already enforces — so the merge
target was not chosen freely, it is the ceiling the code already had.

Alaska and Hawaii fold into the Pacific Northwest rather than getting inset
boxes; the map is a play surface, and two unreachable islands would be two
districts nobody can build in.

### Geometry

Districts currently have no fixed shape — `cityGeometry` cuts them out of the
nation's land as population-weighted Voronoi cells. States need authored
outlines, so the authored polygon is supplied per state and the Voronoi step is
skipped for them. **Parcels still subdivide inside each state**, which is what
keeps zoning, land value and the build system working untouched.

Western regions are close to rectangles in reality, which makes them nearly free
to author. The eastern seaboard carries the detail.

## 3. Bicameral Congress — built

The single `assembly` office split in two:

- **House of Representatives** — 20 seats, 2-year terms, one per state. Office id
  stays `assembly`; the label is what a player reads. Renaming the id would be a
  string sweep that cannot tell it apart from `RIGHTS.assembly`, the freedom to
  assemble.
- **Senate** — 20 seats, **6-year** terms, one per state.

**The Senate is one per state, not two.** A district election is one contest per
seat filtered to that seat's own district (`sim.closeElection`), so two seats in
one district would run the same field twice and return the same winner twice.
What distinguishes the Senate here is therefore not its apportionment — that
matches the House, which is not population-apportioned either — but the six-year
term, which puts a senator three House elections away from the mood of the
moment, and the second vote every bill has to win.

`repairConstitution` enforces that every district-elected office holds exactly
one seat per district, so trimming one chamber at the convention trims the other.

### How the split lands

`legislature.chamber` is where a measure starts; `legislature.upperChamber` is
where it goes next, and `null` means unicameral — every other template, and any
constitution that strikes a chamber, behaves exactly as before.

A measure stands in **one room at a time**. `doc.chamberStage` indexes the
chamber list, and `acts.closeFloor` advances it — the same two-stage shape the
impeachment trial already used. Everything else (the roll, the tally, the quorum,
the tie-break, every legislative view) reaches the body through
`rules.voteRequirement`, so it follows the stage without knowing the split
exists. That indirection is why the change is small.

**Bills originate in the House whoever files them.** The simplification that
keeps the stage a counter rather than a direction, and what the revenue-origination
rule would force anyway. A senator's bill starts in the House and comes back.

Who votes on what:

| Measure | Rooms |
|---|---|
| Bill, amendment | Both, House first |
| Treaty | Senate alone — advice and consent |
| Impeachment | House brings articles, Senate sits as the court |
| Veto override | Both, at the override fraction, House first |

### Two rules the split forced out into the open

- **The tie-break belongs to the Senate.** The VP presides there; the House
  settles its own business. The scan also has to skip *every* chamber, not just
  the voting one — with the Senate holding a `vote` power, a tied House bill was
  otherwise settled by whichever senator sat first in `world.seats`.
- **An equally divided chamber has not carried the measure.** At a simple-majority
  bar `share >= 0.5` is true of a dead tie, so 10–10 passed on the letter of
  "half the votes cast". The tie-break used to paper over this; confining it to
  the Senate brought the bug straight back in the House, so `tally.deadlocked`
  now states the rule outright.

## 4. Naming and framing

The Season still runs founding → collapse and still starts in 2029: a second
founding, with the convention writing US institutions. Keeping the modern setting
is what keeps the economy, the central bank, company valuations and the
Chronicle's "(born 1994)" article prose coherent — a 1789 start would have meant
reworking all of it.

District names (`Old Quarter`, `Harborlight`, `Ironside`) give way to state
names. Person names become American. `Silver` → `the United States`, and the
theme's silver palette gives way to a federal one.

## Order of work

1. ~~Naming and data — nations, the twenty states, offices, palette.~~ Done.
2. ~~Geography — real outline, real borders, authored state polygons.~~ Done.
3. ~~Bicameral Congress.~~ Done.
4. Icons and theme.
5. Tests — 122 files assumed Silver, its districts and a single chamber; 124 now,
   and the chamber literals are gone from the ones that carried a bill.

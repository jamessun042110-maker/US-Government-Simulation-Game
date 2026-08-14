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

## 3. Bicameral Congress

The single `assembly` office splits:

- **House of Representatives** — the existing 7-seat, 2-year, district-elected
  chamber, renamed. Apportioned by state, so the states double as the electoral
  map.
- **Senate** — a second chamber, longer term, elected statewide rather than by
  district.

Both must pass a bill. This is the largest bug surface in the overhaul: the
single-chamber assumption runs through the bill lifecycle, vote counting, quorum,
veto override and every legislative view in `ui.js`. `legislature.chamber` is one
string today; it becomes a pair, and every reader of it has to be found.

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

1. Naming and data — nations, the twenty states, offices, palette.
2. Geography — real outline, real borders, authored state polygons.
3. Bicameral Congress.
4. Icons and theme.
5. Tests — 122 files assume Silver, its districts and a single chamber.

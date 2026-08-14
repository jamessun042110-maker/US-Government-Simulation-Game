# SILVER — The Living Republic

A working prototype of the real-time multiplayer nation simulator described in
the design prompt. No build step, no dependencies, no server process beyond a
static file host.

```bash
python3 devserver.py 8777
```

Then open <http://localhost:8777>. **Each browser tab is one player.** Open a
second tab to bring someone else to the table.

Use `devserver.py` rather than `python3 -m http.server`: it sends
`Cache-Control: no-store`, and a cached ES module after an edit gives you a white
screen and phantom missing-export errors. The `ws://…/ws` console error is
expected when running without the relay.

## Playing over the internet

The same game, across real machines. Run the relay server instead of the
static host (one dependency, `ws`, used only by the server):

```bash
npm install        # once
node server.js     # serves the game on :8777 and relays messages at /ws
```

When the page is served this way, tabs talk through the relay instead of
BroadcastChannel — the server owns host election and hands the latest world
snapshot to late joiners. Served by plain `python3 -m http.server`, everything
falls back to local multi-tab mode automatically.

To bring in a player from outside your network, put a tunnel in front of it:

```bash
cloudflared tunnel --url http://localhost:8777   # brew install cloudflared
```

Send them the printed `https://….trycloudflare.com` URL; you play on
localhost, they play through the tunnel, same world. The URL is temporary and
changes every run. The relay keeps the world only in memory — restarting
`server.js` forgets it.

## Tests

```bash
sh tests/run-all.sh
```

2080 assertions across 122 files, node only, about 90 seconds. `NODE=` overrides
the interpreter. `run-all.sh` prints failures under the file that produced them,
so piping it to `tail` will hide them.

The assertion suite is the floor, not the ceiling — the serious bugs in this
codebase were found by running Seasons headless with invariants checked every few
ticks. `tests/statehygiene.mjs` and `tests/bughunt*.mjs` are what those runs
produced, and are worth reading for the shape of a useful invariant.

---

## What actually works

**The constitution is executable.** Three templates — elective autocracy,
parliamentary council, federal republic with judiciary — compile into rules the
engine enforces. Offices, the powers attached to them, term lengths, pass
fractions, quorum, veto and override, impeachment, spending thresholds and
enumerated rights are all live configuration. Set the spending rule to *3/5 of
the Assembly above $10M* and the treasury's Disburse button is genuinely not
connected until that vote exists; it quotes the clause blocking it. Amendments
patch the running rules mid-Season.

**The simulated citizenry.** ~24,000 synthetic citizens across districts, as a
statistical fabric: income, employment, housing, land value, district mood, and
per-issue salience. They vote in every election alongside players at a weight
the constitution sets. They react to policy on real timelines — pass a housing
act and the homeless count falls when the building opens, not when the vote
passes.

**Documents with force.** Every consequential act is a document whose clauses
are both readable prose and executable effects: `SET_TAX`, `APPROPRIATE`,
`BUILD`, `ZONE`, `REDISTRICT`, `AMEND`, `CREATE_OFFICE`, `GRANT_POWER`, `RIGHT`,
`DECLARE_WAR`, `TREATY_DEFENSE`, `PARDON`, `ARREST`, `EXILE`, `REMOVE`,
`CALL_ELECTION`. A bill's vote threshold is derived from what its clauses cost.
A co-signed mutual-defence treaty fires its obligations automatically the moment
war is declared.

**The city and the ledger.** A 12×8 parcel map with zoning, per-parcel land
values, construction with real costs and build timers drawn from the treasury,
and neighbour effects — the jail really does lower the value of everything
beside it. Districts are parcel sets, so redistricting is a clause in a bill and
gerrymandering is an emergent sport.

**The press.** Found papers with credibility and reach. Publishing shifts
district opinion and issue salience. A story that cites a real Chronicle entry
lands 1.35× harder and raises your credibility; an uncited one lands softer and
risks costing you six points of it. Rebuttals blunt a story's ongoing pressure;
libel suits turn on whether the story was supported, and on whether the
constitution enumerates a free-press right.

**Intrigue.** Private conspiracy rooms that are genuinely private and that
accumulate a discoverable exposure trail — investigations roll against it and
surface real message fragments. Spies replace alts: a covert persona with an
exposure budget running observe / copy / plant / sabotage / turn. Uprisings and
secessions are resolved by a support check over a real-time window — player
allegiance, offices held, arms, and citizen sympathy — never by who owns the
server.

**The drama engine.** A pacing director watches the weighted rate of recorded
acts and injects events during lulls, filtered by the Season's canon dial
(grounded municipal / cold war / anything goes). Events are prompts with a
deadline: answer them, or they resolve themselves against you.

**The Chronicle.** Every act is timestamped and permanent. Entries can be
contested, and rival accounts sit side by side. The thirteen-attribute historian
ranking is computed from tenure data and adjustable by the community.
Obituaries, laws in force, and the whole narrative history export to Markdown.

**Collapse.** Seasons are designed to end. Simultaneous bankruptcy, despair,
lost wars, empty offices and secession move the Season into its third act.

---

## Separation of powers, out of game

Moderation lives outside the fiction. No in-game office grants it; no
out-of-game role grants in-game authority. Execution, exile and imprisonment are
states applied to *characters* — the player rolls a new persona (a son, a
returning exile under a false name) inheriting nothing but reputation. Nobody
can delete the nation.

---

## How the multiplayer works

There is no server. Every tab is a client; one is elected host and is the only
one that mutates the world. Clients dispatch actions over `BroadcastChannel`;
the host applies them and republishes a snapshot each tick. The host claims its
role with a claim-then-confirm on a `localStorage` key, and if two tabs ever
believe they're host, the lower client id keeps the world. Close the host tab
and another takes over in about three seconds, resuming from the last snapshot.

Swap `BroadcastChannel` for a WebSocket and nothing else in the codebase changes
— that is the point of the split.

One real second is one tick. At the default 120 ticks per canon year, a
two-week Season spans a generation.

---

## Layout

| File | What it holds |
| --- | --- |
| `js/net.js` | Host election, snapshot transport, action routing |
| `js/rules.js` | Constitution templates, powers, thresholds, every "may I?" |
| `js/world.js` | Genesis: map, citizenry, building catalogue, economy |
| `js/acts.js` | Clause catalogue, document lifecycle, the treasury gate |
| `js/sim.js` | The tick: money, construction, opinion, floor, elections, war |
| `js/media.js` | Outlets, publication, opinion impact, rebuttal, libel |
| `js/intrigue.js` | Conspiracies, spies, investigations, uprisings, secession |
| `js/director.js` | The pacing director and its event catalogue |
| `js/chronicle.js` | The record, historian rankings, obituaries, export |
| `js/actions.js` | The single write path into the world |
| `js/ui.js` | Every view |
| `js/app.js` | Bootstrap, clock, render loop |

`window.__silver` is exposed in the console: `.world`, `.net.isHost`,
`.dispatch({type:'...'})`.

## Known edges

- Population, opinion and the economy are tuned for legibility over realism.
- War is deliberately shallow: units, a front value, and exhaustion.
- Voice on the assembly floor is text only.
- Snapshots are whole-world JSON at 1 Hz — fine for tabs, not for the internet.

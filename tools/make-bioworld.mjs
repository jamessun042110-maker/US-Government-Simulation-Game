// Builds the world that `_bio.html` reads.
//
//   node tools/make-bioworld.mjs
//
// The dump used to be committed — 320KB of a throwaway world, swept into the
// repo by the autocommit hook. It is a build product, so it is built: run this,
// get `_bioworld.json` next to `_bio.html`, and read the article at
// http://localhost:PORT/_bio.html. The file is gitignored.
//
// What it simulates is the shortest thing that produces an article worth
// looking at: a founder takes the chair, serves a term while the republic runs
// on its own, leaves, and is written up — then twelve years pass and the
// article is revised with hindsight, which is the pair the viewer shows.

import { writeFileSync } from 'node:fs';

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');

const NAME = process.argv[2] || 'James Sun';
const NATION = process.argv[3] || 'The Silver Republic';

const w = W.newWorld({ nation: NATION, founder: NAME });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: NAME });
w.phase = 'live';
w.inaugurated = 0;
const pid = w.players.p1.personaId;

// A career before the chair, so the lede has something to report.
w.pastSeats = w.pastSeats || [];
w.pastSeats.push({
  id: 'assembly#1', office: 'assembly', personaId: pid,
  since: 0, endedTick: 0, district: w.districts[0].id,
});

const seat = w.seats.find((s) => s.office === 'president');
seat.personaId = pid;
seat.since = 0;
seat.termEnds = 4 * w.clock.ticksPerYear;

// Let it run. `tick` does not always advance the clock — an open election stops
// it — so loop on the clock rather than counting iterations.
const runTo = (targetTick) => {
  let guard = 0;
  while (w.clock.tick < targetTick && guard++ < 100000) S.tick(w);
};
runTo(4 * w.clock.ticksPerYear);

// Leave the chair. The article is written on the way out.
A.vacate(w, seat, 'term ended');

// Twelve years on, hindsight rewrites it.
w.clock.tick += 12 * w.clock.ticksPerYear;
C.writeFinalBios(w);

const bio = w.bios?.[pid];
if (!bio) {
  console.error('No article was written. Nothing to view.');
  process.exit(1);
}

const out = new URL('../_bioworld.json', import.meta.url);
writeFileSync(out, JSON.stringify(w));
console.log(`${NAME} of ${NATION} — article written, revised: ${bio.final === true}`);
console.log(`wrote ${decodeURIComponent(out.pathname)}`);

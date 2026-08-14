const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');

// Run several worlds a long way and watch for a power declaring war while a war
// with that same power is still live, or two live war records for one power.
let dupDecl = 0, dupRecord = 0, redeclareGap = [];
for (let run = 0; run < 6; run++) {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  for (const f of w.foreign) f.hostility = 100;

  const declaredAt = {};   // foreign id -> tick of last declaration
  const endedAt = {};
  let seen = 0;

  for (let i = 0; i < 8000; i++) {
    for (const e of (w.elections || [])) if (!e.closed) e.closed = true;
    for (const f of w.foreign) if (!f.atWar) f.hostility = 100;   // keep the pressure on
    const before = w.chronicle.length;
    const atWarBefore = Object.fromEntries(w.foreign.map((f) => [f.id, !!f.atWar]));
    S.tick(w);
    for (const e of w.chronicle.slice(before)) {
      const m = /^(.+?) declares war on /.exec(e.text);
      if (m) {
        const f = w.foreign.find((x) => x.name === m[1]);
        if (!f) continue;
        seen++;
        if (atWarBefore[f.id]) { dupDecl++; console.log(`  !! ${f.name} declared while already at war, tick ${w.clock.tick}`); }
        if (declaredAt[f.id] != null && endedAt[f.id] != null) redeclareGap.push(w.clock.tick - endedAt[f.id]);
        declaredAt[f.id] = w.clock.tick;
      }
      if (/sues for peace|capitulates to/.test(e.text)) {
        const f = w.foreign.find((x) => e.text.includes(x.name));
        if (f) endedAt[f.id] = w.clock.tick;
      }
    }
    // Two live (unfinished) war records for the same power is the same bug
    // wearing a different hat.
    const live = {};
    for (const war of w.military.wars) {
      if (war.won || war.lost) continue;
      live[war.foreign] = (live[war.foreign] || 0) + 1;
      if (live[war.foreign] > 1) { dupRecord++; console.log(`  !! two live war records for ${war.foreign}, tick ${w.clock.tick}`); }
    }
  }
  console.log(`run ${run}: ${seen} declarations, tick ${w.clock.tick}`);
}
console.log('---');
console.log('declarations while already at war:', dupDecl);
console.log('duplicate live war records:', dupRecord);
redeclareGap.sort((a, b) => a - b);
console.log('re-declaration gaps after a war ended (ticks):', redeclareGap.slice(0, 12).join(', ') || 'none');
console.log('shortest gap:', redeclareGap[0] ?? 'n/a', '| a canon year is 240');

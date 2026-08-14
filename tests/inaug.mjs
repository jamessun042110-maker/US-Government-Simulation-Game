const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const I = await import(base + 'intrigue.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// A player holds the executive chair: the clock waits on their oath.
{
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === I.execOffice(w)?.id);
  seat.personaId = pid;

  const t0 = w.clock.tick;
  for (let i = 0; i < 50; i++) S.tick(w);
  ok('the calendar waits on the oath', w.clock.tick === t0, `tick ${w.clock.tick}`);
  ok('and nothing has happened', (w.events || []).length === 0 && w.inaugurated == null);

  ACT.apply(w, { type: 'OATH', playerId: 'p1', line: 'I will govern as written.' });
  ok('the oath starts it', w.inaugurated != null, 'inaugurated at tick ' + w.inaugurated);
  for (let i = 0; i < 20; i++) S.tick(w);
  ok('and time moves', w.clock.tick === t0 + 20, `tick ${w.clock.tick}`);
  ok('the words are in the record', w.chronicle.some((e) => /takes the oath/.test(e.text)));
}

// Nobody is in the chair, or a citizen is: there is nobody to wait on.
{
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  const t0 = w.clock.tick;
  for (let i = 0; i < 10; i++) S.tick(w);
  ok('a synthetic head does not hold the world up', w.clock.tick > t0, `tick ${w.clock.tick}`);
}

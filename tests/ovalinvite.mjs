const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};

const { w, pid } = mk();
const cit = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length);
const twoMonths = R.ovalInviteTicks(w);
ok('two months of a canon year', twoMonths === Math.round(w.clock.ticksPerYear / 6), `${twoMonths} of ${w.clock.ticksPerYear}`);

ACT.apply(w, { type: 'INVITE_OVAL', playerId: 'p1', personaId: cit.id });
ok('the guest may enter', R.mayEnterOval(w, cit.id));

// Just short of two months: still in.
for (let i = 0; i < twoMonths - 2; i++) S.tick(w);
ok('still in just before it lapses', R.mayEnterOval(w, cit.id), `tick ${w.clock.tick}`);

// Past it: out, and off the list.
for (let i = 0; i < 4; i++) S.tick(w);
ok('out once it lapses', !R.mayEnterOval(w, cit.id), `tick ${w.clock.tick}`);
ok('and off the guest list', !R.ovalGuests(w).some((g) => g.id === cit.id));
ok('the lapse is on the record', w.chronicle.some((e) => /invitation to the Oval Office lapses/.test(e.text)));

// The office-holders are untouched by any of it.
ok('the President still enters', R.mayEnterOval(w, pid));
const vp = w.seats.find((s) => s.office === 'vp')?.personaId;
ok('so does the VP', R.mayEnterOval(w, vp));
const sec = w.seats.find((s) => ['state', 'defense'].includes(s.office) && s.personaId)?.personaId;
ok('and a cabinet secretary', sec ? R.mayEnterOval(w, sec) : true, sec ? 'seated' : 'no secretary seated — skipped');
ok('none of them are on the guest list', !R.ovalGuests(w).some((g) => [pid, vp, sec].includes(g.id)));

// Re-inviting renews rather than duplicating.
ACT.apply(w, { type: 'INVITE_OVAL', playerId: 'p1', personaId: cit.id });
for (let i = 0; i < twoMonths - 5; i++) S.tick(w);
ACT.apply(w, { type: 'INVITE_OVAL', playerId: 'p1', personaId: cit.id });
ok('one entry, not two', R.ovalGuests(w).filter((g) => g.id === cit.id).length === 1);
for (let i = 0; i < 10; i++) S.tick(w);
ok('renewal resets the clock', R.mayEnterOval(w, cit.id));

// A legacy world stored bare ids: they get stamped, not dropped.
const { w: w2 } = mk();
const cit2 = Object.values(w2.personas).find((x) => x.alive && !R.officesOf(w2, x.id).length);
w2.ovalInvites = [cit2.id];
ok('a legacy id still reads as a guest', R.mayEnterOval(w2, cit2.id));
S.tick(w2);
ok('and is stamped rather than dropped', R.ovalGuests(w2).some((g) => g.id === cit2.id && g.at != null));

// Every seat on a ballot carries somebody.
//
// Found by playing: a President who declines to stand again met an election
// with nobody on it a quarter of the time. The republic stopped its own clock,
// put a blocking modal with an empty ballot in front of them for a full minute,
// and — having nobody to hand the office to — kept them in the chair they had
// just chosen to leave. Ten of forty retirements, every one held over.
//
// Two correct changes met badly. Nominations open once, at age 4: an NPC
// incumbent is entered automatically, a player incumbent deliberately is not
// (standing again is a decision), and then each seat draws a challenger on a
// 0.75 roll. On the Assembly's seven seats that roll is invisible. On a
// single-seat office it is a flat one in four — and with the incumbent
// deliberately absent, one in four means an empty ballot.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function republic(seed) {
  const w = W.newWorld({ nation: `Ballot ${seed}` });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Retiring' });
  const head = R.headOffice(w);
  const seat = w.seats.find((x) => x.office === head.id);
  seat.personaId = w.players.p1.personaId; seat.since = 0;
  w.phase = 'live';
  ACT.apply(w, { type: 'OATH', playerId: 'p1', line: '.' });
  return { w, head, me: seat.personaId };
}

// ---------------------------------------------------------------------------
// A player who retires still gets a ballot with somebody on it
// ---------------------------------------------------------------------------

let empties = 0, heldOver = 0, ran = 0;
for (let seed = 0; seed < 25; seed++) {
  const { w, head, me } = republic(seed);
  let race = null, sawEmpty = false;
  for (let i = 0; i < 3000; i++) {
    S.tick(w);
    const e = S.openElections(w).find((x) => x.office === head.id);
    if (e) {
      race = e;
      // Past the tick nominations open, a ballot with nobody on it is broken.
      if ((e.age || 0) >= 6 && !(e.candidates || []).length) sawEmpty = true;
    }
    if (race && !S.openElections(w).some((x) => x.id === race.id)) break;
  }
  if (!race) continue;
  ran++;
  if (sawEmpty) empties++;
  const now = w.seats.find((x) => x.office === head.id);
  if (sawEmpty && now.personaId === me) heldOver++;
}
ok('every presidential race the player sat out had somebody standing',
  empties === 0, `${empties} of ${ran} ballots were empty`);
ok('and nobody was held in an office they declined to stand for',
  heldOver === 0, `${heldOver} held over`);

// ---------------------------------------------------------------------------
// The guarantee itself, on both shapes of office
// ---------------------------------------------------------------------------

{
  const { w } = republic(99);
  // Let the terms fall due the way they actually do, and take the ballots the
  // republic opens for itself.
  for (const s of w.seats) if (s.termEnds != null) s.termEnds = w.clock.tick + 1;
  let open = [];
  for (let i = 0; i < 40 && !open.length; i++) { S.tick(w); open = S.openElections(w); }
  for (let i = 0; i < 8; i++) S.tick(w);          // past the tick nominations open
  open = S.openElections(w);
  ok('races open when the terms fall due', open.length > 0, `${open.length} open`);

  for (const e of open) {
    const o = R.office(w, e.office);
    const seats = w.seats.filter((s) => s.office === e.office);
    ok(`${o.name}: the ballot is not empty`, (e.candidates || []).length > 0,
      `${(e.candidates || []).length} standing for ${seats.length} seat(s)`);
    ok(`${o.name}: at least one candidate per seat`,
      (e.candidates || []).length >= seats.length,
      `${(e.candidates || []).length} for ${seats.length}`);
    // A seat with a district of its own must have somebody standing in it,
    // rather than the race merely having enough bodies overall.
    const bare = seats.filter((x) => x.district)
      .filter((x) => !(e.candidates || []).some((c) => (c.district ?? null) === x.district));
    ok(`${o.name}: somebody stands in every district`, !bare.length,
      bare.map((x) => w.districts.find((d) => d.id === x.district)?.name).join(', ') || 'all covered');
  }
}

// ---------------------------------------------------------------------------
// And an NPC incumbent is still entered without being asked
// ---------------------------------------------------------------------------

{
  const { w, head } = republic(7);
  // Hand the chair to somebody who is not a player.
  const npc = Object.values(w.personas).find((p) => p.alive && p.synthetic && !p.everPlayer);
  const seat = w.seats.find((x) => x.office === head.id);
  seat.personaId = npc.id; seat.termEnds = w.clock.tick + 1;
  for (let i = 0; i < 10; i++) S.tick(w);
  const e = S.openElections(w).find((x) => x.office === head.id);
  ok('an NPC incumbent stands for re-election as a matter of course',
    !!e && (e.candidates || []).some((c) => c.personaId === npc.id),
    e ? `${(e.candidates || []).length} standing` : 'no race opened');
}

// Refusing a surrender, and what it costs.
//
// A beaten enemy sued and the only answers were a settlement or a shrug. The
// third one — no, fight on, I want the country — has to be a decision with a
// price on it rather than a free button, so this holds both ends: the war
// really does resume against a power that has rallied, and only a war fought to
// the end that way can annex a country outright.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};
/** A war with Canada, won, with the beaten power waiting on terms. */
const beaten = (w, front = 90) => {
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true;
  w.military.wars.push({ id: 'w1', foreign: 'canada', started: 0, front, exhaustion: 0.92, allies: [] });
  // Drive it to the surrender the front earns.
  for (let i = 0; i < 400 && !w.military.wars[0].won; i++) S.tick(w);
  return f;
};

const w = mk();
const me = w.players.p1.personaId;
const f = beaten(w);
const war = w.military.wars[0];
ok('a beaten enemy waits on terms', war.won === true && (w.dictate || []).some((d) => d.foreignId === 'canada'),
  `front ${war.front.toFixed(0)}`);
ok('and the terms it waits on are not total', !(w.dictate || [])[0].total);

// --- Refusing --------------------------------------------------------------
const frontBefore = war.front, exhaustBefore = war.exhaustion, strBefore = f.strength;
const homeBefore = w.military.exhaustion;
const res = A.pressOn(w, me, 'canada');
ok('the surrender can be refused', res.ok === true, res.reason || '');
ok('and the war is a war again', f.atWar === true && war.won === false && war.pressed === 1);
ok('there are no terms outstanding', !(w.dictate || []).length);
ok('the front gives ground back', war.front === frontBefore - A.PRESS_SETBACK,
  `${frontBefore.toFixed(0)} → ${war.front.toFixed(0)}`);
ok('they take heart', war.exhaustion < exhaustBefore && f.strength > strBefore,
  `exhaustion ${exhaustBefore.toFixed(2)} → ${war.exhaustion.toFixed(2)}`);
ok('and mean it', f.hostility === 100);
ok('it costs us at home', w.military.exhaustion > homeBefore,
  `${homeBefore.toFixed(2)} → ${w.military.exhaustion.toFixed(2)}`);
ok('and the record says who did it',
  w.chronicle.some((e) => /refuses .* surrender and orders the army on/.test(e.text)));

// Nobody sues twice.
w.military.wars[0].exhaustion = 0.99;
w.military.wars[0].front = 80;
let sued = false;
for (let i = 0; i < 40; i++) { S.tick(w); if (w.military.wars[0].won && w.military.wars[0].exhaustion < 1) sued = true; }
ok('a refused enemy does not sue again', !sued);

// --- Fought to the end -----------------------------------------------------
const w2 = mk();
const f2 = beaten(w2);
A.pressOn(w2, w2.players.p1.personaId, 'canada');
const war2 = w2.military.wars[0];
war2.front = 95;
for (let i = 0; i < 3000 && !war2.won && !war2.lost; i++) {
  w2.military.exhaustion = Math.min(w2.military.exhaustion, 0.5);  // hold our own nerve steady
  war2.front = Math.max(war2.front, 90);
  S.tick(w2);
}
ok('fought to the end, they are spent outright', war2.won === true && (war2.exhaustion || 0) >= 1,
  `exhaustion ${(war2.exhaustion || 0).toFixed(2)}`);
const pending = (w2.dictate || []).find((d) => d.foreignId === 'canada');
ok('and this capitulation is total', !!pending && pending.total === true);

// A total capitulation is the one settlement that is not capped at a third.
const took = A.dictateTerms(w2, w2.players.p1.personaId, 'canada', { cede: 100, indemnity: 0 });
ok('the whole country can be annexed', took.ok === true && w2.annexed.canada === 100,
  JSON.stringify(w2.annexed));
ok('and it ceases to be a state', f2.absorbed > 0 && !f2.atWar && f2.hostility === 0);
ok('the record says so', w2.chronicle.some((e) => /ceases to exist as a state/.test(e.text)));
ok('it cannot declare war on us', S.warOdds(w2, f2) === 0 && A.declareWar(w2, 'canada').ok === false);

// --- What it is not --------------------------------------------------------
const w3 = mk();
beaten(w3);
ok('an ordinary settlement is still capped at a third',
  A.dictateTerms(w3, w3.players.p1.personaId, 'canada', { cede: 100, indemnity: 0 }).value.cede === A.CESSION_MAX);
ok('and pressing on is not offered once there is nothing left to press for',
  A.pressOn(w3, w3.players.p1.personaId, 'canada').ok === false);

// Only the office that settles a war may refuse one.
const w4 = mk();
beaten(w4);
w4.seats.find((s) => s.office === 'president').personaId = null;
ok('a private citizen cannot refuse a surrender',
  A.pressOn(w4, w4.players.p1.personaId, 'canada').ok === false
  && /office/.test(A.pressOn(w4, w4.players.p1.personaId, 'canada').reason));

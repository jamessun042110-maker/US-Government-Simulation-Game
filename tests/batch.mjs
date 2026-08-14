const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const CT = await import(base + 'court.js');
const C = await import(base + 'chronicle.js');
const D = await import(base + 'director.js');
const ACT = await import(base + 'actions.js');
const U = await import(base + 'util.js');

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  return w;
};
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ' | ' + extra : ''));

// --- 1. non-aggression pact -------------------------------------------------
{
  const w = mk();
  const f = w.foreign.find((x) => x.id === 'canada');
  const h0 = f.hostility;
  A.CLAUSES.TREATY_NONAGGRESSION.apply(w, { party: 'canada', years: 10 });
  ok('pact signed', !!f.pact && S.pactHolds(w, f));
  ok('pact lowers hostility', f.hostility === Math.max(0, h0 - 12), `${h0} -> ${f.hostility}`);
  f.hostility = 100;
  const withPact = S.warOdds(w, f);
  f.pact = null;
  const without = S.warOdds(w, f);
  ok('pact cuts war odds but not to zero', withPact > 0 && withPact < without, `${withPact.toFixed(3)} vs ${without.toFixed(3)}`);

  // Tearing it up to declare war is priced.
  A.CLAUSES.TREATY_NONAGGRESSION.apply(w, { party: 'canada', years: 10 });
  const sab = w.foreign.find((x) => x.id === 'sab');
  const sabH = sab.hostility;
  A.declareWar(w, 'canada');
  ok('own declaration tears up the pact', !w.foreign.find((x) => x.id === 'canada').pact);
  ok('other powers notice', sab.hostility > sabH, `${sabH} -> ${sab.hostility}`);

  // It expires on its own.
  const w2 = mk();
  const e = w2.foreign.find((x) => x.id === 'mexico');
  A.CLAUSES.TREATY_NONAGGRESSION.apply(w2, { party: 'mexico', years: 1 });
  const ends = e.pact.ends;
  w2.clock.tick = ends + 1;
  S.tick(w2);
  ok('pact expires by its terms', !e.pact, 'ended at ' + ends);
}

// --- 2. no self-appointment -------------------------------------------------
{
  const w = mk();
  const pl = Object.values(w.players)[0];
  const pid = pl.personaId;
  const seat = w.seats.find((s) => { const o = w.constitution.offices.find((x) => x.id === s.office); return o?.selection === 'appointment'; });
  const o = w.constitution.offices.find((x) => x.id === seat.office);
  // Seat the player in the appointing office so they genuinely hold the power.
  const appSeat = w.seats.find((s) => s.office === o.appointedBy);
  appSeat.personaId = pid;
  seat.personaId = null;
  w.notices = [];
  ACT.apply(w, { type: 'APPOINT', playerId: pl.id, seatId: seat.id, personaId: pid });
  ok('self-appointment refused', seat.personaId !== pid, (w.notices.at(-1)?.text || '').slice(0, 60));
}

// --- 3. canon time, not ticks ----------------------------------------------
{
  const w = mk();
  ok('span in years/months', /yr|year|month/.test(C.canonSpan(w, 300)), C.canonSpan(w, 300));
  ok('zero reads as now', C.canonSpan(w, 0) === 'now', C.canonSpan(w, 0));
  ok('12-month remainder rolls up', !/12 mo/.test(C.canonSpan(w, w.clock.ticksPerYear * 2 - 1)), C.canonSpan(w, w.clock.ticksPerYear * 2 - 1));
}

// --- 5/11. majority defers the court ---------------------------------------
{
  const w = mk();
  const wide = { id: 'd1', type: 'bill', status: 'law', clauses: [], tally: { yea: 9, nay: 1 }, promulgated: w.clock.tick };
  const bare = { id: 'd2', type: 'bill', status: 'law', clauses: [], tally: { yea: 5, nay: 4 }, promulgated: w.clock.tick };
  const decree = { id: 'd3', type: 'order', status: 'law', clauses: [], promulgated: w.clock.tick };
  ok('wide margin > bare margin', CT.marginOf(wide) > CT.marginOf(bare), `${CT.marginOf(wide).toFixed(2)} vs ${CT.marginOf(bare).toFixed(2)}`);
  ok('a decree has no margin', CT.marginOf(decree) === 0);

  // A non-rights ground: deference applies. (A rights collision must NOT be
  // launderable by a big majority — checked separately below.)
  const grab = [{ kind: 'GRANT_POWER', office: 'president' }];
  const s1 = CT.overreachOf(w, { ...wide, clauses: grab }).score;
  const s2 = CT.overreachOf(w, { ...bare, clauses: grab }).score;
  ok('wide majority lowers the case trigger', s1 < s2, `${s1.toFixed(3)} vs ${s2.toFixed(3)}`);

  const arrest = [{ kind: 'ARREST', target: 'x' }];
  const r1 = CT.overreachOf(w, { ...wide, clauses: arrest });
  const r2 = CT.overreachOf(w, { ...bare, clauses: arrest });
  ok('a majority cannot launder a rights collision', r1.rights && r1.score === r2.score, `${r1.score.toFixed(3)} vs ${r2.score.toFixed(3)}`);

  const m0 = CT.mandateOf(w, wide);
  w.clock.tick += Math.round(w.clock.ticksPerYear * 0.9);
  const m1 = CT.mandateOf(w, wide);
  w.clock.tick += Math.round(w.clock.ticksPerYear * 3);
  const m2 = CT.mandateOf(w, wide);
  ok('mandate starts high', m0 > 0.5, m0.toFixed(3));
  ok('mandate decays', m1 < m0 && m1 > 0, m1.toFixed(3));
  ok('mandate reaches zero', m2 === 0, m2.toFixed(3));
  const w3 = mk();
  const bareWin = CT.mandateOf(w3, bare);
  const wideWin = CT.mandateOf(w3, wide);
  ok('a narrow win buys only a sliver', bareWin > 0 && bareWin < wideWin / 4, `${bareWin.toFixed(3)} vs ${wideWin.toFixed(3)}`);
  ok('an exact tie-breaker buys nothing', CT.mandateOf(w3, { ...bare, tally: { yea: 5, nay: 5 } }) === 0);
}

// --- 6. no "The The" --------------------------------------------------------
{
  ok('article stripped', U.bareNation('The Silver Republic') === 'Silver Republic', U.bareNation('The Silver Republic'));
  ok('no article left alone', U.bareNation('Canada') === 'Canada');
}

// --- 8. time scale ----------------------------------------------------------
{
  const w = mk();
  const pl = Object.values(w.players)[0];
  ACT.apply(w, { type: 'SET_TIMESCALE', playerId: pl.id, scale: 4 });
  ok('solo may set the scale', w.timeScale === 4, String(w.timeScale));
  ACT.apply(w, { type: 'SET_TIMESCALE', playerId: pl.id, scale: 99 });
  ok('scale is clamped at 4x', w.timeScale === 4, String(w.timeScale));
  w.players.p2 = { id: 'p2', name: 'Other', personaId: null, joined: Date.now(), lastSeen: Date.now() };
  w.notices = [];
  ACT.apply(w, { type: 'SET_TIMESCALE', playerId: pl.id, scale: 2 });
  ok('a second player forbids it', w.timeScale === 4, (w.notices.at(-1)?.text || '').slice(0, 50));
}

// --- 9. negotiations actually reduce hostility ------------------------------
{
  const w = mk();
  // A crisis card is answered by the chair — see rules.mayAnswerCrisis — so
  // this has to be the President doing the negotiating, not just any player.
  const me = Object.values(w.players)[0].personaId;
  w.seats.find((s) => s.office === 'president').personaId = me;
  const f = w.foreign.find((x) => x.id === 'canada');
  const before = f.hostility;
  D.fire(w, 'canada');                       // setup adds +18
  const armed = f.hostility;
  const ev = w.events.find((e) => e.id === 'canada');
  const negotiate = D.EVENTS.find((e) => e.id === 'canada').options.findIndex((o) => /negotiat/i.test(o.label));
  const r = D.respond(w, ev.uid, negotiate, me);
  ok('the President may negotiate', r.ok === true, r.reason || '');
  ok('negotiating ends below where it started', f.hostility < before, `${before} -> ${armed} -> ${f.hostility}`);
}

// --- 12. war cannot restart the moment it ends ------------------------------
{
  const w = mk();
  const f = w.foreign.find((x) => x.id === 'canada');
  f.hostility = 100;
  ok('odds are live before any war', S.warOdds(w, f) > 0, S.warOdds(w, f).toFixed(3));
  f.warEndedAt = w.clock.tick;
  ok('no declaration inside the armistice', S.warOdds(w, f) === 0 && S.inArmistice(w, f));
  w.clock.tick += S.ARMISTICE_YEARS * w.clock.ticksPerYear - 1;
  ok('still barred one tick short', S.warOdds(w, f) === 0);
  w.clock.tick += 2;
  ok('free again once it runs out', S.warOdds(w, f) > 0, S.warOdds(w, f).toFixed(3));
  f.atWar = true;
  ok('and never while already at war', S.warOdds(w, f) === 0);
}

// --- 13. the odds themselves are halved -------------------------------------
{
  const w = mk();
  const f = w.foreign.find((x) => x.id === 'mexico');   // plain republic, no temper
  f.hostility = 100; f.allied = false; f.pact = null;
  // base = ((100-30)/70) * 0.3 * 0.25 = 0.075
  ok('max odds are a quarter of the original', Math.abs(S.warOdds(w, f) - 0.075) < 1e-9, S.warOdds(w, f).toFixed(4));
  const sab = w.foreign.find((x) => x.id === 'sab');
  sab.hostility = 100; sab.allied = false; sab.pact = null;
  ok('a trading league is the least warlike', S.warOdds(w, sab) < S.warOdds(w, f) * 0.4,
    `sab ${S.warOdds(w, sab).toFixed(4)} vs republic ${S.warOdds(w, f).toFixed(4)}`);
}

// War's end, reworked: exhaustion accrues half as fast, 100% forces capitulation
// on whichever side is spent, victory lifts the country tempered by what it cost,
// the beaten side carries 30% exhaustion into the peace, and volunteers go home.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const avgMood = (w) => w.districts.reduce((a, d) => a + d.mood, 0) / w.districts.length;
const setupWar = (front = 0) => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  const f = w.foreign.find((x) => x.id === 'goldland') || w.foreign[0];
  f.atWar = true; f.baseStrength = f.strength = 120; f.exhaustion = 0;
  w.military.wars = [{ id: 'w1', foreign: f.id, started: 0, front, exhaustion: 0, allies: [] }];
  return { w, f };
};

// --- #18: exhaustion accrues half as fast ------------------------------------
ok('exhaustion accrues at the halved base rate', S.EXHAUST_BASE === 0.0011, String(S.EXHAUST_BASE));

// --- #17: total exhaustion forces capitulation -------------------------------
{
  const { w, f } = setupWar(0);
  w.military.wars[0].exhaustion = 1; // enemy spent
  S.tick(w);
  ok('an enemy at 100% exhaustion capitulates at once', w.military.wars[0].won === true && !f.atWar);
}
{
  const { w, f } = setupWar(0);
  w.military.exhaustion = 1; // we are spent
  S.tick(w);
  ok('the republic at 100% exhaustion capitulates', w.military.wars[0].lost === true && !f.atWar);
}

// --- #23: the beaten side carries 30% exhaustion into the peace ---------------
{
  const { w, f } = setupWar(0);
  w.military.wars[0].exhaustion = 1;
  S.tick(w);
  ok('a capitulated enemy carries 30% exhaustion out of the war', Math.abs((f.exhaustion || 0) - 0.3) < 1e-9, String(f.exhaustion));
  const e0 = f.exhaustion;
  for (let i = 0; i < 5; i++) { w.elections = []; S.tick(w); }
  ok('and it decays in the peace that follows', f.exhaustion < e0, `${e0.toFixed(3)} → ${f.exhaustion.toFixed(3)}`);
}
{
  const { w } = setupWar(0);
  w.military.exhaustion = 1;
  S.tick(w);
  ok('a defeated republic keeps at least 30% exhaustion', w.military.exhaustion >= 0.3 - 1e-9, String(w.military.exhaustion));
}

// --- #15: victory lifts the country, tempered by exhaustion ------------------
{
  const { w } = setupWar(0);
  w.military.wars[0].exhaustion = 1; w.military.exhaustion = 0.1;
  const clone = JSON.parse(JSON.stringify(w)); // identical rng, only exhaustion differs
  clone.military.exhaustion = 0.9;
  const m0a = avgMood(w), m0b = avgMood(clone);
  S.tick(w); S.tick(clone);
  const gainFresh = avgMood(w) - m0a, gainSpent = avgMood(clone) - m0b;
  ok('winning fresh lifts the country more than winning spent', gainFresh > gainSpent, `${gainFresh.toFixed(2)} vs ${gainSpent.toFixed(2)}`);
}

// --- #20: volunteers are disbanded when the war ends -------------------------
{
  const { w } = setupWar(0);
  w.military.wars[0].exhaustion = 1; w.military.volunteers = 4;
  S.tick(w); // war ends this tick
  w.elections = []; S.tick(w); // first peacetime tick disbands them
  ok('volunteers are stood down once the war is over', (w.military.volunteers || 0) === 0, String(w.military.volunteers));
}

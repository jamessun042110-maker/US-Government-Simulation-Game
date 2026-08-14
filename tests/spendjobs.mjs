// What money buys. The complaint this file exists to answer: $5,000 of
// discretionary spending produced 28 jobs and $99,999 produced 56, because the
// strength term was clamped to a floor of 0.05 and every sum under half a
// million landed identically. Employment now comes out of the money at a
// stated price per post.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => W.newWorld({ nation: 'Testland', founder: 'A B' });
const hired = (text) => {
  if (/^One person finds work/.test(text || '')) return 1;
  const m = /About ([\d,]+) people find work/.exec(text || '');
  return m ? +m[1].replace(/,/g, '') : 0;
};

// --- the headline number scales with the money ------------------------------
{
  const small = A.applySpendingImpact(mk(), 5000, 'public works and jobs');
  const mid = A.applySpendingImpact(mk(), 99999, 'public works and jobs');
  const big = A.applySpendingImpact(mk(), 1e7, 'public works and jobs');
  const huge = A.applySpendingImpact(mk(), 1e8, 'public works and jobs');

  ok('$5,000 hires nobody, and says so', hired(small) === 0 && /hires nobody/.test(small), small);
  ok('$99,999 hires one post', hired(mid) === 1, mid);
  ok('$10M hires 125 — one post per COST_PER_JOB', hired(big) === 125, big);
  ok('$100M hires 1,250', hired(huge) === 1250, huge);
  ok('and the count is strictly monotone in the money',
    hired(small) < hired(mid) && hired(mid) < hired(big) && hired(big) < hired(huge));
}

// The price is the one the republic already pays a construction worker, so the
// two ways of putting a person to work cost the same.
{
  ok('a post costs what a site worker costs', A.COST_PER_JOB === W.CONSTRUCTION_COST_PER_WORKER,
    String(A.COST_PER_JOB));
}

// --- unemployment moves by the headcount, not by a magic fraction -----------
{
  const w = mk();
  const before = w.economy.reliefBoost || 0;
  A.applySpendingImpact(w, 1e7, 'public works and jobs');
  const labor = W.totalPop(w) * 0.48;
  const expected = 125 / labor;
  const got = (w.economy.reliefBoost || 0) - before;
  ok('the relief boost is the headcount over the labour force',
    Math.abs(got - expected) < 1e-9, `${got.toFixed(5)} vs ${expected.toFixed(5)}`);
  ok('and it is a plausible fraction of a point, not a landslide', got > 0 && got < 0.05, got.toFixed(4));
}

// A sum too small to hire anyone must not move unemployment at all.
{
  const w = mk();
  const before = w.economy.reliefBoost || 0;
  const u = w.districts.map((d) => d.unemployment);
  A.applySpendingImpact(w, 5000, 'public works and jobs');
  ok('$5,000 does not move the relief boost', (w.economy.reliefBoost || 0) === before);
  ok('and does not move a single district', w.districts.every((d, i) => d.unemployment === u[i]));
}

// --- the same rule for divisions -------------------------------------------
{
  const w = mk();
  const units = w.military.units;
  const cheap = A.applySpendingImpact(w, 5000, 'the army and its barracks');
  ok('$5,000 does not raise a division', w.military.units === units, cheap);
  ok('and the refusal names the price', /\$6/.test(cheap), cheap);

  A.applySpendingImpact(w, DEP.DIVISION_COST * 3, 'the army and its barracks');
  ok('three divisions\' worth raises three', w.military.units === units + 3, String(w.military.units));
}

// --- the floor is gone ------------------------------------------------------
// Untargeted money used to lift the national mood by the same amount whether it
// was a dollar or half a million.
{
  const a = mk(); const b = mk();
  const m = (w) => w.districts.reduce((t, d) => t + d.mood, 0);
  const a0 = m(a); const b0 = m(b);
  A.applySpendingImpact(a, 1000, 'general fund');
  A.applySpendingImpact(b, 400000, 'general fund');
  ok('a dollar and a fortune no longer buy the same mood',
    Math.abs(m(a) - a0) < Math.abs(m(b) - b0), `${(m(a) - a0).toFixed(4)} vs ${(m(b) - b0).toFixed(4)}`);
}

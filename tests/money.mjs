const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  w.economy.treasury = 500e6;      // plenty, so the gate is never the reason
  // Open the purse completely: this probe is about what spending DOES, not
  // about who may authorise it.
  w.constitution.spending = [{ above: 0, requires: null }];
  w.constitution.discretion = { cap: 1e12, years: 1 };
  return { w, pid };
};

const snap = (w) => ({
  approval: +S.nationalApproval(w).toFixed(2),
  mood: +(w.districts.reduce((a, d) => a + d.mood, 0) / w.districts.length).toFixed(2),
  unemp: +(w.economy.unemployment * 100).toFixed(2),
  homeless: w.districts.reduce((a, d) => a + d.homeless, 0),
  order: +(w.districts.reduce((a, d) => a + d.order, 0) / w.districts.length).toFixed(1),
});

const run = (purpose, amount, settle) => {
  const { w, pid } = mk();
  for (let i = 0; i < 30; i++) S.tick(w);       // let the world settle first
  const before = snap(w);
  const res = A.disburse(w, pid, amount, purpose);
  const right = snap(w);
  for (let i = 0; i < settle; i++) S.tick(w);
  const after = snap(w);
  const d = (k) => +(after[k] - before[k]).toFixed(2);
  console.log(
    (purpose || '(blank)').padEnd(26),
    res.ok ? '' : 'REFUSED: ' + res.reason.slice(0, 40),
    '| immediate mood', (+(right.mood - before.mood)).toFixed(2).padStart(6),
    '| after', String(settle).padStart(3), 'ticks:',
    'approval', String(d('approval')).padStart(6),
    'mood', String(d('mood')).padStart(6),
    'unemp', String(d('unemp')).padStart(6),
    'homeless', String(d('homeless')).padStart(6),
    'order', String(d('order')).padStart(6));
};

console.log('=== $50M, measured 120 ticks (half a canon year) later ===');
for (const p of ['', 'general purposes', 'housing the homeless', 'jobs and public works',
  'policing', 'schools and hospitals', 'roads and sewers', 'relief for the unemployed',
  'the army', 'a parade']) run(p, 50e6, 120);

console.log('');
console.log('=== the same money, measured 5 ticks later (what a player sees at once) ===');
for (const p of ['', 'general purposes', 'housing the homeless']) run(p, 50e6, 5);

console.log('');
console.log('=== does spending change the treasury-linked drivers at all? ===');
{
  const { w, pid } = mk();
  for (let i = 0; i < 30; i++) S.tick(w);
  const t0 = w.economy.treasury, a0 = S.nationalApproval(w);
  A.disburse(w, pid, 300e6, 'general purposes');
  for (let i = 0; i < 120; i++) S.tick(w);
  console.log('treasury', Math.round(t0 / 1e6) + 'M ->', Math.round(w.economy.treasury / 1e6) + 'M',
    '| approval', a0.toFixed(2), '->', S.nationalApproval(w).toFixed(2));
  console.log('drivers:', JSON.stringify(S.approvalDrivers(w)).slice(0, 400));
}

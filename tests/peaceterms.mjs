// A peace settles land and money — negotiated at the table, or dictated to a
// beaten enemy. Territory is not redrawn (the map is procedural, with no
// ownership model behind it); a cession moves what a territory *is* to the
// simulation — the strength it fields and the wealth it holds — permanently,
// and the Chronicle records the share. See acts.applyPeaceTerms.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};
const goToWar = (w) => {
  const f = w.foreign[0];
  f.atWar = true; f.baseStrength = f.strength = 120; f.exhaustion = 0;
  w.military.wars.push({ id: 'w1', foreign: f.id, started: 0, front: 0, exhaustion: 0, allies: [] });
  return f;
};

// --- the instrument says what it settles ---------------------------------------
{
  const w = mk();
  const f = w.foreign[0];
  const text = A.CLAUSES.TREATY_PEACE.text(w, { party: f.id, cede: 10, indemnity: 5e6 });
  ok('the treaty names a cession', /cede 10% of its territory/.test(text), text.slice(-160));
  ok('and names an indemnity', /indemnity of \$5,000,000/.test(text));
  const bare = A.CLAUSES.TREATY_PEACE.text(w, { party: f.id });
  ok('a peace with no terms says nothing extra', !/save that/.test(bare), bare.slice(-80));
  const ours = A.CLAUSES.TREATY_PEACE.text(w, { party: f.id, cede: -5, indemnity: -2e6 });
  ok('and a peace we lost reads the other way',
    /Testland shall cede 5%/.test(ours) && /Testland shall pay an indemnity/.test(ours), ours.slice(-180));
}

// --- a negotiated peace moves the land and the money ---------------------------
{
  const w = mk();
  const f = goToWar(w);
  const money = w.economy.treasury;
  const theirStrength = f.strength;
  A.CLAUSES.TREATY_PEACE.apply(w, { party: f.id, cede: 10, indemnity: 5e6 });
  ok('the war ends', !f.atWar);
  ok('the indemnity is paid to us', w.economy.treasury > money + 5e6 - 1, `${money} → ${w.economy.treasury}`);
  ok('the ceding power is weaker for it', f.strength < theirStrength, `${theirStrength} → ${f.strength.toFixed(1)}`);
  ok('and its base is permanently smaller', f.baseStrength < 120, f.baseStrength.toFixed(1));
  ok('the cession is on the record', (w.annexed || {})[f.id] === 10, JSON.stringify(w.annexed));
}
{
  // Ceding our own: the treasury pays and the country feels it.
  const w = mk();
  const f = goToWar(w);
  const mood = w.districts.reduce((a, d) => a + d.mood, 0) / w.districts.length;
  const theirStrength = f.strength;
  A.CLAUSES.TREATY_PEACE.apply(w, { party: f.id, cede: -8, indemnity: -3e6 });
  ok('a power we cede to grows stronger', f.strength > theirStrength, `${theirStrength} → ${f.strength.toFixed(1)}`);
  const after = w.districts.reduce((a, d) => a + d.mood, 0) / w.districts.length;
  ok('and the country takes it badly', after < mood, `${mood.toFixed(2)} → ${after.toFixed(2)}`);
}

// --- dictating to a beaten enemy ----------------------------------------------
{
  const w = mk();
  const pid = w.players.p1.personaId;
  const f = goToWar(w);
  w.military.wars[0].exhaustion = 1;    // they are spent; they capitulate this tick
  S.tick(w);
  ok('the enemy surrenders', !f.atWar && w.military.wars[0].won === true);
  ok('and waits on terms', (w.dictate || []).some((d) => d.foreignId === f.id), JSON.stringify(w.dictate));

  const money = w.economy.treasury;
  const res = A.dictateTerms(w, pid, f.id, { cede: 12, indemnity: 8e6 });
  ok('the victor may dictate', res.ok, res.reason || '');
  ok('the indemnity lands', w.economy.treasury > money + 8e6 - 1);
  ok('the territory is taken', (w.annexed || {})[f.id] === 12, JSON.stringify(w.annexed));
  ok('and it is remembered against us', f.hostility > 0, String(Math.round(f.hostility)));
  ok('the offer is spent once used', !(w.dictate || []).some((d) => d.foreignId === f.id));
  const again = A.dictateTerms(w, pid, f.id, { cede: 5 });
  ok('and cannot be dictated twice', again.ok === false, again.reason);
}
{
  // Nothing to dictate to a power that never surrendered.
  const w = mk();
  const r = A.dictateTerms(w, w.players.p1.personaId, w.foreign[0].id, { cede: 5 });
  ok('there is nothing to dictate in peacetime', r.ok === false, r.reason);
}
{
  // The window is the leverage: let it lapse and the peace is the one the guns left.
  const w = mk();
  const pid = w.players.p1.personaId;
  const f = goToWar(w);
  w.military.wars[0].exhaustion = 1;
  S.tick(w);
  for (let i = 0; i < A.DICTATE_TICKS + 2; i++) { w.elections = []; S.tick(w); }
  ok('the moment passes', !(w.dictate || []).some((d) => d.foreignId === f.id));
  const late = A.dictateTerms(w, pid, f.id, { cede: 5 });
  ok('and terms cannot be dictated after it', late.ok === false, late.reason);
}
{
  // A victor does not hand the loser their own land.
  const w = mk();
  const pid = w.players.p1.personaId;
  const f = goToWar(w);
  w.military.wars[0].exhaustion = 1;
  S.tick(w);
  const r = A.dictateTerms(w, pid, f.id, { cede: -10, indemnity: -5e6 });
  ok('terms dictated only run one way', r.ok === false, r.reason);
}

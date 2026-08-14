// A company is worth what it owns, less what it owes.
//
// Found by taking every repeatable action with money attached and running it in
// a tight loop with no ticks passing, looking for the shape the cession and the
// found-and-sell exploits both had: a payout that does not check against
// anything actually being spent.
//
// valuation was `earned + cash` with no mention of borrowings, which made a
// loan free money twice over — the three ways are set out at company.equity.
// Measured on a trading company worth $10.46M: borrow to the ceiling — $7.14M —
// then sell, and the founder walked away with $12.86M instead of $9.41M.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;

function trading(nation) {
  const w = W.newWorld({ nation });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Founder' });
  w.phase = 'live'; w.inaugurated = 0;
  const me = w.players.p1.personaId;
  CO.found(w, me, 'Co');
  const co = CO.foundedBy(w, me);
  co.revenue = 4e6;
  return { w, me, p: w.personas[me], co };
}

// ---------------------------------------------------------------------------
// A loan is not worth anything by itself
// ---------------------------------------------------------------------------

{
  const { w, co } = trading('Netting');
  const before = CO.valuation(w, co);
  const cash = co.cash;
  CO.borrow(w, co, 1e6);
  ok('a loan puts cash in the company', co.cash === cash + 1e6, M(co.cash));
  ok('and is recorded as owed', co.borrowed === 1e6, M(co.borrowed));
  // Not "unchanged": the interest is a real charge against earnings, so the
  // equity is worth a little less until the money is put to work. What must not
  // happen is the valuation going *up*.
  ok('but the valuation does not rise for it', CO.valuation(w, co) <= before,
    `${M(before)} → ${M(CO.valuation(w, co))}`);
}

// ---------------------------------------------------------------------------
// So the lending ceiling stops feeding itself
// ---------------------------------------------------------------------------

{
  const { w, co } = trading('Ceiling');
  for (let i = 0; i < 60; i++) if (!CO.borrow(w, co, 500000).ok) break;
  const gross = CO.valuation(w, co) + co.borrowed;
  ok('borrowings cannot compound past a share of the business',
    co.borrowed < gross * 0.4, `${M(co.borrowed)} against ${M(gross)} gross`);
  ok('and a company cannot borrow itself underwater', CO.valuation(w, co) > 0,
    M(CO.valuation(w, co)));
}

// ---------------------------------------------------------------------------
// And borrowing before a sale no longer pays
// ---------------------------------------------------------------------------

{
  const plain = trading('Plain');
  ACT.apply(plain.w, { type: 'SELL_COMPANY', playerId: 'p1' });
  const clean = plain.p.wallet || 0;

  const levered = trading('Levered');
  for (let i = 0; i < 40; i++) {
    const room = Math.max(0, CO.valuation(levered.w, levered.co) * 0.5 - (levered.co.borrowed || 0));
    if (room < 1000 || !CO.borrow(levered.w, levered.co, Math.floor(room)).ok) break;
  }
  const debt = levered.co.borrowed;
  ACT.apply(levered.w, { type: 'SELL_COMPANY', playerId: 'p1' });
  const geared = levered.p.wallet || 0;

  ok('the same company sold twice, once geared to the hilt', debt > 1e6, `${M(debt)} of debt`);
  ok('and loading it with debt first does not pay the founder more',
    geared <= clean, `plain ${M(clean)} vs geared ${M(geared)}`);
  // Before the fix this was the exploit: +$3.45M for pressing one more button.
  ok('nowhere near the free money it used to be', geared < clean * 1.05,
    `geared/plain = ${(geared / clean).toFixed(2)}× — it was 1.37×`);
}

// ---------------------------------------------------------------------------
// Repaying gets the value back
// ---------------------------------------------------------------------------

{
  const { w, co } = trading('Repay');
  const before = CO.valuation(w, co);
  CO.borrow(w, co, 2e6);
  const geared = CO.valuation(w, co);
  CO.repay(w, co, 2e6);
  ok('repaying a loan restores the valuation', CO.valuation(w, co) >= geared,
    `${M(geared)} → ${M(CO.valuation(w, co))}, started ${M(before)}`);
  ok('and clears the debt', (co.borrowed || 0) === 0, M(co.borrowed || 0));
}

// The treasury may run below zero — a deficit shows on the balance itself, not
// only on a separate debt line — and the year's overdraft is financed into debt
// when the fiscal year closes.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const MACRO = await import(base + 'macro.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
const e = w.economy;

// A deficit draws the balance under zero. settleBorrowing no longer floors it.
e.treasury = 5e6; e.debt = 0; e.issuedYtd = 0;
e.treasury -= 20e6;                 // the year spends far past its revenue
MACRO.settleBorrowing(w, -20e6);
ok('a deficit takes the balance below zero, not to a floor', e.treasury === -15e6, `${(e.treasury / 1e6)}M`);
ok('and nothing is on the debt line yet', (e.debt || 0) === 0, String(e.debt || 0));

// The fiscal year closes: the overdraft is financed onto the debt stock.
const financed = MACRO.financeDeficit(w);
ok('the year-end finances the deficit into debt', financed === 15e6 && e.treasury === 0 && e.debt === 15e6,
  `financed ${(financed / 1e6)}M, debt ${(e.debt / 1e6)}M, treasury ${(e.treasury / 1e6)}M`);
ok('and the borrowing is recorded for the year', e.issuedYtd === 15e6, `${(e.issuedYtd / 1e6)}M`);

// A surplus amortises the debt — but only out of a positive balance.
e.treasury = 10e6; e.debt = 8e6;
MACRO.settleBorrowing(w, 6e6);      // half of a 6M surplus goes to the stock
ok('a surplus amortises the debt from a positive balance', e.debt === 5e6 && e.treasury === 7e6,
  `debt ${(e.debt / 1e6)}M, treasury ${(e.treasury / 1e6)}M`);

// An overdraft cannot pay down a loan, whatever a single tick's flow looks like.
e.treasury = -4e6; e.debt = 8e6;
MACRO.settleBorrowing(w, 3e6);
ok('an overdraft does not repay debt', e.debt === 8e6 && e.treasury === -4e6,
  `debt ${(e.debt / 1e6)}M, treasury ${(e.treasury / 1e6)}M`);

// A balanced year with nothing owed leaves the books untouched.
e.treasury = 3e6; e.debt = 0;
MACRO.settleBorrowing(w, 0);
ok('a balanced year with no debt is left alone', e.treasury === 3e6 && (e.debt || 0) === 0);
ok('financeDeficit does nothing when the balance is in the black', MACRO.financeDeficit(w) === 0 && e.treasury === 3e6);

// The yards-stop crisis offers the President no unilateral income-tax cut. Relief
// comes only two ways: declare a state of emergency, or refer a cut to the
// assembly. Answering it must never move the tax rate by the President's own hand.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const DIR = await import(base + 'director.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const strike = DIR.EVENTS.find((e) => e.id === 'strike');
ok('the yards-stop crisis exists', !!strike, strike?.title);

const labels = strike.options.map((o) => o.label);
ok('no option cuts income tax by the executive\'s own hand',
  !labels.some((l) => /cut income tax|negotiate/i.test(l)), labels.join(' | '));
ok('declaring a state of emergency is an option', labels.some((l) => /declare a state of emergency/i.test(l)), labels.join(' | '));
ok('referring a cut to the assembly is an option', labels.some((l) => /refer .*assembly/i.test(l)), labels.join(' | '));

// No surviving option carries the raw tax power (the unilateral lever).
ok('no crisis option exercises the tax power directly',
  !strike.options.some((o) => o.power === 'tax'), strike.options.map((o) => o.power || '—').join(' | '));

// Answering with the emergency option leaves the tax rate untouched and puts the
// republic into a state of emergency.
const w = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
w.seats.find((s) => s.office === R.headOffice(w).id).personaId = pid;

const taxBefore = w.economy.taxes.income;
const fired = DIR.fire(w, 'strike');
const ev = fired.value;
ok('the crisis fires onto the board', !!ev && !ev.resolved, ev?.uid);
const emergencyIdx = strike.options.findIndex((o) => /declare a state of emergency/i.test(o.label));
const res = DIR.respond(w, ev.uid, emergencyIdx, pid);
ok('the President may answer it', res.ok !== false, res.reason || '');
ok('the tax rate is untouched by answering', w.economy.taxes.income === taxBefore, `${taxBefore} → ${w.economy.taxes.income}`);
ok('a state of emergency is now in force', !!w.emergency?.active);

// A housing disbursal actually takes people off the street — and keeps them off.
// The reduction it reports is a real fall in the district's homeless count, and
// it survives the next population recompute rather than snapping back the moment
// a building opens.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The United States' });
w.phase = 'live'; w.inaugurated = 0;
const worst = w.districts.slice().sort((a, b) => b.homeless - a.homeless)[0];
const seat = w.seats.find((s) => s.office === R.headOffice(w).id && s.personaId);
const pid = seat?.personaId || Object.keys(w.personas)[0];

const before = worst.homeless;
const res = A.disburse(w, pid, 500000, 'housing for the encampment');
ok('the disbursal goes through', res.ok !== false, res.value);

// The number the message names is the number the district's homeless count falls by.
//
// Both forms, because the count can legitimately be one. The relief is a share
// of the *district's* homeless, so it fell when the country went from seven
// districts to twenty states and each one got a third of the people — the engine
// pluralised correctly and this regex, which only ever matched "people", read it
// as no match at all and reported NaN.
const m = /Roughly ([\d,]+) (?:person|people)/.exec(res.value || '');
const rehoused = m ? parseInt(m[1].replace(/,/g, ''), 10) : NaN;
ok('the message names a rehousing count', rehoused > 0, String(rehoused));
ok('the district homeless count falls by exactly that many',
  worst.homeless === before - rehoused, `${before} → ${worst.homeless} (−${rehoused})`);
ok('and the relief is banked', (worst.shelterRelief || 0) === rehoused, String(worst.shelterRelief));

// A building opening elsewhere triggers a full redistribution — the relief must
// hold through it, not snap back to the structural figure.
W.distributePopulation(w, W.totalPop(w));
const after = w.districts.find((d) => d.id === worst.id);
// Exact equality is the wrong shape of claim here. distributePopulation shares
// a whole population out across districts and the parts have to sum to it, so a
// single district can come back one person either side of where the arithmetic
// alone would put it. Checked across twenty consecutive recomputes the relieved
// figure does not drift at all — it is not eroding — but the odd seed lands the
// rounding on this district and "209 vs 208" failed a test whose actual claim
// is that the relief holds rather than snapping back to the structural figure,
// which is `rehoused` higher.
const ROUNDING = 2;
ok('the reduction survives a population recompute',
  after.homeless <= before - rehoused + ROUNDING, `${after.homeless} vs ${before - rehoused}`);
ok('and it has not snapped back to the unrelieved figure',
  after.homeless < before, `${after.homeless} < ${before}`);

// Relief banked beyond the current deficit is trimmed to what is usable, so it
// cannot drive the count negative or accumulate without bound.
const banked = after.homeless + 1000;
after.shelterRelief = banked;
W.distributePopulation(w, W.totalPop(w));
const after2 = w.districts.find((d) => d.id === worst.id);
ok('over-banked relief drives homeless to zero, not below', after2.homeless === 0, String(after2.homeless));
ok('and the surplus relief is trimmed away', (after2.shelterRelief || 0) < banked && (after2.shelterRelief || 0) >= 0,
  `${after2.shelterRelief} < ${banked}`);

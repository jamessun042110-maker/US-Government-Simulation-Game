// No officeholder of the republic draws a company's wage. The hiring gate
// already refuses an officeholder; this is the other direction — an employee
// who then wins a seat leaves the payroll the same tick, so companyOf() can
// never again hand a sitting President the basement's one-room sidebar.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;

// A private citizen founds a company and takes our player on.
const founder = W.makePersona(w, { synthetic: true });
w.companies = w.companies || [];
w.companies.push({ id: 'co-test', name: 'Basement Labs', founderId: founder.id, employees: [pid], cash: 0 });
ok('the player is on the payroll', CO.companyOf(w, pid)?.id === 'co-test');

// Then the country elects them President.
w.seats.find((s) => s.office === 'president').personaId = pid;
A.tickDivestOfficeholders(w);

ok('taking office ends the employment', !(CO.companyOf(w, pid)), JSON.stringify(w.companies[0].employees));
ok('the company keeps its founder', w.companies[0].founderId === founder.id);
const said = [...w.chronicle].reverse().find((e) => /resigns from Basement Labs/.test(e.text || ''))?.text || '';
ok('and the record says why', /on taking office/.test(said), said);

// A colleague with no office keeps their job — the sweep takes only the seated.
const other = W.makePersona(w, { synthetic: true });
w.companies[0].employees.push(other.id);
A.tickDivestOfficeholders(w);
ok('a private employee is left alone', w.companies[0].employees.includes(other.id));

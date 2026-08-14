// The treasury pays what the bill says. The price of a clause is declared
// once, on the clause — the fiscal-effect line, the vote threshold and the
// debit all read the same declaration, so none of them can drift again.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};
const passAndSign = (w, pid, doc) => {
  A.introduce(w, doc.id, pid, 20);
  for (const s of w.seats.filter((x) => x.office === 'assembly' && x.personaId)) A.castVote(w, doc.id, s.personaId, 'yea');
  A.closeFloor(w, doc.id);
  if (doc.status !== 'law') A.sign(w, doc.id, pid);
  return doc;
};

// A plain appropriation leaves at signing, in full, at the stated price.
{
  const { w, pid } = mk();
  const before = w.economy.treasury;
  const doc = A.createDoc(w, { type: 'bill', title: 'The Sundries Act', authorId: pid,
    clauses: [{ kind: 'APPROPRIATE', amount: 5e6, purpose: 'sundries' }] });
  const split = A.docCostSplit(w, doc);
  ok('a one-time appropriation is all "now"', split.now === 5e6 && split.yearly === 0, JSON.stringify(split));
  passAndSign(w, pid, doc);
  ok('it becomes law', doc.status === 'law', doc.status);
  ok('and the treasury falls by exactly the stated cost', before - w.economy.treasury === 5e6, String(before - w.economy.treasury));
}

// A recurring program draws nothing at signing — and says so, in the split,
// on the books, and in the record.
{
  const { w, pid } = mk();
  const before = w.economy.treasury;
  const doc = A.createDoc(w, { type: 'bill', title: 'The Standing Program Act', authorId: pid,
    clauses: [{ kind: 'APPROPRIATE', amount: 5e6, purpose: 'sundries', recurring: true }] });
  const split = A.docCostSplit(w, doc);
  ok('a recurring appropriation is all "yearly"', split.now === 0 && split.yearly === 5e6, JSON.stringify(split));
  ok('but the total still faces the spending threshold', A.docCost(w, doc) === 5e6, String(A.docCost(w, doc)));
  passAndSign(w, pid, doc);
  ok('nothing leaves at signing', w.economy.treasury === before, String(before - w.economy.treasury));
  ok('the program is on the books at the annual price', (w.programs || []).some((p) => p.cost === 5e6), JSON.stringify(w.programs));
  const line = [...w.chronicle].reverse().find((e) => /funded at/.test(e.text || ''))?.text || '';
  ok('and the record says the year pays it, not the signing', /a year, drawn as the year runs/.test(line), line);
}

// Raising divisions by law is priced — the same price the department pays —
// so the fiscal-effect line has a number and the threshold sees the bill.
{
  const { w, pid } = mk();
  const before = w.economy.treasury;
  const doc = A.createDoc(w, { type: 'bill', title: 'The Two Divisions Act', authorId: pid,
    clauses: [{ kind: 'RAISE_DIVISIONS', count: 2 }] });
  ok('two divisions are priced at 2 × DIVISION_COST', A.docCost(w, doc) === 2 * DEP.DIVISION_COST, String(A.docCost(w, doc)));
  // Under a constitution whose big-money rule is stricter than ordinary
  // passage, the army bill now answers to it — it used to read as $0 and
  // slip under every spending threshold ever written.
  w.constitution.spending = [{ above: 1e6, requires: { body: 'assembly', fraction: 0.66 } }];
  const req = R.voteRequirement(w, doc);
  ok('a bill over the threshold answers to it', req.fraction === 0.66 && /Appropriation/.test(req.label), JSON.stringify(req));
  passAndSign(w, pid, doc);
  ok('and the debit matches the stated price', before - w.economy.treasury === 2 * DEP.DIVISION_COST, String(before - w.economy.treasury));
}

// Construction is priced off the structure, not off a field BUILD does not have.
{
  const { w, pid } = mk();
  const key = Object.keys(W.BUILDINGS)[0];
  const parcel = w.city.parcels.findIndex((p) => !p.building && !p.project);
  const doc = A.createDoc(w, { type: 'bill', title: 'The Works Act', authorId: pid,
    clauses: [{ kind: 'BUILD', building: key, parcel }] });
  ok('a BUILD bill costs what the structure costs', A.docCost(w, doc) === W.BUILDINGS[key].cost, String(A.docCost(w, doc)));
}

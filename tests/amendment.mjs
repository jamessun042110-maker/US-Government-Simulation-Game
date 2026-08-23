// Amending the constitution is harder than passing a bill. On top of the higher
// fraction an amendment must clear, each member weighs it more warily — so the
// same content carried as an amendment draws fewer ayes than as an ordinary bill.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic' });
const author = W.makePersona(w, { synthetic: true, party: 'democrat' });
author.approval = 50; author.age = 45; author.born = w.clock.tick;

// One fixed chamber, read twice — the only difference is the document's type.
const members = [];
for (let i = 0; i < 400; i++) {
  const m = W.makePersona(w, { synthetic: true, party: i % 2 ? 'democrat' : 'republican' });
  m.approval = 50; members.push(m);
}

// Identical content — a right written into law versus into the constitution.
const clauses = [{ kind: 'RIGHT', text: 'A right to counsel.' }];
const asBill = { id: 'doc_same', type: 'bill', authorId: author.id, preamble: '', clauses };
const asAmend = { id: 'doc_same', type: 'amendment', authorId: author.id, preamble: '', clauses };

const carry = (doc) => members.filter((m) => S.syntheticBallot(w, m, doc) === 'yea').length;
const billYea = carry(asBill);
const amendYea = carry(asAmend);

ok('the bill draws support', billYea > 0, String(billYea));
ok('the amendment draws no more than the bill', amendYea <= billYea, `${amendYea} vs ${billYea}`);
ok('and strictly fewer — a constitution is meant to resist change',
  amendYea < billYea, `amendment ${amendYea} vs bill ${billYea}`);

// The gap is real but not absolute: a wanted amendment still passes a willing
// chamber. It should not zero out support that a bill would have carried easily.
ok('the amendment still commands a chamber that wants it',
  amendYea > billYea * 0.4, `${amendYea} vs ${billYea}`);

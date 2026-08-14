// A founder in the basement is not doing anything else.
//
// Two guarantees: the sidebar hides everything but the company (and the meta
// Season control), and the chamber does not take a basement operation's money.
class N {
  constructor(t) { this.tag = t; this.children = []; this.attrs = {}; this.style = { setProperty(){}, removeProperty(){}, getPropertyValue: () => '' }; this.handlers = {}; this.dataset = {}; this._text = ''; }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ''; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this._text = String(v); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { this.handlers[k] = fn; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { for (const c of cs.flat(3)) if (c != null && c !== false) this.appendChild(typeof c === 'object' ? c : Object.assign(new N('#t'), { _text: String(c) })); }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  get classList() { return { add() {}, remove() {}, toggle() {}, contains: () => false }; }
}
globalThis.document = {
  createElement: (t) => new N(t), createElementNS: (ns, t) => new N(t),
  createTextNode: (t) => Object.assign(new N('#t'), { _text: String(t) }),
  body: new N('body'), documentElement: new N('html'),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '' } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const UI = await import(base + 'ui.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function mount(w) {
  const sent = [];
  UI.mount({
    world: w, playerId: 'p1', net: { isHost: true },
    dispatch: (a) => { sent.push(a); ACT.apply(w, { ...a, playerId: 'p1' }); },
    rerender: () => {},
  });
  return sent;
}

const walk = function* (n) { yield n; for (const c of n.children) yield* walk(c); };
const textOf = (r) => [...walk(r)].map((n) => n._text).join(' ');

function fresh() {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w.phase = 'live'; w.inaugurated = 0;
  return { w, pid: w.players.p1.personaId };
}

// --- the sidebar collapses to one room -----------------------------------------
{
  const { w, pid } = fresh();
  mount(w);
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  ok('the company is in the basement', CO.stageOf(co.valuation || 0).id === 'garage');

  const nav = new N('div');
  UI.renderNav(nav);
  const buttons = [...walk(nav)].filter((n) => n.tag === 'button' && n.attrs['data-tab']);
  const tabs = buttons.map((b) => b.attrs['data-tab']);
  ok('nothing but the basement and season is on the sidebar', tabs.every((t) => t === 'company' || t === 'season'), tabs.join(','));
  ok('the basement is there', tabs.includes('company'));
  ok('season stays reachable for meta control', tabs.includes('season'));

  // Growing out of the basement gives the sidebar back.
  co.valuation = 8e6;                     // office stage
  const nav2 = new N('div');
  UI.renderNav(nav2);
  const tabs2 = [...walk(nav2)].filter((n) => n.tag === 'button' && n.attrs['data-tab'])
    .map((b) => b.attrs['data-tab']);
  ok('the sidebar comes back at the office', tabs2.length > 2 && tabs2.includes('nation'), tabs2.join(','));
}

// --- and lobbying is refused ---------------------------------------------------
{
  const { w, pid } = fresh();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  // Same pattern as tests/company.mjs: seat the founder as President *after*
  // founding, so mayPropose passes and the bill can reach the floor. Lobbying
  // is not gated on the founder's office (holding one blocks *founding*, not
  // *lobbying*), only on the company's stage — which is the point of the test.
  w.seats.find((s) => s.office === 'president').personaId = pid;
  co.cash = 5e6;

  const doc = A.createDoc(w, {
    type: 'bill', title: 'Sunline Relief Act', authorId: pid,
    clauses: [{ kind: 'PROSE', text: '.' }],
  });
  A.introduce(w, doc.id, pid, 60);
  const member = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;

  const res = CO.lobby(w, co, member, doc.id, 1e6);
  ok('a basement operation is refused', res.ok === false, res.reason || '');
  ok('with a reason that says why', /basement/i.test(res.reason || ''), res.reason || '');

  // Grow past the basement and try again.
  co.valuation = 8e6;
  const res2 = CO.lobby(w, co, member, doc.id, 1e6);
  ok('and the door opens at the office', res2.ok === true, res2.reason || '');
}

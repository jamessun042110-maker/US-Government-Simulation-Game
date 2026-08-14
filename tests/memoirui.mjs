// Can a player actually reach the memoir?
//
// The engine, the action and tests/memoir.mjs all passed for a whole session
// while nothing in the interface called MEMOIR — a finished feature nobody
// could get to, which no engine test can catch. So this one renders the Press
// view through ui.js itself, under a DOM shim thin enough to run in Node, and
// clicks the button.
//
// The shim is deliberately minimal: `el` in util.js is the only thing that
// builds nodes, so it needs createElement/createTextNode, className, style,
// setAttribute, addEventListener and appendChild, and nothing else. If ui.js
// grows a real DOM dependency this file will say so loudly rather than quietly
// stop testing anything — run-all.sh now fails a file that crashes.

class N {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {};
    // renderView paints the Season's colours onto the root as custom
    // properties, so style has to answer setProperty as well as be assignable.
    this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
    this.handlers = {}; this.dataset = {}; this._text = '';
  }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ''; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this._text = String(v); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { this.handlers[k] = fn; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) {
    for (const c of cs.flat(3)) {
      if (c == null || c === false) continue;
      this.appendChild(typeof c === 'object' ? c : Object.assign(new N('#text'), { _text: String(c) }));
    }
  }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get classList() { return { add() {}, remove() {}, toggle() {}, contains: () => false }; }
}
const mkNode = (t) => new N(t);
globalThis.document = {
  createElement: mkNode, createElementNS: (ns, t) => mkNode(t),
  createTextNode: (t) => Object.assign(new N('#text'), { _text: String(t) }),
  body: new N('body'), documentElement: new N('html'),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.window = {
  addEventListener() {}, location: { search: '' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const M = await import(base + 'media.js');
const ACT = await import(base + 'actions.js');
const UI = await import(base + 'ui.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// Walk the rendered tree. Nothing here knows about the card's markup — it looks
// for text and for a handler, so restyling the card does not break the test.
const walk = function* (n) { yield n; for (const c of n.children) yield* walk(c); };
const textOf = (root) => [...walk(root)].map((n) => n._text).join(' ');
const buttons = (root, label) => [...walk(root)]
  .filter((n) => n.tag === 'button' && n.handlers.click && n.textContent.includes(label));
const ranges = (root) => [...walk(root)].filter((n) => n.attrs.type === 'range');
const inputs = (root) => [...walk(root)].filter((n) => n.tag === 'input' && n.handlers.input);

// A president who served and left — the only person a memoir is open to.
function served(name = 'Ann Marchetti') {
  const w = W.newWorld({ nation: 'Testland', founder: name });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;
  for (let i = 0; i < 200; i++) S.tick(w);
  w.clock.tick = 4 * w.clock.ticksPerYear;
  A.vacate(w, seat, 'term ended');
  return { w, pid, seat };
}

// Render the Press view for p1 and hand back the root. The memoir card lives on
// the Press tab now — a former president looking to write one goes to the press,
// not to the Offices roster — so that is the view this test drives.
function press(w) {
  const sent = [];
  UI.mount({
    world: w, playerId: 'p1', net: { isHost: true },
    dispatch: (a) => { sent.push(a); ACT.apply(w, { ...a, playerId: 'p1' }); },
    rerender: () => {},
  });
  UI.S.view = 'press';
  const root = new N('div');
  UI.renderView(root);
  return { root, sent };
}

// --- a former president is offered one ------------------------------------------
{
  const { w } = served();
  const { root } = press(w);
  const txt = textOf(root);
  ok('the Press page offers the memoir', /Your own account of it/.test(txt),
    (txt.match(/Your own account of it/) || ['missing'])[0]);
  ok('and states the price in press articles', /of one press article/.test(txt),
    (txt.match(/worth about [\d.]+ of one press article/) || ['missing'])[0]);
  ok('the length is a control, not a fixed number', ranges(root).length === 1,
    String(ranges(root).length));
  const r = ranges(root)[0];
  ok('bounded by what the engine will take',
    +r.attrs.min === M.MEMOIR_MIN_CHAPTERS && +r.attrs.max === M.MEMOIR_MAX_CHAPTERS,
    `${r.attrs.min}–${r.attrs.max}`);
  ok('there is a button to publish it', buttons(root, 'Publish it').length === 1);
}

// --- the price on the card moves with the slider --------------------------------
// The whole reason the card exists in this shape: the player should feel the
// ceiling before they write, not after.
{
  const { w } = served();
  const { root } = press(w);
  const r = ranges(root)[0];
  const priceAt = (k) => {
    r.handlers.input({ target: { value: String(k) } });
    return (textOf(root).match(/worth about ([\d.]+) of one press article/) || [])[1];
  };
  const one = priceAt(1), twelve = priceAt(M.MEMOIR_MAX_CHAPTERS);
  ok('a longer book is priced higher', +twelve > +one, `${one} -> ${twelve}`);
  ok('one chapter is a tenth of an article', +one === M.MEMOIR_WEIGHT, String(one));
  ok('and the longest is about one article', +twelve > 1 && +twelve < 2, String(twelve));
  ok('the ceiling is said out loud at the top', /as far as it goes/.test(textOf(root)));
}

// --- and clicking it publishes what the controls say ----------------------------
{
  const { w, pid } = served();
  const { root, sent } = press(w);
  // Type a title, drag to nine chapters, publish.
  // By its own placeholder: the Press page has other inputs (a headline, a new
  // paper's name), so match the book's field, not "the first input on the page".
  const title = inputs(root).find((n) => /book/i.test(n.attrs.placeholder || ''));
  ok('the title field is there to type into', !!title,
    inputs(root).map((n) => n.attrs.placeholder).join(' / '));
  title.handlers.input({ target: { value: 'The Years' } });
  ranges(root)[0].handlers.input({ target: { value: '9' } });
  buttons(root, 'Publish it')[0].handlers.click();

  const act = sent.find((a) => a.type === 'MEMOIR');
  ok('the click dispatches MEMOIR', !!act, JSON.stringify(act || null));
  ok('with the title as typed', act?.title === 'The Years', String(act?.title));
  ok('and the length as dragged, not as first rendered', act?.chapters === 9, String(act?.chapters));
  ok('the book is on the shelf', (w.memoirs || []).length === 1);
  ok('and the article about them was revised', w.bios[pid].revisedFor
    === 'after its subject published their own account', String(w.bios[pid].revisedFor));
}

// --- and it is offered once ------------------------------------------------------
{
  const { w, pid } = served();
  M.publishMemoir(w, { authorId: pid, title: 'A Plain Account', chapters: 3 });
  const { root } = press(w);
  const txt = textOf(root);
  ok('afterwards the card shows the book instead of the form', /A Plain Account/.test(txt));
  ok('and there is nothing left to publish', buttons(root, 'Publish it').length === 0);
}

// --- a sitting president is not offered one --------------------------------------
{
  const { w } = served();
  // Back in the chair.
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  const { root } = press(w);
  ok('not from the chair', !/Your own account of it/.test(textOf(root)));
}

// --- and neither is somebody who never held it -----------------------------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'Nobody Much' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Nobody Much' });
  w.phase = 'live'; w.inaugurated = 0;
  const { root } = press(w);
  ok('nor to somebody who never held the chair', !/Your own account of it/.test(textOf(root)));
}

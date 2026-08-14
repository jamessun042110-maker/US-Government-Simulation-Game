// The office scenes are hand-drawn pixel canvases. There is no pretending a unit
// test judges whether one *looks* right — but it can hold the line that every
// room still renders: that a draw function does not throw, and that it emits a
// real frame rather than an empty one. That catches a bad Canvas call (a wrong
// helper name, an out-of-range colour) the moment it lands, which is most of what
// goes wrong when the art is edited.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const SC = await import(base + 'scene.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });

// Every room the game can put you in.
const rooms = ['oval', 'state', 'defense', 'exchequer', 'co_garage', 'co_office', 'co_tower', 'co_hq'];
for (const k of rooms) {
  let svg = '', threw = null;
  try { svg = SC.officeScene(w, k); } catch (e) { threw = e; }
  ok(`the ${k} room renders without throwing`, !threw, threw ? threw.message : '');
  ok(`the ${k} room emits a frame`, typeof svg === 'string' && svg.startsWith('<svg') && svg.includes('<rect'),
    (svg || '').slice(0, 46));
}

// The Treasury specifically. A blank or one-rect frame would still "start with
// <svg" — so require a frame with real detail in it (the desk, screens, window,
// medallion and marble all merge to well over a hundred nodes).
const exch = SC.officeScene(w, 'exchequer');
const rects = (exch.match(/<rect/g) || []).length;
ok('the treasury renders with real detail', rects > 60, `${rects} rects`);

// An unknown key falls back to the Oval rather than throwing (documented behaviour).
let fell = '';
try { fell = SC.officeScene(w, 'no_such_room'); } catch (e) { fell = 'THREW:' + e.message; }
ok('an unknown room falls back to the Oval', fell.startsWith('<svg') && fell.includes('<rect'), fell.slice(0, 30));

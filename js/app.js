// Bootstrap. Wires the transport, the clock, and the views together.

import { Net } from './net.js';
import { newWorld } from './world.js';
import { apply, prunePlayers, beginSeasonIfReady, activePlayers } from './actions.js';
import { tick, openElections } from './sim.js';
import { el, clamp } from './util.js';
import { PICKABLE_TEMPLATES } from './rules.js';
import { COLLEGES, GENDERS, stateCollegeName } from './world.js';
import { STATES, postalOf } from './atlas.js';
import * as UI from './ui.js';
import { titleScene } from './scene.js';
import { pixText } from './pixfont.js';
import { initTheme } from './theme.js';

const net = new Net();
const playerId = net.clientId;
let world = net.loadWorld();
let dirty = true;
let introSeen = false; // the title screen shows once, before the founding setup
// Who the founder is. Defaults that a table can simply ignore.
// The founding defaults. Gender defaults to the one most of the table is
// actually going to pick, so most players never open the panel at all; it is a
// prefilled field and nothing else, and all three are one click apart.
// Thirty-five, and the polytechnic. A founder at forty-five has already had a
// career; at thirty-five they are young enough that the Season is the career,
// which is the story this game is about. Harborlight over Northgate for the
// same reason: it is the middle of the four — some standing, a trade behind it,
// and enough alumni in the chamber to find a friendly vote — so the default
// starts a player in the middle of the board rather than at one end of it.
let founderAge = 35, founderGender = 'm', founderCollege = 'harborlight';
// Where the founder is from. Defaults to the first region on the map rather than
// to a favourite: any default here is a thumb on the scale for one state's
// representation, and first-in-the-atlas is at least an arbitrary rule rather
// than a preference.
let founderState = STATES[0].id;

/** "GA · AL · MS" — what a merged region is actually made of. */
const abbrsOf = (s) => postalOf(s).join(' \u00b7 ');

// The founder's college, named. Only one of the four needs naming — the state
// university takes the name of the state you said you were from, and no world
// exists yet at the founding screen to look that up in, so it is resolved from
// the two fields directly.
const founderCollegeName = () => (founderCollege === 'northgate'
  ? stateCollegeName(STATES.find((s) => s.id === founderState)?.name)
  : COLLEGES.find((c) => c.id === founderCollege)?.name || '');

const $ = (id) => document.getElementById(id);

// --- transport --------------------------------------------------------------
net.on('action', (action) => {
  if (!world) return;
  const wasLive = world.phase === 'live';
  apply(world, action);
  dirty = true;
  net.publish(world);
  if (!wasLive && world.phase === 'live') render(true); // Season just began — paint the inauguration
});
net.on('snapshot', (snap) => {
  window.__usgov.stats.snapshots++;
  if (!snap) return;
  if (world && snap.seasonId === world.seasonId && snap.clock.tick < world.clock.tick - 2) return;
  const wasSeated = !!(world && world.players[playerId]);
  const wasLive = !!(world && world.phase === 'live');
  world = snap;
  dirty = true;
  // The Season just began under us — paint now (the inauguration scene) rather
  // than waiting on the animation-frame loop, which a backgrounded tab pauses.
  if (!wasLive && world.phase === 'live') render(true);
  // Whether this tab holds a player just changed — most importantly, a JOIN we
  // dispatched has now been confirmed by the host. Paint it immediately instead
  // of waiting on the animation-frame loop, which the browser pauses in a
  // backgrounded tab: otherwise a second player who clicked "Enter the
  // convention" while their tab wasn't frontmost is left staring at the join
  // screen forever, even though the shared world already holds them.
  if (wasSeated !== !!world.players[playerId]) render(true);
});
net.on('hostchange', (isHost) => {
  if (isHost && !world) world = net.loadWorld();
  dirty = true;
});
// Another tab founded a new Season; the world under us is gone.
net.on('reset', () => location.reload());

// Handy from the console: __usgov.world, __usgov.net.isHost, __usgov.dispatch({...})
// `render` is here for the same reason the rest is: an automation pane reports
// document.hidden === true, so requestAnimationFrame never fires and the app
// never repaints on its own. Anything testing what a tick does to the screen has
// to be able to ask for the paint by hand.
window.__usgov = { get world() { return world; }, net, get playerId() { return playerId; }, dispatch: (a) => dispatch(a), render: (f = false) => render(f), stats: { snapshots: 0, actions: 0 } };

function dispatch(action) {
  action.playerId = playerId;
  net.dispatch(action);
  dirty = true;
}

// --- clock ------------------------------------------------------------------
// Driven by wall-clock time, not by counting timer fires. Browsers throttle
// setInterval hard in background tabs — to about once a minute — so a host tab
// left in the background used to freeze the world for everybody. Instead we
// ask how many seconds have actually passed and run that many ticks, which
// keeps the promise that the world moves while nobody is looking.
let lastTickAt = Date.now();
const CATCHUP_CAP = 900; // don't try to simulate more than 15 minutes at once

function advanceClock() {
  net.renewHost();
  if (!net.isHost || !world) { lastTickAt = Date.now(); return; }
  const due = Math.floor((Date.now() - lastTickAt) / 1000);
  if (due <= 0) return;
  const run = Math.min(due, CATCHUP_CAP);
  lastTickAt += due * 1000; // discard anything beyond the cap rather than owing it forever
  // The host is the authority on who is still here: drop tabs that have gone
  // silent so an abandoned seat can't hold a table vote hostage.
  prunePlayers(world);
  // If a founder who hadn't readied has just left, the remaining founders may
  // now all be ready — begin the Season rather than wait on a departed tab.
  beginSeasonIfReady(world);
  // Solo, the clock can be run faster: this is a game about waiting for a
  // republic to move, and alone at the table there is nobody to wait *for*.
  // Checked here as well as in the action, so a scale set while alone stops
  // applying the moment somebody else sits down.
  const scale = activePlayers(world).length <= 1 ? Math.max(1, Math.min(4, world.timeScale || 1)) : 1;
  for (let i = 0; i < run * scale; i++) tick(world);
  net.publish(world);
  dirty = true;
}
setInterval(advanceClock, 1000);
// Presence heartbeat: who counts as "active" for table motions.
setInterval(() => { if (world && world.players?.[playerId]) dispatch({ type: 'PING' }); }, 20000);
// Coming back to the tab catches the world up immediately rather than waiting
// for the next throttled interval.
document.addEventListener('visibilitychange', () => { if (!document.hidden) advanceClock(); });
// A clean exit tells the table at once; the silence-timeout above is the
// fallback for a crash or a yanked network. Best-effort — a closing tab may
// not get the message out, which is exactly what the timeout covers.
window.addEventListener('pagehide', (e) => {
  // A bfcache navigation is not leaving: the tab can come straight back with
  // this same world in hand, and a LEAVE would have unseated it meanwhile.
  // Only a real teardown tells the table goodbye.
  if (e.persisted) return;
  if (world && world.players?.[playerId]) { try { dispatch({ type: 'LEAVE' }); } catch {} }
});

// --- render -----------------------------------------------------------------
// Rendering replaces whole subtrees, so it must never run for no reason: a
// rebuild loses the caret, the selection and the scroll position. Two rules
// keep that from happening — nothing re-renders unless the world actually
// changed (world.rev), and nothing containing the field you are typing into
// re-renders at all until you are done with it.
let lastView = null, lastRev = -1, lastModal = null, lastSworn = null;

const typingIn = (root) => {
  const a = document.activeElement;
  return !!a && !!root && root.contains(a)
    && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName);
};

/**
 * The same courtesy, extended to reading. replaceChildren() destroys the nodes
 * a selection is anchored to, so a tick landing while you are dragging across a
 * clause wipes the highlight out from under you — and the world ticks once a
 * second, so highlighting anything longer than a sentence was impossible.
 *
 * An active selection is treated exactly like an open editor: the subtree
 * holding it does not rebuild until you let go of it. Clicking anywhere
 * collapses the selection and the next tick paints normally.
 */
const selectingIn = (root) => {
  if (!root) return false;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  return root.contains(sel.getRangeAt(0).commonAncestorContainer);
};

/**
 * And to clicking. A click only fires if its mousedown and mouseup targets
 * still share a live ancestor — and replaceChildren() between the two detaches
 * the node the press started on, so the click dies in silence. With the world
 * repainting about once a second and a human press lasting 60–150ms, roughly
 * one press in ten landed on a button that stopped existing under the finger:
 * the "I have to click things twice" bug. A pressed pointer now holds the
 * repaint for the region it is pressing in; release lets the deferred paint
 * land on the next frame, after the click has been delivered.
 */
let pressTarget = null, pressAt = 0;
const pressEnd = () => { if (pressTarget) { pressTarget = null; dirty = true; } };
document.addEventListener('pointerdown', (e) => { pressTarget = e.target; pressAt = Date.now(); }, true);
// Deferred a beat so the click event outruns the repaint it re-arms.
document.addEventListener('pointerup', () => setTimeout(pressEnd, 0), true);
document.addEventListener('pointercancel', pressEnd, true);
// A <select> takes its pointerdown here and then opens a native popup that the
// page never sees the pointerup from, so the press guard stayed armed for its
// full three seconds after every dropdown. A `change` is the interaction
// finishing, whatever the pointer did.
document.addEventListener('change', pressEnd, true);
// A release the page never hears about (mouseup off-window, cmd-tab away)
// must not hold the world still forever.
window.addEventListener('blur', pressEnd);
const pressingIn = (root) => {
  if (pressTarget && Date.now() - pressAt > 3000) pressTarget = null;
  return !!pressTarget && !!root && root.contains(pressTarget);
};

/** Busy = typing in it, reading a highlight in it, or mid-click on it. */
const busy = (root) => typingIn(root) || selectingIn(root) || pressingIn(root);

function render(force = false) {
  if (!world) return introSeen ? renderSetup() : renderIntro();
  if ($('setup')) $('setup').remove();
  if ($('intro')) $('intro').remove();
  if (!$('app')) buildShell();
  // The convention is a focused setup step: hide the game's sidebar until the
  // Season is actually live, so nothing pulls the eye off writing the constitution.
  $('app').classList.toggle('conv-focus', world.phase === 'convention');

  UI.mount({
    world, playerId, dispatch, net,
    rerender: (f) => { dirty = true; if (f) render(true); },
    abandonFounding,
  });

  // Open the join modal until this tab has a player; close it the moment the
  // snapshot confirms one, so a JOIN that lands a beat after dispatch doesn't
  // leave the modal stuck open over a world we are already in.
  if (!world.players[playerId]) { if (UI.S.modal !== 'join') UI.S.modal = 'join'; }
  else if (UI.S.modal === 'join') UI.S.modal = null;

  // First visit ever (per browser): the how-to-play guide, and it goes first.
  //
  // Two gates, and the order between these two matters as much as either.
  //
  // It waits for the convention to rise. The convention is its own screen with
  // its own instructions, and a manual thrown over the top of a document being
  // argued line by line is a manual nobody reads and a debate nobody can see.
  // Once the Season is live there is a game to explain and the explanation has
  // somewhere to land.
  //
  // And it comes *before* the oath rather than after it. The inauguration is
  // the game's opening image — the thing the manual has just spent six pages
  // telling you is the point — and putting the manual after it meant the
  // moment was interrupted by a wall of text about tabs. Read it, then watch
  // the republic begin.
  if (world.players[playerId] && world.phase === 'live' && !UI.S.modal && !UI.tutorialSeen()) {
    UI.S.modal = 'tutorial';
    // And the oath waits for them. The inauguration is only offered inside a
    // forty-tick window off the start of the term, which is forty seconds —
    // less time than it takes to read six pages. Putting the manual first
    // without this means a first-time player reads the manual and the window
    // shuts behind them, so the one thing the manual has just told them to
    // watch for never happens. The debt is recorded when the manual opens and
    // paid when it closes.
    if (!UI.inaugurationSeen(world) && UI.termAge(world) < 40) UI.S.oathOwed = true;
  }

  // The Season has just begun: play the short inauguration scene once before the
  // dashboard, so the game opens on a moment rather than a wall of numbers.
  // Only within the founding's first canon year — a player joining an old
  // Season should not be greeted by a years-stale oath presented as news.
  // Every new term gets its own oath — not just the founding one. The guard is
  // now the age of the *term* rather than the age of the Season, so a player
  // joining an old republic is not greeted by a years-stale oath as news, but a
  // president sworn in this minute is.
  if (world.players[playerId] && world.phase === 'live' && !UI.S.modal && !UI.inaugurationSeen(world)
    && (UI.termAge(world) < 40 || UI.S.oathOwed)) {
    UI.S.modal = 'inauguration';
    UI.S.oathOwed = false;
  }

  // An election takes the screen and gives it back the moment the count is in. It
  // outranks the tutorial and the inauguration, because the clock is stopped
  // behind it and nothing else can proceed.
  //
  // But it does not take the screen out from under a dialog the player opened
  // themselves. This line runs on every render — about once a second — and it
  // used to reassert 'election' over whatever was up, so anything opened from
  // behind a minimised ballot was wiped off the screen within the second. Most
  // visibly: "Wipe and start over" opens a confirm, the confirm is gone before
  // you can read it, and the Season cannot be ended for as long as the ballot is
  // open. There is no rule behind that — the engine takes a reset motion during
  // an election perfectly happily, and a solo wipe never reaches the engine at
  // all — it was this line, once a second, closing the door.
  //
  // The rule itself is UI.modalDuringPolls, so it can be run — and pinned —
  // without a document. When one of the player's own dialogs closes, S.modal
  // goes null and the next render puts the ballot back, docked or full as it
  // was.
  const polls = !!(world.phase === 'live' && world.players[playerId] && openElections(world).length);
  const wasElection = UI.S.modal === 'election';
  UI.S.modal = UI.modalDuringPolls(UI.S.modal, polls);
  if (!polls && wasElection) UI.S.electionMin = false;

  const rev = world.rev || 0;
  const viewChanged = lastView !== UI.S.view;
  const modalChanged = lastModal !== UI.S.modal;
  if (!force && !viewChanged && !modalChanged && rev === lastRev) return;

  // Each region is skipped while it holds the caret or a selection, so reading
  // and copying survive the clock. A forced render (something you clicked) is
  // always allowed through.
  if (force || !busy($('top'))) UI.renderHeader($('top'));
  if (force || !busy($('nav'))) UI.renderNav($('nav'));
  if (force || !busy($('notices'))) UI.renderNotices($('notices'));

  // Only (re)build the modal when it actually opens, closes, or a click forces
  // it. Rebuilding on every periodic tick used to restart the modal's entry
  // animation (the inauguration scene visibly re-flashed each second) and could
  // clobber a field mid-type. Live modals refresh themselves via forced rerenders.
  //
  // The ballot is the exception: it carries a countdown that has to move. Built
  // once it painted "58 ticks to the count" and sat there for the whole
  // election, which — beside a line saying the world was stopped — read as a
  // hung game. So it rebuilds on the tick, behind the same busy() guard so it
  // cannot rebuild out from under a ballot you are filling in, and its scroll
  // position is restored (the scroller is the .modal box, not the backdrop) or
  // it threw you back to the top of the candidate list once a second.
  //
  // The inauguration is the other live modal, but only just: it repaints when
  // the oath is taken and not otherwise. A guest is watching it for exactly one
  // change, and rebuilding it on the tick re-flashes the entry animation.
  const swornNow = world.inaugurated != null;
  const swornChanged = UI.S.modal === 'inauguration' && lastSworn !== null && swornNow !== lastSworn;
  lastSworn = swornNow;
  if (force || modalChanged || swornChanged || (UI.S.modal === 'election' && !busy($('modal')))) {
    const scroller = $('modal').querySelector('.modal');
    const keep = scroller ? scroller.scrollTop : 0;
    UI.renderModal($('modal'));
    // A different modal starts at the top; the same one carries on where it was.
    if (!modalChanged && keep) {
      const next = $('modal').querySelector('.modal');
      if (next) next.scrollTop = keep;
    }
    lastModal = UI.S.modal;
  }

  if (force || viewChanged || !busy($('view'))) {
    const keepScroll = $('view').scrollTop;
    UI.renderView($('view'));
    // Same view: preserve where you were reading. New view: start at the top —
    // replaceChildren keeps the old scroll offset, so a switched-to tab used
    // to open wherever the previous one had been scrolled.
    $('view').scrollTop = viewChanged ? 0 : keepScroll;
    lastView = UI.S.view;
    lastRev = rev;
  }
}

function loop() {
  if (dirty) { dirty = false; try { render(); } catch (e) { console.error(e); } }
  requestAnimationFrame(loop);
}
setInterval(() => { dirty = true; }, 900); // keep clocks and timers ticking on screen
requestAnimationFrame(loop);

function buildShell() {
  document.body.replaceChildren(
    el('div', { id: 'app' },
      el('header', { class: 'top', id: 'top' }),
      el('main', {},
        el('nav', { class: 'side', id: 'nav' }),
        el('section', { class: 'view', id: 'view' }))),
    el('div', { class: 'notice', id: 'notices' }),
    el('div', { id: 'modal' }));
}

// --- new Season setup -------------------------------------------------------
const cfg = {
  nation: 'The United States', seasonName: 'Season I', templateId: 'federal-republic',
  // Founding canon, no longer asked for at setup — see the archived chooser below.
  canon: 'cold', ticksPerYear: 240, districtCount: 6, seedPop: 24000, treasury: 60e6,
};

// Built exactly once. Selecting a template or a canon dial updates the chosen
// button in place rather than rebuilding the page, so typing and scrolling
// survive. (The old version re-ran on every heartbeat, which is why neither did.)
// The title screen is the capital at dusk, rasterised in scene.js on the same
// grid as every room in the game. It used to be hand-written SVG — a linear
// gradient for the sky, `q` curves for the dome, black strokes around the
// buildings — which meant the first picture anybody saw of Silver was the one
// picture in it that was not pixel art. See scene.titleScene.
function renderIntro() {
  if ($('intro')) return;
  if ($('app')) $('app').remove();
  const node = el('div', { id: 'intro' },
    el('div', { class: 'intro-scene', html: titleScene() }),
    // Type at the top, the way in at the bottom. They used to be one stack in
    // the middle of the screen, which put the button squarely on the capitol's
    // cupola — the one thing in the scene you least want covered.
    // The wordmark is drawn on the same 5x7 grid as the city behind it, with a
    // one-pixel skirt so it holds its edge over the sky and a one-pixel shadow
    // under it so it has weight. It used to be Space Grotesk with a 2.5px
    // -webkit-text-stroke, which at some window widths landed between two of
    // the scene's pixels and read as a smear across the middle of the letters.
    el('div', { class: 'intro-inner' },
      el('div', { class: 'intro-mark', html: pixText('THE UNION', { ink: '#f4e0a8', edge: '#141414', gap: 3 }) }),
      el('div', { class: 'intro-tag' }, 'A United States, governed by you')),
    // The way in is drawn in the same face as the wordmark over it. A button
    // labelled in Space Grotesk under a 5x7 bitmap title was the last bit of
    // the title screen still speaking with two voices. pixText carries its own
    // aria-label, so the button is still a button to anything reading it out.
    el('div', { class: 'intro-cta' },
      el('button', {
        class: 'btn primary intro-enter', title: 'Start',
        html: pixText('START', { ink: 'currentColor', gap: 2 }),
        onclick: () => { introSeen = true; render(true); },
      })));
  document.body.replaceChildren(node);
  // The caret goes in the name box: the clearest possible statement of where to
  // start, and the one thing this page actually needs from you.
  if (!founderName) node.querySelector('#foundername')?.focus();
}

// The founding is a procession, not a form: one decision per screen, walked in
// order — name the nation, choose its regime, set the canon, convene. From the
// regime step on, the wizard wears the chosen regime's colour, because the
// government you pick should be the first aesthetic fact about the game.
let founderName = '';

// Whether the two folded panels are offered at all. A table founding its first
// republic never opens them, and two rows of "Advanced —" on the one page you
// have to get through is two invitations to worry about something you have no
// view on yet. Kept per browser, like the theme and the tutorial: it is a
// preference about the setup screen, not a fact about the world.
const ADV_KEY = 'usgov.setupAdvanced';
let showAdvanced = (() => {
  try { return localStorage.getItem(ADV_KEY) !== '0'; } catch { return true; }
})();
const setShowAdvanced = (on) => {
  showAdvanced = on;
  try { localStorage.setItem(ADV_KEY, on ? '1' : '0'); } catch { /* no storage */ }
};

/**
 * The way back out of a step.
 *
 * Every screen from the title onward gets one, so the founding is walkable in
 * both directions: nothing before the convention is a commitment, and a player
 * who opened the setup to read it should not have to reload the page to get
 * back to the title. (The convention itself has no back link, and should not —
 * by then the world exists, the table may hold other players, and "back" would
 * mean destroying a founded republic rather than closing a form.)
 */
const backStep = (onBack) => el('button', {
  class: 'btn ghost sm setup-back', onclick: onBack,
}, '← Back');

/**
 * Founding is one page. There used to be a second, "Review the founding",
 * restating the six values you had just typed on the page before it and asking
 * you to confirm them — a receipt for a form still on screen. The convention
 * that follows is where the founding is actually argued, and everything the
 * review listed can still be changed there.
 */
function renderSetup() {
  // Build the founding page once and then leave it alone. render() runs on every
  // tick of the clock, and this function replaces the whole body — so rebuilding
  // it unconditionally tore the field you were typing your nation's name into out
  // of the document once a second, taking the caret with it. Nothing on this page
  // is live; the only things that change it are the choices below, which call
  // rebuild() themselves.
  if ($('setup')) return;
  if ($('intro')) $('intro').remove();
  if ($('app')) $('app').remove();

  const T = PICKABLE_TEMPLATES.find((t) => t.id === cfg.templateId) || PICKABLE_TEMPLATES[0];
  const rebuild = () => { $('setup')?.remove(); renderSetup(); };

  const convene = () => {
    const name = founderName.trim() || 'Founder';
    // Whoever founds the Season owns it — otherwise publish() no-ops and the
    // new world never leaves this tab.
    net.claimHost();
    world = newWorld(cfg);
    apply(world, {
      type: 'JOIN', playerId, name, moderator: true,
      age: founderAge, gender: founderGender, college: founderCollege, homeState: founderState,
      // A player's own persona is not dealt a party the way the other 24,000
      // are. makePersona rolls one off the world's seeded RNG, so which side
      // you woke up on was a coin flip you never saw tossed — and you would
      // find out from a chip beside your name on the Offices tab. Start
      // everybody on the same side of the aisle and let them cross it there.
      party: 'liberal',
    });
    net.publish(world);
    net.broadcastReset();
    dirty = true;
    render(true);
  };

  // What the advanced panel currently says about you, on its own summary line —
  // so the panel can be shut and still be answerable.
  const whoSummary = () => [
    `${founderAge}`,
    GENDERS.find((g) => g.id === founderGender)?.label,
    founderCollegeName(),
  ].filter(Boolean).join(' · ');

  // The college cards used to call rebuild() — the whole page torn down and
  // written again to move one `chosen` class. That is what shut the panel every
  // time you picked a college: a <details> rebuilt is a <details> closed, so
  // choosing between three colleges meant opening the panel three times. The
  // chosen state is one class on one node; move it by hand and nothing else has
  // to happen.
  const collegeCards = COLLEGES.map((c) => el('button', {
    class: 'regime-card canon' + (founderCollege === c.id ? ' chosen' : ''),
    'data-college': c.id,
    // The state university's card is labelled for the state currently chosen
    // above it, so the two fields visibly agree before anything is committed.
  }, el('b', { 'data-college-name': c.id },
    c.id === 'northgate' ? stateCollegeName(STATES.find((s) => s.id === founderState)?.name) : c.name),
    el('div', { class: 'small' }, c.blurb),
    el('div', { class: 'tiny dimmer', style: { marginTop: '4px' } },
      `prestige ${c.prestige}/4 · about ${Math.round(c.share * 100)}% of the political class`)));

  const whoPanel = el('details', { class: 'setup-adv', id: 'setup-who', style: { marginTop: '10px' } },
    el('summary', {}, 'Advanced — age, college and gender ',
      el('span', { class: 'tiny dimmer', id: 'whoSummary' }, whoSummary())),
    el('div', { class: 'grid g2', style: { marginTop: '10px' } },
      el('label', { class: 'field' }, el('span', {}, 'Age'),
        el('input', {
          type: 'number', min: 25, max: 90, value: founderAge,
          oninput: (e) => { founderAge = clamp(+e.target.value || 35, 25, 90); syncWho(); },
        })),
      el('label', { class: 'field' }, el('span', {}, 'Gender'),
        el('select', { onchange: (e) => { founderGender = e.target.value; syncWho(); } },
          ...GENDERS.map((g) => el('option', { value: g.id, selected: founderGender === g.id }, g.label))))),
    el('div', { class: 'stack', style: { marginTop: '8px' } },
      el('div', { class: 'tiny dimmer' },
        'Where you read. A grander college opens with more goodwill and a steadier treasury, but hands the press a stick — and it has fewer alumni in the chamber to find you a friendly vote.'),
      ...collegeCards),
    // Submit, on a panel whose fields are already live. It commits nothing that
    // was not already committed — every control here writes straight through, so
    // there is no way to lose an edit by not pressing it — what it does is close
    // the panel and say what it now holds. The alternative, staging the three
    // values and only applying them on submit, quietly throws away the age you
    // typed if you go straight to Convene, which is a worse bargain than a
    // button that only confirms.
    el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', {
        class: 'btn sm primary',
        onclick: () => {
          const d = $('setup-who'); if (d) d.open = false;
          $('foundername')?.focus();
        },
      }, 'Save and close'),
      el('span', { class: 'tiny dimmer' }, 'Saved as you go — this just puts it away.')));

  // Kept out of the tree above so the college buttons can call it.
  function syncWho() {
    const sum = $('whoSummary'); if (sum) sum.textContent = whoSummary();
    // The state university's card carries the state chosen above it. Retitled in
    // place rather than by rebuilding the panel — a <details> rebuilt is a
    // <details> closed, which is the whole reason the college cards stopped
    // calling rebuild() in the first place.
    const card = document.querySelector('[data-college-name="northgate"]');
    if (card) card.textContent = stateCollegeName(STATES.find((s) => s.id === founderState)?.name);
  }
  for (const b of collegeCards) {
    b.onclick = () => {
      founderCollege = b.dataset.college;
      for (const other of collegeCards) other.className = 'regime-card canon' + (other === b ? ' chosen' : '');
      syncWho();
    };
  }

  const timePanel = el('details', { class: 'setup-adv' },
    el('summary', {}, 'Advanced — time and population'),
    el('div', { class: 'grid g2', style: { marginTop: '10px' } },
      // "Ticks per canon year" asked the player to know what a tick is before
      // they had seen one. A tick is a second — it says so in the line below —
      // so the field may as well be denominated in the unit they already have.
      el('label', { class: 'field' }, el('span', {}, 'Seconds per year'),
        el('input', { type: 'number', value: cfg.ticksPerYear, oninput: (e) => (cfg.ticksPerYear = clamp(+e.target.value, 20, 3000)) })),
      el('label', { class: 'field' }, el('span', {}, 'Citizens'),
        el('input', { type: 'number', step: 1000, value: cfg.seedPop, oninput: (e) => (cfg.seedPop = clamp(+e.target.value, 2000, 4000000)) }))),
    el('div', { class: 'tiny dimmer', style: { marginTop: '6px' } },
      'One real second is one canon day\u2019s worth of clock. At 120 a year, a Season spans a generation.'));

  const body = [
    el('h1', { class: 'page' }, 'Found the republic'),
    el('p', { class: 'sub' }, 'Say who you are and where you are from, and convene. Everything else about the republic is argued at the convention.'),
    el('div', { class: 'card' },
      // The nation is not a field any more. It was one when the country was
      // invented and you named it; this is the United States in every Season, so
      // asking was offering a choice that does not exist — and a table that
      // typed something else into it got a republic whose map, states and
      // constitution all said otherwise.
      //
      // Where you are *from* is a real choice, and it is the one that replaces
      // it: it decides which state you are a citizen of, and it names your state
      // university. The merged regions carry the abbreviations of the states
      // they were made from, because "Deep South" is not a place anyone says
      // they are from and "GA · AL · MS" is.
      el('label', { class: 'field' }, el('span', {}, 'Home state'),
        el('select', {
          onchange: (e) => { founderState = e.target.value; syncWho(); },
        }, ...STATES.map((s) => el('option', {
          value: s.id, selected: founderState === s.id,
        }, s.merged.length > 1 ? `${s.name} — ${abbrsOf(s)}` : s.name)))),
      el('div', { class: 'tiny dimmer', style: { marginTop: '-4px' } },
        'The state you represent, and the one your state university is named for.'),
      // "You, its founder" was flavour, not an instruction, and the greyed
      // "John Smith" under it read as a value already filled in — especially
      // sitting under a nation field that genuinely is prefilled. Say plainly
      // that this is where your name goes, mark the example as an example, and
      // put the caret in it.
      el('label', { class: 'field', style: { marginTop: '12px' } }, el('span', {}, 'Your name'),
        el('input', {
          id: 'foundername', value: founderName, placeholder: 'e.g. John Smith',
          oninput: (e) => (founderName = e.target.value),
        })),
      el('div', { class: 'tiny dimmer', style: { marginTop: '-4px' } },
        'What the table calls you. You are this republic\u2019s founder.'),
      // Who you are, beyond the name. Folded away because a table founding its
      // first republic should not have to have a view on any of it — but every
      // one of these is a live statistic, on you and on all 24,000 of them.
      showAdvanced ? whoPanel : null),
    // The canon chooser is archived, not deleted. It asked a table that had not
    // played yet to pick how far the fiction may go, which is a question you can
    // only answer once you know what the game does with it — and nearly everyone
    // wanted the middle setting anyway. Every Season now founds on Cold war
    // (cfg.canon, below), and a moderator can still move the dial from Season →
    // Moderation once the table knows what it is asking for. To bring it back,
    // restore this block and re-import CANON from rules.js:
    //
    //   el('h3', { style: { margin: '18px 0 8px' } }, 'The canon'),
    //   el('div', { class: 'stack' }, ...Object.entries(CANON).map(([k, v]) => el('button', {
    //     class: 'regime-card canon' + (cfg.canon === k ? ' chosen' : ''),
    //     onclick: () => { cfg.canon = k; rebuild(); },
    //   }, el('b', {}, v.label), el('div', { class: 'small' }, v.blurb)))),
    showAdvanced ? timePanel : null,
    el('div', { class: 'row setup-advtoggle' },
      el('button', {
        class: 'btn ghost sm',
        onclick: () => { setShowAdvanced(!showAdvanced); rebuild(); },
      }, showAdvanced ? 'Hide advanced options' : 'Show advanced options'),
      el('span', { class: 'tiny dimmer' }, showAdvanced
        ? 'Age, college, gender, clock speed and population. Every one has a sensible default.'
        // Read off the live values rather than repeated as literals. The line
        // said "age 45, Northgate" for as long as those were the defaults and
        // would have gone on saying it afterwards — a summary that is a copy of
        // the settings is a summary that will eventually disagree with them.
        : `Founding on: age ${founderAge}, ${founderCollegeName()}, `
          + `${cfg.ticksPerYear} seconds a year, ${cfg.seedPop.toLocaleString()} citizens.`)),
    el('p', { class: 'small dim', style: { margin: '16px 0 10px' } },
      'At the convention every founder takes a chair and argues the document line by line. The Season begins when every seated founder readies up.'),
    el('button', { class: 'btn primary', style: { width: '100%' }, onclick: convene },
      'Convene the constitutional convention'),
    // At the foot, under the way forward. A back link above the page title is
    // the first thing the eye lands on, which is an odd thing to offer somebody
    // who has just arrived and has not read what the page is for yet.
    backStep(() => { introSeen = false; $('setup')?.remove(); render(true); }),
  ].filter(Boolean);

  // `body` is overflow:hidden for the app shell, so the setup page carries its
  // own scroll container, and it wears the regime's colour.
  const node = el('div', {
    id: 'setup',
    style: { height: '100vh', overflowY: 'auto', padding: '30px 24px 90px' },
  }, el('div', { style: { maxWidth: '720px', margin: '0 auto' } }, ...body));
  // Enter anywhere on the page founds the nation, since there is nothing else
  // it could mean now — except on a button, which already has its own meaning
  // for Enter. Without that exception, tabbing to "Title screen" and pressing
  // Enter founds the republic you were trying to walk away from.
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.preventDefault(); convene();
  });
  node.style.setProperty('--accent', T.color); node.style.setProperty('--accent-hi', T.colorHi);

  document.body.replaceChildren(node);
  // The caret goes in the name box: the clearest possible statement of where to
  // start, and the one thing this page actually needs from you.
  if (!founderName) node.querySelector('#foundername')?.focus();
}

/**
 * Walk back out of the convention to the founding page.
 *
 * The convention is the last screen before the Season, and until somebody
 * readies up nothing in it has happened — but it is the first screen with a
 * *world* behind it, so going back is not closing a form, it is discarding a
 * republic. That is why the button asks twice (see ui.js) and why this wipes
 * rather than hides: a world left in storage is a world the next load picks up,
 * and the founder would land straight back in the convention they just left.
 *
 * Other tabs are told, because they are sitting in the same convention. They
 * reload, find nothing in storage, and land on the title screen.
 */
function abandonFounding() {
  net.broadcastReset();
  net.wipe();
  world = null;
  // Back to the founding page, not the title: this is a step backwards through
  // the setup, and cfg still holds everything that was typed into it.
  introSeen = true;
  lastRev = -1; lastView = null; lastModal = null; lastSworn = null;
  UI.S.modal = null;
  $('app')?.remove();
  dirty = true;
  render(true);
}

// Follow the machine's light/dark setting while no explicit choice is stored —
// index.html already applied it before first paint; this keeps it live if the
// system flips at dusk while the game is open.
initTheme(() => render(true));

// If another tab already has a world, take it rather than showing setup.
setTimeout(() => { if (!world) { world = net.loadWorld(); dirty = true; } }, 400);
render(true);

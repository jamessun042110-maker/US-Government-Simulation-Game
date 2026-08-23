// First-run "How to play" guide. Paged, per-browser, never synced: whether a
// player has read the manual is not part of the world.

import { el } from './util.js';
import { S } from './ui.js';

const SEEN_KEY = 'usgov.tutorialSeen';

export const tutorialSeen = () => {
  try { return !!localStorage.getItem(SEEN_KEY); } catch { return true; }
};
export function markTutorialSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
}

const tab = (t) => el('span', { class: 'tut-tab' }, t);

const PAGES = [
  {
    title: 'Welcome to State of the Union',
    body: () => [
      el('p', {}, 'A persistent United States you found, govern and betray each other over. Three hundred million simulated citizens live in it, and vote.'),
      el('ul', {},
        el('li', {}, el('b', {}, 'Each browser tab is one player.'), ' Open another and a seat appears.'),
        el('li', {}, el('b', {}, 'Time runs on its own.'), ' One second is one tick, and things happen whether you act or not.'),
        el('li', {}, el('b', {}, 'A Season is one full run'), ', founding to collapse. The next starts fresh.')),
    ],
  },
  {
    title: 'The rules are the game',
    body: () => [
      el('p', {}, 'The rules you write are the rules the engine enforces. If spending over $1B needs a majority of the House, Disburse fails until that vote exists.'),
      el('p', {}, 'Every consequential act — a tax, a war, a pardon — is a clause in a document: prose ', el('i', {}, 'and'), ' executable effect. When it passes, the clauses happen.'),
      el('ul', {},
        el('li', {}, 'Draft one in ', tab('Congress'), ', add clauses, and table it.'),
        el('li', {}, 'A bill passes the House, then the Senate. Both, or it is nothing.'),
        el('li', {}, 'Amendments change the rules mid-Season. Write them carefully.')),
    ],
  },
  {
    title: 'Finding your way around',
    body: () => [
      el('p', {}, 'The sidebar, one line each. A badge means something wants you.'),
      el('ul', {},
        el('li', {}, tab('Nation'), ' approval, treasury, states, crises.'),
        el('li', {}, tab('Congress'), ' where documents are debated and voted.'),
        el('li', {}, tab('Domestic'), ' the parcel map: zoning and building.'),
        el('li', {}, tab('World'), ' neighbours, hostility, treaties and war.'),
        el('li', {}, tab('Press'), ' found a paper, publish, sway opinion.'),
        el('li', {}, tab('Offices'), ' who holds what power.'),
        el('li', {}, tab('Intrigue'), ' conspiracies, spies, suits, uprisings. Private.'),
        el('li', {}, tab('Chronicle'), ' the permanent record.'),
        el('li', {}, tab('Season'), ' the clock, the table, and ending it.')),
      el('p', { class: 'tiny dimmer' }, 'Rooms appear above these when an office opens their door.'),
    ],
  },
  {
    title: 'The world reacts',
    body: () => [
      el('p', {}, 'The citizenry is not scenery: income, jobs, housing and mood, state by state, seeded from the real country. Pass a housing act and homelessness falls when the building opens, not when the vote does.'),
      el('p', {}, el('b', {}, 'Press:'), ' found a paper and publish. A story citing the Chronicle hits harder; an uncited smear costs you.'),
      el('p', {}, el('b', {}, 'Intrigue:'), ' conspiracy rooms are private, but every message adds to the exposure trail. Uprisings turn on real support — allegiance, offices, arms.'),
    ],
  },
  {
    title: 'Losing is content',
    body: () => [
      el('p', {}, 'Executed, exiled or imprisoned, you are not out — you roll a new persona, inheriting only reputation.'),
      el('p', {}, 'Seasons are built to end: bankruptcy, lost wars, empty offices, secession. Collapse is the third act, not a fail state. It stays in the ', tab('Chronicle'), ' and exports to a readable history.'),
    ],
  },
  {
    title: 'Your first ten minutes',
    body: () => [
      el('ul', {},
        el('li', {}, 'Read the constitution in ', tab('Offices'), ' — it says who can do what.'),
        el('li', {}, 'Check ', tab('Nation'), ' for crises — they have deadlines and resolve against you if ignored.'),
        el('li', {}, 'Stand when an election opens, or be useful to someone who does.'),
        el('li', {}, 'Draft your first document in ', tab('Congress'), ' — something small.'),
        el('li', {}, 'Talk. The floor chat is where deals happen.')),
      el('p', {}, 'Reopen this any time with ', el('b', {}, '"? How to play"'), ' in the header. Good luck — the Chronicle is watching.'),
    ],
  },
];

export function tutorialModal() {
  const i = Math.min(S.tutPage || 0, PAGES.length - 1);
  const page = PAGES[i];
  const goto = (n) => { S.tutPage = n; CTX_rerender(); };
  const done = () => { markTutorialSeen(); S.modal = null; S.tutPage = 0; CTX_rerender(); };

  // Fixed-height body with a scrolling content area, so the footer — and the
  // Next button — sit in exactly the same place on every slide. Clicking Next
  // repeatedly never makes it move under the cursor.
  return el('div', { class: 'tut-body' },
    el('div', { class: 'tut-scroll' },
      el('h2', {}, page.title),
      ...page.body()),
    el('div', { class: 'tut-foot' },
      el('button', { class: 'btn ghost sm', disabled: i === 0, onclick: () => goto(i - 1) }, '← Back'),
      el('div', { class: 'tut-dots' },
        ...PAGES.map((_, n) => el('button', { class: 'tut-dot' + (n === i ? ' on' : ''), title: PAGES[n].title, onclick: () => goto(n) }))),
      // Fixed width so the last slide's wider label doesn't shift the button.
      i < PAGES.length - 1
        ? el('button', { class: 'btn primary sm tut-next', onclick: () => goto(i + 1) }, 'Next →')
        : el('button', { class: 'btn primary sm tut-next', onclick: done }, 'Take a seat')));
}

// The tutorial re-renders through the same path as every other modal. Set by
// ui.js at mount time to avoid a circular value dependency at module load.
let CTX_rerender = () => {};
export function tutorialMount(rerender) { CTX_rerender = rerender; }

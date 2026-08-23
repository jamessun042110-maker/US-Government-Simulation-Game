// The dead do not legislate.
//
// Found by sweeping the permission gates: every consequential action, attempted
// by a persona who should not be able to take it. Every gate held for a private
// citizen reaching for a power they do not hold — the constitution is enforced
// carefully — and every gate held against death, exile and imprisonment on the
// executive powers, which each check the persona themselves.
//
// The legislature checked nothing. A dead persona could draft a bill, put it on
// the floor, watch it pass into law, and vote on the floor while it did — the
// rollcall printed the corpse's name against a yea. Same for an exile and for
// somebody in a cell. Individual handlers did ask, in places, and the gaps were
// the consequential ones; actions.apply asks once for every action now.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function republic() {
  const w = W.newWorld({ nation: 'Deadhand' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Chief' });
  w.phase = 'live'; w.inaugurated = 0;
  const seat = w.seats.find((x) => x.office === R.headOffice(w).id);
  seat.personaId = w.players.p1.personaId; seat.since = 0;
  return { w, seat, me: seat.personaId };
}

const STATES = {
  dead: (p) => { p.alive = false; p.died = 1; },
  exiled: (p) => { p.exiled = true; },
  imprisoned: (p) => { p.imprisoned = true; },
};

for (const [state, put] of Object.entries(STATES)) {
  // --- the legislature, which is where the holes were ----------------------
  {
    const { w, me } = republic();
    put(w.personas[me]);
    ACT.apply(w, { type: 'CREATE_DOC', playerId: 'p1',
      doc: { type: 'bill', title: 'Posthumous Act', preamble: 'x', clauses: [{ kind: 'PROSE', text: 'y' }] } });
    ok(`${state}: cannot draft a bill`,
      !Object.values(w.documents).some((d) => d.authorId === me),
      Object.values(w.documents).map((d) => d.title).join(', ') || 'none');
  }
  {
    // Drafted while alive, introduced after. The document is legitimate; the
    // hand putting it on the floor is not.
    const { w, me } = republic();
    ACT.apply(w, { type: 'CREATE_DOC', playerId: 'p1',
      doc: { type: 'bill', title: 'Filed From Beyond', preamble: 'x', clauses: [{ kind: 'PROSE', text: 'y' }] } });
    const d = Object.values(w.documents).find((x) => x.authorId === me);
    put(w.personas[me]);
    ACT.apply(w, { type: 'INTRODUCE', playerId: 'p1', docId: d.id });
    ok(`${state}: cannot put one on the floor`, d.status !== 'floor', d.status);
  }
  {
    const { w, me } = republic();
    const member = w.seats.filter((s) => s.office === 'assembly' && s.personaId)
      .map((s) => w.personas[s.personaId])[0];
    ACT.apply(w, { type: 'JOIN', playerId: 'p2', name: 'Member' });
    w.players.p2.personaId = member.id; member.playerId = 'p2';
    ACT.apply(w, { type: 'CREATE_DOC', playerId: 'p1',
      doc: { type: 'bill', title: 'B', preamble: 'x', clauses: [{ kind: 'PROSE', text: 'y' }] } });
    const d = Object.values(w.documents)[0];
    ACT.apply(w, { type: 'INTRODUCE', playerId: 'p1', docId: d.id });
    put(member);
    ACT.apply(w, { type: 'VOTE', playerId: 'p2', docId: d.id, ballot: 'yea' });
    ok(`${state}: does not vote on the floor`, !(d.votes || {})[member.id],
      String((d.votes || {})[member.id] || 'no ballot'));
  }
  // --- and the rest ---------------------------------------------------------
  {
    const { w, me } = republic();
    const was = w.personas[me].party;
    put(w.personas[me]);
    ACT.apply(w, { type: 'CHOOSE_PARTY', playerId: 'p1', party: was === 'democrat' ? 'republican' : 'democrat' });
    ok(`${state}: does not change party`, w.personas[me].party === was, `${was} → ${w.personas[me].party}`);
  }
  {
    const { w, me } = republic();
    put(w.personas[me]);
    ACT.apply(w, { type: 'CONSPIRE', playerId: 'p1', purpose: 'A purpose' });
    ok(`${state}: starts no conspiracy`, !(w.conspiracies || []).length,
      String((w.conspiracies || []).length));
  }
  {
    const { w, me } = republic();
    put(w.personas[me]);
    const t0 = w.economy.treasury;
    ACT.apply(w, { type: 'DISBURSE', playerId: 'p1', amount: 200000, purpose: 'housing' });
    ok(`${state}: spends nothing from the treasury`, w.economy.treasury === t0,
      `${t0} → ${w.economy.treasury}`);
  }
}

// ---------------------------------------------------------------------------
// And the ways back are all still open
// ---------------------------------------------------------------------------

{
  const { w, seat, me } = republic();
  const dead = w.personas[me];
  dead.alive = false; dead.died = 1;
  ACT.apply(w, { type: 'NEW_PERSONA', playerId: 'p1', name: 'Heir', inherit: true });
  const now = w.personas[w.players.p1.personaId];
  ok('a dead player can still roll a new persona', !!now && now.alive && now.id !== dead.id,
    now ? now.name : 'none');
  seat.personaId = now.id;
  const t0 = w.economy.treasury;
  const r = A.disburse(w, now.id, 200000, 'housing for the encampment');
  ok('and the new one acts', r.ok !== false && w.economy.treasury < t0, r.reason || '');
}

{
  const { w, me } = republic();
  w.personas[me].imprisoned = true;
  const t0 = w.economy.treasury;
  ACT.apply(w, { type: 'DISBURSE', playerId: 'p1', amount: 200000, purpose: 'housing' });
  ok('a prisoner cannot spend', w.economy.treasury === t0);
  w.personas[me].imprisoned = false;                       // a pardon
  ACT.apply(w, { type: 'DISBURSE', playerId: 'p1', amount: 200000, purpose: 'housing' });
  ok('but a pardon gives them the republic back', w.economy.treasury < t0,
    `spent $${t0 - w.economy.treasury}`);
}

{
  // Out-of-game things keep working, or a player who dies is stuck at a screen
  // they cannot leave.
  const { w, me } = republic();
  w.personas[me].alive = false; w.personas[me].died = 1;
  ACT.apply(w, { type: 'PING', playerId: 'p1' });
  ok('the table still sees a dead player', !!w.players.p1);
  ACT.apply(w, { type: 'TABLE_MOTION', playerId: 'p1', kind: 'pause' });
  ok('and they can still move the table to pause', !!w.motion || !!w.paused,
    w.motion ? w.motion.kind : String(!!w.paused));
}

{
  // Speaking is not acting, and a game about betrayal should let somebody send
  // word from a cell.
  const { w, me } = republic();
  w.personas[me].imprisoned = true;
  const before = (w.chat || []).length;
  ACT.apply(w, { type: 'CHAT', playerId: 'p1', text: 'Get me out of here.', channel: 'floor' });
  ok('a prisoner can still speak', (w.chat || []).length > before,
    `${before} → ${(w.chat || []).length}`);
  const { w: w2, me: me2 } = republic();
  w2.personas[me2].alive = false; w2.personas[me2].died = 1;
  const b2 = (w2.chat || []).length;
  ACT.apply(w2, { type: 'CHAT', playerId: 'p1', text: 'From the grave.', channel: 'floor' });
  ok('but the dead say nothing', (w2.chat || []).length === b2,
    `${b2} → ${(w2.chat || []).length}`);
}

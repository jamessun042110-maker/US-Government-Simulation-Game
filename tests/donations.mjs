// Businesses put money into politics past the chamber floor: into a party (capped
// at $100M for a per cent at the polls), into a campaign (capped at $10M for a per
// cent of it), and into a campaign of their own — bootstrapped, with no limit.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.elections = []; w.atThePolls = false;
  return { w, pid: w.players.p1.personaId };
};

ok('the party cap is $100M', CO.PARTY_DONATION_CAP === 1e8);
ok('the campaign cap is $10M', CO.CAMPAIGN_DONATION_CAP === 1e7);

const { w, pid } = mk();
const co = CO.found(w, pid, 'MegaCorp').company;
co.cash = 800e6; co.valuation = 50e6;   // well out of the basement, deep pockets

// --- a party's war chest, capped -----------------------------------------------
ok('a party donation is taken and recorded', CO.donateParty(w, co, pid, 'liberal', 50e6).ok && w.partyFunds.liberal === 50e6);
ok('$50M buys half a per cent at the polls', Math.abs(CO.partyInfluence(w, 'liberal') - 0.005) < 1e-9, String(CO.partyInfluence(w, 'liberal')));
CO.donateParty(w, co, pid, 'liberal', 100e6);   // tries to push past the cap
ok('the influence caps at one per cent', Math.abs(CO.partyInfluence(w, 'liberal') - 0.01) < 1e-9);
ok('and only the room to the cap is taken', w.partyFunds.liberal === 1e8);

// --- a campaign fund, capped ---------------------------------------------------
const cand = W.makePersona(w, { synthetic: true }); w.personas[cand.id] = cand;
CO.donateCampaign(w, co, pid, cand.id, 5e6);
ok('$5M buys half a per cent of a campaign', Math.abs(CO.campaignInfluence(w, cand.id) - 0.005) < 1e-9);
CO.donateCampaign(w, co, pid, cand.id, 20e6);   // over the cap
ok('a capped campaign donation tops out at one per cent', Math.abs(CO.campaignInfluence(w, cand.id) - 0.01) < 1e-9);

// --- bootstrapping, uncapped ---------------------------------------------------
CO.donateCampaign(w, co, pid, cand.id, 30e6, { bootstrap: true });
ok('bootstrapping is not capped', Math.abs(CO.campaignInfluence(w, cand.id) - (0.01 + 0.03)) < 1e-9, String(CO.campaignInfluence(w, cand.id)));

// --- a basement operation funds nothing ----------------------------------------
{
  const founder2 = W.makePersona(w, { synthetic: true }); w.personas[founder2.id] = founder2;
  const co2 = CO.found(w, founder2.id, 'Basement Inc').company;   // garage stage
  co2.cash = 10e6;
  ok('a basement company cannot donate', !CO.donateParty(w, co2, founder2.id, 'liberal', 1e6).ok);
}

// --- the money tells at the polls ----------------------------------------------
// Asserted over seven elections rather than one, and on the tally rather than on
// a single seat.
//
// A district's vote is scaled `/1000 * citizenWeight`, so a two-horse race in
// one district is decided by a count that lands on 1 against 1 — and one run in
// sixty came back a tie and failed. The money was working perfectly; the
// assertion was reading a rounded sample and calling it a claim, which is the
// same mistake `macro` was making against its own past and `chamber` was making
// against a median. `sim.topicJitter` derives a member's bias by hashing the
// persona id and `uid()` is Math.random by design, so the two candidates are
// genuinely different people each run and a single race is a coin weighted
// toward the money, not a proof about it. Seven of them are.
{
  let won = 0, forMoney = 0, against = 0;
  const ROUNDS = 11;
  for (let r = 0; r < ROUNDS; r += 1) {
    const { w: w2, pid: p2 } = mk();
    const backer = CO.found(w2, p2, 'Kingmaker').company; backer.cash = 900e6; backer.valuation = 60e6;
    const chamber = w2.constitution.legislature.chamber;
    const seat = w2.seats.find((s) => s.office === chamber && s.district);
    const d = w2.districts.find((x) => x.id === seat.district);
    seat.personaId = null;
    const mkc = () => { const p = W.makePersona(w2, { synthetic: true, district: d.id }); p.party = d.lean; p.approval = 50; w2.personas[p.id] = p; return p.id; };
    const plain = mkc(), bankrolled = mkc();   // two of the district's own party, equal
    CO.donateCampaign(w2, backer, p2, bankrolled, 300e6, { bootstrap: true });   // ~30% behind them
    const e = {
      id: 'e', office: chamber, status: 'open',
      candidates: [{ personaId: plain, district: d.id, votes: 0 }, { personaId: bankrolled, district: d.id, votes: 0 }],
      ballots: {}, sealed: {},
    };
    w2.elections.push(e);
    S.closeElection(w2, e);
    const votes = Object.fromEntries(e.candidates.map((c) => [c.personaId, c.votes]));
    forMoney += votes[bankrolled]; against += votes[plain];
    if (votes[bankrolled] >= votes[plain]) won += 1;
  }
  // On the aggregate, not on every seat. Insisting the money win each of eleven
  // races is a *stricter* claim than the one race this replaced — a thumb on
  // the scale is not a guarantee, and the design says so out loud: money buys a
  // lean and never the vote. What it does buy shows up in the total.
  ok('money tells across a run of equal races', forMoney > against, `${forMoney} vs ${against} over ${ROUNDS}`);
  ok('and it carries most of them', won > ROUNDS / 2, `${won}/${ROUNDS}`);
}

// --- through the action --------------------------------------------------------
{
  const { w: w3, pid: p3 } = mk();
  const c = CO.found(w3, p3, 'Donor Co').company; c.cash = 200e6; c.valuation = 40e6;
  ACT.apply(w3, { type: 'DONATE_PARTY', playerId: 'p1', party: 'conservative', amount: 20e6 });
  ok('the donate action moves the money and the influence', (w3.partyFunds?.conservative || 0) === 20e6 && CO.partyInfluence(w3, 'conservative') > 0);
}

// --- Money of your own ------------------------------------------------------
// Every channel used to spend a *company's* cash, so a founder who sold up had
// the proceeds in his pocket and no way to spend a penny of them on politics —
// and someone who had never founded anything could not give at all.
{
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  const pid = w.players.p1.personaId;
  const me = w.personas[pid];
  me.wallet = 40e6;
  ok('a private citizen with no company can still give',
    CO.donateParty(w, null, pid, 'liberal', 10e6, { from: 'wallet' }).ok === true);
  ok('and it comes out of their own pocket', me.wallet === 30e6, String(me.wallet));
  ok('into the same pot the companies give to', (w.partyFunds?.liberal || 0) === 10e6);
  ok('they cannot give what they do not have',
    CO.donateParty(w, null, pid, 'liberal', 500e6, { from: 'wallet' }).value.given === 30e6
    && me.wallet === 0);
  ok('and an empty pocket is an empty pocket',
    CO.donateParty(w, null, pid, 'liberal', 1e6, { from: 'wallet' }).ok === false);

  // The same caps, on the same record.
  me.wallet = 60e6;
  const cand = Object.values(w.personas).find((x) => x.id !== pid);
  CO.donateCampaign(w, null, pid, cand.id, 50e6, { from: 'wallet' });
  ok('a personal cheque is capped like any other',
    (w.campaignFunds[cand.id].capped) === CO.CAMPAIGN_DONATION_CAP && me.wallet === 50e6);

  // And through the door the UI actually uses, which is where it has to say
  // whose money it was.
  me.wallet = 9e6;
  ACT.apply(w, { type: 'DONATE_PARTY', playerId: 'p1', party: 'conservative', amount: 5e6, from: 'wallet' });
  ok('the action moves personal money', (w.partyFunds?.conservative || 0) === 5e6 && me.wallet === 4e6);
  ok('and the record says it was theirs',
    w.chronicle.some((e) => /of their own money to the/.test(e.text)),
    (w.chronicle.filter((e) => /own money/.test(e.text)).at(-1) || {}).text || 'no line');
}

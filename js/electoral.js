// The Electoral College.
//
// The presidency used to be decided by national popular vote with a runoff if
// nobody cleared half — which is a perfectly good way to elect a head of state
// and is not the American one. HANDOFF.md listed it under "Still not American,
// and known". This is that item.
//
// The arithmetic lives here and the vote model stays in sim.js. This module is
// handed a way to ask "how would this state break?" and does the counting: it
// never touches appeal, partisanship or turnout, so there is exactly one place
// in the codebase that decides how a citizen votes and it is not this one.
import * as R from './rules.js';

/**
 * How many electors each state gets.
 *
 * Article II: "a Number of Electors, equal to the whole Number of Senators and
 * Representatives to which the State may be entitled". So it is counted rather
 * than configured — the electors are the chairs, and a table that amends the
 * chambers at the convention moves the college with them for free.
 *
 * Note the total is 65 for the states rather than the 538-scaled figure an
 * American might expect, and that is not an approximation: this republic seats
 * forty-five representatives and *one* senator per state, not two. Two would be
 * the same district election run twice and would return the same person twice —
 * see HANDOFF.md on why the Senate is one seat per state — so a state's whole
 * delegation is its House members plus its senator. Sixty-five, plus three for
 * the District of Columbia, is sixty-eight.
 */
export function electorsOf(world) {
  const byState = {};
  for (const d of world.districts || []) byState[d.id] = 0;
  for (const seat of world.seats || []) {
    const o = R.office(world, seat.office);
    // Elected chairs that answer to a state. Appointive posts and the executive
    // are nobody's delegation.
    if (!o || o.selection !== 'election' || !seat.district) continue;
    if (seat.district in byState) byState[seat.district] += 1;
  }
  const dc = world.dc?.electors || 0;
  const total = Object.values(byState).reduce((n, v) => n + v, 0) + dc;
  return { byState, dc, total };
}

/** The number that wins it. A majority of the whole college, not of those cast. */
export const majority = (total) => Math.floor(total / 2) + 1;

/**
 * The count, state by state.
 *
 * `splitOf(place)` is supplied by the caller and returns `[{ personaId, votes }]`
 * for one state — the same function that decides a district election, so a
 * presidential vote in Texas breaks the way a Texan congressional one does.
 *
 * Winner-take-all, which is what forty-eight states do. Maine and Nebraska split
 * theirs by congressional district and are not modelled: this atlas merges them
 * into regions that do not exist as states, so there is nothing to split.
 */
export function countCollege(world, splitOf) {
  const el = electorsOf(world);
  const tally = {};
  const byState = [];
  const places = [...(world.districts || [])];
  if (world.dc) places.push(world.dc);
  for (const place of places) {
    const seats = place.id === 'dc' ? el.dc : (el.byState[place.id] || 0);
    if (!seats) continue;
    const split = splitOf(place) || [];
    if (!split.length) continue;
    const won = split.slice().sort((a, b) => b.votes - a.votes)[0];
    if (!won) continue;
    tally[won.personaId] = (tally[won.personaId] || 0) + seats;
    const cast = split.reduce((n, c) => n + c.votes, 0) || 1;
    byState.push({
      place: place.id,
      name: place.name,
      electors: seats,
      winner: won.personaId,
      share: won.votes / cast,
      split,
    });
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const need = majority(el.total);
  const leader = ranked[0] || null;
  return {
    electors: el,
    tally,
    byState,
    need,
    // A leader is not a winner. Nobody reaching the majority is a real outcome
    // and it has its own procedure — see `contingentField`.
    winner: leader && leader[1] >= need ? leader[0] : null,
    leader: leader ? leader[0] : null,
    ranked,
  };
}

/**
 * The Twelfth Amendment's contingent election.
 *
 * If no candidate has a majority of the college the House chooses, from the top
 * three, and — the part everyone forgets — **each state delegation casts one
 * vote**, so Wyoming and California weigh the same. A delegation that splits
 * evenly casts nothing at all.
 *
 * This is the one place in the game where a chamber votes by state rather than
 * by head, which is why it is written out here rather than routed through
 * `rules.voteRequirement` like every other vote.
 */
export const contingentField = (result) => result.ranked.slice(0, 3).map(([id]) => id);

/**
 * How each state's House delegation would cast its single vote.
 *
 * `prefer(personaId, member)` returns that member's ranking of a candidate;
 * highest wins their vote. Supplied by the caller so the preference model stays
 * with the rest of the political simulation.
 */
export function contingentVote(world, field, prefer) {
  const byState = {};
  for (const seat of world.seats || []) {
    const o = R.office(world, seat.office);
    // The House alone: an apportioned, district-elected chamber. The Senate has
    // no part in choosing the President (it chooses the Vice President, which
    // this game does not separate out).
    if (!o || !o.apportioned || !seat.district || !seat.personaId) continue;
    (byState[seat.district] ||= []).push(seat.personaId);
  }
  const tally = {};
  const delegations = [];
  for (const [stateId, members] of Object.entries(byState)) {
    const score = {};
    for (const m of members) {
      let best = null, bestV = -Infinity;
      for (const cand of field) {
        const v = prefer(cand, m);
        if (v > bestV) { bestV = v; best = cand; }
      }
      if (best) score[best] = (score[best] || 0) + 1;
    }
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    // A tied delegation casts no vote. That is the rule, and it is how a
    // contingent election deadlocks.
    const decided = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
    if (decided) tally[decided] = (tally[decided] || 0) + 1;
    delegations.push({ state: stateId, members: members.length, vote: decided, score });
  }
  const states = (world.districts || []).length;
  const need = Math.floor(states / 2) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return {
    tally, delegations, need, ranked,
    winner: ranked.length && ranked[0][1] >= need ? ranked[0][0] : null,
  };
}

// What the table will not print.
//
// Silver hands players a printing press and a legislature and asks them to be
// awful to each other with them — that is the game. This module draws the one
// line the game does not let you cross with those tools, and prices the ground
// just short of it.
//
// Two tiers, deliberately different in kind:
//
//   'slur'  — racial and ethnic slurs. Refused outright. This is not a game
//             rule the constitution can amend away and not a penalty you may
//             choose to eat; the act simply does not happen, and nothing is
//             written to the record. A table rule, enforced at the door.
//
//   'incite' — dehumanising and eliminationist rhetoric aimed at a group:
//             vermin, subhuman, racial purity, mass expulsion. This IS in the
//             game. A republic can produce this and history says it does, so
//             the engine lets it through and makes it cost — the paper loses
//             its credibility, the chamber turns on the bill, the districts
//             remember, and the court gets grounds it will act on.
//
// The split matters. Refusing everything would let the game pretend a republic
// cannot go that way. Pricing everything would make a slur a strategy with a
// known cost. Neither is the intent.

// --- Normalisation — obfuscation is the whole game for anyone trying it ----

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

/** Lowercase, de-accent, un-leet, and collapse runs of a repeated letter. */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[0134579@$!|]/g, (c) => LEET[c] || c)
    .replace(/(.)\1{2,}/g, '$1$1');
}

/**
 * A second pass with every non-letter thrown away, so "n-i-g..." and "n i g..."
 * collapse to the same string. Checked separately from the spaced text because
 * squashing everything creates its own false positives across word joins.
 */
const squash = (s) => normalize(s).replace(/[^a-z]/g, '');

// --- The lists -------------------------------------------------------------

// Refused outright. Stems, matched on a word boundary in the spaced text and
// as a substring in the squashed text.
const SLURS = [
  'nigger', 'nigga', 'niggr', 'coon', 'jigaboo', 'porchmonkey',
  'kike', 'heeb', 'yid',
  'spic', 'wetback', 'beaner', 'greaser',
  'chink', 'gook', 'jap', 'slant eye', 'slanteye', 'zipperhead',
  'raghead', 'towelhead', 'sandnigger', 'camel jockey',
  'paki', 'currymuncher',
  'wop', 'dago', 'guinea pig eater', 'mick',
  'gyppo', 'gypo', 'gippo',
  'abo', 'boong', 'coolie', 'halfbreed', 'half breed', 'mulatto',
  'redskin', 'injun', 'squaw', 'prairie nigger',
  'kaffir', 'kafir slur', 'hottentot',
  'jungle bunny', 'junglebunny', 'tar baby', 'spearchucker', 'spear chucker',
];

/**
 * How short a stem may be and still be hunted *inside* a word.
 *
 * The squashed pass throws away every non-letter so that "n-i-g-g-e-r" and
 * "n i g g e r" collapse to the same string. That is the right defence against
 * obfuscation and the wrong one for a three-letter stem: `abo` is a substring of
 * aboard, labour, labor, laboratory, sabotage, taboo, elaborate, collaborate,
 * seaborne and laborious, and `chink` is a substring of "chinks in the armour".
 * All of those were refused outright — in a game about a *legislature*, the word
 * "labour" could not be said on the floor, in a bill, or in a newspaper.
 *
 * The guard was a hand-kept list of innocent words (below), which is a blocklist
 * of exceptions to a blocklist: it can never be finished, and every word nobody
 * thought of is a player being told they used a racial slur when they did not.
 *
 * So the rule is now structural rather than enumerated. A stem is hunted inside
 * words only if it is long enough that an accidental English collision is not
 * credible; anything shorter has to appear as a whole word. The short stems are
 * still caught — `\babo\b` is still refused, and normalisation still un-leets
 * and de-accents before that test — they simply cannot be found buried in the
 * middle of an ordinary word any more.
 */
const SQUASH_MIN = 6;

// Real words that contain a stem above. Still needed for the long stems that do
// collide — Nigeria against `nigger`, and so on.
const INNOCENT = [
  'niger', 'nigeria', 'nigerian', 'nigerien',
  'japan', 'japanese', 'jape',
  'cocoon', 'raccoon', 'tycoon', 'lagoon', 'cocoons', 'raccoons',
  'michael', 'mickey', 'mica',
  'guinea', 'guinean',
  'spice', 'spicy', 'spices', 'suspicion', 'auspicious', 'conspicuous',
  'abode', 'about', 'above', 'abort', 'abolish', 'abolition', 'aboriginal',
  'egypt', 'egyptian',
  'kafir', 'kafiristan',
  'wopen', 'weapon', 'weapons',
  'paksitan', 'pakistan', 'pakistani',
  'bunny', 'bunnies',
];

// Who a sentence is talking about, when a rule needs it to be talking about a
// people rather than about actual rats in an actual warehouse.
const GROUP = /\b(races?|racial|ethnics?|ethnicity|immigrants?|migrants?|foreigners?|aliens?|refugees?|natives?|jews?|jewish|muslims?|arabs?|blacks?|asians?|latinos?|gypsies|roma|these people|those people|their kind|our kind|bloodlines?|stock|breed)\b/;

// Priced, not refused. `re` fires on its own; `near` fires only in a sentence
// that is also about a group, so "rats in the harbour" stays a rat problem.
// Each carries the ground a court would name in its opinion.
const INCITEMENT = [
  { re: /\b(sub[- ]?humans?|not (?:fully )?human|less than human|untermensch\w*)\b/, ground: 'it denies a class of citizens their humanity' },
  { near: /\b(vermin|cockroach(?:es)?|rats?|parasites?|infestations?|infest\w*|swarm\w*|plague)\b/, ground: 'it describes a class of citizens as vermin' },
  { re: /\b(racial(?:ly)? (?:purity|hygiene|cleansing|superiority)|purity of (?:the )?(?:race|blood)|master race|blood and soil|ethnic(?:ally)? cleans\w*)\b/, ground: 'it makes a doctrine of racial purity' },
  { near: /\b(final solution|exterminat\w+|eradicat\w+|wipe (?:them |it |the \w+ )?out|purge|cull)\b/, ground: 'it calls for the destruction of a class of citizens' },
  { near: /\b(deport|expel|expuls\w+|round(?:ed)? up|drive out|banish)\b/, ground: 'it orders a class of citizens expelled for what they are' },
  { near: /\b(inferior|degenerate|impure|mongrel|polluted|defiled|unclean)\b/, ground: 'it ranks citizens by blood' },
  { near: /\b(traitors? by blood|race traitors?|defilement|contaminat\w+|pollut\w+ (?:the )?(?:blood|stock|race))\b/, ground: 'it makes an offence of a citizen’s ancestry' },
];

// --- The scan --------------------------------------------------------------

/**
 * Scan a body of text.
 * @returns {{ok: true} | {ok: false, tier: 'slur'} | {ok: true, tier: 'incite', grounds: string[]}}
 */
export function scan(...parts) {
  const raw = parts.filter(Boolean).join('\n');
  if (!raw.trim()) return { ok: true };
  const spaced = normalize(raw);
  const squashed = squash(raw);

  // Strip the legitimate words out of the squashed text first, so "Nigeria"
  // cannot leave a stem behind for the substring pass to find.
  let cleaned = squashed;
  for (const w of INNOCENT) cleaned = cleaned.split(w.replace(/[^a-z]/g, '')).join('·');

  for (const s of SLURS) {
    const spacedHit = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(spaced);
    const bare = s.replace(/[^a-z]/g, '');
    // Short stems are whole words or nothing — see SQUASH_MIN.
    const squashHit = bare.length >= SQUASH_MIN && cleaned.includes(bare);
    if (spacedHit || squashHit) return { ok: false, tier: 'slur' };
  }

  // Proximity rules are judged a sentence at a time, in either order, so
  // "the immigrants are vermin" and "vermin, these immigrants" both land while
  // "rats in the harbour warehouses" stays a rat problem.
  const sentences = spaced.split(/[.!?;\n]+/).filter((x) => x.trim());
  const grounds = [];
  for (const r of INCITEMENT) {
    const hit = r.re
      ? r.re.test(spaced)
      : sentences.some((s) => r.near.test(s) && GROUP.test(s));
    if (hit && !grounds.includes(r.ground)) grounds.push(r.ground);
  }
  if (grounds.length) return { ok: true, tier: 'incite', grounds };

  return { ok: true };
}

/** The refusal the player sees. Says what and why, without repeating it back. */
export const REFUSAL = 'That contains a racial slur. Silver will not print, file or record it — a rule of the table, not the constitution, and no office or majority can lift it. Say it another way.';

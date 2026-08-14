// The line the table will not cross, and the ordinary words on the near side of it.
//
// conduct.scan has two failure directions and only one of them is obvious. A
// filter that misses a slur fails at the thing it is for. A filter that refuses
// "labour" tells a player they used a racial slur when they did not, in a game
// whose whole subject is a legislature — and that is the one that had happened.
//
// The squashed pass throws away every non-letter so obfuscation collapses to the
// same string. Applied to a three-letter stem it finds `abo` inside aboard,
// labour, laboratory, sabotage, taboo, elaborate, collaborate and seaborne, and
// `chink` inside "chinks in the armour". The guard was a hand-kept list of
// innocent words, which is a blocklist of exceptions to a blocklist and can
// never be finished. See conduct.SQUASH_MIN for the structural rule that
// replaced it. Both directions are pinned here because tightening either one
// loosens the other, and only a test can hold them apart.
const base = new URL('../js/', import.meta.url).href;
const C = await import(base + 'conduct.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// --- ordinary speech is not a slur ---------------------------------------------
//
// Every one of these was refused outright before SQUASH_MIN. They are not
// obscure: this is the vocabulary of the game's own subject matter.
const INNOCENT = [
  'labour', 'labor', 'laboratory', 'laborious', 'collaborate', 'collaboration',
  'elaborate', 'sabotage', 'saboteur', 'aboard', 'seaborne', 'taboo',
  'chinks in the armour', 'carbohydrate', 'harbour', 'neighbour', 'neighbours',
  'friends', 'friends aboard', 'my friends and collaborators',
  'the labour question', 'a labor dispute in the harbour',
  'Nigeria', 'Japan', 'Japanese', 'raccoon', 'cocoon', 'tycoon', 'lagoon',
  'Michael', 'mickey', 'guinea pig', 'spice', 'spicy', 'suspicion', 'auspicious',
  'about', 'above', 'abolish', 'abolition', 'aboriginal', 'weapon', 'weapons',
  'Pakistan', 'bunny', 'Egypt', 'the abode', 'abort the motion',
];
const wrongly = INNOCENT.filter((s) => !C.scan(s).ok);
ok('ordinary words are not refused as slurs', wrongly.length === 0, wrongly.join(', ') || 'none');

const inSentence = INNOCENT.filter((s) => !C.scan(`The chamber will hear the ${s} matter today.`).ok);
ok('and not inside a sentence either', inSentence.length === 0, inSentence.join(', ') || 'none');

// --- but the line still holds ---------------------------------------------------
//
// Kept oblique on purpose: the stems live in conduct.js and this file asserts
// that the machinery works, not a second copy of the list.
{
  const stems = ['nigger', 'kike', 'spic', 'chink', 'gook', 'wop', 'paki', 'abo', 'coon'];
  const missed = stems.filter((s) => C.scan(`they are all ${s}s and worse`).ok
    && C.scan(`a ${s} said so`).ok);
  ok('the slurs themselves are still refused outright', missed.length === 0, missed.join(', ') || 'none');

  // Obfuscation still fails for the long stems, which are the ones anybody
  // actually bothers to disguise.
  ok('leet spelling is still caught', !C.scan('n1gg3r').ok);
  ok('spaced-out spelling is still caught', !C.scan('n i g g e r').ok);
  ok('and a slur inside a longer word is still caught', !C.scan('sandniggers').ok);

  // A known and deliberate limit, pinned so nobody "fixes" it by accident.
  // normalize collapses a run of three or more to *two*, not to one. Collapsing
  // to one would catch "niiigggeeer" — and would also make `nigger` and the
  // country Niger the same string, which is the collision the INNOCENT list
  // exists to prevent and cannot prevent once the letters are gone. Padding is
  // the one obfuscation this filter does not defeat, and that is the price of
  // not refusing a country's name.
  ok('padding is a known gap, not a regression', C.scan('niiigggeeer').ok === true);
}

// --- the second tier is priced, not refused --------------------------------------
{
  const r = C.scan('These immigrants are vermin and must be driven out.');
  ok('eliminationist rhetoric is allowed through', r.ok === true);
  ok('but it carries grounds', r.tier === 'incite' && r.grounds.length > 0,
    JSON.stringify(r.grounds || []));

  const rats = C.scan('There are rats in the harbour warehouses again.');
  ok('while actual rats stay a rat problem', rats.ok === true && !rats.tier,
    JSON.stringify(rats));
}

// --- empty input ------------------------------------------------------------------
ok('nothing to scan is fine', C.scan('').ok && C.scan(null, undefined).ok);

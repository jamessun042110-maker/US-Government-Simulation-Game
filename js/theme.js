// Light and dark.
//
// The stylesheet carries one theme block, `:root[data-theme="dark"]`, and this
// module decides which theme is on the root element. A preference is one of
// three things: 'light', 'dark', or 'system'.
//
// **Dark is the default.** Silver is played at night and the game is mostly dark
// surfaces, pixel scenes lit from inside and a map of a sea — walking in on the
// parchment version is walking in on the wrong game. Following the machine used to
// be the default, which meant anyone on a light desktop got the bright build
// without ever choosing it. The system is now only consulted if the player asks
// for that explicitly by choosing 'system'.
//
// The resolution happens here rather than in a CSS media query so that an
// explicit choice can override the system in both directions. index.html
// repeats the first few lines inline, before the stylesheet paints, so the app
// never flashes the wrong theme on load.

const KEY = 'silver.theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The stored preference: 'light' | 'dark' | 'system'. Absent means dark. */
export function themePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
  } catch { return 'dark'; }
}

/** What that preference actually resolves to right now: 'light' | 'dark'. */
export function resolvedTheme() {
  const p = themePref();
  return p === 'system' ? (mq().matches ? 'dark' : 'light') : p;
}

function apply() {
  document.documentElement.dataset.theme = resolvedTheme();
}

/** Set the preference and repaint. Pass 'system' to hand control back. */
export function setTheme(pref) {
  try {
    // 'system' is stored rather than cleared. An absent key now means dark, so
    // removing it would silently turn "follow my machine" into "always dark".
    localStorage.setItem(KEY, pref === 'system' ? 'system' : pref);
  } catch { /* private mode: the choice lasts the session, which is enough */ }
  apply();
}

/** Flip to the opposite of what is on screen, whatever got us there. */
export function toggleTheme() {
  setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
  return resolvedTheme();
}

/**
 * Apply now, and keep following the system while the preference says to. The
 * callback lets the render loop repaint anything drawn in JS rather than CSS.
 */
export function initTheme(onChange) {
  apply();
  mq().addEventListener('change', () => {
    if (themePref() !== 'system') return; // an explicit choice outranks the OS
    apply();
    onChange?.(resolvedTheme());
  });
}

// --- Regime colours after dark ---------------------------------------------

/**
 * A regime's brand is chosen against a bright page: imperial wine (#8c1d18) is
 * a strong colour on parchment and a smudge on a dark one. Rather than keep a
 * second palette in every template, lift the colour's luminance until it can
 * carry the wordmark against a dark ground, holding its hue so an empire still
 * reads as wine and a republic still reads as blue.
 */
export function liftForDark(hex, minL = 0.58) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2;
  const d = max - min;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  if (l >= minL) return hex;
  // Very saturated colours go luminous rather than pastel if we only raise L,
  // so ease the saturation back as the colour is lifted.
  const nl = minL;
  const ns = Math.min(s, 0.62);
  const c = (1 - Math.abs(2 * nl - 1)) * ns;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const mm = nl - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  const to = (v) => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return '#' + to(seg[0]) + to(seg[1]) + to(seg[2]);
}

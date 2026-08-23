// The view out of the window.
//
// Each office-only room gets one: the Oval Office looks across the desk at the
// south windows, the Supreme Court stands at the top of its own steps under the
// portico, and the Cloakroom looks off its balcony down the mall. They do nothing.
// That is the point — a private room with no weather in it reads as a menu, and
// these rooms are meant to feel like somewhere you are standing at the end of a
// long day.
//
// ── Pixels, all the way through ────────────────────────────────────────────
//
// This is rasterised, not drawn. Every element goes into a grid 240 pixels across
// (see pixel.js) and the grid is what gets emitted, so the wall, the drapes, the
// desk and the rug are made of the same square pixels as the sky outside. Built
// out of SVG shapes — a path for a drape, an ellipse for the rug — only the parts
// small enough to be seen through a window read as pixel art at all, and scaling
// that up cannot fix it: the geometry has to be pixels to begin with. So the
// rug's curve is a stair, and so is the arch over each window. Shading is ordered
// dithering throughout: a gradient is two colours and a Bayer pattern, never a fill.
//
// ── What moves, and what does not ─────────────────────────────────────────
//
// One frame a second is not an animation, so nothing moves on the tick. Two
// separate things happen instead.
//
// The weather is a real CSS animation, the way the inauguration confetti is —
// smooth at whatever frame rate the browser is running at. The scene markup is
// rebuilt every render, which would normally restart it from zero, so each
// particle's `animation-delay` is set from the wall clock: a freshly built
// element starts mid-fall at the phase it would have been at.
//
// The season is the only thing the clock touches. Every 60 ticks it moves a
// quarter of the way toward the next, so a full turn takes one canon year and
// the light changes in four visible steps rather than drifting imperceptibly.

import { Canvas } from './pixel.js';
import { FLAG, clamp } from './util.js';

// --- Colour ----------------------------------------------------------------

const hex = (s) => {
  let h = String(s).replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
};
const rgb = ([r, g, b]) => '#' + [r, g, b]
  .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Blend two hex colours. t=0 is a, t=1 is b. */
export function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return rgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
const dark = (c, t) => mix(c, '#000000', t);
const lite = (c, t) => mix(c, '#ffffff', t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Deterministic scatter, so the stars and the trees stay where they were put.
function h1(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
const h2 = (a, b) => h1(a * 1.618 + b * 31.7);

// --- The four seasons ------------------------------------------------------
// One palette each, not a day and a night pair. `dim` is how low the light is —
// winter is a pale cold twilight, summer is flat noon — and it decides whether the
// lamps are lit and the stars are out.

const SEASONS = [
  {
    name: 'Winter', dim: 0.42, fall: 'snow',
    sky: ['#4d6c8c', '#7c9cb8', '#adc6d6', '#d6e4ea'],
    ground: '#e4ebef', groundLo: '#bccbd4', far: '#7e94a6', hill: '#9db0bf',
    trunk: '#54463a', leaf: null, stone: '#d6d1c8', warm: '#ffd88f',
  },
  {
    name: 'Spring', dim: 0.12, fall: 'rain',
    sky: ['#4d89c0', '#7cadd3', '#b0cee2', '#dae8ee'],
    ground: '#84ba62', groundLo: '#5c9046', far: '#77a064', hill: '#8fb474',
    trunk: '#594935', leaf: '#78c058', stone: '#ece4d2', warm: '#ffeec0',
  },
  {
    name: 'Summer', dim: 0.0, fall: null,
    sky: ['#2d7cc0', '#63a5d5', '#a0c8e1', '#d5e7ee'],
    ground: '#63a048', groundLo: '#417b31', far: '#4a8639', hill: '#5a9243',
    trunk: '#4c3e27', leaf: '#4c9839', stone: '#efe9da', warm: '#fff3d0',
  },
  {
    name: 'Autumn', dim: 0.55, fall: 'leaves',
    sky: ['#3f5878', '#8a7a75', '#c9925e', '#ecc48a'],
    ground: '#8e7743', groundLo: '#695830', far: '#7c5f33', hill: '#8c6c3c',
    trunk: '#4d3a26', leaf: '#cf7d37', stone: '#ddd2bc', warm: '#ffd99c',
  },
];

// A quarter of the way to the next season every 60 ticks: four steps to a season,
// 240 ticks — one canon year — to a full turn.
const STEP_TICKS = 60;
const STEPS_PER_SEASON = 4;

/** Which season, and how far toward the next one. */
export function seasonAt(world) {
  const tick = Math.max(0, world?.clock?.tick || 0);
  const step = Math.floor(tick / STEP_TICKS);
  const i = Math.floor(step / STEPS_PER_SEASON) % SEASONS.length;
  const blend = (step % STEPS_PER_SEASON) / STEPS_PER_SEASON;
  return { i, blend, step, name: SEASONS[i].name, next: SEASONS[(i + 1) % SEASONS.length].name };
}

/** The palette right now: this season, blended a quarter at a time into the next. */
export function palette(world) {
  const { i, blend } = seasonAt(world);
  const a = SEASONS[i], b = SEASONS[(i + 1) % SEASONS.length];
  const P = { season: a.name, blend, dim: a.dim + (b.dim - a.dim) * blend };
  P.sky = a.sky.map((c, n) => mix(c, b.sky[n], blend));
  for (const k of ['ground', 'groundLo', 'far', 'hill', 'trunk', 'stone', 'warm']) {
    P[k] = mix(a[k], b[k], blend);
  }
  // Bare branches until spring is more than half in, and bare again once autumn is
  // more than half gone.
  P.leaf = a.leaf && b.leaf ? mix(a.leaf, b.leaf, blend)
    : a.leaf ? (blend < 0.5 ? a.leaf : null)
      : (blend >= 0.5 ? b.leaf : null);
  // The one that is falling: whichever season we are mostly in.
  P.fall = blend < 0.5 ? a.fall : b.fall;
  P.lampsLit = P.dim > 0.3;
  return P;
}

// --- Static scenery --------------------------------------------------------

function stars(C, P, seed, x, y, w, h, n) {
  if (P.dim < 0.34) return;
  const v = clamp01((P.dim - 0.34) / 0.3);
  for (let i = 0; i < n; i++) {
    if (h2(seed + 5, i) > v) continue;
    C.set(x + h2(seed, i) * w, y + h2(seed + 7, i) * h, mix(P.sky[0], '#ffffff', 0.6 + v * 0.4));
  }
}

/** The sun low in winter and autumn, high in summer. Fixed for the season. */
function luminary(C, P, x0, x1, yTop, yBase) {
  const cx = x0 + (x1 - x0) * (0.24 + P.blend * 0.1);
  const cy = yBase - (1 - P.dim) * (yBase - yTop);
  if (P.dim > 0.5) {
    C.glow(cx, cy, 12, lite(P.sky[1], 0.4), 0.45);
    C.disc(cx, cy, 3, 3, '#e9eef6');
    C.disc(cx + 2, cy - 1, 2, 2, P.sky[0]);
    return;
  }
  const col = mix('#ffeaa8', '#ff9a4c', P.dim * 1.6);
  C.glow(cx, cy, 18 + P.dim * 14, col, 0.5);
  C.disc(cx, cy, 4, 4, col);
  C.disc(cx, cy, 3, 3, lite(col, 0.3));
}

function clouds(C, P, seed, y, count, span) {
  const tint = mix('#ffffff', P.sky[0], 0.28 + P.dim * 0.4);
  const shade = dark(tint, 0.16);
  for (let i = 0; i < count; i++) {
    const x = Math.round(h2(seed + 3, i) * (span - 20));
    const yy = Math.round(y + h2(seed + 11, i) * 6);
    const w = 10 + Math.round(h2(seed + 5, i) * 16);
    C.rect(x, yy + 2, w, 2, shade);
    C.rect(x + 1, yy, w - 2, 2, tint);
    C.rect(x + Math.round(w * 0.3), yy - 2, Math.round(w * 0.4), 2, tint);
  }
}

function birds(C, P, seed, y, span) {
  if (P.dim > 0.45) return;
  const ink = mix('#1a2740', P.sky[1], 0.3);
  for (let i = 0; i < 3; i++) {
    const x = Math.round(20 + h2(seed, i) * (span - 40));
    const yy = Math.round(y + h2(seed + 2, i) * 6);
    C.set(x, yy, ink);
    C.set(x - 1, yy - 1, ink);
    C.set(x + 1, yy - 1, ink);
  }
}

function tree(C, P, seed, x, groundY, hgt) {
  C.rect(x, groundY - hgt, 1, hgt, P.trunk);
  if (!P.leaf) {
    for (let i = 0; i < 3; i++) {
      const ty = groundY - hgt + i * 2 + 1;
      const len = Math.max(2, Math.round(hgt * 0.3) - i);
      C.line(x, ty, x - len, ty - len, P.trunk);
      C.line(x, ty + 1, x + len, ty - len + 1, P.trunk);
    }
    if (P.fall === 'snow') C.rect(x - 2, groundY - hgt - 1, 5, 1, '#eef4f7');
    return;
  }
  const r = Math.max(2, Math.round(hgt * 0.42));
  C.disc(x, groundY - hgt - r + 1, r, r - 1, dark(P.leaf, 0.26));
  C.disc(x, groundY - hgt - r, r - 1, r - 2, P.leaf);
  C.disc(x - 1, groundY - hgt - r - 1, Math.max(1, r - 3), Math.max(1, r - 3), lite(P.leaf, 0.18));
}

function block(C, P, x, y, w, h, cols, rows) {
  const face = mix(P.stone, P.far, 0.45);
  C.rect(x, y, w, h, face);
  C.rect(x, y, 2, h, dark(face, 0.22));
  C.rect(x, y, w, 1, lite(face, 0.12));
  const gx = Math.max(1, Math.floor((w - 4) / cols)), gy = Math.max(1, Math.floor((h - 3) / Math.max(1, rows)));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = P.lampsLit && h2(x + y, r * 9 + c) < 0.62;
      C.rect(x + 3 + c * gx, y + 2 + r * gy, 2, 2, on ? P.warm : dark(face, 0.34));
    }
  }
}

function dome(C, P, cx, baseY, w) {
  const st = P.stone, sh = dark(st, 0.3), hi = lite(st, 0.14);
  const h = Math.round(w * 0.75);
  C.rect(cx - w / 2, baseY - h * 0.3, w, h * 0.3, st);
  C.rect(cx - w / 2, baseY - h * 0.3, 2, h * 0.3, sh);
  C.tri(cx - w / 2 - 1, baseY - h * 0.3, cx, baseY - h * 0.55, cx + w / 2 + 1, baseY - h * 0.3, hi);
  const dr = Math.max(2, Math.round(w * 0.22));
  C.disc(cx, baseY - h * 0.55, dr, dr, st);
  C.disc(cx - 1, baseY - h * 0.55 - 1, dr - 1, dr - 1, hi);
  C.rect(cx, baseY - h * 0.55 - dr - 2, 1, 3, sh);
}

function flag(C, P, x, y, h, color) {
  C.rect(x, y, 1, h, dark(P.stone, 0.5));
  const lo = dark(color, 0.32);
  for (let c = 0; c < 4; c++) C.rect(x + 1 + c * 2, y + 1, 2, 4, c % 2 ? lo : color);
}

/**
 * A party's colours, flown beside the national flag.
 *
 * The Stars and Stripes is not repainted for whoever won — it is the country's,
 * not the administration's, and an inauguration that recolours it reads as a
 * different flag rather than as a different president. What an inauguration
 * actually does is dress the building: the party that took the office hangs its
 * own colours either side of the national one. So this is a plain banner in one
 * colour, with a paler band through it so it has cloth in it, and it takes the
 * room's light the way `nationalFlag` does.
 */
function partyFlag(C, P, x, y, h, color) {
  const d = P.dim * 0.5;
  const body = mix(color, '#14161f', d);
  const band = lite(body, 0.22);
  const fold = dark(body, 0.3);
  C.rect(x, y, 1, h, dark(P.stone, 0.5));        // the staff
  const W = 9, ROWS = 6;
  C.rect(x + 1, y + 1, W, ROWS, body);
  C.rect(x + 1, y + 3, W, 1, band);              // the band, a third of the way down
  C.rect(x + W, y + 1, 1, ROWS, fold);           // a fold down the fly
}

/**
 * The national flag: purple at the hoist, gold at the fly, a black disc on the
 * seam. Colours from util.FLAG so the pixel scenes, the inauguration tableau
 * and the title screen fly the same one.
 *
 * The dim is applied here rather than by the caller — a flag is cloth in a lit
 * room, and it has to sink into the room's light the way the walls do.
 */
function nationalFlag(C, P, x, y, h) {
  const d = P.dim * 0.5;
  const red = mix(FLAG.red, '#2a0c10', d);
  const white = mix(FLAG.white, '#2c2c34', d);
  const blue = mix(FLAG.blue, '#080c1c', d);
  C.rect(x, y, 1, h, dark(P.stone, 0.5));   // the staff
  // Eleven across, seven down. Seven stripes, not thirteen: at one pixel a
  // stripe, thirteen of them is a grey smear and the flag stops being a flag.
  const W = 11, ROWS = 7;
  for (let r = 0; r < ROWS; r++) C.rect(x + 1, y + 1 + r, W, 1, r % 2 === 0 ? red : white);
  // The canton, over the top four rows and two-fifths of the fly — the real
  // proportion, which is what the eye actually recognises.
  C.rect(x + 1, y + 1, 5, 4, blue);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) if ((r + c) % 2 === 0) C.set(x + 1 + c, y + 1 + r, white);
  }
  // A fold down the fly, so it hangs rather than floats.
  C.rect(x + W - 1, y + 1, 1, ROWS, dark(red, 0.3));
}

// --- The rooms -------------------------------------------------------------

// Wide and low. The Oval Office really is a shallow band of wall with three tall
// windows in it and the desk close to you — not a tall room seen across a hall.
const OVAL = { w: 240, h: 54 };

// The three windows, as geometry rather than as numbers buried in the draw: the
// weather layer needs them too, because in here the sky is only visible through
// the glass. WY/WH/WW are the opening, ARCH the height of the round head on it.
const WY = 7, WH = 24, WW = 30, ARCH = 7;
const OVAL_WX = [40, 105, 170];

/** How far in the wall cuts across row `r` of a window's arched head. */
function archInset(r) {
  if (r >= ARCH) return 0;
  const f = 1 - r / ARCH;
  return Math.round((WW / 2) * (1 - Math.sqrt(1 - f * f)));
}

function oval(world) {
  const P = palette(world);
  const C = Canvas(OVAL.w, OVAL.h);

  // The Oval Office has its own light, and it can be switched off.
  //
  // On, it is fluorescent yellow, and the darker it gets outside the more work it
  // is doing — so the room warms toward yellow as the season closes in rather than
  // going dark with it, and never falls to silhouette. Somebody is working in here.
  //
  // Off, the only light in the room is what comes through the glass, and the
  // furniture goes to shape. See world.ovalLights and the switch in VIEWS.oval.
  const on = world.ovalLights !== false;
  const lit = on
    ? (c) => dark(mix(c, '#ffdf8a', 0.08 + P.dim * 0.3), P.dim * 0.16)
    // Cool, not just dark: what is left is skylight, and skylight is blue.
    : (c) => mix(dark(c, 0.3 + P.dim * 0.5), P.sky[1], 0.1 + P.dim * 0.18);
  const wall = lit('#eee2c4');
  const trim = lit('#fdf8ec');
  const gold = lit('#c9a24a');
  const desk = lit('#6b4525');
  const floor = lit('#9a7746');

  C.vgrad(0, 0, OVAL.w, 38, [dark(wall, 0.16), wall, lite(wall, 0.05)], 2);
  C.rect(0, 0, OVAL.w, 2, dark(wall, 0.32));
  C.rect(0, 2, OVAL.w, 1, trim);

  for (const [n, wx] of OVAL_WX.entries()) {
    // The view gets its own surface, so nothing in it can spill onto the room. The
    // three windows look out on the same grounds from slightly different angles, so
    // each is drawn with its own offset into the scene rather than as a copy.
    const V = Canvas(WW, WH);
    const pan = n * 10;
    V.vgrad(0, 0, WW, Math.round(WH * 0.6), P.sky);
    stars(V, P, 3 + n, 0, 0, WW, WH * 0.5, 8);
    luminary(V, P, -20 - pan, WW + 40 - pan, 2, WH * 0.5);
    clouds(V, P, 5 + n, 4, 2, WW);
    birds(V, P, 9 + n, 8, WW);
    const hz = Math.round(WH * 0.6);
    V.rect(0, hz, WW, 2, P.far);
    V.rect(0, hz + 2, WW, WH - hz - 2, P.ground);
    V.rect(0, WH - 2, WW, 2, P.groundLo);
    tree(V, P, n, 7, hz + 3, 6);
    tree(V, P, n + 4, WW - 8, hz + 4, 5);
    C.blit(V, wx, WY);
    // Mask the arch back to wall, then ink its edge.
    for (let r = 0; r < ARCH; r++) {
      const inset = archInset(r);
      C.rect(wx, WY + r, inset, 1, wall);
      C.rect(wx + WW - inset, WY + r, inset, 1, wall);
      C.set(wx + inset, WY + r, trim);
      C.set(wx + WW - inset - 1, WY + r, trim);
    }
    C.rect(wx, WY + ARCH, 1, WH - ARCH, trim);
    C.rect(wx + WW - 1, WY + ARCH, 1, WH - ARCH, trim);
    C.rect(wx + WW / 2, WY + 2, 1, WH - 2, trim);
    C.rect(wx, WY + Math.round(WH * 0.54), WW, 1, trim);
    C.rect(wx - 1, WY + WH, WW + 2, 2, lite(trim, 0.1));
    if (P.lampsLit) C.glow(wx + WW / 2, WY + WH / 2, 14, P.warm, 0.08);

    // Drapes as vertical folds: five solid stripes, light where the cloth turns
    // toward the window and dark in the crease. A 50% dither here read as noise
    // rather than fabric, and cost nine hundred rectangles a frame to say it.
    const FOLD = [0.22, -0.1, 0.3, -0.28, 0.05];
    for (const [dxs, flip] of [[wx - 6, false], [wx + WW + 1, true]]) {
      for (let f = 0; f < 5; f++) {
        const v = FOLD[flip ? 4 - f : f];
        C.rect(dxs + f, WY - 3, 1, WH + 6, v >= 0 ? lite(gold, v) : dark(gold, -v));
      }
    }
    C.rect(wx - 8, WY - 5, WW + 16, 3, dark(gold, 0.2));
    C.rect(wx - 8, WY - 5, WW + 16, 1, lite(gold, 0.15));
  }

  nationalFlag(C, P, 96, 18, 19);
  flag(C, P, 141, 18, 19, mix('#2c4a6a', '#101a2c', P.dim * 0.5));

  C.vgrad(0, 38, OVAL.w, 16, [dark(floor, 0.18), floor, lite(floor, 0.06)]);
  for (let x = 0; x < OVAL.w; x += 9) C.rect(x, 38, 1, 16, dark(floor, 0.12));
  // The rug: the seal, on the blue oval every President since Truman has had
  // some version of. The ring of stars around the border is the detail that
  // makes it the seal rather than a blue rug with a gold hoop on it, and at two
  // pixels a star it is the largest thing on the floor that anybody will
  // actually recognise.
  const rug = mix('#24405e', '#0d1522', P.dim * 0.58);
  C.disc(120, 48, 76, 8, dark(rug, 0.2));
  C.disc(120, 48, 73, 7, rug);
  C.ring(120, 48, 62, 5, gold);
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * Math.PI * 2;
    C.set(Math.round(120 + Math.cos(t) * 55), Math.round(48 + Math.sin(t) * 4.2), lite(gold, 0.3));
  }
  // The eagle, as a shape and not as a bird: a pale body with the wings swept
  // out either side of it. Anything more at this size is three brown pixels.
  C.disc(120, 48, 11, 2, dark(gold, 0.25));
  C.rect(114, 47, 12, 1, lite(gold, 0.4));
  C.rect(117, 46, 6, 3, mix('#e8dcb8', '#3a3320', P.dim * 0.5));

  const dx = 88, dw = 64, dy = 36;
  C.rect(dx + 18, dy - 8, 28, 9, dark(desk, 0.46));
  C.rect(dx + 20, dy - 7, 24, 7, dark(desk, 0.3));
  C.rect(dx, dy, dw, 3, lite(desk, 0.3));
  C.rect(dx, dy + 3, dw, 12, desk);
  C.rect(dx + 3, dy + 5, 16, 8, dark(desk, 0.26));
  C.rect(dx + dw - 19, dy + 5, 16, 8, dark(desk, 0.26));
  C.rect(dx + 22, dy + 4, 20, 11, dark(desk, 0.36));
  C.rect(dx + 8, dy - 1, 10, 1, mix('#f6f1e2', '#54503f', P.dim * 0.5));
  C.rect(dx + 11, dy - 2, 6, 1, mix('#e8e2d0', '#4a4638', P.dim * 0.5));
  C.rect(dx + dw - 14, dy - 4, 7, 2, mix('#20364e', '#0b1220', P.dim * 0.45));
  C.rect(dx + dw - 11, dy - 2, 1, 3, dark(desk, 0.4));
  // The desk lamp: a small bright core where you are looking straight at the bulb,
  // and warm light lying on the desk around it. Only the core is stamped — a broad
  // stamp of flat warm over dark wood came out as gold grit rather than light.
  if (on && P.lampsLit) {
    C.glow(dx + dw - 11, dy - 3, 5, P.warm, 0.75);
    C.wash(dx + dw - 11, dy - 2, 22, P.warm, 0.8, 0.3);
  }
  // The overhead light, once it is doing real work: a broad warm wash across the
  // ceiling line and down the wall, so the room looks lit from inside.
  if (on && P.dim > 0.2) {
    C.wash(60, 2, 34, '#ffe6a0', 0.9, P.dim * 0.22);
    C.wash(180, 2, 34, '#ffe6a0', 0.9, P.dim * 0.22);
  }
  // Lights out: the windows are the only source left, so they throw a pale wash
  // onto the floor in front of each one and nothing else in the room is lit.
  if (!on) {
    for (const wx of OVAL_WX) {
      C.wash(wx + WW / 2, WY + WH + 7, 28, lite(P.sky[2], 0.1), 0.85, 0.2 - P.dim * 0.06);
    }
  }
  return C;
}

const COURT = { w: 240, h: 72 };

/**
 * The Supreme Court, from its own portico at the top of the steps.
 *
 * The flight is the shot. You are standing on the landing between the columns
 * looking out and *down*: the treads nearest you run nearly the full width of
 * the frame and each one above is a little narrower and a little further off,
 * until the flight lets go at the plaza and the city takes over. Drawn the old
 * way — eight low-contrast bands pinned to the bottom edge — it read as a tiled
 * floor seen from a chair, and nothing in the frame said you were up anywhere.
 */
function court(world) {
  const P = palette(world);
  const C = Canvas(COURT.w, COURT.h);

  // Nothing is lit in here. You are standing under a portico with the lights off,
  // and every photon on the stonework came off the city or the sky — so the
  // architecture darkens toward silhouette as the season closes in, and the only
  // warm light in the frame is the windows across the plaza.
  const unlit = (c, extra = 0) => mix(c, '#080b12', 0.2 + P.dim * 0.62 + extra);
  const stone = unlit(P.stone), shade = unlit(P.stone, 0.14), deep = unlit(P.stone, 0.26);
  // City spill: a faint warm edge on whatever faces the plaza, once the lights are on.
  const spill = (c) => (P.lampsLit ? mix(c, P.warm, 0.12) : c);

  // Beyond the portico: sky, then the city, then the plaza the steps come down to.
  C.vgrad(0, 0, COURT.w, 22, P.sky);
  stars(C, P, 7, 0, 1, COURT.w, 18, 34);
  luminary(C, P, 18, 222, 3, 20);
  clouds(C, P, 13, 6, 5, COURT.w);
  birds(C, P, 19, 11, COURT.w);

  C.rect(0, 20, COURT.w, 3, P.hill);
  block(C, P, 30, 12, 26, 11, 3, 3);
  block(C, P, 74, 15, 20, 8, 3, 2);
  dome(C, P, 176, 23, 24);
  block(C, P, 120, 16, 18, 7, 2, 2);
  block(C, P, 206, 14, 24, 9, 3, 2);
  C.rect(0, 23, COURT.w, 9, P.ground);
  C.rect(0, 29, COURT.w, 3, P.groundLo);
  tree(C, P, 3, 14, 24, 7);
  tree(C, P, 8, 228, 24, 8);

  // The flight. It is drawn scanline by scanline rather than step by step: the
  // width at any height is a smooth function of that height, so the cheek walls
  // running down each side come out as two unbroken splaying ramps instead of a
  // ladder of loose blocks, and no gap is left beside the narrow top treads for
  // the bare canvas to show through.
  //
  // Which *step* a scanline belongs to is a separate question from how wide it
  // is, and that is what makes it read: the spread says "receding", the tread
  // and riser banding says "steps", and you need both or you get a ramp.
  const TOP = 30, LAND = 60, N = 8;
  const insetAt = (y) => {
    const t = (y - TOP) / (LAND - TOP);
    return Math.round(56 * (1 - t) * (1 - t));
  };
  // The apron the flight sits on, so nothing behind it is ever bare canvas.
  C.rect(0, TOP - 1, COURT.w, LAND - TOP + 1, deep);
  for (let y = TOP; y < LAND; y++) {
    const t = (y - TOP) / (LAND - TOP);
    const inset = insetAt(y);
    const w = COURT.w - inset * 2;
    const i = Math.min(N - 1, Math.floor(t * N));
    const first = Math.floor(t * N) !== Math.floor(((y - 1) - TOP) / (LAND - TOP) * N);
    const last = Math.floor(t * N) !== Math.floor(((y + 1) - TOP) / (LAND - TOP) * N);
    // The flight is outdoors: the head of it stands in what daylight is left,
    // and it walks into the portico's shadow as it comes toward you. Toned with
    // the interior stone throughout it read as one dark slab with lines ruled
    // on it, so the bright end was struck from P.groundLo instead — which is
    // the *lawn*. That is a pale blue-grey in winter and passes for stone,
    // which is how it survived; in spring and summer it is grass, and the
    // Supreme Court was approached up eight steps of turf. Same gradient, both
    // ends struck from stone: full daylight on the top tread, falling to the
    // portico's shade at your feet, and darkening with the hour like the rest.
    const daylit = mix(P.stone, '#080b12', clamp01(P.dim * 0.62));
    const tread = mix(daylit, shade, 0.12 + (i / (N - 1)) * 0.72);
    C.rect(inset, y, w, 1, first ? lite(tread, 0.2) : last ? dark(tread, 0.34) : tread);
    // The cheek walls, splaying with the flight.
    for (const [n, x] of [inset - 5, COURT.w - inset].entries()) {
      C.rect(x, y, 5, 1, n === 0 ? mix(stone, shade, 0.3) : mix(shade, deep, 0.3));
      C.set(n === 0 ? x : x + 4, y, n === 0 ? lite(stone, 0.14) : dark(deep, 0.2));
    }
  }

  // The landing we are standing on, and the plinth the columns sit on.
  C.rect(0, LAND, COURT.w, COURT.h - LAND, mix(stone, shade, 0.5));
  C.rect(0, LAND, COURT.w, 1, lite(stone, 0.12));
  C.rect(0, LAND + 4, COURT.w, 1, dark(shade, 0.2));
  for (let x = 0; x < COURT.w; x += 20) C.rect(x, LAND + 5, 1, COURT.h - LAND - 5, dark(shade, 0.16));

  // The portico: ceiling overhead, columns down each edge onto the landing.
  C.rect(0, 0, COURT.w, 8, deep);
  C.rect(0, 7, COURT.w, 1, dark(deep, 0.4));
  for (let i = 0; i < 8; i++) C.rect(4 + i * 30, 2, 22, 1, lite(deep, 0.08));
  for (const [n, cx] of [4, 214].entries()) {
    C.rect(cx - 2, 8, 26, 3, lite(stone, 0.08));            // capital
    C.rect(cx, 11, 22, 45, stone);
    // The side that faces the plaza catches what light there is; the other is lost.
    const inner = n === 0 ? cx + 17 : cx;
    const outer = n === 0 ? cx : cx + 17;
    C.rect(inner, 11, 5, 45, spill(lite(stone, 0.14)));
    C.rect(outer, 11, 5, 45, deep);
    for (let f = 0; f < 5; f++) C.rect(cx + 5 + f * 3, 11, 1, 45, shade);
    C.rect(cx - 3, 56, 28, 4, lite(stone, 0.05));           // base, on the landing
    C.rect(cx - 3, 59, 28, 1, dark(shade, 0.3));
  }

  // Lamps flanking the head of the flight, where they would actually stand.
  if (P.lampsLit) {
    for (const lx of [40, 200]) {
      C.rect(lx, 48, 1, 10, deep);
      C.rect(lx - 1, 45, 3, 3, P.warm);
      C.glow(lx, 46, 4, P.warm, 0.8);
      C.wash(lx, 48, 18, P.warm, 0.8, 0.32);
    }
  }
  return C;
}

const BALC = { w: 240, h: 72 };

/**
 * The Cloakroom balcony, from a few storeys up.
 *
 * The whole shot is the vantage: you are above the city, not standing in it. So
 * the horizon sits high and shallow, the ground below takes most of the frame,
 * and the Capitol is drawn from above the level of its roofs — you see the tops
 * of its wings, the plaza in front of it and the full run of its steps, and its
 * dome tops out below the skyline instead of against it.
 *
 * The balustrade is the foreground and it is heavy: a thick coping you could put
 * a glass on, turned balusters with real weight in them, a bottom rail and the
 * stone floor underfoot. Read as a thin band it looked like track laid on the
 * ground, which is the one thing a railing must never look like.
 */
const B_HZ = 14;   // the horizon, high in the frame: we are looking down on it
const B_RY = 43;   // the top of the coping

/**
 * The Capitol, seen from above and slightly in front.
 *
 * The roofs are the tell. From street level a building is all facade; from up
 * here the top of every wing is a lit plane, and the steps open toward you.
 */
function capitol(C, P, cx, baseY) {
  const st = mix(P.stone, '#26262e', 0.18 + P.dim * 0.5);
  const roof = lite(st, 0.2);        // the roofs face the sky, so they carry it
  const face = dark(st, 0.12);
  const sh = dark(st, 0.36);
  const lit = P.lampsLit ? P.warm : mix(dark(st, 0.42), P.sky[1], 0.2);

  // The two wings, roof first.
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? cx - 58 : cx + 16;
    C.rect(x0, baseY - 7, 42, 5, face);            // facade
    C.rect(x0, baseY - 10, 42, 3, roof);           // the roof we can see over
    C.rect(x0, baseY - 10, 42, 1, lite(roof, 0.18));
    C.rect(s < 0 ? x0 : x0 + 41, baseY - 7, 1, 5, sh);
    for (let c = 0; c < 9; c++) C.rect(x0 + 3 + c * 4, baseY - 5, 2, 2, lit);
    C.rect(x0, baseY - 2, 42, 2, dark(face, 0.2)); // plinth
  }

  // The centre block and its portico.
  C.rect(cx - 17, baseY - 16, 34, 16, face);
  C.rect(cx - 17, baseY - 16, 34, 2, roof);
  C.rect(cx - 18, baseY - 14, 36, 2, lite(roof, 0.1));  // pediment cornice
  C.tri(cx - 15, baseY - 14, cx, baseY - 19, cx + 15, baseY - 14, roof);
  for (let c = 0; c < 7; c++) C.rect(cx - 13 + c * 4, baseY - 12, 2, 10, lite(face, 0.12));
  for (let c = 0; c < 7; c++) C.rect(cx - 11 + c * 4, baseY - 12, 2, 10, sh);   // between them
  C.rect(cx - 17, baseY - 2, 34, 2, dark(face, 0.2));

  // The square base the dome actually stands on.
  //
  // Without it the drum's only contact with the building was the apex of the
  // portico pediment — one pixel wide — so an eighteen-pixel drum and the whole
  // dome above it balanced on a point and read as a spire with a ball on top.
  // A dome is carried by masonry that goes all the way down to the roof, so here
  // is that masonry: narrower than the pediment, so the pediment still reads in
  // front of it, and deep enough to meet the cornice.
  C.rect(cx - 12, baseY - 20, 24, 6, dark(st, 0.06));
  C.rect(cx - 12, baseY - 20, 24, 1, lite(st, 0.14));
  C.rect(cx - 12, baseY - 20, 1, 6, lite(st, 0.08));
  C.rect(cx + 11, baseY - 20, 1, 6, dark(st, 0.22));
  for (const bx of [-8, -3, 2, 7]) C.rect(cx + bx, baseY - 18, 2, 3, sh);   // its windows

  // The drum and the dome. Ribs, not a smooth cap — the ribs are what makes it
  // read as that building and not as any dome at all.
  C.rect(cx - 9, baseY - 25, 18, 6, st);
  C.rect(cx - 9, baseY - 25, 18, 1, lite(st, 0.16));
  for (let c = 0; c < 8; c++) C.rect(cx - 7 + c * 2, baseY - 24, 1, 5, sh);
  C.disc(cx, baseY - 25, 8, 6, dark(st, 0.1));
  C.disc(cx, baseY - 26, 7, 5, st);
  C.disc(cx - 2, baseY - 27, 4, 3, lite(st, 0.14));
  for (const rx of [-5, -2, 2, 5]) C.line(cx + rx, baseY - 22, cx + Math.round(rx / 3), baseY - 30, sh);
  C.rect(cx - 2, baseY - 31, 4, 2, st);            // lantern
  C.rect(cx - 1, baseY - 31, 2, 2, lite(st, 0.2));
  C.rect(cx, baseY - 33, 1, 2, sh);                // the figure on top
  C.set(cx, baseY - 34, lite(st, 0.3));

  // The steps, splaying wider as they come toward us. This is the other half of
  // the vantage: from above you see the whole flight, not its top edge.
  for (let i = 0; i < 4; i++) {
    const w = 40 + i * 6;
    C.rect(cx - w / 2, baseY + i, w, 1, mix(lite(st, 0.1), sh, i / 5));
  }
}

/**
 * A courthouse front: plinth, colonnade, pediment.
 *
 * The Supreme Court, seen from the Senate side of the Capitol — which is where
 * it actually is, across First Street. It is drawn as a temple front rather than
 * as a dome because that is the whole difference between it and everything else
 * on this side of the river: no dome, no wings, one flight of steps and a
 * triangle on top.
 *
 * The pediment is what does the work. Without it the building is a low box with
 * stripes on it and reads as a warehouse; with it, sixteen pixels of triangle,
 * it reads as a courthouse at any size.
 */
function courthouse(C, P, cx, baseY, w, h) {
  const st = mix(P.stone, '#2b2b33', 0.06 + P.dim * 0.4);
  const face = dark(st, 0.05), sh = dark(st, 0.3), hi = lite(st, 0.2);

  // The flight of steps, splaying toward us. Deep — the real one is famously so,
  // and it is the only part of the building most people ever stand on.
  for (let i = 0; i < 5; i++) {
    const sw = w + 6 + i * 5;
    C.rect(cx - sw / 2, baseY + i, sw, 1, mix(hi, sh, i / 6));
  }

  const bodyY = baseY - h;
  C.rect(cx - w / 2, bodyY, w, h, face);
  C.rect(cx - w / 2, bodyY, w, 1, hi);

  // Eight columns. Even, so the eye finds the doorway between the middle two
  // instead of a shaft standing in it.
  const step = Math.max(3, Math.floor((w - 6) / 8));
  for (let i = 0; i < 8; i++) {
    const x = cx - w / 2 + 3 + i * step;
    C.rect(x, bodyY + 3, 1, h - 4, hi);
    C.rect(x + 1, bodyY + 3, 1, h - 4, sh);
  }
  C.rect(cx - w / 2, bodyY + 2, w, 1, sh);            // the architrave over them
  C.rect(cx - w / 2, baseY - 1, w, 1, sh);            // and the shadow under

  // The pediment: rows narrowing to a point, on a cornice a little wider than
  // the colonnade, the way an entablature oversails what holds it up.
  //
  // Its face is lit and the row under it is dark, because the whole triangle is
  // the same stone as the wall below and at seven rows of it, unshaded, the two
  // merged and the building read as a flat-topped box with stripes. A pediment
  // is only a pediment if you can see where it starts.
  const PED = 9;
  C.rect(cx - w / 2 - 3, bodyY - 2, w + 6, 2, mix(face, hi, 0.55));
  C.rect(cx - w / 2 - 3, bodyY - 1, w + 6, 1, dark(face, 0.4));
  for (let r = 0; r < PED; r++) {
    const pw = Math.max(3, w - 4 - Math.round((r / PED) * (w - 6)));
    const y = bodyY - 3 - r;
    C.rect(cx - pw / 2, y, pw, 1, mix(face, hi, 0.5));
    // The raking cornice: one lit pixel on each slope, which is what an eye
    // reads as the edge of a roof rather than as a stack of narrowing bars.
    C.set(cx - pw / 2, y, hi);
    C.set(cx + pw / 2 - 1, y, dark(face, 0.25));
    if (r > 1 && r < PED - 1) C.rect(cx - pw / 2 + 2, y, pw - 4, 1, mix(face, sh, 0.35));
  }
  C.set(cx, bodyY - 3 - PED, hi);

  if (P.lampsLit) {
    // Two lamps at the foot of the steps, and the light they throw up the stone.
    for (const lx of [cx - w / 2 - 6, cx + w / 2 + 6]) {
      C.rect(lx, baseY - 5, 1, 5, sh);
      C.rect(lx - 1, baseY - 7, 3, 2, P.warm);
      C.glow(lx, baseY - 6, 3, P.warm, 0.75);
    }
    C.wash(cx, baseY - 2, 26, P.warm, 0.55, 0.22);
  }
}

/**
 * The view off a Capitol balcony.
 *
 * Two of them, because there are two chambers and they are on opposite ends of
 * the building. A cloakroom is the one room in the game that exists twice, and
 * rendering the same picture in both made them read as one room with two doors —
 * which is exactly the thing the second chamber is not.
 *
 * - **`house`** looks west, down the Mall: the pool, the paved axis, the long
 *   view. It is the ceremonial front and the one everybody has seen.
 * - **`senate`** looks east, across First Street at the Court, over a street
 *   rather than a lawn. Closer, harder, more built-up — no water, no axis, and
 *   a city that starts at the kerb instead of half a mile away.
 *
 * Everything above the horizon and everything below the coping is shared: it is
 * the same building, the same evening and the same balustrade, seen from the
 * other end.
 */
function balcony(world, wing = 'house') {
  const P = palette(world);
  const C = Canvas(BALC.w, BALC.h);
  const senate = wing === 'senate';
  const stone = mix('#e4dac2', '#332f28', P.dim * 0.68);
  const rail = mix('#ded3b6', '#312d26', P.dim * 0.62);
  const railHi = lite(rail, 0.22), railLo = dark(rail, 0.38);

  // A shallow band of sky: looking down, there is not much of it left.
  C.vgrad(0, 0, BALC.w, B_HZ, P.sky);
  stars(C, P, 11, 0, 1, BALC.w, B_HZ - 2, 34);
  luminary(C, P, 20, 220, 2, B_HZ - 3);
  clouds(C, P, 17, 3, 5, BALC.w);
  birds(C, P, 23, 7, BALC.w);

  // The far side of the city, small because it is far. The Senate looks into
  // town rather than down a lawn, so its skyline is taller, closer together, and
  // does not part in the middle to let a view through.
  C.rect(0, B_HZ - 2, BALC.w, 3, P.hill);
  const SKY_LINE = senate
    ? [[4, B_HZ - 8, 26, 9, 4, 3], [34, B_HZ - 5, 18, 6, 3, 2], [56, B_HZ - 9, 22, 10, 3, 3],
      [82, B_HZ - 4, 16, 5, 2, 1], [148, B_HZ - 6, 20, 7, 3, 2], [172, B_HZ - 10, 24, 11, 4, 3],
      [200, B_HZ - 5, 18, 6, 3, 2], [222, B_HZ - 8, 20, 9, 3, 3]]
    : [[8, B_HZ - 6, 20, 7, 3, 2], [40, B_HZ - 4, 14, 5, 2, 1],
      [196, B_HZ - 7, 22, 8, 3, 2], [226, B_HZ - 4, 14, 5, 2, 1]];
  for (const b of SKY_LINE) block(C, P, b[0], b[1], b[2], b[3], b[4], b[5]);

  // The ground below, all the way down to the railing. It lightens toward us,
  // because near ground is out from under the haze the distance is sitting in.
  C.vgrad(0, B_HZ + 1, BALC.w, B_RY - B_HZ - 1,
    [mix(P.ground, P.far, 0.5), P.ground, lite(P.ground, 0.06)], 2);
  C.rect(0, B_RY - 4, BALC.w, 4, P.groundLo);

  const paveA = mix(P.stone, P.ground, 0.45), paveB = dark(paveA, 0.12);

  if (senate) {
    courthouse(C, P, 120, 34, 62, 13);

    // First Street between us and it: a kerb, a carriageway with a centre line,
    // and the far kerb. A street is what makes this side of the building feel
    // like a city rather than a park, and the lane markings are what make the
    // grey band read as a street at all.
    const road = mix(P.groundLo, '#22242c', 0.45);
    C.rect(0, 39, BALC.w, 1, dark(paveA, 0.2));
    C.rect(0, 40, BALC.w, 4, road);
    C.rect(0, 40, BALC.w, 1, lite(road, 0.1));
    for (let x = 4; x < BALC.w; x += 12) C.rect(x, 42, 5, 1, mix(P.warm, road, 0.55));

    // Street trees in a row along the far kerb, evenly spaced, all one size —
    // planted, not landscaped. The Mall's are staged for depth; these are civic
    // furniture and look it.
    for (let i = 0; i < 8; i++) tree(C, P, 61 + i, 12 + i * 31, 39, 5);

    if (P.lampsLit) {
      for (const lx of [22, 74, 166, 218]) {
        C.rect(lx, 33, 1, 6, dark(stone, 0.5));
        C.rect(lx - 1, 31, 3, 2, P.warm);
        C.glow(lx, 32, 3, P.warm, 0.8);
        C.wash(lx, 34, 12, P.warm, 0.7, 0.3);
      }
    }
  } else {
    capitol(C, P, 120, 37);

    // The mall in front of it: a plaza, then water, then the near lawn. Everything
    // widens as it comes down the frame.
    for (let i = 0; i < 5; i++) {
      const w = 74 + i * 22;
      C.rect(120 - w / 2, 41 + i, w, 1, i % 2 ? paveB : paveA);
    }
    const pool = mix(P.sky[1], '#10323f', 0.36);
    C.rect(74, 38, 92, 3, pool);
    C.rect(74, 38, 92, 1, lite(pool, 0.22));
    for (let x = 78; x < 166; x += 11) C.set(x, 39, lite(pool, 0.3));

    // Trees: small and dim at the horizon, bigger and nearer down the frame.
    for (const [i, t] of [[16, 20, 3], [206, 20, 3], [44, 26, 4], [190, 26, 4],
      [30, 36, 6], [212, 36, 6], [58, 41, 7], [180, 41, 7]].entries()) {
      tree(C, P, 41 + i, t[0], t[1], t[2]);
    }

    if (P.lampsLit) {
      for (const lx of [34, 96, 146, 206]) {
        C.rect(lx, 34, 1, 6, dark(stone, 0.5));
        C.rect(lx - 1, 32, 3, 2, P.warm);
        C.glow(lx, 33, 3, P.warm, 0.8);
        C.wash(lx, 34, 14, P.warm, 0.8, 0.35);
      }
    }
  }

  // -- The balustrade ------------------------------------------------------
  //
  // You look *through* a railing, so the band it occupies needs something behind
  // it first: the face of the building below us, in its own shadow. Left as bare
  // canvas the gaps came out black and the whole thing read as a fence bolted to
  // the front of the picture.
  // What shows between the balusters is the ground far below, in the balcony's own
  // shadow — dim, but not a hole. Black gaps turned the whole rail into a row of
  // dark pots with stone between them, which is the shape read inside out.
  const below = dark(mix(P.groundLo, stone, 0.3), 0.3);
  C.rect(0, B_RY, BALC.w, 24, below);
  C.rect(0, B_RY + 13, BALC.w, 11, dark(below, 0.22));

  // The coping: five rows of it, so it has a top you could set something on.
  C.rect(0, B_RY, BALC.w, 2, railHi);
  C.rect(0, B_RY + 2, BALC.w, 2, rail);
  C.rect(0, B_RY + 4, BALC.w, 1, dark(rail, 0.18));
  C.rect(0, B_RY + 5, BALC.w, 1, railLo);          // the shadow it throws
  for (let x = 0; x < BALC.w; x += 24) C.rect(x, B_RY, 1, 5, dark(rail, 0.12));  // joints

  // The balusters. The profile is the whole difference between stone and a
  // picket: wide foot, wide capital, a waist in the middle that catches light on
  // one side and loses it on the other.
  // Only a slight waist. Pinched hard, the shadow between the balusters swelled
  // into a diamond as loud as the stone, and the rail read as dark pots on a
  // shelf. A balustrade is mostly stone with light slotted through it.
  const PROFILE = [11, 11, 10, 9, 9, 8, 8, 8, 9, 9, 10, 11, 11];
  const SLOT = 14, BT = B_RY + 6;
  for (let x = 1; x < BALC.w; x += SLOT) {
    PROFILE.forEach((pw, r) => {
      const x0 = x + Math.round((SLOT - 2 - pw) / 2);
      C.rect(x0, BT + r, pw, 1, r < 2 || r > 10 ? railHi : rail);
      C.rect(x0, BT + r, 1, 1, lite(rail, 0.3));       // the turn toward the light
      C.rect(x0 + 1, BT + r, 1, 1, lite(rail, 0.12));
      C.rect(x0 + pw - 1, BT + r, 1, 1, railLo);       // and away from it
      C.rect(x0 + pw - 2, BT + r, 1, 1, dark(rail, 0.16));
    });
  }

  // Bottom rail, then the floor we are standing on.
  const BB = BT + PROFILE.length;
  C.rect(0, BB, BALC.w, 2, rail);
  C.rect(0, BB, BALC.w, 1, railHi);
  C.rect(0, BB + 2, BALC.w, 2, railLo);
  const fy = BB + 4;
  C.vgrad(0, fy, BALC.w, BALC.h - fy, [dark(stone, 0.46), dark(stone, 0.34)]);
  C.rect(0, fy, BALC.w, 1, dark(stone, 0.58));
  for (let x = 6; x < BALC.w; x += 20) C.rect(x, fy + 1, 1, BALC.h - fy - 1, dark(stone, 0.44));
  return C;
}

// --- The Vice President's Mansion ------------------------------------------
// A bedroom, from inside it. The other three rooms are places you go to do
// something; this one is a place someone lives, and it is drawn to say so —
// an unmade bed, a television left on, and a wall of glass standing open onto
// the balcony with the evening coming in through it.

/**
 * The palace of state, closing the axis.
 *
 * Symmetry is the whole effect: one dome on centre, a pediment under it, and two
 * matched colonnaded wings running out to either side. Nothing here is placed by
 * a hash — a ceremonial building whose windows are scattered at random reads as
 * an apartment block, which is exactly what the first version of this view was.
 */
function civicPalace(C, P, cx, baseY) {
  const st = mix(P.stone, '#2b2b33', 0.08 + P.dim * 0.42);
  const face = dark(st, 0.06), sh = dark(st, 0.3), hi = lite(st, 0.2);
  const win = P.lampsLit ? P.warm : dark(st, 0.44);

  // The wings: a plinth, a ranked colonnade, a cornice. Ten bays each, equal.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? cx - 62 : cx + 20;
    C.rect(x0, baseY - 7, 42, 7, face);
    C.rect(x0, baseY - 8, 42, 1, hi);                    // cornice
    for (let i = 0; i < 10; i++) {
      C.rect(x0 + 1 + i * 4, baseY - 6, 2, 6, lite(face, 0.14));   // the column
      C.rect(x0 + 3 + i * 4, baseY - 6, 2, 6, sh);                 // and its shadow
      C.set(x0 + 3 + i * 4, baseY - 5, win);                       // the bay behind it
    }
    C.rect(x0, baseY - 1, 42, 1, dark(face, 0.26));      // the step it stands on
  }

  // The centre block, taller, with a deeper portico.
  C.rect(cx - 19, baseY - 11, 38, 11, face);
  C.rect(cx - 20, baseY - 12, 40, 1, hi);
  for (let i = 0; i < 7; i++) {
    C.rect(cx - 16 + i * 5, baseY - 10, 2, 10, lite(face, 0.18));
    C.rect(cx - 14 + i * 5, baseY - 10, 3, 10, sh);
    C.rect(cx - 14 + i * 5, baseY - 8, 3, 2, win);
  }
  C.rect(cx - 19, baseY - 1, 38, 1, dark(face, 0.26));
  // Pediment.
  C.tri(cx - 19, baseY - 12, cx, baseY - 17, cx + 19, baseY - 12, st);
  C.tri(cx - 14, baseY - 12, cx, baseY - 15, cx + 14, baseY - 12, dark(st, 0.14));
  C.rect(cx - 20, baseY - 12, 40, 1, hi);
  // Drum and dome. Ribbed, because ribs are what make a dome that dome.
  C.rect(cx - 7, baseY - 18, 14, 4, st);
  for (let i = 0; i < 6; i++) C.rect(cx - 5 + i * 2, baseY - 17, 1, 3, sh);
  C.disc(cx, baseY - 18, 7, 4, dark(st, 0.08));
  C.disc(cx, baseY - 19, 6, 3, st);
  C.disc(cx - 2, baseY - 20, 3, 2, hi);
  for (const rx of [-4, -1, 2, 5]) C.line(cx + rx, baseY - 16, cx + Math.round(rx / 3), baseY - 22, sh);
  C.rect(cx - 1, baseY - 23, 2, 2, st);                  // lantern
  C.set(cx, baseY - 24, hi);                             // and the figure on it
  // Flags on the wings, because it is a seat of government and not a museum.
  for (const fx of [cx - 30, cx + 30]) {
    C.rect(fx, baseY - 13, 1, 5, sh);
    C.rect(fx + 1, baseY - 13, 3, 2, mix('#c2352a', '#3a140f', P.dim * 0.5));
  }
}

/** A matched pavilion, one each side, framing the axis without competing. */
function pavilion(C, P, x, baseY, w) {
  const st = mix(P.stone, '#2b2b33', 0.16 + P.dim * 0.44);
  const face = dark(st, 0.08), sh = dark(st, 0.3);
  const win = P.lampsLit ? P.warm : dark(st, 0.44);
  C.rect(x, baseY - 6, w, 6, face);
  C.rect(x - 1, baseY - 7, w + 2, 1, lite(st, 0.16));
  const bays = Math.max(3, Math.round(w / 5));
  for (let i = 0; i < bays; i++) {
    const bx = x + 2 + Math.round(i * (w - 4) / bays);
    C.rect(bx, baseY - 5, 2, 5, sh);
    C.rect(bx, baseY - 4, 2, 2, win);
  }
  C.tri(x + w / 2 - 6, baseY - 7, x + w / 2, baseY - 10, x + w / 2 + 6, baseY - 7, st);
  C.rect(x, baseY - 1, w, 1, dark(face, 0.26));
}

/**
 * The lawn between the residence and the palace: an axis, not a park.
 *
 * A gravel avenue widening as it comes toward us, a reflecting pool down the
 * centre of it, clipped hedges in matched pairs, and trees in ranks rather than
 * scattered. Everything is mirrored about x = cx, which is the entire difference
 * between grounds that look designed and grounds that look grown.
 */
function formalLawn(C, P, cx, y0, y1) {
  const span = y1 - y0;
  const grass = dark(P.ground, 0.04);
  const gravel = mix(P.stone, P.ground, 0.45);
  const pool = mix(P.sky[1], '#10323f', 0.28);
  const hedge = dark(mix(P.ground, '#1d3a1c', 0.5), 0.12);

  C.rect(0, y0, C.w, span, grass);
  // Haze at the far end, so the lawn recedes instead of lying flat.
  for (let y = y0; y < y0 + 4; y++) {
    C.rect(0, y, C.w, 1, mix(mix(grass, P.hill, 0.5), grass, (y - y0) / 4));
  }
  // The avenue and the water on its centreline, both widening toward us.
  for (let y = y0 + 1; y < y1; y++) {
    const t = (y - y0) / span;
    const half = Math.round(9 + t * t * 21);
    C.rect(cx - half, y, half * 2, 1, gravel);
    // A long narrow basin, not a funnel. Widened hard toward the viewer it read
    // as a dark wedge pointing at the room rather than as water lying flat.
    if (t > 0.16) {
      const ph = Math.round(2 + t * 6);
      C.rect(cx - ph, y, ph * 2, 1, pool);
      C.set(cx - ph, y, lite(gravel, 0.24));
      C.set(cx + ph - 1, y, dark(gravel, 0.18));
    }
  }
  C.rect(cx - 3, y0 + 4, 6, 1, lite(pool, 0.32));          // the head of the water
  // Clipped hedges, in matched pairs down both sides of the avenue.
  for (let i = 0; i < 5; i++) {
    const t = 0.14 + i * 0.2;
    const y = Math.round(y0 + t * span);
    const half = Math.round(9 + t * t * 21);
    const hw = 3 + Math.round(t * 3);
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - half - hw - 1 : cx + half + 1;
      C.rect(x, y - 1 - Math.round(t * 2), hw, 2 + Math.round(t * 2), hedge);
      C.rect(x, y - 1 - Math.round(t * 2), hw, 1, lite(hedge, 0.18));
    }
  }
  // Trees in ranks, matched left and right, getting taller as they near us.
  for (let i = 0; i < 4; i++) {
    const t = 0.18 + i * 0.24;
    const y = Math.round(y0 + t * span) + 1;
    const hgt = 3 + Math.round(t * 5);
    const out = Math.round(66 + t * t * 40);
    tree(C, P, 60 + i, cx - out, y, hgt);
    tree(C, P, 60 + i, cx + out, y, hgt);
  }
}

const MANS = { w: 240, h: 72 };
// The outside wall is glass, end to end — there is no masonry in this room at
// all, only the frame between panes. Eight panels, and the sixth from the left
// is slid open: that gap is the one part of the wall with nothing in it, which
// is where the weather and the evening air actually get in.
const GY = 4, GH = 42, PANES = 8, PANE = MANS.w / PANES;
const GAP = { x: PANE * 4, w: PANE };

function mansion(world) {
  const P = palette(world);
  const C = Canvas(MANS.w, MANS.h);

  // Nobody has put the big light on. What is in here is the last of the day off
  // the glass and the television, so the room is cool everywhere the wall reaches
  // and warm-grey where it does not.
  const room = (c) => mix(dark(c, 0.12 + P.dim * 0.42), P.sky[1], 0.06 + P.dim * 0.14);
  const wall = room('#cfc4b4');
  const trim = room('#efe7da');
  const floor = room('#7d5c3c');
  const linen = room('#f6efdf');
  const throwc = room('#7d8ea0');      // a blanket, so the bed is not one flat tone
  const wood = room('#4a3524');
  const day = lite(P.sky[2], 0.12);

  C.rect(0, 0, MANS.w, GY, dark(wall, 0.28));           // the soffit over the glass
  C.rect(0, GY - 1, MANS.w, 1, trim);
  C.vgrad(0, GY + GH, MANS.w, MANS.h - GY - GH, [dark(floor, 0.24), floor, lite(floor, 0.06)]);
  for (let x = 0; x < MANS.w; x += 13) C.rect(x, GY + GH, 1, MANS.h - GY - GH, dark(floor, 0.16));

  // -- What is outside ------------------------------------------------------
  //
  // Drawn on its own surface the width of the whole wall and blitted in, so it
  // is one continuous view across all eight panels rather than eight little
  // pictures that happen to line up.
  const V = Canvas(MANS.w, GH);
  V.vgrad(0, 0, MANS.w, 24, P.sky);
  stars(V, P, 31, 0, 0, MANS.w, 20, 40);
  luminary(V, P, 10, 230, 2, 20);
  clouds(V, P, 37, 6, 6, MANS.w);
  birds(V, P, 43, 12, MANS.w);
  // What the Vice President looks out at is the ceremonial axis of the capital,
  // not a skyline. Eight generic blocks scattered along the horizon put the
  // second office of the republic in a suburb; a lawn, a reflecting pool and the
  // palace of state closing the view put it where it actually lives.
  V.rect(0, 21, MANS.w, 3, P.hill);
  formalLawn(V, P, 120, 22, GH);
  pavilion(V, P, 20, 22, 32);
  pavilion(V, P, 188, 22, 32);
  civicPalace(V, P, 120, 22);
  // The balcony's own rail, just the other side of the glass.
  const rail = mix('#d8cdb2', '#2e2a23', 0.3 + P.dim * 0.5);
  // Low and near the sill: drawn tall it became a picket fence straight across
  // the middle of the view, and the view is the whole point of the room.
  V.rect(0, 34, MANS.w, 1, lite(rail, 0.25));
  for (let x = 2; x < MANS.w; x += 7) V.rect(x, 35, 1, 5, rail);
  V.rect(0, 40, MANS.w, 2, rail);
  V.rect(0, 40, MANS.w, 1, lite(rail, 0.12));
  C.blit(V, 0, GY);

  // The glass itself. Every panel but the open one gets a flat cool tint over the
  // view and a diagonal catch of light, because glass you cannot see is not glass.
  for (let i = 0; i < PANES; i++) {
    const px0 = Math.round(i * PANE);
    if (px0 === Math.round(GAP.x)) continue;
    for (let y = GY; y < GY + GH; y++) {
      for (let x = px0; x < px0 + PANE; x++) C.set(x, y, mix(C.get(x, y) || wall, '#dfe9f2', 0.07));
    }
    for (let k = 0; k < 8; k++) {
      C.set(px0 + 5 + k, GY + 20 - k, mix(C.get(px0 + 5 + k, GY + 20 - k) || wall, '#ffffff', 0.26));
      C.set(px0 + 6 + k, GY + 20 - k, mix(C.get(px0 + 6 + k, GY + 20 - k) || wall, '#ffffff', 0.12));
    }
  }
  // Mullions, head and sill. The open panel's leaf is stacked against the next
  // one along, which is why that mullion is the thick one.
  for (let i = 0; i <= PANES; i++) {
    const mx = Math.min(MANS.w - 1, Math.round(i * PANE));
    const thick = mx === Math.round(GAP.x + GAP.w) ? 3 : 1;
    C.rect(mx, GY, thick, GH, trim);
    C.rect(mx, GY, thick, 1, lite(trim, 0.2));
  }
  C.rect(0, GY, MANS.w, 1, lite(trim, 0.1));
  C.rect(0, GY + GH, MANS.w, 2, lite(trim, 0.08));
  C.rect(0, GY + GH + 2, MANS.w, 1, dark(trim, 0.3));
  // Across the open panel the sill is a threshold you could walk over rather than
  // a closed frame member — the light lies on it, and it is the clearest single
  // signal in the frame that this part of the wall is standing open.
  C.rect(GAP.x, GY + GH, GAP.w, 2, lite(day, 0.1));
  C.rect(GAP.x, GY + GH + 2, GAP.w, 1, dark(trim, 0.14));
  const leaf = Math.round(GAP.x + GAP.w);
  C.rect(leaf - 3, GY + 1, 2, GH - 2, mix(trim, '#cfe2ee', 0.5));
  C.rect(leaf - 3, GY + 1, 1, GH - 2, lite(trim, 0.3));

  // The drapes, stacked at each end of the wall where they are not in the way of
  // the view. Vertical folds, light where the cloth turns toward the opening and
  // dark in the crease.
  const drape = room('#8a5f46');
  const FOLD = [0.3, -0.2, 0.36, -0.34, 0.14, -0.28, 0.26];
  for (const [dxs, flip] of [[0, false], [MANS.w - 14, true]]) {
    for (let f = 0; f < 7; f++) {
      const v = FOLD[flip ? 6 - f : f];
      C.rect(dxs + f * 2, GY - 2, 2, GH + 8, v >= 0 ? lite(drape, v) : dark(drape, -v));
    }
    C.rect(dxs, GY - 3, 14, 2, dark(drape, 0.3));
    C.rect(dxs, GY - 3, 14, 1, lite(drape, 0.18));
  }

  // The light coming in through the gap, on the floor in front of it.
  C.wash(GAP.x + GAP.w / 2, GY + GH + 10, 42, day, 0.95, 0.17 - P.dim * 0.05);

  // -- The bed, in front of the wall ---------------------------------------
  //
  // The room is a view first, so the bed sits in the near ground and takes only
  // the bottom of the glass: you are looking over it and out. Slept in and not
  // made — the sheets are overlapping slabs of two linens with the folds picked
  // out along their edges, because a flat rectangle with a highlight on it reads
  // as a table and this has to read as bedding.
  const BX = 0, BW = 116, BT = 40;
  C.rect(BX, BT - 8, 7, 30, dark(wood, 0.12));            // headboard, against the wall
  C.rect(BX, BT - 8, 7, 2, lite(wood, 0.22));
  C.rect(BX + 1, BT - 6, 5, 26, dark(wood, 0.3));
  C.rect(BX + 5, BT + 16, BW, 6, wood);                   // the base
  C.rect(BX + 5, BT + 21, BW, 3, dark(wood, 0.38));
  // Four legs, of which you can see two: the near pair, at the head and at the
  // foot. The far pair is behind the bed and hidden by it, which is correct —
  // what was wrong was standing the whole thing on a single post at the foot
  // while the head end floated.
  C.rect(BX + 8, BT + 24, 4, 5, dark(wood, 0.5));
  C.rect(BX + 8, BT + 24, 1, 5, dark(wood, 0.34));
  C.rect(BX + BW - 2, BT + 24, 4, 5, dark(wood, 0.5));
  C.rect(BX + BW - 2, BT + 24, 1, 5, dark(wood, 0.34));

  // The bed is made, and the bedding is navy.
  //
  // Both of those are the same decision. The room is mostly window, and for half
  // the year what is behind that window is snow — white bedding against a white
  // city was a pale shape on a pale ground and read as another slab of floor.
  // Navy is the one thing in the palette that separates from both the snow and
  // the wall, so the bed reads as a bed at a glance, in every season.
  const duvet = room('#2b3d63');
  const dx0 = BX + 8, dx1 = BX + BW - 4, dtop = BT + 1, dbot = BT + 17;

  // The duvet: a flat plane with a crisp lit edge along the top, then four bands
  // down the near face so it turns like cloth over a mattress rather than
  // standing there as a rectangle of colour.
  C.rect(dx0, dtop, dx1 - dx0, dbot - dtop, duvet);
  C.rect(dx0, dtop, dx1 - dx0, 1, lite(duvet, 0.34));     // the made edge, catching the light
  C.rect(dx0, dtop + 1, dx1 - dx0, 3, lite(duvet, 0.14));
  C.rect(dx0, dbot - 6, dx1 - dx0, 3, dark(duvet, 0.16));
  C.rect(dx0, dbot - 3, dx1 - dx0, 3, dark(duvet, 0.3));  // where it falls away under the sill
  // Two long creases where a made duvet still breaks over the edge of the bed.
  C.rect(dx0 + 26, dtop + 4, 1, dbot - dtop - 7, dark(duvet, 0.14));
  C.rect(dx0 + 74, dtop + 4, 1, dbot - dtop - 7, dark(duvet, 0.14));
  // It drapes over the foot rather than being thrown off it.
  C.rect(dx1, dtop + 2, 3, dbot - dtop - 2, dark(duvet, 0.22));
  C.rect(dx1, dtop + 2, 3, 1, lite(duvet, 0.1));

  // The top sheet, turned back over the duvet at the head — the white band that
  // says "made" more plainly than anything else in the picture.
  C.rect(dx0, dtop, 40, 5, linen);
  C.rect(dx0, dtop, 40, 1, lite(linen, 0.4));
  C.rect(dx0, dtop + 4, 40, 1, dark(linen, 0.26));
  C.rect(dx0 + 39, dtop, 1, 5, dark(linen, 0.2));

  // Pillows: squared and plumped against the headboard, not dented.
  for (const px of [BX + 17, BX + 37]) {
    C.rect(px - 9, BT - 7, 19, 9, dark(linen, 0.18));
    C.rect(px - 9, BT - 8, 19, 8, linen);
    C.rect(px - 9, BT - 8, 19, 1, lite(linen, 0.42));
    C.rect(px - 9, BT - 8, 1, 8, lite(linen, 0.2));
    C.rect(px + 9, BT - 8, 1, 8, dark(linen, 0.22));
  }
  // A folded throw laid across the foot, the way a made bed is finished.
  C.rect(dx1 - 30, dtop + 6, 30, 6, dark(duvet, 0.34));
  C.rect(dx1 - 30, dtop + 6, 30, 1, lite(duvet, 0.06));
  C.rect(dx1 - 30, dtop + 11, 30, 1, dark(duvet, 0.5));

  // -- The television, side on ----------------------------------------------
  //
  // Turned to face the bed, not us. What is left facing this way is the panel
  // seen almost edge on — a few pixels of thickness, the dark back of the set,
  // and one bright sliver of the screen itself raking off to the left. All the
  // picture there is is the light it throws on the room, so that is drawn first
  // and the set is put down on top of it.
  const stand = room('#3f3a34');
  const glow = mix('#7fb6d8', '#e8f2f8', 0.3);
  const TX = 216, TB = 50;                                // against the right wall
  C.wash(TX - 20, TB - 8, 40, glow, 0.8, 0.24);           // light thrown at the bed
  C.wash(TX - 8, TB + 12, 26, glow, 0.7, 0.18);           // and down onto the floor

  C.rect(TX - 22, TB, 46, 4, lite(stand, 0.18));          // the console top
  C.rect(TX - 22, TB + 4, 46, 9, stand);
  C.rect(TX - 22, TB + 4, 46, 1, dark(stand, 0.32));
  C.rect(TX - 18, TB + 6, 18, 5, dark(stand, 0.24));      // two drawers, side on
  C.rect(TX + 3, TB + 6, 18, 5, dark(stand, 0.24));
  C.rect(TX - 11, TB + 8, 5, 1, lite(stand, 0.3));
  C.rect(TX + 10, TB + 8, 5, 1, lite(stand, 0.3));
  C.rect(TX - 20, TB + 13, 3, 4, dark(stand, 0.44));
  C.rect(TX + 19, TB + 13, 3, 4, dark(stand, 0.44));

  C.rect(TX - 5, TB - 4, 11, 3, dark(stand, 0.5));        // the foot of the mount
  C.rect(TX - 1, TB - 8, 4, 5, dark(stand, 0.42));
  // The panel, raked hard away from us rather than dead edge on. A pure profile
  // was four pixels of black twenty tall, which reads as an obelisk and not as a
  // television; give it enough foreshortened face to see a picture on and the
  // angle becomes legible. Near edge is the screen, far edge is the back.
  const TH = 22, TT = TB - 6 - TH;
  C.rect(TX - 6, TT, 12, TH, dark(stand, 0.52));          // the case, foreshortened
  C.rect(TX + 2, TT, 4, TH, dark(stand, 0.7));            // the back, turned away
  C.rect(TX - 6, TT, 12, 1, lite(stand, 0.16));           // top edge catching the room
  C.rect(TX - 6, TT + TH - 1, 12, 1, dark(stand, 0.7));
  // The screen: a narrow sliver of picture, wider at the near edge and closing to
  // nothing as it turns away.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const col = mix(mix(glow, '#22405c', 0.35), dark(stand, 0.55), t * t);
    C.rect(TX - 5 + i, TT + 1 + Math.round(t), 1, TH - 2 - Math.round(t * 2), col);
  }
  C.rect(TX - 5, TT + 2, 1, TH - 4, mix(glow, '#3d6a92', 0.3));   // the lit near edge
  C.rect(TX - 5, TT + 5, 2, 2, glow);                              // and two bright bands
  C.rect(TX - 5, TT + 13, 2, 1, lite(glow, 0.1));

  return C;
}

// `vents` are the openings weather is allowed into: the parts of the frame that
// are actually outdoors. The Oval Office is an interior — the only sky in it is
// the three windows, and snow drawn anywhere else is snow falling on the desk.
// The Court is seen from under a portico, so the weather belongs in the plaza
// between the columns and not on the ceiling. The balcony is open to the sky down
// --- The Department of State -----------------------------------------------

const STATE = { w: 240, h: 72 };

/**
 * The conservatory: a glasshouse of roses that the foreign service walks
 * through on its way to saying nothing.
 *
 * The first version of this room was a meeting table with three windows
 * overlooking a garden, and a room *with a view of* a garden is not a garden —
 * it was a boardroom with wallpaper. This is the garden. Iron ribs and glass
 * overhead, beds packed to the path on both sides, a tiled walk down the
 * middle, and two figures somewhere along it, because the whole point of the
 * building is that the difficult conversations happen while walking.
 *
 * The contrast with the war room is the pair's entire thesis: one is under
 * glass and full of flowers, the other is underground and lit by screens, and
 * both of them decide whether there is a war.
 */
function stateRoom(world) {
  const P = palette(world);
  const C = Canvas(STATE.w, STATE.h);

  // Under glass the light is its own thing: brighter and flatter than outdoors,
  // and it barely knows what season it is. That is what a glasshouse is *for*,
  // so the season only tints it — it never turns it grey.
  const glassDim = P.dim * 0.35;
  const day = mix(lite(P.sky[2], 0.3), '#eaf3ff', 0.35);
  const iron = mix('#4a5560', '#181e26', glassDim);
  const pane = mix(day, '#9fc4dd', 0.25);

  // -- The glass roof -------------------------------------------------------
  C.vgrad(0, 0, STATE.w, 26, [mix(pane, '#ffffff', 0.35), pane, mix(pane, '#cfe3f0', 0.3)]);
  // Rafters running to a ridge, drawn as a shallow vault: the rise is small, so
  // it reads as a barrel of glass rather than a pitched roof.
  C.rect(0, 0, STATE.w, 2, dark(iron, 0.25));                       // the ridge beam
  for (let x = 0; x <= STATE.w; x += 15) {
    C.rect(x, 2, 1, 24, iron);                                      // rafters
    C.rect(x - 1, 24, 3, 1, dark(iron, 0.2));                       // and their feet
  }
  C.rect(0, 12, STATE.w, 1, mix(iron, pane, 0.35));                 // purlins
  C.rect(0, 19, STATE.w, 1, mix(iron, pane, 0.45));
  C.rect(0, 25, STATE.w, 2, iron);                                  // the eaves plate
  // Condensation and the odd cracked pane. A glasshouse is a working building.
  for (let i = 0; i < 26; i++) {
    const gx = (i * 37) % STATE.w, gy = 3 + ((i * 13) % 20);
    C.rect(gx, gy, 1, 1, mix('#ffffff', pane, 0.35));
  }

  // -- The far end: an arched door out to the rest of the garden -------------
  const arch = { x: 104, y: 30, w: 32, h: 24 };
  C.rect(0, 27, STATE.w, 12, mix(pane, '#b9d3e2', 0.4));            // clerestory glass
  for (let x = 0; x <= STATE.w; x += 15) C.rect(x, 27, 1, 12, mix(iron, pane, 0.2));
  C.rect(arch.x - 2, arch.y - 2, arch.w + 4, arch.h + 2, iron);
  C.rect(arch.x, arch.y, arch.w, arch.h, mix('#6f8f5a', '#22331b', glassDim));
  // Whatever is beyond it is out of focus: a wash of foliage and one bright path.
  for (let i = 0; i < 40; i++) {
    const bx = arch.x + ((i * 7) % arch.w), by = arch.y + ((i * 11) % arch.h);
    C.rect(bx, by, 2, 2, mix('#86a86a', '#31432a', ((i % 3) / 3)));
  }
  C.rect(arch.x + arch.w / 2 - 3, arch.y + 14, 6, 10, mix('#cdbfa2', '#6a6050', glassDim));

  // -- The walk -------------------------------------------------------------
  // A trapezoid: narrow at the arch, wide at our feet. Everything else in the
  // room is arranged around the fact that you are standing on it.
  const pathAt = (y) => {
    const t = clamp((y - 39) / (STATE.h - 39), 0, 1);
    const half = 14 + t * 48;
    return [STATE.w / 2 - half, STATE.w / 2 + half];
  };
  const tileA = mix('#d9cdb4', '#6b6252', glassDim);
  const tileB = mix('#c6b99e', '#5c5445', glassDim);
  for (let y = 39; y < STATE.h; y++) {
    const [x0, x1] = pathAt(y);
    C.rect(Math.round(x0), y, Math.round(x1 - x0), 1, tileA);
    // Courses of paving, spaced further apart as they come toward us.
    if ((y - 39) % Math.max(2, Math.round((y - 36) / 6)) === 0) {
      C.rect(Math.round(x0), y, Math.round(x1 - x0), 1, tileB);
    }
  }

  // -- The beds -------------------------------------------------------------
  // Planted right up to the edge of the walk, on both sides, and taller at the
  // back so the eye travels down the room instead of stopping at a hedge.
  const foliage = ['#3f6b2e', '#4e7d38', '#2f5624', '#5a8c41'];
  const blooms = ['#d8365f', '#ef7f9c', '#f6e6ea', '#e8a33a', '#c2416b', '#f4c9d4'];
  // A cheap integer hash. The colour was indexed straight off `x + y`, which
  // steps in lockstep with the planting loop — so every bloom in the house came
  // out the same pink and a bed of six varieties read as one. Scrambling the
  // seed first is the whole difference between a rose garden and a wallpaper.
  const mixup = (n) => ((n * 2654435761) >>> 0);
  const plant = (x, y, h, seed) => {
    const g = foliage[mixup(seed) % foliage.length];
    C.rect(x, y - h, 2, h, mix(g, '#1a2a14', glassDim + 0.1));      // stem
    for (let i = 0; i < 4; i++) {
      const lx = x - 2 + ((seed * (i + 3)) % 5);
      const ly = y - h + ((seed * (i + 2)) % Math.max(2, h - 2));
      C.rect(lx, ly, 3, 2, mix(foliage[(seed + i) % foliage.length], '#16240f', glassDim));
    }
    const b = mix(blooms[mixup(seed * 7 + 3) % blooms.length], '#2a1119', glassDim * 0.8);
    C.rect(x - 1, y - h - 2, 4, 3, b);                              // the head
    C.rect(x, y - h - 3, 2, 1, lite(b, 0.22));
    // Not every stem is in flower, and the ones that are are not all the same
    // size. Uniform heads in a grid is what made the first pass read as fabric.
    if (mixup(seed * 11) % 5 === 0) C.rect(x - 2, y - h - 1, 6, 2, b);
  };

  for (let y = 40; y < STATE.h; y += 3) {
    const [x0, x1] = pathAt(y);
    const depth = (y - 40) / (STATE.h - 40);
    const h = Math.round(5 + depth * 9);            // nearer plants are taller
    for (let x = 2; x < x0 - 2; x += Math.round(5 + depth * 3)) {
      plant(x, y + 2, h + (mixup(x * 3 + y) % 3) - 1, x + y);
    }
    for (let x = Math.round(x1) + 3; x < STATE.w - 2; x += Math.round(5 + depth * 3)) {
      plant(x, y + 2, h + (mixup(x + y * 5) % 3) - 1, x * 2 + y);
    }
  }
  // The bed edging, laid last so the planting sits behind it.
  for (let y = 39; y < STATE.h; y++) {
    const [x0, x1] = pathAt(y);
    C.rect(Math.round(x0) - 2, y, 2, 1, mix('#8d7f66', '#3e382d', glassDim));
    C.rect(Math.round(x1), y, 2, 1, mix('#8d7f66', '#3e382d', glassDim));
  }

  // -- Standard roses, and baskets hung from the rafters ---------------------
  // The vertical punctuation the beds cannot give: a rose on a stem at eye
  // level, and something overhead so the roof is not just weather.
  const standard = (x, y) => {
    C.rect(x, y - 12, 1, 12, mix('#6a5a3a', '#2a2418', glassDim));
    const b = mix(blooms[(x * 5) % blooms.length], '#2a1119', glassDim * 0.7);
    C.disc(x, y - 14, 4, 3, mix('#3f6b2e', '#1c2f14', glassDim));
    C.rect(x - 2, y - 15, 2, 2, b);
    C.rect(x + 1, y - 14, 2, 2, lite(b, 0.15));
    C.rect(x - 1, y - 12, 2, 2, mix(b, '#ffffff', 0.25));
  };
  standard(62, 60); standard(178, 60);
  standard(84, 47); standard(156, 47);

  for (const bx of [36, 120, 204]) {
    C.rect(bx, 2, 1, 9, iron);                                      // the chain
    C.rect(bx - 4, 11, 9, 4, mix('#7a6242', '#31281a', glassDim));  // the basket
    for (let i = 0; i < 7; i++) {
      C.rect(bx - 4 + i, 15 + ((i * 5) % 3), 1, 2 + ((i * 3) % 3), mix('#4e7d38', '#22371a', glassDim));
    }
    C.rect(bx - 3, 14, 2, 2, mix(blooms[(bx / 4) % blooms.length], '#2a1119', glassDim * 0.7));
    C.rect(bx + 2, 15, 2, 2, mix(blooms[(bx / 3) % blooms.length], '#2a1119', glassDim * 0.7));
  }

  // -- Two of them, walking -------------------------------------------------
  // Mid-way down the path and small, so the glass has the height and the room
  // has the depth. They are talking, which is the only work this building does.
  const walker = (x, y, h, coat, gesturing) => {
    const c = mix(coat, '#0d1016', glassDim + 0.12);
    const sleeve = dark(c, 0.22);
    const skin = mix('#c9a184', '#3a2a20', glassDim);
    C.rect(x + 1, y - h, 5, h - 4, c);                              // coat
    C.rect(x + 1, y - 4, 2, 4, dark(c, 0.4));                       // legs
    C.rect(x + 4, y - 4, 2, 4, dark(c, 0.4));
    // Arms, hung off the shoulder line rather than the middle of the coat —
    // one either side, and a hand on the end of each, because a sleeve that
    // stops in mid-air reads as a sleeve.
    const armTop = y - h + 1;
    const armLen = Math.max(3, h - 8);
    C.rect(x, armTop, 1, armLen, sleeve);                           // the far arm
    C.rect(x, armTop + armLen, 1, 1, skin);
    if (gesturing) {
      // The near arm, up and forward: they are making a point about the roses,
      // or about a border. Stepped rather than straight — a diagonal is what
      // separates a gesture from a signpost.
      C.rect(x + 6, armTop + 1, 1, 2, sleeve);
      C.rect(x + 7, armTop - 1, 1, 3, sleeve);
      C.rect(x + 8, armTop - 3, 1, 3, sleeve);
      C.rect(x + 8, armTop - 4, 1, 1, skin);                        // the hand, raised
    } else {
      C.rect(x + 6, armTop, 1, armLen, sleeve);
      C.rect(x + 6, armTop + armLen, 1, 1, skin);
    }
    C.rect(x + 2, y - h - 4, 4, 4, skin);                           // head
    C.rect(x + 2, y - h - 5, 4, 2, mix('#2e2a26', '#100e0c', glassDim));  // hair
    C.rect(x + 1, y - h, 5, 1, lite(c, 0.18));                      // light off the shoulders
  };
  // The one on the left is doing the talking.
  walker(112, 58, 13, '#2b3350', true);
  walker(122, 60, 14, '#4a3550', false);
  // Their shadows on the paving, which is what puts them on the ground.
  C.rect(111, 58, 7, 1, mix(tileB, '#2a2418', 0.35));
  C.rect(121, 60, 7, 1, mix(tileB, '#2a2418', 0.35));

  return C;
}

// --- The Department of Justice ---------------------------------------------

const JUST = { w: 240, h: 72 };

/**
 * The Attorney General's room: a law library with a working desk in it.
 *
 * The four rooms of the executive are four different arguments about what a
 * department is. State is a conservatory — diplomacy is something you grow.
 * Defense is a windowless basement lit by its own screens. The Treasury is
 * stone and glass and a price feed. This one is books: floor-to-ceiling
 * reports, a brass lamp, and a case file open on the blotter, because the
 * instrument of this office is the written record and the thing it does with
 * it is read.
 *
 * It takes the season through one deep window on the left, the way the
 * Treasury does through its own — a lawyer's room is a room in a building, not
 * a bunker, and the light in it should tell you what month it is.
 */
function justiceRoom(world) {
  const P = palette(world);
  const C = Canvas(JUST.w, JUST.h);
  const dim = P.dim;
  const wall = mix('#5c4a37', '#241c14', dim);        // dark panelled oak
  const shelf = mix('#4a3a2a', '#1d1610', dim);
  const floor = mix('#3a2c20', '#191108', dim);
  const brass = mix('#d8a63c', '#4a3a12', dim * 0.8);
  const paper = mix('#e8e0cc', '#3a3630', dim);

  // Wall and floor. The panelling runs the full width behind everything else,
  // so anything drawn over it reads as standing in front of a wall rather than
  // floating on a colour.
  C.vgrad(0, 0, JUST.w, 48, [lite(wall, 0.06), wall, dark(wall, 0.1)]);
  for (let x = 0; x < JUST.w; x += 24) C.rect(x, 0, 1, 48, dark(wall, 0.22));
  C.rect(0, 46, JUST.w, 2, dark(wall, 0.35));
  C.vgrad(0, 48, JUST.w, JUST.h - 48, [dark(floor, 0.1), floor, lite(floor, 0.06)]);
  for (let x = 0; x < JUST.w; x += 34) C.rect(x, 48, 1, JUST.h - 48, dark(floor, 0.14));

  // -- The window, left ------------------------------------------------------
  // Deep-set, arched, and the only daylight in the room.
  const WX = 10, WY = 6, WW = 40, WH = 30;
  C.rect(WX - 3, WY - 3, WW + 6, WH + 6, dark(wall, 0.4));
  C.vgrad(WX, WY, WW, WH, [P.sky[0], P.sky[1], P.sky[2]]);
  // A colonnade across the street: this building faces others like it.
  for (let i = 0; i < 5; i++) {
    C.rect(WX + 3 + i * 8, WY + WH - 14, 4, 14, mix('#3a4258', '#12161f', dim * 0.7));
  }
  C.rect(WX, WY + WH - 15, WW, 2, mix('#4a536a', '#161b26', dim * 0.7));   // their cornice
  C.rect(WX + WW / 2 - 1, WY, 2, WH, dark(wall, 0.3));                     // the mullion
  C.rect(WX, WY + WH / 2, WW, 1, dark(wall, 0.3));                         // and the transom
  C.rect(WX - 1, WY + WH, WW + 2, 2, lite(wall, 0.1));                     // the sill

  // -- The shelves, right ----------------------------------------------------
  // Bound volumes, all the same height because they are one continuing series
  // and that is what a run of reports looks like. The variety is in the width
  // and the colour of the spine, not in the height, which is the mistake that
  // makes a drawn bookshelf read as a bar chart.
  const SPINES = ['#7a3a30', '#3d5140', '#4a3f6a', '#6a5326', '#33475e'];
  for (let r = 0; r < 3; r++) {
    const sy = 6 + r * 14;
    C.rect(58, sy - 1, JUST.w - 68, 1, lite(shelf, 0.12));
    C.rect(58, sy + 11, JUST.w - 68, 2, shelf);                // the shelf board
    C.rect(58, sy + 13, JUST.w - 68, 1, dark(shelf, 0.3));
    let x = 60;
    let i = r * 7;
    while (x < JUST.w - 12) {
      const bw = 2 + (i % 3);
      const col = mix(SPINES[i % SPINES.length], '#150f0a', dim);
      C.rect(x, sy, bw, 11, col);
      C.rect(x, sy, bw, 1, lite(col, 0.2));                    // the head of the spine
      C.rect(x + bw - 1, sy, 1, 11, dark(col, 0.3));
      if (bw > 2) C.rect(x + 1, sy + 3, bw - 2, 1, brass);     // the title band
      x += bw + 1;
      i++;
    }
  }

  // -- The desk --------------------------------------------------------------
  // Set below the shelves and forward of the wall, with the file open on it.
  const DX = 66, DY = 52, DW = 120, DH = 12;
  C.rect(DX, DY, DW, DH, mix('#4e3a26', '#1c1108', dim));
  C.rect(DX, DY, DW, 2, mix('#6a5136', '#241708', dim));       // the leather top, lit
  C.rect(DX, DY + DH - 1, DW, 1, dark(floor, 0.3));
  C.rect(DX + 4, DY + DH, 3, JUST.h - DY - DH, dark(floor, 0.25));    // legs
  C.rect(DX + DW - 7, DY + DH, 3, JUST.h - DY - DH, dark(floor, 0.25));
  // The open file: two leaves and a ruled line or two on each.
  C.rect(DX + 30, DY - 3, 26, 6, paper);
  C.rect(DX + 57, DY - 3, 26, 6, dark(paper, 0.08));
  C.rect(DX + 56, DY - 3, 1, 6, dark(paper, 0.3));             // the fold
  for (let ly = DY - 1; ly < DY + 2; ly += 2) {
    C.rect(DX + 33, ly, 20, 1, dark(paper, 0.35));
    C.rect(DX + 60, ly, 20, 1, dark(paper, 0.35));
  }
  // The scales, on the corner of the desk. The one piece of iconography in the
  // room, and it earns its place by being the thing the office is for.
  //
  // Drawn tilted, one pan lower than the other, because a balance drawn level
  // is two dots either side of a bar and reads as a letter T. The tilt is what
  // makes it a pair of pans, and it is the more honest picture besides.
  const SX = DX + 98, SY = DY - 12;
  C.rect(SX - 1, SY + 11, 9, 1, brass);                        // the foot
  C.rect(SX, SY + 12, 7, 1, dark(brass, 0.35));                // its shadow on the leather
  C.rect(SX + 3, SY + 2, 1, 9, brass);                         // the column
  C.rect(SX + 2, SY + 1, 3, 1, lite(brass, 0.2));              // the cap
  // The beam, one pixel out of level.
  C.rect(SX - 3, SY + 3, 4, 1, brass);
  C.rect(SX + 1, SY + 2, 5, 1, brass);
  C.rect(SX + 6, SY + 1, 4, 1, brass);
  // Two pans, each three wide with a hanger over it, at the heights the beam
  // leaves them.
  const pan = (px, py) => {
    C.rect(px + 1, py, 1, 2, dark(brass, 0.25));               // the hanger
    C.rect(px, py + 2, 3, 1, brass);                           // the rim
    C.rect(px, py + 3, 3, 1, dark(brass, 0.3));                // and the bowl
  };
  pan(SX - 4, SY + 4);
  pan(SX + 8, SY + 2);

  // -- The lamp --------------------------------------------------------------
  // A desk lamp is the only light the room makes for itself, and the pool it
  // throws on the blotter is what says somebody works here at night — which is
  // the whole character of the department.
  //
  // A tight glow and nothing else. `wash` dithers a tint into whatever it lands
  // on: on a floor or a rug that reads as light, and on a flat desktop against
  // a flat wall it reads as a speckled rectangle sitting on top of the picture.
  // The same note is on the Oval Office's lamps, for the same reason.
  const LX = DX + 12, LY = DY - 13;
  C.rect(LX, LY + 10, 7, 1, dark(brass, 0.3));                 // the base
  C.rect(LX + 3, LY + 4, 1, 6, brass);                         // the stem
  C.rect(LX - 2, LY, 11, 4, mix('#2e6a4a', '#0e2418', dim));   // the green shade
  C.rect(LX - 2, LY, 11, 1, lite(mix('#2e6a4a', '#0e2418', dim), 0.2));
  C.rect(LX - 2, LY + 4, 11, 1, lite(brass, 0.15));            // its brass rim
  // The bulb, and the light immediately under it. Nothing further out.
  C.rect(LX + 1, LY + 5, 5, 1, mix(P.warm, '#ffffff', 0.3));
  C.glow(LX + 3, LY + 6, 6, P.warm, 0.35);
  // The lit half of the blotter: a plain lighter band on the leather, not a
  // dither. Light on a desk is a shape, and here the shape is the desk.
  C.rect(DX + 2, DY, 44, 2, mix(mix('#6a5136', '#241708', dim), P.warm, 0.28));

  return C;
}

// --- The Department of Defense ---------------------------------------------

const DEF = { w: 240, h: 72 };

/**
 * The war room: underground, no daylight, lit by its own screens.
 *
 * Nothing in here is seasonal and nothing is warm. The only light sources are
 * the display wall and the map table, both cyan, and everything else in the
 * room is what that light happens to fall on — which is why the concrete is
 * washed rather than painted, and why the generals are silhouettes with a rim
 * of screen-light on them rather than figures with faces.
 */
function defenseRoom() {
  const C = Canvas(DEF.w, DEF.h);
  const cyan = '#3fd8e8';
  const deep = '#0a1418';
  const concrete = '#1c2a30';

  C.rect(0, 0, DEF.w, DEF.h, deep);
  C.vgrad(0, 0, DEF.w, 46, [dark(concrete, 0.35), concrete, dark(concrete, 0.15)]);
  // Ribbed concrete, and the services running along the ceiling: this is a
  // basement, and a basement has pipes in it.
  for (let x = 0; x < DEF.w; x += 16) C.rect(x, 0, 1, 46, dark(concrete, 0.3));
  C.rect(0, 3, DEF.w, 2, dark(concrete, 0.45));
  C.rect(0, 6, DEF.w, 1, mix(concrete, cyan, 0.12));
  C.vgrad(0, 46, DEF.w, DEF.h - 46, [dark(concrete, 0.5), dark(concrete, 0.36)]);

  // -- The display wall -----------------------------------------------------
  // Six screens, each a slightly different brightness so the wall flickers in
  // the eye rather than reading as one lit panel.
  for (let i = 0; i < 6; i++) {
    const sx = 12 + i * 38, sy = 10, sw = 30, sh = 20;
    C.rect(sx - 1, sy - 1, sw + 2, sh + 2, dark(concrete, 0.6));
    const face = mix('#06232b', cyan, 0.18 + ((i * 7) % 5) * 0.05);
    C.rect(sx, sy, sw, sh, face);
    // Content: a coastline on some, bar traces on others. Enough to read as
    // "these are showing something" without pretending to be legible.
    if (i % 2 === 0) {
      let y = sy + 12;
      for (let x = sx + 2; x < sx + sw - 2; x++) {
        y += ((x * 13) % 3) - 1;
        y = Math.max(sy + 3, Math.min(sy + sh - 3, y));
        C.rect(x, y, 1, 1, lite(cyan, 0.2));
      }
    } else {
      for (let b = 0; b < 6; b++) {
        const h = 3 + ((b * 11 + i * 5) % 10);
        C.rect(sx + 3 + b * 4, sy + sh - 3 - h, 2, h, mix(cyan, face, 0.35));
      }
    }
    C.rect(sx, sy, sw, 1, lite(cyan, 0.35));
    // The screen throws light into the room. This is the only illumination in
    // here, so it is worth two passes: a tight one on the wall and a wide one.
    C.glow(sx + sw / 2, sy + sh / 2, 12, cyan, 0.22);
    C.wash(sx + sw / 2, sy + sh + 10, 30, cyan, 0.55, 0.3);
  }

  // -- The map table --------------------------------------------------------
  // Lit from within, the way a plotting table is, so the maps on it are the
  // brightest thing below the wall.
  const tx = 44, ty = 50, tw = 152, th = 14;
  C.rect(tx - 2, ty - 2, tw + 4, th + 4, dark(concrete, 0.55));
  C.rect(tx, ty, tw, th, mix('#123038', cyan, 0.1));
  // Maps laid over it: paper, but paper under cyan light is not white.
  const paper = mix('#cfd8cf', cyan, 0.22);
  C.rect(tx + 8, ty + 2, 60, 10, mix(paper, deep, 0.15));
  C.rect(tx + 74, ty + 3, 52, 8, mix(paper, deep, 0.22));
  // Coastline and a border scrawled across the big one.
  for (let x = tx + 10; x < tx + 66; x++) {
    C.rect(x, ty + 5 + Math.round(Math.sin(x * 0.4) * 1.6), 1, 1, mix('#0d2a30', cyan, 0.25));
  }
  for (let x = tx + 12; x < tx + 64; x += 3) C.rect(x, ty + 9, 2, 1, mix('#8a2b2b', cyan, 0.15));
  // The pawns. Two sides: ours pale, theirs dark red, each a head and a base so
  // it reads as a piece rather than a dot.
  const piece = (px, py, body) => {
    C.rect(px, py + 3, 4, 2, dark(body, 0.35));   // base
    C.rect(px + 1, py, 2, 3, body);               // body
    C.rect(px + 1, py - 1, 2, 1, lite(body, 0.25));
  };
  const ours = mix('#dfe9ec', cyan, 0.25);
  const theirs = mix('#c2483c', cyan, 0.1);
  for (let i = 0; i < 5; i++) piece(tx + 14 + i * 9, ty + 4, ours);
  for (let i = 0; i < 4; i++) piece(tx + 22 + i * 9, ty + 1, theirs);
  for (let i = 0; i < 3; i++) piece(tx + 82 + i * 11, ty + 4, ours);
  C.glow(tx + tw / 2, ty + th / 2, 20, cyan, 0.12);

  // -- The generals ---------------------------------------------------------
  //
  // Heads and shoulders at the near edge, cropped by the frame: we are standing
  // at the back of the room looking past them at the table. Drawn full-length
  // they were four black columns — at this scale a standing figure and a
  // structural pier are the same rectangle, and the room read as a car park.
  // A head with shoulders under it cannot be read as anything else.
  const figure = (fx, top, wide) => {
    const body = dark(concrete, 0.78);
    const rim = mix(cyan, concrete, 0.4);
    const headW = 7, headH = 7;
    const hx = fx + Math.round((wide - headW) / 2);
    // Shoulders: three steps out from the neck, so the slope reads.
    C.rect(fx + 2, top + headH + 1, wide - 4, 2, body);
    C.rect(fx, top + headH + 3, wide, DEF.h - (top + headH + 3), body);
    C.rect(hx, top, headW, headH, body);
    // The wall of screens is behind us, so the light lands on the tops: the
    // crown of the head and the line of the shoulders, not the sides.
    C.rect(hx, top, headW, 1, rim);
    C.rect(fx + 2, top + headH + 1, wide - 4, 1, mix(rim, body, 0.35));
    C.rect(fx, top + headH + 3, wide, 1, mix(rim, body, 0.55));
    // One of them has an ear lit, which is the detail that makes it a person.
    C.rect(hx + headW - 1, top + 3, 1, 2, mix(rim, body, 0.2));
  };
  figure(26, 46, 16);
  figure(88, 42, 18);
  figure(146, 47, 15);
  figure(196, 44, 17);
  return C;
}

// to the balustrade, and stops there rather than drifting across the stone floor.
// --- The Department of the Treasury ----------------------------------------

const EXCH = { w: 240, h: 72 };

/**
 * The Secretary of the Treasury's room: as fine as the Oval Office and built for
 * this century. Marble wall, tall steel-framed window, a glass-and-steel desk
 * with the same weight as the President's — and where the President keeps flags,
 * this keeps screens, because the instrument of this office is a price feed.
 *
 * Where the Oval is old timber and older ceremony, this room is stone and glass:
 * a modern, technological department that looks the part.
 */
function exchequerRoom(world) {
  const P = palette(world);
  const C = Canvas(EXCH.w, EXCH.h);
  const dim = P.dim;
  const panel = mix('#dde0e7', '#363b45', dim);   // pale, book-matched marble
  const vein = dark(panel, 0.16);                  // its veining
  const steel = mix('#9aa2af', '#454b55', dim);    // brushed steel / glazing bars
  const floor = mix('#c6cad4', '#2a2e37', dim);    // polished marble floor

  // Wall: book-matched marble with faint veining and a slim steel rail at waist
  // height — the cool, even light of a room fitted out this decade, not the last
  // century. The instrument on the desk is modern; now the room is too.
  C.vgrad(0, 0, EXCH.w, 46, [lite(panel, 0.05), panel, dark(panel, 0.07)]);
  for (let x = 0; x < EXCH.w; x += 40) C.rect(x, 0, 1, 46, dark(panel, 0.1)); // slab joints
  for (let v = 0; v < 5; v++) C.line(6 + v * 48, 2, 20 + v * 48, 44, vein);    // veins drift
  C.rect(0, 30, EXCH.w, 2, steel);                                            // the waist rail
  C.rect(0, 32, EXCH.w, 1, dark(steel, 0.3));

  // The window: tall, twelve panes in a steel frame, the city and weather beyond.
  const WX = 150, WYY = 6, WWD = 66, WHT = 30;
  C.rect(WX - 3, WYY - 3, WWD + 6, WHT + 6, dark(steel, 0.25));
  C.rect(WX - 2, WYY - 2, WWD + 4, WHT + 4, lite(steel, 0.1));
  C.vgrad(WX, WYY, WWD, WHT, [P.sky[0], P.sky[1], P.sky[2]]);
  // A skyline of offices, because this is the district the money is in.
  for (let i = 0; i < 7; i++) {
    const bw = 6 + ((i * 5) % 5), bh = 8 + ((i * 7) % 13);
    const bx = WX + 2 + i * 9;
    if (bx + bw > WX + WWD - 1) continue;
    C.rect(bx, WYY + WHT - bh, bw, bh, mix('#2a3550', '#0d1220', dim * 0.7));
    for (let ly = WYY + WHT - bh + 2; ly < WYY + WHT - 2; ly += 3) {
      for (let lx = bx + 1; lx < bx + bw - 1; lx += 3) {
        if ((lx + ly + i) % 4 === 0) C.rect(lx, ly, 1, 1, mix('#f2c230', '#6a5210', dim));
      }
    }
  }
  for (let x = WX; x < WX + WWD; x += 17) C.rect(x, WYY, 1, WHT, dark(steel, 0.1));
  for (let y = WYY; y < WYY + WHT; y += 11) C.rect(WX, y, WWD, 1, dark(steel, 0.1));

  // Floor: polished marble in large tiles under a soft sheen, and a steel
  // medallion set into the stone with a green inlay — the money is in the floor.
  C.vgrad(0, 46, EXCH.w, 26, [dark(floor, 0.1), floor, lite(floor, 0.08)]);
  for (let x = 0; x < EXCH.w; x += 22) C.rect(x, 46, 1, 26, dark(floor, 0.09)); // tile joints
  for (let y = 54; y < 72; y += 9) C.rect(0, y, EXCH.w, 1, dark(floor, 0.06));
  const rug = mix('#2f5142', '#0e1a14', dim * 0.6);
  C.disc(96, 60, 74, 9, dark(floor, 0.16));
  C.disc(96, 60, 70, 8, lite(floor, 0.05));
  C.ring(96, 60, 62, 6, steel);
  C.disc(96, 60, 34, 4, rug);
  C.ring(96, 60, 34, 4, mix('#c9a227', '#4a3b0e', dim));

  // The desk: a marble slab on a brushed-steel frame with a frosted-glass front
  // — the same broad weight as the President's, in this century's materials.
  const DX = 40, DY = 44, DW = 118, DH = 16;
  const stone = mix('#e2e5eb', '#3c414b', dim);       // marble top
  const frost = mix('#aeb9c4', '#2b333c', dim * 0.9); // frosted glass front
  C.rect(DX - 3, DY - 3, DW + 6, 4, lite(stone, 0.06));   // the far edge of the slab
  C.rect(DX, DY, DW, DH, frost);                          // the glass body
  C.rect(DX, DY, DW, 3, stone);                           // the marble top
  C.rect(DX, DY + 3, DW, 1, steel);                       // steel reveal
  for (const kx of [DX + 24, DX + 58, DX + DW - 24]) C.rect(kx, DY + 4, 1, DH - 4, dark(steel, 0.15)); // mullions
  C.rect(DX + 6, DY + 5, 2, DH - 7, lite(frost, 0.12));   // a reflection down the glass
  C.rect(DX + 2, DY + DH, 3, 10, dark(steel, 0.2));       // steel legs
  C.rect(DX + DW - 5, DY + DH, 3, 10, dark(steel, 0.2));

  // The chair: a modern high-back in charcoal and steel, behind the screens.
  const chair = mix('#2b2f36', '#0f1216', dim);
  C.rect(90, 24, 22, 22, chair);
  C.rect(92, 22, 18, 3, steel);
  C.rect(92, 26, 18, 2, lite(chair, 0.1));

  // The screens. Where the Oval has flags on the desk, this has a price feed:
  // three panels of green and red bars, tilted to the chair, throwing light.
  // The price feed.
  //
  // These used to be bars whose heights came straight off a hash, which gave
  // three screens of noise with no trend in them — a bar chart of nothing. A
  // price is a *walk*: each one is the last one plus a step, and what makes it
  // read as a market is that consecutive bars are related. So the middle screen
  // is candles off a walk, with wicks and a body that is green when it closed
  // above where it opened, and the two flanking it are quote boards — a symbol,
  // a price, and which way it went.
  const up = mix('#3fd07a', '#0d3a20', dim * 0.4);
  const down = mix('#f0554a', '#4a1a0d', dim * 0.4);
  const glass = mix('#0b1a14', '#050a08', dim * 0.5);
  const bezel = mix('#20242c', '#0a0c10', dim);

  /** A stable random walk: same seed, same chart, every repaint. */
  const walk = (seed, n, span) => {
    const out = [];
    let v = 0.5;
    for (let i = 0; i < n; i++) {
      v = clamp01(v + (h1(seed * 97 + i * 13) - 0.47) * 0.34);
      out.push(1 + Math.round(v * (span - 2)));
    }
    return out;
  };

  const chartScreen = (sx, sy, sw, sh, seed) => {
    C.rect(sx - 1, sy - 1, sw + 2, sh + 2, bezel);
    C.rect(sx, sy, sw, sh, glass);
    // A dotted midline, the way a quote screen marks the previous close.
    for (let x = sx + 1; x < sx + sw - 1; x += 2) C.set(x, sy + Math.floor(sh / 2), mix('#2c5f48', '#0c1f16', dim * 0.5));
    const n = Math.floor((sw - 2) / 3);
    const price = walk(seed, n + 1, sh - 2);
    for (let i = 0; i < n; i++) {
      const o = price[i], c = price[i + 1];
      const bx = sx + 1 + i * 3;
      const top = sy + sh - 1 - Math.max(o, c);
      const body = Math.max(1, Math.abs(c - o));
      const col = c >= o ? up : down;
      // The wick: a pixel above and below the body, which is most of what makes
      // a candle look like a candle at this size.
      C.rect(bx + 1, top - 1, 1, body + 2, dark(col, 0.25));
      C.rect(bx, top, 2, body, col);
    }
    C.rect(sx, sy, sw, 1, mix('#7fd8a8', '#1d5236', dim * 0.5));
    C.rect(sx + 2, sy + sh + 1, sw - 4, 2, dark(bezel, 0.2));
  };

  const quoteScreen = (sx, sy, sw, sh, seed) => {
    C.rect(sx - 1, sy - 1, sw + 2, sh + 2, bezel);
    C.rect(sx, sy, sw, sh, glass);
    // Rows: a ticker symbol, the price, and the arrow. Four or five of them,
    // which at this scale is exactly what a board across a room looks like.
    for (let r = 0, y = sy + 2; y < sy + sh - 2; y += 3, r++) {
      const rose = h1(seed * 31 + r * 7) > 0.44;
      const col = rose ? up : down;
      C.rect(sx + 2, y, 5, 1, mix('#8fa8bb', '#26323d', dim * 0.5));        // the symbol
      const digits = 4 + Math.floor(h1(seed * 53 + r) * 4);
      C.rect(sx + 9, y, digits, 1, mix('#d8e2ea', '#3a444d', dim * 0.5));   // the price
      C.rect(sx + sw - 4, y, 2, 1, col);                                     // the arrow
      C.set(sx + sw - 3, y + (rose ? -1 : 1), col);
    }
    C.rect(sx, sy, sw, 1, mix('#7fd8a8', '#1d5236', dim * 0.5));
    C.rect(sx + 2, sy + sh + 1, sw - 4, 2, dark(bezel, 0.2));
  };

  quoteScreen(56, 30, 26, 13, 3);
  chartScreen(86, 27, 30, 16, 11);
  quoteScreen(120, 30, 24, 13, 7);
  // Their light on the marble, which is what makes them part of the room.
  C.wash(96, 46, 46, mix('#2f7f5a', '#0a1a12', dim), 0.55, 0.3);

  // A ledger and a cup, because somebody works here.
  C.rect(DX + 8, DY - 2, 14, 3, mix('#d9cdb4', '#6b6252', dim));
  C.rect(DX + 8, DY - 3, 14, 1, mix('#efe7d3', '#7a6f5c', dim));
  C.rect(DX + DW - 20, DY - 3, 4, 4, mix('#efe7d3', '#7a6f5c', dim));

  return C;
}

// --- The company, in three storeys -----------------------------------------

const CO = { w: 240, h: 72 };

const CHAM = { w: 240, h: 72 };

/**
 * The floor of the Assembly, from the well, looking at the rostrum.
 *
 * Every other branch had its room. The executive has the Oval Office, the bench
 * has its chambers and the portico, the departments have three rooms of their
 * own, and a founder gets a basement that turns into a campus — and the
 * legislature, which is the branch this whole game is actually about, had a
 * page of documents and no place to stand. This is the place: the tiered desks
 * curving away on both sides, the rostrum in the middle of them, and the flag
 * behind it on the wall.
 *
 * It is drawn empty, like every other room here. A chamber with members in it
 * would be a picture of a particular sitting; a chamber without them is the
 * room the sitting happens in, which is what the tab is for — and the Chronicle
 * is where the people are.
 *
 * The view is from the well, standing where a member speaks. So the rostrum is
 * dead ahead and the desks sweep down and out to both corners: the near end of
 * a curved rank is at the edge of the frame and the far end of it is behind the
 * rostrum, which is why the arcs run *downward* toward the sides.
 */
function chamber(world) {
  const P = palette(world);
  const C = Canvas(CHAM.w, CHAM.h);
  const dim = P.dim;
  // The chamber is lit from above and always has been — it is a windowless room
  // in the middle of a building — so unlike the Oval it does not take the
  // season's light on the walls. What it takes is the season's *warmth*: the
  // same lamps over the same walnut read colder in February.
  const wood = mix('#6b4526', '#2a1a10', 0.25 + dim * 0.4);
  const woodHi = lite(wood, 0.16), woodLo = dark(wood, 0.34);
  const bench = mix('#7a5230', '#2e1d11', 0.22 + dim * 0.38);
  const benchHi = lite(bench, 0.2), benchLo = dark(bench, 0.36);
  const stone = mix('#cfc6b2', '#3a362e', 0.18 + dim * 0.45);
  const brass = mix('#c9a227', '#4a3b0e', 0.2 + dim * 0.5);
  const carpet = mix('#2f4a63', '#101a26', 0.2 + dim * 0.45);

  // -- The wall behind the rostrum -----------------------------------------
  // Walnut panelling, panel joints every twenty, and a stone pilaster at each
  // quarter. The panels are shaded top-down: the light is in the ceiling.
  C.vgrad(0, 0, CHAM.w, 46, [lite(wood, 0.1), wood, dark(wood, 0.12)], 2);
  for (let x = 0; x < CHAM.w; x += 20) {
    C.rect(x, 4, 1, 42, woodLo);
    C.rect(x + 1, 4, 1, 42, woodHi);
  }
  // The cornice, and the inscription band under it. The words are not letters —
  // at three pixels high nothing is — they are the *rhythm* of letters, which
  // is what you actually see of an inscription across a room this size.
  C.rect(0, 0, CHAM.w, 4, stone);
  C.rect(0, 0, CHAM.w, 1, lite(stone, 0.22));
  C.rect(0, 3, CHAM.w, 1, dark(stone, 0.3));
  C.rect(0, 4, CHAM.w, 5, mix(stone, wood, 0.35));
  for (let x = 34; x < 206; x += 4) {
    if ((x / 4) % 7 === 3) continue;                    // the spaces between words
    C.rect(x, 6, 2, 2, dark(stone, 0.42));
  }
  for (const px of [16, 52, 188, 224]) {                 // pilasters
    C.rect(px, 9, 10, 37, stone);
    C.rect(px, 9, 2, 37, lite(stone, 0.14));
    C.rect(px + 8, 9, 2, 37, dark(stone, 0.22));
    C.rect(px - 1, 9, 12, 2, lite(stone, 0.2));          // capital
    C.rect(px - 1, 44, 12, 2, dark(stone, 0.14));        // base
  }

  // The flag on the wall, hung flat rather than flown — this one is nailed up
  // behind the chair, so it has no pole and no fold, only its own weight.
  //
  // It was two colour bands and a black disc — Silver's flag, drawn from
  // `FLAG.hoist`, `FLAG.fly` and `FLAG.disc`, three keys the Stars and Stripes
  // does not have. Every one of them was `undefined`, so the whole thing was
  // mixed from nothing and came out a colour nobody chose.
  //
  // Nine stripes across eighteen rows rather than thirteen: two rows is the
  // least that still reads as a stripe, and an odd count is what puts red at
  // the top and the bottom. The canton takes the top four stripes and
  // two-fifths of the fly, the real proportion and the thing the eye actually
  // recognises. Same vocabulary as `nationalFlag`, at the size this wall gives.
  const d = dim * 0.5;
  const red = mix(FLAG.red, '#2a0c10', d);
  const white = mix(FLAG.white, '#2c2c34', d);
  const blue = mix(FLAG.blue, '#080c1c', d);
  C.rect(94, 10, 52, 2, dark(stone, 0.4));               // the rail it hangs from
  const FX = 95, FY = 12, FW = 50, SH = 2;
  for (let r = 0; r < 9; r++) C.rect(FX, FY + r * SH, FW, SH, r % 2 === 0 ? red : white);
  C.rect(FX, FY, 20, SH * 4, blue);                      // the canton
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) C.set(FX + 2 + c * 4, FY + 1 + r * 2, white);
  }
  // Two folds, hanging. Vertical, because the stripes are already horizontal
  // and a horizontal shadow over them reads as a tenth stripe in the wrong
  // colour; and clear of the canton, which has no cloth to spare.
  for (const fx of [FX + 30, FX + 42]) C.rect(fx, FY, 1, 18, dark(red, 0.22));
  C.rect(FX, FY + 17, FW, 1, dark(wood, 0.4));

  // -- The floor -----------------------------------------------------------
  C.vgrad(0, 44, CHAM.w, 28, [dark(carpet, 0.14), carpet, lite(carpet, 0.08)], 3);
  for (let x = 0; x < CHAM.w; x += 30) C.rect(x, 44, 1, 28, dark(carpet, 0.08));

  // -- The desks -----------------------------------------------------------
  //
  // Three ranks, curving away from the well. The arc is a parabola rather than
  // a circle and deliberately so: a true circular rank at this aspect either
  // leaves the frame or flattens to a straight line, and what the eye is
  // actually reading here is "these run away from me and around", which a
  // quadratic gives at a tenth of the arithmetic.
  // Shallow, and spaced far enough apart that carpet shows between them. At a
  // steeper sweep the three ranks ran into each other in the corners and the
  // whole bottom half of the frame came out as one undifferentiated slab of
  // walnut — three ranks that read as three is the entire job here, and the
  // thing that separates them is the floor you can see between them.
  const rankY = (x, j) => Math.round(44 + j * 11 + ((x - 120) / 120) ** 2 * 15);
  for (let j = 0; j < 3; j++) {
    const t = j / 2;                                     // 0 far, 1 near
    // Nearer is lighter and warmer: there is more light on it and it is closer
    // to the eye, and it is what stops the ranks reading as one object.
    const face = mix(benchLo, benchHi, 0.25 + t * 0.45);
    const top = lite(face, 0.26);
    for (let x = 0; x < CHAM.w; x++) {
      const y = rankY(x, j);
      if (y >= CHAM.h) continue;
      C.rect(x, y, 1, 1, top);                           // the desk edge, catching the light
      C.rect(x, y + 1, 1, 6, face);                      // its front
      C.rect(x, y + 7, 1, 1, dark(face, 0.45));          // and the shadow under it
    }
    // The divisions between one member's place and the next, staggered rank to
    // rank the way seats in a curved chamber actually fall.
    for (let x = 6 + j * 5; x < CHAM.w; x += 15) {
      const y = rankY(x, j);
      if (y >= CHAM.h) continue;
      C.rect(x, y + 1, 1, 5, dark(face, 0.34));
      C.rect(x + 1, y + 1, 1, 5, lite(face, 0.12));
    }
  }

  // -- The rostrum ---------------------------------------------------------
  //
  // Three tiers, drawn over the middle of the ranks — which is what hides the
  // far end of the arcs, and the reason they can be a crude parabola without
  // anybody being able to tell.
  const tier = (x0, y0, w2, h2, c) => {
    C.rect(x0, y0, w2, h2, c);
    C.rect(x0, y0, w2, 1, lite(c, 0.24));                // the top surface
    C.rect(x0, y0 + 1, w2, 1, dark(c, 0.1));
    C.rect(x0, y0 + h2 - 1, w2, 1, dark(c, 0.42));       // and the shadow it throws
    C.rect(x0, y0, 1, h2, lite(c, 0.12));
    C.rect(x0 + w2 - 1, y0, 1, h2, dark(c, 0.3));
    for (let px = x0 + 5; px < x0 + w2 - 4; px += 11) {  // sunk panels in the face
      C.rect(px, y0 + 3, 7, h2 - 6, dark(c, 0.14));
      C.rect(px, y0 + 3, 7, 1, dark(c, 0.28));
      C.rect(px, y0 + h2 - 4, 7, 1, lite(c, 0.12));
    }
  };
  // The Speaker's chair, standing above the top tier and clear of the disc.
  C.rect(112, 30, 16, 12, dark(wood, 0.24));
  C.rect(112, 30, 16, 2, lite(wood, 0.2));
  C.rect(114, 32, 12, 8, mix(carpet, '#000000', 0.18));
  C.rect(114, 32, 12, 1, lite(carpet, 0.22));
  tier(98, 40, 44, 10, wood);                            // the Speaker's desk
  tier(84, 48, 72, 10, mix(wood, benchLo, 0.25));        // the clerks
  tier(70, 56, 100, 16, mix(wood, benchLo, 0.45));       // the well rail

  // The two lamps on the Speaker's desk, and the gavel block between them.
  for (const lx of [102, 137]) {
    C.rect(lx, 37, 1, 3, brass);
    C.rect(lx - 2, 34, 5, 3, brass);
    C.rect(lx - 2, 34, 5, 1, lite(brass, 0.35));
    C.glow(lx, 36, 4, mix(P.warm, brass, 0.4), 0.5);
  }
  C.rect(117, 38, 6, 2, dark(wood, 0.45));
  C.rect(117, 38, 6, 1, brass);

  // The mace on its pedestal, off to the Speaker's right. It is the one object
  // in the room that says which chamber this is: a legislature keeps its mace
  // up while it is sitting and takes it down when it has resolved into
  // committee, so a room drawn with the mace up is a room in session.
  C.rect(174, 48, 10, 24, dark(wood, 0.34));             // the pedestal, to the floor
  C.rect(174, 48, 10, 2, lite(wood, 0.12));
  C.rect(174, 48, 2, 24, lite(wood, 0.06));
  C.rect(182, 48, 2, 24, dark(wood, 0.5));
  C.rect(178, 32, 2, 16, dark(brass, 0.2));              // the shaft
  C.rect(178, 32, 1, 16, brass);
  C.disc(179, 30, 3, 3, brass);                          // and the globe on it
  C.set(178, 29, lite(brass, 0.4));

  return C;
}

/**
 * Three rooms for one career, and the only thing that picks between them is
 * what the company is worth.
 *
 * They are built to be read as a sequence, so each one answers the last. The
 * basement's window is at the top of the wall and shows you a strip of pavement
 * — you are below the city. The office's window is full of somebody else's
 * building with no sky in it at all — you are inside the city and level with it.
 * The tower's whole wall is glass and the city is *underneath* — and by then the
 * light in the room comes off the skyline rather than off a bulb.
 *
 * A founder who goes back down a storey gets the old room back, which is the
 * point of tying the art to the valuation rather than to a milestone flag.
 */
function companyBasement(world) {
  const P = palette(world);
  const C = Canvas(CO.w, CO.h);
  const dim = P.dim;
  const wall = mix('#5a5c60', '#16181c', 0.35 + dim * 0.4);
  const floorC = mix('#3a3c40', '#101216', 0.4 + dim * 0.35);

  // Bare block wall, mortar courses, damp in the corner.
  C.vgrad(0, 0, CO.w, 50, [dark(wall, 0.2), wall, dark(wall, 0.08)]);
  for (let y = 6; y < 50; y += 8) C.rect(0, y, CO.w, 1, dark(wall, 0.22));
  for (let y = 6; y < 50; y += 8) {
    for (let x = ((y / 8) % 2 ? 0 : 12); x < CO.w; x += 24) C.rect(x, y, 1, 8, dark(wall, 0.18));
  }
  C.wash(18, 14, 22, '#2a3a30', 0.5, 0.22);

  // The window: a slot at the very top of the wall, because the room is under
  // the pavement. What comes through it is a strip of daylight and railings.
  const WX = 138, WY2 = 4, WW2 = 58, WH2 = 12;
  C.rect(WX - 2, WY2 - 2, WW2 + 4, WH2 + 4, dark(wall, 0.42));
  C.vgrad(WX, WY2, WW2, WH2, [P.sky[2], P.sky[3]]);
  C.rect(WX, WY2 + WH2 - 4, WW2, 4, mix(P.ground, '#2a2a2a', 0.45 + dim * 0.3));
  for (let x = WX + 4; x < WX + WW2 - 2; x += 7) C.rect(x, WY2 + 1, 1, WH2 - 4, dark(wall, 0.5));
  C.rect(WX, WY2 + WH2, WW2, 1, dark(wall, 0.5));

  // A bare bulb, and everything it reaches.
  C.rect(70, 0, 1, 9, dark(wall, 0.5));
  C.rect(69, 9, 3, 3, mix('#fff2c0', '#6a5a2a', dim * 0.5));
  C.glow(70, 11, 26, '#ffe9a8', 0.5);

  // Floor: concrete, and a rug that was somebody's before it was here.
  C.vgrad(0, 50, CO.w, 22, [dark(floorC, 0.14), floorC, lite(floorC, 0.04)]);
  C.rect(24, 58, 74, 12, mix('#6b4a52', '#1c1216', 0.4 + dim * 0.3));
  C.rect(24, 58, 74, 1, mix('#8a6470', '#241a1e', 0.4 + dim * 0.3));

  // A mattress on the floor, in the corner opposite the computer, with sheets
  // pushed back the way somebody left them getting up. Nobody has a room
  // upstairs — this is where they sleep, three hours at a stretch between
  // stints at the CRT. The sheets in a heap are the point of the picture;
  // ironed corners would say something else about the phase.
  const bx = 6, by = 54;
  const bedFrame = mix('#3a2e26', '#0e0b08', 0.35 + dim * 0.3);
  const mattress = mix('#c8b898', '#3a3226', 0.4 + dim * 0.3);
  const sheet = mix('#e8ded0', '#4c463c', 0.35 + dim * 0.4);
  const shadow = mix('#5a4030', '#0c0906', 0.4 + dim * 0.35);
  // Frame, three sides visible. Bare wood, no headboard.
  C.rect(bx, by + 12, 34, 2, bedFrame);
  C.rect(bx, by + 4, 2, 10, bedFrame);
  C.rect(bx + 32, by + 4, 2, 10, bedFrame);
  // Mattress sagging under the sheets. A pillow at the head, flattened.
  C.rect(bx + 2, by + 4, 30, 8, mattress);
  C.rect(bx + 2, by + 4, 30, 1, lite(mattress, 0.12));
  C.rect(bx + 2, by + 4, 6, 4, sheet);                // pillow, pushed to the wall
  // The heap of sheet, pulled back and left. Two loose folds and a corner
  // hanging off the foot of the bed.
  C.rect(bx + 8, by + 6, 20, 6, sheet);
  C.rect(bx + 10, by + 5, 14, 1, lite(sheet, 0.1));
  C.rect(bx + 6, by + 8, 3, 3, dark(sheet, 0.14));
  C.rect(bx + 22, by + 7, 4, 2, dark(sheet, 0.1));
  C.rect(bx + 28, by + 12, 6, 5, sheet);              // hem hanging off the end
  C.rect(bx + 29, by + 12, 4, 1, dark(sheet, 0.18));
  // A shadow on the concrete where it meets the wall.
  C.wash(bx + 4, by + 3, 12, shadow, 0.5, 0.28);

  // The folding table, and the computer that is the whole company.
  const TX = 46, TY = 40, TW = 62;
  C.rect(TX, TY, TW, 3, mix('#b9a382', '#3c3324', 0.35 + dim * 0.35));
  C.rect(TX, TY + 3, TW, 1, dark(mix('#b9a382', '#3c3324', 0.35 + dim * 0.35), 0.3));
  C.rect(TX + 4, TY + 4, 2, 14, mix('#8a8f96', '#25282d', 0.4 + dim * 0.3));
  C.rect(TX + TW - 6, TY + 4, 2, 14, mix('#8a8f96', '#25282d', 0.4 + dim * 0.3));
  // A CRT: deep box, and a screen doing the only work in the room.
  C.rect(TX + 18, TY - 17, 26, 17, mix('#cfc7b4', '#3a362c', 0.4 + dim * 0.35));
  C.rect(TX + 20, TY - 15, 22, 13, '#0d1a14');
  for (let y = TY - 14; y < TY - 3; y += 2) {
    C.rect(TX + 21, y, 18 - ((y * 5) % 7), 1, mix('#5ee08a', '#12351f', 0.25 + dim * 0.35));
  }
  C.glow(TX + 31, TY - 9, 22, '#3fd07a', 0.34);
  // A keyboard, a mug, and a stack of boxes nobody has unpacked.
  C.rect(TX + 16, TY - 1, 22, 2, mix('#9aa0a8', '#2a2d33', 0.4 + dim * 0.3));
  C.rect(TX + 46, TY - 3, 4, 3, mix('#d9dde2', '#3a3d42', 0.4 + dim * 0.3));
  for (const [bx, by, bw, bh] of [[186, 46, 22, 14], [190, 34, 16, 12], [212, 50, 18, 10]]) {
    C.rect(bx, by, bw, bh, mix('#a98a5e', '#33291a', 0.4 + dim * 0.3));
    C.rect(bx, by, bw, 1, lite(mix('#a98a5e', '#33291a', 0.4 + dim * 0.3), 0.14));
    C.rect(bx + 2, by + Math.floor(bh / 2), bw - 4, 1, dark(mix('#a98a5e', '#33291a', 0.4 + dim * 0.3), 0.3));
  }
  return C;
}

function companyOffice(world) {
  const P = palette(world);
  const C = Canvas(CO.w, CO.h);
  const dim = P.dim;
  const wall = mix('#cfcabd', '#2c2a26', 0.2 + dim * 0.45);
  const carpet = mix('#5b6a72', '#191d21', 0.35 + dim * 0.35);

  C.vgrad(0, 0, CO.w, 48, [lite(wall, 0.06), wall, dark(wall, 0.1)]);
  C.rect(0, 44, CO.w, 2, dark(wall, 0.24));

  // The window, and the joke in it: no sky. You are level with the middle of
  // somebody else's building, close enough to count their lights.
  const WX = 128, WY2 = 6, WW2 = 96, WH2 = 34;
  C.rect(WX - 3, WY2 - 3, WW2 + 6, WH2 + 6, dark(wall, 0.34));
  C.rect(WX - 2, WY2 - 2, WW2 + 4, WH2 + 4, lite(wall, 0.1));
  const facade = mix('#6d7684', '#1b2028', 0.3 + dim * 0.4);
  C.rect(WX, WY2, WW2, WH2, facade);
  // A grid of their windows, some of them working late.
  for (let gy = WY2 + 2; gy < WY2 + WH2 - 2; gy += 6) {
    for (let gx = WX + 3; gx < WX + WW2 - 5; gx += 8) {
      const lit = ((gx * 7 + gy * 13) % 5) < 2;
      C.rect(gx, gy, 5, 4, lit ? mix('#f4d27a', '#5c4a1e', dim * 0.6) : dark(facade, 0.3));
    }
  }
  // A slice of daylight down one side, so it reads as outside rather than as a
  // wall: the gap between their building and ours.
  C.vgrad(WX + WW2 - 9, WY2, 9, WH2, [P.sky[1], P.sky[2]]);
  C.rect(WX + WW2 - 9, WY2, 1, WH2, dark(facade, 0.4));
  for (let x = WX; x < WX + WW2; x += 32) C.rect(x, WY2, 1, WH2, dark(wall, 0.3));

  // Cubicle partitions — the real signature of this stage of a company.
  const part = mix('#8d9a86', '#232a20', 0.3 + dim * 0.4);
  C.rect(0, 26, 108, 18, part);
  C.rect(0, 26, 108, 1, lite(part, 0.14));
  C.rect(52, 26, 1, 18, dark(part, 0.26));
  C.rect(104, 12, 4, 32, part);
  C.rect(104, 12, 4, 1, lite(part, 0.14));

  C.vgrad(0, 48, CO.w, 24, [dark(carpet, 0.12), carpet, lite(carpet, 0.04)]);

  // Two desks, two flat panels, one plant that is somebody's project.
  for (const dx of [10, 62]) {
    C.rect(dx, 40, 40, 3, mix('#b6a98e', '#332c1f', 0.3 + dim * 0.35));
    C.rect(dx + 2, 43, 2, 12, mix('#7d838a', '#22262b', 0.35 + dim * 0.3));
    C.rect(dx + 34, 43, 2, 12, mix('#7d838a', '#22262b', 0.35 + dim * 0.3));
    C.rect(dx + 12, 30, 18, 10, mix('#2a2e34', '#0c0e12', dim * 0.6));
    C.rect(dx + 13, 31, 16, 8, mix('#4a7fd0', '#12233f', 0.2 + dim * 0.5));
    C.rect(dx + 19, 40, 4, 2, mix('#2a2e34', '#0c0e12', dim * 0.6));
    C.glow(dx + 21, 35, 14, '#5a90e0', 0.2);
  }
  C.rect(116, 50, 6, 10, mix('#8a6a4a', '#2a2016', 0.35 + dim * 0.3));
  for (const [lx, ly] of [[113, 44], [119, 42], [116, 39], [122, 46]]) {
    C.rect(lx, ly, 5, 4, mix('#4f9a52', '#16301a', 0.25 + dim * 0.45));
  }
  return C;
}

function companyTower(world) {
  const P = palette(world);
  const C = Canvas(CO.w, CO.h);
  const dim = P.dim;
  const floorC = mix('#2b2f36', '#0a0c10', 0.3 + dim * 0.3);

  // The whole wall is glass, and the city is below the sill rather than across
  // from it. Sky at the top, then the skyline, then the streets under you.
  C.vgrad(0, 0, CO.w, 20, P.sky);
  stars(C, P, 41, 0, 1, CO.w, 14, 26);
  luminary(C, P, 22, 206, 4, 16);
  clouds(C, P, 29, 5, 4, CO.w);

  // A downtown, seen from above: the near towers do not reach us.
  const towers = [
    [6, 30, 18], [28, 24, 14], [46, 34, 20], [70, 20, 12], [86, 30, 22],
    [112, 26, 16], [132, 36, 18], [154, 22, 14], [172, 32, 20], [196, 27, 15], [216, 33, 18],
  ];
  for (const [tx, ty, tw] of towers) {
    const body = mix('#38424f', '#0b0f16', 0.25 + dim * 0.5);
    C.rect(tx, ty, tw, 46 - ty + 14, body);
    C.rect(tx, ty, 1, 46 - ty + 14, lite(body, 0.1));
    for (let ly = ty + 3; ly < 46; ly += 4) {
      for (let lx = tx + 2; lx < tx + tw - 2; lx += 4) {
        if ((lx * 3 + ly * 5) % 7 < 3) C.rect(lx, ly, 2, 2, mix('#ffd478', '#6a4f18', dim * 0.55));
      }
    }
  }
  // Street level, far below, with the lights of it.
  C.rect(0, 44, CO.w, 6, mix('#141920', '#05070a', 0.3 + dim * 0.4));
  for (let x = 3; x < CO.w; x += 9) C.rect(x, 46, 2, 1, mix('#ffcf6a', '#5a4212', dim * 0.5));

  // The mullions. Only three, and floor to ceiling — that is the whole tell.
  for (const mx of [58, 118, 178]) C.rect(mx, 0, 2, 50, mix('#20242b', '#0a0c10', dim * 0.4));
  C.rect(0, 49, CO.w, 2, mix('#20242b', '#0a0c10', dim * 0.4));

  // The floor, and the city's light lying along it.
  C.vgrad(0, 51, CO.w, 21, [dark(floorC, 0.1), floorC, lite(floorC, 0.06)]);
  C.wash(120, 54, 130, '#ffcf6a', 0.4, 0.14);

  // One desk, placed off-centre and turned toward the glass, because the view
  // is the point of the room. Nothing on it but a screen and a phone.
  const DX = 24, DY = 52;
  C.rect(DX, DY, 84, 4, mix('#4a3a2c', '#150f0a', 0.25 + dim * 0.35));
  C.rect(DX, DY, 84, 1, lite(mix('#4a3a2c', '#150f0a', 0.25 + dim * 0.35), 0.16));
  C.rect(DX + 4, DY + 4, 3, 14, mix('#2a2f36', '#0b0e12', dim * 0.5));
  C.rect(DX + 76, DY + 4, 3, 14, mix('#2a2f36', '#0b0e12', dim * 0.5));
  C.rect(DX + 26, DY - 11, 30, 11, mix('#1c2027', '#080a0d', dim * 0.5));
  C.rect(DX + 27, DY - 10, 28, 9, mix('#2f6f8f', '#0c1d28', 0.2 + dim * 0.45));
  for (let i = 0; i < 5; i++) {
    C.rect(DX + 29 + i * 5, DY - 3 - ((i * 3) % 6), 3, 1 + ((i * 2) % 4), mix('#6fe0a0', '#173a26', 0.2 + dim * 0.4));
  }
  C.glow(DX + 41, DY - 6, 20, '#3fa0d0', 0.22);
  C.rect(DX + 66, DY - 3, 7, 3, mix('#15181d', '#07090c', dim * 0.4));

  // A chair with its back to us, facing the city.
  C.rect(150, 48, 16, 18, mix('#1e232a', '#080a0e', dim * 0.45));
  C.rect(150, 48, 16, 2, lite(mix('#1e232a', '#080a0e', dim * 0.45), 0.12));
  C.rect(156, 66, 4, 5, mix('#2a2f36', '#0b0e12', dim * 0.4));
  return C;
}

// The $200M company: not a floor in a tower but a campus of glass geodesic domes
// full of trees — the green-house headquarters a founder builds when the office
// is no longer the point. You stand on the walkway inside, the forest under the
// glass, the city small and distant beyond it.
function companyHQ(world) {
  const P = palette(world);
  const C = Canvas(CO.w, CO.h);
  const dim = P.dim;
  const baseY = 52;

  // Sky, and a low distant skyline — the campus sits out where there is room for
  // it, not stacked on a downtown block.
  C.vgrad(0, 0, CO.w, baseY, P.sky);
  stars(C, P, 37, 0, 1, CO.w, 10, 22);
  luminary(C, P, 26, 198, 5, 14);
  clouds(C, P, 33, 4, 3, CO.w);
  for (let i = 0; i < 10; i++) {
    const bw = 4 + (i * 3) % 6, bh = 4 + (i * 5) % 9, bx = 6 + i * 24;
    C.rect(bx, baseY - bh, bw, bh, mix('#39465a', '#111823', 0.3 + dim * 0.42));
  }

  const strut = mix('#cdd9df', '#3c4852', 0.18 + dim * 0.5);
  const glass = mix('#a6dcc0', '#153029', 0.22 + dim * 0.45);
  const leaf = (t) => mix('#4fa85e', '#123619', 0.18 + dim * 0.4 + t);

  // A glass geodesic dome: a filled half-ellipse of forest-tinted glass, ringed
  // by horizontal struts and ribbed by verticals meeting at the crown, with the
  // trees inside showing through it.
  const dome = (cx, rx, ry, trees) => {
    const apexY = baseY - ry;
    for (let x = cx - rx; x <= cx + rx; x++) {
      const t = (x - cx) / rx;
      if (Math.abs(t) > 1) continue;
      const top = Math.round(baseY - ry * Math.sqrt(1 - t * t));
      for (let y = top; y < baseY; y++) C.set(x, y, y - top < 3 ? lite(glass, 0.14) : glass);
    }
    for (const [tx, th, tw] of trees) {
      C.rect(cx + tx - 1, baseY - th, 2, th, mix('#5a3f2a', '#1c130b', 0.3 + dim * 0.3));
      C.disc(cx + tx, baseY - th - 3, tw, tw - 1, leaf(0.06));
      C.disc(cx + tx - 2, baseY - th, tw - 2, tw - 3, leaf(0.12));
    }
    for (const f of [0.34, 0.62, 0.86, 1]) {
      const r = rx * f, ryy = ry * f;
      for (let x = cx - r; x <= cx + r; x++) {
        const t = (x - cx) / r;
        if (Math.abs(t) > 1) continue;
        C.set(x, Math.round(baseY - ryy * Math.sqrt(1 - t * t)), strut);
      }
    }
    for (let i = -3; i <= 3; i++) C.line(cx + (i / 3) * rx, baseY, cx + (i / 6) * rx, apexY, strut);
    C.rect(cx - 1, apexY, 2, 2, strut);
  };

  dome(84, 54, 44, [[-24, 20, 6], [-6, 30, 8], [16, 24, 7], [30, 16, 5]]);
  dome(182, 30, 28, [[-10, 16, 5], [8, 20, 6]]);

  // A green wall along the base between the domes.
  C.rect(0, baseY - 4, CO.w, 4, mix('#2f5a37', '#0d1f11', 0.2 + dim * 0.45));
  for (let x = 2; x < CO.w; x += 5) C.rect(x, baseY - 5, 2, 2, leaf(((x * 7) % 5) / 40));

  // The walkway, warm light lying along it.
  const floorC = mix('#d7dbe0', '#2c3138', 0.18 + dim * 0.4);
  C.vgrad(0, baseY, CO.w, CO.h - baseY, [dark(floorC, 0.1), floorC, lite(floorC, 0.06)]);
  for (let x = 0; x < CO.w; x += 20) C.rect(x, baseY, 1, CO.h - baseY, dark(floorC, 0.08));
  C.wash(120, baseY + 4, 130, '#ffe6a0', 0.35, 0.12);

  // A pair of potted trees on the walkway, and a plain desk among them.
  for (const px of [26, 210]) {
    C.rect(px, baseY + 8, 8, 6, mix('#7a5a3a', '#2a1d10', 0.3 + dim * 0.3));
    C.disc(px + 4, baseY + 4, 7, 6, leaf(0.02));
    C.disc(px + 2, baseY + 6, 5, 4, leaf(0.1));
  }
  const DX = 92, DY = baseY + 9;
  C.rect(DX, DY, 56, 4, mix('#c7cdd3', '#343a41', 0.18 + dim * 0.4));
  C.rect(DX, DY, 56, 1, lite(mix('#c7cdd3', '#343a41', 0.18 + dim * 0.4), 0.16));
  C.rect(DX + 3, DY + 4, 3, 9, mix('#8a929b', '#30363d', dim * 0.4));
  C.rect(DX + 50, DY + 4, 3, 9, mix('#8a929b', '#30363d', dim * 0.4));
  C.rect(DX + 20, DY - 8, 18, 8, mix('#1c2027', '#080a0d', dim * 0.5));
  C.rect(DX + 21, DY - 7, 16, 6, mix('#2f6f8f', '#0c1d28', 0.2 + dim * 0.45));
  C.glow(DX + 29, DY - 4, 16, '#3fa0d0', 0.2);

  return C;
}

const ROOMS = {
  oval: {
    draw: oval, size: OVAL,
    vents: OVAL_WX.map((wx) => ({ x: wx + 1, y: WY, w: WW - 2, h: WH - 1, arch: true, dense: 3.5 })),
  },
  court: { draw: court, size: COURT, vents: [{ x: 26, y: 8, w: 188, h: 52 }] },
  balcony: { draw: balcony, size: BALC, vents: [{ x: 0, y: 0, w: BALC.w, h: 48 }] },
  // The other end of the same building. Same balustrade, same weather, a
  // different city over it — see `balcony`.
  balcony_upper: { draw: (world) => balcony(world, 'senate'), size: BALC, vents: [{ x: 0, y: 0, w: BALC.w, h: 48 }] },
  // The Mansion's weather is behind the glass, plus the slid-open panel — which
  // is the one place in that wall a flake can actually come through.
  // The Mansion's whole outside wall is glass, so the weather is most of the
  // frame — but only the parts of it nothing is standing in front of. The bed
  // takes the bottom of the glass on the left, the television takes a column of
  // it on the right, and the drapes take both ends; snow drawn over any of them
  // would be snow falling inside the room again.
  mansion: {
    draw: mansion, size: MANS,
    vents: [
      { x: 15, y: GY + 1, w: 107, h: 28, dense: 1.8 },            // above the bed
      { x: 122, y: GY + 1, w: 64, h: GH - 1, dense: 1.8 },        // the clear span, gap included
      { x: 186, y: GY + 1, w: 22, h: GH - 1, dense: 1.8 },        // between the bed and the set
      { x: GAP.x + 3, y: GY + GH + 1, w: GAP.w - 6, h: 9, dense: 1.2 },  // blown in through the gap
    ],
  },
  // Three windows onto the garden, and weather only in them.
  state: {
    draw: stateRoom, size: STATE,
    // No vents. Snow lands *on* a glasshouse, not in it — that is the whole
    // point of growing roses under one — so the conservatory keeps its weather
    // on the outside of the glass, like the war room keeps it above ground.
    vents: [],
  },
  // No vents at all. It is a basement: there is no sky in it to snow out of,
  // and that is exactly the contrast the pair of rooms is built on.
  defense: { draw: defenseRoom, size: DEF, vents: [] },
  // One deep window on the left, and the weather in it — a lawyer's room is a
  // room in a building, not a bunker.
  ag: {
    draw: justiceRoom, size: JUST,
    vents: [{ x: 10, y: 6, w: 40, h: 30, dense: 2.0 }],
  },
  // Nor here. The chamber is a windowless room in the middle of a building —
  // which is the point of it, and why the light in it never changes.
  chamber: { draw: chamber, size: CHAM, vents: [] },
  // One tall window, and the weather in it.
  exchequer: {
    draw: exchequerRoom, size: EXCH,
    vents: [{ x: 151, y: 7, w: 64, h: 28, dense: 2.2 }],
  },
  // The three storeys of a company. The basement's slot is the only opening in
  // it and it is above head height, so weather gets in there and nowhere else;
  // the office looks at a wall; the tower is sealed glass forty floors up.
  co_garage: { draw: companyBasement, size: CO, vents: [{ x: 139, y: 5, w: 56, h: 8, dense: 1.4 }] },
  co_office: { draw: companyOffice, size: CO, vents: [] },
  co_tower: { draw: companyTower, size: CO, vents: [] },
  // Sealed glass domes: the weather stays on the outside of them, like the
  // conservatory and the tower.
  co_hq: { draw: companyHQ, size: CO, vents: [] },
};

// --- Weather, as a real animation ------------------------------------------

/**
 * Falling particles as CSS-animated pixels.
 *
 * `animation-delay` is negative and derived from the wall clock, so an element
 * built this instant starts part-way through its fall rather than at the top. The
 * scene markup is rebuilt on every render; without this every flake would jump
 * back to the ceiling once a second.
 */
function weatherLayer(P, which, room) {
  if (!P.fall) return '';
  const now = Date.now() / 1000;
  const spec = {
    snow: { per: 260, dur: 9, cls: 'pxdrift', col: '#ffffff', size: 1 },
    rain: { per: 200, dur: 1.5, cls: 'pxfall', col: mix(P.sky[1], '#ffffff', 0.45), size: 1, tall: 2 },
    leaves: { per: 420, dur: 7, cls: 'pxdrift', col: mix(P.leaf || '#cf7d37', '#8a4a1c', 0.3), size: 1 },
  }[P.fall];
  if (!spec) return '';
  const clips = [], groups = [];
  for (const [v, vent] of room.vents.entries()) {
    const id = `pxv-${which}-${v}`;
    // The clip is the opening itself, so a flake cannot cross the frame. A window
    // with a round head is clipped row by row through the arch, or snow would
    // gather in the two corners of masonry above the glass.
    const shape = vent.arch
      ? Array.from({ length: ARCH }, (_, r) => {
        const inset = archInset(r);
        return `<rect x="${vent.x + inset}" y="${vent.y + r}" width="${Math.max(0, vent.w - inset * 2)}" height="1"/>`;
      }).join('') + `<rect x="${vent.x}" y="${vent.y + ARCH}" width="${vent.w}" height="${vent.h - ARCH}"/>`
      : `<rect x="${vent.x}" y="${vent.y}" width="${vent.w}" height="${vent.h}"/>`;
    clips.push(`<clipPath id="${id}">${shape}</clipPath>`);

    // Density is per area, but a small opening needs more of it: two flakes in a
    // window reads as a rendering fault, where the same two per square in an open
    // sky reads as weather.
    const n = Math.max(3, Math.round(vent.w * vent.h * (vent.dense || 1) / spec.per));
    // The fall is as deep as the opening, not a fixed drop: a particle that spent
    // most of its cycle clipped away would leave the window looking half-empty.
    const drop = vent.h + 6;
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = v * 977 + i;
      const dur = spec.dur * (0.7 + h2(91, s) * 0.6);
      const x = vent.x + Math.round(h2(77, s) * (vent.w - 1));
      const y = vent.y + Math.round(h2(83, s) * 3);
      out.push(`<rect class="${spec.cls}" x="${x}" y="${y}" width="${spec.size}" height="${spec.tall || spec.size}"`
        + ` fill="${spec.col}" style="--pxh:${drop}px;animation-duration:${dur.toFixed(2)}s;`
        + `animation-delay:${(-(now % dur)).toFixed(2)}s"/>`);
    }
    groups.push(`<g clip-path="url(#${id})">${out.join('')}</g>`);
  }
  return `<defs>${clips.join('')}</defs>${groups.join('')}`;
}

/**
 * The window for one room, as one frame.
 *
 * `which` is 'oval' | 'court' | 'balcony'. The scenery is a function of the season
 * step alone; the weather on top of it animates in CSS.
 */
// The rasterised background is expensive and only changes when the season steps,
// so it is kept until it does. The weather on top of it is rebuilt every render,
// because its wall-clock phase is the whole point.
let BG = { key: null, svg: '' };

/**
 * The Oval Office light switch, as a thing on the wall rather than a button.
 *
 * It used to be a text button up in the actions column, three cards away from
 * the room it lights — you pressed "Turn off the lights" and then went looking
 * for what had changed. Put it against the frame, drawn in the same pixels and
 * the same seasonal light as the room itself, and it is the switch by the door:
 * you can see the toggle position, and the thing it acts on is right beside it.
 *
 * Same grid, same palette, same rasteriser. The plate warms with the room when
 * the light is on and goes to skylight blue when it is off, so the switch reads
 * as being *in* the room it controls.
 */
export function lightSwitch(world, on) {
  const P = palette(world);
  const C = Canvas(22, 54);
  const lit = on
    ? (c) => dark(mix(c, '#ffdf8a', 0.08 + P.dim * 0.3), P.dim * 0.16)
    : (c) => mix(dark(c, 0.3 + P.dim * 0.5), P.sky[1], 0.1 + P.dim * 0.18);
  const wall = lit('#eee2c4');
  const plate = lit('#f6f0e2');
  const toggle = lit('#fdfaf2');

  C.vgrad(0, 0, 22, 54, [dark(wall, 0.16), wall, lite(wall, 0.05)], 2);
  // The plate: a bevel, not a rectangle — lit on the top and left, shadowed
  // under, so it stands off the wall.
  C.rect(3, 9, 16, 36, dark(plate, 0.34));
  C.rect(3, 9, 16, 35, plate);
  C.rect(3, 9, 16, 1, lite(plate, 0.4));
  C.rect(3, 9, 1, 35, lite(plate, 0.22));
  C.rect(18, 9, 1, 35, dark(plate, 0.26));
  C.rect(3, 43, 16, 1, dark(plate, 0.3));
  C.rect(2, 45, 18, 2, dark(wall, 0.28));            // the shadow it throws
  C.set(10, 12, dark(plate, 0.4));                   // the two screws
  C.set(10, 41, dark(plate, 0.4));

  // The rocker. Up is on: the top face catches the light and the bottom is sunk
  // into the plate. Down is off, and the shading swaps over.
  const ty = on ? 16 : 24;
  C.rect(7, ty, 8, 14, dark(toggle, 0.22));
  C.rect(7, ty, 8, 13, toggle);
  C.rect(7, ty, 8, 1, lite(toggle, 0.5));
  C.rect(7, on ? ty + 13 : ty - 1, 8, 1, dark(toggle, 0.45));
  C.rect(7, ty, 1, 13, lite(toggle, 0.28));
  C.rect(14, ty, 1, 13, dark(toggle, 0.3));
  // The slot the rocker sits in, above or below it.
  C.rect(7, on ? ty + 14 : ty - 7, 8, 6, dark(plate, 0.42));
  C.rect(7, on ? ty + 14 : ty - 7, 8, 1, dark(plate, 0.55));

  // Lit, the switch has a little of the room's own glow on it.
  if (on) C.wash(11, 22, 16, P.warm, 0.8, 0.22 + P.dim * 0.2);
  return `<svg viewBox="0 0 22 54" width="100%" style="display:block"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${C.toSVG()}</svg>`;
}

export function officeScene(world, which) {
  const room = ROOMS[which] || ROOMS.oval;
  const P = palette(world);
  const { w, h } = room.size;
  const key = `${which}|${seasonAt(world).step}|${world.ovalLights !== false}`;
  if (BG.key !== key) BG = { key, svg: room.draw(world).toSVG() };
  // The falling layer is clipped to the frame so a flake cannot land outside it.
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`
    + BG.svg
    + weatherLayer(P, which, room)
    + `</svg>`;
}

// --- The two ceremonial frames ---------------------------------------------
// The inauguration tableau and the title screen are the first and second things
// anybody ever sees of this game, and until now they were the only two pictures
// in it that were not pixel art. Both were hand-written SVG: smooth gradients
// for the sky, `<polygon>` for a pediment, `q` curves for a dome, 1.5px black
// strokes around everything. Placed beside a rasterised Oval Office they read as
// a different game's art — the seam was most obvious at the inauguration, which
// is followed immediately by the room the new President is being sworn into.
//
// So they go through the same grid as the rooms do. Same Canvas, same palette,
// same dithered shading, same one-pixel-is-one-pixel rule. What was a stroke is
// now a shaded edge — a lit row on the side the light comes from and a dark row
// on the other — because an outline drawn at 1.5px on a grid whose pixels are
// four screen pixels wide is not an outline, it is a smear.

/**
 * A crowd on a lawn, in ranks.
 *
 * Every rank's bodies run to the bottom edge of the frame and the near ranks are
 * drawn over the far ones, so what shows of the back of the crowd is heads and a
 * sliver of shoulder. Drawn the other way — each rank a discrete little figure
 * standing on open grass — three ranks came out as a picket fence in a field,
 * evenly tall, evenly spaced, with lawn visible under all of it. A crowd is a
 * mass with heads on top of it.
 *
 * Spacing is jittered off the same deterministic hash the stars and the trees
 * use, and heights vary by a few pixels: without both, the heads tile and the
 * whole thing reads as a checkerboard rather than as people.
 */
// `flagCol` is what the few of them holding something up are holding: red by
// default, the administration's colour at its own inauguration. It used to read
// `FLAG.hoist`, a key from Silver's two-colour flag that the Stars and Stripes
// does not have — so the cloth was mixed from `undefined` and the crowd waved
// green.
function crowd(C, P, x0, x1, topY, ranks, bottomY, flagCol = FLAG.red) {
  for (let r = 0; r < ranks; r++) {
    const y = topY + r * 8;
    const hw = 3 + r;                       // the head, wider as it comes nearer
    const bw = hw + 2;                      // and the shoulders under it
    // Shoulder to shoulder. Any daylight between them and the rank behind shows
    // through full height, which is what turned the first pass into a row of
    // tall thin posts with a small head on each.
    const step = bw + 1;
    // The back of the crowd is further into the haze, so it takes more of the
    // ground's colour and less of its own.
    const base = mix('#39425a', P.groundLo, 0.4 - r * 0.09);
    const SKINS = ['#d8b391', '#c49a76', '#a87b57', '#8a5f3e', '#6b452a'];
    const HAIR = ['#2a1d12', '#4a3320', '#7a5a33', '#1c1a18', '#8a7658'];
    for (let x = x0 - step; x < x1 + step; x += step) {
      const px = x + Math.round((h2(r * 31 + 7, x) - 0.5) * step * 0.7);
      const drop = Math.round(h2(r * 19 + 3, x) * 3);          // not all one height
      const hy = y + drop;
      const ink = dark(base, (h2(r * 23 + 11, x) - 0.5) * 0.24);
      // A crowd seen from a balcony is mostly hair. Drawn as bare heads it comes
      // out a field of tan blocks — which is exactly what the first pass was.
      const skin = mix(SKINS[Math.floor(h2(r * 29 + 2, x) * SKINS.length)], P.warm, 0.12 - P.dim * 0.09);
      const hair = HAIR[Math.floor(h2(r * 37 + 6, x) * HAIR.length)];
      const bald = h2(r * 41 + 9, x) < 0.14;
      C.rect(px, hy + hw, bw, bottomY - hy - hw, ink);         // the body, to the frame
      C.rect(px, hy + hw, 1, bottomY - hy - hw, lite(ink, 0.16));
      C.rect(px + bw - 1, hy + hw, 1, bottomY - hy - hw, dark(ink, 0.34));
      C.rect(px + 1, hy, hw, hw, skin);                        // the head, set in
      C.rect(px + hw, hy, 1, hw, dark(skin, 0.2));
      if (!bald) {
        const cap = Math.max(1, Math.round(hw / 2) - 1);
        C.rect(px + 1, hy, hw, cap, hair);                     // the top of the head
        C.rect(px + 1, hy, hw, 1, lite(hair, 0.16));
        C.rect(px + 1, hy + cap, 1, hw - cap, hair);           // and down one side
      } else {
        C.rect(px + 1, hy, hw, 1, lite(skin, 0.22));
      }
      // A few of them holding something up, which is what a crowd does.
      if (h2(r * 13 + 5, x) < 0.14) {
        C.rect(px + bw, hy - 5, 1, 6, dark(P.trunk, 0.1));
        C.rect(px + bw + 1, hy - 5, 4, 3, mix(flagCol, '#ffffff', 0.34));
        C.rect(px + bw + 1, hy - 5, 4, 1, mix(flagCol, '#ffffff', 0.3));
      }
    }
  }
}

/**
 * The two figures on the balcony, in profile.
 *
 * They face each other, not us, and that is the whole point of the picture: an
 * oath is administered, so there has to be somebody administering it. A single
 * figure facing out over a crowd with its hand up is a man waving from a hotel
 * balcony; a figure with its hand up facing a robed one holding a book is the
 * only moment in this republic when power is handed over on camera.
 *
 * Profile, at eleven pixels of head, is four marks: the nose a pixel proud of
 * the face, one eye set toward the front of the skull, the ear back at the
 * midpoint, and the hair filling the back of the head. Everything else — the
 * jaw, the brow — is the shape of the silhouette, not detail drawn inside it.
 *
 * `f` is +1 for a figure facing right and -1 facing left, and every horizontal
 * offset in here is multiplied by it, so one body of code draws both.
 */

/** Skin, hair and cloth for one figure, mixed against the season's light. */
function tones(P, { hair: hairBase = '#3a2a1a', coat: coatBase = '#2b3550' } = {}) {
  const skin = mix('#e0b088', P.warm, 0.16);
  const coat = mix(coatBase, '#0e1220', P.dim * 0.5);
  return {
    skin,
    skinLo: dark(skin, 0.2),
    skinHi: lite(skin, 0.16),
    skinSh: dark(skin, 0.34),
    coat,
    coatHi: lite(coat, 0.16),
    coatLo: dark(coat, 0.4),
    shirt: mix('#f4efe6', P.warm, 0.2 + P.dim * 0.2),
    hair: mix(hairBase, P.sky[0], P.dim * 0.25),
  };
}

/**
 * A head in profile, with the hair that tells you who is wearing it.
 *
 * The three genders are three heads and not one head with three haircuts — the
 * jaw is cut differently, the brow sits differently, and the neck is a pixel
 * narrower on two of them. That was true of the old front-on figure for two of
 * the three: `x` fell through to the man's branch for its face, its shoulders
 * and its collar and was distinguished by a single extra rectangle of hair,
 * which is a man with an odd fringe. It has its own everything now.
 */
function profileHead(C, T, cx, y, f, gender) {
  const hw = gender === 'f' ? 4 : 4;                 // the skull, front to back
  // Skull.
  C.rect(cx - hw, y, hw * 2 + 1, 11, T.skin);
  C.rect(cx - f * hw, y, 1, 11, T.skinLo);           // the back of the head, away from the sun
  C.rect(cx + f * hw, y, 1, 9, T.skinHi);            // and the face, catching it

  // The face itself: brow, nose, lip, chin. One pixel proud of the skull at the
  // nose and one pixel shy of it at the mouth is the entire profile.
  C.set(cx + f * (hw + 1), y + 6, T.skin);           // the nose
  C.set(cx + f * (hw + 1), y + 5, T.skinHi);         // its bridge, lit
  C.set(cx + f * hw, y + 7, T.skinSh);               // and the shadow under it
  C.rect(cx + f * (hw - 1), y + 8, 2, 1, gender === 'f' ? dark(T.skin, 0.34) : dark(T.skin, 0.26));
  // The jaw. A man's runs square to the back of the skull; a woman's and an
  // `x`'s taper a row higher and a pixel shorter, which at this size is the
  // difference the eye actually reads.
  if (gender === 'm') {
    C.rect(cx - f, y + 10, hw + 1, 1, T.skinLo);
  } else {
    C.rect(cx - f, y + 10, hw, 1, T.skinLo);
    C.set(cx + f * hw, y + 9, T.skinLo);
  }
  // One eye, set forward in the skull, and the ear back at the midpoint.
  C.rect(cx + f * 2, y + 5, gender === 'f' ? 2 : 1, 1, dark(T.skin, 0.72));
  C.rect(cx - f * 2, y + 5, 1, 2, T.skinLo);

  // Hair, over the skull and down the back of it.
  const back = cx - f * hw;
  if (gender === 'f') {
    C.rect(cx - hw - 1, y - 1, hw * 2 + 3, 5, T.hair);
    C.rect(cx - hw - 1, y - 1, hw * 2 + 3, 1, lite(T.hair, 0.24));
    // And it falls past the shoulder — three pixels wide, not two, and widening
    // as it goes. Against a dark doorway a two-pixel column of hair is not a
    // silhouette, it is the edge of the head.
    const fall = Math.min(back, back - f * 2);
    C.rect(fall, y - 1, 3, 12, T.hair);
    C.rect(fall - (f > 0 ? 1 : 0), y + 11, 4, 6, T.hair);
    C.rect(fall - (f > 0 ? 1 : 0), y + 16, 4, 1, dark(T.hair, 0.34));
    C.rect(Math.min(back, back - f), y - 1, 1, 16, lite(T.hair, 0.12));
    C.set(cx + f * (hw - 1), y + 1, lite(T.hair, 0.3));        // the parting, off centre
  } else if (gender === 'm') {
    C.rect(cx - hw, y, hw * 2 + 1, 4, T.hair);
    C.rect(cx - hw, y, hw * 2 + 1, 1, lite(T.hair, 0.22));
    C.rect(back - (f > 0 ? 1 : 0), y, 2, 7, T.hair);           // cropped to the nape
    C.rect(cx + f * (hw - 1), y + 3, 2, 1, T.hair);            // the fringe
    C.rect(cx - f * 2, y + 4, 1, 3, T.hair);                   // sideburn
  } else {
    // Neither: the top left long and swept forward over a back cut short. Not
    // halfway between the other two — its own silhouette, which is the only
    // way three of anything read as three at eleven pixels.
    C.rect(cx - hw, y - 1, hw * 2 + 1, 5, T.hair);
    C.rect(cx - hw, y - 1, hw * 2 + 1, 1, lite(T.hair, 0.26));
    C.rect(Math.min(cx + f * (hw - 2), cx + f * hw), y + 3, 3, 1, T.hair);   // swept across the brow
    C.rect(back - (f > 0 ? 1 : 0), y, 2, 4, T.hair);           // shorn at the back —
    C.rect(back - (f > 0 ? 1 : 0), y + 4, 2, 1, dark(T.hair, 0.3));
    // — and gathered at the nape. One mark, three pixels, and it is the thing
    // that makes this a third silhouette rather than the man's with a fringe.
    C.rect(Math.min(back, back - f), y + 6, 2, 4, T.hair);
    C.rect(Math.min(back, back - f * 2), y + 7, 3, 2, T.hair);
    C.rect(Math.min(back, back - f * 2), y + 9, 3, 1, dark(T.hair, 0.3));
  }
}

/**
 * The President, side-on, right hand up.
 *
 * The hand is four pixels by five. It has been eight by eight, which is two
 * thirds of a head and reads as a boxing glove, and before that a five-pixel
 * block of skin floating clear of the sleeve, which reads as a second, smaller
 * head. A hand held up beside a face is *smaller* than the face — that is what
 * makes it a hand — and at this scale that means four across.
 *
 * The figure is drawn whole, down to the shoes, and the parapet is drawn over
 * it afterwards. It used to stop at the balustrade, so what stood on the
 * balcony was a torso ending in a straight cut with daylight visible through
 * the balusters underneath it.
 */
function oathTaker(C, P, cx, y, gender, f = -1, accent = FLAG.red) {
  const T = tones(P);
  // The tie, and the pin at an open collar. `accent` is the administration's
  // party colour where it has one, which is what a president actually wears to
  // their own inauguration — red when nobody's. It read `FLAG.hoist`, a key
  // from Silver's two-colour flag, so the tie was mixed from `undefined`.
  const tie = mix(accent, '#000000', 0.2);
  profileHead(C, T, cx, y, f, gender);

  // Neck, set back from the face the way a neck is.
  C.rect(cx - 2, y + 11, 4, 2, T.skinLo);
  C.rect(cx - 2, y + 11, 4, 1, dark(T.skin, 0.4));

  // The body, in profile: chest toward the face, back behind it. Narrower than
  // a front-on figure by half, which is what turning a person does.
  const S = y + 13;
  const front = gender === 'm' ? 5 : 4;              // chest, on the facing side
  const back = gender === 'f' ? 4 : 5;               // shoulder blade, behind
  const bx = (dx) => cx + f * dx;
  const rect = (d0, d1, ry, rh, col) => {
    const a = bx(d0), b = bx(d1);
    C.rect(Math.min(a, b), ry, Math.abs(b - a) + 1, rh, col);
  };
  rect(-back + 1, front - 1, S, 2, T.coat);          // the shoulder line, sloped
  rect(-back, front, S + 2, 15, T.coat);
  rect(-back, -back, S + 2, 15, T.coatLo);           // the back, in its own shade
  rect(front, front, S + 2, 15, T.coatHi);           // the chest, toward the light
  // The lapel: one stepped diagonal down the front, which is all a profile has.
  for (let k = 0; k < 5; k++) rect(front - 1 - k, front - 1 - k, S + 2 + k, 1, T.coatHi);
  rect(front - 2, front - 1, S + 2, 4, T.shirt);     // the shirt at the throat
  if (gender === 'f') {
    rect(front - 3, front - 2, S + 2, 6, T.shirt);   // an open collar, no tie
    C.set(bx(front - 3), S + 7, mix(accent, '#ffffff', 0.2));
  } else if (gender === 'm') {
    rect(front - 2, front - 2, S + 4, 7, tie);
    rect(front - 2, front - 1, S + 4, 1, lite(tie, 0.3));
  } else {
    // A collar buttoned to the top and nothing at the throat: the third answer,
    // not one of the other two.
    rect(front - 2, front - 1, S + 2, 5, T.shirt);
    rect(front - 2, front - 1, S + 6, 1, dark(T.shirt, 0.2));
  }

  // Trousers and shoes, under the coat's hem. Never seen once the parapet is
  // up, and drawn anyway: a figure that only exists above the stonework is a
  // figure that will look wrong the first time the stonework moves.
  // Legs to the balcony floor and no further. They are behind the parapet and
  // never seen — but a figure whose shoes hang below the stonework it is
  // standing behind is a figure standing in front of it, and that shows.
  const H = S + 17;
  rect(-back + 1, -1, H, 5, dark(T.coat, 0.24));
  rect(1, front - 1, H, 5, dark(T.coat, 0.14));
  rect(-back + 1, front - 1, H + 5, 1, mix('#241c18', T.coat, 0.3));

  // The sleeve of the raised arm, and the hand at the top of it.
  //
  // On the near side — the side the figure is facing — which is where the arm
  // you can see is when a person is turned side-on, and the only place it can
  // go. Behind them it sat exactly where the hair falls, so the woman's whole
  // silhouette was swallowed by a navy sleeve and the three figures came out
  // as one figure three times. The hand ends up beside the face at brow height,
  // which is what taking an oath looks like, and it clears the book below it.
  const aL = Math.min(bx(front), bx(front + 3));
  const sleeveTop = y + 6;
  C.rect(aL, sleeveTop, 4, S + 6 - sleeveTop, T.coat);
  C.rect(aL, sleeveTop, 1, S + 6 - sleeveTop, T.coatHi);
  C.rect(aL, sleeveTop - 1, 4, 1, T.shirt);                    // one row of cuff
  C.rect(aL, y + 1, 4, 5, T.skin);                             // the palm
  C.rect(aL, y + 1, 1, 5, T.skinHi);
  C.set(aL + 1, y + 1, dark(T.skin, 0.24));                    // two fingers, and no more
  C.set(aL + 3, y + 1, dark(T.skin, 0.24));
  C.set(aL + 3, y + 4, T.skinLo);                              // the thumb's edge
}

/**
 * The Chief Justice, robed, holding the book out.
 *
 * Black robe, white tabs at the throat, and grey hair — the three marks that
 * say judge rather than second politician. The book is held level at the chest,
 * a dark cover with its page edge catching the light, and it sits between the
 * two figures, which is where the eye goes and where the oath actually is.
 */
function chiefJustice(C, P, cx, y, f = 1) {
  // Grey at the temple and a robe that is dark cloth rather than a hole in the
  // picture. At #1a1a1e against the shadow of a doorway the robe had no form at
  // all — it read as a rectangle cut out of the building.
  const T = tones(P, { hair: '#a09b90', coat: '#2b2b33' });
  profileHead(C, T, cx, y, f, 'm');

  C.rect(cx - 2, y + 11, 4, 2, T.skinLo);
  C.rect(cx - 2, y + 11, 4, 1, dark(T.skin, 0.4));

  // The robe: wider at the hem than the shoulders, which is what a robe is.
  const S = y + 13;
  const bx = (dx) => cx + f * dx;
  const rect = (d0, d1, ry, rh, col) => {
    const a = bx(d0), b = bx(d1);
    C.rect(Math.min(a, b), ry, Math.abs(b - a) + 1, rh, col);
  };
  rect(-4, 4, S, 2, T.coat);
  rect(-5, 4, S + 2, 8, T.coat);
  rect(-6, 5, S + 10, 11, T.coat);                   // and it falls open below
  rect(-6, -5, S + 10, 11, T.coatLo);
  rect(4, 5, S + 2, 19, T.coatHi);
  // The yoke, and the two white tabs under the chin.
  rect(-4, 3, S, 1, lite(T.coat, 0.22));
  rect(2, 3, S + 2, 3, T.shirt);
  C.set(bx(3), S + 2, lite(T.shirt, 0.2));
  // The sleeve and the hands, out in front, holding the book level.
  rect(1, 4, S + 6, 4, T.coat);
  rect(4, 4, S + 6, 4, T.coatHi);
  rect(5, 6, S + 7, 2, T.skin);                      // the hands
  const bkx = bx(6), bk = mix('#5a2f26', '#241008', 0.3 + P.dim * 0.3);
  C.rect(Math.min(bkx, bkx + f * 3), S + 4, 4, 4, bk);          // the book
  C.rect(Math.min(bkx, bkx + f * 3), S + 4, 4, 1, lite(bk, 0.3));
  C.rect(bx(7), S + 5, 1, 3, mix('#f4efe6', P.warm, 0.3));      // its page edge
}

const INAUG = { w: 240, h: 150 };
const IN_GY = 100;        // where the lawn begins, and the residence stands

/**
 * The oath, sworn from the balcony of the residence above a crowd on the lawn.
 *
 * The oath is sworn from the balcony rather than the ground because an
 * inauguration is the moment the office is handed over in front of the country,
 * and the country has to be able to see it happen. Standing the figure at eye
 * level among the columns made it a person outside a building; standing them
 * above the crowd, framed by the portico, makes it the office.
 *
 * It wears the season, like every room does — so the founding oath is sworn in
 * a pale winter light and a president inaugurated three years later stands in
 * whatever weather that day happens to be.
 */
function inaugural(world, gender, party) {
  const P = palette(world);
  const C = Canvas(INAUG.w, INAUG.h);
  const st = mix(P.stone, '#2a2822', P.dim * 0.42);      // the residence's stone
  const roof = lite(st, 0.16);
  const face = dark(st, 0.1);
  const sh = dark(st, 0.32);
  const glass = mix('#7f9cb8', P.sky[1], 0.3 + P.dim * 0.2);

  // -- Sky, and what is in it ----------------------------------------------
  C.vgrad(0, 0, INAUG.w, IN_GY, P.sky, 2);
  stars(C, P, 61, 0, 1, INAUG.w, 46, 40);
  // The sun, drawn here rather than by `luminary`. That function throws a bloom
  // eighteen to thirty pixels across, which is right when it is seen through a
  // window thirty pixels wide and most of it is cropped away by the masonry —
  // and reads as a dotted starburst pinned to the sky when the whole sky is on
  // show. A tight disc with one ring of dither around it is the same sun.
  const sunX = 46, sunY = 26 + Math.round(P.dim * 10);
  const sunCol = mix('#ffeaa8', '#ff9a4c', P.dim * 1.4);
  C.glow(sunX, sunY, 9, sunCol, 0.55);
  C.disc(sunX, sunY, 5, 5, sunCol);
  C.disc(sunX, sunY, 4, 4, lite(sunCol, 0.28));
  clouds(C, P, 67, 16, 5, INAUG.w);
  birds(C, P, 71, 30, INAUG.w);

  // -- The lawn ------------------------------------------------------------
  C.vgrad(0, IN_GY, INAUG.w, INAUG.h - IN_GY,
    [mix(P.ground, P.far, 0.45), P.ground, lite(P.ground, 0.07)], 3);
  C.rect(0, IN_GY, INAUG.w, 1, dark(P.groundLo, 0.2));

  // -- The residence -------------------------------------------------------
  // Two wings, then the portico standing proud of them. The wings are set back,
  // so they are drawn in a duller stone: distance, done with one value.
  const wing = mix(face, P.sky[1], 0.16);
  for (const wx of [8, 190]) {
    C.rect(wx, 62, 42, IN_GY - 62, wing);
    C.rect(wx, 62, 42, 3, lite(wing, 0.14));               // the roof line
    C.rect(wx, 62, 1, IN_GY - 62, lite(wing, 0.1));
    C.rect(wx + 41, 62, 1, IN_GY - 62, dark(wing, 0.28));
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const gx = wx + 5 + c * 9, gy = 70 + r * 14;
        C.rect(gx, gy, 5, 9, dark(glass, 0.24));
        C.rect(gx, gy, 5, 1, lite(wing, 0.24));                  // the lintel
        if (P.lampsLit) C.rect(gx + 1, gy + 1, 3, 7, mix(glass, P.warm, 0.62));
        C.rect(gx + 2, gy + 1, 1, 8, dark(glass, 0.34));         // the mullion
      }
    }
  }

  // The centre block, its cornice, and the pediment over it.
  C.rect(50, 50, 140, IN_GY - 50, face);
  C.rect(48, 47, 144, 4, roof);                             // cornice, proud of the wall
  C.rect(48, 47, 144, 1, lite(roof, 0.24));
  C.rect(48, 50, 144, 1, sh);
  C.tri(46, 47, 120, 25, 194, 47, roof);
  C.tri(50, 46, 120, 28, 190, 46, lite(roof, 0.1));         // the tympanum, catching sky
  C.tri(56, 45, 120, 32, 184, 45, dark(roof, 0.14));        // and its recess

  // Columns, flanking the balcony rather than crowding in front of it. Each is
  // three pixels of shading, not an outline: lit, body, shadow.
  //
  // Squared about the centre line. They were at 58, 76, 164 and 182, so the gap
  // between the inner pair ran 86 to 164 and its middle was 125 — five pixels
  // right of the pediment's apex, the flag, the wings and everything else in
  // the picture. One figure centred in the doorway hid that; two, facing each
  // other across it, would not have.
  for (const x of [58, 76, 154, 172]) {
    C.rect(x, 51, 10, IN_GY - 51, mix(st, roof, 0.4));
    C.rect(x, 51, 2, IN_GY - 51, lite(st, 0.22));
    C.rect(x + 8, 51, 2, IN_GY - 51, sh);
    C.rect(x - 1, 51, 12, 3, roof);                         // capital
    C.rect(x - 1, 51, 12, 1, lite(roof, 0.26));
    C.rect(x - 1, IN_GY - 4, 12, 4, mix(st, roof, 0.5));    // base
    C.rect(x - 1, IN_GY - 4, 12, 1, lite(roof, 0.2));
  }

  // The doorway the two of them have walked out of. Widened to take both —
  // a dark opening is what makes the balcony read as a balcony, and it is also
  // what the figures are read against, so it has to be wide enough to hold
  // them and their arms.
  C.rect(94, 51, 52, 41, dark(face, 0.58));                 // the opening
  C.rect(94, 51, 52, 2, dark(face, 0.76));                  // its head
  C.rect(94, 51, 2, 41, dark(face, 0.7));
  C.rect(144, 51, 2, 41, dark(face, 0.7));
  C.rect(119, 53, 2, 39, dark(face, 0.44));                 // the two leaves
  for (const x of [86, 148] ) {
    C.rect(x, 58, 6, 16, dark(glass, 0.2));
    C.rect(x, 58, 6, 1, lite(glass, 0.22));
    C.rect(x + 2, 58, 1, 16, dark(glass, 0.4));
  }

  // -- The oath ------------------------------------------------------------
  //
  // Two figures, in profile, facing each other. A President alone with a hand
  // in the air is a man waving off a hotel balcony; a President with a hand in
  // the air facing a robed judge holding a book is an oath, and an oath is the
  // one thing this picture is of.
  //
  // They stand on the balcony floor and the parapet is built in front of them
  // afterwards. What stood here before was a torso: the coat ended in a flat
  // cut exactly where the balustrade began, the balustrade was open balusters
  // with five pixels of gap between them, and through those gaps you saw the
  // dark of the doorway where a pair of legs should have been. Hence a man
  // apparently growing out of the stonework.
  // Four pixels of air under the lintel: a head that touches the top of its own
  // doorway reads as a figure wedged into the opening rather than standing in
  // it, and the raised hand needs somewhere to be that is not the masonry.
  C.rect(80, 92, 80, 3, mix(st, roof, 0.3));                // the floor slab
  chiefJustice(C, P, 108, 56, 1);
  oathTaker(C, P, 132, 56, gender, -1, party || FLAG.red);

  // The parapet: solid stone, waist high, with its panels sunk into the face
  // rather than cut through it. A balustrade with daylight between the
  // balusters is a lovely thing to draw and the wrong thing to put in front of
  // a figure — whatever is behind it has to be drawn to the floor or the gaps
  // give it away. Sunk panels keep the profile and take the holes out.
  const rail = mix(st, roof, 0.55);
  C.rect(76, 78, 88, 2, lite(rail, 0.22));                  // the coping, proud
  C.rect(76, 80, 88, 1, dark(rail, 0.18));
  C.rect(78, 81, 84, 11, rail);                             // the face of it
  C.rect(78, 81, 1, 11, lite(rail, 0.2));
  C.rect(161, 81, 1, 11, dark(rail, 0.3));
  for (let x = 82; x < 158; x += 12) {
    C.rect(x, 83, 8, 6, dark(rail, 0.16));                  // a sunk panel
    C.rect(x, 83, 8, 1, dark(rail, 0.3));                   // its top reveal
    C.rect(x, 88, 8, 1, lite(rail, 0.16));                  // and its sill
  }
  C.rect(78, 91, 84, 1, dark(rail, 0.34));                  // the base moulding

  // -- The flags, and the light on the building ----------------------------
  // The national flag over the pediment, the new administration's colours over
  // the wings either side of it. `party` is null when nobody in the chair keeps
  // a party — an independent president is sworn in under the one flag, which is
  // the picture that fact deserves.
  nationalFlag(C, P, 120, 6, 20);
  if (party) {
    partyFlag(C, P, 28, 62 - 15, 15, party);
    partyFlag(C, P, 211, 62 - 15, 15, party);
  }
  if (P.lampsLit) {
    for (const lx of [66, 174]) {
      C.rect(lx, IN_GY - 12, 1, 12, dark(st, 0.5));
      C.rect(lx - 1, IN_GY - 14, 3, 2, P.warm);
      C.glow(lx, IN_GY - 13, 3, P.warm, 0.8);
    }
    // No wash across the facade. `wash` dithers a tint into whatever it lands
    // on, which reads as light on a floor or a rug and as a speckled rectangle
    // on a flat wall — the lit stone here is done with the value of the stone
    // itself instead.
  }

  // -- The crowd -----------------------------------------------------------
  crowd(C, P, 0, INAUG.w, IN_GY + 14, 5, INAUG.h, party || FLAG.red);
  return C;
}

// Rasterising is not free and this frame is shown under a modal that rebuilds on
// every render, so it is kept until the thing it depends on changes.
let INAUG_BG = { key: null, svg: '' };

/**
 * The inauguration tableau, plus the confetti over it.
 *
 * The confetti is CSS-animated pixels laid over the raster, exactly as the snow
 * and rain are in the rooms: the scene is rebuilt on every render, so each piece
 * takes a negative `animation-delay` off the wall clock and carries on falling
 * from wherever it had got to.
 */
export function inaugurationScene(world, gender = 'x', party = null) {
  // The party is part of the picture now, so it is part of what the cache is
  // keyed on — otherwise a second administration of the other side is sworn in
  // under the first one's flags for as long as the season does not turn.
  const key = `${gender}|${seasonAt(world).step}|${party || '-'}`;
  if (INAUG_BG.key !== key) INAUG_BG = { key, svg: inaugural(world, gender, party).toSVG() };
  // The confetti takes the administration's colour where it had a second flag
  // colour, so the air over the lawn agrees with the cloth on the building.
  const cols = party
    ? [party, FLAG.white, party, '#e8582d', '#ffffff']
    : [FLAG.red, FLAG.blue, '#e8582d', '#2f9e44', '#ffffff'];
  const now = Date.now() / 1000;
  let conf = '';
  for (let i = 0; i < 22; i++) {
    const x = Math.round(h2(3, i) * (INAUG.w - 2));
    const dur = 5 + h2(9, i) * 4;
    const sz = 1 + (i % 3 === 0 ? 1 : 0);
    conf += `<rect class="pxconf" x="${x}" y="-4" width="${sz}" height="${sz}"`
      + ` fill="${cols[i % cols.length]}" style="--pxh:${INAUG.h + 8}px;`
      + `animation-duration:${dur.toFixed(2)}s;animation-delay:${(-(now % dur)).toFixed(2)}s"/>`;
  }
  return `<svg viewBox="0 0 ${INAUG.w} ${INAUG.h}" width="100%"`
    + ` style="display:block" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`
    + INAUG_BG.svg + conf + `</svg>`;
}

// --- The title screen ------------------------------------------------------

const TITLE = { w: 320, h: 180 };

/**
 * A fixed evening. The rooms take their light from the calendar, but the title
 * screen has no world behind it yet — and it should be the same picture every
 * time anyway, the way a title card is. So this is its own palette rather than
 * `palette(world)`: dusk, lamps lit, the last of the sun still on the water.
 */
const DUSK = {
  season: 'Dusk', blend: 0.35, dim: 0.62, fall: null, lampsLit: true,
  // Six stops, not four. At 240 pixels across a room's window a four-band sky is
  // right; across a whole screen the bands are sixty device pixels deep and the
  // dithered seams read as three ruled lines drawn over the picture. More stops,
  // narrower bands, same vocabulary.
  sky: ['#101c3c', '#1b2d55', '#33456f', '#5c4d70', '#96586a', '#d4834f'],
  ground: '#2b3a52', groundLo: '#1d2839', far: '#243050', hill: '#20293f',
  trunk: '#2a2438', stone: '#efe6d0', leaf: null, warm: '#f4c95d',
};

/**
 * A tower on the far bank.
 *
 * `block()` is the scenery function the rooms use for the city on the horizon,
 * and it is built for daylight: it mixes the stone with the haze and comes out a
 * mid grey. Sixteen of those either side of the capitol turned the skyline into
 * a row of grey slabs with the one building that matters sitting among them at
 * the same value. At dusk a tower is a silhouette with its windows on — so this
 * one is drawn dark and lets the lit windows do all the work.
 */
function tower(C, P, x, y, w, h, cols, rows) {
  const face = mix(P.far, '#0d1425', 0.4);
  C.rect(x, y, w, h, face);
  C.rect(x, y, 1, h, lite(face, 0.16));            // the corner turned to the sky
  C.rect(x + w - 1, y, 1, h, dark(face, 0.4));
  C.rect(x, y, w, 1, lite(face, 0.28));            // the roof edge
  const gx = Math.max(3, Math.floor((w - 3) / cols));
  const gy = Math.max(3, Math.floor((h - 4) / Math.max(1, rows)));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = h2(x * 7 + y, r * 9 + c) < 0.55;
      C.rect(x + 2 + c * gx, y + 3 + r * gy, 2, 2, on ? P.warm : dark(face, 0.3));
      if (on) C.set(x + 2 + c * gx, y + 3 + r * gy, lite(P.warm, 0.35));
    }
  }
}

/**
 * The Washington Monument: a shaft that tapers, and a pyramidion.
 *
 * The taper is the whole silhouette. Drawn as a plain rectangle it is a chimney;
 * losing two pixels of width over its height is what makes the eye read stone.
 * The cap is a four-row pyramid rather than a point, because at this scale a
 * true point is one lit pixel and disappears against the sky.
 *
 * The aircraft warning lights near the top are the one detail that dates it to
 * now rather than to 1884, and they are the only warm colour on it.
 */
function monument(C, P, cx, baseY, h) {
  const face = mix(P.far, '#e8e2d4', 0.5);
  const lit = lite(face, 0.2), shade = dark(face, 0.32);
  const capH = 4;
  const shaftH = h - capH;
  for (let i = 0; i < shaftH; i++) {
    // Six wide at the foot, four at the shoulder.
    const w = i < shaftH * 0.55 ? 6 : 5;
    // Row 0 is the foot itself: the shaft stands on baseY, not capH above it.
    const y = baseY - i;
    const x = cx - Math.floor(w / 2);
    C.rect(x, y, w, 1, face);
    C.rect(x, y, 1, 1, lit);
    C.rect(x + w - 1, y, 1, 1, shade);
  }
  for (let i = 0; i < capH; i++) {
    const w = 5 - i;
    if (w <= 0) break;
    const x = cx - Math.floor(w / 2);
    // +1 so the pyramidion sits on the shaft's top row rather than over it.
    C.rect(x, baseY - h + 1 + i, w, 1, i < 2 ? lit : face);
  }
  C.set(cx - 1, baseY - h + capH + 1, P.warm);
  C.set(cx + 1, baseY - h + capH + 1, P.warm);
}

/**
 * The Lincoln Memorial: a long low colonnade on a stepped plinth.
 *
 * Its whole character is horizontal, which is why it sits opposite the monument
 * rather than beside it — a vertical, a horizontal, and the dome between them is
 * the Mall's actual composition and it reads at any size.
 */
function memorial(C, P, x, baseY, w, h) {
  const face = mix(P.far, '#ded7c6', 0.46);
  const lit = lite(face, 0.18), shade = dark(face, 0.34);
  // Three steps.
  for (let s = 0; s < 3; s++) C.rect(x - s, baseY - s, w + s * 2, 1, s ? shade : dark(face, 0.5));
  const bodyY = baseY - 2 - h;
  C.rect(x, bodyY, w, h, face);
  C.rect(x, bodyY, w, 1, lit);                        // the attic, catching the last light
  // Columns, with the gaps between them dark. An even count reads as a building;
  // an odd one puts a column dead centre where the doorway belongs.
  for (let i = 0; i < 6; i++) {
    const cx = x + 2 + i * Math.max(2, Math.floor((w - 4) / 6));
    C.rect(cx, bodyY + 2, 1, h - 3, lit);
    C.rect(cx + 1, bodyY + 2, 1, h - 3, shade);
  }
  C.rect(x, bodyY + h - 1, w, 1, shade);
}

/**
 * The capital at dusk, with the capitol at the centre of it.
 *
 * Built once and cached. Nothing in it moves — the stars used to twinkle and two
 * clouds used to track across, but those were separate SVG nodes in the
 * hand-drawn version and the raster is one merged field of rectangles. A title
 * card can hold still.
 */
/**
 * A flagstaff on a roof, flying the national flag.
 *
 * The Capitol flies one over each wing, and only over the wing whose chamber is
 * actually sitting — which is a detail worth having in a game whose whole
 * legislature is two chambers that have to agree. Here they both fly: it is a
 * title card, and the point of it is that Congress is in session.
 *
 * `nationalFlag` draws the cloth; this puts a pole under it and sets it on a
 * roofline. Reused rather than redrawn, because the whole reason that function
 * exists is that three hand-tuned copies of a flag is how you get three flags.
 */
function flagstaff(C, P, x, roofY, poleH = 8) {
  // The staff is drawn in near-full stone, not a shaded version of it. A one
  // pixel column at half value disappears into a sunset band, and a flag on an
  // invisible pole does not read as flying — it reads as a sticker floating in
  // the sky above the building. It is the pole that anchors the flag, so the
  // pole has to be the brightest thing on the roof.
  C.rect(x, roofY - poleH, 1, poleH + 1, lite(P.stone, 0.1));
  C.set(x, roofY - poleH - 1, lite(P.stone, 0.3));   // the truck
  nationalFlag(C, P, x, roofY - poleH, 7);
}

let TITLE_SVG = '';
export function titleScene() {
  if (TITLE_SVG) return TITLE_SVG;
  const P = DUSK;
  const C = Canvas(TITLE.w, TITLE.h);
  const BANK = 126;      // the far bank the city stands on
  const WATER = 142;     // and where the water starts

  C.vgrad(0, 0, TITLE.w, BANK, P.sky, 2);
  stars(C, P, 5, 0, 1, TITLE.w, 52, 70);
  luminary(C, P, 200, 300, 16, 60);
  clouds(C, P, 13, 34, 5, TITLE.w);

  // The far bank, and the Mall standing on it.
  //
  // This was a generic skyline — eight lit office towers walking the eye inward
  // to the dome. It read as a capital, but it read as *a* capital: the same
  // picture would have served any republic with a river through it. Washington
  // has almost no tall building in it by law, and what it has instead is a
  // composition anyone can name: a vertical, a horizontal, and the dome between
  // them.
  //
  // So the towers are gone and the Mall is here. The monument west of the dome,
  // the Lincoln Memorial beyond it, the Jefferson across the water on the right,
  // and a low federal terrace filling the ends of the bank where the eye would
  // otherwise fall off the picture. The sunset, the water and the palette are
  // untouched — the light was never the thing that made it generic.
  //
  // **The Capitol sits dead centre**, and everything else is placed around it.
  // It used to stand at x=190 of 320, which is off to the right, and that is a
  // composition about the Mall rather than about the building. It also meant the
  // crop decided the subject: the scene is drawn with `xMidYMax slice`, so a tall
  // window shows only the middle of it, and on a narrow one the dome was sliding
  // toward the edge while the Lincoln Memorial fell off the other side. Centred,
  // the one building the game is named for is the last thing any crop loses.
  const MID = TITLE.w / 2;    // 160 — the Capitol's own centreline
  C.rect(0, BANK, TITLE.w, WATER - BANK, P.hill);
  C.rect(0, BANK, TITLE.w, 1, lite(P.hill, 0.14));

  // Low federal blocks anchoring both ends: government offices, not skyscrapers.
  for (const [x, y, w, h, c, r] of [
    [-4, 112, 22, 16, 3, 2], [20, 116, 18, 12, 2, 2],
    [284, 116, 18, 12, 2, 2], [304, 110, 22, 18, 3, 2],
  ]) tower(C, P, x, y, w, h, c, r);

  // West of the Capitol, in the order they stand on the ground: Lincoln, then
  // the Monument, then the dome.
  memorial(C, P, 44, BANK + 1, 32, 12);
  monument(C, P, 100, BANK + 1, 56);
  capitol(C, P, MID, BANK + 2);
  // The Jefferson: a small rotunda off to the east, half the dome's size, so the
  // eye reads depth across the bank rather than one flat row of buildings.
  dome(C, P, 248, BANK + 1, 15);

  // The colours of the thing.
  //
  // A dusk palette of purple, orange and stone is a handsome picture of no
  // particular country. The flag is the one element that says which republic
  // this is, and the Capitol flies one over each wing — over the House and over
  // the Senate, which is exactly the fact the game is built on. Two staffs, on
  // the wing roofs, at the height the real ones sit.
  // Short staffs, set on the wing roofs and inboard of their ends, so the cloth
  // overlaps the building rather than hanging clear of it in open sky.
  const wingRoof = BANK + 2 - 10;
  flagstaff(C, P, MID - 44, wingRoof, 8);
  flagstaff(C, P, MID + 33, wingRoof, 8);
  // No wash over the dome. `wash` tints what it lands on through a Bayer
  // pattern, which works over a floor or a wall — a surface with texture in it
  // already — and fails over a flat band of sky: forty pixels of loose dither
  // in mid-air reads as fog, or as a rendering fault, and never as light. The
  // capitol is the palest thing in the frame and the towers either side of it
  // are silhouettes; that contrast is what makes it the subject, not a halo.

  // The water: banded, with the sky's own last colour caught in the top of it.
  const deep = mix(P.sky[1], '#08131f', 0.55);
  C.vgrad(0, WATER, TITLE.w, TITLE.h - WATER,
    [mix(P.sky[3], deep, 0.55), deep, dark(deep, 0.28)], 2);
  C.rect(0, WATER, TITLE.w, 1, lite(deep, 0.34));
  // The afterglow, caught in the first rows. Kept thin and kept faint: a wide
  // 50% dither is a dotted rule drawn across the picture, not a reflection.
  C.dith(0, WATER + 1, TITLE.w, 2, mix(P.sky[3], deep, 0.55), mix(P.sky[5], deep, 0.7), 0.3);

  // The reflection, directly under whatever is in the sky, broken into rows that
  // shorten as they come toward us. A reflection in pixel art is a few lit rows
  // with gaps in them, never a gradient.
  const lx = 200 + (300 - 200) * (0.24 + P.blend * 0.1);
  // Silver, not gold: at this dim `luminary` draws the moon, and a warm
  // reflection under a cold light is the kind of mistake that reads instantly
  // even to somebody who could not say what was wrong with it.
  const glint = mix('#dfe8f4', deep, 0.34);
  for (let i = 0; i < 10; i++) {
    const y = WATER + 1 + i * 3;
    const w = Math.max(2, 12 - i + Math.round(h2(29, i) * 6));
    C.rect(Math.round(lx - w / 2 + (h2(31, i) - 0.5) * 6), y, w, 1, i % 3 ? glint : lite(glint, 0.2));
  }
  // And the city's own light on it, in shorter, colder rows.
  for (let i = 0; i < 22; i++) {
    C.rect(Math.round(h2(37, i) * (TITLE.w - 14)), WATER + 2 + Math.round(h2(41, i) * 34),
      4 + Math.round(h2(43, i) * 8), 1, lite(deep, 0.12));
  }

  // Lamps along the quay. The pool of light each one throws is small and close —
  // a wash with a big radius at this scale covers a fifth of the water in loose
  // dither and reads as static, not as light.
  for (let x = 12; x < TITLE.w; x += 36) {
    C.rect(x, BANK - 8, 1, 8, dark(P.stone, 0.68));
    C.rect(x - 1, BANK - 10, 3, 2, P.warm);
    C.glow(x, BANK - 9, 3, P.warm, 0.8);
    C.wash(x, BANK, 5, P.warm, 0.55, 0.32);
  }

  TITLE_SVG = `<svg viewBox="0 0 ${TITLE.w} ${TITLE.h}" width="100%" height="100%"`
    + ` preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg"`
    + ` shape-rendering="crispEdges">${C.toSVG()}</svg>`;
  return TITLE_SVG;
}

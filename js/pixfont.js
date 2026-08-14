// A bitmap typeface, for the places the UI says its own name.
//
// The rooms, the inauguration and the title screen are all rasterised now, and
// the moment they were, the type on top of them stopped matching: a wordmark set
// in a smooth geometric sans, sitting over a sky made of visible squares, with
// a 2.5px outline that lands between pixels at every window size. Real pixel art
// draws its letters on the same grid as everything else, so this is that grid.
//
// Deliberately small in scope. This is display type — a wordmark, a kicker, a
// plate on a card — and it is uppercase, because a 5x7 cell cannot carry
// descenders and a 7x9 one that could would be a different, much larger job.
// Nothing anybody has to *read* goes through here; prose stays in EB Garamond
// and the working state stays in Space Grotesk, both of which are legible at
// sizes this font would turn to mush.
//
// Glyphs are 5 wide and 7 tall with a one-column gutter, the classic arcade
// cell. '1' is ink, '0' is paper.

import { Canvas } from './pixel.js';

const W = 5, H = 7;

// Written out rather than packed into hex: this is the one file in the codebase
// where the source *is* the picture, and a wall of 0x7C is not.
const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001',
  B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110',
  D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111',
  F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111',
  H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111',
  J: '00111,00010,00010,00010,10010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001',
  L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001',
  N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101',
  R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01110,10001,10000,01110,00001,10001,01110',
  T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110',
  V: '10001,10001,10001,10001,01010,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001',
  X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100',
  Z: '11111,00001,00010,00100,01000,10000,11111',
  0: '01110,10011,10011,10101,11001,11001,01110',
  1: '00100,01100,00100,00100,00100,00100,01110',
  2: '01110,10001,00001,00110,01000,10000,11111',
  3: '11110,00001,00001,01110,00001,00001,11110',
  4: '00010,00110,01010,10010,11111,00010,00010',
  5: '11111,10000,11110,00001,00001,10001,01110',
  6: '00110,01000,10000,11110,10001,10001,01110',
  7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,10001,01110,10001,10001,01110',
  9: '01110,10001,10001,01111,00001,00010,01100',
  ' ': '00000,00000,00000,00000,00000,00000,00000',
  '.': '00000,00000,00000,00000,00000,01100,01100',
  ',': '00000,00000,00000,00000,01100,01100,01000',
  "'": '00100,00100,00000,00000,00000,00000,00000',
  '-': '00000,00000,00000,01110,00000,00000,00000',
  ':': '00000,01100,01100,00000,01100,01100,00000',
  '!': '00100,00100,00100,00100,00100,00000,00100',
  '?': '01110,10001,00001,00110,00100,00000,00100',
  '/': '00001,00010,00010,00100,01000,01000,10000',
  '&': '01100,10010,10010,01100,10101,10010,01101',
  '·': '00000,00000,00000,00100,00000,00000,00000',
};

const rows = (ch) => (GLYPHS[ch] || GLYPHS['?']).split(',');

/** How wide a string comes out, in font pixels, at a given letter gutter. */
export function pixTextWidth(text, gap = 1) {
  const n = [...String(text)].length;
  return n ? n * W + (n - 1) * gap : 0;
}

/**
 * A string, stamped into a canvas.
 *
 * `shadow` is offset down-and-right by one pixel and drawn first, which is what
 * gives a bitmap letter its weight; `edge` is a one-pixel skirt all the way
 * round, which is what keeps it legible over a busy sky. Both are optional and
 * both cost a pixel of bounds, so `pixText` allows for them.
 */
export function stampText(C, x, y, text, { ink = '#ffffff', shadow = null, edge = null, gap = 1 } = {}) {
  const chars = [...String(text)];
  const plot = (dx, dy, c) => {
    chars.forEach((ch, i) => {
      const g = rows(ch);
      for (let r = 0; r < H; r++) {
        for (let k = 0; k < W; k++) {
          if (g[r][k] === '1') C.set(x + i * (W + gap) + k + dx, y + r + dy, c);
        }
      }
    });
  };
  // The skirt goes down first and in every direction, so the ink lands on top of
  // its own outline rather than under it.
  if (edge) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) plot(dx, dy, edge);
  if (shadow) plot(1, 1, shadow);
  plot(0, 0, ink);
  return C;
}

/**
 * A string as a standalone SVG, sized to its own bounds.
 *
 * The result carries no width, so it fills whatever box it is put in and scales
 * on the pixel grid — one font pixel is however many screen pixels the box makes
 * it, and `image-rendering: pixelated` in the stylesheet keeps that honest.
 */
export function pixText(text, opts = {}) {
  const { gap = 1, shadow = null, edge = null } = opts;
  const pad = edge ? 1 : 0;
  const w = pixTextWidth(text, gap) + pad * 2 + (shadow ? 1 : 0);
  const h = H + pad * 2 + (shadow ? 1 : 0);
  const C = Canvas(w, h);
  stampText(C, pad, pad, text, opts);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"`
    + ` role="img" aria-label="${String(text).replace(/[<>&"]/g, '')}">${C.toSVG()}</svg>`;
}

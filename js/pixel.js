// A pixel buffer, and the drawing you can do on one.
//
// The office scenes used to be built from SVG shapes — a path for a drape, an
// ellipse for the rug, big flat rects for the walls — and then scaled up. That
// cannot be pixel art however hard it is squinted at: the shapes stay smooth, the
// "pixels" come out in whatever sizes the geometry happened to need, and only the
// parts drawn small (the sky, seen through a window) ever read as pixels at all.
//
// So the scenes are rasterised now. Everything is plotted into a grid of a couple
// of hundred pixels across, interior and exterior alike, and the grid is what gets
// emitted. A curve becomes a stair. Shading is ordered dithering, which is how you
// get a gradient out of two colours. Every pixel in the frame is the same size,
// because every pixel in the frame is a pixel.
//
// The emitted SVG is greedily merged into rectangles rather than one node per
// pixel — a 240x72 frame is 17,280 pixels and most of them have a neighbour the
// same colour, so the merge typically gets it down to a few hundred nodes.

// The classic 4x4 ordered-dither threshold matrix. Normalised to 0..1, this is
// the whole reason two flat colours can imply sixteen.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16));

/** Two hex colours, mixed. Kept here so wash() can tint what it lands on. */
function blend(a, b, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const h = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(ar + (br - ar) * t)}${h(ag + (bg - ag) * t)}${h(ab + (bb - ab) * t)}`;
}

export function Canvas(w, h) {
  const px = new Array(w * h).fill(null);

  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const set = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (c && inside(x, y)) px[y * w + x] = c;
  };

  const C = {
    w, h, px, set,

    get(x, y) { return inside(x, y) ? px[y * w + x] : null; },

    /** A solid block. */
    rect(x, y, rw, rh, c) {
      const x0 = Math.round(x), y0 = Math.round(y);
      const x1 = Math.round(x + rw), y1 = Math.round(y + rh);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) set(xx, yy, c);
      return C;
    },

    /**
     * A block dithered between two colours. `t` is how much of `b` there is: 0 is
     * all `a`, 1 is all `b`, and the values between are the ordered pattern.
     */
    dith(x, y, rw, rh, a, b, t) {
      if (t <= 0) return C.rect(x, y, rw, rh, a);
      if (t >= 1) return C.rect(x, y, rw, rh, b);
      const x0 = Math.round(x), y0 = Math.round(y);
      const x1 = Math.round(x + rw), y1 = Math.round(y + rh);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          set(xx, yy, BAYER[((yy % 4) + 4) % 4][((xx % 4) + 4) % 4] < t ? b : a);
        }
      }
      return C;
    },

    /**
     * A vertical ramp through a list of colours: solid bands with a narrow
     * dithered seam between each pair. This is what a pixel-art sky actually is —
     * flat bands, and three rows of checkerboard where two of them meet.
     *
     * Dithering every row instead is both wrong to look at and ruinous to emit:
     * a dithered row alternates colour every pixel, so nothing merges, and a
     * full-height dithered wall turned one scene into four thousand rectangles.
     * Banding it puts that back to a few dozen and looks more like the reference.
     */
    vgrad(x, y, rw, rh, colors, seam = 3) {
      const n = colors.length - 1;
      if (n < 1) return C.rect(x, y, rw, rh, colors[0]);
      const y0 = Math.round(y), y1 = Math.round(y + rh);
      const band = (y1 - y0) / (n + 1);
      for (let s = 0; s <= n; s++) {
        const top = Math.round(y0 + band * s);
        const bot = s === n ? y1 : Math.round(y0 + band * (s + 1));
        C.rect(x, top, rw, bot - top, colors[s]);
      }
      // The seams, laid over the joins.
      for (let s = 0; s < n; s++) {
        const at = Math.round(y0 + band * (s + 1));
        for (let k = 0; k < seam; k++) {
          const t = (k + 1) / (seam + 1);
          C.dith(x, at - Math.ceil(seam / 2) + k, rw, 1, colors[s], colors[s + 1], t);
        }
      }
      return C;
    },

    /** A filled ellipse, rasterised — so its edge is a stair, as it should be. */
    disc(cx, cy, rx, ry, c) {
      for (let yy = Math.round(cy - ry); yy <= Math.round(cy + ry); yy++) {
        const dy = (yy - cy) / ry;
        const s = 1 - dy * dy;
        if (s < 0) continue;
        const half = rx * Math.sqrt(s);
        for (let xx = Math.round(cx - half); xx <= Math.round(cx + half); xx++) set(xx, yy, c);
      }
      return C;
    },

    /** The outline of one. */
    ring(cx, cy, rx, ry, c) {
      for (let a = 0; a < 360; a += 1) {
        const r = (a * Math.PI) / 180;
        set(Math.round(cx + Math.cos(r) * rx), Math.round(cy + Math.sin(r) * ry), c);
      }
      return C;
    },

    /** Bresenham, so a diagonal is a proper pixel staircase. */
    line(x0, y0, x1, y1, c) {
      let x = Math.round(x0), y = Math.round(y0);
      const ex = Math.round(x1), ey = Math.round(y1);
      const dx = Math.abs(ex - x), dy = Math.abs(ey - y);
      const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
      let err = dx - dy;
      for (let guard = 0; guard < 4096; guard++) {
        set(x, y, c);
        if (x === ex && y === ey) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      return C;
    },

    /** A filled triangle — pediments, roofs, the cap of a dome. */
    tri(ax, ay, bx, by, cx2, cy2, c) {
      const minY = Math.round(Math.min(ay, by, cy2)), maxY = Math.round(Math.max(ay, by, cy2));
      const edge = (x0, y0, x1, y1, yy) => (y1 === y0 ? null : x0 + ((x1 - x0) * (yy - y0)) / (y1 - y0));
      for (let yy = minY; yy <= maxY; yy++) {
        const xs = [];
        for (const [x0, y0, x1, y1] of [[ax, ay, bx, by], [bx, by, cx2, cy2], [cx2, cy2, ax, ay]]) {
          if ((yy >= Math.min(y0, y1)) && (yy <= Math.max(y0, y1))) {
            const v = edge(x0, y0, x1, y1, yy);
            if (v != null) xs.push(v);
          }
        }
        if (xs.length < 2) continue;
        for (let xx = Math.round(Math.min(...xs)); xx <= Math.round(Math.max(...xs)); xx++) set(xx, yy, c);
      }
      return C;
    },

    /**
     * A light bloom, as dithered rings rather than a soft gradient. Falls off with
     * the square of the distance and thins out to nothing, and only ever brightens
     * what is already there.
     */
    glow(cx, cy, r, c, strength = 0.7) {
      for (let yy = Math.round(cy - r); yy <= Math.round(cy + r); yy++) {
        for (let xx = Math.round(cx - r); xx <= Math.round(cx + r); xx++) {
          if (!inside(xx, yy)) continue;
          const d = Math.hypot(xx - cx, (yy - cy) * 1.35) / r;
          if (d > 1) continue;
          const t = (1 - d) * (1 - d) * strength;
          if (BAYER[((yy % 4) + 4) % 4][((xx % 4) + 4) % 4] < t) px[yy * w + xx] = c;
        }
      }
      return C;
    },

    /**
     * Light falling *on* a surface, rather than a lamp seen directly.
     *
     * Same falloff as glow, but the dithered pixels are the surface tinted toward
     * the light by `amount` instead of replaced by it outright. That difference is
     * the whole point: a pale colour stamped flat onto a dark floor does not read
     * as a pool of light, it reads as snow indoors — which is exactly what the
     * unlit Oval Office looked like when its windows used glow for their wash.
     */
    wash(cx, cy, r, c, strength = 0.5, amount = 0.25) {
      for (let yy = Math.round(cy - r); yy <= Math.round(cy + r); yy++) {
        for (let xx = Math.round(cx - r); xx <= Math.round(cx + r); xx++) {
          if (!inside(xx, yy)) continue;
          const d = Math.hypot(xx - cx, (yy - cy) * 1.35) / r;
          if (d > 1) continue;
          const t = (1 - d) * (1 - d) * strength;
          if (BAYER[((yy % 4) + 4) % 4][((xx % 4) + 4) % 4] >= t) continue;
          const base = px[yy * w + xx];
          if (base) px[yy * w + xx] = blend(base, c, amount);
        }
      }
      return C;
    },

    /**
     * Stamp another canvas into this one. This is how a window works: the view is
     * drawn on its own small surface and then placed, so the sun cannot end up on
     * the wall beside the frame — which is exactly what happened when the sky was
     * drawn straight onto the room with the window's bounds passed as a hint.
     */
    blit(src, x, y) {
      for (let yy = 0; yy < src.h; yy++) {
        for (let xx = 0; xx < src.w; xx++) {
          const c = src.px[yy * src.w + xx];
          if (c) set(x + xx, y + yy, c);
        }
      }
      return C;
    },

    /**
     * A sprite from a string map: one character per pixel, a key from character to
     * colour, '.' for transparent. Detailed things — a chair, a lamp, a flag — are
     * easier to read as a picture than as thirty rect calls.
     */
    sprite(x, y, rows, key) {
      rows.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++) {
          const c = key[row[dx]];
          if (c) set(x + dx, y + dy, c);
        }
      });
      return C;
    },

    /**
     * The buffer as SVG. Greedy rectangle merge: take the first unemitted pixel,
     * run right while the colour holds, then run down while the whole span still
     * matches. Large flat areas collapse to one node and dithered areas stay
     * honest.
     */
    toSVG() {
      const done = new Uint8Array(w * h);
      const out = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (done[i]) continue;
          const c = px[i];
          if (!c) { done[i] = 1; continue; }
          let rw = 1;
          while (x + rw < w && !done[i + rw] && px[i + rw] === c) rw++;
          let rh = 1;
          grow: while (y + rh < h) {
            const base = (y + rh) * w + x;
            for (let k = 0; k < rw; k++) if (done[base + k] || px[base + k] !== c) break grow;
            rh++;
          }
          for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) done[(y + yy) * w + x + xx] = 1;
          out.push(`<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${c}"/>`);
        }
      }
      return out.join('');
    },
  };
  return C;
}

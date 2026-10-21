/* Hemocytometer cell detection (Hough circles; validated only on synthetic chambers, see PROJECT_STATE.md). */
export interface Cell { x: number; y: number; r: number; dead: boolean }
export interface Square { x: number; y: number; s: number }   // counting square in image pixels

const cvx = () => (window as any).cv;

/** Find round cells of diameter ~d inside (and a margin around) the square. Output in image pixels. */
export function detectCells(rgba: any, sq: Square, d: number, sens = 2.2, trypan = true, deadThr = 15): Cell[] {
  const cv = cvx(), T: any[] = [], t = <M,>(m: M): M => (T.push(m), m);
  try {
    const m = Math.round(1.5 * d), x0 = Math.max(0, Math.floor(sq.x - m)), y0 = Math.max(0, Math.floor(sq.y - m));
    const x1 = Math.min(rgba.cols, Math.ceil(sq.x + sq.s + m)), y1 = Math.min(rgba.rows, Math.ceil(sq.y + sq.s + m));
    if (x1 - x0 < 8 || y1 - y0 < 8) return [];
    const roi = t(rgba.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0)));
    const g = t(new cv.Mat()); cv.cvtColor(roi, g, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(g, g, new cv.Size(0, 0), 1);
    const r = d / 2, c = t(new cv.Mat());
    // accumulator threshold scales with radius (bigger circle = more edge votes); param1 = Canny high threshold
    cv.HoughCircles(g, c, cv.HOUGH_GRADIENT, 1, d * 0.75, 60, sens * r, Math.max(2, Math.floor(r * 0.7)), Math.ceil(r * 1.35));
    const n = c.cols || 0, C = n ? c.data32F.slice() : new Float32Array(0);
    const D = trypan ? rgba.data.slice() : null, W = rgba.cols, H = rgba.rows, out: Cell[] = [];
    for (let i = 0; i < n; i++) {
      const x = C[i * 3] + x0, y = C[i * 3 + 1] + y0, rr = C[i * 3 + 2]; let dead = false;
      if (D) {                                            // trypan blue: dead cells take up the dye and look blue/dark
        let R = 0, G = 0, B = 0, k = 0; const rad = Math.max(1, Math.round(rr * 0.5));
        for (let yy = -rad; yy <= rad; yy++) for (let xx = -rad; xx <= rad; xx++) {
          if (xx * xx + yy * yy > rad * rad) continue;
          const px = Math.round(x) + xx, py = Math.round(y) + yy; if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const o = (py * W + px) * 4; R += D[o]; G += D[o + 1]; B += D[o + 2]; k++;
        }
        if (k) dead = (B - (R + G) / 2) / k > deadThr;
      }
      out.push({ x, y, r: rr, dead });
    }
    return out;
  } finally { T.forEach(m => m.delete && m.delete()); }
}

/** Protocol boundary rule: count cells inside the square or touching its top line and one side line (left by default),
 *  never cells touching the bottom line or the opposite side. */
export function isCounted(c: Cell, sq: Square, side: 'left' | 'right' = 'left'): boolean {
  const top = sq.y < c.y + c.r && c.y + c.r < sq.y + sq.s;
  const sideOk = side === 'left' ? sq.x < c.x + c.r && c.x + c.r < sq.x + sq.s : sq.x < c.x - c.r && c.x - c.r < sq.x + sq.s;
  return top && sideOk;
}

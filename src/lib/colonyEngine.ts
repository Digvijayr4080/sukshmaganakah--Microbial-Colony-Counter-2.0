/* Polarity-free colony engine (port of the validated Python prototype). Every OpenCV object is released in `finally`. */
export interface Dish { x: number; y: number; r: number }
export interface Colony { x: number; y: number; big: boolean }

export const P = { workR: 200, rim: 0.93, bgK: 25, kNoise: 3, tMin: 5.5, hiMult: 1.9, minPeak: 1.8, split: 0.6,
  bigFrac: 0.2, rimBand: 0.9, rimLen: 0.35, thinPeak: 2.8, thinElong: 3 };

const cvx = () => (window as any).cv;
const scope = () => { const T: any[] = []; return { t: <M,>(m: M): M => (T.push(m), m), free: () => T.forEach(m => m.delete && m.delete()) }; };

/** Hough circle candidates scored by edge support along the ring (rim has two edges, so tolerance via dilate). */
export function findDish(rgba: any): Dish | null {
  const cv = cvx(), { t, free } = scope();
  try {
    const s = 320 / Math.max(rgba.cols, rgba.rows);
    const sm = t(new cv.Mat()); cv.resize(rgba, sm, new cv.Size(0, 0), s, s, cv.INTER_AREA);
    const g = t(new cv.Mat()); cv.cvtColor(sm, g, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(g, g, new cv.Size(7, 7), 1.5);
    const m = Math.min(g.cols, g.rows), c = t(new cv.Mat());
    cv.HoughCircles(g, c, cv.HOUGH_GRADIENT, 1.2, m * 0.12, 100, 22, Math.floor(m * 0.28), Math.floor(m * 0.58));
    if (!c.cols) return null;
    const ed = t(new cv.Mat()); cv.Canny(g, ed, 40, 120); cv.dilate(ed, ed, t(cv.Mat.ones(3, 3, cv.CV_8U)));
    const E = ed.data.slice(), W = ed.cols, H = ed.rows, C = c.data32F.slice();
    let best: number[] | null = null, bs = -1;
    for (let i = 0; i < Math.min(c.cols, 12); i++) {
      const cx = C[i * 3], cy = C[i * 3 + 1], r = C[i * 3 + 2]; let hit = 0, tot = 0;
      for (let k = 0; k < 120; k++) {
        const a = k * Math.PI / 60, x = Math.round(cx + r * Math.cos(a)), y = Math.round(cy + r * Math.sin(a));
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        tot++; if (E[y * W + x]) hit++;
      }
      if (tot < 40) continue;
      const sc = (hit / 120) * (0.6 + 0.4 * r / (0.5 * m)); if (sc > bs) { bs = sc; best = [cx, cy, r]; }
    }
    return best ? { x: best[0] / s, y: best[1] / s, r: best[2] / s } : null;
  } finally { free(); }
}

/** Count colonies inside the dish. Input: RGBA cv.Mat (not freed here). Output coordinates are in input-image pixels. */
export function detect(rgba: any, d: Dish, p = P): Colony[] {
  const cv = cvx(), { t, free } = scope();
  try {
    const f = p.workR / d.r, R = p.workR;
    const sm = t(new cv.Mat()); cv.resize(rgba, sm, new cv.Size(0, 0), f, f, cv.INTER_AREA);
    const W = sm.cols, H = sm.rows, N = W * H, cx = d.x * f, cy = d.y * f;
    const rgb = t(new cv.Mat()); cv.cvtColor(sm, rgb, cv.COLOR_RGBA2RGB); cv.GaussianBlur(rgb, rgb, new cv.Size(3, 3), 0.8);
    const lab = t(new cv.Mat()); cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    const L = lab.data.slice();

    const d2 = new Float32Array(N), inner = new Uint8Array(N);
    const ch: number[][] = [[], [], []];
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      d2[i] = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2[i] <= (R * p.rim) ** 2) { inner[i] = 1; if ((x + y) % 3 === 0) for (let k = 0; k < 3; k++) ch[k].push(L[i * 3 + k]); }
    }
    const gmed = ch.map(a => { a.sort((u, v) => u - v); return a[a.length >> 1] || 0; });
    for (let i = 0; i < N; i++) if (d2[i] > (R * 0.97) ** 2) for (let k = 0; k < 3; k++) L[i * 3 + k] = gmed[k];   // paint outside dish with agar colour

    const fm = t(new cv.Mat(H, W, cv.CV_8UC3)); fm.data.set(L);
    const small = t(new cv.Mat()); cv.resize(fm, small, new cv.Size(W >> 2, H >> 2), 0, 0, cv.INTER_AREA);
    const med = t(new cv.Mat()); cv.medianBlur(small, med, p.bgK);
    const bgm = t(new cv.Mat()); cv.resize(med, bgm, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
    const BG = bgm.data.slice(), lab0 = lab.data.slice();

    const dE = new Float32Array(N), hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < N; i++) {
      const dl = (lab0[i * 3] - BG[i * 3]) * 100 / 255, da = lab0[i * 3 + 1] - BG[i * 3 + 1], db = lab0[i * 3 + 2] - BG[i * 3 + 2];
      dE[i] = inner[i] ? Math.sqrt(dl * dl + da * da + db * db) : 0;
      if (inner[i]) { hist[Math.min(255, (dE[i] * 4) | 0)]++; n++; }
    }
    const quant = (h: Uint32Array, q: number) => { let s = 0; for (let b = 0; b < 256; b++) { s += h[b]; if (s >= q * n) return b / 4; } return 63; };
    const md = quant(hist, 0.5), h2 = new Uint32Array(256);
    for (let i = 0; i < N; i++) if (inner[i]) h2[Math.min(255, (Math.abs(dE[i] - md) * 4) | 0)]++;
    const sig = 1.4826 * quant(h2, 0.5), lo = Math.max(p.tMin, md + p.kNoise * sig), hi = lo * p.hiMult;

    // hysteresis: components above `lo` survive only if they contain a pixel above `hi`
    const mlo = t(new cv.Mat(H, W, cv.CV_8U)), mk = new Uint8Array(N);
    for (let i = 0; i < N; i++) mk[i] = dE[i] > lo ? 1 : 0; mlo.data.set(mk);
    const lb = t(new cv.Mat()), st = t(new cv.Mat()), ce = t(new cv.Mat());
    const n1 = cv.connectedComponentsWithStats(mlo, lb, st, ce, 8, cv.CV_32S), LB = lb.data32S.slice();
    const peak = new Float32Array(n1); for (let i = 0; i < N; i++) if (LB[i] && dE[i] > peak[LB[i]]) peak[LB[i]] = dE[i];
    for (let i = 0; i < N; i++) mk[i] = LB[i] && peak[LB[i]] >= hi ? 255 : 0;
    const bin = t(new cv.Mat(H, W, cv.CV_8U)); bin.data.set(mk);
    const bin2 = t(new cv.Mat()); cv.morphologyEx(bin, bin2, cv.MORPH_OPEN, t(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))));

    // fill only SMALL holes (specular highlights); never the area enclosed by a rim ring
    const cs = t(new cv.MatVector()), hier = t(new cv.Mat());
    cv.findContours(bin2.clone ? t(bin2.clone()) : bin2, cs, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    const HI = hier.data32S.slice(), holeMax = Math.PI * (0.035 * R) ** 2;
    for (let i = 0; i < cs.size(); i++) {
      const c = cs.get(i), a = cv.contourArea(c); c.delete();
      if (HI[i * 4 + 3] !== -1 && a <= holeMax) cv.drawContours(bin2, cs, i, new cv.Scalar(255), -1);
    }
    const dt = t(new cv.Mat()); cv.distanceTransform(bin2, dt, cv.DIST_L2, 5); cv.GaussianBlur(dt, dt, new cv.Size(3, 3), 0.7);
    const DT = dt.data32F.slice();
    const l2 = t(new cv.Mat()), s2 = t(new cv.Mat()), c2 = t(new cv.Mat());
    const n2 = cv.connectedComponentsWithStats(bin2, l2, s2, c2, 8, cv.CV_32S), LB2 = l2.data32S.slice(), S2 = s2.data32S.slice();
    const mx = new Float32Array(n2), maxD = new Float32Array(n2);
    for (let i = 0; i < N; i++) { const o = LB2[i]; if (o) { if (DT[i] > mx[o]) mx[o] = DT[i]; if (d2[i] > maxD[o]) maxD[o] = d2[i]; } }

    // markers = core of each component (per-component threshold) -> one marker per colony in a clump
    const mm = t(new cv.Mat(H, W, cv.CV_8U)); const M8 = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const o = LB2[i]; M8[i] = o && DT[i] > p.split * mx[o] ? 255 : 0; } mm.data.set(M8);
    const l3 = t(new cv.Mat()), s3 = t(new cv.Mat()), c3 = t(new cv.Mat());
    const n3 = cv.connectedComponentsWithStats(mm, l3, s3, c3, 8, cv.CV_32S), LB3 = l3.data32S.slice(), C3 = c3.data64F.slice();
    const owner = new Int32Array(n3); for (let i = 0; i < N; i++) if (LB3[i] && !owner[LB3[i]]) owner[LB3[i]] = LB2[i];

    const out: Colony[] = [], bigA = Math.PI * (p.bigFrac * R) ** 2;
    for (let j = 1; j < n3; j++) {
      const o = owner[j]; if (!o) continue;
      const w = S2[o * 5 + 2], h = S2[o * 5 + 3], a = S2[o * 5 + 4], m = mx[o];
      if (m < p.minPeak) continue;
      if (m < p.thinPeak && Math.max(w, h) > p.thinElong * 2 * m) continue;                 // scratch / debris streak
      if (maxD[o] > (p.rimBand * R) ** 2 && Math.max(w, h) > p.rimLen * R) continue;          // rim glare arc
      out.push({ x: C3[j * 2] / f, y: C3[j * 2 + 1] / f, big: a > bigA });
    }
    return out;
  } finally { free(); }
}

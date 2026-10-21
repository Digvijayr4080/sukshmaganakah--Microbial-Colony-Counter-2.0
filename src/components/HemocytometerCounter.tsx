import { useCallback, useEffect, useRef, useState } from 'react';
import { Cell, Square, detectCells, isCounted } from '../lib/cellEngine';

const MAXDIM = 1600;
const fmt = (v: number) => (v >= 1e5 ? v.toExponential(2).replace('e+', ' × 10^') : v.toFixed(0));

export default function HemocytometerCounter({ cvReady }: { cvReady: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null), off = useRef(document.createElement('canvas'));
  const sq = useRef<Square>({ x: 0, y: 0, s: 400 }), cells = useRef<Cell[]>([]), drag = useRef(false);
  const [loaded, setLoaded] = useState(false), [msg, setMsg] = useState(''), [ver, setVer] = useState(0);
  const [size, setSize] = useState(400), [d, setD] = useState(24), [sens, setSens] = useState(2.2);
  const [trypan, setTrypan] = useState(true), [dil, setDil] = useState(2), [area, setArea] = useState(1), [vol, setVol] = useState(0);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const [tally, setTally] = useState<{ live: number; dead: number }[]>([]);

  const draw = useCallback(() => {
    const c = cv.current; if (!c || !loaded) return;
    const o = off.current, k = c.clientWidth / o.width; c.width = o.width; c.height = o.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(o, 0, 0); const q = sq.current, lw = Math.max(2, 2 / k);
    ctx.lineWidth = lw; ctx.strokeStyle = '#fbbf24'; ctx.strokeRect(q.x, q.y, q.s, q.s);
    ctx.lineWidth = lw * 2.5; ctx.beginPath();                      // thick = lines on which touching cells ARE counted
    if (side === 'left') { ctx.moveTo(q.x, q.y + q.s); ctx.lineTo(q.x, q.y); ctx.lineTo(q.x + q.s, q.y); }
    else { ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + q.s, q.y); ctx.lineTo(q.x + q.s, q.y + q.s); }
    ctx.stroke();
    for (const e of cells.current) {
      const ok = isCounted(e, q, side); ctx.lineWidth = lw * 1.5;
      ctx.strokeStyle = !ok ? 'rgba(160,160,160,.9)' : e.dead ? '#f43f5e' : '#22ff66';
      ctx.setLineDash(ok ? [] : [4 / k, 3 / k]); ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(e.r, 3), 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = lw * 1.5;                // cell-size reference ring
    ctx.beginPath(); ctx.arc(q.x + q.s - d, q.y + q.s + d, d / 2, 0, 7); ctx.stroke();
  }, [loaded, d, side]);
  useEffect(draw, [draw, ver, size, d, side]);

  const onFile = (f?: File) => {
    if (!f) return; const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAXDIM / Math.max(img.width, img.height)), o = off.current;
      o.width = Math.round(img.width * s); o.height = Math.round(img.height * s); o.getContext('2d')!.drawImage(img, 0, 0, o.width, o.height);
      const m = Math.min(o.width, o.height), side0 = Math.round(m * 0.6);
      sq.current = { x: (o.width - side0) / 2, y: (o.height - side0) / 2, s: side0 }; setSize(side0); cells.current = []; setTally([]);
      setD(Math.max(8, Math.round(side0 / 28))); setLoaded(true); setMsg(''); setVer(v => v + 1);
    };
    img.src = URL.createObjectURL(f);
  };

  const count = () => {
    if (!cvReady) return setMsg('Image engine is still loading…');
    const cvj = (window as any).cv, src = cvj.imread(off.current);
    try { cells.current = detectCells(src, sq.current, d, sens, trypan); setMsg(cells.current.length ? '' : 'No cells found. Match the blue ring to one cell, or raise sensitivity.'); }
    catch (e) { console.error(e); setMsg('Detection failed. See the console.'); } finally { src.delete(); }
    setVer(v => v + 1);
  };

  const pos = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(), k = off.current.width / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }; };
  const down = (e: React.PointerEvent) => {
    const p = pos(e), q = sq.current, inside = p.x > q.x && p.x < q.x + q.s && p.y > q.y && p.y < q.y + q.s;
    let bi = -1, bd = Math.max(d, 12 * p.k) * 0.8;                                           // tap a cell: remove it
    cells.current.forEach((c, i) => { const dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd < bd) { bd = dd; bi = i; } });
    if (bi >= 0) cells.current = cells.current.filter((_, i) => i !== bi);
    else if (cells.current.length && inside) cells.current = [...cells.current, { x: p.x, y: p.y, r: d / 2, dead: false }];   // tap empty: add
    else { drag.current = true; (e.target as Element).setPointerCapture(e.pointerId); sq.current = { ...q, x: p.x - q.s / 2, y: p.y - q.s / 2 }; }
    setVer(v => v + 1);
  };
  const move = (e: React.PointerEvent) => { if (drag.current) { const p = pos(e), q = sq.current; sq.current = { ...q, x: p.x - q.s / 2, y: p.y - q.s / 2 }; setVer(v => v + 1); } };

  const cur = cells.current.filter(c => isCounted(c, sq.current, side));
  const live = cur.filter(c => !c.dead).length, dead = cur.length - live;
  const n = tally.length, L = tally.reduce((a, t) => a + t.live, 0), Dd = tally.reduce((a, t) => a + t.dead, 0);
  const mlPerRegion = area * 1e-4, liveConc = n ? (L / (n * mlPerRegion)) * dil : 0, totConc = n ? ((L + Dd) / (n * mlPerRegion)) * dil : 0;
  const N = L + Dd, cvPct = N ? 100 / Math.sqrt(N) : 0, maxSq = Math.max(0, ...tally.map(t => t.live + t.dead), live + dead);

  return (
    <div className="bg-white/90 backdrop-blur-lg rounded-xl shadow-xl p-6 border-2 border-indigo-200 space-y-4">
      <div>
        <label className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white cursor-pointer">Upload hemocytometer photo
          <input type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} /></label>
        {!cvReady && <span className="ml-3 text-amber-700">Loading image engine…</span>}
      </div>
      {loaded && <>
        <canvas ref={cv} className="w-full rounded-lg border touch-none bg-black" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = false; }} />
        <p className="text-xs text-slate-600">Drag on the photo to move the yellow square onto <b>one large 1 mm² square</b> (the 4 corner squares, or the centre square). The thick yellow lines are the edges where touching cells are counted. Match the <span className="text-sky-600">blue ring</span> to the size of one cell. After counting, tap a cell to remove it, or tap empty space inside the square to add one. To move the square after counting, tap outside it.</p>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <label>Square size <input type="range" min={100} max={Math.max(120, Math.min(off.current.width, off.current.height))} value={size} className="w-full" onChange={e => { const s = +e.target.value; setSize(s); sq.current = { ...sq.current, s }; setVer(v => v + 1); }} /></label>
          <label>Cell diameter: {d}px <input type="range" min={6} max={80} value={d} className="w-full" onChange={e => setD(+e.target.value)} /></label>
          <label>Detection sensitivity <input type="range" min={1.6} max={3} step={0.1} value={+(4.6 - sens).toFixed(1)} className="w-full" onChange={e => setSens(+(4.6 - +e.target.value).toFixed(1))} /></label>
          <label>Edge rule <select value={side} onChange={e => setSide(e.target.value as 'left' | 'right')} className="ml-2 rounded border px-2 py-1"><option value="left">count top + left lines</option><option value="right">count top + right lines</option></select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={trypan} onChange={e => setTrypan(e.target.checked)} /> Trypan blue stained (blue = dead)</label>
          <label>Dilution factor <input type="number" min={1} step={0.5} value={dil} onChange={e => setDil(Math.max(1, +e.target.value))} className="ml-2 w-20 rounded border px-2 py-1" /> <span className="text-slate-500">(1:1 trypan = 2)</span></label>
          <label>Area per counted square (mm²) <input type="number" min={0.001} step={0.01} value={area} onChange={e => setArea(Math.max(0.001, +e.target.value))} className="ml-2 w-24 rounded border px-2 py-1" /></label>
          <label>Sample volume (mL, optional) <input type="number" min={0} step={0.1} value={vol} onChange={e => setVol(Math.max(0, +e.target.value))} className="ml-2 w-24 rounded border px-2 py-1" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={count} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Count cells in square</button>
          <button disabled={!cells.current.length} onClick={() => { setTally([...tally, { live, dead }]); cells.current = []; setVer(v => v + 1); }} className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-40">Add square to tally</button>
          <button onClick={() => setTally([])} className="rounded-lg bg-slate-200 px-4 py-2">Clear tally</button>
          <span className="text-lg font-semibold">This square: <span className="text-green-600">{live} live</span>{trypan && <>, <span className="text-rose-600">{dead} dead</span></>}</span>
        </div>
        {msg && <p className="text-amber-700 text-sm">{msg}</p>}
        <div className="rounded-lg bg-indigo-50 p-4 text-sm space-y-1">
          <div className="font-semibold">Tally: {n} square{n === 1 ? '' : 's'} {n > 0 && <>({tally.map(t => t.live + t.dead).join(' + ')} cells)</>}</div>
          {n > 0 && <>
            <div>Live cells/mL: <b className="text-lg">{fmt(liveConc)}</b> <span className="text-slate-500">= ({L} ÷ {n} squares) × {dil} × {fmt(1 / mlPerRegion)}</span></div>
            {trypan && <div>Viability: <b>{N ? ((L / N) * 100).toFixed(1) : 0}%</b> ({L} live, {Dd} dead) · total cells/mL {fmt(totConc)}</div>}
            {vol > 0 && <div>Total live cells in {vol} mL: <b>{fmt(liveConc * vol)}</b></div>}
            <div className="text-slate-600">Counting precision (Poisson): about ±{cvPct.toFixed(0)}% from {N} cells.</div>
          </>}
          {n > 0 && N < 100 && <div className="text-amber-700">Fewer than ~100 cells counted. Add more squares, or use a less diluted sample.</div>}
          {maxSq > 100 && <div className="text-amber-700">More than 100 cells in one square: counting gets unreliable. Dilute the sample and recount.</div>}
        </div>
      </>}
    </div>
  );
}

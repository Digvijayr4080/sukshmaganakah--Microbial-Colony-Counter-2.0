import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Lock, Pause, Play, Unlock } from 'lucide-react';
import { Colony, Dish, detect, findDish } from '../lib/colonyEngine';

const PROC = 480;          // longest side of the frame the engine sees
const TICK_MS = 250;       // ~4 analyses per second
const DISH_EVERY_MS = 1500;

export default function LiveCounter({ cvReady }: { cvReady: boolean }) {
  const video = useRef<HTMLVideoElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const proc = useRef(document.createElement('canvas'));
  const dish = useRef<Dish | null>(null), dots = useRef<Colony[]>([]), hist = useRef<number[]>([]);
  const locked = useRef(false), frozen = useRef(false), drag = useRef(false);
  const [on, setOn] = useState(false), [err, setErr] = useState(''), [count, setCount] = useState(0);
  const [isLocked, setIsLocked] = useState(false), [isFrozen, setIsFrozen] = useState(false), [radius, setRadius] = useState(0);

  const draw = useCallback(() => {
    const cv = overlay.current, v = video.current; if (!cv || !v || !v.videoWidth) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const k = w / proc.current.width, ctx = cv.getContext('2d')!; ctx.clearRect(0, 0, w, h);
    const d = dish.current;
    if (d) { ctx.strokeStyle = locked.current ? '#fbbf24' : 'rgba(255,255,255,.75)'; ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(d.x * k, d.y * k, d.r * k, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    for (const c of dots.current) {                      // fluorescent glow
      const x = c.x * k, y = c.y * k, r = (c.big ? 7 : 4.5) * dpr;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
      g.addColorStop(0, 'rgba(190,255,60,1)'); g.addColorStop(0.35, 'rgba(60,255,90,.75)'); g.addColorStop(1, 'rgba(0,255,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#eaffd0'; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, 7); ctx.fill();
    }
  }, []);

  const start = async () => {
    setErr('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      video.current!.srcObject = s; await video.current!.play(); setOn(true);
    } catch (e: any) { setErr(e?.message || 'Camera unavailable (needs HTTPS or localhost and permission).'); }
  };

  useEffect(() => () => { (video.current?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop()); }, []);

  useEffect(() => {
    if (!on || !cvReady) return;
    let stop = false, timer = 0, lastDish = 0;
    const cv = (window as any).cv;
    const tick = () => {
      if (stop) return;
      const v = video.current!;
      if (v.videoWidth && !frozen.current) {
        const s = PROC / Math.max(v.videoWidth, v.videoHeight), c = proc.current;
        c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        const src = cv.imread(c);
        try {
          const now = performance.now();
          if (!locked.current && (!dish.current || now - lastDish > DISH_EVERY_MS)) {
            const d = findDish(src); lastDish = now;
            if (d) { const o = dish.current; dish.current = o ? { x: (o.x + d.x) / 2, y: (o.y + d.y) / 2, r: (o.r + d.r) / 2 } : d; setRadius(Math.round(dish.current.r)); }
          }
          if (dish.current) {
            dots.current = detect(src, dish.current);
            hist.current = [...hist.current.slice(-6), dots.current.length];
            setCount([...hist.current].sort((a, b) => a - b)[hist.current.length >> 1]);   // median of last 7 frames
          }
        } catch (e) { console.error(e); } finally { src.delete(); }
        draw();
      }
      timer = window.setTimeout(tick, TICK_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [on, cvReady, draw]);

  const lock = (v: boolean) => { locked.current = v; setIsLocked(v); draw(); };
  const toggleFreeze = () => {
    frozen.current = !frozen.current; setIsFrozen(frozen.current);
    if (frozen.current) setCount(dots.current.length);
  };
  const pos = (e: React.PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect(), k = proc.current.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
  };
  const down = (e: React.PointerEvent) => {
    const p = pos(e);
    if (frozen.current) {                                  // tap-to-correct: remove nearest dot, else add one
      const reach = 16 * p.k; let bi = -1, bd = reach;
      dots.current.forEach((c, i) => { const dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd < bd) { bd = dd; bi = i; } });
      dots.current = bi >= 0 ? dots.current.filter((_, i) => i !== bi) : [...dots.current, { x: p.x, y: p.y, big: false }];
      setCount(dots.current.length); draw();
    } else if (dish.current) { drag.current = true; lock(true); (e.target as Element).setPointerCapture(e.pointerId); dish.current = { ...dish.current, x: p.x, y: p.y }; draw(); }
  };
  const move = (e: React.PointerEvent) => { if (drag.current && dish.current) { const p = pos(e); dish.current = { ...dish.current, x: p.x, y: p.y }; draw(); } };

  return (
    <div className="bg-white/90 backdrop-blur-lg rounded-xl shadow-xl p-6 border-2 border-indigo-200">
      {!cvReady && <p className="text-amber-700 mb-3">Loading image engine…</p>}
      {err && <p className="text-red-600 mb-3">{err}</p>}
      <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ maxWidth: 720, aspectRatio: on ? undefined : '4 / 3' }}>
        <video ref={video} playsInline muted className="w-full block" />
        <canvas ref={overlay} className="absolute inset-0 w-full h-full touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = false; }} />
        {on && (
          <div className="absolute top-3 left-3 rounded-lg bg-black/60 px-4 py-2 text-white">
            <div className="text-xs uppercase tracking-wide opacity-80">{isFrozen ? 'Frozen – tap to add / remove' : 'Colonies'}</div>
            <div className="text-3xl font-bold text-lime-300">{count}</div>
          </div>
        )}
        {!on && <div className="absolute inset-0 flex items-center justify-center"><button onClick={start} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-white"><Camera size={20} /> Start camera</button></div>}
      </div>
      {on && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button onClick={toggleFreeze} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-white">{isFrozen ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Freeze &amp; count</>}</button>
          <button onClick={() => lock(!isLocked)} className="flex items-center gap-2 rounded-lg bg-slate-200 px-4 py-2">{isLocked ? <><Unlock size={16} /> Auto circle</> : <><Lock size={16} /> Lock circle</>}</button>
          <label className="flex items-center gap-2 text-sm">Circle size
            <input type="range" min={40} max={400} value={radius} onChange={e => { const r = +e.target.value; setRadius(r); if (dish.current) dish.current = { ...dish.current, r }; lock(true); }} /></label>
        </div>
      )}
      {on && count === 0 && dish.current && !isFrozen && <p className="mt-3 text-center text-sm text-slate-600">No colonies found. Improve lighting, or the plate may be confluent.</p>}
      {on && count > 300 && <p className="mt-3 text-center text-sm font-semibold text-amber-700">Too numerous to count reliably (TNTC). Dilute and re-plate.</p>}
      <p className="mt-3 text-center text-xs text-slate-500">Drag on the video to move the dish circle (this locks it). Freeze first, then tap a dot to remove it or tap empty agar to add one.</p>
    </div>
  );
}

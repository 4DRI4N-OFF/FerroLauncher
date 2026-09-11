import { useEffect, useRef } from 'react';

// Brasas flotantes: canvas fijo tras el contenido, chispas ámbar ascendentes.
export default function Embers({ count = 55 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    const P = [];
    const resize = () => {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
    };
    const spawn = (init) => ({
      x: Math.random() * w,
      y: init ? Math.random() * h : h + 10,
      r: 0.6 + Math.random() * 2.2,
      s: 0.15 + Math.random() * 0.5,
      drift: (Math.random() - 0.5) * 0.3,
      a: 0.15 + Math.random() * 0.5,
      tw: Math.random() * Math.PI * 2,
    });
    const loop = () => {
      if (!visible) return;
      ctx.clearRect(0, 0, w, h);
      const beat = window.__ferroBeat || 0;
      const boost = 1 + beat * 5;
      for (const p of P) {
        p.y -= p.s * boost;
        p.tw += 0.01 * boost;
        p.x += (p.drift + Math.sin(p.tw) * 0.15) * (1 + beat * 1.5);
        p.a *= 0.9995;
        if (p.y < -12 || p.a < 0.02) Object.assign(p, spawn(false));
        const alpha = Math.max(0, Math.min(1, p.a * (0.6 + 0.4 * Math.sin(p.tw * 3)) * (1 + beat * 0.9)));
        const rr = p.r * (1 + beat * 0.9);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 4);
        g.addColorStop(0, `rgba(255,190,90,${alpha.toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,110,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 4, 0, 7);
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      visible = !document.hidden;
      if (visible) loop();
    };
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    for (let i = 0; i < count; i++) P.push(spawn(true));
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [count]);
  return <canvas ref={ref} className="embers" />;
}

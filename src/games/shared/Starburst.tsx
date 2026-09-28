import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { COLORS } from '../../features/galaxy/config';

interface Particle { x: number; y: number; vx: number; vy: number; r: number; c: string; life: number; spin: number; star: boolean }

/** Winner celebration: a burst of star particles (replaces confetti). Skipped with reduced motion. */
export function Starburst({ color, burstKey }: { color: string; burstKey: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current, g = canvas?.getContext('2d');
    if (!canvas || !g || !burstKey || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const palette = [color, color, COLORS.gold, COLORS.pink, COLORS.cyan, COLORS.white];
    const parts: Particle[] = Array.from({ length: 110 }, () => {
      const a = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 520;
      return {
        x: w / 2, y: h * 0.45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: 2 + Math.random() * 5,
        c: palette[Math.floor(Math.random() * palette.length)], life: 1, spin: Math.random() * 6, star: Math.random() < 0.45,
      };
    });
    let last = performance.now();
    const tick = () => {
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      let alive = 0;
      for (const p of parts) {
        if (p.life <= 0) continue;
        alive++;
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 0.55;
        p.spin += dt * 4;
        g.globalAlpha = Math.max(0, p.life);
        g.fillStyle = p.c;
        g.shadowColor = p.c;
        g.shadowBlur = 12;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.spin);
        g.beginPath();
        if (p.star) {
          const r = p.r * 1.6;
          g.moveTo(0, -r);
          g.quadraticCurveTo(0, 0, r, 0);
          g.quadraticCurveTo(0, 0, 0, r);
          g.quadraticCurveTo(0, 0, -r, 0);
          g.quadraticCurveTo(0, 0, 0, -r);
        } else {
          g.arc(0, 0, p.r * 0.6, 0, Math.PI * 2);
        }
        g.fill();
        g.restore();
      }
      if (!alive) gsap.ticker.remove(tick);
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      g.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [burstKey, color]);

  return <canvas ref={ref} className="gm-starburst" aria-hidden="true" />;
}

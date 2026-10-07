// Math helpers and offscreen canvas art for the galaxy map (rendered once, reused every frame).
import { COLORS } from './config';

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const safeCount = (n: number, max: number) => (Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0);
export const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
export const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export const mkCanvas = (s: number) => {
  const c = document.createElement('canvas');
  c.width = c.height = s;
  return c;
};

const ctx2d = (c: HTMLCanvasElement) => {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available');
  return g;
};

export function radialSprite(S: number, hex: string, stops: [number, number][]) {
  const c = mkCanvas(S), g = ctx2d(c), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  stops.forEach(([o, a]) => gr.addColorStop(o, rgba(hex, a)));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

export function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, hex: string, a: number) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(hex, a));
  gr.addColorStop(0.4, rgba(hex, a * 0.5));
  gr.addColorStop(1, rgba(hex, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export interface Pt {
  x: number;
  y: number;
}

export function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

// ---------------- sprites ----------------
export interface Sprites {
  glow: (hex: string) => HTMLCanvasElement;
  soft: (hex: string) => HTMLCanvasElement;
  sparkle: HTMLCanvasElement;
  coin: HTMLCanvasElement;
  chips: HTMLCanvasElement[];
}

/** Sprite sheets and the grain tile are identical for every engine instance, and the engine
 *  is rebuilt on each StrictMode double-mount and whenever the island set changes. Building
 *  them once per page removes that repeated synchronous work from startup. */
let spriteCache: Sprites | null = null;
let grainCache: string | null = null;

export function makeSprites(): Sprites {
  if (spriteCache) return spriteCache;
  return (spriteCache = buildSprites());
}

function buildSprites(): Sprites {
  const glowCache = new Map<string, HTMLCanvasElement>(), softCache = new Map<string, HTMLCanvasElement>();
  const glow = (hex: string) => {
    let s = glowCache.get(hex);
    if (!s) glowCache.set(hex, (s = radialSprite(64, hex, [[0, 1], [0.14, 0.85], [0.34, 0.22], [1, 0]])));
    return s;
  };
  const soft = (hex: string) => {
    let s = softCache.get(hex);
    if (!s) softCache.set(hex, (s = radialSprite(128, hex, [[0, 1], [0.4, 0.35], [1, 0]])));
    return s;
  };
  Object.values(COLORS).forEach(hex => { glow(hex); soft(hex); });

  const sparkle = mkCanvas(96), g = ctx2d(sparkle);
  g.drawImage(radialSprite(96, COLORS.gold, [[0, 0.5], [0.3, 0.12], [1, 0]]), 0, 0);
  g.fillStyle = COLORS.gold;
  g.beginPath();
  g.moveTo(48, 6);
  g.quadraticCurveTo(48, 48, 90, 48);
  g.quadraticCurveTo(48, 48, 48, 90);
  g.quadraticCurveTo(48, 48, 6, 48);
  g.quadraticCurveTo(48, 48, 48, 6);
  g.fill();
  g.drawImage(radialSprite(96, COLORS.white, [[0, 1], [0.08, 0.6], [0.16, 0]]), 0, 0);

  const coin = mkCanvas(32), cg = ctx2d(coin);
  cg.fillStyle = COLORS.gold;
  cg.beginPath(); cg.arc(16, 16, 14, 0, 7); cg.fill();
  cg.strokeStyle = rgba(COLORS.space, 0.35); cg.lineWidth = 2;
  cg.beginPath(); cg.arc(16, 16, 9.5, 0, 7); cg.stroke();
  cg.fillStyle = rgba(COLORS.white, 0.4);
  cg.beginPath(); cg.arc(11, 11, 3.5, 0, 7); cg.fill();

  const chips = [COLORS.pink, COLORS.violet, COLORS.gold].map(hex => {
    const c = mkCanvas(32), x = ctx2d(c);
    x.fillStyle = hex;
    x.beginPath(); x.arc(16, 16, 14, 0, 7); x.fill();
    x.strokeStyle = COLORS.white; x.lineWidth = 3.5;
    for (let k = 0; k < 6; k++) {
      x.beginPath(); x.arc(16, 16, 12, (k * Math.PI) / 3, (k * Math.PI) / 3 + 0.38); x.stroke();
    }
    x.strokeStyle = rgba(COLORS.white, 0.55); x.lineWidth = 1;
    x.beginPath(); x.arc(16, 16, 7, 0, 7); x.stroke();
    return c;
  });

  return { glow, soft, sparkle, coin, chips };
}

export function makeGrainURL() {
  if (grainCache) return grainCache;
  return (grainCache = buildGrainURL());
}

function buildGrainURL() {
  const n = 160, c = mkCanvas(n), g = ctx2d(c), d = g.createImageData(n, n);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 11 : 241;
    d.data[i] = v; d.data[i + 1] = v + 2; d.data[i + 2] = v + 14; d.data[i + 3] = Math.random() * 22;
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL();
}

export function makeGalaxy() {
  const S = 640, c = mkCanvas(S), g = ctx2d(c), h = S / 2;
  g.globalCompositeOperation = 'lighter';
  blob(g, h, h, S * 0.48, COLORS.violet, 0.12);
  for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 520; i++) {
    const u = i / 520, rr = u * S * 0.46, th = arm * Math.PI + u * 4.4 + rand(-0.28, 0.28) * (1 - u * 0.5);
    const col = Math.random() < 0.1 ? COLORS.white : Math.random() < 0.45 ? COLORS.pink : COLORS.violet;
    blob(g, h + Math.cos(th) * rr + rand(-6, 6), h + Math.sin(th) * rr + rand(-6, 6), rand(4, 14) * (1 - u * 0.3) + 2, col, rand(0.04, 0.1) * (1 - u * 0.6));
  }
  blob(g, h, h, S * 0.3, COLORS.violet, 0.25);
  blob(g, h, h, S * 0.16, COLORS.pink, 0.5);
  blob(g, h, h, S * 0.07, COLORS.white, 0.55);
  return c;
}

export function makeCloud(pinkBias: number) {
  const S = 360, c = mkCanvas(S), g = ctx2d(c), bl: { x: number; y: number; r: number }[] = [];
  let x = S / 2, y = S / 2;
  for (let i = 0; i < 16; i++) {
    x = clamp(x + rand(-42, 42), S * 0.33, S * 0.67);
    y = clamp(y + rand(-32, 32), S * 0.35, S * 0.65);
    bl.push({ x, y, r: rand(S * 0.09, S * 0.17) });
  }
  const cx = bl.reduce((a, b) => a + b.x, 0) / bl.length, cy = bl.reduce((a, b) => a + b.y, 0) / bl.length;
  g.globalCompositeOperation = 'lighter';
  bl.forEach(b => blob(g, cx + (b.x - cx) * 1.25, cy + (b.y - cy) * 1.25, b.r * 1.1, COLORS.cyan, 0.06));
  bl.forEach(b => blob(g, b.x, b.y, b.r, COLORS.violet, 0.16));
  bl.forEach(b => { if (Math.random() < pinkBias) blob(g, b.x + rand(-10, 10), b.y + rand(-10, 10), b.r * 0.55, COLORS.pink, 0.2); });
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) blob(g, rand(S * 0.25, S * 0.75), rand(S * 0.25, S * 0.75), rand(S * 0.04, S * 0.1), '#000000', 0.28);
  return c;
}

// ---------------- easter-egg constellation shapes (unit coordinates) ----------------
export interface Shape {
  pts: [number, number][];
  lines: [number, number][];
}

const heartPts = (flip: number) => {
  const p: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    p.push([(16 * Math.sin(t) ** 3) / 34, (flip * -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 34]);
  }
  return p;
};
const loop = (n: number) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]);

export const SHAPES: Record<'heart' | 'spade' | 'die' | 'moon', () => Shape> = {
  heart: () => ({ pts: heartPts(1), lines: loop(10) }),
  spade: () => {
    const p = heartPts(-1), y0 = p[0][1];
    p.push([0, y0 + 0.16], [-0.12, y0 + 0.28], [0.12, y0 + 0.28]);
    return { pts: p, lines: [...loop(10), [0, 10], [10, 11], [10, 12], [11, 12]] };
  },
  die: () => ({
    pts: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]],
    lines: loop(4),
  }),
  moon: () => {
    const n = 7, pts: [number, number][] = [], lines: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = ((100 + (i / (n - 1)) * 160) * Math.PI) / 180;
      pts.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
      if (i) lines.push([i - 1, i]);
    }
    let prev = 0;
    for (let i = 1; i < n - 1; i++) {
      const a = ((100 + (i / (n - 1)) * 160) * Math.PI) / 180;
      pts.push([0.5 * Math.cos(a) * 0.35 - 0.06, 0.5 * Math.sin(a) * 0.9]);
      lines.push([prev, pts.length - 1]);
      prev = pts.length - 1;
    }
    lines.push([prev, n - 1]);
    return { pts, lines };
  },
};

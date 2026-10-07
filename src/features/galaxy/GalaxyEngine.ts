// Canvas + GSAP engine behind the galaxy map. Framework-agnostic: React renders the DOM
// (islands, HUD, panels) and hands the elements over; the engine owns the camera, the sky
// and every per-frame DOM transform.
//
// Camera model: cam = {x, y} is the world point at the screen centre, z the zoom of the
// island layer. Sky layers project through proj(layer) with their own parallax/depth.
import gsap from 'gsap';
import { GALAXY_CONFIG as C, type IslandDef, type LayerDef, type StarLayerDef } from './config';
import {
  SHAPES, catmull, clamp, gauss, makeCloud, makeGalaxy, makeGrainURL, makeSprites, pick, rand, rgba,
  safeCount, smooth, type Pt, type Sprites,
} from './art';

export interface GalaxyElements {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  fx: HTMLCanvasElement;
  grain: HTMLDivElement;
  loader: HTMLDivElement;
  hud: HTMLDivElement;
  fade: HTMLDivElement;
  debug: HTMLDivElement;
}

export interface GalaxyCallbacks {
  onNav: (prev: number, next: number) => void;
  onEnter: (index: number) => void;
  onExit: () => void;
  /** -1 when no island holds the camera. A focused island enters on the next click. */
  onFocusChange: (index: number) => void;
}

export interface GalaxyOptions {
  starDensity: number;
  worldScreens: number;
  forceReducedMotion: boolean;
}

export interface GalaxyState {
  zoom: number;
  x: number;
  y: number;
  currentIsland: number | null;
  warping: boolean;
  entered: boolean;
}

type Cam = { x: number; y: number; z: number };
type Kind = 'white' | 'cyan' | 'gold';
interface Star { x: number; y: number; r: number; a: number; kind: Kind; sp: number; ph: number }
interface StarLayer { L: StarLayerDef; stars: Star[] }
interface Cloud { img: HTMLCanvasElement | null; fade: number; x: number; y: number; size: number; alpha: number; b: number; ph: number }
interface Constellation { pts: { x: number; y: number; ph: number }[]; lines: [number, number][] }
interface Bulb { x: number; y: number; on: number; color: string }
interface MarqueeGroup { cx: number; cy: number; bulbs: Bulb[] }
interface BeltItem { u: number; off: number; s: number; img: HTMLCanvasElement; rot: number; rs: number; spin: number; ss: number; du: number }
interface DensePt { x: number; y: number; d: number }
interface PathNode { x: number; y: number; d: number; big: boolean; ph: number }
interface Dust { x: number; y: number; r: number; c: string; a: number; vx: number; vy: number }
interface Comet { x: number; y: number; dx: number; dy: number; dist: number; tail: number; p: number }
interface Streak { ang: number; r0: number; sp: number; a: number; w: number; c: string }
interface Mote { ang: number; speed: number; rx: number; ry: number; h: number; size: number; color: string; ph: number }
interface Spark { x: number; y0: number; rise: number; life: number; t: number; size: number; color: string }
interface IslandDom { wrap: HTMLElement; body: HTMLElement; label: HTMLElement }
interface Extent { x0: number; x1: number; y0: number; y1: number; core0: number; core1: number }
interface Proj { s: number; ox: number; oy: number }

const ctx2d = (c: HTMLCanvasElement) => {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available');
  return g;
};

export class GalaxyEngine {
  private readonly els: GalaxyElements;
  private readonly islands: IslandDef[];
  private readonly cb: GalaxyCallbacks;
  private opts: GalaxyOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fxCtx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');
  private readonly bgCtx: CanvasRenderingContext2D;
  private readonly sprites: Sprites;
  private readonly mq = matchMedia('(prefers-reduced-motion: reduce)');
  private miniView: HTMLElement | null = null;
  private destroyed = false;
  private ready = false;

  // viewport + world
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private bgScale = 0.5;
  private quality = 2;
  private worldW = 0;
  private slotR = 40;
  private zMin = 0.15;
  private readonly zMax = C.camera.maxZoom;
  private slotW: Pt[] = [];
  private islandW: number[] = [];
  private islandH: number[] = [];
  private readonly slotPos: Pt[];
  private readonly hov: number[];
  private readonly flash: { v: number }[];
  private islandDom: IslandDom[] = [];

  // camera + input
  private cam: Cam | null = null;
  private camT: Cam = { x: 0, y: 0, z: 1 };
  private camTween: gsap.core.Tween | null = null;
  private camDone: (() => void) | undefined;
  private introCall: gsap.core.Tween | null = null;
  private vel = { x: 0, y: 0 };
  private readonly pointers = new Map<number, Pt>();
  private pinch: { d0: number; z0: number; wx: number; wy: number } | null = null;
  private dragging = false;
  private dragMoved = false;
  private pointerDown = false;
  private last = { x: 0, y: 0, t: 0 };
  private downAt: Pt = { x: 0, y: 0 };
  private pointer: Pt | null = null;
  private mouse = { x: 0, y: 0 };
  private mouseT = { x: 0, y: 0 };
  private focusSlot = -1;
  private currentIsland: number | null = null;
  /** Island the camera was last sent to and is sitting on: the next click on it enters.
   *  Kept separate from currentIsland, which is a proximity heuristic and gets cleared
   *  whenever the fit-all zoom happens to equal the fly-to zoom. */
  private armed: number | null = null;
  private lastFocus = -1;
  private lastNav = { pi: -2, ni: -2 };
  private anyHover = false;

  // warp
  private readonly warp = { t: 0, hide: 0, slot: 0 };
  private warping = false;
  private entered = false;
  private warpStreaks: Streak[] = [];
  private warpTl: gsap.core.Timeline | null = null;
  private warpResolve: (() => void) | null = null;
  private saved: Cam | null = null;
  private savedIsland: number | null = null;

  // scene content
  private t = 0;
  private frameN = 0;
  private ema = 16;
  private slowFrames = 0;
  private lastTick = performance.now();
  private debug = false;
  private starLayers: StarLayer[] = [];
  private clouds: Cloud[] = [];
  private cloudImgs: (HTMLCanvasElement | null)[] = [];
  private galaxyImg: HTMLCanvasElement | null = null;
  private readonly galaxyFade = { v: 0 };
  private galaxy = { x: 0, y: 0, size: 0 };
  private constellations: Constellation[] = [];
  private marquee: MarqueeGroup[] = [];
  private belt: BeltItem[] = [];
  private dense: DensePt[] = [];
  private pathLen = 0;
  private slotD: number[] = [];
  private segs: { nodes: PathNode[] }[] = [];
  private dust: Dust[] = [];
  private dustExt: Extent = { x0: 0, x1: 0, y0: 0, y1: 0, core0: 0, core1: 0 };
  private motes: Mote[][] = [];
  private sparks: Spark[][] = [];
  private comet: Comet | null = null;
  private readonly pulse = { d: 0, a: 0, dir: 1 };
  private pulseTl: gsap.core.Timeline | null = null;
  private flying = false;
  private sceneTweens: (gsap.core.Tween | gsap.core.Timeline)[] = [];
  private cometCall: gsap.core.Tween | null = null;
  private marqueeCall: gsap.core.Tween | null = null;
  private marqueeTl: gsap.core.Timeline | null = null;

  // timers + listeners
  private raf = 0;
  private resizeTimer = 0;
  private watchdog = 0;
  private readonly ro: ResizeObserver;

  constructor(els: GalaxyElements, islands: IslandDef[], cb: GalaxyCallbacks, opts: GalaxyOptions) {
    this.els = els;
    this.islands = islands;
    this.cb = cb;
    this.opts = opts;
    this.ctx = ctx2d(els.canvas);
    this.fxCtx = ctx2d(els.fx);
    this.bgCtx = ctx2d(this.bg);
    this.sprites = makeSprites();
    this.slotPos = islands.map(() => ({ x: 0, y: 0 }));
    this.hov = islands.map(() => 0);
    this.flash = islands.map(() => ({ v: 0 }));
    els.grain.style.backgroundImage = `url(${makeGrainURL()})`;

    gsap.ticker.lagSmoothing(0); // tweens follow real time even when frames are slow
    this.buildScene();
    this.bind();
    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(els.root);
    gsap.ticker.add(this.tick);
    // If rAF gets throttled while the page is visible (embedded frames), drive the ticker manually.
    this.watchdog = window.setInterval(() => {
      if (!document.hidden && performance.now() - this.lastTick > 250) gsap.ticker.tick();
    }, 120);
    void this.loadArt();
    this.introCall = gsap.delayedCall(C.camera.introDelay, () => this.flyTo(0, 1.8, 'power3.inOut', false));
  }

  // ================= public API =================
  setOptions(opts: GalaxyOptions) {
    const o = this.opts;
    this.opts = opts;
    if (o.starDensity !== opts.starDensity || o.worldScreens !== opts.worldScreens || o.forceReducedMotion !== opts.forceReducedMotion) this.buildScene();
  }

  setMiniView(el: HTMLElement | null) {
    this.miniView = el;
  }

  state(): GalaxyState {
    const c = this.cam ?? this.camT;
    return { zoom: c.z, x: c.x, y: c.y, currentIsland: this.currentIsland, warping: this.warping, entered: this.entered };
  }

  handleIslandClick(id: string) {
    if (this.dragMoved) return;
    const i = this.islands.findIndex(s => s.id === id);
    if (i < 0) return;
    // Clicking an island the camera is not already settled on only approaches it, so a stray
    // click from across the galaxy never drops the class into a game.
    if (this.armed !== i) {
      this.flyTo(i);
      return;
    }
    void this.warpTo(id);
  }

  focusIsland(i: number) {
    this.focusSlot = i;
    if (i >= 0 && this.cam && !this.warping && !this.pointerDown) this.flyTo(i);
  }

  goPrev() { this.flyNav(this.navTargets().pi); }
  goNext() { this.flyNav(this.navTargets().ni); }

  zoomBy(f: number) {
    if (this.warping || !this.cam) return;
    this.cancelIntro();
    const b = this.activeTarget();
    this.zoomAt(this.vw / 2, this.vh / 2, b.z * f, b);
  }

  viewAll() {
    if (this.warping || !this.cam) return;
    this.cancelIntro();
    this.armed = null;
    this.vel = { x: 0, y: 0 };
    this.currentIsland = null;
    this.camTo(this.fitAll(), 0.9, 'power3.out');
  }

  flyTo(i: number, dur?: number, ease?: string, arm = true) {
    const s = this.slotW[i];
    if (!s || this.warping || !this.cam) return;
    this.cancelIntro();
    this.vel = { x: 0, y: 0 };
    this.currentIsland = null;
    this.armed = null;
    // zoom in past the fit-all level, otherwise arriving looks like nothing happened
    const z = Math.max(this.activeTarget().z, this.zMin * 1.45, 1);
    this.camTo({ x: s.x, y: s.y, z }, dur ?? C.camera.flyDuration, ease ?? 'power3.inOut', () => {
      this.currentIsland = i;
      // The opening fly-in is not a choice the teacher made, so it must not arm the island:
      // otherwise the very first click on it would drop straight into the game.
      if (arm) this.armed = i;
    });
  }

  toggleDebug() {
    this.debug = !this.debug;
    this.els.debug.style.display = this.debug ? 'block' : 'none';
    this.updateDebug();
  }

  warpTo(id: string): Promise<void> {
    const W = C.warp, col = C.colors, i = this.islands.findIndex(s => s.id === id);
    const cam = this.cam;
    if (i < 0 || this.warping || !cam || this.destroyed) return Promise.resolve();
    this.saved = this.clampCam(this.activeTarget());
    this.savedIsland = this.currentIsland;
    // entering consumes the arm, so coming back out needs the two clicks again
    this.armed = null;
    this.cancelIntro();
    this.killCam();
    this.vel = { x: 0, y: 0 };
    this.warping = true;
    this.comet = null;
    this.warp.slot = i;
    const s = this.islands[i], p = this.slotW[i], red = this.reduced;
    const focus = this.clampCam({ x: p.x, y: p.y, z: Math.max(cam.z, 1.2) });
    const pal = [col.cyan, col.white, col.white, col.pink, col.gold, col.violet, s.color];
    this.warpStreaks = Array.from({ length: W.streaks }, () => ({
      ang: rand(0, 6.283), r0: rand(0.03, 1), sp: rand(0.6, 1.5), a: rand(0.5, 1), w: rand(0.8, 2.4), c: pick(pal),
    }));
    return new Promise(res => {
      this.warpResolve = res;
      const tl = gsap.timeline({
        onComplete: () => {
          this.warpTl = null;
          this.warpResolve = null;
          if (this.destroyed) return res();
          this.entered = true;
          this.cb.onEnter(i);
          res();
        },
      });
      this.warpTl = tl;
      tl.to(this.els.hud, { opacity: 0, duration: 0.35 }, 0);
      tl.to(cam, { x: focus.x, y: focus.y, z: focus.z, duration: W.pan, ease: 'power3.out' }, 0);
      tl.to(this.warp, { hide: 1, duration: 0.45, ease: 'power1.out' }, W.pan);
      tl.to(this.warp, { t: red ? 0 : 1, duration: W.streak, ease: 'power2.in' }, W.pan);
      tl.to(cam, { x: p.x, y: p.y, z: focus.z * (red ? 1.15 : W.zoomMul), duration: W.streak, ease: red ? 'sine.inOut' : 'power3.in' }, W.pan);
      tl.to(this.els.fade, { opacity: 1, duration: W.fade, ease: 'power1.in' }, W.pan + W.streak - W.fade + 0.3);
    });
  }

  returnToMap(): Promise<void> {
    const cam = this.cam;
    if (!this.entered || !cam || this.destroyed) return Promise.resolve();
    const W = C.warp, red = this.reduced, back = this.saved ?? this.fitAll();
    this.entered = false;
    this.cb.onExit();
    return new Promise(res => {
      this.warpResolve = res;
      this.onRootScroll();
      const tl = gsap.timeline({
        onComplete: () => {
          this.warpTl = null;
          this.warpResolve = null;
          this.warping = false;
          this.onRootScroll();
          this.camT = { ...back };
          this.currentIsland = this.savedIsland ?? null;
          res();
        },
      });
      this.warpTl = tl;
      tl.to(this.els.fade, { opacity: 0, duration: red ? 1.2 : 1, ease: 'power1.out' }, 0);
      tl.to(this.warp, { t: 0, duration: W.back, ease: 'power3.out' }, 0);
      tl.to(cam, { x: back.x, y: back.y, z: back.z, duration: W.back, ease: red ? 'sine.inOut' : 'power3.out' }, 0);
      tl.to(this.warp, { hide: 0, duration: 0.5 }, 0.7);
      tl.to(this.els.hud, { opacity: 1, duration: 0.5 }, 0.8);
    });
  }

  destroy() {
    this.destroyed = true;
    this.ready = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resizeTimer);
    clearInterval(this.watchdog);
    gsap.ticker.remove(this.tick);
    this.killScene();
    this.killCam();
    this.cancelIntro();
    this.warpTl?.kill();
    this.warpResolve?.();
    this.warpResolve = null;
    this.pulseTl?.kill();
    gsap.killTweensOf([
      this.pulse, this.warp, this.galaxyFade, ...this.flash, ...this.clouds,
      ...this.marquee.flatMap(g => g.bulbs), this.els.hud, this.els.fade, this.els.loader,
    ]);
    if (this.cam) gsap.killTweensOf(this.cam);
    if (this.comet) gsap.killTweensOf(this.comet);
    gsap.set([this.els.hud, this.els.fade], { clearProps: 'opacity' });
    this.ro.disconnect();
    this.unbind();
    gsap.ticker.lagSmoothing(500, 33);
  }

  // ================= setup =================
  private get reduced() {
    return this.opts.forceReducedMotion || this.mq.matches;
  }

  private async loadArt() {
    const yieldFrame = () => new Promise(r => setTimeout(r, 0));
    await yieldFrame();
    if (this.destroyed) return;
    this.galaxyImg = makeGalaxy();
    gsap.to(this.galaxyFade, { v: 1, duration: 1.2 });
    for (let i = 0; i < C.nebula.clouds.length; i++) {
      await yieldFrame();
      if (this.destroyed) return;
      this.cloudImgs[i] = makeCloud(C.nebula.clouds[i].pink);
      const cl = this.clouds[i];
      if (cl) {
        cl.img = this.cloudImgs[i];
        gsap.fromTo(cl, { fade: 0 }, { fade: 1, duration: 1.2 });
      }
    }
  }

  private applyQuality() {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 1.5 : 1);
    for (const c of [this.els.canvas, this.els.fx]) {
      c.width = Math.round(this.vw * this.dpr);
      c.height = Math.round(this.vh * this.dpr);
    }
    this.bgScale = this.quality >= 1 ? 0.5 : 0.33; // galaxy + nebula render at low res (they are soft anyway)
    this.bg.width = Math.max(1, Math.ceil(this.vw * this.bgScale));
    this.bg.height = Math.max(1, Math.ceil(this.vh * this.bgScale));
  }

  private killScene() {
    this.sceneTweens.forEach(t => t.kill());
    this.sceneTweens = [];
    this.pulseTl = null;
    this.cometCall?.kill();
    this.marqueeCall?.kill();
    this.marqueeTl?.kill();
    this.marqueeTl = null;
  }

  private buildScene() {
    const root = this.els.root;
    this.killScene();
    this.islandDom = [...root.querySelectorAll<HTMLElement>('[data-island-wrap]')].map(wrap => ({
      wrap,
      body: wrap.querySelector<HTMLElement>('[data-island-body]') ?? wrap,
      label: wrap.querySelector<HTMLElement>('[data-island-label]') ?? wrap,
    }));
    if (root.clientWidth < 50 || root.clientHeight < 50) {
      this.ready = false;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => { if (!this.destroyed) this.buildScene(); });
      return;
    }
    const oldW = this.worldW, oldH = this.vh;
    this.vw = root.clientWidth;
    this.vh = root.clientHeight;
    this.applyQuality();
    this.slotR = clamp(this.vh * C.island.radius, C.island.radiusMin, C.island.radiusMax);
    // never narrower than one island column per island, so islands can't overlap on narrow screens
    const minWorld = (this.islands.length * this.slotR * C.island.widthMul * C.layout.columnWidth) / 0.8;
    this.worldW = Math.max(this.vw * this.opts.worldScreens, minWorld);
    this.slotW = this.islands.map(s => ({ x: s.x * this.worldW, y: s.y * this.vh }));
    this.islandW = this.islands.map(() => this.slotR * C.island.widthMul);
    this.islandH = this.islands.map((s, i) => this.islandW[i] * s.aspect);
    this.islandDom.forEach((d, i) => {
      const s = this.islands[i], W = this.islandW[i], H = this.islandH[i];
      if (!s) return;
      Object.assign(d.body.style, {
        width: `${W}px`, height: `${H}px`, left: `${-W / 2}px`, top: `${-H * s.anchorY}px`,
        transformOrigin: `50% ${s.anchorY * 100}%`,
      });
    });
    this.zMin = 0.15;
    const fit = this.fitAll();
    this.zMin = Math.max(fit.z, 0.15);
    if (!this.cam) {
      this.cam = { ...fit };
      this.camT = { ...fit };
    } else if (!this.warping && (oldW !== this.worldW || oldH !== this.vh)) {
      const sx = this.worldW / oldW, sy = this.vh / oldH;
      if (this.camActive()) {
        const target = { x: this.camT.x * sx, y: this.camT.y * sy, z: this.camT.z }, done = this.camDone;
        this.killCam();
        Object.assign(this.cam, this.clampCam(target));
        done?.();
      } else {
        this.cam.x *= sx;
        this.cam.y *= sy;
        Object.assign(this.cam, this.clampCam(this.cam));
      }
      this.camT = { ...this.cam };
    }
    this.buildStars();
    this.buildNebula();
    this.buildConstellations();
    this.buildMarquee();
    this.buildBelt();
    this.buildPath();
    this.buildDust();
    this.buildMotes();
    if (C.path.enabled) this.startPulse();
    this.scheduleMarquee();
    this.scheduleComet();
    this.ready = true;
  }

  // ================= camera =================
  private fitAll(): Cam {
    const cfg = C.camera;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    this.slotW.forEach((p, i) => {
      const W = this.islandW[i], H = this.islandH[i], a = this.islands[i].anchorY;
      x0 = Math.min(x0, p.x - W / 2); x1 = Math.max(x1, p.x + W / 2);
      y0 = Math.min(y0, p.y - H * a); y1 = Math.max(y1, p.y + H * (1 - a));
    });
    // margins reserve room for the side arrows (x), the top hint and the bottom HUD + labels (y)
    const mX = Math.min(cfg.fitMarginX, this.vw * 0.12), mT = Math.min(cfg.fitMarginTop, this.vh * 0.12), mB = Math.min(cfg.fitMarginBottom, this.vh * 0.25);
    const spanX = Math.max(1, x1 - x0), spanY = Math.max(1, y1 - y0);
    const z = Math.max(0.05, Math.min((this.vw - 2 * mX) / spanX, (this.vh - mT - mB) / spanY, 1));
    return this.clampCam({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 + (mB - mT) / (2 * z), z });
  }

  private clampCam(c: Cam): Cam {
    const z = clamp(c.z, this.zMin, this.zMax), hw = this.vw / (2 * z), hh = this.vh / (2 * z), W = this.worldW, H = this.vh;
    // bounds always include every island, so any island can be centred (sky layers cover the extra margin)
    const xs = this.slotW.map(p => p.x), ys = this.slotW.map(p => p.y);
    const x0 = Math.min(hw, W - hw, ...xs), x1 = Math.max(hw, W - hw, ...xs);
    const y0 = Math.min(hh, H - hh, ...ys), y1 = Math.max(hh, H - hh, ...ys);
    return { x: clamp(c.x, x0, x1), y: clamp(c.y, y0, y1), z };
  }

  private camActive() {
    return !!this.camTween && this.camTween.isActive();
  }

  private activeTarget(): Cam {
    return this.camActive() || !this.cam ? { ...this.camT } : { ...this.cam };
  }

  private killCam() {
    this.camTween?.kill();
    this.camTween = null;
    this.camDone = undefined;
    this.endFlight();
  }

  private cancelIntro() {
    this.introCall?.kill();
    this.introCall = null;
  }

  private camTo(t: Cam, dur?: number, ease?: string, onDone?: () => void) {
    if (!this.cam) return;
    const c = this.clampCam(t);
    this.killCam();
    this.camT = c;
    this.camDone = onDone;
    this.camTween = gsap.to(this.cam, {
      x: c.x, y: c.y, z: c.z, duration: dur ?? C.camera.moveDuration, ease: ease ?? C.camera.moveEase, onComplete: onDone,
    });
  }

  private zoomAt(sx: number, sy: number, z: number, base?: Cam) {
    const b = base ?? this.activeTarget(), nz = clamp(z, this.zMin, this.zMax);
    const wx = b.x + (sx - this.vw / 2) / b.z, wy = b.y + (sy - this.vh / 2) / b.z;
    this.camTo({ x: wx - (sx - this.vw / 2) / nz, y: wy - (sy - this.vh / 2) / nz, z: nz });
  }

  private flyNav(j: number) {
    if (C.path.enabled) return this.flyPath(j);
    if (j < 0 || !this.slotW[j]) return;
    this.flyTo(j);
    const done = this.camDone;
    this.camDone = () => {
      done?.();
      gsap.fromTo(this.flash[j], { v: 1 }, { v: 0, duration: 1.4, ease: 'power2.out' });
    };
    this.camTween?.eventCallback('onComplete', this.camDone);
  }

  // prev / next: the camera travels along the constellation path, the light pulse rides with it
  private flyPath(j: number) {
    const cam = this.cam;
    if (this.warping || j < 0 || !this.slotW[j] || !cam) return;
    const s = this.slotW[j], z1 = clamp(Math.max(this.activeTarget().z, 1), this.zMin, this.zMax);
    this.cancelIntro();
    this.killCam();
    this.vel = { x: 0, y: 0 };
    const d0 = this.nearestD(cam.x), d1 = this.slotD[j], fl = { d: d0, z: cam.z };
    this.flying = true;
    this.pulseTl?.pause();
    this.pulse.d = d0;
    this.pulse.dir = Math.sign(d1 - d0) || 1;
    gsap.to(this.pulse, { a: 1, duration: 0.25, overwrite: 'auto' });
    this.camT = this.clampCam({ x: s.x, y: s.y, z: z1 });
    this.camDone = () => {
      this.currentIsland = j;
      this.endFlight();
    };
    this.camTween = gsap.to(fl, {
      d: d1, z: z1, duration: clamp(Math.abs(d1 - d0) / 1100, 0.8, 1.6), ease: 'power2.inOut',
      onUpdate: () => {
        const p = this.pointAt(fl.d);
        Object.assign(cam, this.clampCam({ x: p.x, y: p.y, z: fl.z }));
        this.pulse.d = fl.d;
      },
      onComplete: () => {
        this.currentIsland = j;
        this.endFlight();
        gsap.fromTo(this.flash[j], { v: 1 }, { v: 0, duration: 1.4, ease: 'power2.out' });
      },
    });
  }

  private endFlight() {
    if (!this.flying) return;
    this.flying = false;
    gsap.to(this.pulse, {
      a: 0, duration: 0.4, overwrite: 'auto',
      onComplete: () => { if (!this.flying && this.pulseTl) this.pulseTl.restart(); },
    });
  }

  private nearestD(x: number) {
    let best = this.dense[0], bd = Infinity;
    for (const p of this.dense) {
      const d = Math.abs(p.x - x);
      if (d < bd) { bd = d; best = p; }
    }
    return best.d;
  }

  // screen transform for a layer: sx = x * s + ox
  private proj(L: LayerDef): Proj {
    const c = this.cam ?? this.camT, s = Math.pow(c.z, L.d), m = this.reduced ? 0 : C.mouseParallax;
    const cfx = c.x * L.f + (this.vw / 2) * (1 - L.f), cfy = c.y * L.f + (this.vh / 2) * (1 - L.f);
    return { s, ox: this.vw / 2 - cfx * s + this.mouse.x * m * L.f, oy: this.vh / 2 - cfy * s + this.mouse.y * m * 0.6 * L.f };
  }

  // area of a layer that can ever be on screen (at min zoom, anywhere on the map)
  private extent(L: LayerDef): Extent {
    const sMin = Math.pow(this.zMin, L.d), f = L.f, hw = this.vw / (2 * sMin) + 60, hh = this.vh / (2 * sMin) + 60;
    const c0 = (this.vw / 2) * (1 - f), c1 = this.worldW * f + (this.vw / 2) * (1 - f);
    return { x0: c0 - hw, x1: c1 + hw, y0: this.vh / 2 - hh, y1: this.vh / 2 + hh, core0: c0 - this.vw / 2, core1: c1 + this.vw / 2 };
  }

  private bob(i: number) {
    return this.reduced ? 0 : Math.sin(this.t * 0.9 + i * 1.3) * this.islandH[i] * C.island.bob;
  }

  // ================= scene builders =================
  private buildStars() {
    const dens = this.opts.starDensity, tw = this.reduced ? C.stars.twinkleReduced : C.stars.twinkle;
    this.starLayers = C.stars.layers.map(L => {
      const e = this.extent(L), stars: Star[] = [];
      const n = safeCount((L.count * dens * ((e.x1 - e.x0) * (e.y1 - e.y0))) / (1440 * 900), 4000);
      for (let i = 0; i < n; i++) {
        const u = Math.random(), kind: Kind = u < L.gold ? 'gold' : u < L.gold + L.cyan ? 'cyan' : 'white';
        stars.push({
          x: rand(e.x0, e.x1), y: rand(e.y0, e.y1), r: kind === 'gold' ? rand(2.2, 3.4) : rand(...L.size),
          a: rand(...L.alpha), kind, sp: rand(...tw), ph: rand(0, 6.28),
        });
      }
      return { L, stars };
    });
  }

  private buildNebula() {
    const e = this.extent(C.layers.nebula), [b0, b1] = C.nebula.breathSeconds;
    this.clouds = C.nebula.clouds.map((c, i) => {
      const img = this.cloudImgs[i] ?? null;
      const cl: Cloud = { img, fade: img ? 1 : 0, x: e.core0 + c.x * (e.core1 - e.core0), y: c.y * this.vh, size: c.size * this.vh, alpha: c.alpha, b: 0, ph: rand(0, 6.28) };
      this.sceneTweens.push(gsap.to(cl, { b: 1, duration: rand(b0, b1), yoyo: true, repeat: -1, ease: 'sine.inOut', delay: -rand(0, b1) }));
      return cl;
    });
    const ge = this.extent(C.layers.galaxy);
    this.galaxy = { x: ge.core0 + C.galaxy.x * (ge.core1 - ge.core0), y: C.galaxy.y * this.vh, size: C.galaxy.size * this.vh };
  }

  private buildConstellations() {
    const e = this.extent(C.layers.constellations);
    this.constellations = C.constellations.map(k => {
      const shp = SHAPES[k.shape](), cs = Math.cos(k.rot), sn = Math.sin(k.rot), cx = e.core0 + k.x * (e.core1 - e.core0);
      const pts = shp.pts.map(([x, y]) => ({ x: cx + (x * cs - y * sn) * k.size, y: k.y * this.vh + (x * sn + y * cs) * k.size, ph: rand(0, 6.28) }));
      return { pts, lines: shp.lines };
    });
  }

  private buildMarquee() {
    const e = this.extent(C.layers.marquee), sp = e.core1 - e.core0, n = C.marquee.groups;
    this.marquee = [];
    for (let i = 0; i < n; i++) {
      const cx = e.core0 + ((i + 0.5) / n + rand(-0.3, 0.3) / n) * sp, cy = rand(0.12, 0.88) * this.vh;
      const count = Math.round(rand(...C.marquee.bulbs)), arc = Math.random() < 0.6, rad = rand(34, 52), a0 = rand(0, 6.28), ang = rand(0, 3.14);
      const bulbs: Bulb[] = [];
      for (let j = 0; j < count; j++) {
        const u = j / (count - 1);
        const p = arc
          ? { x: cx + Math.cos(a0 + u * 2.4) * rad, y: cy + Math.sin(a0 + u * 2.4) * rad }
          : { x: cx + Math.cos(ang) * (u - 0.5) * count * 11, y: cy + Math.sin(ang) * (u - 0.5) * count * 11 };
        bulbs.push({ ...p, on: 0, color: j % 2 ? C.colors.pink : C.colors.gold });
      }
      this.marquee.push({ cx, cy, bulbs });
    }
  }

  private buildBelt() {
    const S = this.sprites;
    this.belt = [];
    for (let i = 0; i < C.belt.count; i++) {
      const coin = Math.random() < 0.5;
      this.belt.push({
        u: Math.random(), off: gauss() * C.belt.width, s: rand(4, 10), img: coin ? S.coin : S.chips[i % 3],
        rot: rand(0, 6.28), rs: rand(-0.4, 0.4), spin: rand(0, 6.28), ss: rand(0.6, 1.8) * (coin ? 1 : 0.4), du: rand(0.004, 0.01),
      });
    }
  }

  private beltPos(it: BeltItem): Pt {
    const B = C.belt, u = it.u;
    return { x: (B.from + (B.to - B.from) * u) * this.worldW, y: this.vh * (B.y0 + (B.y1 - B.y0) * u + Math.sin(u * Math.PI * 2) * B.amp) + it.off };
  }

  private buildPath() {
    const P = this.slotW, N = 60, R = this.slotR, dense: DensePt[] = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? P[i + 1];
      for (let k = 0; k < N; k++) dense.push({ ...catmull(p0, p1, p2, p3, k / N), d: 0 });
    }
    dense.push({ ...P[P.length - 1], d: 0 });
    let L = 0;
    for (let i = 1; i < dense.length; i++) {
      L += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
      dense[i].d = L;
    }
    this.dense = dense;
    this.pathLen = L;
    this.slotD = P.map((_, i) => dense[i * N].d);
    this.segs = [];
    for (let i = 0; i < P.length - 1; i++) {
      const d0 = this.slotD[i] + R + 8, d1 = this.slotD[i + 1] - R - 8, m = Math.max(1, Math.round((d1 - d0) / C.path.nodeSpacing));
      const nodes: PathNode[] = [];
      for (let j = 0; j <= m; j++) {
        const d = d0 + ((d1 - d0) * j) / m, p = this.pointAt(d), q = this.pointAt(d + 1);
        const nx = -(q.y - p.y), ny = q.x - p.x, nl = Math.hypot(nx, ny) || 1, jit = j === 0 || j === m ? 0 : rand(-8, 8);
        nodes.push({ x: p.x + (nx / nl) * jit, y: p.y + (ny / nl) * jit, d, big: j > 0 && j < m && Math.random() < 0.3, ph: rand(0, 6.28) });
      }
      this.segs.push({ nodes });
    }
  }

  private pointAt(d: number): Pt {
    const a = this.dense;
    let lo = 0, hi = a.length - 1;
    if (d <= 0) return a[0];
    if (d >= a[hi].d) return a[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid].d < d) lo = mid;
      else hi = mid;
    }
    const t = (d - a[lo].d) / (a[hi].d - a[lo].d || 1);
    return { x: a[lo].x + (a[hi].x - a[lo].x) * t, y: a[lo].y + (a[hi].y - a[lo].y) * t };
  }

  private buildDust() {
    const col = C.colors, e = this.extent(C.layers.dust), n = safeCount((C.dust.perScreen * (e.x1 - e.x0)) / this.vw, 200);
    this.dustExt = e;
    this.dust = [];
    for (let i = 0; i < n; i++) {
      this.dust.push({
        x: rand(e.x0, e.x1), y: rand(e.y0, e.y1), r: rand(14, 46), c: [col.violet, col.pink, col.cyan, col.white][i % 4],
        a: rand(0.05, 0.12), vx: rand(-6, 6), vy: rand(-4, 4),
      });
    }
  }

  // cosmic dust around each island: motes orbit it (half behind, half in front) and sparkles rise from it
  private buildMotes() {
    const col = C.colors;
    this.motes = this.islands.map((s, i) => {
      const W = this.islandW[i], H = this.islandH[i], dir = i % 2 ? 1 : -1;
      return Array.from({ length: C.island.motes }, () => ({
        ang: rand(0, 6.283), speed: rand(0.15, 0.4) * dir, rx: W * rand(0.42, 0.64), ry: W * rand(0.07, 0.15),
        h: H * rand(-0.3, 0.12), size: rand(0.8, 1.8), color: pick([s.color, s.color, s.accent, col.white, col.gold]), ph: rand(0, 6.28),
      }));
    });
    this.sparks = this.islands.map((s, i) => Array.from({ length: C.island.sparkles }, () => this.newSpark(s, i, true)));
  }

  private newSpark(s: IslandDef, i: number, randomAge: boolean): Spark {
    const W = this.islandW[i], H = this.islandH[i], life = rand(2.5, 5);
    return {
      x: W * rand(-0.36, 0.36), y0: H * rand(-0.05, 0.15), rise: H * rand(0.25, 0.5), life, t: randomAge ? rand(0, life) : 0,
      size: rand(0.8, 1.6), color: pick([s.color, C.colors.gold, C.colors.white]),
    };
  }

  // clear zone around islands (belt: world coords, dust/marquee: screen coords)
  private clearWorld(x: number, y: number) {
    const R0 = this.slotR * C.clearRadius;
    let m = 1;
    for (const p of this.slotW) {
      const d = Math.hypot(x - p.x, y - p.y - this.slotR * 0.35);
      if (d < R0 * 1.4) m = Math.min(m, smooth((d - R0) / (R0 * 0.4)));
    }
    return m;
  }

  private clearScreen(x: number, y: number) {
    const z = this.cam?.z ?? 1, R0 = this.slotR * z * C.clearRadius;
    let m = 1;
    for (const p of this.slotPos) {
      const d = Math.hypot(x - p.x, y - p.y - this.slotR * z * 0.35);
      if (d < R0 * 1.4) m = Math.min(m, smooth((d - R0) / (R0 * 0.4)));
    }
    return m;
  }

  // ================= timed events =================
  private startPulse() {
    const R = this.slotR, travel = C.path.pulseTravel * (this.reduced ? 2 : 1);
    const tl = gsap.timeline({ repeat: -1 });
    for (let i = 0; i < this.islands.length - 1; i++) {
      tl.set(this.pulse, { d: this.slotD[i] + R * 0.6, a: 0, dir: 1 });
      tl.to(this.pulse, { a: 1, duration: 0.4, ease: 'sine.out' });
      tl.to(this.pulse, { d: this.slotD[i + 1] - R * 0.6, duration: travel, ease: 'sine.inOut' }, '<');
      tl.to(this.pulse, { a: 0, duration: 0.35 }, '-=0.3');
      tl.fromTo(this.flash[i + 1], { v: 1 }, { v: 0, duration: 1.4, ease: 'power2.out' }, '<');
      tl.to({}, { duration: C.path.pulseGap });
    }
    this.pulseTl = tl;
    this.sceneTweens.push(tl);
    if (this.flying) tl.pause();
  }

  private scheduleMarquee() {
    this.marqueeCall = gsap.delayedCall(rand(...C.marquee.delay), () => {
      this.playMarquee();
      this.scheduleMarquee();
    });
  }

  private playMarquee() {
    if (!this.marquee.length) return;
    const P = this.proj(C.layers.marquee);
    const vis = this.marquee.filter(g => {
      const x = g.cx * P.s + P.ox, y = g.cy * P.s + P.oy;
      return x > 40 && x < this.vw - 40 && y > 40 && y < this.vh - 40;
    });
    const b = pick(vis.length ? vis : this.marquee).bulbs, tl = gsap.timeline();
    this.marqueeTl?.kill();
    this.marqueeTl = tl;
    if (this.reduced) {
      tl.to(b, { on: 0.6, duration: 2.5, ease: 'sine.inOut', yoyo: true, repeat: 1 });
      return;
    }
    const lap = b.length * 0.09 + 0.2;
    for (let rep = 0; rep < 3; rep++) {
      b.forEach((bulb, j) => {
        const at = rep * lap + j * 0.09;
        tl.to(bulb, { on: 1, duration: 0.06 }, at);
        tl.to(bulb, { on: 0, duration: 0.4 }, at + 0.1);
      });
    }
    tl.to(b, { on: 1, duration: 0.12 }, '+=0.1');
    tl.to(b, { on: 0, duration: 0.9, ease: 'power2.out' }, '+=0.2');
  }

  private scheduleComet() {
    if (this.reduced) return;
    this.cometCall = gsap.delayedCall(rand(...C.comets.delay), () => {
      this.launchComet();
      this.scheduleComet();
    });
  }

  private launchComet() {
    if (this.warping) return;
    const dir = Math.random() < 0.5 ? 1 : -1, ang = rand(0.25, 0.6);
    const c: Comet = {
      x: rand(0.15, 0.85) * this.vw, y: rand(-0.05, 0.35) * this.vh, dx: Math.cos(ang) * dir, dy: Math.sin(ang),
      dist: rand(0.45, 0.8) * this.vw, tail: rand(140, 260), p: 0,
    };
    this.comet = c;
    gsap.to(c, { p: 1, duration: rand(...C.comets.duration), ease: 'power1.in', onComplete: () => { if (this.comet === c) this.comet = null; } });
  }

  // ================= input (pointer events: mouse, touch, pen) =================
  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.els.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private startPinch() {
    const cam = this.cam;
    if (!cam) return;
    const [a, b] = [...this.pointers.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = {
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z,
      wx: cam.x + (mid.x - this.vw / 2) / cam.z, wy: cam.y + (mid.y - this.vh / 2) / cam.z,
    };
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.warping || e.button > 0 || (e.target as Element | null)?.closest('[data-ui]')) return;
    this.cancelIntro();
    this.killCam();
    this.vel = { x: 0, y: 0 };
    this.pointerDown = true;
    this.dragMoved = false;
    this.els.root.focus({ preventScroll: true });
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.last = { ...p, t: performance.now() };
      this.downAt = p;
    }
    if (this.pointers.size === 2) {
      this.startPinch();
      this.dragMoved = true;
      this.disarm();
    }
    this.els.root.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent) => {
    const cam = this.cam;
    const p = this.local(e);
    if (e.pointerType !== 'touch') {
      this.pointer = p;
      this.mouseT = { x: clamp(p.x / this.vw - 0.5, -0.5, 0.5) * 2, y: clamp(p.y / this.vh - 0.5, -0.5, 0.5) * 2 };
    }
    if (!this.pointers.has(e.pointerId) || !cam) return;
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = clamp((this.pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.d0, this.zMin, this.zMax);
      Object.assign(cam, this.clampCam({ x: this.pinch.wx - (mid.x - this.vw / 2) / z, y: this.pinch.wy - (mid.y - this.vh / 2) / z, z }));
      return;
    }
    if (!this.dragging) return;
    const now = performance.now(), dtm = Math.max(1, now - this.last.t), z = cam.z;
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    Object.assign(cam, this.clampCam({ x: cam.x - dx / z, y: cam.y - dy / z, z }));
    this.vel = { x: 0.8 * ((-dx / z / dtm) * 1000) + 0.2 * this.vel.x, y: 0.8 * ((-dy / z / dtm) * 1000) + 0.2 * this.vel.y };
    this.last = { ...p, t: now };
    if (!this.dragMoved && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 6) {
      this.dragMoved = true;
      this.disarm();
      try { this.els.root.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      const p = [...this.pointers.values()][0];
      this.last = { ...p, t: performance.now() };
      this.pinch = null;
      this.vel = { x: 0, y: 0 };
      return;
    }
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.pinch = null;
      this.pointerDown = false;
      this.els.root.style.cursor = 'grab';
      setTimeout(() => { this.dragMoved = false; }, 0); // after the click that follows this pointerup
      if (performance.now() - this.last.t > 80) this.vel = { x: 0, y: 0 };
      if (this.cam) this.camT = { ...this.cam };
    }
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') {
      this.pointer = null;
      this.mouseT = { x: 0, y: 0 };
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.entered || (e.target as Element | null)?.closest('[data-ui]')) return;
    e.preventDefault();
    if (this.warping || !this.cam) return;
    this.cancelIntro();
    this.disarm();
    this.vel = { x: 0, y: 0 };
    const b = this.activeTarget(), p = this.local(e), unit = e.deltaMode === 1 ? 16 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey) return this.zoomAt(p.x, p.y, b.z * Math.exp(-dy * 0.01), b); // trackpad pinch
    if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) { // shift+wheel / horizontal swipe = pan
      const d = e.shiftKey ? dx || dy : dx;
      return this.camTo({ x: b.x + d / b.z, y: b.y, z: b.z });
    }
    this.zoomAt(p.x, p.y, b.z * Math.exp(-dy * C.camera.wheelZoom), b); // wheel = zoom at cursor
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { void this.returnToMap(); return; }
    if (this.entered) return; // the open game owns the keyboard
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const el = e.target as HTMLElement | null;
    if (el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable)) return;
    if (e.key === 'd' || e.key === 'D') { this.toggleDebug(); return; }
    if (this.warping || !this.cam) return;
    const b = this.activeTarget(), step = C.camera.keyStep;
    const move = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as Record<string, [number, number]>)[e.key];
    if (move) {
      e.preventDefault();
      this.cancelIntro();
      this.disarm();
      this.vel = { x: 0, y: 0 };
      this.camTo({ x: b.x + (move[0] * this.vw * step) / b.z, y: b.y + (move[1] * this.vh * step) / b.z, z: b.z });
      return;
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomBy(C.camera.buttonZoom); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); this.zoomBy(1 / C.camera.buttonZoom); return; }
    if (e.key === '0') { e.preventDefault(); this.viewAll(); }
  };

  // only rebuild when the size really changed; never interrupts camera moves
  private onResize = () => {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const r = this.els.root;
      if (!this.destroyed && (r.clientWidth !== this.vw || r.clientHeight !== this.vh)) this.buildScene();
    }, 200);
  };

  // Hidden tabs stop requestAnimationFrame, which already pauses GSAP and rendering. The global
  // timeline is never paused (a paused timeline froze every camera tween in embedded frames).
  private onVisibility = () => {
    if (document.hidden) return;
    gsap.ticker.wake();
    if (gsap.globalTimeline.paused()) gsap.globalTimeline.resume();
    this.lastTick = performance.now();
  };

  private onMotionPref = () => this.buildScene();

  /** The map layer must never scroll: the camera does the panning. */
  /** Dragging, zooming or key-panning means the teacher is looking around, not entering. */
  private disarm = () => { this.armed = null; };

  private onRootScroll = () => {
    const root = this.els.root;
    if (root.scrollLeft || root.scrollTop) {
      root.scrollLeft = 0;
      root.scrollTop = 0;
    }
  };

  private bind() {
    const root = this.els.root;
    root.addEventListener('scroll', this.onRootScroll, { passive: true });
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('pointercancel', this.onPointerUp);
    root.addEventListener('pointerleave', this.onPointerLeave);
    root.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.mq.addEventListener('change', this.onMotionPref);
  }

  private unbind() {
    const root = this.els.root;
    root.removeEventListener('scroll', this.onRootScroll);
    root.removeEventListener('pointerdown', this.onPointerDown);
    root.removeEventListener('pointermove', this.onPointerMove);
    root.removeEventListener('pointerup', this.onPointerUp);
    root.removeEventListener('pointercancel', this.onPointerUp);
    root.removeEventListener('pointerleave', this.onPointerLeave);
    root.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.mq.removeEventListener('change', this.onMotionPref);
  }

  // ================= frame loop =================
  private tick = (_time: number, dms: number) => {
    if (this.destroyed || !this.ready || !this.vw || !this.cam) return;
    const dt = Math.min(dms / 1000, 0.05);
    this.lastTick = performance.now();
    this.t += dt;
    this.frameN++;
    if (dms < 1000) this.ema += (dms - this.ema) * 0.05;
    this.update(dt, this.cam);
    this.draw();
    if (this.frameN === 2) {
      const el = this.els.loader;
      gsap.to(el, { opacity: 0, duration: 0.6, onComplete: () => { el.style.display = 'none'; } });
    }
    // adaptive quality: lower the resolution if frames stay slow
    if (this.quality > 0 && this.frameN > 30 && !document.hidden) {
      this.slowFrames = this.ema > 28 ? this.slowFrames + 1 : 0;
      if (this.slowFrames > 45) {
        this.quality--;
        this.slowFrames = 0;
        this.ema = 16;
        this.applyQuality();
      }
    }
    if (this.debug && this.frameN % 8 === 0) this.updateDebug();
  };

  private update(dt: number, cam: Cam) {
    const red = this.reduced;
    // drag inertia
    if (!this.dragging && !this.warping && !this.camActive() && (this.vel.x || this.vel.y)) {
      const nx = cam.x + this.vel.x * dt, ny = cam.y + this.vel.y * dt, c = this.clampCam({ x: nx, y: ny, z: cam.z });
      if (c.x !== nx) this.vel.x = 0;
      if (c.y !== ny) this.vel.y = 0;
      Object.assign(cam, c);
      const k = Math.pow(C.camera.friction, dt);
      this.vel.x *= k;
      this.vel.y *= k;
      if (Math.hypot(this.vel.x, this.vel.y) < 3) this.vel = { x: 0, y: 0 };
    }
    const mt = red ? { x: 0, y: 0 } : this.mouseT, me = 1 - Math.exp(-3 * dt);
    this.mouse.x += (mt.x - this.mouse.x) * me;
    this.mouse.y += (mt.y - this.mouse.y) * me;
    const P = this.proj(C.layers.path), he = 1 - Math.exp(-6 * dt), hr = C.hover.radius * clamp(cam.z, 0.6, 1.4);
    this.anyHover = false;
    this.slotW.forEach((w, i) => {
      const p = this.slotPos[i];
      p.x = w.x * P.s + P.ox;
      p.y = w.y * P.s + P.oy;
      // hover = near the anchor OR anywhere over the island art's on-screen box
      const pt = this.pointer, a = this.islands[i].anchorY, by = p.y + this.bob(i) * cam.z;
      const hw = (this.islandW[i] * cam.z) / 2, ih = this.islandH[i] * cam.z;
      const inBox = !!pt && Math.abs(pt.x - p.x) <= hw && pt.y >= by - ih * a && pt.y <= by + ih * (1 - a);
      const near = !!pt && !this.dragging && (Math.hypot(pt.x - p.x, pt.y - p.y) < hr || inBox);
      this.hov[i] += ((!this.warping && (near || this.focusSlot === i) ? 1 : 0) - this.hov[i]) * he;
      if (this.hov[i] > 0.01) this.anyHover = true;
    });
    const bs = red ? 0.3 : 1;
    for (const it of this.belt) {
      it.u += it.du * dt * bs;
      if (it.u > 1) it.u -= 1;
      if (!red) { it.rot += it.rs * dt; it.spin += it.ss * dt; }
    }
    const e = this.dustExt;
    for (const d of this.dust) {
      d.x += d.vx * dt * bs;
      d.y += d.vy * dt * bs;
      if (d.x < e.x0) d.x = e.x1;
      if (d.x > e.x1) d.x = e.x0;
      if (d.y < e.y0) d.y = e.y1;
      if (d.y > e.y1) d.y = e.y0;
    }
    this.motes.forEach(list => { for (const m of list) m.ang += m.speed * dt * bs; });
    this.sparks.forEach((list, i) => {
      list.forEach((s, k) => {
        s.t += dt * (red ? 0.4 : 1);
        if (s.t > s.life) list[k] = this.newSpark(this.islands[i], i, false);
      });
    });
    // leaving the focused island (by drag / zoom / keys) clears currentIsland
    if (this.currentIsland != null && !this.camActive() && !this.warping) {
      const s = this.slotW[this.currentIsland];
      if (Math.hypot(cam.x - s.x, cam.y - s.y) * cam.z > Math.min(this.vw, this.vh) * 0.22 || cam.z <= this.zMin * 1.02) this.currentIsland = null;
    }
    if (!this.warping) {
      const { pi, ni } = this.navTargets();
      if (pi !== this.lastNav.pi || ni !== this.lastNav.ni) {
        this.lastNav = { pi, ni };
        this.cb.onNav(pi, ni);
      }
    }
    const focus = this.warping || this.entered ? -1 : this.armed ?? -1;
    if (focus !== this.lastFocus) {
      this.lastFocus = focus;
      this.cb.onFocusChange(focus);
    }
  }

  // live prev/next targets (also used on click, so they never depend on a pending React render)
  private navTargets() {
    const n = this.slotW.length, ci = this.currentIsland, cam = this.cam ?? this.camT;
    let pi = -1, ni = -1;
    if (ci != null) {
      pi = ci - 1;
      ni = ci + 1 < n ? ci + 1 : -1;
    } else if (cam.z <= this.zMin * 1.05) {
      pi = 0; // View all: arrows go to the first / last island
      ni = n - 1;
    } else {
      const tol = 30 / cam.z;
      this.slotW.forEach((w, i) => {
        if (w.x < cam.x - tol) pi = i;
        if (ni < 0 && w.x > cam.x + tol) ni = i;
      });
    }
    return { pi, ni };
  }

  private hoverBoost(x: number, y: number) {
    let b = 0;
    const R = C.hover.starRadius;
    for (let i = 0; i < this.hov.length; i++) {
      if (this.hov[i] > 0.01) {
        const p = this.slotPos[i];
        b += this.hov[i] * Math.max(0, 1 - Math.hypot(x - p.x, y - p.y) / R);
      }
    }
    return Math.min(b, 1);
  }

  private updateDebug() {
    const el = this.els.debug, c = this.cam;
    if (!c) return;
    const S = this.islands, ci = this.currentIsland, nav = this.navTargets();
    const name = (i: number) => (i >= 0 && S[i] ? S[i].label : '—');
    const motion = this.warping ? 'warp' : this.camActive() ? 'tween' : this.dragging ? 'drag' : this.vel.x || this.vel.y ? 'inertia' : 'idle';
    el.textContent = [
      `zoom     ${c.z.toFixed(3)}   (min ${this.zMin.toFixed(3)}, max ${this.zMax})`,
      `camera   x ${c.x.toFixed(0)}   y ${c.y.toFixed(0)}   world ${Math.round(this.worldW)}×${this.vh}`,
      `island   ${ci == null ? (c.z <= this.zMin * 1.05 ? 'null (View all)' : 'null') : S[ci].label}`,
      `arrows   ← ${name(nav.pi)}   → ${name(nav.ni)}`,
      `motion   ${motion}   warp t ${this.warp.t.toFixed(2)}`,
      `render   ${(1000 / Math.max(1, this.ema)).toFixed(0)} fps   quality ${this.quality}   dpr ${this.dpr}`,
      `stars    ${this.starLayers.reduce((a, l) => a + l.stars.length, 0)}   frame ${this.frameN}`,
      'press D to hide',
    ].join('\n');
  }

  // ================= drawing =================
  private draw() {
    const ctx = this.ctx, fx = this.fxCtx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.clearRect(0, 0, this.vw, this.vh);
    const b = this.bgCtx, bs = this.bgScale;
    b.setTransform(bs, 0, 0, bs, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, this.vw, this.vh);
    b.globalCompositeOperation = 'lighter';
    this.drawGalaxy(b);
    this.drawNebula(b);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, this.vw, this.vh);
    this.drawConstellations();
    this.starLayers.forEach((SL, i) => {
      this.drawStars(SL);
      if (i === 1) this.drawMarquee();
    });
    if (this.comet) this.drawComet(this.comet);
    ctx.globalCompositeOperation = 'source-over';
    this.drawBelt();
    ctx.globalCompositeOperation = 'lighter';
    this.drawPath();
    this.drawMotes(ctx, false);
    this.drawDust();
    this.drawWarpFX();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    fx.globalCompositeOperation = 'lighter';
    this.drawMotes(fx, true);
    fx.globalAlpha = 1;
    fx.globalCompositeOperation = 'source-over';
    this.updateDom();
  }

  private updateDom() {
    const cam = this.cam;
    if (!cam) return;
    const z = cam.z, op = 1 - this.warp.hide, vis = op < 0.01 ? 'hidden' : 'visible';
    this.islandDom.forEach((d, i) => {
      const p = this.slotPos[i], s = this.islands[i];
      if (!p || !s) return;
      const sc = z * (1 + this.hov[i] * 0.05);
      d.wrap.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
      d.wrap.style.opacity = String(op);
      d.wrap.style.visibility = vis;
      d.body.style.transform = `translateY(${this.bob(i) * z}px) scale(${sc})`;
      // labels shrink a little when zoomed far out so neighbours don't collide
      d.label.style.transform = `translate(-50%,${this.islandH[i] * (1 - s.anchorY) * sc + 6}px) scale(${clamp(z * 1.5, 0.62, 1)})`;
    });
    const mv = this.miniView;
    if (mv) {
      const W = this.worldW, H = this.vh;
      const l = clamp((cam.x - this.vw / (2 * z)) / W, 0, 1), r = clamp((cam.x + this.vw / (2 * z)) / W, 0, 1);
      const t = clamp((cam.y - H / (2 * z)) / H, 0, 1), bt = clamp((cam.y + H / (2 * z)) / H, 0, 1);
      mv.style.left = `${l * 100}%`;
      mv.style.width = `${(r - l) * 100}%`;
      mv.style.top = `${t * 100}%`;
      mv.style.height = `${(bt - t) * 100}%`;
    }
  }

  private drawGalaxy(ctx: CanvasRenderingContext2D) {
    if (!this.galaxyImg) return;
    const P = this.proj(C.layers.galaxy), g = this.galaxy, s = g.size * P.s;
    ctx.save();
    ctx.globalAlpha = C.galaxy.opacity * this.galaxyFade.v;
    ctx.translate(g.x * P.s + P.ox, g.y * P.s + P.oy);
    ctx.rotate(C.galaxy.tilt);
    ctx.scale(1, 0.46);
    ctx.rotate((this.t * Math.PI * 2) / C.galaxy.rotationSeconds);
    ctx.drawImage(this.galaxyImg, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  private drawNebula(ctx: CanvasRenderingContext2D) {
    const P = this.proj(C.layers.nebula);
    for (const c of this.clouds) {
      if (!c.img || !c.fade) continue;
      const s = c.size * P.s * (1 + 0.08 * c.b);
      const x = (c.x + Math.sin(this.t * 0.03 + c.ph) * 40) * P.s + P.ox, y = (c.y + Math.cos(this.t * 0.025 + c.ph) * 20) * P.s + P.oy;
      if (x + s / 2 < 0 || x - s / 2 > this.vw) continue;
      ctx.globalAlpha = c.alpha * (0.8 + 0.3 * c.b) * c.fade;
      ctx.drawImage(c.img, x - s / 2, y - s / 2, s, s);
    }
  }

  private drawConstellations() {
    const ctx = this.ctx, P = this.proj(C.layers.constellations), S = this.sprites.glow(C.colors.white);
    ctx.strokeStyle = C.colors.white;
    ctx.lineWidth = 0.8;
    for (const k of this.constellations) {
      const x0 = k.pts[0].x * P.s + P.ox;
      if (x0 < -250 || x0 > this.vw + 250) continue;
      ctx.globalAlpha = 0.09 * (1 - this.warp.t);
      ctx.beginPath();
      for (const [a, b] of k.lines) {
        ctx.moveTo(k.pts[a].x * P.s + P.ox, k.pts[a].y * P.s + P.oy);
        ctx.lineTo(k.pts[b].x * P.s + P.ox, k.pts[b].y * P.s + P.oy);
      }
      ctx.stroke();
      for (const p of k.pts) {
        ctx.globalAlpha = (0.3 + 0.1 * Math.sin(this.t * 0.5 + p.ph)) * (1 - this.warp.t);
        ctx.drawImage(S, p.x * P.s + P.ox - 5, p.y * P.s + P.oy - 5, 10, 10);
      }
    }
  }

  private drawStars(SL: StarLayer) {
    const ctx = this.ctx, P = this.proj(SL.L), t = this.t, w = this.warp.t, S = this.sprites, col = C.colors;
    const sz = clamp(Math.sqrt(P.s), 0.6, 1.5), vw = this.vw, vh = this.vh, wc = this.slotPos[this.warp.slot];
    if (w > 0.01) ctx.lineCap = 'round';
    const stride = this.quality === 0 ? 2 : 1;
    for (let si = 0; si < SL.stars.length; si += stride) {
      const s = SL.stars[si], x = s.x * P.s + P.ox, y = s.y * P.s + P.oy;
      if (w <= 0.01 && (x < -30 || x > vw + 30 || y < -30 || y > vh + 30)) continue;
      let a = s.a * (0.62 + 0.38 * Math.sin(t * s.sp + s.ph)), k = 1;
      if (this.anyHover) {
        const b = this.hoverBoost(x, y);
        a += b * 0.9;
        k += b * 0.7;
      }
      if (w > 0.01) { // warp: long streaks pointing at the clicked island
        const dx = x - wc.x, dy = y - wc.y, hx = wc.x + dx * (1 + w * 1.4), hy = wc.y + dy * (1 + w * 1.4), len = w * (0.9 + SL.L.f * 0.4);
        const tx = hx - dx * len, ty = hy - dy * len;
        if (Math.max(hx, tx) < -10 || Math.min(hx, tx) > vw + 10 || Math.max(hy, ty) < -10 || Math.min(hy, ty) > vh + 10) continue;
        ctx.globalAlpha = Math.min(1, a + w * 0.6);
        ctx.strokeStyle = s.kind === 'white' ? col.white : s.kind === 'cyan' ? col.cyan : col.gold;
        ctx.lineWidth = Math.max(0.8, s.r * (1 + w));
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        continue;
      }
      ctx.globalAlpha = Math.min(1, a);
      if (s.kind === 'gold') {
        const d = s.r * 9 * k * sz * (0.85 + 0.15 * Math.sin(t * 1.3 + s.ph));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 0.15 + s.ph);
        ctx.drawImage(S.sparkle, -d / 2, -d / 2, d, d);
        ctx.restore();
      } else {
        const d = s.r * 7 * k * sz;
        ctx.drawImage(S.glow(s.kind === 'cyan' ? col.cyan : col.white), x - d / 2, y - d / 2, d, d);
      }
    }
  }

  private drawMarquee() {
    const ctx = this.ctx, P = this.proj(C.layers.marquee), fade = 1 - this.warp.t;
    for (const g of this.marquee) {
      const gx = g.cx * P.s + P.ox;
      if (gx < -100 || gx > this.vw + 100) continue;
      for (const b of g.bulbs) {
        const x = b.x * P.s + P.ox, y = b.y * P.s + P.oy, d = 5 + b.on * 10;
        ctx.globalAlpha = (0.1 + b.on * 0.9) * fade * this.clearScreen(x, y);
        ctx.drawImage(this.sprites.glow(b.color), x - d / 2, y - d / 2, d, d);
      }
    }
  }

  private drawComet(c: Comet) {
    const col = C.colors, ctx = this.ctx, env = Math.sin(c.p * Math.PI);
    const hx = c.x + c.dx * c.dist * c.p, hy = c.y + c.dy * c.dist * c.p, L = c.tail * (0.4 + 0.6 * env), tx = hx - c.dx * L, ty = hy - c.dy * L;
    const gr = ctx.createLinearGradient(hx, hy, tx, ty);
    gr.addColorStop(0, rgba(col.pink, env));
    gr.addColorStop(0.35, rgba(col.pink, 0.55 * env));
    gr.addColorStop(1, rgba(col.cyan, 0));
    ctx.strokeStyle = gr;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.globalAlpha = env;
    ctx.drawImage(this.sprites.glow(col.pink), hx - 12, hy - 12, 24, 24);
    ctx.drawImage(this.sprites.glow(col.white), hx - 4, hy - 4, 8, 8);
  }

  private drawBelt() {
    const ctx = this.ctx, P = this.proj(C.layers.path), fade = 1 - this.warp.t, k = Math.max(P.s, 0.6);
    for (const it of this.belt) {
      const p = this.beltPos(it), x = p.x * P.s + P.ox, y = p.y * P.s + P.oy;
      if (x < -20 || x > this.vw + 20 || y < -20 || y > this.vh + 20) continue;
      const a = Math.pow(Math.sin(it.u * Math.PI), 0.5) * 0.85 * fade * this.clearWorld(p.x, p.y);
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(it.rot);
      ctx.scale(0.25 + 0.75 * Math.abs(Math.cos(it.spin)), 1);
      ctx.drawImage(it.img, -it.s * k, -it.s * k, it.s * 2 * k, it.s * 2 * k);
      ctx.restore();
    }
  }

  private drawPath() {
    const ctx = this.ctx, P = this.proj(C.layers.path), cyan = C.colors.cyan, G = this.sprites.glow, SF = this.sprites.soft;
    const fade = 1 - this.warp.hide * 0.85, pu = this.pulse, pz = clamp(Math.sqrt(P.s), 0.7, 1.4);
    const X = (x: number) => x * P.s + P.ox, Y = (y: number) => y * P.s + P.oy;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = cyan;
    for (const seg of C.path.enabled ? this.segs : []) {
      ctx.beginPath();
      seg.nodes.forEach((n, j) => (j ? ctx.lineTo(X(n.x), Y(n.y)) : ctx.moveTo(X(n.x), Y(n.y))));
      ctx.globalAlpha = 0.07 * fade;
      ctx.lineWidth = 7 * pz;
      ctx.stroke();
      ctx.globalAlpha = 0.42 * fade;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      for (const n of seg.nodes) {
        const x = X(n.x), y = Y(n.y);
        if (x < -20 || x > this.vw + 20) continue;
        const b = pu.a * Math.max(0, 1 - Math.abs(n.d - pu.d) / 70) + (this.anyHover ? this.hoverBoost(x, y) * 0.5 : 0);
        const d = (n.big ? 15 : 9) * pz * (1 + b * 0.8);
        ctx.globalAlpha = Math.min(1, (0.55 + 0.2 * Math.sin(this.t * 1.2 + n.ph) + b) * fade);
        ctx.drawImage(G(cyan), x - d / 2, y - d / 2, d, d);
      }
    }
    if (C.path.enabled && pu.a > 0.01) { // travelling light pulse + trail
      for (let k = 18; k >= 0; k--) {
        const d = pu.d - k * 7 * pu.dir;
        if (d < 0 || d > this.pathLen) continue;
        const p = this.pointAt(d), s = 22 * pz * (1 - k / 22);
        ctx.globalAlpha = pu.a * (1 - k / 19) * 0.6 * fade;
        ctx.drawImage(G(cyan), X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
      }
      const p = this.pointAt(pu.d), s = 68 * pz;
      ctx.globalAlpha = pu.a * 0.45 * fade;
      ctx.drawImage(SF(cyan), X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
      ctx.globalAlpha = pu.a * fade;
      ctx.drawImage(G(C.colors.white), X(p.x) - 6, Y(p.y) - 6, 12, 12);
    }
    // idle halo + hover glow + arrival flash, in each island's colour (behind the island art)
    const op = 1 - this.warp.hide;
    this.islands.forEach((s, i) => {
      const amt = Math.max(C.island.halo, this.hov[i], this.flash[i].v * 0.5);
      if (amt * op < 0.01) return;
      const p = this.slotPos[i], d = this.slotR * P.s * 5.5 * (0.8 + 0.2 * amt);
      ctx.globalAlpha = 0.5 * amt * op;
      ctx.drawImage(SF(s.color), p.x - d / 2, p.y - d / 2, d, d);
    });
  }

  private drawMotes(g: CanvasRenderingContext2D, front: boolean) {
    const P = this.proj(C.layers.path), op = 1 - this.warp.hide;
    if (op < 0.01) return;
    const k = clamp(P.s, 0.45, 1.6), t = this.t;
    this.slotW.forEach((w, i) => {
      const sx = w.x * P.s + P.ox, reach = this.islandW[i] * P.s;
      if (sx < -reach || sx > this.vw + reach) return;
      const bob = this.bob(i), lift = 0.8 + this.hov[i] * 0.5;
      for (const m of this.motes[i]) {
        const sn = Math.sin(m.ang);
        if (sn > 0 !== front) continue;
        const depth = 0.55 + 0.45 * ((sn + 1) / 2);
        const x = (w.x + Math.cos(m.ang) * m.rx) * P.s + P.ox, y = (w.y + m.h + sn * m.ry + bob) * P.s + P.oy;
        const d = m.size * 6 * k * depth;
        g.globalAlpha = Math.min(1, (0.3 + 0.45 * depth) * (0.75 + 0.25 * Math.sin(t * 2 + m.ph)) * op * lift);
        g.drawImage(this.sprites.glow(m.color), x - d / 2, y - d / 2, d, d);
      }
      if (!front) return;
      for (const s of this.sparks[i]) {
        const q = s.t / s.life, x = (w.x + s.x) * P.s + P.ox, y = (w.y + s.y0 - s.rise * q + bob) * P.s + P.oy;
        const a = Math.sin(q * Math.PI) * op * lift;
        if (a < 0.02) continue;
        g.globalAlpha = Math.min(1, a);
        if (s.color === C.colors.gold) {
          const d = s.size * 12 * k;
          g.drawImage(this.sprites.sparkle, x - d / 2, y - d / 2, d, d);
        } else {
          const d = s.size * 7 * k;
          g.drawImage(this.sprites.glow(s.color), x - d / 2, y - d / 2, d, d);
        }
      }
    });
  }

  private drawDust() {
    const ctx = this.ctx, P = this.proj(C.layers.dust), SF = this.sprites.soft, k = Math.max(P.s, 0.5);
    for (const d of this.dust) {
      const x = d.x * P.s + P.ox, y = d.y * P.s + P.oy, r = d.r * k;
      if (x < -r * 2 || x > this.vw + r * 2 || y < -r * 2 || y > this.vh + r * 2) continue;
      const a = d.a * this.clearScreen(x, y);
      if (a < 0.005) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(SF(d.c), x - r * 2, y - r * 2, r * 4, r * 4);
    }
  }

  private drawWarpFX() {
    const w = this.warp.t;
    if (w < 0.01) return;
    const ctx = this.ctx, c = this.slotPos[this.warp.slot], R = Math.hypot(this.vw, this.vh) * 0.6, color = this.islands[this.warp.slot].color;
    ctx.lineCap = 'round';
    for (const k of this.warpStreaks) {
      const rh = k.r0 * R * (1 + w * w * 3 * k.sp), rt = rh * (1 - 0.8 * w), cs = Math.cos(k.ang), sn = Math.sin(k.ang);
      ctx.globalAlpha = Math.min(1, w * 1.5) * k.a;
      ctx.strokeStyle = k.c;
      ctx.lineWidth = k.w * (0.5 + w);
      ctx.beginPath();
      ctx.moveTo(c.x + cs * rt, c.y + sn * rt);
      ctx.lineTo(c.x + cs * rh, c.y + sn * rh);
      ctx.stroke();
    }
    let d = 160 + w * 1400;
    ctx.globalAlpha = w * 0.55;
    ctx.drawImage(this.sprites.soft(color), c.x - d / 2, c.y - d / 2, d, d);
    d = 40 + w * 320;
    ctx.globalAlpha = w * 0.8;
    ctx.drawImage(this.sprites.glow(C.colors.white), c.x - d / 2, c.y - d / 2, d, d);
  }
}

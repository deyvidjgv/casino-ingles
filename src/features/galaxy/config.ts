// Galaxy map configuration. Ported from the Claude Design "Galaxy Map v2" prototype;
// every tunable number lives here.

export const COLORS = {
  space: '#0B0D2A',
  midnight: '#1A1E4A',
  violet: '#7B2FF7',
  pink: '#F72585',
  cyan: '#4CC9F0',
  gold: '#FFD166',
  white: '#F1F3FF',
} as const;

export type GameType = 'slot' | 'roulette' | 'blackjack' | 'dice' | 'mystery';

export interface IslandDef {
  id: string;
  game: GameType;
  label: string;
  /** fraction of world width */
  x: number;
  /** fraction of viewport height */
  y: number;
  color: string;
  accent: string;
  image: string;
  /** image height / width */
  aspect: number;
  /** fraction of image height where the island's world point (platform) sits */
  anchorY: number;
  /** dark disc drawn behind a see-through part of the art (fractions of image width/height) */
  core?: { x: number; y: number; rx: number; ry: number };
}

export const DEFAULT_ISLANDS: IslandDef[] = [
  { id: 'jackpot-nebula', game: 'slot', label: 'Jackpot Nebula', x: 0.1, y: 0.36, color: COLORS.gold, accent: COLORS.violet,
    image: '/islands/jackpot-nebula.webp', aspect: 1.339, anchorY: 0.52 },
  { id: 'lunar-roulette', game: 'roulette', label: 'Lunar Roulette', x: 0.3, y: 0.64, color: COLORS.pink, accent: COLORS.cyan,
    image: '/islands/lunar-roulette.webp', aspect: 1.339, anchorY: 0.46 },
  { id: 'card-comet', game: 'blackjack', label: 'Card Comet', x: 0.5, y: 0.36, color: COLORS.violet, accent: COLORS.cyan,
    image: '/islands/card-comet.webp', aspect: 1.491, anchorY: 0.48 },
  { id: 'dice-asteroid', game: 'dice', label: 'Dice Asteroid', x: 0.7, y: 0.64, color: COLORS.cyan, accent: COLORS.pink,
    image: '/islands/dice-asteroid.webp', aspect: 1.491, anchorY: 0.45 },
  { id: 'mystery-black-hole', game: 'mystery', label: 'Mystery Black Hole', x: 0.9, y: 0.36, color: COLORS.gold, accent: COLORS.pink,
    image: '/islands/mystery-black-hole.webp', aspect: 1.492, anchorY: 0.46,
    core: { x: 0.49, y: 0.235, rx: 0.075, ry: 0.052 } },
];

export interface LayerDef {
  /** horizontal parallax (1 = moves with islands) */
  f: number;
  /** zoom depth (1 = scales fully with zoom) */
  d: number;
}

export interface StarLayerDef extends LayerDef {
  /** count per 1440×900 of sky area */
  count: number;
  size: [number, number];
  alpha: [number, number];
  cyan: number;
  gold: number;
}

export const GALAXY_CONFIG = {
  colors: COLORS,
  world: { screens: 1.15 },
  // random scatter (layout.ts): y range in viewport heights, column jitter, min spacing in viewport heights
  layout: { yMin: 0.32, yMax: 0.66, jitter: 0.2, minGap: 0.36,
    /** minimum column width per island, in island widths (sets the minimum world width) */
    columnWidth: 1.35 },
  camera: {
    maxZoom: 2.5, moveDuration: 0.6, moveEase: 'power3.out', flyDuration: 1.1,
    friction: 0.03, keyStep: 0.4, wheelZoom: 0.0018, buttonZoom: 1.4,
    // screen px kept around the islands in "View all" (side arrows, top hint, bottom HUD + labels)
    fitMarginX: 110, fitMarginTop: 64, fitMarginBottom: 150,
    introDelay: 1.5,
  },
  layers: {
    galaxy: { f: 0.05, d: 0.06 }, nebula: { f: 0.12, d: 0.12 }, constellations: { f: 0.22, d: 0.25 },
    marquee: { f: 0.35, d: 0.45 }, path: { f: 1, d: 1 }, dust: { f: 1.4, d: 1.25 },
  } satisfies Record<string, LayerDef>,
  mouseParallax: 26,
  stars: {
    layers: [
      { count: 130, f: 0.15, d: 0.2, size: [0.35, 0.9], alpha: [0.25, 0.6], cyan: 0.08, gold: 0 },
      { count: 60, f: 0.35, d: 0.45, size: [0.7, 1.4], alpha: [0.45, 0.85], cyan: 0.14, gold: 0.015 },
      { count: 18, f: 0.6, d: 0.7, size: [1.1, 2.0], alpha: [0.6, 1], cyan: 0.2, gold: 0.05 },
    ] satisfies StarLayerDef[],
    twinkle: [0.6, 2.6] as [number, number],
    twinkleReduced: [0.1, 0.25] as [number, number],
  },
  galaxy: { rotationSeconds: 240, opacity: 0.42, size: 1.7, x: 0.55, y: 0.42, tilt: -0.35 },
  nebula: {
    clouds: [
      { x: 0.06, y: 0.32, size: 1.3, alpha: 0.55, pink: 0.3 }, { x: 0.36, y: 0.72, size: 1.1, alpha: 0.45, pink: 0.5 },
      { x: 0.64, y: 0.28, size: 1.4, alpha: 0.5, pink: 0.25 }, { x: 0.93, y: 0.64, size: 1.2, alpha: 0.5, pink: 0.45 },
    ],
    breathSeconds: [8, 13] as [number, number],
  },
  constellations: [
    { shape: 'heart', x: 0.13, y: 0.2, size: 120, rot: -0.15 }, { shape: 'die', x: 0.42, y: 0.84, size: 80, rot: 0.3 },
    { shape: 'spade', x: 0.7, y: 0.17, size: 120, rot: 0.1 }, { shape: 'moon', x: 0.94, y: 0.2, size: 110, rot: 0.4 },
  ] as const,
  marquee: { groups: 6, bulbs: [6, 9] as [number, number], delay: [4, 9] as [number, number] },
  // coin belt lives on the island layer; x in world width fractions, y in viewport height fractions
  belt: { count: 40, from: 0.13, to: 0.47, y0: 0.07, y1: 0.1, amp: 0.03, width: 26 },
  /** × slot radius kept free of belt, coins and dust around each island */
  clearRadius: 3,
  comets: { delay: [6, 12] as [number, number], duration: [0.9, 1.5] as [number, number] },
  dust: { perScreen: 2 },
  // constellation "bridge" between islands
  path: { enabled: true, nodeSpacing: 62, pulseTravel: 2.4, pulseGap: 1.2 },
  hover: { radius: 170, starRadius: 260 },
  warp: { pan: 0.6, streak: 1.6, zoomMul: 4, fade: 1.2, back: 1.2, streaks: 240 },
  island: {
    /** island art width in world px = slot radius × widthMul; slot radius = viewport height × radius (clamped) */
    widthMul: 5,
    radius: 0.068, radiusMin: 30, radiusMax: 90,
    /** idle halo behind each island (0..1) */
    halo: 0.22,
    /** orbiting motes and rising sparkles per island */
    motes: 10, sparkles: 4,
    bob: 0.018,
  },
};

export type GalaxyConfig = typeof GALAXY_CONFIG;

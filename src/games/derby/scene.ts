// Geometry and palette of the hippodrome board. Every number the track and the race engine
// share lives here, so the SVG scene and the progress maths can never drift apart.

export const BOARD = { w: 1040, h: 600 };

/** Start and finish lines, in board px. Progress 0 sits on one, progress 1 on the other. */
export const RUN = { x0: 186, x1: 872 };

/** Vertical band the lanes are centred in. */
export const LANES = { top: 142, bottom: 508, maxHeight: 76 };

export const STANDS = { top: 36, height: 92 };

/** Central barrier below the lanes, and the strip the tap pads live in. */
export const SPINA = { top: 516, height: 26 };

export type HorseColor = 'green' | 'gold' | 'blue' | 'red' | 'purple' | 'white';

/** Lane order is fixed so the same student always draws the same colour within a race. */
export const HORSE_COLORS: HorseColor[] = ['green', 'gold', 'blue', 'red', 'purple', 'white'];

/** Glow/nameplate colour per horse, and the art's width ÷ height (all frames are 186 tall). */
export const HORSE: Record<HorseColor, { glow: string; ink: string; ratio: number }> = {
  green:  { glow: '#22DD77', ink: '#04361F', ratio: 368 / 186 },
  gold:   { glow: '#FFC24B', ink: '#3B2A05', ratio: 350 / 186 },
  blue:   { glow: '#35B6F5', ink: '#04283D', ratio: 382 / 186 },
  red:    { glow: '#FF5A4E', ink: '#3D0D09', ratio: 388 / 186 },
  purple: { glow: '#B06CF5', ink: '#260A44', ratio: 353 / 186 },
  white:  { glow: '#DDE6FF', ink: '#1A1E3A', ratio: 336 / 186 },
};

/** Marble, gold and turf. Taken from the island art so the board feels like walking into it. */
export const STONE = {
  marble: '#EDE8DA',
  marbleShade: '#C9C0AA',
  marbleDeep: '#9E947C',
  gold: '#FFD166',
  goldDeep: '#C79A2E',
  turf: '#127A4A',
  turfDeep: '#0A4B2E',
  /** lanes are near-black on purpose: the green and gold horses vanish on bright turf */
  lane: '#0C2A1E',
  laneAlt: '#0F3325',
  rock: '#2A2350',
};

/** Height of one lane for a given field size, and the top of the lane block. */
export function laneMetrics(count: number) {
  const band = LANES.bottom - LANES.top;
  const height = Math.min(LANES.maxHeight, band / count);
  const top = LANES.top + (band - height * count) / 2;
  return { height, top };
}

export const laneY = (index: number, count: number) => {
  const { height, top } = laneMetrics(count);
  return top + height * index;
};

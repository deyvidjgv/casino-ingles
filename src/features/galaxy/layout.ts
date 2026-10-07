// Deterministic island placement: alternating wave (1 up, 1 down, 1 up, 1 down, 1 up...)
// for maximum visibility and clean ordered layout.
import type { IslandDef } from './config';

/**
 * Alternating wave layout (1 up, 1 down, 1 up, 1 down...):
 * Islands are laid out left to right in order with optimal spacing and visibility.
 * Even index = Upper (y=0.36)
 * Odd index = Lower (y=0.64)
 */
export function waveIslands(islands: IslandDef[]): IslandDef[] {
  const n = islands.length;
  if (n === 0) return islands;
  const Y_UP = 0.36;
  const Y_DOWN = 0.64;

  return islands.map((s, i) => ({
    ...s,
    x: n === 1 ? 0.5 : 0.10 + (i / (n - 1)) * 0.80,
    y: i % 2 === 0 ? Y_UP : Y_DOWN,
  }));
}

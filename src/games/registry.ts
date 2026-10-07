import { lazy, type ComponentType } from 'react';
import type { GameType } from '../features/galaxy/config';
import type { GameModule, GameProps } from './types';

type GameLoader = () => Promise<{ default: ComponentType<GameProps> }>;

/** Each game is its own chunk: the map is the landing screen, so only the island
 *  actually entered pays for its code. Loaders are kept separate from the lazy
 *  components so a chunk can also be warmed up ahead of render. */
const LOADERS = {
  slot: () => import('./slot/SlotGame').then(m => ({ default: m.SlotGame })),
  roulette: () => import('./roulette/RouletteGame').then(m => ({ default: m.RouletteGame })),
  blackjack: () => import('./blackjack/CardCometGame').then(m => ({ default: m.CardCometGame })),
  dice: () => import('./dice/DiceAsteroidGame').then(m => ({ default: m.DiceAsteroidGame })),
  mystery: () => import('./mystery/MysteryBlackHoleGame').then(m => ({ default: m.MysteryBlackHoleGame })),
  derby: () => import('./derby/StellarDerbyGame').then(m => ({ default: m.StellarDerbyGame })),
} satisfies Record<GameType, GameLoader>;

/** One entry per game type. Adding a game = add its loader above and its entry here. */
export const GAMES: Record<GameType, GameModule> = {
  slot: { type: 'slot', nameKey: 'slot.name', Component: lazy(LOADERS.slot) },
  roulette: { type: 'roulette', nameKey: 'roulette.name', Component: lazy(LOADERS.roulette) },
  blackjack: { type: 'blackjack', nameKey: 'blackjack.name', Component: lazy(LOADERS.blackjack) },
  dice: { type: 'dice', nameKey: 'dice.name', Component: lazy(LOADERS.dice) },
  mystery: { type: 'mystery', nameKey: 'mystery.name', Component: lazy(LOADERS.mystery) },
  derby: { type: 'derby', nameKey: 'derby.name', Component: lazy(LOADERS.derby) },
};

/** Start fetching a game's chunk before it renders, so the warp animation hides the download. */
export function preloadGame(type: GameType) {
  void LOADERS[type]();
}

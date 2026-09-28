import type { GameType } from '../features/galaxy/config';
import { SlotGame } from './slot/SlotGame';
import { RouletteGame } from './roulette/RouletteGame';
import { CardCometGame } from './blackjack/CardCometGame';
import { DiceAsteroidGame } from './dice/DiceAsteroidGame';
import { MysteryBlackHoleGame } from './mystery/MysteryBlackHoleGame';
import type { GameModule } from './types';

/** One entry per game type. Adding a game = add its module here. */
export const GAMES: Record<GameType, GameModule> = {
  slot: { type: 'slot', nameKey: 'slot.name', Component: SlotGame },
  roulette: { type: 'roulette', nameKey: 'roulette.name', Component: RouletteGame },
  blackjack: { type: 'blackjack', nameKey: 'blackjack.name', Component: CardCometGame },
  dice: { type: 'dice', nameKey: 'dice.name', Component: DiceAsteroidGame },
  mystery: { type: 'mystery', nameKey: 'mystery.name', Component: MysteryBlackHoleGame },
};

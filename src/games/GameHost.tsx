import { GAMES } from './registry';
import type { GameProps } from './types';

export function GameHost({ island, onExit }: GameProps) {
  const Game = GAMES[island.game].Component;
  return <Game key={island.id} island={island} onExit={onExit} />;
}

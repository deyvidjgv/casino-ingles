import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { GAMES } from './registry';
import type { GameProps } from './types';

export function GameHost({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  const Game = GAMES[island.game].Component;
  return (
    <Suspense fallback={<div className="rc-game-loading">{t('map.loading')}</div>}>
      <Game key={island.id} island={island} onExit={onExit} />
    </Suspense>
  );
}

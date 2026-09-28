import { useTranslation } from 'react-i18next';
import { GameShell, Notice } from './shared/ui';
import type { GameProps } from './types';

export function ComingSoon({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  return (
    <GameShell island={island} title={t(`games.${island.game}`)} onExit={onExit}>
      <Notice text={t('game.comingSoon')} />
    </GameShell>
  );
}

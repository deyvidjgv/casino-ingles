import type { ComponentType } from 'react';
import type { GameType, IslandDef } from '../features/galaxy/config';

export interface GameProps {
  island: IslandDef;
  onExit: () => void;
}

/** One game type. New games = new module registered in registry.ts; nothing else changes. */
export interface GameModule {
  type: GameType;
  /** i18n key of the game's display name */
  nameKey: string;
  Component: ComponentType<GameProps>;
}

export type PlayMode = 'eliminate' | 'keep';

export interface Localized {
  en: string;
  es: string;
}

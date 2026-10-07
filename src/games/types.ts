import type { ComponentType, LazyExoticComponent } from 'react';
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
  /** lazy-loaded: each game ships as its own chunk */
  Component: LazyExoticComponent<ComponentType<GameProps>>;
}

export type PlayMode = 'eliminate' | 'keep';

export interface Localized {
  en: string;
  es: string;
}

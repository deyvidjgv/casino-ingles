import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { IslandDef } from '../../features/galaxy/config';
import type { Localized, PlayMode } from '../types';

export const islandVars = (s: IslandDef) => ({ '--island-color': s.color, '--island-accent': s.accent }) as CSSProperties;

/** Eliminate mode: whoever was drawn sits out until the round is restarted. Keep mode: everyone stays. */
export function usePool<T extends { id: string }>(items: T[], mode: PlayMode) {
  const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
  const available = useMemo(() => (mode === 'eliminate' ? items.filter(i => !used.has(i.id)) : items), [items, used, mode]);
  const markUsed = useCallback((ids: string[]) => setUsed(prev => new Set([...prev, ...ids])), []);
  const reset = useCallback(() => setUsed(new Set()), []);
  return { available, markUsed, reset };
}

/** Per-island game settings, remembered in localStorage (later: Firestore islands/{id}.config). */
export function useIslandConfig<T extends object>(islandId: string, defaults: T) {
  const key = `rc.cfg.${islandId}`;
  const [config, setConfigState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<T>) } : defaults;
    } catch {
      return defaults;
    }
  });
  const setConfig = useCallback((next: T) => {
    setConfigState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage blocked: settings last for this visit only */
    }
  }, [key]);
  return [config, setConfig] as const;
}

/** Picks the teacher-written text for the current UI language. */
export function useLocalized() {
  const { i18n } = useTranslation();
  const lang: keyof Localized = i18n.language === 'es' ? 'es' : 'en';
  return { lang, pick: (l: Localized) => l[lang] || l.en };
}

export function usePrefersReducedMotion() {
  return useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);
}

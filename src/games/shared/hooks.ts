import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useClassStore } from '../../store/classStore';
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

/** Verdict the teacher gives on a spoken answer. */
export type Verdict = 'correct' | 'wrong' | 'penalty';

export interface PendingAward {
  studentIds: string[];
  names: string[];
  /** points at stake, from the game's own settings */
  points: number;
  /** what the round produced, for the log line */
  summary: string;
}

/**
 * Points are never awarded by the animation landing — the teacher judges the answer first.
 * The award and the log entry both happen here, exactly once per round, so a round can
 * never be scored twice or scored and left out of the log.
 */
export function useJudgedAward(
  onSettled: (entry: { text: string; chips: string[]; saved?: boolean }, points: number, studentIds: string[]) => void,
) {
  const addPoints = useClassStore(s => s.addPoints);
  const adjustPoints = useClassStore(s => s.adjustPoints);
  const [pending, setPendingState] = useState<PendingAward | null>(null);
  // The ref, not the state, is the guard: state updaters must stay pure (React runs them
  // twice in development), so the award cannot live inside one.
  const pendingRef = useRef<PendingAward | null>(null);

  const setPending = useCallback((award: PendingAward | null) => {
    pendingRef.current = award;
    setPendingState(award);
  }, []);

  const judge = useCallback((verdict: Verdict) => {
    const current = pendingRef.current;
    if (!current) return; // already judged: a second click must not score again
    pendingRef.current = null;
    setPendingState(null);

    const { studentIds, names, points, summary } = current;
    let delta = 0;
    if (verdict === 'correct') {
      delta = points;
      if (points > 0 && studentIds.length) addPoints(studentIds, points);
    } else if (verdict === 'penalty') {
      delta = -points;
      // adjustPoints floors at zero, so nobody ends the class in the negative
      if (points > 0) studentIds.forEach(id => adjustPoints(id, -points));
    }
    const chips = delta === 0 ? [] : names.map(n => `${n} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
    onSettled({ text: summary, chips, saved: verdict !== 'correct' }, delta, studentIds);
  }, [addPoints, adjustPoints, onSettled]);

  return { pending, setPending, judge };
}

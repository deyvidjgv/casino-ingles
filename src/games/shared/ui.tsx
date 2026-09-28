// Building blocks shared by every game screen. Chamfered (.rc-cut) surfaces, island-coloured accents.
import { useEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import type { IslandDef } from '../../features/galaxy/config';
import { useClassStore } from '../../store/classStore';
import { sfx } from '../../lib/sfx';
import type { PlayMode } from '../types';
import { Starburst } from './Starburst';
import { islandVars } from './hooks';
import './games.css';

interface ShellProps {
  island: IslandDef;
  title: string;
  status?: ReactNode;
  onExit: () => void;
  onSettings?: () => void;
  onEnd?: () => void;
  children: ReactNode;
  className?: string;
}

export function GameShell({ island, title, status, onExit, onSettings, onEnd, children, className }: ShellProps) {
  const { t } = useTranslation();
  const muted = useClassStore(s => s.muted), toggleMuted = useClassStore(s => s.toggleMuted);
  return (
    <div className={`gm-shell ${className ?? ''}`} style={islandVars(island)}>
      <div className="gm-backdrop" aria-hidden="true"><img src={island.image} alt="" /></div>
      <header className="gm-header">
        <div className="gm-titles">
          <div className="gm-kicker">{island.label}</div>
          <h1 className="gm-title">{title}</h1>
        </div>
        <div className="gm-status" aria-live="polite">{status}</div>
        <div className="gm-actions">
          {onSettings && <button type="button" className="rc-cut gm-btn" onClick={onSettings}>{t('game.settings')}</button>}
          <button type="button" className="rc-cut gm-btn" aria-pressed={!muted} onClick={toggleMuted}>
            {muted ? t('game.soundOff') : t('game.soundOn')}
          </button>
          {onEnd && <button type="button" className="rc-cut gm-btn" onClick={onEnd}>{t('game.end')}</button>}
          <button type="button" className="rc-cut gm-btn" onClick={onExit}>{t('game.map')}</button>
        </div>
      </header>
      <main className="gm-stage">{children}</main>
    </div>
  );
}

export function Panel({ title, children, footer, wide }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <section className={`rc-cut gm-panel ${wide ? 'gm-panel-wide' : ''}`}>
      <h2 className="gm-panel-title">{title}</h2>
      <div className="gm-panel-body">{children}</div>
      {footer && <div className="gm-panel-footer">{footer}</div>}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="gm-field">
      <div className="gm-field-label">{label}</div>
      {children}
      {hint && <div className="gm-field-hint">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="gm-seg" role="radiogroup">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={`rc-cut gm-seg-opt ${value === o.value ? 'is-on' : ''}`} onClick={() => { sfx.click(); onChange(o.value); }}>
          <span className="gm-seg-label">{o.label}</span>
          {o.hint && <span className="gm-seg-hint">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, step = 1, onChange, format }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <div className="gm-stepper">
      <button type="button" className="rc-cut gm-step-btn" aria-label="−" disabled={value <= min} onClick={() => set(value - step)}>−</button>
      <span className="gm-step-value">{format ? format(value) : value}</span>
      <button type="button" className="rc-cut gm-step-btn" aria-label="+" disabled={value >= max} onClick={() => set(value + step)}>+</button>
    </div>
  );
}

/** Mode + points: the two settings every game shares. */
export function CommonSetup({ mode, points, onMode, onPoints, pointsLabel }: {
  mode: PlayMode; points: number; onMode: (m: PlayMode) => void; onPoints: (p: number) => void; pointsLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t('game.mode')}>
        <Segmented value={mode} onChange={onMode} options={[
          { value: 'eliminate', label: t('game.modeEliminate'), hint: t('game.modeEliminateHint') },
          { value: 'keep', label: t('game.modeKeep'), hint: t('game.modeKeepHint') },
        ]} />
      </Field>
      <Field label={pointsLabel ?? t('game.points')}>
        <Stepper value={points} min={0} max={20} onChange={onPoints} />
      </Field>
    </>
  );
}

export function PhraseField({ label, value, onChange, vars }: { label: string; value: string; onChange: (v: string) => void; vars: string[] }) {
  const { t } = useTranslation();
  return (
    <Field label={label} hint={t('game.phraseHint', { vars: vars.map(v => `{${v}}`).join('  ') })}>
      <textarea className="gm-input" rows={2} value={value} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

export interface Chip {
  label: string;
  color?: string;
}

/** Big result banner over the stage, with the star burst. */
export function ResultOverlay({ island, kicker, text, chips, actions, burstKey, tone = 'win' }: {
  island: IslandDef; kicker?: string; text: string; chips?: Chip[]; actions: ReactNode; burstKey: number; tone?: 'win' | 'saved';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tw = gsap.fromTo(el.querySelector('.gm-result-card'), { scale: reduced ? 1 : 0.7, opacity: 0 },
      { scale: 1, opacity: 1, duration: reduced ? 0.5 : 0.6, ease: 'back.out(1.6)', clearProps: 'transform' });
    return () => { tw.kill(); };
  }, [burstKey]);
  return (
    <div ref={ref} className={`gm-result gm-result-${tone}`} role="dialog" aria-live="assertive">
      {tone === 'win' && <Starburst color={island.color} burstKey={burstKey} />}
      <div className="rc-cut gm-result-card">
        {kicker && <div className="gm-result-kicker">{kicker}</div>}
        <div className="gm-result-text">{text}</div>
        {!!chips?.length && (
          <div className="gm-chips">{chips.map((c, i) => <span key={i} className="gm-chip" style={c.color ? { color: c.color } : undefined}>{c.label}</span>)}</div>
        )}
        <div className="gm-result-actions">{actions}</div>
      </div>
    </div>
  );
}

export interface RoundLog {
  text: string;
  saved?: boolean;
}

export function Summary({ rounds, onNew, onExit }: { rounds: RoundLog[]; onNew: () => void; onExit: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel title={t('game.summaryTitle')} wide footer={
      <>
        <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={onNew}>{t('game.newGame')}</button>
        <button type="button" className="rc-cut gm-btn" onClick={onExit}>{t('game.backToMap')}</button>
      </>
    }>
      {rounds.length ? (
        <ol className="gm-summary">{rounds.map((r, i) => <li key={i} className={r.saved ? 'is-saved' : ''}>{r.text}</li>)}</ol>
      ) : <p className="gm-muted">{t('game.summaryEmpty')}</p>}
    </Panel>
  );
}

export function Notice({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="rc-cut gm-notice" role="status">
      <span>{text}</span>
      {action}
    </div>
  );
}

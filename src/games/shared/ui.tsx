// Building blocks shared by every game screen. Chamfered (.rc-cut) surfaces, island-coloured accents.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { IslandDef } from '../../features/galaxy/config';
import { useClassStore } from '../../store/classStore';
import { sfx } from '../../lib/sfx';
import type { PlayMode } from '../types';
import { islandVars, type Verdict } from './hooks';
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
  /** Scale the board to fit the stage instead of letting it overflow. Setup forms keep
   *  their natural size and scroll. */
  fit?: boolean;
  /** Round log shown in a side rail. Static by design: it replaces the old animated
   *  result banner, which covered the cards/dice and cost a canvas burst per round. */
  history?: RoundLog[];
}

export function GameShell({ island, title, status, onExit, onSettings, onEnd, children, className, history, fit }: ShellProps) {
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
      <div className="gm-body">
        <main className="gm-stage">{fit ? <FitBoard>{children}</FitBoard> : children}</main>
        {history && <RoundHistory rounds={history} />}
      </div>
    </div>
  );
}

/** Plain list of what happened, newest first. No animation, no canvas — it must never
 *  compete with the board for frames. */
export function RoundHistory({ rounds }: { rounds: RoundLog[] }) {
  const { t } = useTranslation();
  return (
    <aside className="gm-log" aria-live="polite">
      <h2 className="gm-log-title">{t('game.roundLog')}</h2>
      {rounds.length ? (
        <ol className="gm-log-list">
          {[...rounds].reverse().map((r, i) => (
            <li key={rounds.length - i} className={r.saved ? 'is-saved' : ''}>
              <span className="gm-log-n">{rounds.length - i}</span>
              <span className="gm-log-text">
                {r.text}
                {!!r.chips?.length && (
                  <span className="gm-log-chips">{r.chips.map((c, k) => <span key={k}>{c}</span>)}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="gm-log-empty">{t('game.roundLogEmpty')}</p>
      )}
    </aside>
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

export interface RoundLog {
  text: string;
  saved?: boolean;
  /** e.g. "Ana +3" — the points awarded for this round */
  chips?: string[];
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

/**
 * Lays the board out at a fixed design size and scales it to fit the stage, the way a slide
 * deck does. Without this each game had to hand-tune heights, the tall ones overflowed, and
 * the resulting scroll was what left the map displaced on the way back.
 */
export function FitBoard({ width = 1040, height = 600, max = 1.5, children }: {
  width?: number; height?: number; max?: number; children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // Measured on the wrapper, which is never scaled, so this cannot feed back on itself.
    const fit = () => {
      const { width: w, height: h } = box.getBoundingClientRect();
      if (!w || !h) return;
      setScale(Math.min(max, w / width, h / height));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    fit();
    return () => ro.disconnect();
  }, [width, height, max]);

  return (
    <div ref={boxRef} className="gm-fit">
      <div
        className="gm-fit-board"
        style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/** Teacher-only verdict bar. Nothing is scored until one of these is pressed. */
export function AnswerJudge({ names, points, summary, onJudge }: {
  names: string[]; points: number; summary: string; onJudge: (v: Verdict) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rc-cut gm-judge" role="group" aria-label={t('game.judgeTitle')}>
      <div className="gm-judge-head">
        <span className="gm-judge-who">{names.join(' & ') || summary}</span>
        <span className="gm-judge-ask">{t('game.judgeTitle')}</span>
      </div>
      <div className="gm-judge-actions">
        <button type="button" className="rc-cut gm-judge-btn is-correct" onClick={() => onJudge('correct')}>
          {t('game.judgeCorrect', { points })}
        </button>
        <button type="button" className="rc-cut gm-judge-btn" onClick={() => onJudge('wrong')}>
          {t('game.judgeWrong')}
        </button>
        <button type="button" className="rc-cut gm-judge-btn is-penalty" onClick={() => onJudge('penalty')}>
          {t('game.judgePenalty', { points })}
        </button>
      </div>
    </div>
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

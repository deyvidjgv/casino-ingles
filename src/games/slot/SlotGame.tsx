// Jackpot Nebula — slot machine. Result is drawn first (crypto), then every reel strip is built so
// its tween ends exactly on the drawn value.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { pickDistinct, pickOne } from '../../lib/random';
import { fillTemplate } from '../../lib/template';
import { sfx } from '../../lib/sfx';
import { CommonSetup, Field, GameShell, Notice, Panel, PhraseField, ResultOverlay, Segmented, Stepper, Summary, type RoundLog } from '../shared/ui';
import { useIslandConfig, useLocalized, usePool } from '../shared/hooks';
import type { GameProps, Localized, PlayMode } from '../types';
import './slot.css';

type ReelKind = 'student' | 'topic' | 'question';
type Preset = '2s1t' | '1s1t1q' | '3s' | 'custom';

interface SlotConfig {
  preset: Preset;
  reels: ReelKind[];
  mode: PlayMode;
  points: number;
  duration: number;
  phrases: Record<Preset, Localized>;
}

const PRESET_REELS: Record<Exclude<Preset, 'custom'>, ReelKind[]> = {
  '2s1t': ['student', 'student', 'topic'],
  '1s1t1q': ['student', 'topic', 'question'],
  '3s': ['student', 'student', 'student'],
};

const DEFAULTS: SlotConfig = {
  preset: '2s1t',
  reels: PRESET_REELS['2s1t'],
  mode: 'eliminate',
  points: 1,
  duration: 3,
  phrases: {
    '2s1t': { en: '{student1} & {student2}, talk about {topic}!', es: '¡{student1} y {student2}, hablen sobre {topic}!' },
    '1s1t1q': { en: '{student1} — {topic}: {question}', es: '{student1} — {topic}: {question}' },
    '3s': { en: 'Team up: {student1}, {student2} & {student3}!', es: '¡Equipo: {student1}, {student2} y {student3}!' },
    custom: { en: '{all}', es: '{all}' },
  },
};

const FILLER = 16;       // extra items the first reel scrolls through; later reels add more
const REEL_EXTRA = 7;

interface Drawn { values: string[]; studentIds: string[]; vars: Record<string, string> }

export function SlotGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  const { lang, pick } = useLocalized();
  const allStudents = useClassStore(s => s.students), topics = useClassStore(s => s.topics), questions = useClassStore(s => s.questions);
  const addPoints = useClassStore(s => s.addPoints), addHistory = useClassStore(s => s.addHistory);
  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);

  const [config, setConfig] = useIslandConfig<SlotConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);
  const pool = usePool(students, config.mode);

  const reels = config.reels;
  const [strips, setStrips] = useState<string[][]>(() => reels.map(() => ['★', '★', '★']));
  const [spinning, setSpinning] = useState(false);
  const [spinId, setSpinId] = useState(0);
  const [result, setResult] = useState<{ text: string; chips: string[]; burst: number } | null>(null);
  const drawnRef = useRef<Drawn | null>(null);
  const stripRefs = useRef<(HTMLDivElement | null)[]>([]);
  const leverRef = useRef<HTMLButtonElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const sourceOf = (k: ReelKind) => (k === 'student' ? students.map(s => s.name) : (k === 'topic' ? topics : questions).map(x => x.text));
  const studentReels = reels.filter(k => k === 'student').length;

  // what's blocking a spin right now (null = ready)
  const blocker = useMemo(() => {
    if (studentReels > 0 && students.length < studentReels) return t('game.notEnoughStudents');
    if (reels.includes('topic') && !topics.length) return t('game.noTopics');
    if (reels.includes('question') && !questions.length) return t('game.noQuestions');
    if (studentReels > 0 && pool.available.length < studentReels) return config.mode === 'eliminate' ? t('game.allPlayed') : t('game.notEnoughStudents');
    return null;
  }, [studentReels, students.length, reels, topics.length, questions.length, pool.available.length, config.mode, t]);

  useEffect(() => () => { tlRef.current?.kill(); }, []);

  function draw(): Drawn {
    const chosen = pickDistinct(pool.available, studentReels);
    const vars: Record<string, string> = {};
    const counters = { student: 0, topic: 0, question: 0 };
    const values = reels.map(k => {
      counters[k]++;
      const v = k === 'student' ? chosen[counters.student - 1].name : pickOne(k === 'topic' ? topics : questions).text;
      vars[`${k}${counters[k]}`] = v;
      return v;
    });
    vars.topic ??= vars.topic1;
    vars.question ??= vars.question1;
    vars.all = values.join(' · ');
    return { values, studentIds: chosen.map(s => s.id), vars };
  }

  function spin() {
    if (spinning || blocker) return;
    const drawn = draw();
    drawnRef.current = drawn;
    setResult(null);
    setStrips(prev => reels.map((k, r) => {
      const src = sourceOf(k), cur = prev[r] ?? ['★', '★', '★'];
      const fill = Array.from({ length: FILLER + r * REEL_EXTRA }, () => pickOne(src));
      return [...cur.slice(0, 3), ...fill, pickOne(src), drawn.values[r], pickOne(src)];
    }));
    setSpinning(true);
    setSpinId(id => id + 1);
    sfx.lever();
    const lever = leverRef.current;
    if (lever) gsap.fromTo(lever, { '--pull': 0 }, { '--pull': 1, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.in' });
  }

  // run the reel tweens once the long strips are in the DOM
  useLayoutEffect(() => {
    if (!spinId || !spinning) return;
    const els = stripRefs.current.slice(0, reels.length);
    const itemH = els[0]?.firstElementChild instanceof HTMLElement ? els[0].firstElementChild.offsetHeight : 90;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base = config.duration, n = reels.length;
    const ticker = window.setInterval(() => sfx.tick(), 85);
    const tl = gsap.timeline({
      onComplete: () => {
        clearInterval(ticker);
        finish();
      },
    });
    tlRef.current = tl;
    els.forEach((el, r) => {
      if (!el) return;
      const len = el.children.length, end = -(len - 3) * itemH;
      gsap.set(el, { y: 0 });
      const dur = reduced ? 0.6 + r * 0.25 : base * (0.55 + (0.45 * r) / Math.max(1, n - 1));
      tl.to(el, { y: end, duration: dur, ease: reduced ? 'power1.out' : 'back.out(0.7)', onComplete: () => sfx.reelStop() }, 0);
    });
    return () => { clearInterval(ticker); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per spin
  }, [spinId]);

  // after a spin the strips collapse back to 3 items: reset their offset before paint
  useLayoutEffect(() => {
    if (spinning) return;
    stripRefs.current.forEach(el => { if (el) gsap.set(el, { y: 0 }); });
  }, [strips, spinning]);

  function finish() {
    const drawn = drawnRef.current;
    if (!drawn) return;
    setStrips(prev => prev.map(s => s.slice(-3)));
    setSpinning(false);
    const text = fillTemplate(pick(config.phrases[config.preset]), drawn.vars);
    const chips = drawn.studentIds.length && config.points ? drawn.values.filter((_, i) => reels[i] === 'student').map(n => `${n} +${config.points}`) : [];
    addPoints(drawn.studentIds, config.points);
    if (config.mode === 'eliminate') pool.markUsed(drawn.studentIds);
    addHistory({ islandId: island.id, game: 'slot', summary: text, studentIds: drawn.studentIds, points: config.points });
    setRounds(r => [...r, { text }]);
    sfx.win();
    setResult({ text, chips, burst: Date.now() });
  }

  function startGame(next: SlotConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
    setResult(null);
    setStrips(next.reels.map(() => ['★', '★', '★']));
    setPhase('play');
  }

  function endGame() {
    tlRef.current?.kill();
    setSpinning(false);
    setResult(null);
    setPhase('summary');
  }

  const presetOptions: { value: Preset; label: string }[] = [
    { value: '2s1t', label: t('slot.preset2s1t') },
    { value: '1s1t1q', label: t('slot.preset1s1t1q') },
    { value: '3s', label: t('slot.preset3s') },
    { value: 'custom', label: t('slot.presetCustom') },
  ];
  const kindLabel = (k: ReelKind) => t(`slot.kind_${k}`);
  const phraseVars = (rs: ReelKind[]) => {
    const c = { student: 0, topic: 0, question: 0 };
    return [...rs.map(k => `${k}${++c[k]}`), 'all'];
  };

  const status = phase === 'play' && studentReels > 0
    ? (config.mode === 'eliminate' ? t('game.leftToPlay', { count: pool.available.length }) : t('game.everyoneStays'))
    : undefined;

  return (
    <GameShell island={island} title={t('slot.name')} status={status} onExit={onExit}
      onSettings={phase === 'play' && !spinning ? () => { setDraft(config); setPhase('setup'); } : undefined}
      onEnd={phase === 'play' && !spinning ? endGame : undefined}>

      {phase === 'setup' && (
        <Panel title={t('game.setup')} footer={
          <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={() => startGame(draft)}>{t('game.start')}</button>
        }>
          <Field label={t('slot.reelsLabel')}>
            <Segmented value={draft.preset} options={presetOptions} onChange={p =>
              setDraft(d => ({ ...d, preset: p, reels: p === 'custom' ? d.reels : PRESET_REELS[p] }))} />
          </Field>
          {draft.preset === 'custom' && (
            <Field label={t('slot.reelCount')}>
              <Stepper value={draft.reels.length} min={3} max={5} onChange={n =>
                setDraft(d => ({ ...d, reels: Array.from({ length: n }, (_, i) => d.reels[i] ?? 'student') }))} />
              <div className="sl-kinds">
                {draft.reels.map((k, i) => (
                  <label key={i} className="sl-kind">
                    <span>{t('slot.reelN', { n: i + 1 })}</span>
                    <select className="gm-input" value={k} onChange={e => {
                      const v = e.target.value as ReelKind;
                      setDraft(d => ({ ...d, reels: d.reels.map((x, j) => (j === i ? v : x)) }));
                    }}>
                      {(['student', 'topic', 'question'] as ReelKind[]).map(o => <option key={o} value={o}>{kindLabel(o)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </Field>
          )}
          <CommonSetup mode={draft.mode} points={draft.points}
            onMode={mode => setDraft(d => ({ ...d, mode }))} onPoints={points => setDraft(d => ({ ...d, points }))} />
          <Field label={t('game.spinTime')}>
            <Stepper value={draft.duration} min={2} max={8} onChange={duration => setDraft(d => ({ ...d, duration }))}
              format={v => t('game.seconds', { n: v })} />
          </Field>
          <PhraseField label={t('game.phrase')} vars={phraseVars(draft.reels)} value={draft.phrases[draft.preset][lang]}
            onChange={v => setDraft(d => ({ ...d, phrases: { ...d.phrases, [d.preset]: { ...d.phrases[d.preset], [lang]: v } } }))} />
        </Panel>
      )}

      {phase === 'play' && (
        <div className="sl-play">
          <div className={`sl-machine ${spinning ? 'is-spinning' : ''}`}>
            <div className="sl-marquee" aria-hidden="true">
              <span className="sl-marquee-comet" />
              <span className="sl-marquee-text">{island.label}</span>
            </div>
            <div className="sl-cabinet">
              <div className="sl-bulbs" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.07}s` }} />)}</div>
              <div className="sl-window" style={{ gridTemplateColumns: `repeat(${reels.length}, minmax(0, 1fr))` }}>
                {reels.map((k, r) => (
                  <div key={r} className={`sl-reel sl-reel-${k}`}>
                    <div className="sl-strip" ref={el => { stripRefs.current[r] = el; }}>
                      {(strips[r] ?? []).map((v, i) => <div key={i} className="sl-item"><span>{v}</span></div>)}
                    </div>
                  </div>
                ))}
                <div className="sl-payline" aria-hidden="true" />
              </div>
              <div className="sl-reel-labels" style={{ gridTemplateColumns: `repeat(${reels.length}, minmax(0, 1fr))` }}>
                {reels.map((k, r) => <span key={r}>{kindLabel(k)}</span>)}
              </div>
              <div className="sl-tray" aria-hidden="true" />
            </div>
            <button ref={leverRef} type="button" className="sl-lever" onClick={spin} disabled={spinning || !!blocker} aria-label={t('slot.pull')}>
              <span className="sl-lever-base" />
              <span className="sl-lever-arm"><span className="sl-lever-knob" /></span>
            </button>
          </div>

          {blocker && !spinning ? (
            <Notice text={blocker} action={config.mode === 'eliminate' && pool.available.length < studentReels && students.length >= studentReels
              ? <button type="button" className="rc-cut gm-btn" onClick={pool.reset}>{t('game.restartRound')}</button> : undefined} />
          ) : (
            <button type="button" className="rc-cut gm-btn gm-btn-primary sl-spin" onClick={spin} disabled={spinning}>
              {spinning ? t('slot.spinning') : t('slot.spin')}
            </button>
          )}
        </div>
      )}

      {phase === 'summary' && <Summary rounds={rounds} onNew={() => { setDraft(config); setPhase('setup'); }} onExit={onExit} />}

      {result && (
        <ResultOverlay island={island} kicker={t('slot.jackpot')} text={result.text} burstKey={result.burst}
          chips={result.chips.map(label => ({ label }))}
          actions={<>
            <button type="button" className="rc-cut gm-btn gm-btn-primary" disabled={!!blocker} onClick={() => { setResult(null); spin(); }}>{t('slot.spinAgain')}</button>
            <button type="button" className="rc-cut gm-btn" onClick={() => setResult(null)}>{t('game.continue')}</button>
          </>} />
      )}
    </GameShell>
  );
}

// Dice Asteroid — 3D Crystal Dice Rolling on an Asteroid Surface.
// Crypto-first randomness with mathematically precise 3D GSAP landing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { pickDistinct, randomInt } from '../../lib/random';
import { sfx } from '../../lib/sfx';
import {
  AnswerJudge,
  CommonSetup,
  Field,
  GameShell,
  Notice,
  Panel,
  Segmented,
  Stepper,
  Summary,
  type RoundLog,
} from '../shared/ui';
import { useIslandConfig, useJudgedAward, useLocalized, usePool } from '../shared/hooks';
import type { GameProps, PlayMode } from '../types';
import './dice.css';

type DieKind = 'student' | 'topic' | 'question' | 'points';
type DicePreset = '1s' | '2s' | '1s1t' | '1s1q' | '1s1p' | '3s' | 'custom';

interface DiceConfig {
  preset: DicePreset;
  diceKinds: DieKind[];
  mode: PlayMode;
  points: number;
}

const PRESET_KINDS: Record<Exclude<DicePreset, 'custom'>, DieKind[]> = {
  '1s': ['student'],
  '2s': ['student', 'student'],
  '1s1t': ['student', 'topic'],
  '1s1q': ['student', 'question'],
  '1s1p': ['student', 'points'],
  '3s': ['student', 'student', 'topic'],
};

const DEFAULTS: DiceConfig = {
  preset: '1s1t',
  diceKinds: PRESET_KINDS['1s1t'],
  mode: 'eliminate',
  points: 1,
};

interface FaceData {
  pipCount: number;
  label: string;
  subLabel?: string;
  studentId?: string;
  pointsDelta?: number;
}

const BASE_ROTATIONS = [
  { rx: 0, ry: 0 },       // Face 1: Front
  { rx: 0, ry: 180 },     // Face 2: Back
  { rx: 0, ry: -90 },     // Face 3: Right
  { rx: 0, ry: 90 },      // Face 4: Left
  { rx: -90, ry: 0 },     // Face 5: Top
  { rx: 90, ry: 0 },      // Face 6: Bottom
];

export function DiceAsteroidGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  useLocalized();
  const allStudents = useClassStore(s => s.students);
  const topics = useClassStore(s => s.topics);
  const questions = useClassStore(s => s.questions);
  const addHistory = useClassStore(s => s.addHistory);

  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const [config, setConfig] = useIslandConfig<DiceConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const pool = usePool(students, config.mode);

  const onSettled = useCallback((entry: RoundLog, points: number, studentIds: string[]) => {
    addHistory({ islandId: island.id, game: 'dice', summary: entry.text, studentIds, points });
    setRounds(r => [...r, entry]);
  }, [addHistory, island.id]);
  const { pending, setPending, judge } = useJudgedAward(onSettled);

  const studentDiceCount = config.diceKinds.filter(k => k === 'student').length;
  const blocker = studentDiceCount > 0 && students.length < studentDiceCount
    ? t('game.notEnoughStudents')
    : studentDiceCount > 0 && pool.available.length < studentDiceCount
    ? t('game.allPlayed')
    : null;

  const [diceFaces, setDiceFaces] = useState<FaceData[][]>([]);
  const [rolling, setRolling] = useState(false);

  const cubeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const impactRef = useRef<HTMLDivElement>(null);
  const rotState = useRef<{ rx: number; ry: number }[]>([]);

  const generateFacesForDie = (kind: DieKind, dieIdx: number, chosenStudents: typeof students): FaceData[] => {
    if (kind === 'student') {
      const poolCopy = [...pool.available];
      const otherStudents = poolCopy.filter(s => !chosenStudents.some(cs => cs.id === s.id));
      const studentPool = [chosenStudents[dieIdx] || poolCopy[0] || { id: '1', name: 'Student' }, ...otherStudents];

      return Array.from({ length: 6 }, (_, i) => {
        const st = studentPool[i % studentPool.length];
        return {
          pipCount: i + 1,
          label: st?.name || `Student ${i + 1}`,
          studentId: st?.id,
        };
      });
    }

    if (kind === 'topic') {
      const topList = topics.length ? topics : [{ id: '1', text: 'Space & Stars' }];
      return Array.from({ length: 6 }, (_, i) => ({
        pipCount: i + 1,
        label: topList[i % topList.length].text,
      }));
    }

    if (kind === 'question') {
      const qList = questions.length ? questions : [{ id: '1', text: 'Describe your best friend.' }];
      return Array.from({ length: 6 }, (_, i) => ({
        pipCount: i + 1,
        label: qList[i % qList.length].text,
      }));
    }

    // Points die
    const pts = [1, 2, 3, 4, 5, 6];
    return pts.map((p, i) => ({
      pipCount: i + 1,
      label: `+${p} PTS`,
      pointsDelta: p,
    }));
  };

  // Initialize dice faces on mount or config change
  useEffect(() => {
    const chosen = pickDistinct(pool.available, studentDiceCount);
    let stCount = 0;
    const initial = config.diceKinds.map((kind) => {
      const faces = generateFacesForDie(kind, stCount, chosen);
      if (kind === 'student') stCount++;
      return faces;
    });
    setDiceFaces(initial);
    rotState.current = config.diceKinds.map(() => ({ rx: 0, ry: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.diceKinds, config.preset, pool.available.length]);

  function rollDice() {
    if (rolling || blocker) return;
    setRolling(true);
    // 1. CRYPTO-FIRST: decide target face index for each die BEFORE animation starts
    const chosenStudents = pickDistinct(pool.available, studentDiceCount);
    let stCount = 0;
    const newDiceFaces = config.diceKinds.map(kind => {
      const faces = generateFacesForDie(kind, stCount, chosenStudents);
      if (kind === 'student') stCount++;
      return faces;
    });
    setDiceFaces(newDiceFaces);

    const winningFaceIndices = config.diceKinds.map(() => randomInt(6));
    const landedFaces = winningFaceIndices.map((faceIdx, dieIdx) => newDiceFaces[dieIdx][faceIdx]);

    sfx.whoosh();
    sfx.diceRoll();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 1.0 : 2.4;

    const tl = gsap.timeline({
      onComplete: () => {
        setRolling(false);
        finishRoll(landedFaces);
      },
    });

    cubeRefs.current.forEach((el, i) => {
      if (!el) return;
      const targetBase = BASE_ROTATIONS[winningFaceIndices[i]];
      // Add 2 to 4 full 360-degree rotations
      const extraSpinsX = (2 + randomInt(2)) * 360;
      const extraSpinsY = (2 + randomInt(2)) * 360;

      const current = rotState.current[i] || { rx: 0, ry: 0 };
      const targetRx = targetBase.rx + extraSpinsX;
      const targetRy = targetBase.ry + extraSpinsY;
      rotState.current[i] = { rx: targetRx % 360, ry: targetRy % 360 };

      tl.fromTo(
        el,
        {
          y: -180,
          scale: 0.8,
          rotationX: current.rx,
          rotationY: current.ry,
          rotationZ: -45,
        },
        {
          y: 0,
          scale: 1,
          rotationX: targetRx,
          rotationY: targetRy,
          rotationZ: 0,
          duration,
          ease: reduced ? 'power2.out' : 'bounce.out',
          onStart: () => {
            const ticker = window.setInterval(() => sfx.tick(), 140);
            setTimeout(() => clearInterval(ticker), (duration - 0.4) * 1000);
          },
        },
        i * 0.15
      );
    });

    if (impactRef.current) {
      tl.to(
        impactRef.current,
        {
          opacity: 0.8,
          duration: 0.12,
          yoyo: true,
          repeat: 1,
          ease: 'power2.inOut',
          onStart: () => sfx.ballClack(),
        },
        duration - 0.2
      );
    }
  }

  function finishRoll(landed: FaceData[]) {
    const studentItems = landed.filter(f => f.studentId);
    const studentIds = studentItems.map(f => f.studentId!);
    const studentNames = studentItems.map(f => f.label);

    const bonusPointsItem = landed.find(f => f.pointsDelta !== undefined);
    const extraPoints = bonusPointsItem?.pointsDelta || 0;
    const pointsAtStake = config.points + extraPoints;

    if (config.mode === 'eliminate' && studentIds.length) {
      pool.markUsed(studentIds);
    }

    const summaryText = landed.map(f => f.label).join(' · ');
    sfx.win();
    if (studentIds.length) {
      setPending({ studentIds, names: studentNames, points: pointsAtStake, summary: summaryText });
    } else {
      onSettled({ text: summaryText, chips: [] }, 0, []);
    }
  }

  function startGame(next: DiceConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
    setPhase('play');
  }

  const renderPips = (count: number, colorClass: string) => {
    return (
      <div className={`dc-pips dc-pips-${count}`}>
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={`dc-pip ${colorClass}`} />
        ))}
      </div>
    );
  };

  const status = phase === 'play' && studentDiceCount > 0
    ? (config.mode === 'eliminate' ? t('game.leftToPlay', { count: pool.available.length }) : t('game.everyoneStays'))
    : undefined;

  return (
    <GameShell
      island={island}
      title={t('dice.name')}
      status={status}
      onExit={onExit}
      onSettings={phase === 'play' && !rolling ? () => { setDraft(config); setPhase('setup'); } : undefined}
      onEnd={phase === 'play' && !rolling ? () => setPhase('summary') : undefined}
      history={phase === 'play' ? rounds : undefined}
      fit={phase === 'play'}
    >
      {phase === 'setup' && (
        <Panel
          title={t('game.setup')}
          footer={
            <button
              type="button"
              className="rc-cut gm-btn gm-btn-primary"
              onClick={() => startGame(draft)}
            >
              {t('game.start')}
            </button>
          }
        >
          <Field label={t('dice.presetLabel', { defaultValue: 'Dice Configuration' })}>
            <Segmented
              value={draft.preset}
              options={[
                { value: '1s', label: t('dice.preset1s') },
                { value: '2s', label: t('dice.preset2s') },
                { value: '1s1t', label: t('dice.preset1s1t') },
                { value: '1s1q', label: t('dice.preset1s1q') },
                { value: '1s1p', label: t('dice.preset1s1p') },
                { value: '3s', label: t('dice.preset3s') },
                { value: 'custom', label: t('dice.presetCustom') },
              ]}
              onChange={p =>
                setDraft(d => ({
                  ...d,
                  preset: p,
                  diceKinds: p === 'custom' ? d.diceKinds : PRESET_KINDS[p],
                }))
              }
            />
          </Field>

          {draft.preset === 'custom' && (
            <Field label={t('dice.diceCount')}>
              <Stepper
                value={draft.diceKinds.length}
                min={1}
                max={3}
                onChange={n =>
                  setDraft(d => ({
                    ...d,
                    diceKinds: Array.from({ length: n }, (_, i) => d.diceKinds[i] ?? 'student'),
                  }))
                }
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                {draft.diceKinds.map((k, i) => (
                  <label key={i} style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                      {t('dice.dieKind', { n: i + 1 })}
                    </span>
                    <select
                      className="gm-input"
                      value={k}
                      onChange={e => {
                        const val = e.target.value as DieKind;
                        setDraft(d => ({
                          ...d,
                          diceKinds: d.diceKinds.map((x, idx) => (idx === i ? val : x)),
                        }));
                      }}
                    >
                      <option value="student">{t('dice.kind_student')}</option>
                      <option value="topic">{t('dice.kind_topic')}</option>
                      <option value="question">{t('dice.kind_question')}</option>
                      <option value="points">{t('dice.kind_points')}</option>
                    </select>
                  </label>
                ))}
              </div>
            </Field>
          )}

          <CommonSetup
            mode={draft.mode}
            points={draft.points}
            onMode={m => setDraft(d => ({ ...d, mode: m }))}
            onPoints={p => setDraft(d => ({ ...d, points: p }))}
          />
        </Panel>
      )}

      {phase === 'play' && (
        <div className="dc-play">
          <div className="dc-arena">
            <div className="dc-arena-crater" />
            <div className="dc-arena-target" />
            <div ref={impactRef} className="dc-impact-flash" />

            <div className="dc-dice-stage">
              {config.diceKinds.map((_, dieIdx) => {
                const faces = diceFaces[dieIdx] || [];
                const colorClass = dieIdx === 0 ? '' : dieIdx === 1 ? 'dc-pip-gold' : 'dc-pip-pink';
                const faceColor = dieIdx === 0 ? 'dc-face-cyan' : dieIdx === 1 ? 'dc-face-gold' : 'dc-face-pink';

                return (
                  <div key={dieIdx} className="dc-die-scene">
                    <div
                      ref={el => { cubeRefs.current[dieIdx] = el; }}
                      className="dc-cube"
                    >
                      {/* Face 1: Front */}
                      <div className={`dc-face dc-face-front ${faceColor}`}>
                        <div className="dc-face-header">
                          <span>#{dieIdx + 1}</span>
                          <span>★</span>
                        </div>
                        <div className="dc-face-main">{faces[0]?.label || '★'}</div>
                        {renderPips(1, colorClass)}
                      </div>

                      {/* Face 2: Back */}
                      <div className={`dc-face dc-face-back ${faceColor}`}>
                        <div className="dc-face-header">
                          <span>#{dieIdx + 1}</span>
                          <span>★</span>
                        </div>
                        <div className="dc-face-main">{faces[1]?.label || '★'}</div>
                        {renderPips(2, colorClass)}
                      </div>

                      {/* Face 3: Right */}
                      <div className={`dc-face dc-face-right ${faceColor}`}>
                        <div className="dc-face-header">
                          <span>#{dieIdx + 1}</span>
                          <span>★</span>
                        </div>
                        <div className="dc-face-main">{faces[2]?.label || '★'}</div>
                        {renderPips(3, colorClass)}
                      </div>

                      {/* Face 4: Left */}
                      <div className={`dc-face dc-face-left ${faceColor}`}>
                        <div className="dc-face-header">
                          <span>#{dieIdx + 1}</span>
                          <span>★</span>
                        </div>
                        <div className="dc-face-main">{faces[3]?.label || '★'}</div>
                        {renderPips(4, colorClass)}
                      </div>

                      {/* Face 5: Top */}
                      <div className={`dc-face dc-face-top ${faceColor}`}>
                        <div className="dc-face-header">
                          <span>#{dieIdx + 1}</span>
                          <span>★</span>
                        </div>
                        <div className="dc-face-main">{faces[4]?.label || '★'}</div>
                        {renderPips(5, colorClass)}
                      </div>

                      {/* Face 6: Bottom */}
                      <div className={`dc-face dc-face-bottom ${faceColor}`}>
                        <div className="dc-face-header">
                          <span>#{dieIdx + 1}</span>
                          <span>★</span>
                        </div>
                        <div className="dc-face-main">{faces[5]?.label || '★'}</div>
                        {renderPips(6, colorClass)}
                      </div>
                    </div>
                    <div className="dc-die-shadow" />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dc-controls">
            {pending ? (
              <AnswerJudge names={pending.names} points={pending.points} summary={pending.summary} onJudge={judge} />
            ) : blocker && !rolling ? (
              <Notice
                text={blocker}
                action={
                  config.mode === 'eliminate' && pool.available.length < studentDiceCount ? (
                    <button type="button" className="rc-cut gm-btn" onClick={pool.reset}>
                      {t('game.restartRound')}
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <button
                type="button"
                className="rc-cut gm-btn gm-btn-primary"
                disabled={rolling}
                onClick={rollDice}
              >
                {rolling ? t('dice.rolling') : t('dice.roll')}
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <Summary
          rounds={rounds}
          onNew={() => { setDraft(config); setPhase('setup'); }}
          onExit={onExit}
        />
      )}

    </GameShell>
  );
}

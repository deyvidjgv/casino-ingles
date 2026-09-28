// Mystery Black Hole — Floating Mystery Boxes with 3D Reveal and Singularity Horizon.
// Crypto-first randomness with GSAP levitation, shake, and cosmic burst.
import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { pickDistinct, pickOne, randomInt } from '../../lib/random';
import { sfx } from '../../lib/sfx';
import {
  CommonSetup,
  Field,
  GameShell,
  Notice,
  Panel,
  ResultOverlay,
  Segmented,
  Stepper,
  Summary,
  type RoundLog,
} from '../shared/ui';
import { useIslandConfig, useLocalized, usePool } from '../shared/hooks';
import type { GameProps, PlayMode } from '../types';
import './mystery.css';

type ContentType = 'prizes' | 'students' | 'questions' | 'challenges' | 'mix';

interface MysteryConfig {
  boxCount: number;
  contentType: ContentType;
  mode: PlayMode;
  points: number;
}

const DEFAULTS: MysteryConfig = {
  boxCount: 4,
  contentType: 'mix',
  mode: 'eliminate',
  points: 2,
};

interface MysteryItem {
  id: string;
  tag: string;
  title: string;
  icon: string;
  studentId?: string;
  pointsDelta?: number;
}

const DEFAULT_CHALLENGES = [
  'Speak for 30s about your favorite food!',
  'Act out an action verb for the class to guess!',
  'Spell your full name backwards in English!',
  'Name 5 English adjectives describing your day!',
  'Recite a quick tongue twister: "She sells seashells"!',
  'Ask another student 2 questions in English!',
];

export function MysteryBlackHoleGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  useLocalized();
  const allStudents = useClassStore(s => s.students);
  const questions = useClassStore(s => s.questions);
  const addPoints = useClassStore(s => s.addPoints);
  const addHistory = useClassStore(s => s.addHistory);

  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const [config, setConfig] = useIslandConfig<MysteryConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const pool = usePool(students, config.mode);

  const requiresStudents = config.contentType === 'students' || config.contentType === 'mix';
  const blocker = requiresStudents && students.length === 0
    ? t('game.notEnoughStudents')
    : requiresStudents && pool.available.length === 0
    ? t('game.allPlayed')
    : null;

  // Box data and state
  const [boxes, setBoxes] = useState<{
    id: string;
    number: number;
    opened: boolean;
    opening: boolean;
    item: MysteryItem;
  }[]>([]);

  const [activeRevealed, setActiveRevealed] = useState<{ boxIdx: number; item: MysteryItem } | null>(null);
  const [result, setResult] = useState<{ text: string; chips: string[]; burst: number } | null>(null);

  const boxRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Generator for box contents using crypto
  const generateBoxItem = (type: ContentType, availableStudents: typeof students): MysteryItem => {
    if (type === 'students') {
      const student = availableStudents.length ? pickOne(availableStudents) : pickOne(students);
      return {
        id: crypto.randomUUID(),
        tag: t('mystery.type_students'),
        title: student?.name || 'Cosmic Student',
        icon: '👨‍🚀',
        studentId: student?.id,
      };
    }

    if (type === 'questions') {
      const qList = questions.length ? questions : [{ id: '1', text: 'Where would you travel in the universe?' }];
      const q = pickOne(qList);
      return {
        id: crypto.randomUUID(),
        tag: t('mystery.type_questions'),
        title: q.text,
        icon: '❓',
      };
    }

    if (type === 'challenges') {
      const ch = pickOne(DEFAULT_CHALLENGES);
      return {
        id: crypto.randomUUID(),
        tag: t('mystery.type_challenges'),
        title: ch,
        icon: '⚡',
      };
    }

    if (type === 'prizes') {
      const prizeRoll = randomInt(4);
      if (prizeRoll === 0) {
        return {
          id: crypto.randomUUID(),
          tag: t('mystery.type_prizes'),
          title: t('mystery.prize_points', { n: 5 }),
          icon: '💎',
          pointsDelta: 5,
        };
      } else if (prizeRoll === 1) {
        return {
          id: crypto.randomUUID(),
          tag: t('mystery.type_prizes'),
          title: t('mystery.prize_double'),
          icon: '✨',
          pointsDelta: 2,
        };
      } else if (prizeRoll === 2) {
        return {
          id: crypto.randomUUID(),
          tag: t('mystery.type_prizes'),
          title: t('mystery.prize_safe'),
          icon: '🛡️',
        };
      } else {
        return {
          id: crypto.randomUUID(),
          tag: t('mystery.type_prizes'),
          title: t('mystery.prize_star'),
          icon: '⭐',
          pointsDelta: 3,
        };
      }
    }

    // Mix type: pick one category randomly
    const categories: ContentType[] = ['prizes', 'challenges', 'questions'];
    if (availableStudents.length > 0) categories.push('students');
    const chosenCat = pickOne(categories);
    return generateBoxItem(chosenCat, availableStudents);
  };

  // Summon boxes
  const summonBoxes = () => {
    setActiveRevealed(null);
    setResult(null);

    const distinctStudents = requiresStudents ? pickDistinct(pool.available, Math.min(config.boxCount, pool.available.length)) : [];
    const newBoxes = Array.from({ length: config.boxCount }, (_, i) => ({
      id: crypto.randomUUID(),
      number: i + 1,
      opened: false,
      opening: false,
      item: generateBoxItem(config.contentType, distinctStudents),
    }));

    setBoxes(newBoxes);
    sfx.whoosh();
  };

  useEffect(() => {
    summonBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.boxCount, config.contentType, config.mode]);

  // Open a specific box
  function openBox(index: number) {
    const targetBox = boxes[index];
    if (!targetBox || targetBox.opened || targetBox.opening) return;

    // Trigger opening state
    setBoxes(prev => prev.map((b, i) => (i === index ? { ...b, opening: true } : b)));
    sfx.lever();

    const boxEl = boxRefs.current[index];
    if (boxEl) {
      // Tremble and levitate
      gsap.to(boxEl, {
        x: '+=6',
        yoyo: true,
        repeat: 5,
        duration: 0.08,
        ease: 'power1.inOut',
        onComplete: () => {
          gsap.to(boxEl, {
            scale: 1.15,
            duration: 0.35,
            ease: 'back.out(1.5)',
            onStart: () => {
              sfx.whoosh();
              sfx.win();
            },
            onComplete: () => {
              finishOpen(index, targetBox.item);
            },
          });
        },
      });
    } else {
      finishOpen(index, targetBox.item);
    }
  }

  function finishOpen(index: number, item: MysteryItem) {
    setBoxes(prev =>
      prev.map((b, i) => (i === index ? { ...b, opening: false, opened: true } : b))
    );
    setActiveRevealed({ boxIdx: index, item });

    const totalPts = (item.pointsDelta || 0) + config.points;
    const chips: string[] = [];

    if (item.studentId) {
      if (totalPts > 0) {
        addPoints([item.studentId], totalPts);
        chips.push(`${item.title} +${totalPts}`);
      }
      if (config.mode === 'eliminate') {
        pool.markUsed([item.studentId]);
      }
    } else if (item.pointsDelta) {
      chips.push(item.title);
    }

    const summaryText = `${t('mystery.boxNumber', { n: index + 1 })}: [${item.tag}] ${item.title}`;
    addHistory({
      islandId: island.id,
      game: 'mystery',
      summary: summaryText,
      studentIds: item.studentId ? [item.studentId] : [],
      points: totalPts,
    });
    setRounds(r => [...r, { text: summaryText }]);

    setResult({
      text: item.title,
      chips,
      burst: Date.now(),
    });
  }

  function startGame(next: MysteryConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
    setResult(null);
    setPhase('play');
  }

  const allOpened = boxes.length > 0 && boxes.every(b => b.opened);
  const status = phase === 'play' && requiresStudents
    ? (config.mode === 'eliminate' ? t('game.leftToPlay', { count: pool.available.length }) : t('game.everyoneStays'))
    : undefined;

  return (
    <GameShell
      island={island}
      title={t('mystery.name')}
      status={status}
      onExit={onExit}
      onSettings={phase === 'play' ? () => { setDraft(config); setPhase('setup'); } : undefined}
      onEnd={phase === 'play' ? () => setPhase('summary') : undefined}
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
          <Field label={t('mystery.contents')}>
            <Segmented
              value={draft.contentType}
              options={[
                { value: 'mix', label: t('mystery.type_mix') },
                { value: 'prizes', label: t('mystery.type_prizes') },
                { value: 'students', label: t('mystery.type_students') },
                { value: 'questions', label: t('mystery.type_questions') },
                { value: 'challenges', label: t('mystery.type_challenges') },
              ]}
              onChange={c => setDraft(d => ({ ...d, contentType: c }))}
            />
          </Field>

          <Field label={t('mystery.boxCount')}>
            <Stepper
              value={draft.boxCount}
              min={3}
              max={6}
              onChange={boxCount => setDraft(d => ({ ...d, boxCount }))}
            />
          </Field>

          <CommonSetup
            mode={draft.mode}
            points={draft.points}
            onMode={m => setDraft(d => ({ ...d, mode: m }))}
            onPoints={p => setDraft(d => ({ ...d, points: p }))}
          />
        </Panel>
      )}

      {phase === 'play' && (
        <div className="my-play">
          <div className="my-arena">
            {/* Singularity background elements */}
            <div className="my-blackhole-disk" />
            <div className="my-blackhole-ring" />
            <div className="my-blackhole-core" />

            {/* Floating boxes */}
            <div className="my-boxes-stage">
              {boxes.map((b, idx) => {
                const floatClass = `my-float-${(idx % 6) + 1}`;
                return (
                  <div
                    key={b.id}
                    ref={el => { boxRefs.current[idx] = el; }}
                    className={`my-box-wrap ${floatClass} ${b.opened ? 'is-opened' : ''} ${b.opening ? 'is-opening' : ''}`}
                    onClick={() => openBox(idx)}
                  >
                    <div className="my-box-halo" />
                    <div className="my-box-3d">
                      <div className="my-box-lid" />
                      <div className="my-box-body">
                        <span className="my-box-icon">{b.opened ? '✨' : '🎁'}</span>
                        <span className="my-box-num">#{b.number}</span>
                        <span className="my-box-status">
                          {b.opened ? t('mystery.opened') : '???'}
                        </span>
                      </div>
                    </div>

                    {/* Content reveal card while active */}
                    {activeRevealed?.boxIdx === idx && (
                      <div className="rc-cut my-content-reveal">
                        <span className="my-reveal-tag">{b.item.tag}</span>
                        <div className="my-reveal-title">{b.item.title}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="my-controls">
            {allOpened ? (
              <button
                type="button"
                className="rc-cut gm-btn gm-btn-primary"
                onClick={summonBoxes}
              >
                {t('mystery.summonMore')}
              </button>
            ) : (
              <span style={{ fontSize: 14, color: 'var(--text-soft)' }}>
                {t('mystery.prompt')}
              </span>
            )}
          </div>

          {blocker && (
            <Notice
              text={blocker}
              action={
                config.mode === 'eliminate' ? (
                  <button type="button" className="rc-cut gm-btn" onClick={pool.reset}>
                    {t('game.restartRound')}
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      )}

      {phase === 'summary' && (
        <Summary
          rounds={rounds}
          onNew={() => { setDraft(config); setPhase('setup'); }}
          onExit={onExit}
        />
      )}

      {result && (
        <ResultOverlay
          island={island}
          kicker={t('mystery.resultKicker')}
          text={result.text}
          burstKey={result.burst}
          chips={result.chips.map(label => ({ label }))}
          actions={
            <>
              {!allOpened && (
                <button
                  type="button"
                  className="rc-cut gm-btn gm-btn-primary"
                  onClick={() => setResult(null)}
                >
                  {t('mystery.openAnother')}
                </button>
              )}
              <button
                type="button"
                className="rc-cut gm-btn"
                onClick={() => {
                  setResult(null);
                  summonBoxes();
                }}
              >
                {t('mystery.summonMore')}
              </button>
              <button type="button" className="rc-cut gm-btn" onClick={() => setResult(null)}>
                {t('game.continue')}
              </button>
            </>
          }
        />
      )}
    </GameShell>
  );
}

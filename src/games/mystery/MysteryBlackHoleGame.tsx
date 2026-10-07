// Mystery Black Hole — Floating Mystery Boxes with 3D Reveal and Singularity Horizon.
// Crypto-first randomness: one deal per board, then the boxes shuffle so none can be tracked.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { pickDistinct, shuffled } from '../../lib/random';
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
  studentId?: string;
  pointsDelta?: number;
  /** an empty box: opening it costs the turn and awards nothing */
  empty?: boolean;
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
  const addHistory = useClassStore(s => s.addHistory);

  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const [config, setConfig] = useIslandConfig<MysteryConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const pool = usePool(students, config.mode);

  const onSettled = useCallback((entry: RoundLog, points: number, studentIds: string[]) => {
    addHistory({ islandId: island.id, game: 'mystery', summary: entry.text, studentIds, points });
    setRounds(r => [...r, entry]);
  }, [addHistory, island.id]);
  const { pending, setPending, judge } = useJudgedAward(onSettled);

  const requiresStudents = config.contentType === 'students' || config.contentType === 'mix';
  const blocker = requiresStudents && students.length === 0
    ? t('game.notEnoughStudents')
    : requiresStudents && pool.available.length === 0
    ? t('game.allPlayed')
    : null;

  const [boxes, setBoxes] = useState<{
    id: string;
    number: number;
    opened: boolean;
    opening: boolean;
    item: MysteryItem;
  }[]>([]);

  const [activeRevealed, setActiveRevealed] = useState<{ boxId: string; item: MysteryItem } | null>(null);
  const [shuffling, setShuffling] = useState(false);

  const boxRefs = useRef<(HTMLDivElement | null)[]>([]);

  const closeAllBoxes = useCallback((cb?: () => void) => {
    setActiveRevealed(null);
    const nodes = boxRefs.current.filter(Boolean) as HTMLDivElement[];
    if (nodes.length) {
      gsap.to(nodes, { scale: 1, duration: 0.2, ease: 'power2.out' });
    }
    setBoxes(prev => {
      if (config.mode === 'eliminate') {
        return prev.filter(b => !b.opened).map(b => ({ ...b, opened: false, opening: false }));
      }
      return prev.map(b => ({ ...b, opened: false, opening: false }));
    });
    if (cb) setTimeout(cb, 250);
  }, [config.mode]);

  // One deal for the whole board, so no two boxes hold the same thing and some hold nothing.
  const buildItems = (type: ContentType, count: number, availableStudents: typeof students): MysteryItem[] => {
    const uid = () => crypto.randomUUID();
    const prizes = (): Omit<MysteryItem, 'id'>[] => [
      { tag: t('mystery.type_prizes'), title: t('mystery.prize_points', { n: 5 }), pointsDelta: 5 },
      { tag: t('mystery.type_prizes'), title: t('mystery.prize_star'), pointsDelta: 3 },
      { tag: t('mystery.type_prizes'), title: t('mystery.prize_double'), pointsDelta: 2 },
      { tag: t('mystery.type_prizes'), title: t('mystery.prize_safe') },
    ];
    const empty = (): Omit<MysteryItem, 'id'> => ({ tag: t('mystery.type_prizes'), title: t('mystery.empty'), empty: true });

    let deck: Omit<MysteryItem, 'id'>[];
    if (type === 'students') {
      const picked = pickDistinct(availableStudents.length ? availableStudents : students, count);
      deck = picked.map(st => ({ tag: t('mystery.type_students'), title: st.name, studentId: st.id }));
    } else if (type === 'questions') {
      const qList = questions.length ? questions : [{ id: '1', text: 'Where would you travel in the universe?' }];
      deck = pickDistinct(qList, count).map(q => ({ tag: t('mystery.type_questions'), title: q.text }));
    } else if (type === 'challenges') {
      deck = pickDistinct(DEFAULT_CHALLENGES, count).map(ch => ({ tag: t('mystery.type_challenges'), title: ch }));
    } else if (type === 'prizes') {
      // roughly a quarter of the board is a dud, so opening a box is a real gamble
      deck = [...prizes(), ...Array.from({ length: Math.max(1, Math.round(count / 4)) }, empty)];
    } else {
      const picked = pickDistinct(availableStudents, Math.max(1, Math.floor(count / 2)));
      deck = [
        ...picked.map(st => ({ tag: t('mystery.type_students'), title: st.name, studentId: st.id })),
        ...prizes(),
        ...pickDistinct(DEFAULT_CHALLENGES, 2).map(ch => ({ tag: t('mystery.type_challenges'), title: ch })),
        ...pickDistinct(questions, 2).map(q => ({ tag: t('mystery.type_questions'), title: q.text })),
        empty(),
      ];
    }

    // pad with empties rather than repeating a prize
    while (deck.length < count) deck.push(empty());
    return shuffled(deck).slice(0, count).map(item => ({ ...item, id: uid() }));
  };

  const summonBoxes = () => {
    setActiveRevealed(null);
    const nodes = boxRefs.current.filter(Boolean) as HTMLDivElement[];
    if (nodes.length) {
      gsap.set(nodes, { scale: 1, x: 0, y: 0 });
    }
    const distinctStudents = requiresStudents ? [...pool.available] : [];
    const items = buildItems(config.contentType, config.boxCount, distinctStudents);
    setBoxes(items.map((item, i) => ({
      id: crypto.randomUUID(),
      number: i + 1,
      opened: false,
      opening: false,
      item,
    })));
    sfx.whoosh();
  };

  useEffect(() => {
    summonBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.boxCount, config.contentType, config.mode]);

  /** Boxes trading places. Always closes and hides any reveals first! */
  function shuffleBoxes() {
    if (shuffling || boxes.length < 2 || pending !== null || boxes.some(b => b.opening)) return;

    // RULE: In any case, close all boxes before shuffling!
    setActiveRevealed(null);
    const nodes = boxRefs.current.filter(Boolean) as HTMLDivElement[];
    if (nodes.length) {
      gsap.to(nodes, { scale: 1, duration: 0.2, ease: 'power2.out' });
    }

    // In eliminate mode, remove opened boxes before shuffling
    const currentEligible = config.mode === 'eliminate'
      ? boxes.filter(b => !b.opened).map(b => ({ ...b, opened: false, opening: false }))
      : boxes.map(b => ({ ...b, opened: false, opening: false }));

    if (currentEligible.length < 2) {
      setBoxes(currentEligible);
      return;
    }

    setBoxes(currentEligible);
    setShuffling(true);
    sfx.whoosh();

    const PASSES = 5;
    const STEP = 3 / PASSES;
    let current = currentEligible;
    let pass = 0;

    const runPass = () => {
      const els = boxRefs.current.slice(0, current.length);
      if (els.some(el => !el)) {
        setShuffling(false);
        return;
      }
      const activeNodes = els as HTMLDivElement[];
      const order = shuffled(current.map((_, i) => i));
      const before = activeNodes.map(el => el.getBoundingClientRect());

      gsap.to(activeNodes, {
        x: (i: number) => before[order[i]].left - before[i].left,
        y: (i: number) => before[order[i]].top - before[i].top,
        duration: STEP,
        ease: pass === PASSES - 1 ? 'power2.out' : 'power1.inOut',
        onComplete: () => {
          const next = current.slice();
          current.forEach((b, i) => { next[order[i]] = b; });
          gsap.set(activeNodes, { x: 0, y: 0 });
          current = next;
          setBoxes(next);
          pass++;
          if (pass < PASSES) {
            sfx.tick();
            runPass();
          } else {
            setShuffling(false);
          }
        },
      });
    };

    // Give 250ms for lid and scale to return to completely closed state
    setTimeout(runPass, 250);
  }

  function openBox(index: number) {
    if (shuffling || pending !== null || boxes.some(b => b.opening)) return;
    const targetBox = boxes[index];
    if (!targetBox || targetBox.opened || targetBox.opening) return;

    // If another box is open, close it before opening the new one
    setActiveRevealed(null);
    boxRefs.current.forEach((el, idx) => {
      if (el && idx !== index) gsap.to(el, { scale: 1, duration: 0.2 });
    });

    setBoxes(prev => prev.map((b, i) => (i === index ? { ...b, opening: true } : b)));
    sfx.lever();

    const boxEl = boxRefs.current[index];
    if (!boxEl) {
      finishOpen(targetBox.id, targetBox.item);
      return;
    }
    gsap.timeline({ onComplete: () => finishOpen(targetBox.id, targetBox.item) })
      .to(boxEl, { x: '+=5', yoyo: true, repeat: 3, duration: 0.06, ease: 'power1.inOut' })
      .set(boxEl, { x: 0 })
      .to(boxEl, { scale: 1.1, duration: 0.2, ease: 'back.out(1.5)' });
  }

  function finishOpen(boxId: string, item: MysteryItem) {
    setBoxes(prev =>
      prev.map(b => (b.id === boxId ? { ...b, opening: false, opened: true } : b))
    );
    setActiveRevealed({ boxId, item });

    const pointsAtStake = item.empty ? 0 : (item.pointsDelta || 0) + config.points;
    const summaryText = `[${item.tag}] ${item.title}`;

    if (item.studentId && config.mode === 'eliminate') {
      pool.markUsed([item.studentId]);
    }

    if (item.studentId && pointsAtStake > 0) {
      setPending({ studentIds: [item.studentId], names: [item.title], points: pointsAtStake, summary: summaryText });
    } else {
      // an empty box, or one holding no student: nothing to judge
      onSettled({ text: summaryText, chips: [], saved: item.empty }, 0, []);
    }
  }

  const handleJudge = (verdict: Parameters<typeof judge>[0]) => {
    judge(verdict);
    closeAllBoxes();
  };

  function startGame(next: MysteryConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
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
                // Every box drifts on the same cycle: nothing may distinguish them before opening.
                const floatClass = shuffling ? '' : 'my-float';
                return (
                  <div
                    key={b.id}
                    ref={el => { boxRefs.current[idx] = el; }}
                    className={`my-box-wrap ${shuffling ? 'is-shuffling' : floatClass} ${b.opened ? 'is-opened' : ''} ${b.opening ? 'is-opening' : ''}`}
                    style={{ animationDelay: `${(idx % 4) * -0.7}s` }}
                    onClick={() => openBox(idx)}
                  >
                    <div className="my-box-halo" />
                    <div className="my-box-3d">
                      <div className="my-box-lid" />
                      <div className="my-box-body">
                        <span className="my-box-sigil" aria-hidden="true" />
                        <span className="my-box-status">
                          {b.opened ? t('mystery.opened') : '?'}
                        </span>
                      </div>
                    </div>

                    {/* Content reveal card while active */}
                    {activeRevealed?.boxId === b.id && (
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
            {pending ? (
              <AnswerJudge names={pending.names} points={pending.points} summary={pending.summary} onJudge={handleJudge} />
            ) : allOpened ? (
              <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={summonBoxes}>
                {t('mystery.summonMore')}
              </button>
            ) : (
              <>
                <span className="my-prompt">{t('mystery.prompt')}</span>
                <button
                  type="button"
                  className="rc-cut gm-btn"
                  onClick={shuffleBoxes}
                  disabled={shuffling || boxes.length < 2 || pending !== null || boxes.some(b => b.opening)}
                >
                  {shuffling ? t('mystery.shuffling') : t('mystery.shuffle')}
                </button>
                <button
                  type="button"
                  className="rc-cut gm-btn"
                  onClick={summonBoxes}
                  disabled={shuffling || pending !== null || boxes.some(b => b.opening)}
                >
                  {t('mystery.summonMore')}
                </button>
              </>
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

    </GameShell>
  );
}

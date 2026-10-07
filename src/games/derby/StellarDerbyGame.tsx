// Stellar Derby — a Greek hippodrome where the class races.
// Tapping keeps a horse moving, but the race is decided by English.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClassStore, type Student } from '../../store/classStore';
import { pickDistinct, pickOne, shuffled } from '../../lib/random';
import { sfx } from '../../lib/sfx';
import {
  AnswerJudge, Field, GameShell, Notice, Panel, Segmented, Stepper, Summary, type RoundLog,
} from '../shared/ui';
import { useIslandConfig, useJudgedAward } from '../shared/hooks';
import type { GameProps, PlayMode } from '../types';
import { Track, type Rider } from './Track';
import { HORSE, HORSE_COLORS, type HorseColor } from './scene';
import {
  initServerTimeOffset,
  getServerTime,
  publishRaceState,
  updateRaceState,
  publishPositions,
  subscribeStudentTaps,
  subscribeHands,
  clearHands,
  subscribeLiveBets,
  subscribeRaceState,
  type LiveRaceState,
  type LiveRiderInfo,
  type ControlMode,
  type QuestionMode,
} from './derbySync';
import { subscribeCoursePresence } from '../../lib/presence';
import './derby.css';

type Phase = 'setup' | 'lobby' | 'countdown' | 'running' | 'question' | 'resumeCountdown' | 'finish' | 'summary';
type Length = 'short' | 'medium' | 'long';

interface DerbyConfig {
  lanes: number;
  mode: PlayMode;
  controlMode: ControlMode;
  questionMode: QuestionMode;
  points: number;
  winPoints: number;
  length: Length;
  betting: boolean;
  betPoints: number;
}

const DEFAULTS: DerbyConfig = {
  lanes: 4,
  mode: 'eliminate',
  controlMode: 'phones',
  questionMode: 'manual',
  points: 2,
  winPoints: 3,
  length: 'medium',
  betting: true,
  betPoints: 1,
};

const MIN_TAP_MS = 100;
const TAP_IMPULSE = 0.0048;
const DRAG = 1.4;
const BASE_SPEED = 0.006;
const BOOST_BASE = 0.085;
const BOOST_PER_POINT = 0.032;
const BOOST_SECONDS = 1.1;
const LENGTH_SCALE: Record<Length, number> = { short: 1.3, medium: 1, long: 0.8 };

interface RaceState {
  progress: number[];
  rawProgress: number[];
  velocity: number[];
  stride: number[];
  lastTap: number[];
  boostLeft: number[];
  boostRate: number[];
}

const freshRace = (n: number): RaceState => ({
  progress: Array(n).fill(0),
  rawProgress: Array(n).fill(0),
  velocity: Array(n).fill(0),
  stride: Array(n).fill(0),
  lastTap: Array(n).fill(0),
  boostLeft: Array(n).fill(0),
  boostRate: Array(n).fill(0),
});

export function StellarDerbyGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  const allStudents = useClassStore(s => s.students);
  const questions = useClassStore(s => s.questions);
  const addHistory = useClassStore(s => s.addHistory);
  const addPoints = useClassStore(s => s.addPoints);
  const courseId = useClassStore(s => s.courseId);

  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const [config, setConfig] = useIslandConfig<DerbyConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<Phase>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const [onlineUids, setOnlineUids] = useState<Set<string>>(new Set());
  const [riders, setRiders] = useState<Rider[]>([]);
  const [bets, setBets] = useState<Record<string, HorseColor>>({});
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [raced, setRaced] = useState<ReadonlySet<string>>(() => new Set());

  const [count, setCount] = useState(3);
  const [question, setQuestion] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [paid, setPaid] = useState(false);
  const [currentRaceId, setCurrentRaceId] = useState('');
  const [raisedHands, setRaisedHands] = useState<Record<string, number>>({});
  const [liveRiderStates, setLiveRiderStates] = useState<Record<string, { ready: boolean }>>({});

  const race = useRef<RaceState>(freshRace(0));
  const triggeredCheckpoints = useRef<Set<number>>(new Set());
  const lastPublishedPos = useRef(0);
  const lastProcessedTaps = useRef<Record<string, { count: number; lastTime: number }>>({});
  const [laneBps, setLaneBps] = useState<number[]>([]);

  const [view, setView] = useState<{ progress: number[]; frame: number[]; boosting: boolean[] }>({
    progress: [],
    frame: [],
    boosting: [],
  });

  useEffect(() => {
    initServerTimeOffset();
  }, []);

  // Track online presence of registered students
  useEffect(() => {
    if (!courseId) return;
    return subscribeCoursePresence(courseId, setOnlineUids);
  }, [courseId]);

  // Subscribe to live state updates (to see rider ready status)
  useEffect(() => {
    if (!courseId) return;
    return subscribeRaceState(courseId, state => {
      if (state?.riders) {
        const map: Record<string, { ready: boolean }> = {};
        for (const [uid, r] of Object.entries(state.riders)) {
          map[uid] = { ready: r.ready };
        }
        setLiveRiderStates(map);
      }
    });
  }, [courseId]);

  // Sync spectator bets
  useEffect(() => {
    if (!courseId || !config.betting) return;
    return subscribeLiveBets(courseId, liveBets => {
      setBets(prev => ({ ...prev, ...liveBets }));
    });
  }, [courseId, config.betting]);

  // Sync hands during question freeze
  useEffect(() => {
    if (!courseId || phase !== 'question') return;
    return subscribeHands(courseId, setRaisedHands);
  }, [courseId, phase]);

  const eligible = useMemo(() => {
    const base = config.mode === 'eliminate' ? students.filter(s => !raced.has(s.id)) : students;
    if (config.controlMode === 'phones') {
      return base.filter(s => s.type !== 'manual' && (s.uid ? onlineUids.has(s.uid) : onlineUids.has(s.id)));
    }
    return base;
  }, [students, raced, config.mode, config.controlMode, onlineUids]);

  const spectators = useMemo(
    () => students.filter(s => !riders.some(r => r.studentId === s.id)),
    [students, riders],
  );

  const betTally = useMemo(() => {
    const tally: Partial<Record<HorseColor, number>> = {};
    for (const color of Object.values(bets)) tally[color] = (tally[color] ?? 0) + 1;
    return tally;
  }, [bets]);

  const onSettled = useCallback((entry: RoundLog, points: number, studentIds: string[]) => {
    addHistory({ islandId: island.id, game: 'derby', summary: entry.text, studentIds, points });
    setRounds(r => [...r, entry]);
  }, [addHistory, island.id]);
  const { pending, setPending, judge } = useJudgedAward(onSettled);

  /* ---------- publish to RTDB helper ---------- */
  const syncToRTDB = useCallback((nextPhase: LiveRaceState['phase'], extra?: Partial<LiveRaceState>) => {
    if (!courseId) return;
    const riderMap: Record<string, LiveRiderInfo> = {};
    riders.forEach((r, i) => {
      const uid = r.studentId;
      riderMap[uid] = {
        uid,
        studentId: r.studentId,
        name: r.name,
        lane: i,
        color: r.color,
        ready: liveRiderStates[uid]?.ready ?? false,
      };
    });

    const liveState: LiveRaceState = {
      raceId: currentRaceId,
      phase: nextPhase,
      controlMode: config.controlMode,
      questionMode: config.questionMode,
      riders: riderMap,
      startAt: extra?.startAt ?? 0,
      currentQuestion: question,
      results: extra?.results ?? null,
      betting: config.betting,
      betPoints: config.betPoints,
      winPoints: config.winPoints,
      questionPoints: config.points,
      activeQuestionNominee: extra?.activeQuestionNominee ?? null,
      turboUid: extra?.turboUid ?? null,
      turboPoints: extra?.turboPoints ?? 0,
      updatedAt: Date.now(),
      ...extra,
    };
    void publishRaceState(courseId, liveState);
  }, [courseId, riders, currentRaceId, config, question, liveRiderStates]);

  /* ---------- lobby ---------- */

  const drawRiders = useCallback((pool: Student[], lanes: number) => {
    const chosen = pickDistinct(pool, Math.min(lanes, pool.length));
    const colors = shuffled(HORSE_COLORS).slice(0, chosen.length);
    const newRiders = chosen.map((s, i) => ({ studentId: s.uid || s.id, name: s.name, color: colors[i] }));
    setRiders(newRiders);
    setBets({});
    setPicked(new Set());
    setLiveRiderStates({});
    return newRiders;
  }, []);

  const openLobby = useCallback((lanes = config.lanes) => {
    const newRaceId = crypto.randomUUID();
    setCurrentRaceId(newRaceId);
    triggeredCheckpoints.current.clear();
    lastProcessedTaps.current = {};
    const drawn = drawRiders(eligible, lanes);
    setOrder([]);
    setPaid(false);
    setAsked(0);
    setQuestion(null);
    setPending(null);
    setPhase('lobby');

    if (courseId) {
      const riderMap: Record<string, LiveRiderInfo> = {};
      drawn.forEach((r, i) => {
        riderMap[r.studentId] = {
          uid: r.studentId,
          studentId: r.studentId,
          name: r.name,
          lane: i,
          color: r.color,
          ready: false,
        };
      });
      void publishRaceState(courseId, {
        raceId: newRaceId,
        phase: 'lobby',
        controlMode: config.controlMode,
        questionMode: config.questionMode,
        riders: riderMap,
        startAt: 0,
        currentQuestion: null,
        results: null,
        betting: config.betting,
        betPoints: config.betPoints,
        winPoints: config.winPoints,
        questionPoints: config.points,
        activeQuestionNominee: null,
        turboUid: null,
        turboPoints: 0,
        updatedAt: Date.now(),
      });
    }
  }, [drawRiders, eligible, config, setPending, courseId]);

  const rerollRider = useCallback((index: number) => {
    const taken = new Set(riders.map(r => r.studentId));
    const bench = eligible.filter(s => !taken.has(s.uid || s.id));
    if (!bench.length) return;
    const next = pickOne(bench);
    sfx.click();
    const updated = riders.map((r, i) => (i === index ? { ...r, name: next.name, studentId: next.uid || next.id } : r));
    setRiders(updated);

    if (courseId) {
      const riderMap: Record<string, LiveRiderInfo> = {};
      updated.forEach((r, i) => {
        riderMap[r.studentId] = {
          uid: r.studentId,
          studentId: r.studentId,
          name: r.name,
          lane: i,
          color: r.color,
          ready: false,
        };
      });
      void updateRaceState(courseId, { riders: riderMap });
    }
  }, [riders, eligible, courseId]);

  /* ---------- race start and countdown ---------- */

  const start = useCallback(() => {
    race.current = freshRace(riders.length);
    triggeredCheckpoints.current.clear();
    setLaneBps(Array(riders.length).fill(0));
    setView({
      progress: Array(riders.length).fill(0),
      frame: Array(riders.length).fill(0),
      boosting: Array(riders.length).fill(false),
    });
    setCount(3);
    setPhase('countdown');

    const startAt = getServerTime() + 3200;
    syncToRTDB('countdown', { startAt });
  }, [riders.length, syncToRTDB]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    sfx.tick();
    const id = setTimeout(() => {
      if (count > 1) {
        setCount(c => c - 1);
      } else {
        // Reset base tap counters so taps during countdown do NOT count
        const now = performance.now();
        riders.forEach(r => {
          lastProcessedTaps.current[r.studentId] = { count: 0, lastTime: now };
        });
        setPhase('running');
        syncToRTDB('running');
      }
    }, 1000);
    return () => clearTimeout(id);
  }, [phase, count, riders, syncToRTDB]);

  /* ---------- tapping authority ---------- */

  const tap = useCallback((lane: number) => {
    if (phase !== 'running') return;
    const r = race.current;
    const now = performance.now();
    if (now - r.lastTap[lane] < MIN_TAP_MS) return; // fairness cap
    r.lastTap[lane] = now;
    r.velocity[lane] += TAP_IMPULSE;
  }, [phase]);

  // Process incoming taps from student phones via RTDB
  useEffect(() => {
    if (phase !== 'running' || !courseId || config.controlMode !== 'phones') return;
    const unsub = subscribeStudentTaps(courseId, tapData => {
      const now = performance.now();
      riders.forEach((r, lane) => {
        const studentTap = tapData[r.studentId];
        if (studentTap && studentTap.raceId === currentRaceId) {
          const prev = lastProcessedTaps.current[r.studentId] ?? { count: 0, lastTime: now - 150 };
          const delta = studentTap.count - prev.count;
          if (delta > 0) {
            const elapsedSec = Math.max(0.1, (now - prev.lastTime) / 1000);
            const maxAllowed = Math.ceil(elapsedSec * 10); // max 10 taps/sec
            const validDelta = Math.min(delta, maxAllowed);
            race.current.velocity[lane] += validDelta * TAP_IMPULSE;
            lastProcessedTaps.current[r.studentId] = { count: studentTap.count, lastTime: now };
            setLaneBps(prevBps => {
              const next = [...prevBps];
              next[lane] = Math.round(validDelta / elapsedSec);
              return next;
            });
          }
        }
      });
    });
    return () => unsub();
  }, [phase, courseId, config.controlMode, riders, currentRaceId]);

  /* ---------- questions ---------- */

  const askQuestion = useCallback(() => {
    if (!questions.length) return;
    sfx.click();
    const qText = pickOne(questions).text;
    setQuestion(qText);
    setAsked(a => a + 1);
    setPhase('question');
    if (courseId) void clearHands(courseId);
    syncToRTDB('question', { currentQuestion: qText });
  }, [questions, courseId, syncToRTDB]);

  /* ---------- race physics loop ---------- */

  useEffect(() => {
    if (phase !== 'running') return;
    const scale = LENGTH_SCALE[config.length];
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = race.current;
      let finished = -1;

      for (let i = 0; i < r.progress.length; i++) {
        r.velocity[i] = Math.max(0, r.velocity[i] - r.velocity[i] * DRAG * dt);
        let speed = (BASE_SPEED + r.velocity[i]) * scale;
        if (r.boostLeft[i] > 0) {
          r.boostLeft[i] = Math.max(0, r.boostLeft[i] - dt);
          speed += r.boostRate[i];
        }
        r.rawProgress[i] += speed * dt;
        r.progress[i] = Math.min(1, r.rawProgress[i]);
        r.stride[i] += (5 + speed * 900) * dt;

        if (r.rawProgress[i] >= 1 && finished < 0) {
          finished = i;
        }
      }

      setView({
        progress: [...r.progress],
        frame: r.stride.map(s => Math.floor(s) % 2),
        boosting: r.boostLeft.map(b => b > 0),
      });

      // Throttle publishing positions to RTDB ~8 times per second (125 ms)
      if (courseId && now - lastPublishedPos.current > 125) {
        lastPublishedPos.current = now;
        const posMap: Record<number, number> = {};
        r.progress.forEach((p, idx) => { posMap[idx] = Math.round(p * 1000) / 1000; });
        void publishPositions(courseId, posMap);
      }

      // Auto checkpoints (at 25%, 50%, 75% of leader)
      if (config.questionMode === 'auto' && questions.length > 0) {
        const leaderRaw = Math.max(...r.rawProgress);
        for (const cp of [0.25, 0.5, 0.75]) {
          if (leaderRaw >= cp && !triggeredCheckpoints.current.has(cp)) {
            triggeredCheckpoints.current.add(cp);
            askQuestion();
            return;
          }
        }
      }

      if (finished >= 0) {
        // Precise unclipped tie-breaker: sort by rawProgress (who crossed furthest)
        const ranked = [...r.rawProgress.keys()].sort((a, b) => r.rawProgress[b] - r.rawProgress[a]);
        setOrder(ranked);
        sfx.win();
        setPhase('finish');

        const podiumResults = ranked.slice(0, Math.min(3, riders.length)).map((lane, i) => ({
          uid: riders[lane]?.studentId ?? '',
          lane,
          name: riders[lane]?.name ?? '',
          pos: i + 1,
          points: Math.max(0, config.winPoints - i),
        }));

        syncToRTDB('finish', {
          results: {
            championUid: riders[ranked[0]]?.studentId,
            podium: podiumResults,
          },
        });
        return;
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, config.length, config.questionMode, config.winPoints, questions.length, courseId, riders, syncToRTDB, askQuestion]);

  // Keys 1–6 (and Q for question) drive the lanes when sharing one screen
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // IGNORE REPEAT!
      if (e.key === 'q' || e.key === 'Q') {
        askQuestion();
        return;
      }
      const lane = Number(e.key) - 1;
      if (Number.isInteger(lane) && lane >= 0 && lane < riders.length) {
        e.preventDefault();
        tap(lane);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, riders.length, tap, askQuestion]);

  const resume = useCallback(() => {
    setQuestion(null);
    setPending(null);
    if (courseId) void clearHands(courseId);

    // Show a short "Ready... GO!" before unfreezing
    setPhase('resumeCountdown');
    const timer = setTimeout(() => {
      // Re-anchor student tap counts so taps before GO do NOT count
      const now = performance.now();
      riders.forEach(r => {
        const last = lastProcessedTaps.current[r.studentId]?.count ?? 0;
        lastProcessedTaps.current[r.studentId] = { count: last, lastTime: now };
      });
      setPhase('running');
      syncToRTDB('running');
    }, 1500);
    return () => clearTimeout(timer);
  }, [setPending, courseId, riders, syncToRTDB]);

  const nominate = useCallback((index: number) => {
    const rider = riders[index];
    if (!rider) return;
    sfx.click();
    setPending({
      studentIds: [rider.studentId],
      names: [rider.name],
      points: config.points,
      summary: t('derby.answered', { name: rider.name }),
    });
    if (courseId) {
      void updateRaceState(courseId, { activeQuestionNominee: rider.studentId });
    }
  }, [riders, config.points, setPending, courseId, t]);

  const boostedFor = pending?.studentIds[0];
  const judgeAndResume = useCallback((verdict: Parameters<typeof judge>[0]) => {
    if (verdict === 'correct' && boostedFor) {
      const lane = riders.findIndex(r => r.studentId === boostedFor);
      if (lane >= 0) {
        const r = race.current;
        r.boostLeft[lane] = BOOST_SECONDS;
        r.boostRate[lane] = (BOOST_BASE + BOOST_PER_POINT * config.points) / BOOST_SECONDS;
      }
      sfx.correct();
      if (courseId) {
        void updateRaceState(courseId, { turboUid: boostedFor, turboPoints: config.points });
      }
    } else if (verdict === 'wrong') {
      sfx.wrong();
    }
    judge(verdict);
    resume();
  }, [boostedFor, riders, config.points, judge, resume, courseId]);

  /* ---------- finish & payout ---------- */

  const podium = useMemo(() => order.slice(0, Math.min(3, riders.length)), [order, riders.length]);
  const podiumPoints = useMemo(
    () => podium.map((_, i) => Math.max(0, config.winPoints - i)),
    [podium, config.winPoints],
  );

  const winnerColor = riders[order[0]]?.color;
  const winningBackers = useMemo(
    () => (config.betting && winnerColor
      ? Object.entries(bets).filter(([, c]) => c === winnerColor).map(([id]) => id)
      : []),
    [bets, winnerColor, config.betting],
  );

  const paidRef = useRef(false);
  const payOut = useCallback(() => {
    if (paidRef.current) return;
    paidRef.current = true;
    setPaid(true);
    sfx.saved();

    const chips: string[] = [];
    podium.forEach((lane, i) => {
      const rider = riders[lane];
      const pts = podiumPoints[i];
      if (rider && pts > 0) {
        addPoints([rider.studentId], pts);
        chips.push(`${rider.name} +${pts}`);
      }
    });
    if (winningBackers.length && config.betPoints > 0) {
      addPoints(winningBackers, config.betPoints);
      chips.push(t('derby.backersPaid', { count: winningBackers.length, points: config.betPoints }));
    }

    const champion = riders[order[0]];
    const summary = t('derby.raceWon', { name: champion?.name ?? '—' });
    addHistory({
      islandId: island.id, game: 'derby', summary,
      studentIds: podium.map(l => riders[l]?.studentId).filter(Boolean) as string[],
      points: podiumPoints[0] ?? 0,
    });
    setRounds(r => [...r, { text: summary, chips }]);
    if (config.mode === 'eliminate') {
      setRaced(prev => new Set([...prev, ...riders.map(r => r.studentId)]));
    }
  }, [podium, podiumPoints, riders, order, winningBackers, config.betPoints, config.mode,
      addPoints, addHistory, island.id, t]);

  useEffect(() => { paidRef.current = false; }, [order]);

  // Clean close on unmount or exit
  useEffect(() => {
    return () => {
      if (courseId) void updateRaceState(courseId, { phase: 'closed' });
    };
  }, [courseId]);

  /* ---------- betting ---------- */

  const placeBets = useCallback((color: HorseColor) => {
    if (!picked.size) return;
    sfx.click();
    setBets(prev => {
      const next = { ...prev };
      picked.forEach(id => { next[id] = color; });
      return next;
    });
    setPicked(new Set());
  }, [picked]);

  const togglePick = useCallback((id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ---------- render ---------- */

  const blocker = config.controlMode === 'phones' && eligible.length < 2
    ? t('derby.notEnoughOnline')
    : students.length < 2
    ? t('game.notEnoughStudents')
    : eligible.length < 2
    ? t('game.allPlayed')
    : null;

  // Ordered list of raised hands
  const orderedHands = useMemo(() => {
    return Object.entries(raisedHands)
      .sort(([, a], [, b]) => a - b)
      .map(([uid]) => uid);
  }, [raisedHands]);

  const allReady = riders.length > 0 && riders.every(r => liveRiderStates[r.studentId]?.ready);

  if (phase === 'setup') {
    return (
      <GameShell island={island} title={t('derby.name')} onExit={onExit}>
        <Panel
          title={t('game.settings')}
          wide
          footer={
            <>
              <button
                type="button"
                className="rc-cut gm-btn gm-btn-primary"
                disabled={!!blocker}
                onClick={() => { setConfig(draft); sfx.click(); openLobby(draft.lanes); }}
              >
                {t('derby.toLobby')}
              </button>
              <button type="button" className="rc-cut gm-btn" onClick={onExit}>{t('game.backToMap')}</button>
            </>
          }
        >
          <Field label={t('derby.controlMode')}>
            <Segmented
              value={draft.controlMode}
              onChange={controlMode => setDraft(d => ({ ...d, controlMode }))}
              options={[
                { value: 'phones', label: t('derby.controlModePhones') },
                { value: 'single', label: t('derby.controlModeSingle') },
              ]}
            />
          </Field>

          <Field label={t('derby.questionMode')}>
            <Segmented
              value={draft.questionMode}
              onChange={questionMode => setDraft(d => ({ ...d, questionMode }))}
              options={[
                { value: 'auto', label: t('derby.questionModeAuto') },
                { value: 'manual', label: t('derby.questionModeManual') },
              ]}
            />
          </Field>

          <Field label={t('derby.lanes')} hint={t('derby.lanesHint')}>
            <Stepper value={draft.lanes} min={2} max={6} onChange={lanes => setDraft(d => ({ ...d, lanes }))} />
          </Field>
          <Field label={t('derby.length')}>
            <Segmented
              value={draft.length}
              onChange={length => setDraft(d => ({ ...d, length }))}
              options={[
                { value: 'short', label: t('derby.lengthShort'), hint: t('derby.lengthShortHint') },
                { value: 'medium', label: t('derby.lengthMedium'), hint: t('derby.lengthMediumHint') },
                { value: 'long', label: t('derby.lengthLong'), hint: t('derby.lengthLongHint') },
              ]}
            />
          </Field>
          <Field label={t('game.mode')}>
            <Segmented
              value={draft.mode}
              onChange={mode => setDraft(d => ({ ...d, mode }))}
              options={[
                { value: 'eliminate', label: t('game.modeEliminate'), hint: t('derby.modeEliminateHint') },
                { value: 'keep', label: t('game.modeKeep'), hint: t('game.modeKeepHint') },
              ]}
            />
          </Field>
          <Field label={t('derby.answerPoints')} hint={t('derby.answerPointsHint')}>
            <Stepper value={draft.points} min={0} max={10} onChange={points => setDraft(d => ({ ...d, points }))} />
          </Field>
          <Field label={t('derby.winPoints')}>
            <Stepper value={draft.winPoints} min={0} max={10} onChange={winPoints => setDraft(d => ({ ...d, winPoints }))} />
          </Field>
          <Field label={t('derby.betting')} hint={t('derby.bettingHint')}>
            <Segmented
              value={draft.betting ? 'on' : 'off'}
              onChange={v => setDraft(d => ({ ...d, betting: v === 'on' }))}
              options={[{ value: 'on', label: t('derby.bettingOn') }, { value: 'off', label: t('derby.bettingOff') }]}
            />
          </Field>
          {draft.betting && (
            <Field label={t('derby.betPoints')}>
              <Stepper value={draft.betPoints} min={0} max={5} onChange={betPoints => setDraft(d => ({ ...d, betPoints }))} />
            </Field>
          )}
          {blocker && <Notice text={blocker} />}
        </Panel>
      </GameShell>
    );
  }

  if (phase === 'lobby') {
    return (
      <GameShell island={island} title={t('derby.name')} onExit={onExit} onSettings={() => setPhase('setup')} history={rounds}>
        <Panel
          title={t('derby.lobbyTitle')}
          wide
          footer={
            <>
              <button
                type="button"
                className={`rc-cut gm-btn gm-btn-primary ${allReady || config.controlMode === 'single' ? '' : 'is-warning'}`}
                onClick={() => { sfx.lever(); start(); }}
              >
                {allReady || config.controlMode === 'single' ? t('derby.start') : t('derby.startAnyway')}
              </button>
              <button type="button" className="rc-cut gm-btn" onClick={() => { sfx.click(); drawRiders(eligible, config.lanes); }}>
                {t('derby.redraw')}
              </button>
              <button type="button" className="rc-cut gm-btn" onClick={() => setPhase('setup')}>{t('game.settings')}</button>
            </>
          }
        >
          <Field label={t('derby.field')} hint={t('derby.fieldHint')}>
            <div className="dv-riders">
              {riders.map((r, i) => {
                const isOnline = onlineUids.has(r.studentId);
                const isReady = liveRiderStates[r.studentId]?.ready;
                return (
                  <button key={r.studentId} type="button" className="rc-cut dv-rider" onClick={() => rerollRider(i)}>
                    <span className="dv-swatch" style={{ background: HORSE[r.color].glow, color: HORSE[r.color].glow }} />
                    <span className="dv-lane-n">{i + 1}</span>
                    <span>{r.name}</span>
                    {config.controlMode === 'phones' && (
                      <span
                        className="dv-status-dot"
                        title={isReady ? t('derby.ready') : isOnline ? t('derby.online') : t('derby.offline')}
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          marginLeft: 6,
                          background: isReady ? '#06D6A0' : isOnline ? '#4CC9F0' : '#EF476F',
                          boxShadow: `0 0 6px ${isReady ? '#06D6A0' : isOnline ? '#4CC9F0' : '#EF476F'}`,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {config.controlMode === 'phones' && !allReady && (
              <p style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 8 }}>
                ℹ️ {t('derby.waitingReady')}
              </p>
            )}
          </Field>

          {config.betting && (
            <Field label={t('derby.betsTitle')} hint={t('derby.betsHint')}>
              <div className="dv-bets">
                {riders.map(r => (
                  <button key={r.color} type="button" className="rc-cut dv-bet" disabled={!picked.size}
                    onClick={() => placeBets(r.color)}>
                    <span className="dv-swatch" style={{ background: HORSE[r.color].glow, color: HORSE[r.color].glow }} />
                    <span>{r.name}</span>
                    <span className="dv-bet-n">{betTally[r.color] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="dv-riders" style={{ marginTop: 10 }}>
                {spectators.map(s => {
                  const bet = bets[s.uid || s.id];
                  return (
                    <button key={s.id} type="button"
                      className={`rc-cut dv-rider${picked.has(s.uid || s.id) ? ' is-on' : ''}`}
                      aria-pressed={picked.has(s.uid || s.id)}
                      onClick={() => togglePick(s.uid || s.id)}>
                      {bet && <span className="dv-swatch" style={{ background: HORSE[bet].glow, color: HORSE[bet].glow }} />}
                      <span>{s.name}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
        </Panel>
      </GameShell>
    );
  }

  if (phase === 'summary') {
    return (
      <GameShell island={island} title={t('derby.name')} onExit={onExit} history={rounds}>
        <Summary rounds={rounds} onNew={() => openLobby()} onExit={onExit} />
      </GameShell>
    );
  }

  const leader = order[0] ?? view.progress.reduce((best, p, i, a) => (p > a[best] ? i : best), 0);

  return (
    <GameShell
      island={island}
      title={t('derby.name')}
      status={phase === 'running' ? t('derby.statusRunning') : phase === 'question' ? t('derby.statusQuestion') : undefined}
      onExit={onExit}
      onEnd={() => setPhase('summary')}
      history={rounds}
      fit
    >
      <Track
        riders={riders}
        progress={view.progress}
        frame={view.frame}
        boosting={view.boosting}
        bets={config.betting ? betTally : {}}
        frozen={phase === 'question' || phase === 'resumeCountdown'}
        winner={phase === 'finish' ? order[0] ?? null : null}
      />

      <div className="rc-cut dv-banner">
        <span className="dv-banner-title">{t('derby.banner')}</span>
        <span className="dv-banner-sub">
          {t('derby.bannerStatus', { name: riders[leader]?.name ?? '—', asked })}
        </span>
      </div>

      {phase === 'running' && (
        <>
          <div className="dv-pads">
            {riders.map((r, i) => (
              <button
                key={r.studentId}
                type="button"
                className="rc-cut dv-pad"
                style={{ borderBottom: `3px solid ${HORSE[r.color].glow}` }}
                onPointerDown={() => tap(i)}
              >
                <span className="dv-pad-key">{i + 1}</span>
                <span>{r.name}</span>
                {config.controlMode === 'phones' && laneBps[i] > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--star-cyan)' }}>{laneBps[i]} t/s</span>
                )}
              </button>
            ))}
          </div>
          <button type="button" className="rc-cut dv-ask" disabled={!questions.length} onClick={askQuestion}>
            {t('derby.ask')} (Q)
          </button>
        </>
      )}

      {phase === 'countdown' && (
        <div className="dv-over"><span className="dv-count" key={count}>{count}</span></div>
      )}

      {phase === 'resumeCountdown' && (
        <div className="dv-over">
          <span className="dv-count" style={{ fontSize: 90 }}>{t('derby.resumeCountdown')}</span>
        </div>
      )}

      {phase === 'question' && (
        <div className="dv-over">
          <span className="dv-q-kicker">{t('derby.questionKicker')}</span>
          <p className="dv-q-text">{question}</p>
          {pending ? (
            <AnswerJudge
              names={pending.names}
              points={pending.points}
              summary={pending.summary}
              onJudge={judgeAndResume}
            />
          ) : (
            <>
              {orderedHands.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--gold-jackpot)', fontWeight: 700 }}>
                    ✋ {t('derby.handsOrder')}:
                  </span>
                  {orderedHands.map((uid, idx) => {
                    const riderIdx = riders.findIndex(r => r.studentId === uid);
                    if (riderIdx < 0) return null;
                    const r = riders[riderIdx];
                    return (
                      <button
                        key={uid}
                        type="button"
                        className="rc-cut dv-rider is-on"
                        onClick={() => nominate(riderIdx)}
                        style={{ padding: '4px 10px', fontSize: 12 }}
                      >
                        <span style={{ fontWeight: 900, marginRight: 4 }}>#{idx + 1}</span>
                        <span>{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="dv-riders">
                {riders.map((r, i) => (
                  <button key={r.studentId} type="button" className="rc-cut dv-rider" onClick={() => nominate(i)}>
                    <span className="dv-swatch" style={{ background: HORSE[r.color].glow, color: HORSE[r.color].glow }} />
                    <span>{r.name}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="rc-cut gm-btn" onClick={resume}>{t('derby.noAnswer')}</button>
            </>
          )}
        </div>
      )}

      {phase === 'finish' && (
        <div className="dv-over">
          <span className="dv-q-kicker">{t('derby.photoFinish')}</span>
          <div className="dv-podium">
            {[1, 0, 2].filter(i => i < podium.length).map(i => (
              <div key={i} className={`dv-step dv-step-${i + 1}`}>
                <span className="dv-step-pos">{i + 1}</span>
                <span className="dv-swatch" style={{
                  background: HORSE[riders[podium[i]].color].glow,
                  color: HORSE[riders[podium[i]].color].glow,
                }} />
                <span className="dv-step-name">{riders[podium[i]].name}</span>
                <span className="dv-step-pos">+{podiumPoints[i]}</span>
              </div>
            ))}
          </div>
          {config.betting && (
            <p className="dv-banner-sub">
              {winningBackers.length
                ? t('derby.backersWin', { count: winningBackers.length, points: config.betPoints })
                : t('derby.backersNone')}
            </p>
          )}
          <div className="dv-riders">
            {!paid && (
              <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={payOut}>
                {t('derby.confirmPayout')}
              </button>
            )}
            <button type="button" className="rc-cut gm-btn" onClick={() => openLobby()}>{t('derby.raceAgain')}</button>
            <button type="button" className="rc-cut gm-btn" onClick={onExit}>{t('game.backToMap')}</button>
          </div>
        </div>
      )}
    </GameShell>
  );
}

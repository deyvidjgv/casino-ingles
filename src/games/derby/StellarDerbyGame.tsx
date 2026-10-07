// Stellar Derby — a Greek hippodrome where the class races. Tapping keeps a horse moving, but
// the race is decided by English: the teacher freezes it, asks a question, and the answer buys
// a boost. Points are only ever awarded by the teacher, the same as in every other island.
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
import './derby.css';

type Phase = 'setup' | 'lobby' | 'countdown' | 'running' | 'question' | 'finish' | 'summary';
type Length = 'short' | 'medium' | 'long';

interface DerbyConfig {
  lanes: number;
  mode: PlayMode;
  /** points a correct answer is worth; also sets how big the boost is */
  points: number;
  /** points for winning the race */
  winPoints: number;
  length: Length;
  betting: boolean;
  betPoints: number;
}

const DEFAULTS: DerbyConfig = {
  lanes: 4, mode: 'eliminate', points: 2, winPoints: 3,
  length: 'medium', betting: true, betPoints: 1,
};

/**
 * Race tuning, in fractions of the track per second.
 *
 * Tapping flat out and never answering a question finishes a medium race in about 26 s; three
 * correct answers cut that to roughly 14 s of running, plus however long the questions take.
 * So the thumbs keep you in it but the English wins it, which is the balance the class asked
 * for. The boosts are deliberately smaller than the speed-up they ride on: at a race this
 * short, scaling them together would end it on the second correct answer.
 *
 * MIN_TAP_MS is the fairness cap: a newer phone or an autoclicker gains nothing above ten
 * taps a second.
 */
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
  velocity: number[];
  stride: number[];
  lastTap: number[];
  boostLeft: number[];
  boostRate: number[];
}

const freshRace = (n: number): RaceState => ({
  progress: Array(n).fill(0), velocity: Array(n).fill(0), stride: Array(n).fill(0),
  lastTap: Array(n).fill(0), boostLeft: Array(n).fill(0), boostRate: Array(n).fill(0),
});

export function StellarDerbyGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  const allStudents = useClassStore(s => s.students);
  const questions = useClassStore(s => s.questions);
  const addHistory = useClassStore(s => s.addHistory);
  const addPoints = useClassStore(s => s.addPoints);

  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const [config, setConfig] = useIslandConfig<DerbyConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<Phase>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const [riders, setRiders] = useState<Rider[]>([]);
  const [bets, setBets] = useState<Record<string, HorseColor>>({});
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [raced, setRaced] = useState<ReadonlySet<string>>(() => new Set());

  const [count, setCount] = useState(3);
  const [question, setQuestion] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [paid, setPaid] = useState(false);

  // Everything the loop mutates lives in a ref: React state updaters must stay pure, and the
  // double-scoring bugs in the other games all came from breaking that rule.
  const race = useRef<RaceState>(freshRace(0));
  const [view, setView] = useState<{ progress: number[]; frame: number[]; boosting: boolean[] }>(
    { progress: [], frame: [], boosting: [] },
  );

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

  /* ---------- lobby ---------- */

  const drawRiders = useCallback((pool: Student[], lanes: number) => {
    const chosen = pickDistinct(pool, Math.min(lanes, pool.length));
    const colors = shuffled(HORSE_COLORS).slice(0, chosen.length);
    setRiders(chosen.map((s, i) => ({ studentId: s.id, name: s.name, color: colors[i] })));
    setBets({});
    setPicked(new Set());
  }, []);

  const eligible = useMemo(
    () => (config.mode === 'eliminate' ? students.filter(s => !raced.has(s.id)) : students),
    [students, raced, config.mode],
  );

  // `lanes` is passed in from the setup form: reading config here would use the value from
  // before setConfig committed, and the field would come out the previous size.
  const openLobby = useCallback((lanes = config.lanes) => {
    drawRiders(eligible, lanes);
    setOrder([]);
    setPaid(false);
    setAsked(0);
    setQuestion(null);
    setPending(null);
    setPhase('lobby');
  }, [drawRiders, eligible, config.lanes, setPending]);

  /** Swaps one rider for someone who is not already on the field. */
  const rerollRider = useCallback((index: number) => {
    const taken = new Set(riders.map(r => r.studentId));
    const bench = eligible.filter(s => !taken.has(s.id));
    if (!bench.length) return;
    const next = pickOne(bench);
    sfx.click();
    setRiders(rs => rs.map((r, i) => (i === index ? { ...r, name: next.name, studentId: next.id } : r)));
  }, [riders, eligible]);

  /* ---------- race loop ---------- */

  const start = useCallback(() => {
    race.current = freshRace(riders.length);
    setView({
      progress: Array(riders.length).fill(0),
      frame: Array(riders.length).fill(0),
      boosting: Array(riders.length).fill(false),
    });
    setCount(3);
    setPhase('countdown');
  }, [riders.length]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    sfx.tick();
    const id = setTimeout(() => {
      if (count > 1) setCount(c => c - 1);
      else setPhase('running');
    }, 900);
    return () => clearTimeout(id);
  }, [phase, count]);

  const tap = useCallback((lane: number) => {
    if (phase !== 'running') return;
    const r = race.current;
    const now = performance.now();
    if (now - r.lastTap[lane] < MIN_TAP_MS) return; // fairness cap, not a bug
    r.lastTap[lane] = now;
    r.velocity[lane] += TAP_IMPULSE;
  }, [phase]);

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
        r.progress[i] = Math.min(1, r.progress[i] + speed * dt);
        // stride rate follows speed, so a horse being tapped hard visibly gallops harder
        r.stride[i] += (5 + speed * 900) * dt;
        if (r.progress[i] >= 1 && finished < 0) finished = i;
      }

      setView({
        progress: [...r.progress],
        frame: r.stride.map(s => Math.floor(s) % 2),
        boosting: r.boostLeft.map(b => b > 0),
      });

      if (finished >= 0) {
        // ranked by distance covered, so second and third are real placings
        setOrder([...r.progress.keys()].sort((a, b) => r.progress[b] - r.progress[a]));
        sfx.win();
        setPhase('finish');
        return;
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, config.length]);

  // Keys 1–6 drive the lanes when the class shares one screen instead of using phones.
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      const lane = Number(e.key) - 1;
      if (Number.isInteger(lane) && lane >= 0 && lane < riders.length) {
        e.preventDefault();
        tap(lane);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, riders.length, tap]);

  /* ---------- questions ---------- */

  const askQuestion = useCallback(() => {
    if (!questions.length) return;
    sfx.click();
    setQuestion(pickOne(questions).text);
    setAsked(a => a + 1);
    setPhase('question');
  }, [questions]);

  const resume = useCallback(() => {
    setQuestion(null);
    setPending(null);
    setPhase('running');
  }, [setPending]);

  /** The teacher names who answered; the verdict bar then decides whether it was worth a boost. */
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
  }, [riders, config.points, setPending, t]);

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
    } else if (verdict === 'wrong') {
      sfx.wrong();
    }
    judge(verdict);
    resume();
  }, [boostedFor, riders, config.points, judge, resume]);

  /* ---------- finish ---------- */

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

  // Guarded by a ref, not by `paid`: a second click must never be able to pay twice, and the
  // state flag alone would not stop two clicks inside one render pass.
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

  const blocker = students.length < 2
    ? t('game.notEnoughStudents')
    : eligible.length < 2
    ? t('game.allPlayed')
    : null;

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
              <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={() => { sfx.lever(); start(); }}>
                {t('derby.start')}
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
              {riders.map((r, i) => (
                <button key={r.studentId} type="button" className="rc-cut dv-rider" onClick={() => rerollRider(i)}>
                  <span className="dv-swatch" style={{ background: HORSE[r.color].glow, color: HORSE[r.color].glow }} />
                  <span className="dv-lane-n">{i + 1}</span>
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
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
                  const bet = bets[s.id];
                  return (
                    <button key={s.id} type="button"
                      className={`rc-cut dv-rider${picked.has(s.id) ? ' is-on' : ''}`}
                      aria-pressed={picked.has(s.id)}
                      onClick={() => togglePick(s.id)}>
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
        frozen={phase === 'question'}
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
              <button key={r.studentId} type="button" className="rc-cut dv-pad"
                style={{ borderBottom: `3px solid ${HORSE[r.color].glow}` }}
                onPointerDown={() => tap(i)}>
                <span className="dv-pad-key">{i + 1}</span>
                <span>{r.name}</span>
              </button>
            ))}
          </div>
          <button type="button" className="rc-cut dv-ask" disabled={!questions.length} onClick={askQuestion}>
            {t('derby.ask')}
          </button>
        </>
      )}

      {phase === 'countdown' && (
        <div className="dv-over"><span className="dv-count" key={count}>{count}</span></div>
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

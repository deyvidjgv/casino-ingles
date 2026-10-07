// Lunar Roulette — Selector Wheel and Real European Casino Roulette modes.
// Crypto-first randomness with GSAP physics, dynamic student slices, and betting board.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { randomInt } from '../../lib/random';
import { fillTemplate } from '../../lib/template';
import { sfx } from '../../lib/sfx';
import {
  AnswerJudge,
  CommonSetup,
  Field,
  GameShell,
  Notice,
  Panel,
  PhraseField,
  Segmented,
  Stepper,
  Summary,
  type RoundLog,
} from '../shared/ui';
import { useIslandConfig, useJudgedAward, useLocalized, usePool } from '../shared/hooks';
import type { GameProps, Localized, PlayMode } from '../types';
import './roulette.css';

type RouletteMode = 'selector' | 'casino';
type Source = 'students' | 'topics';

interface RouletteConfig {
  rouletteMode: RouletteMode;
  source: Source;
  pockets: number;
  mode: PlayMode;
  points: number;
  duration: number;
  winner: Localized;
  saved: Localized;
}

const DEFAULTS: RouletteConfig = {
  rouletteMode: 'selector',
  source: 'students',
  pockets: 37,
  mode: 'eliminate',
  points: 1,
  duration: 6,
  winner: {
    en: 'The wheel has chosen… {winner}! Your turn!',
    es: 'La ruleta eligió a… ¡{winner}! ¡Es tu turno!',
  },
  saved: {
    en: 'Lucky escape! Nobody plays this round — spin again!',
    es: '¡Salvados! Nadie juega esta ronda — ¡gira otra vez!',
  },
};

interface Entry {
  id: string;
  label: string;
  isStudent: boolean;
}

type BetCategory = 'color' | 'parity' | 'range' | 'dozen' | 'number';

interface CasinoBet {
  category: BetCategory;
  value: string;
  label: string;
}

const EUROPEAN_WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const SELECTOR_PALETTE = [
  '#F72585', '#7209B7', '#3A0CA3', '#4361EE', '#4CC9F0', '#06D6A0', '#FFD166', '#F3722C',
];

// Wheel geometry (SVG units, centre at 0,0)
const R_RIM = 492,
  R_TRACK = 426,
  R_POCKET_OUT = 398,
  R_NUM = 378,
  R_NAME = 306,
  R_POCKET_IN = 246,
  R_BALL_REST = 372;
const LAND_AT = 0.86;
const DEFLECTORS = 8;
const R_DEFLECTOR = 410;
const HOP_MAX = 34;
const SCATTER_DEG = 5.5;

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
};

function sectorPath(i: number, step: number, r0: number, r1: number) {
  const a0 = (i - 0.5) * step,
    a1 = (i + 0.5) * step,
    large = step > 180 ? 1 : 0;
  const p0 = polar(a0, r1),
    p1 = polar(a1, r1),
    p2 = polar(a1, r0),
    p3 = polar(a0, r0);
  return `M${p0.x},${p0.y} A${r1},${r1} 0 ${large} 1 ${p1.x},${p1.y} L${p2.x},${p2.y} A${r0},${r0} 0 ${large} 0 ${p3.x},${p3.y} Z`;
}

const short = (s: string, max = 14) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const easeOut = (t: number, pow: number) => 1 - Math.pow(1 - t, pow);
const hop = (s: number) =>
  s <= 0 || s >= 1
    ? 0
    : Math.abs(Math.sin(s * Math.PI * DEFLECTORS)) * HOP_MAX * Math.pow(1 - s, 1.7);
const scatter = (s: number) =>
  s <= 0 || s >= 1
    ? 0
    : Math.sin(s * Math.PI * DEFLECTORS * 2) * SCATTER_DEG * Math.pow(1 - s, 2.2);

function bounceOut(t: number) {
  const n = 7.5625,
    d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

function checkBetWin(bet: CasinoBet, num: number): boolean {
  if (bet.category === 'color') {
    if (bet.value === 'red') return RED_NUMBERS.has(num);
    if (bet.value === 'black') return num !== 0 && !RED_NUMBERS.has(num);
    if (bet.value === 'green') return num === 0;
  }
  if (bet.category === 'parity') {
    if (num === 0) return false;
    if (bet.value === 'even') return num % 2 === 0;
    if (bet.value === 'odd') return num % 2 !== 0;
  }
  if (bet.category === 'range') {
    if (num === 0) return false;
    if (bet.value === 'low') return num >= 1 && num <= 18;
    if (bet.value === 'high') return num >= 19 && num <= 36;
  }
  if (bet.category === 'dozen') {
    if (num === 0) return false;
    if (bet.value === '1') return num >= 1 && num <= 12;
    if (bet.value === '2') return num >= 13 && num <= 24;
    if (bet.value === '3') return num >= 25 && num <= 36;
  }
  if (bet.category === 'number') {
    return parseInt(bet.value, 10) === num;
  }
  return false;
}

function getMultiplier(category: BetCategory): number {
  if (category === 'number') return 5;
  if (category === 'dozen') return 2;
  return 1;
}

export function RouletteGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  const { lang, pick } = useLocalized();
  const allStudents = useClassStore(s => s.students);
  const topics = useClassStore(s => s.topics);
  const addHistory = useClassStore(s => s.addHistory);

  const [config, setConfig] = useIslandConfig<RouletteConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const entries: Entry[] = useMemo(
    () =>
      config.source === 'students'
        ? allStudents.filter(s => s.active).map(s => ({ id: s.id, label: s.name, isStudent: true }))
        : topics.map(x => ({ id: x.id, label: x.text, isStudent: false })),
    [config.source, allStudents, topics]
  );

  const onSettled = useCallback(
    (entry: RoundLog, points: number, studentIds: string[]) => {
      addHistory({
        islandId: island.id,
        game: 'roulette',
        summary: entry.text,
        studentIds,
        points,
        saved: entry.saved,
      });
      setRounds(r => [...r, entry]);
    },
    [addHistory, island.id]
  );

  const { pending, setPending, judge } = useJudgedAward(onSettled);
  const pool = usePool(entries, config.mode);

  // Casino Bets State
  const [selectedBettorId, setSelectedBettorId] = useState<string>('');
  const [activeBet, setActiveBet] = useState<CasinoBet>({
    category: 'color',
    value: 'red',
    label: 'Red',
  });
  const [casinoResult, setCasinoResult] = useState<{
    num: number;
    color: 'red' | 'black' | 'green';
    parity: 'even' | 'odd' | 'zero';
    won: boolean;
  } | null>(null);

  const activeStudents = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const effectiveBettorId = selectedBettorId || activeStudents[0]?.id || '';

  const pockets = config.rouletteMode === 'casino' ? 37 : Math.max(pool.available.length, 1);
  const step = 360 / pockets;

  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);

  const wheelRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const wheelAngle = useRef(0);
  const ballState = useRef({ angle: 0, r: R_TRACK });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const geometry = useMemo(() => {
    if (config.rouletteMode === 'casino') {
      const list = EUROPEAN_WHEEL.map((num, i) => {
        const isZero = num === 0;
        const isRed = RED_NUMBERS.has(num);
        const fill = isZero ? '#059669' : isRed ? '#F72585' : '#1A1E4A';
        const numPos = polar(i * step, R_NUM);
        return {
          i,
          numVal: num,
          path: sectorPath(i, step, R_POCKET_IN, R_POCKET_OUT),
          fill,
          num: numPos,
          numRot: `rotate(${i * step} ${numPos.x} ${numPos.y})`,
          nameRot: `rotate(${i * step}) translate(0 ${-R_NAME}) rotate(-90)`,
          label: String(num),
          isStudent: false,
        };
      });
      return Object.assign(list, {
        numSize: Math.min(24, Math.max(12, ((2 * Math.PI * R_NUM) / 37) * 0.45)),
        nameSize: 14,
      });
    }

    // Selector Mode: Dynamic slices for each active student
    const list = pool.available.map((entry, i) => {
      const fill = SELECTOR_PALETTE[i % SELECTOR_PALETTE.length];
      const numPos = polar(i * step, R_NUM);
      return {
        i,
        numVal: i + 1,
        path: sectorPath(i, step, R_POCKET_IN, R_POCKET_OUT),
        fill,
        num: numPos,
        numRot: `rotate(${i * step} ${numPos.x} ${numPos.y})`,
        nameRot: `rotate(${i * step}) translate(0 ${-R_NAME}) rotate(-90)`,
        label: entry.label,
        isStudent: entry.isStudent,
      };
    });
    const effectiveCount = Math.max(pool.available.length, 1);
    return Object.assign(list, {
      numSize: Math.min(22, Math.max(10, ((2 * Math.PI * R_NUM) / effectiveCount) * 0.4)),
      nameSize: Math.min(22, Math.max(10, ((2 * Math.PI * R_NAME) / effectiveCount) * 0.42)),
    });
  }, [config.rouletteMode, pool.available, step]);

  useEffect(() => () => { tweenRef.current?.kill(); }, []);

  const place = () => {
    const w = wheelRef.current,
      b = ballRef.current,
      bs = ballState.current;
    w?.setAttribute('transform', `rotate(${wheelAngle.current})`);
    if (config.rouletteMode === 'casino') {
      const p = polar(bs.angle, bs.r);
      b?.setAttribute('transform', `translate(${p.x},${p.y})`);
    }
  };
  useEffect(place);

  const blocker =
    !entries.length
      ? config.source === 'students'
        ? t('game.notEnoughStudents')
        : t('game.noTopics')
      : !pool.available.length
      ? t('game.allPlayed')
      : null;

  function spinSelector() {
    if (spinning || blocker || pool.available.length === 0) return;
    const targetIdx = randomInt(pool.available.length);
    const winner = pool.available[targetIdx];

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const turns = reduced ? 2 : 5;
    const w0 = wheelAngle.current;

    // Point needle is at top (angle 0). To align targetIdx at top:
    // (wEnd + targetIdx * step) % 360 == 0  =>  wEnd = -targetIdx * step (mod 360)
    const targetMod = ((-targetIdx * step) % 360 + 360) % 360;
    const curMod = (w0 % 360 + 360) % 360;
    let diff = targetMod - curMod;
    if (diff <= 0) diff += 360;
    const wEnd = w0 + 360 * turns + diff;

    setSpinning(true);
    setLanded(null);
    sfx.whoosh();

    const prog = { p: 0 };
    let lastSlice = -1;

    tweenRef.current = gsap.to(prog, {
      p: 1,
      duration: reduced ? 3 : config.duration,
      ease: 'power3.out',
      onUpdate: () => {
        const p = prog.p;
        wheelAngle.current = w0 + (wEnd - w0) * easeOut(p, 2.8);
        place();
        const currentSlice =
          Math.floor(((((-wheelAngle.current % 360 + 360) % 360) + step / 2) / step)) %
          Math.max(pool.available.length, 1);
        if (currentSlice !== lastSlice) {
          lastSlice = currentSlice;
          if (p < 0.95) sfx.tick();
        }
      },
      onComplete: () => {
        tweenRef.current = null;
        wheelAngle.current %= 360;
        setSpinning(false);
        setLanded(targetIdx);
        sfx.win();

        if (config.mode === 'eliminate') {
          pool.markUsed([winner.id]);
        }

        const text = fillTemplate(pick(config.winner), { winner: winner.label });
        const ids = winner.isStudent ? [winner.id] : [];
        if (ids.length) {
          setPending({
            studentIds: ids,
            names: [winner.label],
            points: config.points,
            summary: text,
          });
        } else {
          onSettled({ text, chips: [] }, 0, []);
        }
      },
    });
  }

  function spinCasino() {
    if (spinning || blocker) return;
    const targetPocket = randomInt(37);
    const targetNum = EUROPEAN_WHEEL[targetPocket];

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const w0 = wheelAngle.current;
    const wTurns = reduced ? 1 : 4;
    // Crypto random wheel offset (replaces previous Math.random)
    const wEnd = w0 + 360 * wTurns + randomInt(360);
    const rel0 = ballState.current.angle - w0;
    let relEnd = targetPocket * step;
    while (relEnd > rel0 - 360 * (reduced ? 2 : 6)) relEnd -= 360;

    const drop = { from: R_TRACK, to: R_BALL_REST };
    let lastPocket = Math.floor(rel0 / step);
    let bounced = 0;

    setSpinning(true);
    setLanded(null);
    setCasinoResult(null);
    sfx.whoosh();

    const prog = { p: 0 };
    tweenRef.current = gsap.to(prog, {
      p: 1,
      duration: reduced ? 3 : config.duration,
      ease: 'none',
      onUpdate: () => {
        const p = prog.p;
        const q = Math.min(1, p / LAND_AT);
        wheelAngle.current = w0 + (wEnd - w0) * easeOut(p, 3);
        const rel = rel0 + (relEnd - rel0) * easeOut(q, 2.2);
        const bs = ballState.current;
        bs.angle = wheelAngle.current + rel;
        const s = Math.min(1, Math.max(0, (p - 0.55) / (LAND_AT - 0.55)));
        const fall = drop.from + (drop.to - drop.from) * (reduced ? s : bounceOut(s));
        if (reduced) {
          bs.r = fall;
        } else {
          bs.r = fall + hop(s);
          bs.angle += scatter(s);
        }
        place();

        const pk = Math.floor(rel / step);
        if (pk !== lastPocket && q < 1) {
          lastPocket = pk;
          if (p > 0.3) sfx.tick();
        }
        const strike = Math.floor(s * DEFLECTORS);
        if (!reduced && s > 0 && s < 1 && strike > bounced) {
          bounced = strike;
          sfx.ballClack();
        }
      },
      onComplete: () => {
        tweenRef.current = null;
        wheelAngle.current %= 360;
        ballState.current.angle %= 360;
        setSpinning(false);
        setLanded(targetPocket);

        const won = checkBetWin(activeBet, targetNum);
        const color = targetNum === 0 ? 'green' : RED_NUMBERS.has(targetNum) ? 'red' : 'black';
        const parity = targetNum === 0 ? 'zero' : targetNum % 2 === 0 ? 'even' : 'odd';
        setCasinoResult({ num: targetNum, color, parity, won });

        const bettor = activeStudents.find(s => s.id === effectiveBettorId) || activeStudents[0];
        const bettorName = bettor ? bettor.name : 'Player';

        if (won) {
          sfx.win();
          const pts = config.points * getMultiplier(activeBet.category);
          const winText = t('roulette.winBet', {
            name: bettorName,
            bet: activeBet.label,
            result: `#${targetNum} (${color.toUpperCase()})`,
          });
          if (bettor) {
            setPending({
              studentIds: [bettor.id],
              names: [bettorName],
              points: pts,
              summary: winText,
            });
          } else {
            onSettled({ text: winText, chips: [] }, pts, []);
          }
        } else {
          sfx.saved();
          const loseText = t('roulette.loseBet', {
            name: bettorName,
            result: `#${targetNum} (${color.toUpperCase()})`,
          });
          setRounds(r => [...r, { text: loseText, saved: true }]);
          addHistory({
            islandId: island.id,
            game: 'roulette',
            summary: loseText,
            studentIds: [],
            points: 0,
            saved: true,
          });
        }
      },
    });
  }

  function handleSpin() {
    if (config.rouletteMode === 'casino') {
      spinCasino();
    } else {
      spinSelector();
    }
  }

  function startGame(next: RouletteConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
    setLanded(null);
    setCasinoResult(null);
    setPhase('play');
  }

  function endGame() {
    tweenRef.current?.kill();
    setSpinning(false);
    setPhase('summary');
  }

  const status =
    phase === 'play'
      ? config.rouletteMode === 'selector'
        ? config.mode === 'eliminate'
          ? t('game.leftToPlay', { count: pool.available.length })
          : t('game.everyoneStays')
        : t('roulette.modeCasino')
      : undefined;

  return (
    <GameShell
      island={island}
      title={t('roulette.name')}
      status={status}
      onExit={onExit}
      onSettings={
        phase === 'play' && !spinning
          ? () => {
              setDraft(config);
              setPhase('setup');
            }
          : undefined
      }
      onEnd={phase === 'play' && !spinning ? endGame : undefined}
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
          <Field label={t('roulette.rouletteMode')}>
            <Segmented
              value={draft.rouletteMode}
              onChange={m => setDraft(d => ({ ...d, rouletteMode: m }))}
              options={[
                {
                  value: 'selector',
                  label: t('roulette.modeSelector'),
                  hint: t('roulette.modeSelectorDesc'),
                },
                {
                  value: 'casino',
                  label: t('roulette.modeCasino'),
                  hint: t('roulette.modeCasinoDesc'),
                },
              ]}
            />
          </Field>

          {draft.rouletteMode === 'selector' ? (
            <>
              <Field label={t('roulette.source')}>
                <Segmented
                  value={draft.source}
                  onChange={source => setDraft(d => ({ ...d, source }))}
                  options={[
                    { value: 'students', label: t('roulette.sourceStudents') },
                    { value: 'topics', label: t('roulette.sourceTopics') },
                  ]}
                />
              </Field>
              <CommonSetup
                mode={draft.mode}
                points={draft.points}
                pointsLabel={t('game.points')}
                onMode={mode => setDraft(d => ({ ...d, mode }))}
                onPoints={points => setDraft(d => ({ ...d, points }))}
              />
              <PhraseField
                label={t('roulette.winnerPhrase')}
                vars={['winner']}
                value={draft.winner[lang]}
                onChange={v => setDraft(d => ({ ...d, winner: { ...d.winner, [lang]: v } }))}
              />
            </>
          ) : (
            <>
              <Field label={t('game.points')}>
                <Stepper
                  value={draft.points}
                  min={1}
                  max={10}
                  onChange={points => setDraft(d => ({ ...d, points }))}
                />
              </Field>
            </>
          )}

          <Field label={t('game.spinTime')}>
            <Stepper
              value={draft.duration}
              min={3}
              max={10}
              onChange={duration => setDraft(d => ({ ...d, duration }))}
              format={v => t('game.seconds', { n: v })}
            />
          </Field>
        </Panel>
      )}

      {phase === 'play' && (
        <div className="rl-play">
          <div className={`rl-wheel-wrap ${spinning ? 'is-spinning' : ''}`}>
            <svg
              className="rl-wheel"
              viewBox="-500 -500 1000 1000"
              role="img"
              aria-label={t('roulette.name')}
            >
              <defs>
                <radialGradient id="rl-moon" cx="45%" cy="40%" r="65%">
                  <stop offset="0%" stopColor="#e9eaff" />
                  <stop offset="55%" stopColor="#a9a8d8" />
                  <stop offset="100%" stopColor="#5b5a93" />
                </radialGradient>
                <linearGradient id="rl-gold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fff3c4" />
                  <stop offset="45%" stopColor="#FFD166" />
                  <stop offset="100%" stopColor="#8c6a1f" />
                </linearGradient>
                <filter id="rl-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="9" />
                </filter>
              </defs>

              {/* Fixed outer rim */}
              <circle r={R_RIM} fill="url(#rl-gold)" />
              <circle r={R_RIM - 14} fill="#1A1E4A" />
              <circle
                r={R_RIM - 14}
                fill="none"
                stroke="#FFD166"
                strokeOpacity="0.35"
                strokeWidth="2"
                strokeDasharray="3 14"
              />
              {Array.from({ length: 8 }, (_, i) => {
                const p = polar(i * 45 + 22.5, R_RIM - 7);
                return (
                  <path
                    key={i}
                    d="M0,-7 Q0,0 7,0 Q0,0 0,7 Q0,0 -7,0 Q0,0 0,-7Z"
                    fill="#fff3c4"
                    transform={`translate(${p.x},${p.y})`}
                  />
                );
              })}

              {/* Rotating wheel */}
              <g ref={wheelRef}>
                <circle r={R_POCKET_OUT + 6} fill="#FFD166" />
                {geometry.map(g => {
                  const isWin = landed === g.i;
                  return (
                    <g key={g.i} className={`rl-pocket ${isWin ? 'is-win' : ''}`}>
                      <path d={g.path} fill={g.fill} stroke="#FFD166" strokeWidth="2" />
                      {isWin && <path d={g.path} className="rl-win-glow" />}
                      {config.rouletteMode === 'casino' ? (
                        <text
                          className="rl-num"
                          x={g.num.x}
                          y={g.num.y}
                          transform={g.numRot}
                          fontSize={geometry.numSize}
                        >
                          {g.label}
                        </text>
                      ) : (
                        <text
                          className="rl-name"
                          transform={g.nameRot}
                          fontSize={geometry.nameSize}
                        >
                          {short(g.label)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Center hub */}
                <circle r={R_POCKET_IN} fill="url(#rl-moon)" stroke="#FFD166" strokeWidth="6" />
                {[
                  [-120, -60, 26],
                  [90, -110, 18],
                  [110, 80, 30],
                  [-80, 120, 20],
                  [-150, 40, 14],
                  [30, 160, 12],
                ].map(([x, y, r], i) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={r}
                    fill="#5b5a93"
                    fillOpacity="0.35"
                    stroke="#e9eaff"
                    strokeOpacity="0.4"
                    strokeWidth="2"
                  />
                ))}
                <circle r="104" fill="#1A1E4A" stroke="#FFD166" strokeWidth="5" />
                <path
                  d="M34,-78 A84,84 0 1 0 34,78 A64,64 0 1 1 34,-78Z"
                  fill="#F1F3FF"
                  className="rl-crescent"
                />
                <path
                  d="M0,-58 Q0,0 16,0 Q0,0 0,58 Q0,0 -16,0 Q0,0 0,-58Z"
                  fill="url(#rl-gold)"
                  transform="translate(40 0)"
                />
              </g>

              {/* Deflector diamonds for casino mode */}
              {config.rouletteMode === 'casino' && (
                <g className="rl-deflectors" aria-hidden="true">
                  {Array.from({ length: DEFLECTORS }, (_, i) => {
                    const a = (360 / DEFLECTORS) * i + 22.5;
                    const c = polar(a, R_DEFLECTOR);
                    return (
                      <rect
                        key={i}
                        x={c.x - 9}
                        y={c.y - 9}
                        width="18"
                        height="18"
                        rx="2"
                        transform={`rotate(${a + 45} ${c.x} ${c.y})`}
                      />
                    );
                  })}
                </g>
              )}

              {/* Ball (active in casino mode) */}
              {config.rouletteMode === 'casino' && (
                <g ref={ballRef} className="rl-ball">
                  <circle r="30" fill="#4CC9F0" opacity="0.45" filter="url(#rl-glow)" />
                  <circle r="15" fill="#F1F3FF" />
                  <circle r="5" cx="-5" cy="-5" fill="#ffffff" />
                </g>
              )}
            </svg>
            <div className="rl-pointer" aria-hidden="true" />
          </div>

          <aside className="rl-side">
            {pending ? (
              <AnswerJudge
                names={pending.names}
                points={pending.points}
                summary={pending.summary}
                onJudge={judge}
              />
            ) : (
              <>
                {/* Casino Mode: Interactive Betting Table */}
                {config.rouletteMode === 'casino' && (
                  <div className="rl-casino-panel">
                    <div className="rl-bettor-row">
                      <span className="rl-bettor-label">{t('roulette.bettor')}</span>
                      <select
                        className="rl-bettor-select"
                        value={effectiveBettorId}
                        disabled={spinning}
                        onChange={e => setSelectedBettorId(e.target.value)}
                      >
                        {activeStudents.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rl-bets-tabs">
                      <button
                        type="button"
                        className={`rl-tab-btn ${activeBet.category === 'color' ? 'is-active' : ''}`}
                        onClick={() => setActiveBet({ category: 'color', value: 'red', label: t('roulette.betRed') })}
                      >
                        {t('roulette.betColor')}
                      </button>
                      <button
                        type="button"
                        className={`rl-tab-btn ${activeBet.category === 'parity' ? 'is-active' : ''}`}
                        onClick={() => setActiveBet({ category: 'parity', value: 'even', label: t('roulette.betEven') })}
                      >
                        {t('roulette.betParity')}
                      </button>
                      <button
                        type="button"
                        className={`rl-tab-btn ${activeBet.category === 'range' ? 'is-active' : ''}`}
                        onClick={() => setActiveBet({ category: 'range', value: 'low', label: t('roulette.betLow') })}
                      >
                        {t('roulette.betRange')}
                      </button>
                      <button
                        type="button"
                        className={`rl-tab-btn ${activeBet.category === 'dozen' ? 'is-active' : ''}`}
                        onClick={() => setActiveBet({ category: 'dozen', value: '1', label: t('roulette.betDoz1') })}
                      >
                        {t('roulette.betDozen')}
                      </button>
                    </div>

                    <div className="rl-bet-options">
                      {activeBet.category === 'color' && (
                        <>
                          <button
                            type="button"
                            className={`rl-bet-option-btn rl-bet-red ${activeBet.value === 'red' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'color', value: 'red', label: t('roulette.betRed') })}
                          >
                            🔴 {t('roulette.betRed')} (1x)
                          </button>
                          <button
                            type="button"
                            className={`rl-bet-option-btn rl-bet-black ${activeBet.value === 'black' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'color', value: 'black', label: t('roulette.betBlack') })}
                          >
                            ⚫ {t('roulette.betBlack')} (1x)
                          </button>
                        </>
                      )}

                      {activeBet.category === 'parity' && (
                        <>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === 'even' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'parity', value: 'even', label: t('roulette.betEven') })}
                          >
                            {t('roulette.betEven')} (1x)
                          </button>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === 'odd' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'parity', value: 'odd', label: t('roulette.betOdd') })}
                          >
                            {t('roulette.betOdd')} (1x)
                          </button>
                        </>
                      )}

                      {activeBet.category === 'range' && (
                        <>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === 'low' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'range', value: 'low', label: t('roulette.betLow') })}
                          >
                            1–18 (1x)
                          </button>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === 'high' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'range', value: 'high', label: t('roulette.betHigh') })}
                          >
                            19–36 (1x)
                          </button>
                        </>
                      )}

                      {activeBet.category === 'dozen' && (
                        <>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === '1' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'dozen', value: '1', label: t('roulette.betDoz1') })}
                          >
                            1st 12 (2x)
                          </button>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === '2' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'dozen', value: '2', label: t('roulette.betDoz2') })}
                          >
                            2nd 12 (2x)
                          </button>
                          <button
                            type="button"
                            className={`rl-bet-option-btn ${activeBet.value === '3' ? 'is-selected' : ''}`}
                            onClick={() => setActiveBet({ category: 'dozen', value: '3', label: t('roulette.betDoz3') })}
                          >
                            3rd 12 (2x)
                          </button>
                        </>
                      )}
                    </div>

                    <div className="rl-bet-preview">
                      {t('roulette.currentBet', { desc: activeBet.label })}
                    </div>

                    {casinoResult && (
                      <div className="rl-result-callout">
                        <span className={`rl-result-num is-${casinoResult.color}`}>
                          {casinoResult.num}
                        </span>
                        <span className="rl-result-info">
                          {t('roulette.ballLandedOn', {
                            num: casinoResult.num,
                            color: casinoResult.color.toUpperCase(),
                            parity: casinoResult.parity.toUpperCase(),
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {blocker && !spinning ? (
                  <Notice
                    text={blocker}
                    action={
                      config.mode === 'eliminate' && entries.length ? (
                        <button type="button" className="rc-cut gm-btn" onClick={pool.reset}>
                          {t('game.restartRound')}
                        </button>
                      ) : undefined
                    }
                  />
                ) : (
                  <button
                    type="button"
                    className="rc-cut gm-btn gm-btn-primary rl-spin"
                    onClick={handleSpin}
                    disabled={spinning || Boolean(blocker)}
                  >
                    {spinning ? t('roulette.spinning') : t('roulette.spin')}
                  </button>
                )}

                {config.rouletteMode === 'selector' && (
                  <div className="rl-odds">
                    {t('roulette.oddsNow', {
                      count: pool.available.length,
                      pockets: pool.available.length,
                    })}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {phase === 'summary' && (
        <Summary
          rounds={rounds}
          onNew={() => {
            setDraft(config);
            setPhase('setup');
          }}
          onExit={onExit}
        />
      )}
    </GameShell>
  );
}

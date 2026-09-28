// Lunar Roulette. Before each spin the players take random seats; then a pocket is drawn (crypto,
// uniform over ALL pockets — empty ones are "safe spots"). The wheel and ball tweens are solved so
// the ball comes to rest in that pocket.
import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { randomInt, shuffled } from '../../lib/random';
import { fillTemplate } from '../../lib/template';
import { sfx } from '../../lib/sfx';
import { CommonSetup, Field, GameShell, Notice, Panel, PhraseField, ResultOverlay, Segmented, Stepper, Summary, type RoundLog } from '../shared/ui';
import { useIslandConfig, useLocalized, usePool } from '../shared/hooks';
import type { GameProps, Localized, PlayMode } from '../types';
import './roulette.css';

type Source = 'students' | 'topics';

interface RouletteConfig {
  source: Source;
  pockets: number;
  mode: PlayMode;
  points: number;
  duration: number;
  winner: Localized;
  saved: Localized;
}

const DEFAULTS: RouletteConfig = {
  source: 'students',
  pockets: 37,
  mode: 'eliminate',
  points: 1,
  duration: 7,
  winner: { en: 'The ball has chosen… {winner}! Your turn!', es: 'La bolita eligió a… ¡{winner}! ¡Es tu turno!' },
  saved: { en: 'Lucky escape! Nobody plays this round — spin again!', es: '¡Salvados! Nadie juega esta ronda — ¡gira otra vez!' },
};

interface Entry { id: string; label: string; isStudent: boolean }

// wheel geometry (SVG units, centre at 0,0)
const R_RIM = 492, R_TRACK = 426, R_POCKET_OUT = 398, R_NUM = 378, R_NAME = 306, R_POCKET_IN = 246, R_BALL_REST = 372;
const LAND_AT = 0.86;   // share of the spin after which the ball sits in its pocket

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
};

function sectorPath(i: number, step: number, r0: number, r1: number) {
  const a0 = (i - 0.5) * step, a1 = (i + 0.5) * step, large = step > 180 ? 1 : 0;
  const p0 = polar(a0, r1), p1 = polar(a1, r1), p2 = polar(a1, r0), p3 = polar(a0, r0);
  return `M${p0.x},${p0.y} A${r1},${r1} 0 ${large} 1 ${p1.x},${p1.y} L${p2.x},${p2.y} A${r0},${r0} 0 ${large} 0 ${p3.x},${p3.y} Z`;
}

const short = (s: string, max = 12) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const easeOut = (t: number, pow: number) => 1 - Math.pow(1 - t, pow);
function bounceOut(t: number) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export function RouletteGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  const { lang, pick } = useLocalized();
  const allStudents = useClassStore(s => s.students), topics = useClassStore(s => s.topics);
  const addPoints = useClassStore(s => s.addPoints), addHistory = useClassStore(s => s.addHistory);

  const [config, setConfig] = useIslandConfig<RouletteConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const entries: Entry[] = useMemo(() => (config.source === 'students'
    ? allStudents.filter(s => s.active).map(s => ({ id: s.id, label: s.name, isStudent: true }))
    : topics.map(x => ({ id: x.id, label: x.text, isStudent: false }))), [config.source, allStudents, topics]);
  const pool = usePool(entries, config.mode);
  const pockets = Math.max(config.pockets, entries.length);
  const step = 360 / pockets;

  const [seats, setSeats] = useState<(Entry | null)[]>(() => Array(pockets).fill(null));
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);
  const [result, setResult] = useState<{ text: string; kicker: string; chips: string[]; saved: boolean; burst: number } | null>(null);

  const wheelRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const wheelAngle = useRef(0);
  const ballState = useRef({ angle: 0, r: R_TRACK });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const seatPlayers = () => {
    const spots = shuffled(Array.from({ length: pockets }, (_, i) => i));
    const next: (Entry | null)[] = Array(pockets).fill(null);
    pool.available.forEach((e, k) => { next[spots[k]] = e; });
    return next;
  };

  // show seats before the first spin; after a landing the winner stays visible until the next spin
  useEffect(() => {
    if (spinning || landed !== null) return;
    setSeats(seatPlayers());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseat only when the pool/wheel changes
  }, [pool.available, pockets, landed]);

  useEffect(() => () => { tweenRef.current?.kill(); }, []);

  const place = () => {
    const w = wheelRef.current, b = ballRef.current, bs = ballState.current;
    w?.setAttribute('transform', `rotate(${wheelAngle.current})`);
    const p = polar(bs.angle, bs.r);
    b?.setAttribute('transform', `translate(${p.x},${p.y})`);
  };
  useEffect(place);

  const blocker = !entries.length
    ? (config.source === 'students' ? t('game.notEnoughStudents') : t('game.noTopics'))
    : !pool.available.length ? t('game.allPlayed') : null;

  function spin() {
    if (spinning || blocker) return;
    // 1) new random seats, then decide the outcome before anything moves
    const nextSeats = seatPlayers();
    setSeats(nextSeats);
    const target = randomInt(pockets), winner = nextSeats[target];
    // 2) solve the motion so the ball rests in that pocket
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const w0 = wheelAngle.current, wTurns = reduced ? 1 : 4, wEnd = w0 + 360 * wTurns + Math.random() * 360;
    const rel0 = ballState.current.angle - w0;                     // ball angle in the wheel's frame
    let relEnd = target * step;
    while (relEnd > rel0 - 360 * (reduced ? 2 : 6)) relEnd -= 360;   // ball runs the other way, several laps
    const drop = { from: R_TRACK, to: R_BALL_REST };
    let lastPocket = Math.floor(rel0 / step), bounced = 0;
    setSpinning(true);
    setLanded(null);
    setResult(null);
    sfx.whoosh();
    const prog = { p: 0 };
    tweenRef.current = gsap.to(prog, {
      p: 1, duration: reduced ? 3 : config.duration, ease: 'none',
      onUpdate: () => {
        const p = prog.p, q = Math.min(1, p / LAND_AT);
        wheelAngle.current = w0 + (wEnd - w0) * easeOut(p, 3);
        const rel = rel0 + (relEnd - rel0) * easeOut(q, 2.2);
        const bs = ballState.current;
        bs.angle = wheelAngle.current + rel;
        const s = Math.min(1, Math.max(0, (p - 0.55) / (LAND_AT - 0.55)));
        bs.r = drop.from + (drop.to - drop.from) * (reduced ? s : bounceOut(s));
        place();
        // pocket-edge clicks while the ball rolls, clacks on each bounce
        const pk = Math.floor(rel / step);
        if (pk !== lastPocket && q < 1) { lastPocket = pk; if (p > 0.3) sfx.tick(); }
        const bounces = [0.36, 0.73, 0.91];
        if (bounced < bounces.length && s >= bounces[bounced]) { bounced++; sfx.ballClack(); }
      },
      onComplete: () => land(target, winner),
    });
  }

  function land(target: number, winner: Entry | null) {
    tweenRef.current = null;
    wheelAngle.current %= 360;
    ballState.current.angle %= 360;
    setSpinning(false);
    setLanded(target);
    if (!winner) {
      const text = pick(config.saved);
      sfx.saved();
      setRounds(r => [...r, { text: `#${target} — ${text}`, saved: true }]);
      addHistory({ islandId: island.id, game: 'roulette', summary: `#${target} ${text}`, studentIds: [], points: 0, saved: true });
      setResult({ text, kicker: t('roulette.freeNumber', { n: target }), chips: [], saved: true, burst: Date.now() });
      return;
    }
    const text = fillTemplate(pick(config.winner), { winner: winner.label });
    const ids = winner.isStudent ? [winner.id] : [];
    if (ids.length) addPoints(ids, config.points);
    if (config.mode === 'eliminate') pool.markUsed([winner.id]);
    addHistory({ islandId: island.id, game: 'roulette', summary: text, studentIds: ids, points: ids.length ? config.points : 0 });
    setRounds(r => [...r, { text }]);
    sfx.win();
    setResult({
      text, kicker: t('roulette.number', { n: target }), saved: false, burst: Date.now(),
      chips: ids.length && config.points ? [`${winner.label} +${config.points}`] : [],
    });
  }

  function startGame(next: RouletteConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
    setResult(null);
    setLanded(null);
    setPhase('play');
  }

  function endGame() {
    tweenRef.current?.kill();
    setSpinning(false);
    setResult(null);
    setPhase('summary');
  }

  const draftCount = draft.source === 'students' ? allStudents.filter(s => s.active).length : topics.length;
  const odds = Math.round((Math.min(draftCount, Math.max(draft.pockets, draftCount)) / Math.max(draft.pockets, draftCount, 1)) * 100);
  const status = phase === 'play'
    ? (config.mode === 'eliminate' ? t('game.leftToPlay', { count: pool.available.length }) : t('game.everyoneStays'))
    : undefined;

  return (
    <GameShell island={island} title={t('roulette.name')} status={status} onExit={onExit}
      onSettings={phase === 'play' && !spinning ? () => { setDraft(config); setPhase('setup'); } : undefined}
      onEnd={phase === 'play' && !spinning ? endGame : undefined}>

      {phase === 'setup' && (
        <Panel title={t('game.setup')} footer={
          <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={() => startGame(draft)}>{t('game.start')}</button>
        }>
          <Field label={t('roulette.source')}>
            <Segmented value={draft.source} onChange={source => setDraft(d => ({ ...d, source }))} options={[
              { value: 'students', label: t('roulette.sourceStudents') },
              { value: 'topics', label: t('roulette.sourceTopics') },
            ]} />
          </Field>
          <Field label={t('roulette.pockets')} hint={t('roulette.pocketsHint', { odds })}>
            <Stepper value={Math.max(draft.pockets, draftCount)} min={Math.max(draftCount, 2)} max={99}
              onChange={pockets => setDraft(d => ({ ...d, pockets }))} />
          </Field>
          <CommonSetup mode={draft.mode} points={draft.points} pointsLabel={t('game.points')}
            onMode={mode => setDraft(d => ({ ...d, mode }))} onPoints={points => setDraft(d => ({ ...d, points }))} />
          <Field label={t('game.spinTime')}>
            <Stepper value={draft.duration} min={4} max={12} onChange={duration => setDraft(d => ({ ...d, duration }))}
              format={v => t('game.seconds', { n: v })} />
          </Field>
          <PhraseField label={t('roulette.winnerPhrase')} vars={['winner']} value={draft.winner[lang]}
            onChange={v => setDraft(d => ({ ...d, winner: { ...d.winner, [lang]: v } }))} />
          <PhraseField label={t('roulette.savedPhrase')} vars={[]} value={draft.saved[lang]}
            onChange={v => setDraft(d => ({ ...d, saved: { ...d.saved, [lang]: v } }))} />
        </Panel>
      )}

      {phase === 'play' && (
        <div className="rl-play">
          <div className={`rl-wheel-wrap ${spinning ? 'is-spinning' : ''}`}>
            <svg className="rl-wheel" viewBox="-500 -500 1000 1000" role="img" aria-label={t('roulette.name')}>
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

              {/* fixed outer rim + ball track */}
              <circle r={R_RIM} fill="url(#rl-gold)" />
              <circle r={R_RIM - 14} fill="#1A1E4A" />
              <circle r={R_RIM - 14} fill="none" stroke="#FFD166" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="3 14" />
              {Array.from({ length: 8 }, (_, i) => {
                const p = polar(i * 45 + 22.5, R_RIM - 7);
                return <path key={i} d="M0,-7 Q0,0 7,0 Q0,0 0,7 Q0,0 -7,0 Q0,0 0,-7Z" fill="#fff3c4" transform={`translate(${p.x},${p.y})`} />;
              })}

              {/* rotating wheel */}
              <g ref={wheelRef}>
                <circle r={R_POCKET_OUT + 6} fill="#FFD166" />
                {Array.from({ length: pockets }, (_, i) => {
                  const seat = seats[i], isWin = landed === i;
                  const fill = i === 0 ? '#b8860b' : i % 2 ? '#F72585' : '#1A1E4A';
                  const num = polar(i * step, R_NUM), nameSize = Math.min(20, Math.max(10, (2 * Math.PI * R_NAME) / pockets * 0.36));
                  return (
                    <g key={i} className={`rl-pocket ${seat ? 'has-seat' : 'is-free'} ${isWin ? 'is-win' : ''}`}>
                      <path d={sectorPath(i, step, R_POCKET_IN, R_POCKET_OUT)} fill={fill} stroke="#FFD166" strokeWidth="2" />
                      {isWin && <path d={sectorPath(i, step, R_POCKET_IN, R_POCKET_OUT)} className="rl-win-glow" />}
                      <text className="rl-num" x={num.x} y={num.y} transform={`rotate(${i * step} ${num.x} ${num.y})`}
                        fontSize={Math.min(26, Math.max(12, (2 * Math.PI * R_NUM) / pockets * 0.42))}>{i}</text>
                      {seat && (
                        <text className="rl-name" key={seat.id} transform={`rotate(${i * step}) translate(0 ${-R_NAME}) rotate(-90)`} fontSize={nameSize}>
                          {short(seat.label)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* lunar cone + crescent hub */}
                <circle r={R_POCKET_IN} fill="url(#rl-moon)" stroke="#FFD166" strokeWidth="6" />
                {[[-120, -60, 26], [90, -110, 18], [110, 80, 30], [-80, 120, 20], [-150, 40, 14], [30, 160, 12]].map(([x, y, r], i) => (
                  <circle key={i} cx={x} cy={y} r={r} fill="#5b5a93" fillOpacity="0.35" stroke="#e9eaff" strokeOpacity="0.4" strokeWidth="2" />
                ))}
                <circle r="104" fill="#1A1E4A" stroke="#FFD166" strokeWidth="5" />
                <path d="M34,-78 A84,84 0 1 0 34,78 A64,64 0 1 1 34,-78Z" fill="#F1F3FF" className="rl-crescent" />
                <path d="M0,-58 Q0,0 16,0 Q0,0 0,58 Q0,0 -16,0 Q0,0 0,-58Z" fill="url(#rl-gold)" transform="translate(40 0)" />
              </g>

              {/* ball */}
              <g ref={ballRef} className="rl-ball">
                <circle r="30" fill="#4CC9F0" opacity="0.45" filter="url(#rl-glow)" />
                <circle r="15" fill="#F1F3FF" />
                <circle r="5" cx="-5" cy="-5" fill="#ffffff" />
              </g>
            </svg>
            <div className="rl-pointer" aria-hidden="true" />
          </div>

          <aside className="rl-side">
            {blocker && !spinning ? (
              <Notice text={blocker} action={config.mode === 'eliminate' && entries.length
                ? <button type="button" className="rc-cut gm-btn" onClick={pool.reset}>{t('game.restartRound')}</button> : undefined} />
            ) : (
              <button type="button" className="rc-cut gm-btn gm-btn-primary rl-spin" onClick={spin} disabled={spinning}>
                {spinning ? t('roulette.spinning') : t('roulette.spin')}
              </button>
            )}
            <div className="rl-odds">{t('roulette.oddsNow', { count: pool.available.length, pockets })}</div>
            {!!rounds.length && (
              <ol className="rl-log" reversed>
                {[...rounds].reverse().slice(0, 6).map((r, i) => <li key={i} className={r.saved ? 'is-saved' : ''}>{r.text}</li>)}
              </ol>
            )}
          </aside>
        </div>
      )}

      {phase === 'summary' && <Summary rounds={rounds} onNew={() => { setDraft(config); setPhase('setup'); }} onExit={onExit} />}

      {result && (
        <ResultOverlay island={island} kicker={result.kicker} text={result.text} burstKey={result.burst}
          tone={result.saved ? 'saved' : 'win'} chips={result.chips.map(label => ({ label }))}
          actions={<>
            <button type="button" className="rc-cut gm-btn gm-btn-primary" disabled={!!blocker && !result.saved}
              onClick={() => { setResult(null); spin(); }}>{t('roulette.spinAgain')}</button>
            <button type="button" className="rc-cut gm-btn" onClick={() => setResult(null)}>{t('game.continue')}</button>
          </>} />
      )}
    </GameShell>
  );
}

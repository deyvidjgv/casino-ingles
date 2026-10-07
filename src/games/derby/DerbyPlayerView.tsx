// Student mobile/PC interactive screen for Stellar Derby live racing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../features/auth/authStore';
import { useClassStore } from '../../store/classStore';
import {
  initServerTimeOffset,
  getServerTime,
  subscribeRaceState,
  subscribePositions,
  sendStudentTap,
  setRiderReady,
  raiseHand,
  placeLiveBet,
  type LiveRaceState,
} from './derbySync';
import { HORSE, type HorseColor } from './scene';
import { sfx } from '../../lib/sfx';

export function DerbyPlayerView() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);
  const courseId = useClassStore(s => s.courseId);

  const [raceState, setRaceState] = useState<LiveRaceState | null>(null);
  const [positions, setPositions] = useState<Record<number, number>>({});
  const [myBet, setMyBet] = useState<HorseColor | null>(null);
  const [ready, setReady] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [practiceTaps, setPracticeTaps] = useState(0);

  // Tap accumulator
  const [tapCount, setTapCount] = useState(0);
  const lastSentRef = useRef(0);
  const tapCountRef = useRef(0);
  useEffect(() => {
    tapCountRef.current = tapCount;
  }, [tapCount]);

  // Rhythm meter (taps per second)
  const [tapBps, setTapBps] = useState(0);
  const recentTapTimes = useRef<number[]>([]);
  const prevRaceId = useRef(raceState?.raceId);

  // Detect input devices
  const isTouchDevice = useMemo(() => {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  }, []);

  useEffect(() => {
    initServerTimeOffset();
  }, []);

  // Subscribe to live race state from RTDB
  useEffect(() => {
    if (!courseId) return;
    const unsubState = subscribeRaceState(courseId, state => {
      setRaceState(state);
      if (state?.phase !== 'question') {
        setHandRaised(false);
      }
    });
    const unsubPos = subscribePositions(courseId, pos => {
      setPositions(pos);
    });
    return () => {
      unsubState();
      unsubPos();
    };
  }, [courseId]);

  // Screen Wake Lock during active race
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wakeLock: any = null;
    if (raceState?.phase === 'running' && 'wakeLock' in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock?.request('screen')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((wl: any) => { wakeLock = wl; })
        .catch(() => {});
    }
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wakeLock as any)?.release?.().catch(() => {});
    };
  }, [raceState?.phase]);

  // Find my rider identity
  const myRider = useMemo(() => {
    const riders = raceState?.riders;
    if (!riders || !user) return null;
    return Object.values(riders).find(
      r => r.uid === user.uid || r.studentId === user.uid
    ) ?? null;
  }, [raceState, user]);

  // Batch tap sending (~150 ms)
  useEffect(() => {
    if (raceState?.phase !== 'running' || !courseId || !user || !myRider) return;
    const interval = setInterval(() => {
      const current = tapCountRef.current;
      if (current !== lastSentRef.current) {
        lastSentRef.current = current;
        void sendStudentTap(courseId, user.uid, raceState.raceId, current);
      }
    }, 150);
    return () => clearInterval(interval);
  }, [raceState?.phase, raceState?.raceId, courseId, user, myRider]);

  // Reset tap count on new race
  useEffect(() => {
    if (raceState?.raceId && raceState.raceId !== prevRaceId.current) {
      prevRaceId.current = raceState.raceId;
      setTapCount(0);
      lastSentRef.current = 0;
      recentTapTimes.current = [];
      setTapBps(0);
    }
  }, [raceState?.raceId]);

  // Synchronized countdown ticker
  const [countdown, setCountdown] = useState<number | string>(3);
  useEffect(() => {
    if (raceState?.phase !== 'countdown') return;
    const startAt = raceState.startAt;
    const checkCountdown = () => {
      const now = getServerTime();
      const diff = Math.ceil((startAt - now) / 1000);
      if (diff > 0) {
        setCountdown(diff);
        try { navigator.vibrate?.(60); } catch {}
      } else {
        setCountdown('GO!');
        try { navigator.vibrate?.([100, 50, 100]); } catch {}
      }
    };
    checkCountdown();
    const interval = setInterval(checkCountdown, 250);
    return () => clearInterval(interval);
  }, [raceState?.phase, raceState?.startAt]);

  // Tap handling function
  const registerTap = useCallback(() => {
    const now = performance.now();
    recentTapTimes.current.push(now);
    // keep only taps within the last 1 second
    recentTapTimes.current = recentTapTimes.current.filter(t => now - t <= 1000);
    setTapBps(recentTapTimes.current.length);

    setTapCount(c => c + 1);
    try { navigator.vibrate?.(20); } catch {}
  }, []);

  // Keyboard tapping listener: Space and Enter (ignores e.repeat!)
  useEffect(() => {
    if (raceState?.phase !== 'running' || !myRider) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // Ignore key-holding!
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        registerTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [raceState?.phase, myRider, registerTap]);

  // Practice tapping listener in tutorial
  const registerPracticeTap = useCallback(() => {
    setPracticeTaps(c => c + 1);
    try { navigator.vibrate?.(25); } catch {}
  }, []);

  useEffect(() => {
    if (raceState?.phase !== 'lobby' || ready || !myRider) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        registerPracticeTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [raceState?.phase, ready, myRider, registerPracticeTap]);

  // Spectator placing a bet
  const handleBet = (color: HorseColor) => {
    if (!courseId || !user || myBet === color) return;
    setMyBet(color);
    sfx.click();
    void placeLiveBet(courseId, user.uid, color);
  };

  // Mark ready
  const handleReady = () => {
    if (!courseId || !user) return;
    setReady(true);
    sfx.correct();
    void setRiderReady(courseId, user.uid, true);
  };

  // Raise hand for questions
  const handleRaiseHand = () => {
    if (!courseId || !user || handRaised) return;
    setHandRaised(true);
    sfx.lever();
    try { navigator.vibrate?.(50); } catch {}
    void raiseHand(courseId, user.uid);
  };

  if (!raceState || raceState.phase === 'closed') {
    return (
      <div className="dv-pview dv-pview-waiting">
        <div className="dv-pview-card">
          <div className="dv-pview-title">{t('derby.waitingTitle')}</div>
          <p className="dv-pview-text">{t('derby.waitingBoard')}</p>
        </div>
      </div>
    );
  }

  /* ========================================================================= */
  /* SPECTATOR VIEW (NOT CHOSEN TO RACE)                                       */
  /* ========================================================================= */
  if (!myRider) {
    return (
      <div className="dv-pview dv-pview-spectator">
        <header className="dv-pview-header">
          <div className="dv-pview-tag">{t('derby.spectatorTag')}</div>
          <h2 className="dv-pview-title">{t('derby.spectatorTitle')}</h2>
          <p className="dv-pview-note">{t('derby.spectatorNote')}</p>
        </header>

        {raceState.betting && (raceState.phase === 'lobby' || raceState.phase === 'tutorial') && (
          <section className="dv-pview-bet-section">
            <h3 className="dv-pview-sub">{t('derby.betPickPrompt')}</h3>
            <div className="dv-pview-bet-grid">
              {Object.values(raceState.riders).map(rider => {
                const colorDef = HORSE[rider.color];
                const selected = myBet === rider.color;
                return (
                  <button
                    key={rider.uid}
                    type="button"
                    className={`rc-cut dv-pview-bet-btn ${selected ? 'is-selected' : ''}`}
                    style={{
                      borderColor: colorDef.glow,
                      boxShadow: selected ? `0 0 16px ${colorDef.glow}` : undefined,
                    }}
                    onClick={() => handleBet(rider.color)}
                  >
                    <img
                      src={`/horses/${rider.color}-a.webp`}
                      alt={rider.color}
                      className="dv-pview-bet-avatar"
                    />
                    <span className="dv-pview-bet-rider">{rider.name}</span>
                    <span className="dv-pview-bet-lane">{t('derby.laneN', { n: rider.lane + 1 })}</span>
                  </button>
                );
              })}
            </div>
            {myBet && (
              <div className="dv-pview-bet-confirmed">
                {t('derby.betPlaced', { color: t(`derby.color_${myBet}`) })}
              </div>
            )}
          </section>
        )}

        {(raceState.phase === 'running' || raceState.phase === 'question') && (
          <div className="dv-pview-watching-run">
            <div className="dv-pview-live-badge">{t('derby.raceInProgress')}</div>
            {myBet && (
              <div className="dv-pview-bet-reminder">
                {t('derby.rootingFor', { color: t(`derby.color_${myBet}`) })}
              </div>
            )}
            <p className="dv-pview-note">{t('derby.lookAtProjector')}</p>
          </div>
        )}

        {raceState.phase === 'finish' && (
          <div className="dv-pview-finish-spec">
            <h3 className="dv-pview-title">{t('derby.raceFinished')}</h3>
            <p className="dv-pview-note">{t('derby.podiumShownOnBoard')}</p>
          </div>
        )}
      </div>
    );
  }

  /* ========================================================================= */
  /* RIDER VIEW (CHOSEN TO RUN)                                                */
  /* ========================================================================= */
  const colorDef = HORSE[myRider.color];
  const myProgress = positions[myRider.lane] ?? 0;
  const isTurbo = raceState.turboUid === myRider.uid || raceState.turboUid === user?.uid;

  // Calculate my rank
  const allLanes = Object.values(raceState.riders).map(r => ({
    lane: r.lane,
    prog: positions[r.lane] ?? 0,
  }));
  allLanes.sort((a, b) => b.prog - a.prog);
  const myRank = allLanes.findIndex(l => l.lane === myRider.lane) + 1;

  // LOBBY & TUTORIAL
  if (raceState.phase === 'lobby' || raceState.phase === 'tutorial') {
    return (
      <div className="dv-pview dv-pview-rider-lobby">
        <header className="dv-pview-hero" style={{ borderColor: colorDef.glow }}>
          <span className="dv-pview-alert">{t('derby.youAreRacingAlert')}</span>
          <img
            src={`/horses/${myRider.color}-a.webp`}
            alt={myRider.color}
            className="dv-pview-horse-hero"
            style={{ filter: `drop-shadow(0 0 16px ${colorDef.glow})` }}
          />
          <h2 className="dv-pview-horse-name" style={{ color: colorDef.glow }}>
            {t(`derby.color_${myRider.color}`)} — {t('derby.laneN', { n: myRider.lane + 1 })}
          </h2>
        </header>

        <section className="dv-pview-tutorial rc-cut">
          <h3 className="dv-pview-tuto-title">{t('derby.howToPlayTitle')}</h3>
          <div className="dv-pview-tuto-rules">
            {isTouchDevice ? (
              <p>👉 <strong>{t('derby.ruleTouch')}</strong></p>
            ) : (
              <p>⌨️ <strong>{t('derby.ruleKeyboard')}</strong></p>
            )}
            <p>⚡ <strong>{t('derby.ruleQuestion')}</strong></p>
          </div>

          <div className="dv-pview-practice">
            <span className="dv-pview-practice-label">
              {t('derby.practiceLabel')} ({practiceTaps} taps)
            </span>
            <button
              type="button"
              className="rc-cut dv-pview-practice-btn"
              style={{ backgroundColor: colorDef.glow }}
              onPointerDown={registerPracticeTap}
            >
              {t('derby.practiceBtn')}
            </button>
          </div>

          <button
            type="button"
            className={`rc-cut dv-pview-ready-btn ${ready ? 'is-ready' : ''}`}
            disabled={ready}
            onClick={handleReady}
          >
            {ready ? `✓ ${t('derby.iAmReady')}` : t('derby.pressReady')}
          </button>
        </section>
      </div>
    );
  }

  // COUNTDOWN
  if (raceState.phase === 'countdown') {
    return (
      <div className="dv-pview dv-pview-countdown" style={{ backgroundColor: colorDef.glow + '15' }}>
        <div className="dv-pview-cd-box">
          <span className="dv-pview-cd-getready">{t('derby.getReady')}</span>
          <div className="dv-pview-cd-number" style={{ color: colorDef.glow }}>
            {countdown}
          </div>
          <span className="dv-pview-cd-sub">{t('derby.tapFastWhenGo')}</span>
        </div>
      </div>
    );
  }

  // QUESTION FREEZE
  if (raceState.phase === 'question') {
    return (
      <div className="dv-pview dv-pview-frozen">
        <div className="dv-pview-frozen-banner">
          ❄️ {t('derby.frozenTitle')}
        </div>

        <div className="dv-pview-question-card rc-cut">
          <span className="dv-pview-q-label">{t('derby.questionKicker')}</span>
          <p className="dv-pview-q-text">{raceState.currentQuestion}</p>
        </div>

        <div className="dv-pview-hand-actions">
          <button
            type="button"
            className={`rc-cut dv-pview-hand-btn ${handRaised ? 'is-raised' : ''}`}
            disabled={handRaised}
            onClick={handleRaiseHand}
          >
            {handRaised ? `✋ ${t('derby.handRaised')}` : `🙋 ${t('derby.raiseHand')}`}
          </button>
          <span className="dv-pview-hand-hint">{t('derby.raiseHandHint')}</span>
        </div>

        {isTurbo && (
          <div className="dv-pview-turbo-toast">
            🚀 <strong>TURBO!</strong> +{raceState.turboPoints} PTS!
          </div>
        )}
      </div>
    );
  }

  // RACE FINISHED
  if (raceState.phase === 'finish') {
    const podiumEntry = raceState.results?.podium?.find(p => p.uid === user?.uid || p.lane === myRider.lane);
    return (
      <div className="dv-pview dv-pview-finish">
        <div className="dv-pview-finish-card rc-cut">
          <span className="dv-pview-finish-pos">
            {podiumEntry ? `#${podiumEntry.pos}` : `#${myRank}`}
          </span>
          <h2 className="dv-pview-finish-title">
            {podiumEntry && podiumEntry.pos === 1 ? t('derby.youWon') : t('derby.greatRace')}
          </h2>
          {podiumEntry && podiumEntry.points > 0 && (
            <div className="dv-pview-finish-pts">
              +{podiumEntry.points} {t('derby.ptsAwarded')}
            </div>
          )}
          <p className="dv-pview-note">{t('derby.lookAtProjector')}</p>
        </div>
      </div>
    );
  }

  // RUNNING PHASE: Huge interactive tap screen
  return (
    <div className={`dv-pview dv-pview-running ${isTurbo ? 'is-turbo' : ''}`}>
      {/* Top HUD: rank, progress, speed */}
      <header className="dv-pview-hud">
        <div className="dv-pview-hud-rank">
          <span>{t('derby.pos')}</span>
          <strong>{myRank}º</strong>
        </div>
        <div className="dv-pview-hud-bar">
          <div
            className="dv-pview-hud-fill"
            style={{
              width: `${Math.min(100, myProgress * 100)}%`,
              backgroundColor: colorDef.glow,
            }}
          />
        </div>
        <div className="dv-pview-hud-rhythm">
          <span>{tapBps}</span>
          <small>taps/s</small>
        </div>
      </header>

      {/* Turbo banner */}
      {isTurbo && (
        <div className="dv-pview-turbo-active">
          ⚡ <strong>TURBO BOOST!</strong> ⚡
        </div>
      )}

      {/* Massive tapping button */}
      <button
        type="button"
        className="dv-pview-huge-tap"
        style={{
          backgroundColor: colorDef.glow,
          boxShadow: `0 0 32px ${colorDef.glow}88, inset 0 0 20px rgba(255,255,255,0.4)`,
        }}
        onPointerDown={registerTap}
        onContextMenu={e => e.preventDefault()}
      >
        <div className="dv-pview-tap-content">
          <img
            src={`/horses/${myRider.color}-a.webp`}
            alt={myRider.color}
            className="dv-pview-tap-horse"
          />
          <span className="dv-pview-tap-text">{t('derby.tapTapTap')}</span>
          <span className="dv-pview-tap-sub">{t('derby.fasterFaster')}</span>
        </div>
      </button>

      {/* Footer hint */}
      <footer className="dv-pview-footer">
        {isTouchDevice ? t('derby.keepTappingPhone') : t('derby.keepTappingKeyboard')}
      </footer>
    </div>
  );
}

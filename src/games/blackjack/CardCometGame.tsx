// Card Comet — Cosmic Blackjack with Card Draw and Real Blackjack modes.
// Crypto-first randomness with 3D GSAP card flips and interactive English validation.
import { useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { useClassStore } from '../../store/classStore';
import { pickDistinct, pickOne } from '../../lib/random';
import { sfx } from '../../lib/sfx';
import {
  CommonSetup,
  Field,
  GameShell,
  Notice,
  Panel,
  ResultOverlay,
  Segmented,
  Summary,
  type RoundLog,
} from '../shared/ui';
import { useIslandConfig, useLocalized, usePool } from '../shared/hooks';
import type { GameProps, PlayMode } from '../types';
import './blackjack.css';

type GameMode = 'draw' | 'blackjack';
type DrawPreset = '2s' | '1s1q' | '1s1t' | '3s';

interface CardCometConfig {
  gameMode: GameMode;
  drawPreset: DrawPreset;
  mode: PlayMode;
  points: number;
}

const DEFAULTS: CardCometConfig = {
  gameMode: 'blackjack',
  drawPreset: '2s',
  mode: 'keep',
  points: 2,
};

type CardSuit = '♠' | '♥' | '♦' | '♣';
type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

interface CardItem {
  id: string;
  suit: CardSuit;
  rank: CardRank;
  isRed: boolean;
  value: number;
  label?: string;
  subLabel?: string;
}

const SUITS: { suit: CardSuit; isRed: boolean }[] = [
  { suit: '♠', isRed: false },
  { suit: '♥', isRed: true },
  { suit: '♦', isRed: true },
  { suit: '♣', isRed: false },
];
const RANKS: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createCard(rank?: CardRank, suitObj?: { suit: CardSuit; isRed: boolean }): CardItem {
  const chosenSuit = suitObj ?? pickOne(SUITS);
  const chosenRank = rank ?? pickOne(RANKS);
  let val = 10;
  if (chosenRank === 'A') val = 11;
  else if (!['J', 'Q', 'K'].includes(chosenRank)) val = parseInt(chosenRank, 10);

  return {
    id: crypto.randomUUID(),
    suit: chosenSuit.suit,
    rank: chosenRank,
    isRed: chosenSuit.isRed,
    value: val,
  };
}

function calculateHand(cards: CardItem[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      total += 11;
    } else {
      total += c.value;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function CardCometGame({ island, onExit }: GameProps) {
  const { t } = useTranslation();
  useLocalized();
  const allStudents = useClassStore(s => s.students);
  const topics = useClassStore(s => s.topics);
  const questions = useClassStore(s => s.questions);
  const addPoints = useClassStore(s => s.addPoints);
  const addHistory = useClassStore(s => s.addHistory);

  const students = useMemo(() => allStudents.filter(s => s.active), [allStudents]);
  const [config, setConfig] = useIslandConfig<CardCometConfig>(island.id, DEFAULTS);
  const [draft, setDraft] = useState(config);
  const [phase, setPhase] = useState<'setup' | 'play' | 'summary'>('setup');
  const [rounds, setRounds] = useState<RoundLog[]>([]);

  const pool = usePool(students, config.mode);

  // Mode A: Card Draw state
  const [drawCards, setDrawCards] = useState<{ card: CardItem; flipped: boolean; kind: string; text: string; studentId?: string }[]>([]);
  const [allFlipped, setAllFlipped] = useState(false);

  // Mode B: Blackjack state
  const [p1, setP1] = useState<{ id: string; name: string } | null>(null);
  const [p2, setP2] = useState<{ id: string; name: string } | null>(null);
  const [dealerHand, setDealerHand] = useState<CardItem[]>([]);
  const [dealerHoleFlipped, setDealerHoleFlipped] = useState(false);
  const [p1Hand, setP1Hand] = useState<CardItem[]>([]);
  const [p2Hand, setP2Hand] = useState<CardItem[]>([]);
  const [turn, setTurn] = useState<'p1' | 'p2' | 'dealer' | 'over'>('p1');
  const [activeQuestion, setActiveQuestion] = useState<{ text: string; forPlayer: string; target: 'p1' | 'p2' } | null>(null);

  // Shared result state
  const [result, setResult] = useState<{ text: string; kicker: string; chips: string[]; burst: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const minRequiredStudents = config.gameMode === 'blackjack' ? 2 : config.drawPreset === '3s' ? 3 : config.drawPreset === '2s' ? 2 : 1;
  const blocker = students.length < minRequiredStudents
    ? t('game.notEnoughStudents')
    : pool.available.length < minRequiredStudents
    ? t('game.allPlayed')
    : null;

  // Initialize Mode A: Card Draw
  function startDrawRound() {
    if (blocker) return;
    setResult(null);
    setAllFlipped(false);

    let cardConfigs: { kind: string; text: string; studentId?: string }[] = [];
    if (config.drawPreset === '2s') {
      const chosen = pickDistinct(pool.available, 2);
      cardConfigs = [
        { kind: t('blackjack.kind_student'), text: chosen[0].name, studentId: chosen[0].id },
        { kind: t('blackjack.kind_student'), text: chosen[1].name, studentId: chosen[1].id },
      ];
    } else if (config.drawPreset === '1s1q') {
      const student = pickOne(pool.available);
      const q = questions.length ? pickOne(questions).text : 'Tell us about your weekend!';
      cardConfigs = [
        { kind: t('blackjack.kind_student'), text: student.name, studentId: student.id },
        { kind: t('blackjack.kind_question'), text: q },
      ];
    } else if (config.drawPreset === '1s1t') {
      const student = pickOne(pool.available);
      const top = topics.length ? pickOne(topics).text : 'Hobbies';
      cardConfigs = [
        { kind: t('blackjack.kind_student'), text: student.name, studentId: student.id },
        { kind: t('blackjack.kind_topic'), text: top },
      ];
    } else {
      const chosen = pickDistinct(pool.available, 3);
      cardConfigs = chosen.map(s => ({ kind: t('blackjack.kind_student'), text: s.name, studentId: s.id }));
    }

    const items = cardConfigs.map(c => ({
      card: createCard(),
      flipped: false,
      kind: c.kind,
      text: c.text,
      studentId: c.studentId,
    }));
    setDrawCards(items);
    sfx.cardFlip();
    requestAnimationFrame(() => {
      if (tableRef.current) {
        gsap.fromTo(
          tableRef.current.querySelectorAll('.bk-draw-card-wrap'),
          { y: -30, opacity: 0, scale: 0.9 },
          { y: 0, opacity: 1, scale: 1, duration: 0.45, stagger: 0.08, ease: 'back.out(1.4)' }
        );
      }
    });
  }

  function flipDrawCard(index: number) {
    if (drawCards[index]?.flipped) return;
    sfx.cardFlip();
    setDrawCards(prev => {
      const next = prev.map((c, i) => (i === index ? { ...c, flipped: true } : c));
      const allDone = next.every(c => c.flipped);
      if (allDone) {
        finishDrawRound(next);
      }
      return next;
    });
  }

  function flipAllDrawCards() {
    sfx.cardFlip();
    setDrawCards(prev => {
      const next = prev.map(c => ({ ...c, flipped: true }));
      finishDrawRound(next);
      return next;
    });
  }

  function finishDrawRound(cards: typeof drawCards) {
    setAllFlipped(true);
    const studentCards = cards.filter(c => c.studentId);
    const studentIds = studentCards.map(c => c.studentId!);
    const studentNames = studentCards.map(c => c.text);

    if (config.points > 0 && studentIds.length) {
      addPoints(studentIds, config.points);
    }
    if (config.mode === 'eliminate' && studentIds.length) {
      pool.markUsed(studentIds);
    }

    const summaryText = cards.map(c => `${c.kind}: ${c.text}`).join(' · ');
    addHistory({
      islandId: island.id,
      game: 'blackjack',
      summary: summaryText,
      studentIds,
      points: config.points,
    });
    setRounds(r => [...r, { text: summaryText }]);
    sfx.win();
    setResult({
      text: studentNames.join(' & ') || summaryText,
      kicker: t('blackjack.cardsDrawn'),
      chips: studentNames.map(name => `${name} +${config.points}`),
      burst: Date.now(),
    });
  }

  // Initialize Mode B: Real Blackjack
  function startBlackjackRound() {
    if (blocker) return;
    setResult(null);
    setActiveQuestion(null);
    setDealerHoleFlipped(false);

    // Pick 2 players
    const [p1Choice, p2Choice] = pickDistinct(pool.available, 2);
    setP1(p1Choice);
    setP2(p2Choice);

    // Deal 2 cards each to P1 & P2, 2 to dealer (1 face up, 1 face down)
    const d1 = createCard(), d2 = createCard();
    const p1c1 = createCard(), p1c2 = createCard();
    const p2c1 = createCard(), p2c2 = createCard();

    setDealerHand([d1, d2]);
    setP1Hand([p1c1, p1c2]);
    setP2Hand([p2c1, p2c2]);
    setTurn('p1');
    sfx.cardFlip();
    requestAnimationFrame(() => {
      if (tableRef.current) {
        gsap.fromTo(
          tableRef.current.querySelectorAll('.bk-card-wrap'),
          { y: -25, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'power2.out' }
        );
      }
    });
  }

  // Soft Rule Hit Request
  function requestHit(target: 'p1' | 'p2') {
    const studentName = target === 'p1' ? p1?.name : p2?.name;
    const qList = questions.length ? questions : [{ id: '1', text: 'What is your favorite hobby and why?' }];
    const chosenQ = pickOne(qList).text;
    setActiveQuestion({ text: chosenQ, forPlayer: studentName || 'Student', target });
  }

  // Teacher Answer Validation
  function handleAnswer(correct: boolean) {
    if (!activeQuestion) return;
    const target = activeQuestion.target;
    setActiveQuestion(null);

    if (correct) {
      sfx.correct();
      const newCard = createCard();
      if (target === 'p1') {
        const nextHand = [...p1Hand, newCard];
        setP1Hand(nextHand);
        const score = calculateHand(nextHand);
        if (score >= 21) {
          // Automatic advance
          setTurn('p2');
        }
      } else {
        const nextHand = [...p2Hand, newCard];
        setP2Hand(nextHand);
        const score = calculateHand(nextHand);
        if (score >= 21) {
          // Automatic advance to dealer
          startDealerTurn();
        }
      }
    } else {
      // SOFT RULE: No card drawn, passes turn without losing existing cards!
      sfx.wrong();
      if (target === 'p1') {
        setTurn('p2');
      } else {
        startDealerTurn();
      }
    }
  }

  function handleStand(target: 'p1' | 'p2') {
    sfx.click();
    if (target === 'p1') {
      setTurn('p2');
    } else {
      startDealerTurn();
    }
  }

  function startDealerTurn() {
    setTurn('dealer');
    setDealerHoleFlipped(true);
    sfx.cardFlip();

    // Check dealer play loop
    setTimeout(() => {
      let currentHand = [...dealerHand];
      let score = calculateHand(currentHand);

      const p1Score = calculateHand(p1Hand);
      const p2Score = calculateHand(p2Hand);
      const playersAlive = (p1Score <= 21) || (p2Score <= 21);

      // Dealer hits until 17 if players are alive
      if (playersAlive) {
        while (score < 17) {
          const c = createCard();
          currentHand.push(c);
          score = calculateHand(currentHand);
        }
      }
      setDealerHand([...currentHand]);
      resolveBlackjack([...currentHand]);
    }, 900);
  }

  function resolveBlackjack(finalDealerHand: CardItem[]) {
    setTurn('over');
    const dScore = calculateHand(finalDealerHand);
    const p1Score = calculateHand(p1Hand);
    const p2Score = calculateHand(p2Hand);

    const p1Bust = p1Score > 21;
    const p2Bust = p2Score > 21;
    const dBust = dScore > 21;

    const p1Win = !p1Bust && (dBust || p1Score > dScore);
    const p2Win = !p2Bust && (dBust || p2Score > dScore);
    const p1Tie = !p1Bust && !dBust && p1Score === dScore;
    const p2Tie = !p2Bust && !dBust && p2Score === dScore;

    const winningIds: string[] = [];
    const winningNames: string[] = [];
    if (p1Win && p1) { winningIds.push(p1.id); winningNames.push(p1.name); }
    if (p2Win && p2) { winningIds.push(p2.id); winningNames.push(p2.name); }

    let kicker = t('blackjack.winnerTitle');
    let bannerText = '';

    if (p1Win && p2Win) {
      bannerText = t('blackjack.bothWin', { p1: p1?.name, p2: p2?.name });
    } else if (p1Win) {
      bannerText = t('blackjack.p1Wins', { name: p1?.name, score: p1Score });
    } else if (p2Win) {
      bannerText = t('blackjack.p2Wins', { name: p2?.name, score: p2Score });
    } else if (p1Tie || p2Tie) {
      bannerText = t('blackjack.push', { score: dScore });
    } else {
      bannerText = t('blackjack.dealerWins');
      kicker = dBust ? t('blackjack.dealerBust') : t('blackjack.dealerWins');
    }

    if (winningIds.length && config.points > 0) {
      addPoints(winningIds, config.points);
    }
    if (config.mode === 'eliminate' && winningIds.length) {
      pool.markUsed(winningIds);
    }

    const summaryText = `${p1?.name} (${p1Score}) vs ${p2?.name} (${p2Score}) vs Dealer (${dScore}) → ${bannerText}`;
    addHistory({
      islandId: island.id,
      game: 'blackjack',
      summary: summaryText,
      studentIds: winningIds,
      points: config.points,
    });
    setRounds(r => [...r, { text: summaryText }]);

    if (winningIds.length) {
      sfx.win();
    } else {
      sfx.saved();
    }

    setResult({
      text: bannerText,
      kicker,
      chips: winningNames.map(name => `${name} +${config.points}`),
      burst: Date.now(),
    });
  }

  function startGame(next: CardCometConfig) {
    setConfig(next);
    pool.reset();
    setRounds([]);
    setResult(null);
    setPhase('play');

    if (next.gameMode === 'draw') {
      setTimeout(() => startDrawRound(), 50);
    } else {
      setTimeout(() => startBlackjackRound(), 50);
    }
  }

  const p1Score = calculateHand(p1Hand);
  const p2Score = calculateHand(p2Hand);
  const dealerScore = dealerHoleFlipped ? calculateHand(dealerHand) : dealerHand[0]?.value || 0;

  const status = phase === 'play'
    ? (config.mode === 'eliminate' ? t('game.leftToPlay', { count: pool.available.length }) : t('game.everyoneStays'))
    : undefined;

  return (
    <GameShell
      island={island}
      title={t('blackjack.name')}
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
          <Field label={t('blackjack.modeLabel')}>
            <Segmented
              value={draft.gameMode}
              options={[
                { value: 'blackjack', label: t('blackjack.modeRealBlackjack'), hint: t('blackjack.modeRealBlackjackDesc') },
                { value: 'draw', label: t('blackjack.modeCardDraw'), hint: t('blackjack.modeCardDrawDesc') },
              ]}
              onChange={m => setDraft(d => ({ ...d, gameMode: m }))}
            />
          </Field>

          {draft.gameMode === 'draw' && (
            <Field label={t('blackjack.cardCount')}>
              <Segmented
                value={draft.drawPreset}
                options={[
                  { value: '2s', label: t('blackjack.preset2Students') },
                  { value: '1s1q', label: t('blackjack.preset1s1q') },
                  { value: '1s1t', label: t('blackjack.preset1s1t') },
                  { value: '3s', label: t('blackjack.preset3Students') },
                ]}
                onChange={p => setDraft(d => ({ ...d, drawPreset: p }))}
              />
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
        <div className="bk-play">
          <div ref={tableRef} className="bk-table">
            <div className="bk-felt-arc" />
            <div className="bk-felt-title">Cosmic Orbit Blackjack</div>

            {config.gameMode === 'draw' ? (
              /* MODE A: CARD DRAW */
              <>
                <div className="bk-draw-grid">
                  {drawCards.map((item, idx) => (
                    <div
                      key={item.card.id}
                      className={`bk-card-wrap bk-draw-card-wrap ${item.flipped ? 'is-flipped' : ''}`}
                      onClick={() => flipDrawCard(idx)}
                    >
                      <div className="bk-card-3d">
                        <div className="bk-card-face bk-card-back">
                          <div className="bk-card-back-pattern">
                            <span className="bk-card-logo">★</span>
                          </div>
                        </div>
                        <div className="bk-card-face bk-card-front">
                          <span className="bk-draw-kind-tag">{item.kind}</span>
                          <div className="bk-draw-card-content">{item.text}</div>
                          <span className="bk-draw-kind-tag">★ COSMIC ★</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bk-controls">
                  {!allFlipped && (
                    <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={flipAllDrawCards}>
                      {t('blackjack.flipAll')}
                    </button>
                  )}
                  <button type="button" className="rc-cut gm-btn" onClick={startDrawRound}>
                    {t('blackjack.newDraw')}
                  </button>
                </div>
              </>
            ) : (
              /* MODE B: REAL BLACKJACK */
              <>
                {/* Dealer Area */}
                <div className="bk-dealer-area">
                  <div className="bk-area-header">
                    <span className="bk-area-name">{t('blackjack.dealer')}</span>
                    <span className={`bk-badge-score ${dealerScore > 21 ? 'bk-badge-bust' : ''}`}>
                      {dealerHoleFlipped ? `${dealerScore} ${dealerScore > 21 ? t('blackjack.bust') : ''}` : `${dealerScore} + ?`}
                    </span>
                  </div>
                  <div className="bk-hand">
                    {dealerHand.map((c, i) => {
                      const flipped = i === 0 || dealerHoleFlipped;
                      return (
                        <div key={c.id} className={`bk-card-wrap ${flipped ? 'is-flipped' : ''}`}>
                          <div className="bk-card-3d">
                            <div className="bk-card-face bk-card-back">
                              <div className="bk-card-back-pattern">
                                <span className="bk-card-logo">★</span>
                              </div>
                            </div>
                            <div className={`bk-card-face bk-card-front ${c.isRed ? 'is-red' : 'is-black'}`}>
                              <div className="bk-card-corner top">
                                <span>{c.rank}</span>
                                <span>{c.suit}</span>
                              </div>
                              <div className="bk-card-center-suit">{c.suit}</div>
                              <div className="bk-card-corner bottom">
                                <span>{c.rank}</span>
                                <span>{c.suit}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Players Area */}
                <div className="bk-players-area">
                  {/* Player 1 */}
                  <div className={`bk-player-spot ${turn === 'p1' ? 'is-active' : ''}`}>
                    <div className="bk-area-header">
                      <span className="bk-area-name">{p1?.name || t('blackjack.player1')}</span>
                      <span className={`bk-badge-score ${p1Score > 21 ? 'bk-badge-bust' : ''}`}>
                        {p1Score} {p1Score > 21 ? t('blackjack.bust') : ''}
                      </span>
                    </div>
                    <div className="bk-hand">
                      {p1Hand.map(c => (
                        <div key={c.id} className="bk-card-wrap is-flipped">
                          <div className="bk-card-3d">
                            <div className={`bk-card-face bk-card-front ${c.isRed ? 'is-red' : 'is-black'}`}>
                              <div className="bk-card-corner top">
                                <span>{c.rank}</span>
                                <span>{c.suit}</span>
                              </div>
                              <div className="bk-card-center-suit">{c.suit}</div>
                              <div className="bk-card-corner bottom">
                                <span>{c.rank}</span>
                                <span>{c.suit}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {turn === 'p1' && (
                      <div className="bk-controls">
                        <button
                          type="button"
                          className="rc-cut gm-btn gm-btn-primary"
                          disabled={p1Score >= 21}
                          onClick={() => requestHit('p1')}
                        >
                          {t('blackjack.hit')}
                        </button>
                        <button type="button" className="rc-cut gm-btn" onClick={() => handleStand('p1')}>
                          {t('blackjack.stand')}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Player 2 */}
                  <div className={`bk-player-spot ${turn === 'p2' ? 'is-active' : ''}`}>
                    <div className="bk-area-header">
                      <span className="bk-area-name">{p2?.name || t('blackjack.player2')}</span>
                      <span className={`bk-badge-score ${p2Score > 21 ? 'bk-badge-bust' : ''}`}>
                        {p2Score} {p2Score > 21 ? t('blackjack.bust') : ''}
                      </span>
                    </div>
                    <div className="bk-hand">
                      {p2Hand.map(c => (
                        <div key={c.id} className="bk-card-wrap is-flipped">
                          <div className="bk-card-3d">
                            <div className={`bk-card-face bk-card-front ${c.isRed ? 'is-red' : 'is-black'}`}>
                              <div className="bk-card-corner top">
                                <span>{c.rank}</span>
                                <span>{c.suit}</span>
                              </div>
                              <div className="bk-card-center-suit">{c.suit}</div>
                              <div className="bk-card-corner bottom">
                                <span>{c.rank}</span>
                                <span>{c.suit}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {turn === 'p2' && (
                      <div className="bk-controls">
                        <button
                          type="button"
                          className="rc-cut gm-btn gm-btn-primary"
                          disabled={p2Score >= 21}
                          onClick={() => requestHit('p2')}
                        >
                          {t('blackjack.hit')}
                        </button>
                        <button type="button" className="rc-cut gm-btn" onClick={() => handleStand('p2')}>
                          {t('blackjack.stand')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {turn === 'over' && (
                  <div className="bk-controls" style={{ marginTop: 12 }}>
                    <button type="button" className="rc-cut gm-btn gm-btn-primary" onClick={startBlackjackRound}>
                      {t('blackjack.playAgain')}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Interactive Question Validation Banner with SOFT RULE */}
            {activeQuestion && (
              <div className="rc-cut bk-question-modal">
                <div className="bk-question-kicker">
                  {t('blackjack.questionFor', { name: activeQuestion.forPlayer })}
                </div>
                <div className="bk-question-text">{activeQuestion.text}</div>
                <div className="bk-question-hint">{t('blackjack.softRule')}</div>
                <div className="bk-question-buttons">
                  <button
                    type="button"
                    className="rc-cut gm-btn bk-btn-correct"
                    onClick={() => handleAnswer(true)}
                  >
                    {t('blackjack.correct')}
                  </button>
                  <button
                    type="button"
                    className="rc-cut gm-btn bk-btn-wrong"
                    onClick={() => handleAnswer(false)}
                  >
                    {t('blackjack.wrong')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {blocker && (
            <Notice
              text={blocker}
              action={
                config.mode === 'eliminate' && pool.available.length < minRequiredStudents ? (
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
          kicker={result.kicker}
          text={result.text}
          burstKey={result.burst}
          chips={result.chips.map(label => ({ label }))}
          actions={
            <>
              <button
                type="button"
                className="rc-cut gm-btn gm-btn-primary"
                onClick={() => {
                  setResult(null);
                  if (config.gameMode === 'draw') startDrawRound();
                  else startBlackjackRound();
                }}
              >
                {t('game.continue')}
              </button>
              <button type="button" className="rc-cut gm-btn" onClick={() => setResult(null)}>
                {t('game.map')}
              </button>
            </>
          }
        />
      )}
    </GameShell>
  );
}

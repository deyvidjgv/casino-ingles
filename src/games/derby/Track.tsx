// The hippodrome: a Greek chariot track rendered as one SVG scene, with the horses laid over
// it as images. The set pieces are drawn here rather than imported so they can be lit,
// animated and recoloured; the gate and the arch are the two the painted art will replace.
import { memo } from 'react';
import { BOARD, HORSE, HORSE_COLORS, RUN, SPINA, STANDS, STONE, laneMetrics, type HorseColor } from './scene';

export interface Rider {
  studentId: string;
  name: string;
  color: HorseColor;
}

interface TrackProps {
  riders: Rider[];
  /** 0 at the gate, 1 at the finish line */
  progress: number[];
  /** gallop frame per rider: the two art frames are a full stride cycle */
  frame: number[];
  /** riders currently carrying an answer boost, drawn with a speed trail */
  boosting: boolean[];
  /** how many spectators backed each horse, shown as figures in the stands */
  bets: Partial<Record<HorseColor, number>>;
  /** the race is paused for a question: horses rear in place instead of running */
  frozen: boolean;
  winner: number | null;
}

/** Outer edges of the racing surface, wider than the run so the art frames the lanes. */
const APRON = { x0: 96, x1: 980 };

function Defs() {
  return (
    <defs>
      {/*
        The Greek key. A continuous bottom rail plus one hook per tile — the unbroken rail is
        what makes it read as a meander instead of a row of disconnected brackets.
      */}
      <pattern id="dv-meander" width="24" height="16" patternUnits="userSpaceOnUse">
        <path d="M0,13 H16 V3 H4 V9 H10 M16,13 H24" fill="none" stroke={STONE.gold}
          strokeWidth="2.4" strokeLinecap="square" />
      </pattern>

      <linearGradient id="dv-marble" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#F6F2E7" />
        <stop offset="0.55" stopColor={STONE.marble} />
        <stop offset="1" stopColor={STONE.marbleShade} />
      </linearGradient>

      <linearGradient id="dv-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFE9A8" />
        <stop offset="0.5" stopColor={STONE.gold} />
        <stop offset="1" stopColor={STONE.goldDeep} />
      </linearGradient>

      <linearGradient id="dv-turf" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#0E6B41" />
        <stop offset="1" stopColor={STONE.turfDeep} />
      </linearGradient>

      <radialGradient id="dv-flame">
        <stop offset="0" stopColor="#E4FFF1" />
        <stop offset="0.4" stopColor="#22DD77" />
        <stop offset="1" stopColor="#22DD77" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

function Meander({ x, y, width, height = 16 }: { x: number; y: number; width: number; height?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="#150F2C" opacity="0.7" />
      <rect x={x} y={y} width={width} height={height} fill="url(#dv-meander)" />
    </g>
  );
}

/** Tiered marble seating. Kept empty by the art so the backers can be drawn on the benches. */
const Stands = memo(function Stands({ bets }: { bets: Partial<Record<HorseColor, number>> }) {
  const rows = 4;
  const rowH = STANDS.height / rows;
  const perRow = 22;

  // Backers fill from the back row forward, grouped by horse, so a popular pick visibly owns
  // a block of seats instead of being scattered across the stand.
  const seats: { x: number; y: number; color: HorseColor }[] = [];
  let slot = 0;
  for (const color of HORSE_COLORS) {
    for (let i = 0; i < (bets[color] ?? 0); i++) {
      const row = Math.floor(slot / perRow);
      if (row >= rows) break;
      const col = slot % perRow;
      const inset = (rows - 1 - row) * 14;
      seats.push({
        x: APRON.x0 + inset + 26 + col * ((APRON.x1 - APRON.x0 - inset * 2 - 52) / (perRow - 1)),
        y: STANDS.top + row * rowH + rowH * 0.5,
        color,
      });
      slot++;
    }
  }

  return (
    <g>
      {/* the stand sits in its own shadow, which is what gives the tiers depth */}
      <rect x={APRON.x0 - 4} y={STANDS.top - 6} width={APRON.x1 - APRON.x0 + 8} height={STANDS.height + 12}
        rx="6" fill="#0A0820" opacity="0.75" />
      {Array.from({ length: rows }, (_, r) => {
        const y = STANDS.top + r * rowH;
        const inset = (rows - 1 - r) * 14;
        const x = APRON.x0 + inset;
        const w = APRON.x1 - APRON.x0 - inset * 2;
        return (
          <g key={r}>
            {/* riser, in shadow */}
            <rect x={x} y={y} width={w} height={rowH} fill={STONE.marbleDeep} opacity={0.3 + r * 0.1} />
            {/* bench top, catching the light */}
            <rect x={x} y={y + rowH - 9} width={w} height="9" fill="url(#dv-marble)" opacity={0.55 + r * 0.15} />
            <rect x={x} y={y + rowH - 9} width={w} height="2" fill="#FFFDF4" opacity={0.3 + r * 0.12} />
          </g>
        );
      })}
      {/* stairways cutting down through the tiers */}
      {[0.22, 0.5, 0.78].map(f => (
        <rect key={f} x={APRON.x0 + (APRON.x1 - APRON.x0) * f - 7} y={STANDS.top} width="14" height={STANDS.height}
          fill={STONE.marbleShade} opacity="0.5" />
      ))}
      {seats.map((s, i) => (
        <g key={i}>
          <circle cx={s.x} cy={s.y - 5} r="3.6" fill={HORSE[s.color].glow} />
          <path d={`M${s.x - 4.5},${s.y + 7} q4.5,-8 9,0 z`} fill={HORSE[s.color].glow} opacity="0.9" />
        </g>
      ))}
      <Meander x={APRON.x0} y={STANDS.top + STANDS.height} width={APRON.x1 - APRON.x0} />
    </g>
  );
});

/** Gold brazier with a cosmic flame. The flame animates in CSS so it costs no JS frames. */
function Brazier({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse className="dv-flame" cx="0" cy="-22" rx="13" ry="22" fill="url(#dv-flame)" />
      <path d="M-14,0 L14,0 L10,-11 L-10,-11 Z" fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.4" />
      <rect x="-3" y="0" width="6" height="18" fill="url(#dv-gold)" />
      <path d="M-10,18 L10,18 L13,25 L-13,25 Z" fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.4" />
    </g>
  );
}

/** Fluted Doric column, drawn from its capital down. */
function Column({ x, top, height, width = 26 }: { x: number; top: number; height: number; width?: number }) {
  const half = width / 2;
  return (
    <g transform={`translate(${x} ${top})`}>
      {/* capital */}
      <rect x={-half - 6} y="0" width={width + 12} height="11" rx="1.5"
        fill="url(#dv-marble)" stroke={STONE.marbleDeep} strokeWidth="1.1" />
      {/* shaft */}
      <rect x={-half} y="11" width={width} height={height - 24} fill="url(#dv-marble)" />
      {[-0.62, -0.21, 0.21, 0.62].map(f => (
        <line key={f} x1={f * half * 1.6} y1="15" x2={f * half * 1.6} y2={height - 17}
          stroke={STONE.marbleDeep} strokeWidth="1.3" opacity="0.55" />
      ))}
      {/* base */}
      <rect x={-half - 6} y={height - 13} width={width + 12} height="13" rx="1.5"
        fill="url(#dv-marble)" stroke={STONE.marbleDeep} strokeWidth="1.1" />
    </g>
  );
}

/** A laurel wreath: two sweeping branches meeting at a gold tie. */
function Wreath({ x, y, r }: { x: number; y: number; r: number }) {
  const leaves = Array.from({ length: 22 }, (_, i) => {
    // leave a gap at the top where the two branches are tied
    const a = -Math.PI / 2 + 0.55 + (i / 21) * (Math.PI * 2 - 1.1);
    return (
      <ellipse key={i} cx={x + Math.cos(a) * r} cy={y + Math.sin(a) * r} rx={r * 0.17} ry={r * 0.075}
        fill="url(#dv-gold)" transform={`rotate(${(a * 180) / Math.PI + 90} ${x + Math.cos(a) * r} ${y + Math.sin(a) * r})`} />
    );
  });
  return (
    <g className="dv-wreath">
      <circle cx={x} cy={y} r={r} fill="none" stroke={STONE.goldDeep} strokeWidth="2" opacity="0.55" />
      {leaves}
    </g>
  );
}

/** Starting gate: the carceres of a hippodrome, seen from the side. */
const StartGate = memo(function StartGate({ count }: { count: number }) {
  const { top, height } = laneMetrics(count);
  const h = height * count;
  const x0 = 112;
  const x1 = RUN.x0;
  return (
    <g>
      <rect x={x0 - 14} y={top} width={x1 - x0 + 14} height={h} fill="#0A0718" opacity="0.55" />
      {/* architrave across the top of both posts */}
      <rect x={x0 - 26} y={top - 40} width={x1 - x0 + 46} height="20" rx="2"
        fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.5" />
      <Meander x={x0 - 22} y={top - 38} width={x1 - x0 + 38} height={16} />
      <Wreath x={(x0 + x1) / 2} y={top - 30} r={12} />
      {/* the closed gates, one bay per lane */}
      {Array.from({ length: count }, (_, i) => (
        <g key={i}>
          {[0.28, 0.5, 0.72].map(f => (
            <rect key={f} x={x0 + 4} y={top + height * (i + f) - 3} width={x1 - x0 - 8} height="5" rx="2.5"
              fill="url(#dv-marble)" opacity="0.9" />
          ))}
          {i > 0 && (
            <rect x={x0 - 10} y={top + height * i - 2} width={x1 - x0 + 10} height="4"
              fill={STONE.goldDeep} opacity="0.8" />
          )}
        </g>
      ))}
      <Column x={x0} top={top - 20} height={h + 30} width={24} />
      <Column x={x1} top={top - 20} height={h + 30} width={24} />
    </g>
  );
});

/** Victory arch over the finish line, with the island's trophy on top. */
const FinishArch = memo(function FinishArch({ count, lit }: { count: number; lit: boolean }) {
  const { top, height } = laneMetrics(count);
  const h = height * count;
  const xa = RUN.x1 + 28;
  const xb = RUN.x1 + 86;
  const mid = (xa + xb) / 2;
  const springer = top - 22;
  return (
    <g className={lit ? 'dv-arch is-lit' : 'dv-arch'}>
      {/* chequered finish line */}
      {Array.from({ length: Math.ceil(h / 13) }, (_, i) => (
        <rect key={i} x={RUN.x1 - 7} y={top + i * 13} width="14" height="13"
          fill={i % 2 ? '#12102A' : '#F4F1E6'} />
      ))}
      <Column x={xa} top={springer} height={h + 32} width={24} />
      <Column x={xb} top={springer} height={h + 32} width={24} />
      {/* semicircular arch springing from the two capitals */}
      <path d={`M${xa - 13},${springer} A ${(xb - xa) / 2 + 13},${(xb - xa) / 2 + 13} 0 0 1 ${xb + 13},${springer}`}
        fill="none" stroke="url(#dv-marble)" strokeWidth="15" />
      <path d={`M${xa - 13},${springer} A ${(xb - xa) / 2 + 13},${(xb - xa) / 2 + 13} 0 0 1 ${xb + 13},${springer}`}
        fill="none" stroke={STONE.gold} strokeWidth="2" opacity="0.7" />
      <Wreath x={mid} y={top + 34} r={20} />
      {/* trophy crowning the arch */}
      <g transform={`translate(${mid} ${springer - 58})`}>
        <path d="M-14,-24 L14,-24 L10,-4 L-10,-4 Z" fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.5" />
        <path d="M-14,-21 q-10,4 0,11 M14,-21 q10,4 0,11" fill="none" stroke={STONE.goldDeep} strokeWidth="2.6" />
        <rect x="-3.5" y="-4" width="7" height="9" fill="url(#dv-gold)" />
        <rect x="-11" y="5" width="22" height="6" rx="1.5" fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.2" />
      </g>
    </g>
  );
});

/** Central barrier of a hippodrome: a marble ledge lined with gold amphorae. */
const Spina = memo(function Spina() {
  const y = SPINA.top;
  return (
    <g>
      <rect x={APRON.x0} y={y} width={APRON.x1 - APRON.x0} height={SPINA.height} fill="url(#dv-marble)" />
      <rect x={APRON.x0} y={y + SPINA.height - 4} width={APRON.x1 - APRON.x0} height="4" fill={STONE.marbleDeep} opacity="0.6" />
      {[0, 1, 2, 3, 4, 5].map(i => {
        const x = APRON.x0 + 96 + i * ((APRON.x1 - APRON.x0 - 192) / 5);
        return (
          <g key={i} transform={`translate(${x} ${y + SPINA.height - 4})`}>
            <path d="M0,-13 q-10,7 -10,16 q0,10 10,10 q10,0 10,-10 q0,-9 -10,-16 z"
              fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.3" transform="translate(0 -14)" />
            <rect x="-3.5" y="-34" width="7" height="7" fill="url(#dv-gold)" stroke={STONE.goldDeep} strokeWidth="1.1" />
            <path d="M-3.5,-31 q-8,4 -6,11 M3.5,-31 q8,4 6,11" fill="none" stroke={STONE.goldDeep} strokeWidth="1.8" />
          </g>
        );
      })}
    </g>
  );
});

const Lanes = memo(function Lanes({ count, riders }: { count: number; riders: Rider[] }) {
  const { top, height } = laneMetrics(count);
  const h = height * count;
  return (
    <g>
      <rect x={APRON.x0} y={top - 12} width={APRON.x1 - APRON.x0} height={h + 24} rx="10" fill="url(#dv-turf)" />
      {Array.from({ length: count }, (_, i) => (
        <g key={i}>
          <rect x={APRON.x0 + 8} y={top + i * height} width={APRON.x1 - APRON.x0 - 16} height={height}
            fill={i % 2 ? STONE.laneAlt : STONE.lane} />
          {/* a wash of the rider's colour, so lane and horse are never ambiguous */}
          {riders[i] && (
            <rect x={APRON.x0 + 8} y={top + i * height} width={APRON.x1 - APRON.x0 - 16} height={height}
              fill={HORSE[riders[i].color].glow} opacity="0.1" />
          )}
          {i > 0 && (
            <line x1={APRON.x0 + 8} y1={top + i * height} x2={APRON.x1 - 8} y2={top + i * height}
              stroke={STONE.gold} strokeWidth="1.6" strokeDasharray="15 11" opacity="0.45" />
          )}
        </g>
      ))}
      {/* quarter markers down the straight */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={RUN.x0 + (RUN.x1 - RUN.x0) * f} y1={top} x2={RUN.x0 + (RUN.x1 - RUN.x0) * f} y2={top + h}
          stroke={STONE.marble} strokeWidth="1.2" opacity="0.13" />
      ))}
      <rect x={APRON.x0 + 8} y={top} width={APRON.x1 - APRON.x0 - 16} height={h}
        fill="none" stroke={STONE.gold} strokeWidth="2" opacity="0.65" />
    </g>
  );
});

const Scene = memo(function Scene({ riders, bets, lit }: {
  riders: Rider[]; bets: Partial<Record<HorseColor, number>>; lit: boolean;
}) {
  const count = riders.length;
  const { top } = laneMetrics(count);
  return (
    <svg className="dv-scene" viewBox={`0 0 ${BOARD.w} ${BOARD.h}`} aria-hidden="true">
      <Defs />
      <Stands bets={bets} />
      <Lanes count={count} riders={riders} />
      <Spina />
      <StartGate count={count} />
      <FinishArch count={count} lit={lit} />
      <Brazier x={APRON.x0 + 30} y={top - 20} />
      <Brazier x={APRON.x1 - 30} y={top - 20} />
    </svg>
  );
});

/**
 * The set above is memoised on its own: the race updates progress every frame, and repainting
 * these columns and benches sixty times a second is exactly the cost the other games were
 * trimmed for.
 */
export function Track({ riders, progress, frame, boosting, bets, frozen, winner }: TrackProps) {
  const count = riders.length;
  const { top, height } = laneMetrics(count);
  const horseH = height * 0.92;

  return (
    <div className="dv-track">
      <Scene riders={riders} bets={bets} lit={winner !== null} />

      {riders.map((rider, i) => {
        const p = Math.min(1, Math.max(0, progress[i] ?? 0));
        const art = HORSE[rider.color];
        return (
          <div
            key={rider.studentId}
            className={`dv-horse${boosting[i] ? ' is-boosting' : ''}${frozen ? ' is-frozen' : ''}${winner === i ? ' is-winner' : ''}`}
            style={{
              left: RUN.x0 + (RUN.x1 - RUN.x0) * p,
              top: top + height * i + height / 2,
              width: horseH * art.ratio,
              height: horseH,
              // @ts-expect-error custom property
              '--glow': art.glow,
            }}
          >
            <span className="dv-horse-glow" />
            <img src={`/horses/${rider.color}-${frame[i] ? 'b' : 'a'}.webp`} alt="" draggable={false} />
            <span className="dv-plate" style={{ background: art.glow, color: art.ink }}>{rider.name}</span>
          </div>
        );
      })}
    </div>
  );
}

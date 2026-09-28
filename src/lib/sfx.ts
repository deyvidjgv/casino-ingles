// Tiny synthesized sound effects (Web Audio): no audio files to license or download.
// Every call is a no-op while muted or before the browser allows audio.

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean) {
  muted = value;
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator(), g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.12, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain: number, freq: number) {
  const a = audio();
  if (!a) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur)), b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = b;
  f.type = 'bandpass';
  f.frequency.value = freq;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  click: () => tone(660, 0.06, { type: 'triangle', gain: 0.06 }),
  tick: () => tone(1200, 0.03, { type: 'square', gain: 0.025 }),
  reelStop: () => { tone(180, 0.14, { type: 'triangle', gain: 0.14 }); noise(0.06, 0.08, 900); },
  lever: () => { tone(300, 0.18, { type: 'sawtooth', gain: 0.05, slideTo: 120 }); noise(0.1, 0.05, 500); },
  ballClack: () => { tone(900, 0.05, { type: 'square', gain: 0.05 }); noise(0.05, 0.1, 2400); },
  whoosh: () => noise(0.5, 0.12, 700),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.1, delay: i * 0.11 })),
  saved: () => [880, 1175, 1568].forEach((f, i) => tone(f, 0.5, { gain: 0.07, delay: i * 0.14 })),
  empty: () => tone(220, 0.3, { type: 'triangle', gain: 0.08, slideTo: 140 }),
  cardFlip: () => { tone(500, 0.08, { type: 'sine', gain: 0.08, slideTo: 240 }); noise(0.04, 0.05, 1200); },
  diceRoll: () => { tone(320, 0.06, { type: 'square', gain: 0.04 }); noise(0.08, 0.09, 1600); },
  correct: () => { tone(523, 0.12, { type: 'triangle', gain: 0.1 }); tone(659, 0.16, { type: 'triangle', gain: 0.12, delay: 0.08 }); },
  wrong: () => tone(240, 0.25, { type: 'sawtooth', gain: 0.09, slideTo: 140 }),
};

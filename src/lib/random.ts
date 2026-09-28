// Fair randomness for game draws (crypto, never Math.random). Results are decided with these
// helpers BEFORE any animation starts; the animation is then built to land on them.

const buf = new Uint32Array(1);

/** Uniform integer in [0, n) — rejection sampling avoids modulo bias. */
export function randomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`randomInt: n must be a positive integer, got ${n}`);
  const limit = Math.floor(0x100000000 / n) * n;
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

export function pickOne<T>(list: readonly T[]): T {
  return list[randomInt(list.length)];
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** k distinct items (k ≤ list.length). */
export function pickDistinct<T>(list: readonly T[], k: number): T[] {
  return shuffled(list).slice(0, k);
}

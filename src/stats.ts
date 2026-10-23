export interface Interval {
  low: number;
  high: number;
}

const Z95 = 1.959963984540054;

/** Wilson score interval for a binomial proportion. */
export function wilson(successes: number, n: number, z = Z95): Interval {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export interface ProportionDiff {
  diff: number;
  interval: Interval;
  /** True when the 95% interval excludes zero. */
  significant: boolean;
}

/** Difference p1 - p2 with Newcombe's hybrid score interval (method 10), built from two Wilson intervals. */
export function diffProportions(s1: number, n1: number, s2: number, n2: number, z = Z95): ProportionDiff {
  const p1 = n1 ? s1 / n1 : 0;
  const p2 = n2 ? s2 / n2 : 0;
  const a = wilson(s1, n1, z);
  const b = wilson(s2, n2, z);
  const d = p1 - p2;
  const low = d - Math.sqrt((p1 - a.low) ** 2 + (b.high - p2) ** 2);
  const high = d + Math.sqrt((a.high - p1) ** 2 + (p2 - b.low) ** 2);
  const interval = { low: Math.max(-1, low), high: Math.min(1, high) };
  return { diff: d, interval, significant: interval.low > 0 || interval.high < 0 };
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

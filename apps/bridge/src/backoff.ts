/**
 * Exponential backoff with decorrelated jitter, attempt 1 = ~min, capped at max.
 * `rng` is injectable so tests are deterministic.
 */
export function backoffDelay(
  attempt: number,
  minMs: number,
  maxMs: number,
  rng: () => number = Math.random
): number {
  const safeAttempt = Math.max(1, attempt);
  const ceiling = Math.min(maxMs, minMs * 2 ** (safeAttempt - 1));
  const floor = Math.min(ceiling, minMs);
  return Math.round(floor + rng() * (ceiling - floor));
}

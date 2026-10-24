/**
 * §5.8 People — split a lease's tenant count across covered beds by cumulative
 * rounding: bed k of n gets round(N·k/n) − round(N·(k−1)/n). Generalised to
 * weighted leaves (a leaf with 3 beds and no bedroom records counts as 3 beds).
 */
function roundHalfUp(x) { return Math.floor(x + 0.5); }

export function splitPeople(total, weights) {
  const n = weights.length;
  const N = Math.max(0, Number(total) || 0);
  if (n === 0) return [];
  const sumW = weights.reduce((s, w) => s + (Number(w) || 0), 0);
  const out = new Array(n).fill(0);
  if (sumW <= 0) { out[0] = N; return out; } // nothing to weight by: all on the first leaf
  let cum = 0, prev = 0;
  for (let k = 0; k < n; k++) {
    cum += Number(weights[k]) || 0;
    const upto = roundHalfUp((N * cum) / sumW);
    out[k] = upto - prev;
    prev = upto;
  }
  return out;
}

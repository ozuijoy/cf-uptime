export const LATENCY_BUCKETS_MS = [
  25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000,
  20000, 30000, 60000,
] as const;

export type LatencyHistogram = number[];

export function avg(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (clean.length === 0) return null;
  return Math.round(clean.reduce((acc, v) => acc + v, 0) / clean.length);
}

export function percentileFromValues(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(p) || p <= 0 || p > 1) return null;

  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  // "Nearest-rank" (ceil(p*N)) with 0-based index.
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function buildLatencyHistogram(values: number[]): LatencyHistogram {
  const buckets = LATENCY_BUCKETS_MS;
  const hist = new Array(buckets.length + 1).fill(0);

  for (const raw of values) {
    if (!Number.isFinite(raw)) continue;
    const v = Math.max(0, Math.floor(raw));

    let placed = false;
    for (let i = 0; i < buckets.length; i++) {
      const upper = buckets[i];
      if (upper !== undefined && v <= upper) {
        hist[i] = (hist[i] ?? 0) + 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const last = hist.length - 1;
      hist[last] = (hist[last] ?? 0) + 1;
    }
  }

  return hist;
}

export function mergeLatencyHistograms(hists: LatencyHistogram[]): LatencyHistogram {
  const size = LATENCY_BUCKETS_MS.length + 1;
  const merged = new Array(size).fill(0);

  for (const h of hists) {
    for (let i = 0; i < size; i++) {
      merged[i] += h[i] ?? 0;
    }
  }

  return merged;
}

export function percentileFromHistogram(hist: LatencyHistogram, p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p > 1) return null;

  const total = hist.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
  if (total <= 0) return null;

  const target = Math.ceil(p * total);
  let acc = 0;

  const buckets = LATENCY_BUCKETS_MS;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i] ?? 0;
    if (acc >= target) {
      const upper = buckets[i];
      // Overflow bucket uses the last configured bound.
      return upper ?? buckets[buckets.length - 1] ?? null;
    }
  }

  return buckets[buckets.length - 1] ?? null;
}

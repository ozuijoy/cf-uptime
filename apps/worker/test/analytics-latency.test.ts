import { describe, expect, it } from 'vitest';

import {
  LATENCY_BUCKETS_MS,
  avg,
  buildLatencyHistogram,
  mergeLatencyHistograms,
  percentileFromHistogram,
  percentileFromValues,
} from '../src/analytics/latency';
import { buildLatencySeries } from './helpers/data-builders';

describe('analytics/latency', () => {
  it('computes average from finite non-negative values only', () => {
    expect(avg([10, 20, Number.NaN, -5, Number.POSITIVE_INFINITY])).toBe(15);
    expect(avg([-1, Number.NaN])).toBeNull();
  });

  it('calculates nearest-rank percentiles', () => {
    const values = buildLatencySeries({ points: 5, base: 100, step: 20 });
    expect(percentileFromValues(values, 0.5)).toBe(140);
    expect(percentileFromValues(values, 0.95)).toBe(180);
    expect(percentileFromValues([], 0.95)).toBeNull();
    expect(percentileFromValues([Number.NaN], 0.95)).toBeNull();
    expect(percentileFromValues(values, 0)).toBeNull();
    expect(percentileFromValues(values, 1.1)).toBeNull();
  });

  it('builds and merges latency histograms', () => {
    const a = buildLatencyHistogram([10, 25, 26, 75, 60001, -5]);
    const b = buildLatencyHistogram([50, 50, 1000, 15000, 60000]);
    const merged = mergeLatencyHistograms([a, b]);

    expect(a).toHaveLength(LATENCY_BUCKETS_MS.length + 1);
    expect(merged).toHaveLength(LATENCY_BUCKETS_MS.length + 1);
    expect(merged.reduce((sum, v) => sum + v, 0)).toBe(11);
  });

  it('derives percentile approximations from histogram buckets', () => {
    const hist = buildLatencyHistogram([20, 21, 25, 26, 400, 450, 460, 8_000, 70_000]);

    expect(percentileFromHistogram(hist, 0.5)).toBe(400);
    expect(percentileFromHistogram(hist, 0.95)).toBe(60000);
    expect(percentileFromHistogram(hist, 0)).toBeNull();
    expect(percentileFromHistogram([], 0.9)).toBeNull();

    // Defensive path: NaN buckets do not contribute to total and can force fallback.
    expect(percentileFromHistogram([Number.NaN, 1], 0.5)).toBe(60000);
  });
});

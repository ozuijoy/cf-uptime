const MIN_SAMPLE_SIZE_FOR_FILTER = 6;
const IQR_MULTIPLIER = 1.5;
const MEDIAN_SPIKE_MULTIPLIER = 2.5;
const MEDIAN_SPIKE_PADDING_MS = 200;
const AXIS_HEADROOM_RATIO = 0.12;

function percentileFromSorted(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p <= 0) return values[0] ?? null;
  if (p >= 1) return values[values.length - 1] ?? null;

  const rank = (values.length - 1) * p;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);

  const lower = values[lowerIndex];
  const upper = values[upperIndex];
  if (typeof lower !== 'number' || typeof upper !== 'number') return null;

  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (rank - lowerIndex);
}

function roundUpByMagnitude(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const exponent = Math.floor(Math.log10(value));
  const stepExponent = Math.max(0, exponent - 1);
  const step = 10 ** stepExponent;
  return Math.ceil(value / step) * step;
}

export function suggestLatencyAxisCeiling(latencies: number[]): number | null {
  const values = latencies
    .filter((value): value is number => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  if (values.length < MIN_SAMPLE_SIZE_FOR_FILTER) return null;

  const median = percentileFromSorted(values, 0.5);
  const q1 = percentileFromSorted(values, 0.25);
  const q3 = percentileFromSorted(values, 0.75);
  if (median === null || q1 === null || q3 === null) return null;

  const iqr = q3 - q1;
  const upperFenceByIqr = iqr > 0 ? q3 + iqr * IQR_MULTIPLIER : Number.NEGATIVE_INFINITY;
  const upperFenceByMedian = Math.max(
    median * MEDIAN_SPIKE_MULTIPLIER,
    median + MEDIAN_SPIKE_PADDING_MS,
  );
  const outlierFence = Math.max(upperFenceByIqr, upperFenceByMedian);
  const max = values[values.length - 1];
  if (typeof max !== 'number' || max <= outlierFence) return null;

  const inlierMax = values.filter((value) => value <= outlierFence).at(-1);
  if (typeof inlierMax !== 'number') return null;

  const paddedCeiling = inlierMax * (1 + AXIS_HEADROOM_RATIO);
  const ceiling = roundUpByMagnitude(paddedCeiling);

  if (ceiling <= 0 || ceiling >= max * 0.98) return null;
  return ceiling;
}

export function clampLatencyToCeiling(value: number, ceiling: number | null): number {
  if (ceiling === null) return value;
  return Math.min(value, ceiling);
}

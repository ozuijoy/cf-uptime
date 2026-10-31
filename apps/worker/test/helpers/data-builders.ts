export type CheckStatus = 'up' | 'down' | 'unknown' | 'maintenance';

export type CheckPoint = {
  checked_at: number;
  status: CheckStatus;
};

type CheckSeriesOptions = {
  rangeStart: number;
  intervalSec: number;
  points: number;
  statusAt: (index: number) => CheckStatus;
};

type LatencySeriesOptions = {
  points: number;
  base: number;
  step: number;
  spikeEvery?: number;
  spikeValue?: number;
};

export function buildCheckSeries(options: CheckSeriesOptions): CheckPoint[] {
  const { rangeStart, intervalSec, points, statusAt } = options;
  return Array.from({ length: points }, (_unused, index) => ({
    checked_at: rangeStart + index * intervalSec,
    status: statusAt(index),
  }));
}

export function buildLatencySeries(options: LatencySeriesOptions): number[] {
  const { points, base, step, spikeEvery, spikeValue = base } = options;
  return Array.from({ length: points }, (_unused, index) => {
    if (spikeEvery && spikeEvery > 0 && index > 0 && index % spikeEvery === 0) {
      return spikeValue;
    }
    return base + index * step;
  });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/scheduler/lock', () => ({
  acquireLease: vi.fn(),
}));
vi.mock('../src/settings', () => ({
  readSettings: vi.fn(),
}));

import type { Env } from '../src/env';
import { readSettings } from '../src/settings';
import { acquireLease } from '../src/scheduler/lock';
import { runRetention } from '../src/scheduler/retention';
import { createFakeD1Database, type FakeD1QueryHandler } from './helpers/fake-d1';

function createEnv(handlers: FakeD1QueryHandler[]): Env {
  return { DB: createFakeD1Database(handlers) } as unknown as Env;
}

describe('scheduler/retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-18T00:00:00.000Z'));
    vi.mocked(acquireLease).mockResolvedValue(true);
    vi.mocked(readSettings).mockResolvedValue({
      site_title: 'CF Uptime',
      site_description: '',
      site_locale: 'auto',
      site_timezone: 'UTC',
      retention_check_results_days: 7,
      state_failures_to_down_from_up: 2,
      state_successes_to_up_from_down: 2,
      admin_default_overview_range: '24h',
      admin_default_monitor_range: '24h',
      uptime_rating_level: 3,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('skips deletion when lease is not acquired', async () => {
    vi.mocked(acquireLease).mockResolvedValue(false);
    const runCalls: unknown[][] = [];
    const env = createEnv([
      {
        match: 'delete from check_results',
        run: (args) => {
          runCalls.push(args);
          return { meta: { changes: 0 } };
        },
      },
    ]);

    await runRetention(env, { scheduledTime: Date.now() } as ScheduledController);

    expect(readSettings).not.toHaveBeenCalled();
    expect(runCalls).toHaveLength(0);
  });

  it('deletes only each monitor expired time range instead of scanning the whole table', async () => {
    const scheduledTime = Date.UTC(2026, 1, 18, 0, 0, 0);
    const cutoff = Math.floor(scheduledTime / 1000) - 7 * 86_400;
    const oldest = cutoff - 2 * 86_400;

    const runCalls: unknown[][] = [];
    const deleteSql: string[] = [];
    const env = createEnv([
      {
        match: 'from monitors m where exists',
        all: () => [{ monitor_id: 11, oldest_at: oldest }],
      },
      {
        match: 'delete from check_results',
        run: (args, normalizedSql) => {
          runCalls.push(args);
          deleteSql.push(normalizedSql);
          return { meta: { changes: 1_440 } };
        },
      },
    ]);

    await runRetention(env, { scheduledTime } as ScheduledController);

    expect(acquireLease).toHaveBeenCalledWith(
      env.DB,
      'retention:check_results',
      Math.floor(scheduledTime / 1000),
      600,
    );
    expect(readSettings).toHaveBeenCalledTimes(1);

    // 逐台、逐時間區間刪除：args = [monitor_id, from, to)
    expect(runCalls).toEqual([[11, oldest, cutoff]]);

    // 迴歸保護：DELETE 不可以再帶 ORDER BY（那會讓每一批都變成全表掃描 + 排序）
    expect(deleteSql[0]).not.toContain('order by');
    expect(deleteSql[0]).toContain('monitor_id = ?1');
  });

  it('spreads a long backlog into bounded time-range deletes', async () => {
    const scheduledTime = Date.UTC(2026, 1, 18, 0, 0, 0);
    const cutoff = Math.floor(scheduledTime / 1000) - 7 * 86_400;
    const oldest = cutoff - 75 * 86_400; // 75 天的欠帳 → 30 天一個區間，共 3 批

    const runCalls: unknown[][] = [];
    const env = createEnv([
      {
        match: 'from monitors m where exists',
        all: () => [{ monitor_id: 7, oldest_at: oldest }],
      },
      {
        match: 'delete from check_results',
        run: (args) => {
          runCalls.push(args);
          return { meta: { changes: 43_200 } };
        },
      },
    ]);

    await runRetention(env, { scheduledTime } as ScheduledController);

    expect(runCalls).toHaveLength(3);
    expect(runCalls[0]).toEqual([7, oldest, oldest + 30 * 86_400]);
    expect(runCalls[2]?.[2]).toBe(cutoff);
  });

  it('guards against invalid cutoffs', async () => {
    vi.mocked(readSettings).mockResolvedValue({
      site_title: 'CF Uptime',
      site_description: '',
      site_locale: 'auto',
      site_timezone: 'UTC',
      retention_check_results_days: Number.POSITIVE_INFINITY,
      state_failures_to_down_from_up: 2,
      state_successes_to_up_from_down: 2,
      admin_default_overview_range: '24h',
      admin_default_monitor_range: '24h',
      uptime_rating_level: 3,
    });

    const runCalls: unknown[][] = [];
    const env = createEnv([
      {
        match: 'delete from check_results',
        run: (args) => {
          runCalls.push(args);
          return { meta: { changes: 0 } };
        },
      },
    ]);

    await runRetention(env, { scheduledTime: 1 } as ScheduledController);
    expect(runCalls).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';

import { patchSettings, readSettings } from '../src/settings';
import { createFakeD1Database } from './helpers/fake-d1';

describe('settings read/write helpers', () => {
  it('returns defaults when no rows exist', async () => {
    const db = createFakeD1Database([
      {
        match: 'select key, value from settings',
        all: () => [],
      },
    ]);

    await expect(readSettings(db)).resolves.toEqual({
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

  it('uses validated rows and falls back to defaults for invalid values', async () => {
    const db = createFakeD1Database([
      {
        match: 'select key, value from settings',
        all: () => [
          { key: 'site_title', value: 'Status Hub' },
          { key: 'site_description', value: '' },
          { key: 'site_locale', value: 'ja' },
          { key: 'site_timezone', value: 'Asia/Tokyo' },
          { key: 'retention_check_results_days', value: '30' },
          { key: 'state_failures_to_down_from_up', value: '4' },
          { key: 'state_successes_to_up_from_down', value: '2' },
          { key: 'admin_default_overview_range', value: '7d' },
          { key: 'admin_default_monitor_range', value: '90d' },
          { key: 'uptime_rating_level', value: '6' },
        ],
      },
    ]);

    await expect(readSettings(db)).resolves.toEqual({
      site_title: 'Status Hub',
      site_description: '',
      site_locale: 'ja',
      site_timezone: 'Asia/Tokyo',
      retention_check_results_days: 30,
      state_failures_to_down_from_up: 4,
      state_successes_to_up_from_down: 2,
      admin_default_overview_range: '7d',
      admin_default_monitor_range: '90d',
      // "6" is outside the supported range and should fall back.
      uptime_rating_level: 3,
    });
  });

  it('writes patch values as strings via batch upserts', async () => {
    const written: unknown[][] = [];
    const db = createFakeD1Database([
      {
        match: 'insert into settings',
        run: (args) => {
          written.push(args);
          return { meta: { changes: 1 } };
        },
      },
    ]);

    await patchSettings(db, {
      site_title: 'Prod Status',
      retention_check_results_days: 14,
      uptime_rating_level: 5,
    });

    expect(written).toEqual([
      ['site_title', 'Prod Status'],
      ['retention_check_results_days', '14'],
      ['uptime_rating_level', '5'],
    ]);
  });

  it('is a no-op for empty patch payloads', async () => {
    const db = createFakeD1Database([
      {
        match: 'insert into settings',
        run: () => ({ meta: { changes: 1 } }),
      },
    ]);

    await expect(patchSettings(db, {})).resolves.toBeUndefined();
  });
});

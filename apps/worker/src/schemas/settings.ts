import { z } from 'zod';

import { normalizeSiteLocale, SITE_LOCALES } from '../site-locale';

export const settingsPatchInputSchema = z
  .object({
    site_title: z.string().min(1).max(100).optional(),
    site_description: z.string().max(500).optional(),

    site_locale: z.preprocess(
      (value) => (typeof value === 'string' ? (normalizeSiteLocale(value) ?? value) : value),
      z.enum(SITE_LOCALES),
    ).optional(),

    // IANA timezone, e.g. 'UTC', 'Asia/Shanghai'.
    site_timezone: z.string().min(1).max(64).optional(),

    retention_check_results_days: z.number().int().min(1).max(365).optional(),

    state_failures_to_down_from_up: z.number().int().min(1).max(10).optional(),
    state_successes_to_up_from_down: z.number().int().min(1).max(10).optional(),

    admin_default_overview_range: z.enum(['24h', '7d']).optional(),
    admin_default_monitor_range: z.enum(['24h', '7d', '30d', '90d']).optional(),

    uptime_rating_level: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export type SettingsPatchInput = z.infer<typeof settingsPatchInputSchema>;

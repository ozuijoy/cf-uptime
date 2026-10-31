-- Phase 12/13: Settings defaults (non-sensitive config)
-- NOTE: Keep this file append-only.

-- Site branding (public status page)
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_title', 'CF Uptime');
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_description', '');

-- Data retention
-- How many days of check_results to keep (used by daily retention job).
INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_check_results_days', '7');

-- Monitoring state machine thresholds (global defaults)
INSERT OR IGNORE INTO settings (key, value) VALUES ('state_failures_to_down_from_up', '2');
INSERT OR IGNORE INTO settings (key, value) VALUES ('state_successes_to_up_from_down', '2');

-- Admin UI defaults
INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_default_overview_range', '24h');
INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_default_monitor_range', '24h');

-- Timezone used when rendering timestamps in the UI (IANA name).
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_timezone', 'UTC');

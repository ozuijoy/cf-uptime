-- Phase 10: Daily rollups for analytics (v0.3)
-- NOTE: Keep this file append-only. Future schema changes must be new migrations.

CREATE TABLE IF NOT EXISTS monitor_daily_rollups (
  monitor_id INTEGER NOT NULL,
  day_start_at INTEGER NOT NULL, -- UTC day start unix seconds

  total_sec INTEGER NOT NULL,
  downtime_sec INTEGER NOT NULL,
  unknown_sec INTEGER NOT NULL,
  uptime_sec INTEGER NOT NULL,

  checks_total INTEGER NOT NULL,
  checks_up INTEGER NOT NULL,
  checks_down INTEGER NOT NULL,
  checks_unknown INTEGER NOT NULL,
  checks_maintenance INTEGER NOT NULL,

  avg_latency_ms INTEGER,
  p50_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  latency_histogram_json TEXT, -- JSON array aligned with server bucket config

  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),

  PRIMARY KEY (monitor_id, day_start_at)
);

CREATE INDEX IF NOT EXISTS idx_monitor_daily_rollups_day
  ON monitor_daily_rollups(day_start_at);

CREATE INDEX IF NOT EXISTS idx_monitor_daily_rollups_monitor_day
  ON monitor_daily_rollups(monitor_id, day_start_at);


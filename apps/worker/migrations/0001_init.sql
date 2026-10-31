-- Phase 1: Initial D1 schema for CF Uptime (v0.1)
-- NOTE: Keep this file append-only. Future schema changes must be new migrations.

-- Monitors: configuration
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  target TEXT NOT NULL, -- http(s)://... or host:port

  interval_sec INTEGER NOT NULL DEFAULT 60 CHECK (interval_sec >= 60),
  timeout_ms   INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms >= 1000),

  -- HTTP-only config (JSON stored as TEXT; validated in app layer)
  http_method TEXT,
  http_headers_json TEXT,
  http_body TEXT,
  expected_status_json TEXT, -- e.g. [200,204,301]
  response_keyword TEXT,
  response_forbidden_keyword TEXT,

  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- Monitor current state (fast reads; updated by scheduler)
CREATE TABLE IF NOT EXISTS monitor_state (
  monitor_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('up', 'down', 'maintenance', 'paused', 'unknown')),
  last_checked_at INTEGER,
  last_changed_at INTEGER,
  last_latency_ms INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0
);

-- Short-term check results (for heartbeat bar/latency charts)
CREATE TABLE IF NOT EXISTS check_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  checked_at INTEGER NOT NULL, -- unix seconds
  status TEXT NOT NULL CHECK (status IN ('up', 'down', 'maintenance', 'unknown')),
  latency_ms INTEGER,
  http_status INTEGER,
  error TEXT,
  location TEXT, -- optional: colo/region
  attempt INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time
  ON check_results(monitor_id, checked_at);

-- Outage intervals (long-term; used for SLA / history)
CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER, -- NULL means ongoing
  initial_error TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outages_monitor_start
  ON outages(monitor_id, started_at);

-- Incidents (manual or optionally generated from outages)
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  impact TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('none', 'minor', 'major', 'critical')),
  message TEXT,
  started_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  status TEXT CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident_time
  ON incident_updates(incident_id, created_at);

-- Maintenance windows (suppress alerts during maintenance; optionally shown on status page)
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- Notification channels (v0.x: webhook only)
CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('webhook')),
  config_json TEXT NOT NULL, -- { url, method, headers, timeout_ms, payload_type, signing, ... }
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- Notification delivery log (dedupe/audit)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL, -- e.g. monitor:12:down:1700000000
  channel_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  http_status INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_event_channel
  ON notification_deliveries(event_key, channel_id);

-- Lightweight settings (store non-sensitive config only; secrets stay in Workers Secrets)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Lease locks (prevent overlapping scheduled runs)
CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);


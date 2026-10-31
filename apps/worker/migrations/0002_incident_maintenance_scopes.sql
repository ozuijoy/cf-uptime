-- Phase 8/9: Scope incidents and maintenance windows to one-or-more monitors (many-to-many)
-- NOTE: Keep this file append-only. Future schema changes must be new migrations.

CREATE TABLE IF NOT EXISTS incident_monitors (
  incident_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (incident_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_monitors_monitor
  ON incident_monitors(monitor_id);
CREATE INDEX IF NOT EXISTS idx_incident_monitors_incident
  ON incident_monitors(incident_id);

CREATE TABLE IF NOT EXISTS maintenance_window_monitors (
  maintenance_window_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  PRIMARY KEY (maintenance_window_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_window_monitors_monitor
  ON maintenance_window_monitors(monitor_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_window_monitors_window
  ON maintenance_window_monitors(maintenance_window_id);


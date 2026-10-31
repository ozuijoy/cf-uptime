-- Phase 6+: Public API snapshots (status page fast path)
-- NOTE: Keep this file append-only. Future schema changes must be new migrations.

CREATE TABLE IF NOT EXISTS public_snapshots (
  key TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

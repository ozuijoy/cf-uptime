-- Phase 11/14: monitor grouping and custom ordering
-- NOTE: Keep this file append-only.

ALTER TABLE monitors ADD COLUMN group_name TEXT;
ALTER TABLE monitors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_monitors_group_sort
  ON monitors(group_name, sort_order, id);

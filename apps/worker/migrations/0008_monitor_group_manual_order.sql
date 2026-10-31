-- Phase 11/14: add manual ordering across monitor groups
-- NOTE: Keep this file append-only.

ALTER TABLE monitors ADD COLUMN group_sort_order INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_monitors_group_sort;
CREATE INDEX IF NOT EXISTS idx_monitors_group_sort
  ON monitors(group_name, group_sort_order, sort_order, id);

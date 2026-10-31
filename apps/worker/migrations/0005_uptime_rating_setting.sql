-- Add settings key for uptime rating level (1-5).
-- NOTE: Keep this file append-only.

INSERT OR IGNORE INTO settings (key, value)
VALUES ('uptime_rating_level', '3');

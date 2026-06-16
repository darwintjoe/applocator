-- POS Coverage — D1 Schema v3
-- Run: wrangler d1 execute pos-coverage --file=./schema.sql --remote
-- Safe to re-run: all statements use IF NOT EXISTS / OR IGNORE

-- Counter — single row, atomically incremented per registration
CREATE TABLE IF NOT EXISTS counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counter (id, value) VALUES (1, 0);

-- App registry — auto-populated on first device registration per app
CREATE TABLE IF NOT EXISTS apps (
  app_id     TEXT PRIMARY KEY,
  app_name   TEXT NOT NULL,   -- editable display name
  created    TEXT NOT NULL
);

-- Devices — one row per physical device
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL DEFAULT 'PWA1',
  store_name  TEXT,
  latitude    REAL,
  longitude   REAL,
  accuracy    REAL,
  first_seen  TEXT NOT NULL,
  last_ping   TEXT NOT NULL,
  ping_count  INTEGER DEFAULT 0,
  FOREIGN KEY (app_id) REFERENCES apps(app_id)
);

CREATE INDEX IF NOT EXISTS idx_last_ping  ON devices (last_ping DESC);
CREATE INDEX IF NOT EXISTS idx_first_seen ON devices (first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_app_id     ON devices (app_id);

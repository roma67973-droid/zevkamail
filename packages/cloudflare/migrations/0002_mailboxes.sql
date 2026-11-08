-- mail-hub: saved mailboxes (synced between devices).
-- kind = 'permanent' → emails of this address never expire
-- (their expires_at_ms is set to a far-future value, see store.ts FOREVER_MS).
CREATE TABLE IF NOT EXISTS mailboxes (
  address        TEXT PRIMARY KEY,
  kind           TEXT NOT NULL DEFAULT 'temp' CHECK (kind IN ('temp', 'permanent')),
  label          TEXT,
  created_at_ms  INTEGER NOT NULL,
  updated_at_ms  INTEGER NOT NULL
);

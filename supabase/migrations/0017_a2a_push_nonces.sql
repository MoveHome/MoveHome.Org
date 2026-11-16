-- Migration 0017: durable A2A push replay guard (ADR-472 §2.5E).
-- A replayed (kid, nonce) must be rejected across instances, so the receiver
-- cannot keep it in process memory. The composite primary key makes the insert
-- the race: the loser of a concurrent duplicate gets 23505 and is rejected.
CREATE TABLE IF NOT EXISTS tbl_a2a_push_nonces (
  kid text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (kid, nonce)
);

CREATE INDEX IF NOT EXISTS idx_a2a_push_nonces_expires ON tbl_a2a_push_nonces (expires_at);

-- Service-role only: RLS on with no policies denies anon/authenticated entirely.
ALTER TABLE tbl_a2a_push_nonces ENABLE ROW LEVEL SECURITY;

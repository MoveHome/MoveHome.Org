-- Migration 0016: MCP Write Rate Limiter
CREATE TABLE IF NOT EXISTS tbl_mcp_write_rate (
  client_id text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 1,
  listing_id text NOT NULL DEFAULT '',
  PRIMARY KEY (client_id, window_start, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_write_rate_window ON tbl_mcp_write_rate (window_start);

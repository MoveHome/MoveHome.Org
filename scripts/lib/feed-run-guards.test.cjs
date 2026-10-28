"use strict";
// node --test scripts/lib/feed-run-guards.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeTelemetry, touchBookkeeping } = require("./feed-run-guards.cjs");

const stats = { attempted: 3, succeeded: 2, failed: 1, unchanged: 0, ineligible: 0, withdrawn: 0, gaps: {}, failures: [{ raia_id: "x" }] };

function fakeDb(error) {
  const calls = [];
  // Thenable terminal so `.eq(...).eq(...)` still awaits to { error }.
  const terminal = { eq: () => terminal, then: (resolve) => resolve({ error }) };
  return {
    calls,
    from(table) {
      const q = {
        insert: (body) => { calls.push([table, "insert", body]); return Promise.resolve({ error }); },
        update: (body) => { calls.push([table, "update", body]); return terminal; },
      };
      return q;
    },
  };
}

test("writeTelemetry reports an insert error instead of swallowing it", async () => {
  const db = fakeDb({ message: "boom" });
  assert.equal(await writeTelemetry(db, { pipeline: "p", stats, startedAt: 0, mode: "write" }), "boom");
  assert.equal(db.calls[0][2].status, "partial");
});

test("writeTelemetry returns null on success", async () => {
  const db = fakeDb(null);
  assert.equal(await writeTelemetry(db, { pipeline: "p", stats, startedAt: 0, mode: "write" }), null);
});

test("touchBookkeeping reports an update error", async () => {
  const db = fakeDb({ message: "stamp failed" });
  const err = await touchBookkeeping(db, { agent_id: "a", raia_id: "r" }, { last_seen_at: "t", synced_at: "t" });
  assert.equal(err, "stamp failed");
});

test("touchBookkeeping returns null on success", async () => {
  const db = fakeDb(null);
  assert.equal(await touchBookkeeping(db, { agent_id: "a", raia_id: "r" }, { last_seen_at: "t", synced_at: "t" }), null);
});

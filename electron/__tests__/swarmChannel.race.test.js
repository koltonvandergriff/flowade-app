// Race-condition regression for SwarmChannel.post().
//
// Background: token_id has a unique (run_id, token_id) constraint at the
// DB layer. Before the per-runId promise-chain mutex landed, two
// concurrent post()s for the same run could both read the same
// `_nextToken` value, increment locally, and try to insert the same
// row — second insert blew up with the unique-constraint error and the
// swarm ran bricked mid-flight. This test reproduces that pattern and
// asserts the mutex (and DB-resync fallback) keep token ids monotonic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase BEFORE importing swarmChannel — vitest's module
// resolver caches the import, so this needs to land first.
const seenTokens = new Set();
let nextDbTokenSequence = 0; // mock's source of truth for `_resyncNextToken`
let insertCount = 0;

vi.mock('../supabaseClient.js', () => {
  const builder = {
    _filters: {},
    _table: null,
    from(table) { this._table = table; this._filters = {}; return this; },
    select() { return this; },
    eq(col, val) { this._filters[col] = val; return this; },
    order() { return this; },
    limit() {
      // Return the highest token_id for the queried run_id.
      const data = nextDbTokenSequence > 0 ? [{ token_id: nextDbTokenSequence }] : [];
      return Promise.resolve({ data, error: null });
    },
    async insert(row) {
      insertCount++;
      const key = `${row.run_id}::${row.token_id}`;
      if (seenTokens.has(key)) {
        return { error: { message: `duplicate key value violates unique constraint "swarm_channel_events_run_id_token_id_key"` } };
      }
      seenTokens.add(key);
      if (row.token_id > nextDbTokenSequence) nextDbTokenSequence = row.token_id;
      return { error: null };
    },
  };
  return { supabase: builder };
});

let SwarmChannel;
beforeEach(async () => {
  seenTokens.clear();
  nextDbTokenSequence = 0;
  insertCount = 0;
  // Fresh import so the mock state resets cleanly between tests.
  vi.resetModules();
  const mod = await import('../swarmChannel.js');
  SwarmChannel = mod.SwarmChannel;
});

describe('SwarmChannel race condition', () => {
  it('4 concurrent posts to the same run get monotonic tokenIds and exactly 4 inserts', async () => {
    const channel = new SwarmChannel();
    const runId = 'run-race-1';

    const results = await Promise.all([
      channel.post({ runId, workerId: 'W1', kind: 'progress', payload: { i: 1 } }),
      channel.post({ runId, workerId: 'W2', kind: 'progress', payload: { i: 2 } }),
      channel.post({ runId, workerId: 'W3', kind: 'progress', payload: { i: 3 } }),
      channel.post({ runId, workerId: 'W4', kind: 'progress', payload: { i: 4 } }),
    ]);

    expect(results).toHaveLength(4);
    const tokens = results.map(r => r.tokenId);
    // Monotonic, distinct, starting at 1.
    expect(tokens).toEqual([1, 2, 3, 4]);
    // Mock saw exactly four successful inserts — no dup-key retries needed
    // because the per-runId promise chain serialized them.
    expect(insertCount).toBe(4);
  });

  it('stale local counter triggers resync + retry and the post still succeeds', async () => {
    const channel = new SwarmChannel();
    const runId = 'run-race-2';

    // First post sets _nextToken=1 in both local + mock DB.
    const first = await channel.post({ runId, workerId: 'system', kind: 'plan', payload: {} });
    expect(first.tokenId).toBe(1);
    expect(insertCount).toBe(1);

    // Simulate another writer (different process) inserting tokens 2-5
    // directly into the DB without updating our local counter. The mock
    // tracks token_id collisions so we have to claim those slots too,
    // otherwise our retry would land at token_id=2 and look monotonic.
    for (let i = 2; i <= 5; i++) {
      seenTokens.add(`${runId}::${i}`);
      nextDbTokenSequence = i;
    }

    // Local counter is still 1 → next try uses token_id=2 → dup-key →
    // resync should bump local to 5 → retry lands at 6.
    const second = await channel.post({ runId, workerId: 'W1', kind: 'progress', payload: { i: 6 } });
    expect(second.tokenId).toBe(6);
    // Two inserts attempted on the second call (one dup-key, one
    // success), plus the first call's single insert = 3 total inserts
    // observed by the mock.
    expect(insertCount).toBe(3);
  });
});

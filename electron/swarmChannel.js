import { EventEmitter } from 'events';
import { supabase } from './supabaseClient.js';

const VALID_KINDS = new Set([
  'plan', 'intent', 'claim', 'progress', 'blocker',
  'diff', 'done', 'review-fail', 'cancel', 'finish',
]);

const MAX_LOCAL_BUFFER = 1000;

function rowToEvent(row) {
  return {
    tokenId: Number(row.token_id),
    runId: row.run_id,
    workerId: row.worker_id ?? null,
    kind: row.kind,
    payload: row.payload ?? {},
    postedAt: row.posted_at,
  };
}

class SwarmChannel extends EventEmitter {
  constructor() {
    super();
    // Map<runId, Array<event>> — local fast-tail buffer; cloud is source of truth.
    this._buffer = new Map();
    // Map<runId, number> — next token id per run.
    this._nextToken = new Map();
    // Map<runId, Promise> — per-run serialization. Concurrent posts to the
    // same run chain off the tail so token allocation + insert is atomic.
    // Without this, two posts can read the same `_nextToken` value and
    // race to insert the same token_id, violating the unique constraint.
    this._postChain = new Map();
  }

  _appendLocal(runId, event) {
    let buf = this._buffer.get(runId);
    if (!buf) { buf = []; this._buffer.set(runId, buf); }
    buf.push(event);
    if (buf.length > MAX_LOCAL_BUFFER) buf.splice(0, buf.length - MAX_LOCAL_BUFFER);
  }

  _bufferCovers(runId, sinceTokenId) {
    const buf = this._buffer.get(runId);
    if (!buf || buf.length === 0) return false;
    // Buffer "covers" a since cursor iff the oldest event's tokenId is
    // <= sinceTokenId + 1, i.e. no gap between the cursor and what we have.
    return buf[0].tokenId <= sinceTokenId + 1;
  }

  async _resyncNextToken(runId) {
    const { data, error } = await supabase
      .from('swarm_channel_events')
      .select('token_id')
      .eq('run_id', runId)
      .order('token_id', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message || String(error));
    const maxToken = data && data.length > 0 ? Number(data[0].token_id) : 0;
    this._nextToken.set(runId, maxToken);
    return maxToken;
  }

  async _postOnce({ runId, workerId, kind, payload }) {
    const next = (this._nextToken.get(runId) || 0) + 1;
    this._nextToken.set(runId, next);
    const postedAt = new Date().toISOString();
    const row = {
      run_id: runId,
      worker_id: workerId ?? null,
      kind,
      payload: payload ?? {},
      token_id: next,
      posted_at: postedAt,
    };
    const { error } = await supabase
      .from('swarm_channel_events')
      .insert(row);
    if (error) {
      // Roll back counter; safe under per-runId mutex because no
      // concurrent post can have grabbed a higher token in this process.
      this._nextToken.set(runId, next - 1);
      const msg = error.message || String(error);
      const isDupKey = /duplicate key|swarm_channel_events_run_id_token_id_key|unique constraint/i.test(msg);
      const err = new Error(msg);
      err.isDupKey = isDupKey;
      throw err;
    }
    const event = rowToEvent(row);
    this._appendLocal(runId, event);
    this.emit('event', event);
    this.emit(`event:${kind}`, event);
    this.emit(`event:run:${runId}`, event);
    return { ok: true, tokenId: next, postedAt };
  }

  async post({ runId, workerId, kind, payload }) {
    if (!runId || typeof runId !== 'string') throw new Error('runId required');
    if (!VALID_KINDS.has(kind)) throw new Error(`invalid kind: ${kind}`);
    const prev = this._postChain.get(runId) || Promise.resolve();
    const next = prev
      .catch(() => { /* swallow upstream errors; this post is independent */ })
      .then(async () => {
        try {
          return await this._postOnce({ runId, workerId, kind, payload });
        } catch (err) {
          // Token allocator drifted out of sync with DB (process restart,
          // another writer, or stale local counter). Resync from DB and
          // retry once.
          if (err && err.isDupKey) {
            await this._resyncNextToken(runId);
            return this._postOnce({ runId, workerId, kind, payload });
          }
          throw err;
        }
      });
    this._postChain.set(runId, next);
    // Keep the chain bounded — drop ref once settled so we don't leak.
    next.finally(() => {
      if (this._postChain.get(runId) === next) this._postChain.delete(runId);
    }).catch(() => {});
    return next;
  }

  async read({ runId, sinceTokenId = 0, kinds = null, limit = 200 }) {
    if (!runId || typeof runId !== 'string') throw new Error('runId required');
    const kindFilter = Array.isArray(kinds) && kinds.length > 0 ? kinds : null;

    if (this._bufferCovers(runId, sinceTokenId)) {
      const buf = this._buffer.get(runId) || [];
      let events = buf.filter((e) => e.tokenId > sinceTokenId);
      if (kindFilter) events = events.filter((e) => kindFilter.includes(e.kind));
      if (events.length > limit) events = events.slice(0, limit);
      const latestTokenId = buf.length > 0 ? buf[buf.length - 1].tokenId : sinceTokenId;
      return { events, latestTokenId };
    }

    let q = supabase
      .from('swarm_channel_events')
      .select('*')
      .eq('run_id', runId)
      .gt('token_id', sinceTokenId)
      .order('token_id', { ascending: true })
      .limit(limit);
    if (kindFilter) q = q.in('kind', kindFilter);
    const { data, error } = await q;
    if (error) throw new Error(error.message || String(error));
    const events = (data || []).map(rowToEvent);
    const latestTokenId = events.length > 0
      ? events[events.length - 1].tokenId
      : sinceTokenId;
    // Opportunistically warm the local buffer.
    for (const ev of events) {
      const cur = this._nextToken.get(runId) || 0;
      if (ev.tokenId > cur) this._nextToken.set(runId, ev.tokenId);
      this._appendLocal(runId, ev);
    }
    return { events, latestTokenId };
  }

  bridgeHandlers() {
    return {
      'channel.post': (p) => this.post(p),
      'channel.read': (p) => this.read(p),
    };
  }

  registerBridge(bridge) {
    if (!bridge || typeof bridge.registerMethod !== 'function') return;
    for (const [n, fn] of Object.entries(this.bridgeHandlers())) bridge.registerMethod(n, fn);
  }
}

export { SwarmChannel };
export const swarmChannel = new SwarmChannel();

import { EventEmitter } from 'events';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MIN_TTL_MS = 30 * 1000;
const MAX_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

function clampTtl(ttlMs) {
  const n = Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS;
  if (n < MIN_TTL_MS) return MIN_TTL_MS;
  if (n > MAX_TTL_MS) return MAX_TTL_MS;
  return n;
}

function shallowCopy(rec) {
  return {
    path: rec.path,
    runId: rec.runId,
    workerId: rec.workerId,
    acquiredAt: rec.acquiredAt,
    expiresAt: rec.expiresAt,
  };
}

class LeaseRegistry extends EventEmitter {
  #leases;
  #sweepTimer;

  constructor() {
    super();
    this.#leases = new Map();
    this.#sweepTimer = null;
    this._startSweep();
  }

  _normalize(p) {
    if (typeof p !== 'string') throw new TypeError('path must be a string');
    let out = p.replace(/\\/g, '/');
    // Lowercase a leading drive letter (e.g. C:/ → c:/).
    if (/^[A-Za-z]:\//.test(out)) {
      out = out[0].toLowerCase() + out.slice(1);
    }
    // Strip trailing slash unless it's the whole string (e.g. "/" or "c:/").
    while (out.length > 1 && out.endsWith('/') && !/^[a-z]:\/$/.test(out)) {
      out = out.slice(0, -1);
    }
    return out;
  }

  _isExpired(record, now = Date.now()) {
    return record.expiresAt <= now;
  }

  claim({ runId, workerId, path, ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!runId || !workerId || !path) {
      return { ok: false, error: 'runId, workerId, and path are required' };
    }
    const norm = this._normalize(path);
    const ttl = clampTtl(ttlMs);
    const now = Date.now();
    const existing = this.#leases.get(norm);
    if (existing && !this._isExpired(existing, now)) {
      if (existing.runId === runId && existing.workerId === workerId) {
        existing.expiresAt = now + ttl;
        return { ok: true, renewed: true, expiresAt: existing.expiresAt };
      }
      return {
        ok: false,
        conflict: {
          runId: existing.runId,
          workerId: existing.workerId,
          expiresAt: existing.expiresAt,
          isCrossRun: existing.runId !== runId,
        },
      };
    }
    const record = {
      path: norm,
      runId,
      workerId,
      acquiredAt: now,
      expiresAt: now + ttl,
    };
    this.#leases.set(norm, record);
    this.emit('lease:acquired', shallowCopy(record));
    return { ok: true, renewed: false, expiresAt: record.expiresAt };
  }

  release({ runId, workerId, path } = {}) {
    if (!path) return { ok: false, error: 'path is required' };
    const norm = this._normalize(path);
    const record = this.#leases.get(norm);
    if (!record) return { ok: true, missing: true };
    if (record.runId !== runId || record.workerId !== workerId) {
      return { ok: false, error: 'not lease holder' };
    }
    this.#leases.delete(norm);
    this.emit('lease:released', shallowCopy(record));
    return { ok: true };
  }

  releaseAll({ runId, workerId } = {}) {
    if (!runId) return { released: 0 };
    let released = 0;
    for (const [path, rec] of this.#leases) {
      if (rec.runId !== runId) continue;
      if (workerId !== undefined && workerId !== null && rec.workerId !== workerId) continue;
      this.#leases.delete(path);
      this.emit('lease:released', shallowCopy(rec));
      released++;
    }
    return { released };
  }

  list(filter) {
    const f = filter && typeof filter === 'object' ? filter : {};
    const excludeExpired = f.excludeExpired !== false;
    const now = Date.now();
    const normPath = f.path !== undefined ? this._normalize(f.path) : undefined;
    const out = [];
    for (const rec of this.#leases.values()) {
      if (excludeExpired && this._isExpired(rec, now)) continue;
      if (normPath !== undefined && rec.path !== normPath) continue;
      if (f.runId !== undefined && rec.runId !== f.runId) continue;
      if (f.workerId !== undefined && rec.workerId !== f.workerId) continue;
      out.push(shallowCopy(rec));
    }
    return out;
  }

  validatePlan({ subtasks } = {}) {
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      return { ok: true, parallelismFactor: 1, waves: [], filesPerWorker: {} };
    }
    const owner = new Map();
    const filesPerWorker = {};
    const knownWorkers = new Set(subtasks.map(s => s && s.workerId).filter(Boolean));
    for (const s of subtasks) {
      if (!s || !s.workerId) return { ok: false, error: 'subtask missing workerId' };
      const files = Array.isArray(s.expectedFiles) ? s.expectedFiles : [];
      filesPerWorker[s.workerId] = files.length;
      for (const raw of files) {
        const norm = this._normalize(raw);
        if (owner.has(norm) && owner.get(norm) !== s.workerId) {
          return { ok: false, overlap: { path: norm, workers: [owner.get(norm), s.workerId] } };
        }
        owner.set(norm, s.workerId);
      }
    }

    const hasDeps = subtasks.some(s => Array.isArray(s.dependsOn) && s.dependsOn.length > 0);
    if (!hasDeps) {
      return { ok: true, parallelismFactor: 1.0, waves: [subtasks.map(s => s.workerId)], filesPerWorker };
    }

    // Validate dependsOn references.
    for (const s of subtasks) {
      if (!Array.isArray(s.dependsOn)) continue;
      for (const dep of s.dependsOn) {
        if (!knownWorkers.has(dep)) return { ok: false, error: 'bad dependsOn' };
      }
    }

    // Kahn-style topological waves.
    const indeg = new Map();
    const remainingDeps = new Map();
    for (const s of subtasks) {
      indeg.set(s.workerId, (Array.isArray(s.dependsOn) ? s.dependsOn.length : 0));
      remainingDeps.set(s.workerId, new Set(Array.isArray(s.dependsOn) ? s.dependsOn : []));
    }
    const waves = [];
    let placed = 0;
    while (placed < subtasks.length) {
      const wave = [];
      for (const [w, d] of indeg) {
        if (d === 0) wave.push(w);
      }
      if (wave.length === 0) return { ok: false, error: 'dependency cycle' };
      for (const w of wave) indeg.delete(w);
      // Drop this wave's workers from remainingDeps of others.
      for (const [w, deps] of remainingDeps) {
        if (!indeg.has(w)) continue;
        for (const done of wave) {
          if (deps.has(done)) {
            deps.delete(done);
            indeg.set(w, deps.size);
          }
        }
      }
      waves.push(wave);
      placed += wave.length;
    }
    const widest = waves.reduce((m, w) => Math.max(m, w.length), 0);
    const parallelismFactor = subtasks.length > 0 ? widest / subtasks.length : 1;
    return { ok: true, parallelismFactor, waves, filesPerWorker };
  }

  _startSweep() {
    this._stopSweep();
    this.#sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [path, rec] of this.#leases) {
        if (this._isExpired(rec, now)) {
          this.#leases.delete(path);
          this.emit('lease:expired', shallowCopy(rec));
        }
      }
    }, SWEEP_INTERVAL_MS);
    if (typeof this.#sweepTimer.unref === 'function') this.#sweepTimer.unref();
  }

  _stopSweep() {
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  size() {
    return this.#leases.size;
  }
}

const leaseRegistry = new LeaseRegistry();

function registerLeaseBridgeHandlers(bridge) {
  if (!bridge || typeof bridge.registerMethod !== 'function') {
    throw new TypeError('bridge must expose registerMethod(name, handler)');
  }
  bridge.registerMethod('lease.claim', async (params) => leaseRegistry.claim(params || {}));
  bridge.registerMethod('lease.release', async (params) => leaseRegistry.release(params || {}));
  bridge.registerMethod('lease.releaseAll', async (params) => leaseRegistry.releaseAll(params || {}));
  bridge.registerMethod('lease.list', async (params) => leaseRegistry.list(params || {}));
  bridge.registerMethod('lease.validatePlan', async (params) => leaseRegistry.validatePlan(params || {}));
}

export {
  LeaseRegistry,
  DEFAULT_TTL_MS,
  MIN_TTL_MS,
  MAX_TTL_MS,
  leaseRegistry,
  registerLeaseBridgeHandlers,
};

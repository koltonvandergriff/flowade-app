import { EventEmitter } from 'events';

const RING_SIZE = 256 * 1024;
const VALID_OWNER_TYPES = new Set(['user', 'orchestrator', 'agent']);
const VALID_TEAM_IDS = new Set([null, 'A', 'B', 'C', 'D']);
const VALID_STATES = new Set(['idle', 'busy', 'done', 'crashed']);

function isPlainString(v) {
  return typeof v === 'string';
}

function shallowCopy(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    provider: rec.provider,
    sessionName: rec.sessionName,
    workspace: rec.workspace,
    ownerType: rec.ownerType,
    teamId: rec.teamId,
    spawnedBy: rec.spawnedBy,
    state: rec.state,
    ringWrite: rec.ringWrite,
    ringFilled: rec.ringFilled,
    tokenSeq: rec.tokenSeq,
    createdAt: rec.createdAt,
    lastInputAt: rec.lastInputAt,
  };
}

class PaneRegistry extends EventEmitter {
  #panes;

  constructor() {
    super();
    this.#panes = new Map();
  }

  #writeRing(record, bytes) {
    if (!record.ringBuffer) {
      record.ringBuffer = new Uint8Array(RING_SIZE);
    }
    const buf = record.ringBuffer;
    const len = bytes.length;
    if (len === 0) return;
    if (len >= RING_SIZE) {
      // Only last RING_SIZE bytes survive; write them starting at offset 0
      const start = len - RING_SIZE;
      for (let i = 0; i < RING_SIZE; i++) {
        buf[i] = bytes[start + i];
      }
      record.ringWrite = 0;
      record.ringFilled = true;
      return;
    }
    const writePos = record.ringWrite;
    const firstChunk = Math.min(len, RING_SIZE - writePos);
    for (let i = 0; i < firstChunk; i++) {
      buf[writePos + i] = bytes[i];
    }
    const remaining = len - firstChunk;
    if (remaining > 0) {
      for (let i = 0; i < remaining; i++) {
        buf[i] = bytes[firstChunk + i];
      }
      record.ringFilled = true;
      record.ringWrite = remaining;
    } else {
      const newPos = writePos + firstChunk;
      if (newPos === RING_SIZE) {
        record.ringWrite = 0;
        record.ringFilled = true;
      } else {
        record.ringWrite = newPos;
      }
    }
  }

  #readRingSlice(record, count) {
    // Return a single Buffer containing the last `count` bytes written.
    // Assumes count <= bytes currently in ring.
    const buf = record.ringBuffer;
    if (!buf || count <= 0) return Buffer.alloc(0);
    const out = Buffer.alloc(count);
    // Logical end is record.ringWrite (next write position == one past last byte)
    // Start byte index in linear "last N" terms: walk back `count` from end.
    let startPhys = record.ringWrite - count;
    if (startPhys < 0) startPhys += RING_SIZE;
    const firstChunk = Math.min(count, RING_SIZE - startPhys);
    for (let i = 0; i < firstChunk; i++) {
      out[i] = buf[startPhys + i];
    }
    const remaining = count - firstChunk;
    for (let i = 0; i < remaining; i++) {
      out[firstChunk + i] = buf[i];
    }
    return out;
  }

  register(paneId, opts) {
    if (!isPlainString(paneId) || paneId.length === 0) {
      throw new TypeError('paneId must be a non-empty string');
    }
    if (this.#panes.has(paneId)) {
      throw new Error(`pane already registered: ${paneId}`);
    }
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('opts must be an object');
    }
    const provider = opts.provider;
    const sessionName = opts.sessionName;
    const workspace = opts.workspace;
    const ownerType = opts.ownerType === undefined ? 'user' : opts.ownerType;
    const teamId = opts.teamId === undefined ? null : opts.teamId;
    const spawnedBy = opts.spawnedBy === undefined ? null : opts.spawnedBy;

    if (!VALID_OWNER_TYPES.has(ownerType)) {
      throw new Error(`invalid ownerType: ${String(ownerType)}`);
    }
    if (!VALID_TEAM_IDS.has(teamId)) {
      throw new Error(`invalid teamId: ${String(teamId)}`);
    }

    const record = {
      id: paneId,
      provider: provider == null ? null : String(provider),
      sessionName: sessionName == null ? null : String(sessionName),
      workspace: workspace == null ? null : String(workspace),
      ownerType,
      teamId,
      spawnedBy: spawnedBy == null ? null : String(spawnedBy),
      state: 'idle',
      ringBuffer: null,
      ringWrite: 0,
      ringFilled: false,
      tokenSeq: 0,
      createdAt: Date.now(),
      lastInputAt: 0,
      // initialPrompt is intentionally kept off shallowCopy so it never
      // ships to the renderer via IPC events. main.js reads it via
      // getInitialPrompt() and writes it to the pty directly.
      initialPrompt: typeof opts.initialPrompt === 'string' && opts.initialPrompt.length > 0
        ? opts.initialPrompt
        : null,
    };
    this.#panes.set(paneId, record);
    const snapshot = shallowCopy(record);
    this.emit('pane:register', snapshot);
    return snapshot;
  }

  get(paneId) {
    if (!isPlainString(paneId)) return null;
    const rec = this.#panes.get(paneId);
    return rec ? shallowCopy(rec) : null;
  }

  // Stamp the moment the user (renderer) wrote into this pane's pty.
  // Used by swarm orchestration to pick the active user pane when
  // resolving userTerminalId — much more reliable than createdAt (a
  // fresh-but-empty pane wins) or tokenSeq (only fed by headless ptys).
  bumpInput(paneId) {
    const rec = this.#panes.get(paneId);
    if (rec) rec.lastInputAt = Date.now();
  }

  list(filter) {
    const f = filter && typeof filter === 'object' ? filter : null;
    const out = [];
    for (const rec of this.#panes.values()) {
      if (f) {
        if (f.workspace !== undefined && rec.workspace !== f.workspace) continue;
        if (f.ownerType !== undefined && rec.ownerType !== f.ownerType) continue;
        if (f.state !== undefined && rec.state !== f.state) continue;
        if (f.teamId !== undefined && rec.teamId !== f.teamId) continue;
        if (f.spawnedBy !== undefined && rec.spawnedBy !== f.spawnedBy) continue;
      }
      out.push(shallowCopy(rec));
    }
    return out;
  }

  appendOutput(paneId, bytes) {
    const record = this.#panes.get(paneId);
    if (!record) {
      throw new Error(`unknown pane: ${paneId}`);
    }
    let view;
    if (Buffer.isBuffer(bytes)) {
      view = bytes;
    } else if (bytes instanceof Uint8Array) {
      view = bytes;
    } else {
      throw new TypeError('bytes must be Buffer or Uint8Array');
    }
    const len = view.length;
    if (len === 0) {
      return;
    }
    this.#writeRing(record, view);
    record.tokenSeq += len;
    this.emit('pane:output', {
      paneId,
      tokenId: record.tokenSeq,
      bytesWritten: len,
    });
  }

  readSince(paneId, sinceTokenId, maxBytes) {
    const record = this.#panes.get(paneId);
    if (!record) {
      throw new Error(`unknown pane: ${paneId}`);
    }
    const since = Number.isFinite(sinceTokenId) ? Math.max(0, Math.floor(sinceTokenId)) : 0;
    const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : Infinity;

    if (!record.ringBuffer || record.tokenSeq === 0) {
      return { chunks: [], tokenId: 0, dropped: false };
    }
    if (since >= record.tokenSeq) {
      return { chunks: [], tokenId: record.tokenSeq, dropped: false };
    }

    const available = record.ringFilled ? RING_SIZE : record.ringWrite;
    const oldestTokenInRing = record.tokenSeq - available;
    let dropped = false;
    let effectiveSince = since;
    if (since < oldestTokenInRing) {
      dropped = true;
      effectiveSince = oldestTokenInRing;
    }
    let wantBytes = record.tokenSeq - effectiveSince;
    if (wantBytes > cap) {
      // Cap honored from the tail (most recent). We move effectiveSince forward.
      effectiveSince = record.tokenSeq - cap;
      wantBytes = cap;
    }
    if (wantBytes <= 0) {
      return { chunks: [], tokenId: record.tokenSeq, dropped };
    }
    const slice = this.#readRingSlice(record, wantBytes);
    return { chunks: [slice], tokenId: record.tokenSeq, dropped };
  }

  setState(paneId, newState) {
    const record = this.#panes.get(paneId);
    if (!record) {
      throw new Error(`unknown pane: ${paneId}`);
    }
    if (!VALID_STATES.has(newState)) {
      throw new Error(`invalid state: ${String(newState)}`);
    }
    const oldState = record.state;
    if (oldState === newState) return;
    record.state = newState;
    this.emit('pane:state-change', { paneId, oldState, newState });
  }

  setOwner(paneId, ownerType, teamId, spawnedBy) {
    const record = this.#panes.get(paneId);
    if (!record) {
      throw new Error(`unknown pane: ${paneId}`);
    }
    if (!VALID_OWNER_TYPES.has(ownerType)) {
      throw new Error(`invalid ownerType: ${String(ownerType)}`);
    }
    const t = teamId === undefined ? null : teamId;
    if (!VALID_TEAM_IDS.has(t)) {
      throw new Error(`invalid teamId: ${String(t)}`);
    }
    const sb = spawnedBy === undefined || spawnedBy === null ? null : String(spawnedBy);
    record.ownerType = ownerType;
    record.teamId = t;
    record.spawnedBy = sb;
    this.emit('pane:owner-change', {
      paneId,
      ownerType,
      teamId: t,
      spawnedBy: sb,
    });
  }

  unregister(paneId) {
    if (!this.#panes.has(paneId)) return;
    this.#panes.delete(paneId);
    this.emit('pane:closed', { paneId });
  }

  // Read the staged initial prompt for a pane. main.js calls this after
  // the pty for the pane is created so it can write the prompt without
  // routing it through renderer state.
  getInitialPrompt(paneId) {
    const rec = this.#panes.get(paneId);
    return rec && rec.initialPrompt ? rec.initialPrompt : null;
  }

  // Stage / replace the initial prompt for an already-registered pane.
  // Used by swarm orchestration when a pane was registered before its
  // prompt could be built (e.g. orchestrator needs worker ids that don't
  // exist until workers are spawned).
  setInitialPrompt(paneId, prompt) {
    const rec = this.#panes.get(paneId);
    if (!rec) return false;
    rec.initialPrompt = typeof prompt === 'string' && prompt.length > 0 ? prompt : null;
    return true;
  }

  clearInitialPrompt(paneId) {
    const rec = this.#panes.get(paneId);
    if (rec) rec.initialPrompt = null;
  }

  size() {
    return this.#panes.size;
  }
}

export { PaneRegistry, RING_SIZE };
export const paneRegistry = new PaneRegistry();

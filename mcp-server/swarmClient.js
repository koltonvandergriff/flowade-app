import WebSocket from 'ws';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import keytar from 'keytar';
import { EventEmitter } from 'events';

const SERVICE = 'flowade';
const ACCOUNT = 'swarm-bridge';

// Mirror index.js's DATA_DIR derivation so we look in the SAME place
// the Electron-side bridge writes the port file. Honor FLOWADE_DATA_DIR
// override.
function dataDir() {
  if (process.env.FLOWADE_DATA_DIR) return process.env.FLOWADE_DATA_DIR;
  const base = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'flowade')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'flowade')
      : join(homedir(), '.config', 'flowade');
  return join(base, 'flowade-data');
}

function portFilePath() { return join(dataDir(), 'swarm-port.json'); }

async function readBridgeLocation() {
  const file = portFilePath();
  if (!existsSync(file)) throw new Error('swarm bridge port file not found — bridge is not running');
  const txt = readFileSync(file, 'utf8');
  const obj = JSON.parse(txt);
  if (typeof obj.port !== 'number') throw new Error('swarm bridge port file malformed');
  const token = await keytar.getPassword(SERVICE, ACCOUNT);
  if (!token) throw new Error('swarm bridge token not found in keychain');
  return { host: obj.host || '127.0.0.1', port: obj.port, token };
}

class SwarmClient extends EventEmitter {
  constructor() {
    super();
    this._ws = null;
    this._connecting = null;       // in-flight connect Promise
    this._nextId = 1;
    this._pending = new Map();      // id → { resolve, reject, timer }
    this._reconnectDelayMs = 1000;
    this._maxReconnectDelayMs = 30000;
    this._appPingTimer = null;
    this._unavailable = false;
    this._closing = false;
  }

  // Lazy connect. Returns the ws once OPEN. Single-flight via _connecting.
  async _ensureConnected() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return this._ws;
    if (this._connecting) return this._connecting;
    this._connecting = (async () => {
      try {
        const { host, port, token } = await readBridgeLocation();
        const ws = new WebSocket(`ws://${host}:${port}`, {
          headers: { Authorization: `Bearer ${token}` },
          handshakeTimeout: 5000,
        });
        await new Promise((res, rej) => {
          ws.once('open', res);
          ws.once('error', (e) => rej(e));
        });
        this._ws = ws;
        this._unavailable = false;
        this._reconnectDelayMs = 1000;
        this._wire(ws);
        this._startAppPing();
        this.emit('connected');
        return ws;
      } finally {
        this._connecting = null;
      }
    })();
    try {
      return await this._connecting;
    } catch (e) {
      this._unavailable = true;
      throw e;
    }
  }

  _wire(ws) {
    ws.on('message', (data) => this._onMessage(data));
    ws.on('close', () => this._onClose());
    ws.on('error', (e) => this.emit('error', e));
    // ws library auto-responds to pings, no extra handler needed.
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { this.emit('error', new Error('bad json from bridge')); return; }
    if (msg && typeof msg.id !== 'undefined' && this._pending.has(msg.id)) {
      const entry = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'rpc error'), { code: msg.error.code, data: msg.error.data }));
      else entry.resolve(msg.result);
      return;
    }
    if (msg && msg.method && typeof msg.id === 'undefined') {
      this.emit(`notify:${msg.method}`, msg.params);
      this.emit('notify', { method: msg.method, params: msg.params });
    }
  }

  _onClose() {
    this._stopAppPing();
    // Fail pending RPCs.
    for (const [, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('swarm bridge connection closed'));
    }
    this._pending.clear();
    this._ws = null;
    this.emit('disconnected');
    if (this._closing) return;
    // Auto-reconnect with exponential backoff.
    const delay = this._reconnectDelayMs;
    this._reconnectDelayMs = Math.min(this._reconnectDelayMs * 2, this._maxReconnectDelayMs);
    setTimeout(() => {
      if (this._closing) return;
      this._ensureConnected().catch(() => { /* will retry on next demand or timer */ });
    }, delay);
  }

  _startAppPing() {
    this._stopAppPing();
    this._appPingTimer = setInterval(() => {
      this.call('ping', undefined, 5000).catch(() => { /* swallow */ });
    }, 30000);
  }
  _stopAppPing() {
    if (this._appPingTimer) { clearInterval(this._appPingTimer); this._appPingTimer = null; }
  }

  // Public: invoke a remote method. Rejects with 'swarm unavailable' if
  // connect or send fails — tool handlers can map this to a user-facing
  // MCP error without crashing the server.
  async call(method, params, timeoutMs = 30000) {
    let ws;
    try { ws = await this._ensureConnected(); }
    catch (e) { throw Object.assign(new Error(`swarm unavailable: ${e.message}`), { code: 'SWARM_UNAVAILABLE' }); }
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`swarm call timeout (${method})`));
        }
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ id, method, params })); }
      catch (e) {
        this._pending.delete(id);
        clearTimeout(timer);
        reject(Object.assign(new Error(`swarm unavailable: ${e.message}`), { code: 'SWARM_UNAVAILABLE' }));
      }
    });
  }

  // Fire-and-forget notification. Throws synchronously only if not connected.
  notify(method, params) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) throw Object.assign(new Error('swarm unavailable'), { code: 'SWARM_UNAVAILABLE' });
    this._ws.send(JSON.stringify({ method, params }));
  }

  isUnavailable() { return this._unavailable; }
  isConnected() { return !!(this._ws && this._ws.readyState === WebSocket.OPEN); }

  async close() {
    this._closing = true;
    this._stopAppPing();
    for (const [, entry] of this._pending) { clearTimeout(entry.timer); entry.reject(new Error('client closing')); }
    this._pending.clear();
    if (this._ws) {
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
  }
}

export { SwarmClient };
export const swarmClient = new SwarmClient();

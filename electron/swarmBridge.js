import { app } from 'electron';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';
import keytar from 'keytar';
import { EventEmitter } from 'events';

const SERVICE = 'flowade';
const ACCOUNT = 'swarm-bridge';
const HEARTBEAT_MS = 5000;
const HEARTBEAT_GRACE_MS = 10000;

function portFilePath() {
  const dir = join(app.getPath('userData'), 'flowade-data');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'swarm-port.json');
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

async function ensureToken() {
  const existing = await keytar.getPassword(SERVICE, ACCOUNT);
  if (existing) return existing;
  const token = generateToken();
  await keytar.setPassword(SERVICE, ACCOUNT, token);
  return token;
}

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function extractBearer(req) {
  const h = req.headers && req.headers['authorization'];
  if (!h || typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

class SwarmBridge extends EventEmitter {
  constructor() {
    super();
    this._server = null;
    this._port = null;
    this._token = null;
    this._heartbeat = null;
    this._clients = new Set();
    this._methods = new Map();
  }

  registerMethod(name, handler) {
    if (typeof name !== 'string' || typeof handler !== 'function') return;
    this._methods.set(name, handler);
  }

  getPort() {
    return this._port;
  }

  getClientCount() {
    let n = 0;
    for (const ws of this._clients) {
      if (ws._authed && ws.readyState === 1) n++;
    }
    return n;
  }

  async start({ settingsStore } = {}) {
    if (this._server) {
      return { started: true, port: this._port, token: this._token };
    }
    const allow = settingsStore && settingsStore.get && settingsStore.get('swarm.allowAgentSpawn');
    if (!allow) return { started: false };

    const token = await ensureToken();
    this._token = token;

    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    this._server = wss;
    const addr = wss.address();
    this._port = typeof addr === 'object' && addr ? addr.port : null;

    wss.on('connection', (ws, req) => {
      const provided = extractBearer(req);
      if (!tokenMatches(provided, this._token)) {
        try { ws.close(1008, 'unauthorized'); } catch {}
        this.emit('unauthorized', { remoteAddress: req.socket && req.socket.remoteAddress });
        return;
      }
      ws._authed = true;
      ws.isAlive = true;
      this._clients.add(ws);
      this.emit('client:connect', ws);

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          this._safeSend(ws, { id: null, error: { code: -32700, message: 'parse error' } });
          return;
        }
        this._handleMessage(ws, msg);
      });

      ws.on('close', () => {
        this._clients.delete(ws);
        this.emit('client:disconnect', ws);
      });

      ws.on('error', (err) => {
        this.emit('error', err);
      });
    });

    wss.on('error', (err) => this.emit('error', err));

    this._heartbeat = setInterval(() => {
      for (const ws of this._clients) {
        if (ws.isAlive === false) {
          try { ws.terminate(); } catch {}
          this._clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      }
    }, HEARTBEAT_MS);

    const file = portFilePath();
    const payload = {
      v: 1,
      port: this._port,
      pid: process.pid,
      host: '127.0.0.1',
      startedAt: new Date().toISOString()
    };
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    try {
      chmodSync(file, 0o600);
    } catch (e) {
      if (e && e.code !== 'EPERM' && e.code !== 'ENOSYS') {
        this.emit('error', e);
      }
    }

    return { started: true, port: this._port, token };
  }

  _handleMessage(ws, msg) {
    if (!msg || typeof msg !== 'object') {
      this._safeSend(ws, { id: null, error: { code: -32600, message: 'invalid request' } });
      return;
    }
    const { id, method, params } = msg;
    if (method === 'ping') {
      this._safeSend(ws, { id, result: 'pong' });
      return;
    }
    const handler = this._methods.get(method);
    if (!handler) {
      this._safeSend(ws, { id, error: { code: -32601, message: 'method not found' } });
      return;
    }
    Promise.resolve()
      .then(() => handler(params))
      .then((result) => this._safeSend(ws, { id, result }))
      .catch((err) => this._safeSend(ws, { id, error: { code: -32000, message: err?.message || String(err), data: err?.code || undefined } }));
  }

  _safeSend(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (err) {
      this.emit('error', err);
    }
  }

  async stop() {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
    for (const ws of this._clients) {
      try { ws.close(1001, 'shutdown'); } catch {}
      try { ws.terminate(); } catch {}
    }
    this._clients.clear();
    if (this._server) {
      const srv = this._server;
      this._server = null;
      await new Promise((resolve) => {
        try {
          srv.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
    this._port = null;
    try {
      const file = portFilePath();
      if (existsSync(file)) unlinkSync(file);
    } catch {}
  }
}

export { SwarmBridge };
export const swarmBridge = new SwarmBridge();

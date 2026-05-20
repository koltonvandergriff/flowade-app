// Catalog of AI-CLI providers a swarm pane can host. The renderer's
// constants.js has a similar list for UI labeling; this main-process
// copy is intentionally narrower — only the fields the orchestrator
// needs to spawn + validate. Keep them in sync when adding providers.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execFileAsync = promisify(execFile);

const CATALOG = {
  claude: {
    id: 'claude',
    binary: 'claude',
    startCommand: 'claude',
    swarmCapable: true,
  },
  codex: {
    id: 'codex',
    binary: 'codex',
    startCommand: 'codex',
    swarmCapable: true,
  },
  aider: {
    id: 'aider',
    binary: 'aider',
    startCommand: 'aider',
    swarmCapable: true,
  },
  gemini: {
    id: 'gemini',
    binary: 'gemini',
    startCommand: 'gemini',
    swarmCapable: true,
  },
  // API + shell providers cannot host an agent inside a pty pane — the
  // swarm tool refuses to spawn them.
  'claude-api':  { id: 'claude-api',  binary: null, startCommand: null, swarmCapable: false },
  'chatgpt':     { id: 'chatgpt',     binary: null, startCommand: null, swarmCapable: false },
  shell:         { id: 'shell',       binary: null, startCommand: null, swarmCapable: false },
  custom:        { id: 'custom',      binary: null, startCommand: null, swarmCapable: false },
};

export function getProvider(id) {
  return CATALOG[id] || null;
}

export function isSwarmCapable(id) {
  const p = CATALOG[id];
  return !!(p && p.swarmCapable);
}

export function getStartCommand(id) {
  return CATALOG[id]?.startCommand || null;
}

const availabilityCache = new Map();

// Check whether the CLI binary for this provider is on PATH. Cached for
// 60s so repeated swarm spawns don't re-shell out. `where` on Windows,
// `command -v` everywhere else — both exit 0 when found, non-zero when
// missing.
export async function checkAvailable(id) {
  const p = CATALOG[id];
  if (!p || !p.binary) return { available: false, reason: 'no binary' };
  const cached = availabilityCache.get(id);
  const now = Date.now();
  if (cached && now - cached.at < 60_000) return cached.result;

  const isWin = platform() === 'win32';
  const cmd = isWin ? 'where' : 'sh';
  const args = isWin ? [p.binary] : ['-c', `command -v ${p.binary}`];

  let result;
  try {
    await execFileAsync(cmd, args, { timeout: 3000 });
    result = { available: true };
  } catch (err) {
    result = { available: false, reason: `${p.binary} not on PATH` };
  }
  availabilityCache.set(id, { at: now, result });
  return result;
}

// Resolve which provider a swarm-spawned pane should use. Order:
//   1. explicit `requested` (caller passed provider in MCP tool call)
//   2. `parentPaneId` lookup in paneRegistry (Tier 1 inherit)
//   3. fallback `defaultProvider` (typically 'claude')
// Throws if the resolved provider is not swarm-capable so the caller
// gets a clear error instead of a silently-broken pane.
export function resolveProvider({ requested, parentPaneId, parentWorkspace, paneRegistry, defaultProvider = 'claude' }) {
  if (requested) {
    if (!isSwarmCapable(requested)) {
      throw new Error(`provider '${requested}' is not swarm-capable`);
    }
    return requested;
  }
  if (parentPaneId && paneRegistry) {
    const rec = paneRegistry.get(parentPaneId);
    if (rec && rec.provider && isSwarmCapable(rec.provider)) return rec.provider;
  }
  if (parentWorkspace && paneRegistry) {
    // Find the most recent user pane in this workspace and inherit from it.
    const userPanes = paneRegistry.list({ workspace: parentWorkspace, ownerType: 'user' });
    if (userPanes.length > 0) {
      const newest = userPanes.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
      if (isSwarmCapable(newest.provider)) return newest.provider;
    }
  }
  return defaultProvider;
}

export const SWARM_CAPABLE_PROVIDERS = Object.values(CATALOG)
  .filter((p) => p.swarmCapable)
  .map((p) => p.id);

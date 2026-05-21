import { paneRegistry as defaultPaneRegistry } from './paneRegistry.js';
import { resolveProvider, checkAvailable } from './providerRegistry.js';

// Build a fresh paneId. ptyManager may also return one — if so we prefer
// whatever ptyManager hands back. This is just a fallback.
function newPaneId() {
  const r = Math.random().toString(36).slice(2, 8);
  return `pane-${Date.now()}-${r}`;
}

function labelFor(rec) {
  if (!rec) return '';
  const ws = rec.workspace || 'workspace';
  const prov = rec.provider || 'shell';
  const sess = rec.sessionName || rec.id;
  let label = `${ws}:${prov}:${sess}`;
  if (rec.teamId) label += `:T${rec.teamId}`;
  if (rec.ownerType === 'agent') {
    // Worker index inference deferred — leave a placeholder slot.
    label += `:W`;
  }
  return label;
}

function liteShape(rec) {
  return {
    id: rec.id,
    label: labelFor(rec),
    ownerType: rec.ownerType,
    teamId: rec.teamId,
    state: rec.state,
    provider: rec.provider,
    sessionName: rec.sessionName,
  };
}

export function buildHandlers({ paneRegistry, ptyManager, spawnHeadlessPane }) {
  const registry = paneRegistry || defaultPaneRegistry;

  function requirePty() {
    if (!ptyManager) throw new Error('ptyManager not wired');
    return ptyManager;
  }

  async function spawn(params) {
    const prompt = params && params.prompt;
    const workspace = params && params.workspace;
    const sessionName = params && params.sessionName;
    const ownerType = params && params.ownerType;
    const teamId = params && params.teamId;
    const spawnedBy = params && params.spawnedBy;

    // Resolve provider: explicit > parent pane > workspace's user pane >
    // 'claude'. Surfaces a clear error if the resolved CLI isn't on PATH.
    const provider = resolveProvider({
      requested: params && params.provider,
      parentPaneId: spawnedBy,
      parentWorkspace: workspace,
      paneRegistry: registry,
      defaultProvider: 'claude',
    });
    const availability = await checkAvailable(provider);
    if (!availability.available) {
      throw new Error(`provider '${provider}' unavailable: ${availability.reason}`);
    }

    // The pty is created by the renderer's TerminalPane after it mounts
    // (so the provider start command — `claude\r`, etc. — fires from the
    // existing IPC path with onData listeners wired correctly). We just
    // register the pane and stash the initial prompt; renderer will write
    // it once the agent is ready.
    const paneId = newPaneId();
    const rec = registry.register(paneId, {
      provider,
      sessionName,
      workspace,
      ownerType,
      teamId,
      spawnedBy,
      // initialPrompt is staged on the record; spawnHeadlessPane reads
      // it lazily inside its delayed write so this order works.
      initialPrompt: typeof prompt === 'string' && prompt.length > 0 ? prompt : null,
    });

    // MVP headless: main owns the pty. No UI tile, no renderer round-trip.
    if (typeof spawnHeadlessPane === 'function') {
      try { spawnHeadlessPane(paneId, { provider }); } catch (err) {
        console.error('[swarm.terminal.spawn] headless spawn failed:', err?.message);
      }
    }

    return {
      terminalId: paneId,
      label: labelFor(rec),
      provider,
    };
  }

  async function list(params) {
    const filter = {};
    if (params) {
      if (params.workspace !== undefined) filter.workspace = params.workspace;
      if (params.ownerType !== undefined) filter.ownerType = params.ownerType;
      if (params.state !== undefined) filter.state = params.state;
      if (params.teamId !== undefined) filter.teamId = params.teamId;
    }
    const rows = registry.list(filter);
    return rows.map(liteShape);
  }

  async function send(params) {
    const pty = requirePty();
    const terminalId = params && params.terminalId;
    const text = params && typeof params.text === 'string' ? params.text : '';
    // Default to submit=true so orchestrator dispatch packets actually
    // execute instead of sitting in the worker's input buffer waiting
    // on a human Enter. Caller can pass `submit: false` for raw text.
    const submit = params && params.submit === false ? false : true;
    await pty.write(terminalId, text);
    if (submit) {
      // Enter as a SEPARATE keystroke after a settle delay — claude CLI
      // bracketed-paste detector otherwise buffers the trailing \r with
      // the paste content and the worker just stares at unsent text.
      await new Promise((r) => setTimeout(r, 350));
      await pty.write(terminalId, '\r');
    }
    return { ok: true };
  }

  async function read(params) {
    const terminalId = params && params.terminalId;
    const rec = registry.get(terminalId);
    if (!rec) throw new Error('unknown terminal');
    const sinceTokenId = params && Number.isFinite(params.sinceTokenId) ? params.sinceTokenId : 0;
    const maxBytes = params && Number.isFinite(params.maxBytes) ? params.maxBytes : 65536;
    const { chunks, tokenId, dropped } = registry.readSince(terminalId, sinceTokenId, maxBytes);
    const current = registry.get(terminalId);
    return {
      chunks: chunks.map(b => b.toString('utf8')),
      tokenId,
      dropped,
      state: current ? current.state : rec.state,
    };
  }

  async function wait(params) {
    const terminalId = params && params.terminalId;
    const untilState = params && params.untilState;
    const timeoutMs = params && Number.isFinite(params.timeoutMs) ? params.timeoutMs : 60000;
    const initial = registry.get(terminalId);
    if (!initial) throw new Error('unknown terminal');
    if (initial.state === untilState) {
      return { state: initial.state, tokenId: initial.tokenSeq || 0, timedOut: false };
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const listener = (evt) => {
        if (settled) return;
        if (!evt || evt.paneId !== terminalId) return;
        if (evt.newState !== untilState) return;
        settled = true;
        if (timer) clearTimeout(timer);
        registry.off('pane:state-change', listener);
        const cur = registry.get(terminalId);
        resolve({ state: untilState, tokenId: cur ? (cur.tokenSeq || 0) : 0, timedOut: false });
      };
      registry.on('pane:state-change', listener);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        registry.off('pane:state-change', listener);
        const cur = registry.get(terminalId);
        resolve({
          state: cur ? cur.state : 'crashed',
          tokenId: cur ? (cur.tokenSeq || 0) : 0,
          timedOut: true,
        });
      }, timeoutMs);
    });
  }

  async function kill(params) {
    const pty = requirePty();
    const terminalId = params && params.terminalId;
    try { await pty.kill(terminalId); } catch (_) { /* still unregister */ }
    registry.unregister(terminalId);
    return { ok: true };
  }

  return {
    'terminal.spawn': spawn,
    'terminal.list': list,
    'terminal.send': send,
    'terminal.read': read,
    'terminal.wait': wait,
    'terminal.kill': kill,
  };
}

export function registerTerminalHandlers(bridge, deps) {
  const handlers = buildHandlers(deps || {});
  if (bridge && typeof bridge.registerMethod === 'function') {
    for (const [name, fn] of Object.entries(handlers)) {
      bridge.registerMethod(name, fn);
    }
  }
  return handlers;
}

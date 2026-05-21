import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ToastContext } from './ToastContext';
import { syncWorkspaceDebounced, deleteWorkspaceSync, setActiveWorkspaceSync } from '../lib/syncService';

// Grid presets ordered by capacity. When a swarm spawn pushes the pane
// count past the current layout's cap, layoutFor() returns the next-up
// preset so all spawned panes are visible without manual layout change.
const LAYOUT_BY_CAPACITY = [
  { id: '1x1', max: 1 },
  { id: '2x1', max: 2 },
  { id: '3x1', max: 3 },
  { id: '2x2', max: 4 },
  { id: '3x2', max: 6 },
  { id: '4x2', max: 8 },
  { id: '3x3', max: 9 },
  { id: '4x4', max: 16 },
];

function layoutFor(count, currentMax) {
  if (count <= currentMax) return null;
  const fit = LAYOUT_BY_CAPACITY.find((l) => l.max >= count);
  return fit ? fit.id : '4x4';
}

function currentLayoutMax(layoutId) {
  const entry = LAYOUT_BY_CAPACITY.find((l) => l.id === layoutId);
  return entry ? entry.max : 2;
}

export const WorkspaceContext = createContext(null);

const api = typeof window !== 'undefined' && window.flowade?.workspace;

function makeDefaultWorkspace(name = 'Default') {
  return {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    createdAt: Date.now(),
    terminals: [],
    layout: '2x1',
    macros: [],
  };
}

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeData, setActiveData] = useState(null);
  const { addToast } = useContext(ToastContext);

  const refresh = useCallback(async () => {
    if (!api) return;
    const list = await api.list();
    setWorkspaces(list);
  }, []);

  useEffect(() => {
    if (!api) {
      const ws = makeDefaultWorkspace();
      setActiveId(ws.id);
      setActiveData(ws);
      setWorkspaces([{ id: ws.id, name: ws.name, createdAt: ws.createdAt, terminalCount: 0 }]);
      return;
    }
    (async () => {
      await refresh();
      const savedId = await api.getActive();
      if (savedId) {
        const data = await api.load(savedId);
        if (data) {
          setActiveId(savedId);
          setActiveData(data);
          return;
        }
      }
      const ws = await api.create('Default');
      setActiveId(ws.id);
      setActiveData(ws);
      await api.setActive(ws.id);
      await refresh();
    })();
  }, [refresh]);

  const createWorkspace = useCallback(async (name) => {
    if (!api) return;
    const ws = await api.create(name);
    await refresh();
    syncWorkspaceDebounced(ws);
    addToast(`Workspace "${name}" created`, 'success');
    return ws;
  }, [refresh, addToast]);

  const switchWorkspace = useCallback(async (id) => {
    if (!api || id === activeId) return;
    if (activeId && activeData) {
      await api.save(activeId, activeData);
    }
    const data = await api.load(id);
    if (data) {
      setActiveId(id);
      setActiveData(data);
      await api.setActive(id);
      setActiveWorkspaceSync(id);
    }
  }, [activeId, activeData]);

  const updateWorkspace = useCallback((updater) => {
    setActiveData((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      if (api && activeId) api.save(activeId, next).catch(() => {});
      syncWorkspaceDebounced({ ...next, isActive: true });
      return next;
    });
  }, [activeId]);

  // Mount swarm-spawned panes (orchestrator + workers) as visible tiles
  // in the active workspace. Main process registers them in paneRegistry
  // and emits `swarm:pane-added`; we upsert into terminals[] and bump the
  // grid layout if the new count exceeds the current preset. Closure on
  // a stale activeId is fine: the subscription tears down on activeId
  // change and we re-attach. `spawnedBy` is carried through so the UI
  // can draw a visual link back to the originating user pane.
  useEffect(() => {
    const swarmApi = typeof window !== 'undefined' ? window.flowade?.swarm : null;
    if (!swarmApi) return;
    const offAdd = swarmApi.onPaneAdded((rec) => {
      if (!rec || !rec.id) return;
      // User panes are already in workspace state (renderer-initiated).
      // Skip them; the upsert below would no-op anyway but the early
      // return saves a setState pass per user-pane mount.
      if (rec.ownerType === 'user') return;
      setActiveData((prev) => {
        if (!prev) return prev;
        if ((prev.terminals || []).some((t) => t.id === rec.id)) return prev;
        const newTerm = {
          id: rec.id,
          sessionName: rec.sessionName || 'Session',
          provider: rec.provider || 'claude',
          ownerType: rec.ownerType,
          teamId: rec.teamId,
          spawnedBy: rec.spawnedBy,
        };
        const terminals = [...(prev.terminals || []), newTerm];
        const nextLayout = layoutFor(terminals.length, currentLayoutMax(prev.layout)) || prev.layout;
        const next = { ...prev, terminals, layout: nextLayout };
        if (api && activeId) api.save(activeId, next).catch(() => {});
        return next;
      });
    });
    const offRm = swarmApi.onPaneRemoved((payload) => {
      const paneId = payload && payload.paneId;
      if (!paneId) return;
      setActiveData((prev) => {
        if (!prev) return prev;
        const terminals = (prev.terminals || []).filter((t) => t.id !== paneId);
        if (terminals.length === (prev.terminals || []).length) return prev;
        const next = { ...prev, terminals };
        if (api && activeId) api.save(activeId, next).catch(() => {});
        return next;
      });
    });
    return () => { offAdd?.(); offRm?.(); };
  }, [activeId]);

  const deleteWorkspace = useCallback(async (id) => {
    if (!api) return;
    await api.delete(id);
    deleteWorkspaceSync(id);
    await refresh();
    if (id === activeId) {
      const list = await api.list();
      if (list.length > 0) {
        await switchWorkspace(list[0].id);
      } else {
        const ws = await api.create('Default');
        setActiveId(ws.id);
        setActiveData(ws);
        await api.setActive(ws.id);
        await refresh();
      }
    }
    addToast('Workspace deleted', 'info');
  }, [activeId, refresh, switchWorkspace, addToast]);

  const renameWorkspace = useCallback(async (id, name) => {
    if (!api) return;
    const data = await api.load(id);
    if (data) {
      await api.save(id, { ...data, name });
      if (id === activeId) setActiveData((prev) => ({ ...prev, name }));
      await refresh();
    }
  }, [activeId, refresh]);

  return (
    <WorkspaceContext.Provider value={{
      workspaces, activeId, activeData,
      createWorkspace, switchWorkspace, updateWorkspace,
      deleteWorkspace, renameWorkspace,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

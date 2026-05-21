const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowade', {
  terminal: {
    spawn: (opts) => ipcRenderer.invoke('terminal:spawn', opts),
    write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.send('terminal:kill', { id }),
    list: () => ipcRenderer.invoke('terminal:list'),
    onData: (callback) => {
      const handler = (_, payload) => callback(payload.id, payload.data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (callback) => {
      const handler = (_, payload) => callback(payload.id, payload.exitCode);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    create: (name) => ipcRenderer.invoke('workspace:create', name),
    load: (id) => ipcRenderer.invoke('workspace:load', id),
    save: (id, data) => ipcRenderer.invoke('workspace:save', { id, data }),
    delete: (id) => ipcRenderer.invoke('workspace:delete', id),
    setActive: (id) => ipcRenderer.invoke('workspace:setActive', id),
    getActive: () => ipcRenderer.invoke('workspace:getActive'),
  },

  session: {
    save: (state) => ipcRenderer.invoke('session:save', state),
    load: () => ipcRenderer.invoke('session:load'),
  },

  auth: {
    setSession: (accessToken, refreshToken) => ipcRenderer.invoke('auth:setSession', { accessToken, refreshToken }),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    getSubscription: () => ipcRenderer.invoke('auth:getSubscription'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onAuthStateChange: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('auth:stateChange', handler);
      return () => ipcRenderer.removeListener('auth:stateChange', handler);
    },
  },

  cost: {
    getUsage: () => ipcRenderer.invoke('cost:getUsage'),
    track: (data) => ipcRenderer.send('cost:track', data),
    getHistory: (range) => ipcRenderer.invoke('cost:getHistory', range),
    getRawHistory: (range) => ipcRenderer.invoke('cost:getRawHistory', range),
    onUpdated: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('usage:updated', handler);
      return () => ipcRenderer.removeListener('usage:updated', handler);
    },
  },

  usage: {
    getStats: () => ipcRenderer.invoke('usage:getStats'),
    getRetention: () => ipcRenderer.invoke('usage:getRetention'),
    setRetention: (days) => ipcRenderer.invoke('usage:setRetention', days),
    prune: () => ipcRenderer.invoke('usage:prune'),
    pruneCursors: () => ipcRenderer.invoke('usage:pruneCursors'),
    getBillingResetDay: () => ipcRenderer.invoke('usage:getBillingResetDay'),
    setBillingResetDay: (day) => ipcRenderer.invoke('usage:setBillingResetDay', day),
  },

  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  },

  env: {
    getAll: () => ipcRenderer.invoke('env:getAll'),
    get: (key) => ipcRenderer.invoke('env:get', key),
    set: (key, value) => ipcRenderer.invoke('env:set', { key, value }),
    setMany: (pairs) => ipcRenderer.invoke('env:setMany', pairs),
    has: (key) => ipcRenderer.invoke('env:has', key),
  },

  history: {
    save: (session) => ipcRenderer.invoke('history:save', session),
    list: () => ipcRenderer.invoke('history:list'),
    load: (id) => ipcRenderer.invoke('history:load', id),
    delete: (id) => ipcRenderer.invoke('history:delete', id),
    export: (id, format) => ipcRenderer.invoke('history:export', { id, format }),
  },

  crash: {
    getLogs: (count) => ipcRenderer.invoke('crash:getLogs', count),
    report: (description) => ipcRenderer.invoke('crash:report', description),
    log: (level, message, meta) => ipcRenderer.invoke('crash:log', { level, message, meta }),
  },

  memory: {
    list: (tag) => ipcRenderer.invoke('memory:list', tag),
    get: (id) => ipcRenderer.invoke('memory:get', id),
    create: (entry) => ipcRenderer.invoke('memory:create', entry),
    update: (id, updates) => ipcRenderer.invoke('memory:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('memory:delete', id),
    search: (query) => ipcRenderer.invoke('memory:search', query),
    getStatus: () => ipcRenderer.invoke('memory:status'),
    syncNow: () => ipcRenderer.invoke('memory:syncNow'),
    realtimeOn: () => ipcRenderer.invoke('memory:realtimeOn'),
    realtimeOff: () => ipcRenderer.invoke('memory:realtimeOff'),
    listDeleted: () => ipcRenderer.invoke('memory:listDeleted'),
    restore: (id) => ipcRenderer.invoke('memory:restore', id),
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('memory:changed', handler);
      return () => ipcRenderer.removeListener('memory:changed', handler);
    },
    onStatus: (callback) => {
      const handler = (_, status) => callback(status);
      ipcRenderer.on('memory:status', handler);
      return () => ipcRenderer.removeListener('memory:status', handler);
    },
    embeddings: {
      backfill: () => ipcRenderer.invoke('memory:embeddings:backfill'),
      search: (query, opts) => ipcRenderer.invoke('memory:embeddings:search', { query, ...(opts || {}) }),
      onProgress: (callback) => {
        const handler = (_, msg) => callback(msg);
        ipcRenderer.on('memory:embeddings:progress', handler);
        return () => ipcRenderer.removeListener('memory:embeddings:progress', handler);
      },
    },
    categories: {
      list: () => ipcRenderer.invoke('memory:categories:list'),
      create: (body) => ipcRenderer.invoke('memory:categories:create', body),
      update: (id, patch) => ipcRenderer.invoke('memory:categories:update', { id, patch }),
      delete: (id) => ipcRenderer.invoke('memory:categories:delete', id),
      assign: (memoryId, categoryId) =>
        ipcRenderer.invoke('memory:categories:assign', { memoryId, categoryId }),
      persistTree: (tree) => ipcRenderer.invoke('memory:categories:persistTree', tree),
      aiCategorize: (opts) => ipcRenderer.invoke('memory:categories:aiCategorize', opts || {}),
      onProgress: (callback) => {
        const handler = (_, msg) => callback(msg);
        ipcRenderer.on('memory:categories:progress', handler);
        return () => ipcRenderer.removeListener('memory:categories:progress', handler);
      },
    },
  },

  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    save: (tasks) => ipcRenderer.invoke('tasks:save', tasks),
  },

  notify: {
    registerToken: (token) => ipcRenderer.invoke('notify:registerToken', token),
    removeToken: (token) => ipcRenderer.invoke('notify:removeToken', token),
    getTokens: () => ipcRenderer.invoke('notify:getTokens'),
    setEnabled: (enabled) => ipcRenderer.invoke('notify:setEnabled', enabled),
    updateTerminalMeta: (id, label, workspace) => ipcRenderer.invoke('notify:updateTerminalMeta', { id, label, workspace }),
    onEvent: (callback) => {
      const handler = (_, event) => callback(event);
      ipcRenderer.on('notify:event', handler);
      return () => ipcRenderer.removeListener('notify:event', handler);
    },
  },

  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    load: (name) => ipcRenderer.invoke('plugins:load', name),
    manifest: (name) => ipcRenderer.invoke('plugins:manifest', name),
    enable: (name) => ipcRenderer.invoke('plugins:enable', name),
    disable: (name) => ipcRenderer.invoke('plugins:disable', name),
    getPath: () => ipcRenderer.invoke('plugins:getPath'),
    openFolder: () => ipcRenderer.invoke('plugins:openFolder'),
  },

  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
    pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
    saveImageTemp: (data) => ipcRenderer.invoke('dialog:saveImageTemp', data),
    takeScreenshot: () => ipcRenderer.invoke('dialog:takeScreenshot'),
  },

  whisper: {
    status: () => ipcRenderer.invoke('whisper:status'),
    transcribe: (wavBase64) => ipcRenderer.invoke('whisper:transcribe', wavBase64),
  },

  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', { cwd }),
    diff: (cwd, file) => ipcRenderer.invoke('git:diff', { cwd, file }),
    branch: (cwd) => ipcRenderer.invoke('git:branch', { cwd }),
  },

  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', { filePath, content }),
    stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  },

  github: {
    user: () => ipcRenderer.invoke('github:user'),
    repos: (opts) => ipcRenderer.invoke('github:repos', opts || {}),
    prs: (opts) => ipcRenderer.invoke('github:prs', opts),
    issues: (opts) => ipcRenderer.invoke('github:issues', opts),
    notifications: () => ipcRenderer.invoke('github:notifications'),
    repoInfo: (opts) => ipcRenderer.invoke('github:repoInfo', opts),
    contents: (opts) => ipcRenderer.invoke('github:contents', opts),
    branches: (opts) => ipcRenderer.invoke('github:branches', opts),
  },

  codeburn: {
    report: (period) => ipcRenderer.invoke('codeburn:report', { period }),
    optimize: () => ipcRenderer.invoke('codeburn:optimize'),
  },

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onChecking: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('update:checking', handler);
      return () => ipcRenderer.removeListener('update:checking', handler);
    },
    onAvailable: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.removeListener('update:available', handler);
    },
    onNotAvailable: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('update:not-available', handler);
      return () => ipcRenderer.removeListener('update:not-available', handler);
    },
    onDownloaded: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.removeListener('update:downloaded', handler);
    },
    onProgress: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    },
    onError: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('update:error', handler);
      return () => ipcRenderer.removeListener('update:error', handler);
    },
  },

  app: {
    onBeforeClose: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('app:beforeClose', handler);
      return () => ipcRenderer.removeListener('app:beforeClose', handler);
    },
  },

  swarm: {
    onPaneAdded: (callback) => {
      const handler = (_, rec) => callback(rec);
      ipcRenderer.on('swarm:pane-added', handler);
      return () => ipcRenderer.removeListener('swarm:pane-added', handler);
    },
    onPaneRemoved: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('swarm:pane-removed', handler);
      return () => ipcRenderer.removeListener('swarm:pane-removed', handler);
    },
    onPaneState: (callback) => {
      const handler = (_, payload) => callback(payload);
      ipcRenderer.on('swarm:pane-state', handler);
      return () => ipcRenderer.removeListener('swarm:pane-state', handler);
    },
    runs: {
      list: () => ipcRenderer.invoke('swarm:listRuns'),
      get: (runId) => ipcRenderer.invoke('swarm:getRun', runId),
      getTranscript: (runId, terminalId) => ipcRenderer.invoke('swarm:getTranscript', { runId, terminalId }),
      replayChannel: (runId, limit) => ipcRenderer.invoke('swarm:replayChannel', { runId, limit }),
      listActive: () => ipcRenderer.invoke('swarm:listActiveRuns'),
    },
    channel: {
      post: (params) => ipcRenderer.invoke('swarm:channel:post', params),
    },
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (cb) => {
      const handler = (_, isMax) => cb(isMax);
      ipcRenderer.on('window:maximizedChanged', handler);
      return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
    },
    popout: (terminalId, bounds) => ipcRenderer.invoke('window:popout', { terminalId, bounds }),
    popoutPanel: (panel, bounds) => ipcRenderer.invoke('window:popoutPanel', { panel, bounds }),
    closePopout: (windowId) => ipcRenderer.invoke('window:closePopout', windowId),
    isPopout: () => new URLSearchParams(window.location.search).has('popout'),
    getPopoutTerminalId: () => new URLSearchParams(window.location.search).get('terminalId'),
    getPopoutPanel: () => new URLSearchParams(window.location.search).get('panel'),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  platform: process.platform,
  version: '0.1.0',
});

import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { FONTS, WORKSPACE_ROOMS } from './lib/constants';
import { PALETTES } from './lib/themes';
import { useTheme } from './hooks/useTheme';
import { ToastProvider } from './contexts/ToastContext';
import { WorkspaceProvider, WorkspaceContext } from './contexts/WorkspaceContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import TerminalGrid from './components/TerminalGrid';
import CommandLibrary from './components/CommandLibrary';
import UsagePanel from './components/UsagePanel';
import SettingsPanel from './components/SettingsPanel';
import FileActivity from './components/FileActivity';
import PromptTemplates from './components/PromptTemplates';
import LoginScreen from './components/LoginScreen';
import OnboardingWizard from './components/OnboardingWizard';
import LoginScreenGlasshouse from './components/glasshouse/LoginScreenGlasshouse';
import OnboardingWizardGlasshouse from './components/glasshouse/OnboardingWizardGlasshouse';
import SideNavGlasshouse from './components/glasshouse/SideNavGlasshouse';
import HeaderGlasshouse from './components/glasshouse/HeaderGlasshouse';
import OverviewGlasshouse from './components/glasshouse/OverviewGlasshouse';
import AppShellGlasshouse from './components/glasshouse/AppShellGlasshouse';
import { isGlasshouseEnabled } from './lib/glasshouseTheme';
import PlanSelector from './components/PlanSelector';
import HelpGuide from './components/HelpGuide';
import FeedbackPanel from './components/FeedbackPanel';
import SessionHistory from './components/SessionHistory';
import SubscriptionPanel from './components/SubscriptionPanel';
import KeybindingsPanel from './components/KeybindingsPanel';
import PluginManagerPanel from './components/PluginManager';
import UpdateNotification from './components/UpdateNotification';
import PopoutTerminal from './components/PopoutTerminal';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import CommandPalette from './components/CommandPalette';
import TaskBoard from './components/TaskBoard';
import MemoryPanel from './components/MemoryPanel';
import GitHubPanel from './components/GitHubPanel';
import SideNav from './components/SideNav';
import BrowserPanel from './components/BrowserPanel';
import CodeEditorPanel from './components/CodeEditorPanel';
import NotificationsPanel from './components/NotificationsPanel';
import ResizeHandle from './components/ResizeHandle';
import SwarmOverlay from './components/glasshouse/SwarmOverlay';
import { isAuthenticated, logout } from './lib/authService';

const RIGHT_PANEL_WIDTH = 280;
const RIGHT_COLLAPSED_WIDTH = 36;

function RightSidebarPanel({ open, onToggle, activeTab, onTabChange, onInsert }) {
  const fc = FONTS.mono;
  const { colors } = useTheme();
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      flexShrink: 0,
      width: open ? RIGHT_PANEL_WIDTH : RIGHT_COLLAPSED_WIDTH,
      transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      overflow: 'hidden',
    }}>
      {/* Panel content */}
      <div className="fc-glass" style={{
        width: RIGHT_PANEL_WIDTH - RIGHT_COLLAPSED_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: colors.bg.glass || colors.bg.raised,
        borderLeft: `1px solid ${colors.border.subtle}`,
        borderRadius: '8px 0 0 8px',
        opacity: open ? 1 : 0,
        transition: 'opacity 0.2s ease',
        overflow: 'hidden',
      }}>
        {/* Tab header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
          <button onClick={() => onTabChange('prompts')} style={{
            all: 'unset', cursor: 'pointer', flex: 1, padding: '9px 0',
            textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 1,
            fontFamily: fc, transition: 'all 0.15s',
            color: activeTab === 'prompts' ? colors.accent.purple : colors.text.dim,
            borderBottom: `2px solid ${activeTab === 'prompts' ? colors.accent.purple : 'transparent'}`,
            background: activeTab === 'prompts' ? colors.accent.purple + '08' : 'transparent',
          }}>PROMPTS</button>
          <button onClick={() => onTabChange('commands')} style={{
            all: 'unset', cursor: 'pointer', flex: 1, padding: '9px 0',
            textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 1,
            fontFamily: fc, transition: 'all 0.15s',
            color: activeTab === 'commands' ? colors.accent.amber : colors.text.dim,
            borderBottom: `2px solid ${activeTab === 'commands' ? colors.accent.amber : 'transparent'}`,
            background: activeTab === 'commands' ? colors.accent.amber + '08' : 'transparent',
          }}>COMMANDS</button>
          <button onClick={onToggle} title="Close panel" style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 4, fontSize: 12, color: colors.text.dim,
            transition: 'all 0.15s', flexShrink: 0, marginRight: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; e.currentTarget.style.color = colors.text.secondary; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.text.dim; }}
          >&#10005;</button>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: activeTab === 'prompts' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <PromptTemplates onInsert={onInsert} />
          </div>
          <div style={{ display: activeTab === 'commands' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <CommandLibrary />
          </div>
        </div>
      </div>

      {/* Collapsed icon strip */}
      <div className="fc-glass" style={{
        width: RIGHT_COLLAPSED_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        gap: 4,
        background: colors.bg.glass || colors.bg.raised,
        borderLeft: `1px solid ${colors.border.subtle}`,
        borderRadius: open ? '0 8px 8px 0' : 8,
      }}>
        <button onClick={() => { if (!open) { onToggle(); onTabChange('prompts'); } else if (activeTab !== 'prompts') { onTabChange('prompts'); } else { onToggle(); } }}
          title="Prompts" style={{
          all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 6,
          background: open && activeTab === 'prompts' ? colors.accent.purple + '18' : 'transparent',
          color: open && activeTab === 'prompts' ? colors.accent.purple : colors.text.dim,
          transition: 'all 0.2s',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </button>
        <button onClick={() => { if (!open) { onToggle(); onTabChange('commands'); } else if (activeTab !== 'commands') { onTabChange('commands'); } else { onToggle(); } }}
          title="Commands" style={{
          all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 6,
          background: open && activeTab === 'commands' ? colors.accent.amber + '18' : 'transparent',
          color: open && activeTab === 'commands' ? colors.accent.amber : colors.text.dim,
          transition: 'all 0.2s',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function AppInner({ onLogout }) {
  const { colors } = useTheme();
  const glass = isGlasshouseEnabled();
  // When the Glasshouse theme is on, swap in the wholesale shell. Classic
  // theme keeps the existing Header + UsagePanel + 44px sidenav layout.
  if (glass) return <AppShellGlasshouse onLogout={onLogout} />;
  const HeaderComponent = Header;
  const SideNavComponent = SideNav;
  // Main content area swaps between 'terminals' (default) and 'overview'.
  // Side panels (memory, code, tasks, github) still render alongside the
  // current main content for terminals; overview renders alone.
  const [mainContent, setMainContent] = useState(() => {
    if (!glass) return 'terminals';
    try {
      return localStorage.getItem('flowade.overview.seen') === '1' ? 'terminals' : 'overview';
    } catch { return 'terminals'; }
  });

  useEffect(() => {
    if (mainContent === 'overview' && glass) {
      try { localStorage.setItem('flowade.overview.seen', '1'); } catch {}
    }
  }, [mainContent, glass]);

  // Persistent layout state
  const loadLayout = () => {
    try {
      const raw = localStorage.getItem('flowade_layout');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const savedLayout = useMemo(() => loadLayout(), []);

  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  const [dangerFlags, setDangerFlags] = useState({ global: false, perTerminal: {} });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeLeftPanel, setActiveLeftPanel] = useState(savedLayout.activeLeftPanel ?? null);
  const [rightPanelOpen, setRightPanelOpen] = useState(savedLayout.rightPanelOpen ?? false);
  const [browserOpen, setBrowserOpen] = useState(savedLayout.browserOpen ?? false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(savedLayout.leftPanelWidth ?? null);
  const [browserWidth, setBrowserWidth] = useState(savedLayout.browserWidth ?? null);
  const [rightTab, setRightTab] = useState(savedLayout.rightTab ?? 'prompts');
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [swarmOverlayOpen, setSwarmOverlayOpen] = useState(false);
  const [swarmRuns, setSwarmRuns] = useState([]);
  const { setPalette, paletteName } = useTheme();
  const { activeData } = useContext(WorkspaceContext);

  const focusedCwd = useMemo(() => {
    const terms = activeData?.terminals || [];
    return terms[0]?.cwd || null;
  }, [activeData]);

  const toggleDanger = useCallback((terminalId) => {
    setDangerFlags((prev) => ({
      ...prev,
      perTerminal: {
        ...prev.perTerminal,
        [terminalId]: !prev.perTerminal[terminalId],
      },
    }));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('flowade_layout', JSON.stringify({
        activeLeftPanel, leftPanelWidth, browserOpen, browserWidth, rightPanelOpen, rightTab,
      }));
    }, 300);
    return () => clearTimeout(timer);
  }, [activeLeftPanel, leftPanelWidth, browserOpen, browserWidth, rightPanelOpen, rightTab]);

  const shortcutActions = useMemo(() => ({
    addTerminal: () => window.dispatchEvent(new Event('flowade:addTerminal')),
    closeTerminal: () => window.dispatchEvent(new Event('flowade:closeTerminal')),
    setLayout: (id) => window.dispatchEvent(new CustomEvent('flowade:setLayout', { detail: id })),
    toggleDanger: () => setDangerFlags((prev) => ({ ...prev, global: !prev.global })),
    cycleFocus: () => window.dispatchEvent(new Event('flowade:cycleFocus')),
    openSettings: () => setSettingsOpen(true),
    commandPalette: () => setCmdPaletteOpen((o) => !o),
    toggleSidebar: () => setActiveLeftPanel((p) => p ? null : 'tasks'),
    toggleBrowser: () => setBrowserOpen((o) => !o),
    toggleCode: () => setActiveLeftPanel((p) => p === 'code' ? null : 'code'),
    toggleVoice: () => window.dispatchEvent(new Event('flowade:toggleVoice')),
  }), []);

  useKeyboardShortcuts(shortcutActions);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen((o) => !o);
      }
      // Ctrl+Shift+S (or Cmd+Shift+S) — toggle the swarm view. Cmd+K is
      // already the command palette; the swarm overlay gets its own
      // chord so both stay reachable.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        setSwarmOverlayOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const cmdActions = useMemo(() => {
    const actions = [
      { id: 'add-terminal', label: 'New Terminal', category: 'Terminals', shortcut: 'Ctrl+T', onAction: () => window.dispatchEvent(new Event('flowade:addTerminal')) },
      { id: 'close-terminal', label: 'Close Terminal', category: 'Terminals', shortcut: 'Ctrl+W', onAction: () => window.dispatchEvent(new Event('flowade:closeTerminal')) },
      { id: 'cycle-focus', label: 'Cycle Focus', category: 'Terminals', shortcut: 'Ctrl+Tab', onAction: () => window.dispatchEvent(new Event('flowade:cycleFocus')) },
      { id: 'settings', label: 'Open Settings', category: 'Navigation', shortcut: 'Ctrl+,', onAction: () => setSettingsOpen(true) },
      { id: 'swarm-view', label: 'Open Swarm View', category: 'Navigation', shortcut: 'Ctrl+Shift+S', onAction: () => setSwarmOverlayOpen(true) },
      { id: 'analytics', label: 'Reports & Analytics', category: 'Navigation', onAction: () => setAnalyticsOpen(true) },
      { id: 'help', label: 'Help Guide', category: 'Navigation', onAction: () => setHelpOpen(true) },
      { id: 'history', label: 'Session History', category: 'Navigation', onAction: () => setHistoryOpen(true) },
      { id: 'keybindings', label: 'Keyboard Shortcuts', category: 'Navigation', onAction: () => setKeybindingsOpen(true) },
      { id: 'plugins', label: 'Plugins', category: 'Navigation', onAction: () => setPluginsOpen(true) },
      { id: 'prompts', label: 'Prompt Templates', category: 'Panels', onAction: () => { setRightPanelOpen(true); setRightTab('prompts'); } },
      { id: 'commands', label: 'Command Library', category: 'Panels', onAction: () => { setRightPanelOpen(true); setRightTab('commands'); } },
      { id: 'git', label: 'Toggle Git Panel', category: 'Panels', onAction: () => setActiveLeftPanel(p => p === 'git' ? null : 'git') },
      { id: 'tasks', label: 'Toggle Task Board', category: 'Panels', onAction: () => setActiveLeftPanel(p => p === 'tasks' ? null : 'tasks') },
      { id: 'memory', label: 'Toggle Memory Panel', category: 'Panels', onAction: () => setActiveLeftPanel(p => p === 'memory' ? null : 'memory') },
      { id: 'github', label: 'Toggle GitHub Panel', category: 'Panels', onAction: () => setActiveLeftPanel(p => p === 'github' ? null : 'github') },
      { id: 'code', label: 'Toggle Code Editor', category: 'Panels', onAction: () => setActiveLeftPanel(p => p === 'code' ? null : 'code') },
      { id: 'browser', label: 'Toggle Browser', category: 'Panels', onAction: () => setBrowserOpen(o => !o) },
      { id: 'notifications', label: 'Open Notifications', category: 'Navigation', onAction: () => setNotificationsOpen(true) },
      { id: 'danger-toggle', label: 'Toggle Danger Mode', category: 'Mode', onAction: () => setDangerFlags((prev) => ({ ...prev, global: !prev.global })) },
    ];

    // Layout actions
    const LAYOUTS = [
      { id: '1x1', label: '1' }, { id: '2x1', label: '2' }, { id: '1x2', label: '1x2' },
      { id: '3x1', label: '3' }, { id: '2x2', label: '2x2' }, { id: '3x2', label: '3x2' },
      { id: '4x2', label: '4x2' }, { id: '3x3', label: '3x3' }, { id: '4x4', label: '4x4' },
    ];
    LAYOUTS.forEach((l) => {
      actions.push({ id: `layout-${l.id}`, label: `Layout: ${l.label}`, category: 'Layout', onAction: () => window.dispatchEvent(new CustomEvent('flowade:setLayout', { detail: l.id })) });
    });

    // Room actions
    WORKSPACE_ROOMS.forEach((room) => {
      actions.push({ id: `room-${room.id}`, label: `Room: ${room.name}`, category: 'Rooms', onAction: () => window.dispatchEvent(new CustomEvent('flowade:applyRoom', { detail: room })) });
    });

    // Palette actions
    Object.keys(PALETTES).forEach((name) => {
      actions.push({ id: `palette-${name}`, label: `Theme: ${name.charAt(0).toUpperCase() + name.slice(1)}`, category: 'Themes', onAction: () => setPalette(name) });
    });

    return actions;
  }, [setPalette]);

  const handleInsertSnippet = useCallback((text) => {
    window.dispatchEvent(new CustomEvent('flowade:insertSnippet', { detail: text }));
  }, []);

  useEffect(() => {
    const handler = () => setBrowserOpen(true);
    window.addEventListener('flowade:openInBrowser', handler);
    return () => window.removeEventListener('flowade:openInBrowser', handler);
  }, []);

  return (
    <div style={{
      fontFamily: FONTS.body,
      background: colors.bg.base,
      color: colors.text.primary,
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
    }}>
        {/* Gradient mesh background */}
        {colors.gradient?.mesh && colors.gradient.mesh !== 'none' && (
          <div className="fc-mesh-bg" style={{ backgroundImage: colors.gradient.mesh }} />
        )}

        <UpdateNotification />
        <HeaderComponent
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenSubscription={() => setSubscriptionOpen(true)}
          onOpenKeybindings={() => setKeybindingsOpen(true)}
          onOpenPlugins={() => setPluginsOpen(true)}
          onOpenAnalytics={() => setAnalyticsOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onOpenPrompts={() => { setRightPanelOpen(true); setRightTab('prompts'); }}
          onOpenCommands={() => { setRightPanelOpen(true); setRightTab('commands'); }}
        />

        <div style={{
          flex: 1, padding: '6px 10px', display: 'flex', flexDirection: 'column',
          gap: 4, overflow: 'hidden', minHeight: 0, position: 'relative', zIndex: 1,
        }}>
          <ErrorBoundary name="Usage Panel">
            <UsagePanel />
          </ErrorBoundary>

          <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <SideNavComponent
              activePanel={
                mainContent === 'overview' ? 'overview' :
                mainContent === 'memory'   ? 'memory'   :
                mainContent === 'terminals' && !activeLeftPanel ? 'terminals' :
                activeLeftPanel
              }
              onSelect={(id) => {
                if (id === 'settings') { setSettingsOpen(true); return; }
                if (id === 'overview') {
                  setMainContent('overview');
                  setActiveLeftPanel(null);
                  return;
                }
                if (id === 'terminals') {
                  setMainContent('terminals');
                  setActiveLeftPanel(null);
                  return;
                }
                // Glasshouse: Memory is a main view (replaces terminals).
                if (id === 'memory' && glass) {
                  setMainContent('memory');
                  setActiveLeftPanel(null);
                  return;
                }
                // Classic Memory + every other panel = inline left panel
                // alongside terminal grid.
                setMainContent('terminals');
                setActiveLeftPanel(id);
                setLeftPanelWidth(null);
              }}
            />

            {mainContent === 'overview' && glass ? (
              <OverviewGlasshouse
                userName={(() => { try { return JSON.parse(localStorage.getItem('flowade_auth_user') || '{}').name?.split(' ')[0] || 'there'; } catch { return 'there'; } })()}
                onJump={(id) => {
                  if (id === 'memory') { setMainContent('memory'); setActiveLeftPanel(null); return; }
                  setMainContent('terminals');
                  setActiveLeftPanel(id);
                }}
              />
            ) : <></>}

            {mainContent === 'memory' && glass && (
              <MemoryPanel
                open={true}
                embedded={true}
                onToggle={() => setMainContent('terminals')}
              />
            )}

            {mainContent !== 'overview' && activeLeftPanel && activeLeftPanel !== 'memory' && (<>
              <div style={{
                width: leftPanelWidth || (activeLeftPanel === 'code' ? 500 : 280),
                minWidth: activeLeftPanel === 'code' ? 300 : 220,
                maxWidth: activeLeftPanel === 'code' ? 900 : 500,
                display: 'flex', flexDirection: 'column',
                background: colors.bg.glass || colors.bg.raised,
                borderRight: `1px solid ${colors.border.subtle}`,
                borderRadius: '0 10px 10px 0',
                overflow: 'hidden',
              }} className="fc-glass">
                <ErrorBoundary name="Left Panel">
                  {activeLeftPanel === 'tasks' && (
                    <TaskBoard open={true} onToggle={() => setActiveLeftPanel(null)} />
                  )}
                  {activeLeftPanel === 'memory' && null}
                  {activeLeftPanel === 'github' && (
                    <GitHubPanel open={true} onToggle={() => setActiveLeftPanel(null)} />
                  )}
                  {activeLeftPanel === 'code' && (
                    <CodeEditorPanel open={true} onToggle={() => setActiveLeftPanel(null)} />
                  )}
                </ErrorBoundary>
              </div>
              <ResizeHandle direction="vertical" onResize={(delta) => {
                setLeftPanelWidth(w => {
                  const current = w || (activeLeftPanel === 'code' ? 500 : 280);
                  const min = activeLeftPanel === 'code' ? 300 : 220;
                  const max = activeLeftPanel === 'code' ? 900 : 500;
                  return Math.max(min, Math.min(max, current + delta));
                });
              }} />
            </>)}

            {mainContent !== 'overview' && mainContent !== 'memory' && (
              <div style={{ flex: 1, minWidth: 200, padding: '0 6px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <ErrorBoundary name="Terminal Grid">
                  <TerminalGrid
                    dangerFlags={dangerFlags}
                    onToggleDanger={toggleDanger}
                  />
                </ErrorBoundary>
              </div>
            )}

            {browserOpen && (
              <ResizeHandle direction="vertical" onResize={(delta) => {
                setBrowserWidth(w => {
                  const current = w || 500;
                  return Math.max(300, Math.min(900, current - delta));
                });
              }} />
            )}
            <ErrorBoundary name="Browser Panel">
              <BrowserPanel
                open={browserOpen}
                onToggle={() => setBrowserOpen(o => !o)}
                width={browserWidth}
              />
            </ErrorBoundary>

            <ErrorBoundary name="Right Sidebar">
              <RightSidebarPanel
                open={rightPanelOpen}
                onToggle={() => setRightPanelOpen((o) => !o)}
                activeTab={rightTab}
                onTabChange={setRightTab}
                onInsert={handleInsertSnippet}
              />
            </ErrorBoundary>
          </div>

        </div>

        <footer className="fc-glass" style={{
          padding: '2px 16px', borderTop: `1px solid ${colors.border.subtle}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 9, color: colors.text.ghost, fontFamily: FONTS.mono,
          background: colors.bg.glass || colors.bg.surface, flexShrink: 0,
          position: 'relative', zIndex: 1, gap: 16, height: 22,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>FlowADE v0.1.0</span>
            {focusedCwd && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.text.dim }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {focusedCwd.split(/[/\\]/).slice(-2).join('/')}
                </span>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {paletteName && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent.primary }} />
                {paletteName.charAt(0).toUpperCase() + paletteName.slice(1)}
              </span>
            )}
            <span style={{ cursor: 'pointer' }} onClick={() => setCmdPaletteOpen(true)} title="Command Palette (Ctrl+K)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
            </span>
            <span style={{ letterSpacing: 0.5 }}>DutchMade Co.</span>
          </div>
        </footer>

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onLogout={onLogout} />
        <HelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />
        <FeedbackPanel open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        <SessionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
        <SubscriptionPanel open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} />
        <KeybindingsPanel open={keybindingsOpen} onClose={() => setKeybindingsOpen(false)} />
        <PluginManagerPanel open={pluginsOpen} onClose={() => setPluginsOpen(false)} />
        <AnalyticsDashboard open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />
        <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
        <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} actions={cmdActions} />
        <MemoryPanel open={activeLeftPanel === 'memory'} onToggle={() => setActiveLeftPanel(null)} />
        <SwarmOverlay open={swarmOverlayOpen} onClose={() => setSwarmOverlayOpen(false)} runs={swarmRuns} />
    </div>
  );
}

function AuthGate() {
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem('flowade_onboarding_complete') === 'true'
  );
  const [planSelected, setPlanSelected] = useState(
    () => localStorage.getItem('flowade_plan_selected') === 'true'
  );
  // Glasshouse-only: signup intent toggles the wizard before the user is
  // authenticated. The wizard's first step actually creates the account.
  const [signingUp, setSigningUp] = useState(false);
  const glasshouse = isGlasshouseEnabled();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fresh') === '1') {
      localStorage.removeItem('flowade_auth_token');
      localStorage.removeItem('flowade_auth_user');
      sessionStorage.removeItem('flowade_auth_token');
      sessionStorage.removeItem('flowade_auth_user');
      localStorage.removeItem('flowade_onboarding_complete');
      localStorage.removeItem('flowade_plan_selected');
      setOnboarded(false);
      setPlanSelected(false);
    }

    isAuthenticated().then((result) => {
      setAuthed(result);
      setAuthChecked(true);
    });
  }, []);

  const finishOnboarding = () => {
    localStorage.setItem('flowade_onboarding_complete', 'true');
    localStorage.setItem('flowade_plan_selected', 'true');
    setOnboarded(true);
    setPlanSelected(true);
  };

  if (!authChecked) return null;

  // ---- Glasshouse path ----
  if (glasshouse) {
    if (!authed && !signingUp) {
      return (
        <LoginScreenGlasshouse
          onAuthenticated={() => setAuthed(true)}
          onStartSignup={() => setSigningUp(true)}
        />
      );
    }
    if (!authed && signingUp) {
      // Wizard step 01 will call signup(); when it succeeds, mark authed.
      return (
        <OnboardingWizardGlasshouse
          startStep="signup"
          onAuthenticated={() => setAuthed(true)}
          onComplete={finishOnboarding}
          onBackToLogin={() => setSigningUp(false)}
        />
      );
    }
    // Authenticated but onboarding not yet complete — re-enter wizard at
    // payment step (account already exists).
    if (authed && !(onboarded && planSelected)) {
      return (
        <OnboardingWizardGlasshouse
          startStep="payment"
          onAuthenticated={() => {}}
          onComplete={finishOnboarding}
          onBackToLogin={() => { logout(); setAuthed(false); }}
        />
      );
    }
    // Onboarded — fall through to the regular app shell below.
  }

  // ---- Classic path (legacy) ----
  if (!authed) {
    return <LoginScreen onAuthenticated={() => setAuthed(true)} />;
  }

  return (
    <SettingsProvider>
      <ThemeProvider>
        <ToastProvider>
          <WorkspaceProvider>
            {!onboarded ? (
              <OnboardingWizard onComplete={() => setOnboarded(true)} />
            ) : !planSelected ? (
              <PlanSelector onComplete={() => setPlanSelected(true)} />
            ) : (
              <AppInner onLogout={() => { logout(); setAuthed(false); }} />
            )}
          </WorkspaceProvider>
        </ToastProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}

function PopoutPanel() {
  const panel = window.flowade?.window?.getPopoutPanel?.();

  return (
    <SettingsProvider>
      <ThemeProvider>
        <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ height: 38, WebkitAppRegion: 'drag', flexShrink: 0 }} />
          {panel === 'code' && <CodeEditorPanel open={true} onToggle={() => window.close()} />}
          {panel === 'browser' && <BrowserPanel open={true} onToggle={() => window.close()} />}
        </div>
      </ThemeProvider>
    </SettingsProvider>
  );
}

export default function App() {
  if (window.flowade?.window?.isPopout?.()) {
    const panel = window.flowade?.window?.getPopoutPanel?.();
    if (panel) return <PopoutPanel />;
    return <PopoutTerminal />;
  }

  return <AuthGate />;
}

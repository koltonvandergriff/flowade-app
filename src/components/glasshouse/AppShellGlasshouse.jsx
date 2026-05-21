// Glasshouse app shell — wholesale replacement for the classic AppInner layout.
//
// Layout matches flowADE-mockups/refined-current/index.html:
//   - 220px sidebar (SideNavGlasshouse) with brand header + sectioned nav +
//     user footer
//   - Slim topbar with breadcrumbs left + Trial/Sync pills right
//   - Main content area swaps based on the selected sidebar item, reusing
//     existing panels (TerminalGrid, MemoryPanel, TaskBoard) so behavior
//     stays identical to classic
//
// Settings + Pricing remain overlay panels (existing components).

import { useState, useEffect, useCallback } from 'react';
import ErrorBoundary from '../ErrorBoundary';
import SettingsPanel from '../SettingsPanel';
import SubscriptionPanel from '../SubscriptionPanel';
import HelpGuide from '../HelpGuide';
import FeedbackPanel from '../FeedbackPanel';
import SessionHistory from '../SessionHistory';
import KeybindingsPanel from '../KeybindingsPanel';
import PluginManagerPanel from '../PluginManager';
import AnalyticsDashboard from '../AnalyticsDashboard';
import NotificationsPanel from '../NotificationsPanel';
import CommandPalette from '../CommandPalette';
import UpdateNotification from '../UpdateNotification';
import NotificationCenter from './NotificationCenter';
import SideNavGlasshouse from './SideNavGlasshouse';
import WindowControls from '../WindowControls';
import OverviewGlasshouse from './OverviewGlasshouse';
import PricingGlasshouse from './PricingGlasshouse';
import SettingsGlasshouse from './SettingsGlasshouse';
import AIChatGlasshouse from './AIChatGlasshouse';
import TerminalsGlasshouse from './TerminalsGlasshouse';
import TasksGlasshouse from './TasksGlasshouse';
import MemoryGlasshouse from './MemoryGlasshouse';

const FONT_DISP = 'var(--gh-font-display, "Outfit", sans-serif)';
const FONT_TECH = 'var(--gh-font-techno, "Chakra Petch", sans-serif)';
const FONT_MONO = 'var(--gh-font-mono, "JetBrains Mono", monospace)';

const PAGE_LABELS = {
  overview: 'Overview',
  terminals: 'Terminals',
  chat: 'AI Chat',
  tasks: 'Tasks',
  memory: 'Memory',
  settings: 'Settings',
  pricing: 'Pricing',
};

export default function AppShellGlasshouse({ onLogout }) {
  // Default landing: Overview on first launch, then last picked.
  const [page, setPage] = useState(() => {
    try {
      const seen = localStorage.getItem('flowade.overview.seen') === '1';
      const last = localStorage.getItem('flowade.glass.page');
      return seen && last ? last : 'overview';
    } catch { return 'overview'; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('flowade.glass.page', page);
      if (page === 'overview') localStorage.setItem('flowade.overview.seen', '1');
    } catch {}
  }, [page]);

  // Overlay panels — opened from sidebar (settings/pricing) or cmd palette.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  // Pull cached auth user once for sidebar avatar + greeting.
  const [authUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('flowade_auth_user') || '{}'); } catch { return {}; }
  });
  const userFirstName = authUser?.name?.split(' ')?.[0] || (authUser?.email?.split('@')?.[0]) || 'there';

  // Danger flags — global and per-terminal. Mirrors the state managed by
  // the classic AppInner so the shell-level pane menus actually toggle.
  const [dangerFlags, setDangerFlags] = useState({ global: false, perTerminal: {} });
  const toggleDanger = useCallback((terminalId) => {
    setDangerFlags(prev => {
      if (!terminalId) return { ...prev, global: !prev.global };
      const next = { ...prev.perTerminal };
      if (next[terminalId]) delete next[terminalId];
      else next[terminalId] = true;
      return { ...prev, perTerminal: next };
    });
  }, []);

  const handleNav = useCallback((id) => {
    // Settings and Pricing are inline pages now (not modal overlays).
    setPage(id);
  }, []);

  // Cmd palette actions — minimal subset since most live elsewhere.
  const cmdActions = [
    { id: 'go-overview',  label: 'Go: Overview',  category: 'Navigation', onAction: () => setPage('overview') },
    { id: 'go-terminals', label: 'Go: Terminals', category: 'Navigation', onAction: () => setPage('terminals') },
    { id: 'go-tasks',     label: 'Go: Tasks',     category: 'Navigation', onAction: () => setPage('tasks') },
    { id: 'go-memory',    label: 'Go: Memory',    category: 'Navigation', onAction: () => setPage('memory') },
    { id: 'open-settings', label: 'Open Settings', category: 'Panels', onAction: () => setSettingsOpen(true) },
    { id: 'open-billing',  label: 'Open Pricing',  category: 'Panels', onAction: () => setSubscriptionOpen(true) },
    { id: 'open-help',     label: 'Help',          category: 'Panels', onAction: () => setHelpOpen(true) },
    { id: 'logout',        label: 'Sign out',      category: 'Account', onAction: onLogout },
  ];

  const isElectron = !!window.flowade?.window;

  return (
    <div style={shell.root}>
      <SideNavGlasshouse
        activePanel={page}
        onSelect={handleNav}
        user={authUser}
        onLogout={onLogout}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenCommandPalette={() => setCmdPaletteOpen(true)}
      />

      <main style={shell.main}>
        <Topbar pageId={page} isElectron={isElectron} />

        <div style={shell.content}>
          <ErrorBoundary name={`Glasshouse Page · ${page}`}>
            {page === 'overview' && (
              <OverviewGlasshouse userName={userFirstName} onJump={(id) => setPage(id)} />
            )}
            {page === 'terminals' && (
              <TerminalsGlasshouse dangerFlags={dangerFlags} onToggleDanger={toggleDanger} />
            )}
            {page === 'chat' && <AIChatGlasshouse />}
            {page === 'tasks' && <TasksGlasshouse onClose={() => setPage('overview')} />}
            {page === 'memory' && <MemoryGlasshouse onClose={() => setPage('overview')} />}
            {page === 'settings' && <SettingsGlasshouse onLogout={onLogout} />}
            {page === 'pricing'  && <PricingGlasshouse />}
          </ErrorBoundary>
        </div>
      </main>

      <UpdateNotification />
      <NotificationCenter />

      {/* Overlays — same components used by the classic shell */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onLogout={onLogout} />
      <SubscriptionPanel open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} />
      <HelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />
      <FeedbackPanel open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <SessionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <KeybindingsPanel open={keybindingsOpen} onClose={() => setKeybindingsOpen(false)} />
      <PluginManagerPanel open={pluginsOpen} onClose={() => setPluginsOpen(false)} />
      <AnalyticsDashboard open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />
      <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} actions={cmdActions} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topbar — slim crumb bar + sync pill + window controls. Search and
// notifications were pulled out of the topbar so the standard Windows
// minimize/maximize/close cluster can own the top-right corner without
// neighbours. Search now lives behind the Cmd+K palette; notifications
// moved to a bell button in the sidebar above the user pill.
// ---------------------------------------------------------------------------
function Topbar({ pageId, isElectron }) {
  return (
    <div style={top.bar}>
      <div style={top.crumbs}>
        <span>Workspace</span>
        <span style={{ color: '#4a5168' }}>›</span>
        <span style={{ color: '#f1f5f9' }}>{PAGE_LABELS[pageId] || pageId}</span>
      </div>
      <div style={top.right}>
        <span style={{ ...top.pill, ...top.pillCy }}>
          <span style={{ ...top.dot, background: '#4de6f0' }} /> Synced · 405 memories
        </span>
        {isElectron && (
          <>
            <span style={top.sep} aria-hidden />
            <div style={top.winControls}>
              <WindowControls colors={{
                text: { dim: '#94a3b8', primary: '#e6edf7' },
                bg: { overlay: 'rgba(255,255,255,0.06)', glass: '#0a0e1c', surface: '#0a0e1c' },
              }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ComingSoon({ title, subtitle }) {
  return (
    <div style={cs.root}>
      <div style={cs.card}>
        <div style={cs.stamp}>coming soon</div>
        <h2 style={cs.h}>{title}</h2>
        <p style={cs.b}>{subtitle}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const shell = {
  root: {
    display: 'grid', gridTemplateColumns: '220px 1fr',
    width: '100vw', height: '100vh',
    fontFamily: FONT_MONO, color: '#f1f5f9',
    background: 'transparent',
    // Hard-clip at the shell so a tall/wide inline page (Settings →
    // Keybindings list, Memory toggles, etc) can't push the body
    // larger than the viewport and scroll the whole layout — which
    // would lift the sidebar's user pill off-screen.
    overflow: 'hidden',
    // No drag at root — children would inherit and break clicks. Drag region
    // is scoped to the topbar background below.
    WebkitAppRegion: 'no-drag',
  },
  main: {
    display: 'flex', flexDirection: 'column',
    minWidth: 0, minHeight: 0,
    overflow: 'hidden',
  },
  content: {
    flex: 1, display: 'flex', minHeight: 0,
    overflow: 'hidden',
  },
};

const top = {
  bar: {
    display: 'flex', alignItems: 'center', gap: 16,
    // Right padding is 0 so the window controls can hit the corner the
    // way Windows users expect; left padding compensates for the lost
    // breathing room on the crumbs side.
    padding: '12px 0 12px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(8,8,18,0.4)',
    backdropFilter: 'blur(10px)',
    flexShrink: 0,
    // Drag region lives only on the topbar — interactive children below
    // override with no-drag so clicks still register.
    WebkitAppRegion: 'drag',
  },
  crumbs: {
    fontFamily: FONT_MONO, fontSize: 11,
    color: '#94a3b8', display: 'flex', gap: 8, alignItems: 'center',
    WebkitAppRegion: 'no-drag',
  },
  right: { marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', WebkitAppRegion: 'no-drag', height: '100%' },
  sep: {
    width: 1, height: 20, marginLeft: 4, marginRight: 0,
    background: 'rgba(255,255,255,0.08)',
  },
  winControls: {
    // Pull the cluster flush to the window edge. The topbar already
    // dropped its right padding to 0 for this reason.
    display: 'flex', alignItems: 'stretch', height: '100%',
  },
  pill: {
    fontSize: 10, padding: '4px 10px', borderRadius: 99,
    border: '1px solid rgba(255,255,255,0.13)', color: '#94a3b8',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: FONT_MONO,
  },
  pillCy: {
    color: '#4de6f0', borderColor: 'rgba(77,230,240,0.3)',
    background: 'rgba(77,230,240,0.06)',
  },
  dot: { width: 6, height: 6, borderRadius: '50%', boxShadow: '0 0 6px currentColor' },
};

const cs = {
  root: { flex: 1, display: 'grid', placeItems: 'center', padding: 32 },
  card: {
    maxWidth: 480, padding: 36, textAlign: 'center',
    background: 'rgba(10,14,24,0.55)',
    border: '1px solid rgba(77,230,240,0.07)',
    borderRadius: 14, backdropFilter: 'blur(14px)',
  },
  stamp: {
    display: 'inline-block', marginBottom: 18,
    fontFamily: FONT_TECH, fontSize: 10, letterSpacing: '0.32em',
    textTransform: 'uppercase', color: '#4de6f0',
    padding: '5px 12px',
    border: '1px solid rgba(77,230,240,0.35)',
    background: 'rgba(77,230,240,0.05)',
  },
  h: {
    fontFamily: FONT_DISP, fontWeight: 800,
    fontSize: 32, letterSpacing: '-0.02em', margin: '0 0 8px',
  },
  b: { fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.55 },
};

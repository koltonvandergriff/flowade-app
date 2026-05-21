// Glasshouse-themed Header. Same callback API as Header.jsx; same dropdown
// menu items and workspace switcher mounted inline. Visual changes only:
//   - FA monogram + "FlowADE" techno wordmark left
//   - Glassy translucent bar with cyan inner edge
//   - Cyan-glow accent on hover/active
//   - Same Electron window controls + version tag
import { useState, useRef, useEffect } from 'react';
import WorkspaceSwitcher from '../WorkspaceSwitcher';
import WindowControls from '../WindowControls';
import logoFa from '../../assets/branding/logo-fa.png';

const fontMono = 'var(--gh-font-mono, "JetBrains Mono", monospace)';
const fontTechno = 'var(--gh-font-techno, "Chakra Petch", sans-serif)';

function MenuDivider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 8px' }} />;
}

function MenuItem({ icon, label, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', fontSize: 12,
        fontFamily: fontMono,
        color: '#94a3b8',
        transition: 'background 0.12s, color 0.12s',
        width: '100%', boxSizing: 'border-box', borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(77,230,240,0.08)';
        e.currentTarget.style.color = accent || '#f1f5f9';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = '#94a3b8';
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flexShrink: 0 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default function HeaderGlasshouse({
  onOpenSettings, onOpenHelp, onOpenFeedback, onOpenHistory,
  onOpenSubscription, onOpenKeybindings, onOpenPlugins, onOpenAnalytics,
  onOpenNotifications, onOpenPrompts, onOpenCommands,
}) {
  const isElectron = !!window.flowade?.window;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const handleMenuItem = (fn) => { setMenuOpen(false); fn?.(); };

  const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: '#4a5168', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const menuIconProps = { ...iconProps, stroke: 'currentColor', width: 15, height: 15 };

  const btnStyle = {
    all: 'unset', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 6,
    transition: 'all 0.15s',
  };

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(77,230,240,0.07)',
        background: 'rgba(8, 8, 18, 0.55)',
        backdropFilter: 'blur(14px) saturate(1.1)',
        boxShadow: 'inset 0 -1px 0 rgba(77,230,240,0.04)',
        position: 'sticky', top: 0, zIndex: 10,
        WebkitAppRegion: 'drag',
      }}
    >
      {/* Brand left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' }}>
        <img
          src={logoFa}
          alt="FA"
          style={{
            width: 28, height: 28, objectFit: 'contain',
            filter: 'drop-shadow(0 0 10px rgba(77,230,240,0.4))',
          }}
        />
        <div style={{
          fontFamily: fontTechno,
          fontWeight: 600, fontSize: 13, letterSpacing: '0.18em',
          color: '#f1f5f9', textTransform: 'uppercase',
        }}>
          FlowADE
        </div>
      </div>

      {/* Center: Workspace Switcher (existing component) */}
      <div style={{ WebkitAppRegion: 'no-drag' }}>
        <WorkspaceSwitcher />
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' }}>
        {/* Menu button */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              ...btnStyle,
              background: menuOpen ? 'rgba(77,230,240,0.12)' : 'transparent',
              color: menuOpen ? '#4de6f0' : '#94a3b8',
            }}
            title="Menu"
            onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6,
              width: 220,
              background: 'rgba(10, 14, 24, 0.96)',
              border: '1px solid rgba(77,230,240,0.15)',
              borderRadius: 10, padding: '6px 4px',
              backdropFilter: 'blur(20px) saturate(1.2)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(77,230,240,0.04)',
              zIndex: 50,
            }}>
              <MenuItem label="Help" onClick={() => handleMenuItem(onOpenHelp)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>} />
              <MenuItem label="Session History" onClick={() => handleMenuItem(onOpenHistory)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
              <MenuItem label="Reports & Analytics" accent="#4de6f0" onClick={() => handleMenuItem(onOpenAnalytics)}
                icon={<svg {...menuIconProps}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>} />
              <MenuItem label="Prompt Templates" onClick={() => handleMenuItem(onOpenPrompts)}
                icon={<svg {...menuIconProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>} />
              <MenuItem label="Command Library" onClick={() => handleMenuItem(onOpenCommands)}
                icon={<svg {...menuIconProps}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>} />

              <MenuDivider />

              <MenuItem label="Notifications & Devices" onClick={() => handleMenuItem(onOpenNotifications)}
                icon={<svg {...menuIconProps}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>} />
              <MenuItem label="Plugins" onClick={() => handleMenuItem(onOpenPlugins)}
                icon={<svg {...menuIconProps}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 12h.01" /><path d="M17 12h.01" /><path d="M7 12h.01" /></svg>} />
              <MenuItem label="Keyboard Shortcuts" onClick={() => handleMenuItem(onOpenKeybindings)}
                icon={<svg {...menuIconProps}><rect x="2" y="4" width="20" height="16" rx="2" ry="2" /><line x1="6" y1="8" x2="6.01" y2="8" /><line x1="10" y1="8" x2="10.01" y2="8" /><line x1="14" y1="8" x2="14.01" y2="8" /><line x1="18" y1="8" x2="18.01" y2="8" /><line x1="8" y1="12" x2="8.01" y2="12" /><line x1="12" y1="12" x2="12.01" y2="12" /><line x1="16" y1="12" x2="16.01" y2="12" /><line x1="7" y1="16" x2="17" y2="16" /></svg>} />

              <MenuDivider />

              <MenuItem label="Subscription" onClick={() => handleMenuItem(onOpenSubscription)}
                icon={<svg {...menuIconProps}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>} />
              <MenuItem label="Report a Problem" onClick={() => handleMenuItem(onOpenFeedback)}
                icon={<svg {...menuIconProps}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>} />

              <MenuDivider />

              <MenuItem label="Settings" accent="#4de6f0" onClick={() => handleMenuItem(onOpenSettings)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>} />
            </div>
          )}
        </div>

        {/* Version tag */}
        <span style={{
          fontFamily: fontMono, fontSize: 9, letterSpacing: '0.05em',
          color: '#4a5168', marginLeft: 2,
        }}>
          v{window.flowade?.version || '0.1.0'}
        </span>

        {/* Electron window controls */}
        {isElectron && (
          <WindowControls colors={{
            text: { dim: '#94a3b8', primary: '#e6edf7' },
            bg: { overlay: 'rgba(255,255,255,0.06)', glass: '#0a0e1c', surface: '#0a0e1c' },
          }} />
        )}
      </div>
    </header>
  );
}

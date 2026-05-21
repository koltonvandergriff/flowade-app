// Glasshouse-themed Header. Same callback API as Header.jsx; same dropdown
// menu items and workspace switcher mounted inline. Visual changes only:
//   - FA monogram + "FlowADE" techno wordmark left
//   - Glassy translucent bar with cyan inner edge
//   - Cyan-glow accent on hover/active
//   - Same Electron window controls + version tag
import { useState, useRef, useEffect } from 'react';
import WorkspaceSwitcher from '../WorkspaceSwitcher';
import logoFa from '../../assets/branding/logo-fa.png';

const fontMono = 'var(--gh-font-mono)';
const fontTechno = 'var(--gh-font-techno)';

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--gh-line)', margin: '4px 8px' }} />;
}

function MenuItem({ icon, label, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', fontSize: 'var(--gh-text-12)',
        fontFamily: fontMono,
        color: 'var(--gh-ink-mute)',
        transition: 'background 0.12s, color 0.12s',
        width: '100%', boxSizing: 'border-box', borderRadius: 'var(--gh-radius-sm)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--gh-cy-tint-08)';
        e.currentTarget.style.color = accent || 'var(--gh-ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--gh-ink-mute)';
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

  const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'var(--gh-ink-dim)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const menuIconProps = { ...iconProps, stroke: 'currentColor', width: 15, height: 15 };

  const btnStyle = {
    all: 'unset', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 'var(--gh-radius-sm)',
    transition: 'all 0.15s var(--gh-ease)',
  };

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid var(--gh-cy-tint-07)',
        background: 'var(--gh-glass-bar)',
        backdropFilter: 'blur(14px) saturate(1.1)',
        boxShadow: 'inset 0 -1px 0 var(--gh-cy-tint-04)',
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
            filter: 'drop-shadow(0 0 10px var(--gh-cy-tint-40))',
          }}
        />
        <div style={{
          fontFamily: fontTechno,
          fontWeight: 600, fontSize: 'var(--gh-text-13)', letterSpacing: '0.18em',
          color: 'var(--gh-ink)', textTransform: 'uppercase',
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
              background: menuOpen ? 'var(--gh-cy-tint-12)' : 'transparent',
              color: menuOpen ? 'var(--gh-cy)' : 'var(--gh-ink-mute)',
            }}
            title="Menu"
            onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.background = 'var(--gh-hover-05)'; }}
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
              background: 'var(--gh-glass-strong)',
              border: '1px solid var(--gh-cy-tint-15)',
              borderRadius: 'var(--gh-radius-md)', padding: '6px 4px',
              backdropFilter: 'blur(20px) saturate(1.2)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px var(--gh-cy-tint-04)',
              zIndex: 50,
            }}>
              <MenuItem label="Help" onClick={() => handleMenuItem(onOpenHelp)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>} />
              <MenuItem label="Session History" onClick={() => handleMenuItem(onOpenHistory)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
              <MenuItem label="Reports & Analytics" accent="var(--gh-cy)" onClick={() => handleMenuItem(onOpenAnalytics)}
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

              <MenuItem label="Settings" accent="var(--gh-cy)" onClick={() => handleMenuItem(onOpenSettings)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>} />
            </div>
          )}
        </div>

        {/* Version tag */}
        <span style={{
          fontFamily: fontMono, fontSize: 'var(--gh-text-9)', letterSpacing: '0.05em',
          color: 'var(--gh-ink-dim)', marginLeft: 2,
        }}>
          v{window.flowade?.version || '0.1.0'}
        </span>

        {/* Electron window controls */}
        {isElectron && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
            <button onClick={() => window.flowade.window.minimize()} style={btnStyle}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gh-hover-05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="var(--gh-ink-mute)" strokeWidth="1.5" /></svg>
            </button>
            <button onClick={() => window.flowade.window.maximize()} style={btnStyle}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gh-hover-05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="var(--gh-ink-mute)" strokeWidth="1.5" /></svg>
            </button>
            <button onClick={() => window.flowade.window.close()} style={btnStyle}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gh-rd-tint-25)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="2" y1="2" x2="8" y2="8" stroke="var(--gh-ink-mute)" strokeWidth="1.5" />
                <line x1="8" y1="2" x2="2" y2="8" stroke="var(--gh-ink-mute)" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

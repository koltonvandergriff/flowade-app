import { useState, useRef, useEffect } from 'react';
import { FONTS } from '../lib/constants';
import { useTheme } from '../hooks/useTheme';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import WindowControls from './WindowControls';
import flowadeLogo from '../../assets/flowade-logo-256.png';

const fc = FONTS.mono;
const orb = FONTS.display;

function MenuDivider({ colors }) {
  return <div style={{ height: 1, background: colors.border.subtle, margin: '4px 8px' }} />;
}

function MenuItem({ icon, label, onClick, colors, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', fontSize: 12, fontFamily: fc, color: colors.text.secondary,
        transition: 'background 0.12s, color 0.12s', width: '100%', boxSizing: 'border-box',
        borderRadius: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; e.currentTarget.style.color = accent || colors.text.primary; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.text.secondary; }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flexShrink: 0 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default function Header({ onOpenSettings, onOpenHelp, onOpenFeedback, onOpenHistory, onOpenSubscription, onOpenKeybindings, onOpenPlugins, onOpenAnalytics, onOpenNotifications, onOpenPrompts, onOpenCommands }) {
  const { colors, themeName, toggleTheme } = useTheme();
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

  const handleMenuItem = (fn) => {
    setMenuOpen(false);
    fn();
  };

  const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: colors.text.dim, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const menuIconProps = { ...iconProps, stroke: 'currentColor', width: 15, height: 15 };

  const btnStyle = {
    all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 6, transition: 'background .15s ease',
  };

  return (
    <header className="fc-glass" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 16px', borderBottom: `1px solid ${colors.border.subtle}`,
      background: colors.bg.glass || colors.bg.surface,
      position: 'sticky', top: 0, zIndex: 10,
      WebkitAppRegion: 'drag',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' }}>
        <img src={flowadeLogo} alt="FlowADE" style={{
          width: 26, height: 26, borderRadius: 7,
          boxShadow: `0 2px 16px ${colors.accent.primary || colors.accent.cyan}30`,
        }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text.primary, fontFamily: orb, letterSpacing: 1.2 }}>
            FlowADE
          </div>
        </div>
      </div>

      {/* Center: Workspace Switcher */}
      <div style={{ WebkitAppRegion: 'no-drag' }}>
        <WorkspaceSwitcher />
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' }}>
        {/* Theme toggle */}
        <button onClick={toggleTheme} style={btnStyle} title={`Switch to ${themeName === 'dark' ? 'light' : 'dark'} theme`}>
          {themeName === 'dark' ? (
            <svg {...iconProps}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
          ) : (
            <svg {...iconProps}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
          )}
        </button>

        {/* Menu button */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              ...btnStyle,
              background: menuOpen ? colors.bg.overlay : 'transparent',
            }}
            title="Menu"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.text.dim} strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="5" r="1" fill={colors.text.dim} /><circle cx="12" cy="12" r="1" fill={colors.text.dim} /><circle cx="12" cy="19" r="1" fill={colors.text.dim} />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6,
              width: 210, background: colors.bg.raised,
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: 10, padding: '6px 4px',
              boxShadow: `0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.15)`,
              zIndex: 50,
            }}>
              <MenuItem colors={colors} label="Help" onClick={() => handleMenuItem(onOpenHelp)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>} />
              <MenuItem colors={colors} label="Session History" onClick={() => handleMenuItem(onOpenHistory)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
              <MenuItem colors={colors} label="Reports & Analytics" accent={colors.accent.purple} onClick={() => handleMenuItem(onOpenAnalytics)}
                icon={<svg {...menuIconProps}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>} />
              <MenuItem colors={colors} label="Prompt Templates" onClick={() => handleMenuItem(onOpenPrompts)}
                icon={<svg {...menuIconProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>} />
              <MenuItem colors={colors} label="Command Library" onClick={() => handleMenuItem(onOpenCommands)}
                icon={<svg {...menuIconProps}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>} />

              <MenuDivider colors={colors} />

              <MenuItem colors={colors} label="Notifications & Devices" onClick={() => handleMenuItem(onOpenNotifications)}
                icon={<svg {...menuIconProps}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>} />
              <MenuItem colors={colors} label="Plugins" onClick={() => handleMenuItem(onOpenPlugins)}
                icon={<svg {...menuIconProps}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 12h.01" /><path d="M17 12h.01" /><path d="M7 12h.01" /></svg>} />
              <MenuItem colors={colors} label="Keyboard Shortcuts" onClick={() => handleMenuItem(onOpenKeybindings)}
                icon={<svg {...menuIconProps}><rect x="2" y="4" width="20" height="16" rx="2" ry="2" /><line x1="6" y1="8" x2="6.01" y2="8" /><line x1="10" y1="8" x2="10.01" y2="8" /><line x1="14" y1="8" x2="14.01" y2="8" /><line x1="18" y1="8" x2="18.01" y2="8" /><line x1="8" y1="12" x2="8.01" y2="12" /><line x1="12" y1="12" x2="12.01" y2="12" /><line x1="16" y1="12" x2="16.01" y2="12" /><line x1="7" y1="16" x2="17" y2="16" /></svg>} />

              <MenuDivider colors={colors} />

              <MenuItem colors={colors} label="Report a Problem" onClick={() => handleMenuItem(onOpenFeedback)}
                icon={<svg {...menuIconProps}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>} />

              <MenuDivider colors={colors} />

              <MenuItem colors={colors} label="Settings" accent={colors.text.primary} onClick={() => handleMenuItem(onOpenSettings)}
                icon={<svg {...menuIconProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>} />
            </div>
          )}
        </div>

        {/* Version */}
        <span style={{ fontSize: 9, color: colors.text.ghost, fontFamily: fc, marginLeft: 2 }}>
          v{window.flowade?.version || '0.1.0'}
        </span>

        {/* Electron window controls */}
        {isElectron && <WindowControls colors={colors} />}
      </div>
    </header>
  );
}

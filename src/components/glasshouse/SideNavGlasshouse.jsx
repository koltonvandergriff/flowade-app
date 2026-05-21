// Glasshouse sidebar — 220px wide, label-bearing, sectioned.
// Account-area destinations (Settings, Pricing, Sign out) live in a
// dropup panel anchored to the user footer pill rather than in the main
// nav tree, so the sidebar reads as a project-shaped surface and the
// account stuff stays where it is one click from "who am I logged in
// as".
import { useEffect, useRef, useState } from 'react';
import logoFa from '../../assets/branding/logo-fa.png';

const ICON_SIZE = 14;

function Icon({ name }) {
  const props = { width: ICON_SIZE, height: ICON_SIZE, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'overview': return <svg {...props}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>;
    case 'terminals': return <svg {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    case 'chat': return <svg {...props}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>;
    case 'tasks': return <svg {...props}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
    case 'memory': return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>;
    case 'settings': return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
    case 'pricing': return <svg {...props}><circle cx="12" cy="12" r="10" /><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 1.5-2.5 3.5M12 17v.01" /></svg>;
    case 'logout': return <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
    case 'chevron': return <svg {...props}><polyline points="6 9 12 15 18 9" /></svg>;
    case 'search': return <svg {...props}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
    case 'bell': return <svg {...props}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>;
    default: return null;
  }
}

// Sidebar nav has Workspace + Knowledge only. Account-area destinations
// live in the profile dropup so the sidebar is a project surface, not an
// app-settings surface.
const SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { id: 'overview',  label: 'Overview' },
      { id: 'terminals', label: 'Terminals' },
      { id: 'chat',      label: 'AI Chat' },
      { id: 'tasks',     label: 'Tasks' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'memory', label: 'Memory' },
    ],
  },
];

export default function SideNavGlasshouse({ activePanel, onSelect, user, badges, onLogout, onOpenNotifications, onOpenCommandPalette }) {
  const userName = user?.name || (user?.email ? user.email.split('@')[0] : 'You');
  const userInitials = (userName.match(/\b[A-Z]/g) || ['Y']).slice(0, 2).join('').toUpperCase() || 'Y';
  const userEmail = user?.email || '';

  const [menuOpen, setMenuOpen] = useState(false);
  const footerRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (footerRef.current && !footerRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const goto = (id) => {
    setMenuOpen(false);
    onSelect?.(id);
  };

  const accountActive = activePanel === 'settings' || activePanel === 'pricing';

  return (
    <aside style={s.root}>
      <div style={s.brandHead}>
        <img src={logoFa} alt="FA" style={s.logoFa} />
        <span style={s.brandName}>FlowADE</span>
        <span style={s.brandTag}>PRO</span>
      </div>

      <div style={s.list}>
        {SECTIONS.map(section => (
          <div key={section.label} style={s.section}>
            <div style={s.sectionLabel}>{section.label}</div>
            {section.items.map(item => {
              const active = activePanel === item.id;
              const badge = badges?.[item.id];
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect?.(item.id)}
                  title={item.label}
                  style={{ ...s.navLink, ...(active ? s.navLinkActive : null) }}
                  onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#f1f5f9'; } }}
                  onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; } }}
                >
                  <span style={s.navIcon}><Icon name={item.id} /></span>
                  <span>{item.label}</span>
                  {badge > 0 && <span style={s.badge}>{badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {(onOpenCommandPalette || onOpenNotifications) && (
        <div style={s.toolRow}>
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              style={s.toolBtn}
              title="Search (Ctrl+K)"
              aria-label="Open command palette"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#f1f5f9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              <Icon name="search" />
              <span style={s.toolLabel}>Search</span>
              <span style={s.kbd}>⌘K</span>
            </button>
          )}
          {onOpenNotifications && (
            <button
              type="button"
              onClick={onOpenNotifications}
              style={{ ...s.toolBtn, flex: '0 0 auto' }}
              title="Notifications"
              aria-label="Notifications"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#f1f5f9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              <Icon name="bell" />
            </button>
          )}
        </div>
      )}

      <div ref={footerRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          style={{
            ...s.footUser,
            ...(menuOpen || accountActive ? s.footUserActive : null),
          }}
          onMouseEnter={(e) => { if (!menuOpen && !accountActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
          onMouseLeave={(e) => { if (!menuOpen && !accountActive) e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={s.avatar}>{userInitials}</div>
          <div style={s.userMeta}>
            <div style={s.userName}>{userName}</div>
            {userEmail && <div style={s.userEmail}>{userEmail}</div>}
          </div>
          <span style={{ ...s.chev, transform: menuOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
            <Icon name="chevron" />
          </span>
        </button>

        {menuOpen && (
          <div role="menu" style={s.menu}>
            <div style={s.menuHeader}>
              <div style={{ ...s.avatar, width: 36, height: 36, fontSize: 14 }}>{userInitials}</div>
              <div style={{ ...s.userMeta, gap: 3 }}>
                <div style={{ ...s.userName, fontSize: 12 }}>{userName}</div>
                {userEmail && <div style={{ ...s.userEmail, fontSize: 10 }}>{userEmail}</div>}
              </div>
            </div>

            <div style={s.menuDivider} />

            <MenuItem
              icon={<Icon name="settings" />}
              label="Settings"
              active={activePanel === 'settings'}
              onClick={() => goto('settings')}
            />
            <MenuItem
              icon={<Icon name="pricing" />}
              label="Pricing & Plan"
              active={activePanel === 'pricing'}
              onClick={() => goto('pricing')}
            />

            <div style={s.menuDivider} />

            <MenuItem
              icon={<Icon name="logout" />}
              label="Sign out"
              danger
              onClick={() => { setMenuOpen(false); onLogout?.(); }}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function MenuItem({ icon, label, onClick, active, danger }) {
  const baseColor = danger ? '#ff8b8b' : (active ? '#4de6f0' : '#cbd5e1');
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        margin: '1px 6px',
        borderRadius: 8,
        fontFamily: 'var(--gh-font-mono, monospace)',
        fontSize: 12,
        color: baseColor,
        background: active ? 'rgba(77,230,240,0.10)' : 'transparent',
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? 'rgba(255,107,107,0.10)'
          : 'rgba(255,255,255,0.05)';
        e.currentTarget.style.color = danger ? '#ff6b6b' : (active ? '#4de6f0' : '#f1f5f9');
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'rgba(77,230,240,0.10)' : 'transparent';
        e.currentTarget.style.color = baseColor;
      }}
    >
      <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: 0.85 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

const s = {
  root: {
    width: 220, minWidth: 220, height: '100%',
    background: 'linear-gradient(180deg, rgba(14,14,28,0.85), rgba(8,8,16,0.95))',
    borderRight: '1px solid rgba(77,230,240,0.06)',
    backdropFilter: 'blur(14px)',
    display: 'flex', flexDirection: 'column',
    flexShrink: 0,
    // Sidebar must NEVER let its own children grow past its bounds —
    // tall lists belong inside s.list (which scrolls), not the column.
    overflow: 'hidden',
  },
  brandHead: {
    padding: '20px 18px 16px',
    display: 'flex', alignItems: 'center', gap: 10,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  logoFa: {
    width: 26, height: 26, objectFit: 'contain',
    filter: 'drop-shadow(0 0 8px rgba(77,230,240,0.4))',
  },
  brandName: {
    fontFamily: 'var(--gh-font-techno, "Chakra Petch", sans-serif)',
    fontWeight: 600, fontSize: 14, letterSpacing: '0.18em',
    textTransform: 'uppercase', color: '#f1f5f9',
  },
  brandTag: {
    marginLeft: 'auto',
    fontFamily: 'var(--gh-font-mono, "JetBrains Mono", monospace)',
    fontSize: 9, letterSpacing: '0.22em', fontWeight: 700,
    padding: '3px 8px',
    border: '1px solid rgba(77,230,240,0.35)',
    background: 'rgba(77,230,240,0.04)',
    color: '#4de6f0',
  },
  list: { flex: 1, padding: '6px 10px', overflowY: 'auto' },
  section: { display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 14 },
  sectionLabel: {
    fontFamily: 'var(--gh-font-techno, "Chakra Petch", sans-serif)',
    fontWeight: 600, fontSize: 9,
    letterSpacing: '0.32em', textTransform: 'uppercase',
    color: '#4de6f0', opacity: 0.55,
    padding: '14px 14px 6px',
  },
  navLink: {
    all: 'unset', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', borderRadius: 8,
    fontFamily: 'var(--gh-font-mono, "JetBrains Mono", monospace)',
    fontSize: 12, color: '#94a3b8',
    transition: 'all 0.15s',
  },
  navLinkActive: {
    background: 'linear-gradient(90deg, rgba(77,230,240,0.14), transparent 80%)',
    color: '#4de6f0',
    boxShadow: 'inset 2px 0 0 #4de6f0, 0 0 24px rgba(77,230,240,0.08)',
    textShadow: '0 0 8px rgba(77,230,240,0.5)',
  },
  navIcon: {
    width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    opacity: 0.85,
  },
  badge: {
    marginLeft: 'auto',
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 9, fontWeight: 700,
    padding: '1px 6px', borderRadius: 99,
    background: 'rgba(77,230,240,0.15)', color: '#4de6f0',
  },
  toolRow: {
    display: 'flex',
    gap: 6,
    padding: '8px 10px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  toolBtn: {
    all: 'unset',
    cursor: 'pointer',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderRadius: 8,
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 11,
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.06)',
    transition: 'all 0.12s ease',
  },
  toolLabel: { flex: 1, textAlign: 'left' },
  kbd: {
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 9,
    color: '#4a5168',
    padding: '1px 5px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.05)',
  },
  footUser: {
    all: 'unset',
    cursor: 'pointer',
    boxSizing: 'border-box',
    width: '100%',
    padding: '12px 14px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', alignItems: 'center', gap: 10,
    transition: 'background 0.15s ease',
  },
  footUserActive: {
    background: 'rgba(77,230,240,0.06)',
  },
  avatar: {
    width: 28, height: 28, borderRadius: '50%',
    background: 'linear-gradient(135deg, #4de6f0, #1aa9bc)',
    display: 'grid', placeItems: 'center',
    fontFamily: 'var(--gh-font-display, "Outfit", sans-serif)',
    fontWeight: 700, fontSize: 12, color: '#001014',
    flexShrink: 0,
    boxShadow: '0 0 12px rgba(77,230,240,0.35)',
  },
  userMeta: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, textAlign: 'left' },
  userName: {
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 11, color: '#f1f5f9',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  userEmail: {
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 9, color: '#4a5168',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  chev: {
    width: 14, height: 14,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: '#4a5168',
    transition: 'transform 0.18s ease',
    flexShrink: 0,
  },
  menu: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 'calc(100% + 6px)',
    background: 'linear-gradient(180deg, rgba(18,22,38,0.96), rgba(10,14,26,0.98))',
    border: '1px solid rgba(77,230,240,0.18)',
    borderRadius: 12,
    padding: '6px 0 8px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 2px 12px rgba(0,0,0,0.4), 0 0 32px rgba(77,230,240,0.06)',
    backdropFilter: 'blur(18px) saturate(1.1)',
    zIndex: 60,
    animation: 'flowadeMenuRise 160ms ease',
  },
  menuHeader: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px 10px',
  },
  menuDivider: {
    height: 1, margin: '4px 10px',
    background: 'rgba(255,255,255,0.06)',
  },
};

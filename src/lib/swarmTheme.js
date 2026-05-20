// Team color palette for the FlowADE swarm UI. Each team letter gets a
// stable hue so a 16-pane page is visually parseable at a glance: panes
// belonging to the same swarm team share a border + badge accent color.

const TEAM_HUES = {
  A: { name: 'cyan',   accent: '#5ec5ff', soft: 'rgba(94,197,255,0.15)',  border: 'rgba(94,197,255,0.55)' },
  B: { name: 'violet', accent: '#a877ff', soft: 'rgba(168,119,255,0.15)', border: 'rgba(168,119,255,0.55)' },
  C: { name: 'amber',  accent: '#ffb547', soft: 'rgba(255,181,71,0.15)',  border: 'rgba(255,181,71,0.55)' },
  D: { name: 'rose',   accent: '#ff6b8b', soft: 'rgba(255,107,139,0.15)', border: 'rgba(255,107,139,0.55)' },
};

const OWNER_GLYPHS = {
  user:         '👤',
  orchestrator: '👑',
  agent:        '🤖',
};

const OWNER_LABELS = {
  user:         'User',
  orchestrator: 'Orchestrator',
  agent:        'Worker',
};

// Warm "human seat" palette — visually orthogonal to all four team
// accents so a glance can separate the human pane from the agent panes
// without parsing badges. Used both for the USER badge and the optional
// top-edge accent strip on user panes that are roots of an active swarm.
const USER_HUE = {
  accent: '#f4d28a',
  soft:   'rgba(244,210,138,0.12)',
  border: 'rgba(244,210,138,0.55)',
  strong: 'rgba(244,210,138,0.85)',
};

export function getUserPaneStyle({ isSwarmRoot }) {
  // Plain user panes get a thin warm top-edge cap; if they're acting as
  // the root of an active swarm (i.e. an agent's spawnedBy chain ends
  // here) we tint the full border so the visual link is unmistakable.
  if (isSwarmRoot) {
    return {
      border: `1px solid ${USER_HUE.border}`,
      boxShadow: `0 0 14px ${USER_HUE.soft}, inset 0 0 0 1px ${USER_HUE.border}`,
      borderTop: `2px solid ${USER_HUE.strong}`,
      accent: USER_HUE.accent,
    };
  }
  return {
    borderTop: `2px solid ${USER_HUE.strong}`,
    accent: USER_HUE.accent,
  };
}

export function getUserHue() { return USER_HUE; }

export function getTeamTheme(teamId) {
  if (!teamId) return null;
  return TEAM_HUES[teamId] ?? null;
}

export function getOwnerGlyph(ownerType) {
  return OWNER_GLYPHS[ownerType] ?? OWNER_GLYPHS.user;
}

export function getOwnerLabel(ownerType) {
  return OWNER_LABELS[ownerType] ?? OWNER_LABELS.user;
}

// Helper: derive style props a TerminalGrid pane can spread onto its
// outer container. Returns null when pane is a plain user pane (no
// swarm chrome needed). For orchestrator + agent panes, returns
// { border, boxShadow, accent } — the caller decides how to spread.
export function getSwarmPaneStyle({ ownerType, teamId }) {
  if (ownerType === 'user' || !ownerType) return null;
  const theme = getTeamTheme(teamId);
  if (!theme) return { border: '1px solid #5ec5ff55', accent: '#5ec5ff' };
  return {
    border: `1px solid ${theme.border}`,
    boxShadow: `0 0 12px ${theme.soft}, inset 0 0 0 1px ${theme.border}`,
    accent: theme.accent,
  };
}

// Compose the full pane label per the project convention:
//   Workspace:Provider:SessionName[:T<A-D>][:W<n>]
export function composePaneLabel({ workspace, provider, sessionName, teamId, ownerType, workerIndex }) {
  const parts = [workspace || '~', provider, sessionName];
  if (teamId) parts.push(`T${teamId}`);
  if (ownerType === 'agent' && typeof workerIndex === 'number') parts.push(`W${workerIndex}`);
  return parts.join(':');
}

export { TEAM_HUES, OWNER_GLYPHS, OWNER_LABELS };

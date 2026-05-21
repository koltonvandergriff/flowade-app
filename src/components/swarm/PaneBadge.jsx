import React from 'react';
import { getTeamTheme, getOwnerGlyph, getOwnerLabel } from '../../lib/swarmTheme.js';

// Inline pane-header badge for FlowADE swarm panes. Renders nothing for
// plain user panes (returns null) so it can be unconditionally placed
// in TerminalGrid without polluting the default look.

export default function PaneBadge({ ownerType, teamId, workerIndex, size = 'sm' }) {
  if (!ownerType || ownerType === 'user') return null;

  const theme = getTeamTheme(teamId);
  const glyph = getOwnerGlyph(ownerType);
  const label = getOwnerLabel(ownerType);
  const accent = theme?.accent ?? '#5ec5ff';
  const soft   = theme?.soft   ?? 'rgba(94,197,255,0.15)';

  const isSm = size === 'sm';
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: isSm ? 4 : 6,
    padding: isSm ? '2px 6px' : '4px 10px',
    borderRadius: 999,
    fontSize: isSm ? 10 : 12,
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontWeight: 600,
    letterSpacing: 0.3,
    color: accent,
    background: soft,
    border: `1px solid ${accent}55`,
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const team = teamId ? `T${teamId}` : '';
  const worker = (ownerType === 'agent' && typeof workerIndex === 'number') ? ` W${workerIndex}` : '';
  const suffix = `${team}${worker}`.trim();

  return (
    <span style={style} title={`${label}${suffix ? ' · ' + suffix : ''}`}>
      <span aria-hidden style={{ fontSize: isSm ? 11 : 14, lineHeight: 1 }}>{glyph}</span>
      {suffix ? <span>{suffix}</span> : <span>{label}</span>}
    </span>
  );
}

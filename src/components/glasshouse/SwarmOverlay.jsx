// SwarmOverlay — keyboard-accessible modal showing up to 4 active swarm
// runs side-by-side. Each run is rendered as a tree (orchestrator +
// workers) plus a mini event feed. Purely presentational; caller owns
// the `runs` snapshot and the `open` / `onClose` state.

import React, { useEffect } from 'react';
import PaneBadge from '../swarm/PaneBadge.jsx';
import { getTeamTheme } from '../../lib/swarmTheme.js';

const FONT_MONO = 'var(--gh-font-mono, "JetBrains Mono", monospace)';
const FONT_TECH = 'var(--gh-font-techno, "Chakra Petch", sans-serif)';
const FONT_DISP = 'var(--gh-font-display, "Outfit", sans-serif)';

export default function SwarmOverlay({ open, onClose, runs }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const list = Array.isArray(runs) ? runs.slice(0, 4) : [];
  const cols = Math.max(1, Math.min(list.length, 4));

  return (
    <div
      style={s.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Active Swarms"
    >
      <div style={s.card}>
        <div style={s.head}>
          <div style={s.headLeft}>
            <span style={s.stamp}>swarm overlay</span>
            <h2 style={s.h}>Active <em style={s.em}>Swarms</em></h2>
            <p style={s.lead}>Cmd+K to toggle</p>
          </div>
          <button onClick={onClose} style={s.x} title="Close (Esc)">esc</button>
        </div>

        {list.length === 0 ? (
          <div style={s.empty}>
            No active swarms. Type 'launch N agents to ...' in any terminal to start one.
          </div>
        ) : (
          <div style={{ ...s.grid, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {list.map((run) => (
              <RunCard key={run.runId} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunCard({ run }) {
  const theme = getTeamTheme(run.teamId);
  const accent = theme?.accent ?? '#5ec5ff';
  const border = theme?.border ?? 'rgba(94,197,255,0.55)';
  const soft   = theme?.soft   ?? 'rgba(94,197,255,0.15)';

  const cardStyle = {
    ...s.runCard,
    border: `1px solid ${border}`,
    boxShadow: `0 0 20px ${soft}, inset 0 0 0 1px ${border}`,
  };

  const orch = run.orchestrator || {};
  const workers = Array.isArray(run.workers) ? run.workers : [];
  const events = Array.isArray(run.recentEvents) ? run.recentEvents.slice(-5) : [];

  return (
    <div style={cardStyle}>
      <div style={s.runHead}>
        <div style={{ ...s.teamLetter, color: accent, borderColor: border }}>
          {run.teamId || '?'}
        </div>
        <div style={s.runHeadText}>
          <div style={s.runTask} title={run.task}>{run.task || '(no task)'}</div>
          <div style={{ ...s.statusPill, color: accent, borderColor: border, background: soft }}>
            {run.status || 'idle'}
          </div>
        </div>
      </div>

      <div style={s.tree}>
        <div style={s.row}>
          <span style={s.glyph} aria-hidden>👑</span>
          <PaneBadge ownerType="orchestrator" teamId={run.teamId} />
          <span style={s.rowLabel} title={orch.label}>{orch.label || 'Orchestrator'}</span>
          <span style={{ ...s.rowState, color: accent }}>{orch.state || ''}</span>
        </div>

        {workers.map((w, i) => {
          const isLast = i === workers.length - 1;
          const dot = stateDot(w.state);
          return (
            <div key={w.terminalId || i} style={s.row}>
              <span style={s.branch} aria-hidden>{isLast ? '└' : '├'}</span>
              <span style={s.glyph} aria-hidden>🤖</span>
              <PaneBadge ownerType="agent" teamId={run.teamId} workerIndex={i + 1} />
              <span style={s.rowLabel} title={w.label}>
                {w.label || `W${i + 1}`}
                {w.title ? <span style={s.rowTitle}> — {w.title}</span> : null}
              </span>
              <span style={{ ...s.rowState, color: accent }}>{w.state || ''}</span>
              {dot ? <span style={{ ...s.stateDot, background: dot }} /> : null}
            </div>
          );
        })}
      </div>

      <div style={s.feedHead}>recent</div>
      <div style={s.feed}>
        {events.length === 0 ? (
          <div style={s.feedEmpty}>no events yet</div>
        ) : (
          events.map((ev) => (
            <div key={ev.tokenId} style={s.feedRow}>
              <span style={{ ...s.feedKind, color: accent }}>{ev.kind}</span>
              <span style={s.feedFrom}>from {ev.workerId || '?'}:</span>
              <span style={s.feedPayload}>{previewPayload(ev.payload)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function stateDot(state) {
  if (state === 'blocker') return '#ff6b6b';
  if (state === 'done')    return '#4ade80';
  return null;
}

function previewPayload(p) {
  if (p == null) return '';
  if (typeof p === 'string') return oneLine(p);
  try { return oneLine(JSON.stringify(p)); } catch { return ''; }
}

function oneLine(str) {
  const s1 = String(str).replace(/\s+/g, ' ').trim();
  return s1.length > 120 ? s1.slice(0, 117) + '...' : s1;
}

const s = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 9200,
    background: 'rgba(0,0,0,0.78)',
    backdropFilter: 'blur(6px)',
    display: 'grid', placeItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%', maxWidth: 1400, maxHeight: '90vh',
    display: 'flex', flexDirection: 'column',
    background: 'linear-gradient(160deg, rgba(8,10,22,0.92), rgba(14,16,30,0.92))',
    border: '1px solid rgba(94,197,255,0.18)',
    borderRadius: 16,
    boxShadow: '0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(94,197,255,0.08)',
    color: '#f1f5f9', fontFamily: FONT_MONO,
    padding: 24,
    overflow: 'hidden',
  },
  head: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 16, marginBottom: 18,
    paddingBottom: 14,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headLeft: { minWidth: 0 },
  stamp: {
    display: 'inline-block', marginBottom: 10,
    fontFamily: FONT_TECH, fontSize: 9.5, fontWeight: 600,
    letterSpacing: '0.32em', textTransform: 'uppercase',
    color: '#5ec5ff',
    padding: '4px 10px',
    border: '1px solid rgba(94,197,255,0.35)',
    background: 'rgba(94,197,255,0.05)',
  },
  h: {
    fontFamily: FONT_DISP, fontWeight: 800,
    fontSize: 24, letterSpacing: '-0.03em',
    margin: '0 0 4px', lineHeight: 1.05,
  },
  em: { fontStyle: 'normal', color: '#5ec5ff', textShadow: '0 0 22px rgba(94,197,255,0.35)' },
  lead: { fontSize: 11, color: '#94a3b8', margin: 0, letterSpacing: '0.04em' },
  x: {
    all: 'unset', cursor: 'pointer', flexShrink: 0,
    padding: '6px 12px', borderRadius: 6,
    color: '#94a3b8',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.08em',
  },

  empty: {
    flex: 1, display: 'grid', placeItems: 'center',
    padding: 40, fontSize: 13, color: '#94a3b8',
    fontFamily: FONT_MONO, textAlign: 'center',
  },

  grid: {
    flex: 1, display: 'grid', gap: 16,
    overflowY: 'auto',
    minHeight: 0,
  },

  runCard: {
    display: 'flex', flexDirection: 'column',
    background: 'rgba(8,10,22,0.55)',
    borderRadius: 12,
    padding: 14,
    minWidth: 0,
    gap: 10,
  },
  runHead: {
    display: 'flex', alignItems: 'center', gap: 12,
    paddingBottom: 10,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    minWidth: 0,
  },
  teamLetter: {
    flexShrink: 0,
    width: 36, height: 36, borderRadius: 8,
    display: 'grid', placeItems: 'center',
    fontFamily: FONT_DISP, fontWeight: 800, fontSize: 18,
    border: '1px solid',
    background: 'rgba(255,255,255,0.02)',
  },
  runHeadText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  runTask: {
    fontSize: 12, fontWeight: 600, color: '#f1f5f9',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontFamily: FONT_MONO,
  },
  statusPill: {
    alignSelf: 'flex-start',
    fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
    textTransform: 'uppercase',
    padding: '2px 8px', borderRadius: 99,
    border: '1px solid', fontFamily: FONT_MONO,
  },

  tree: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  row: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, fontFamily: FONT_MONO,
    minWidth: 0,
  },
  branch: { color: '#4a5168', width: 12, textAlign: 'center', flexShrink: 0 },
  glyph: { fontSize: 13, lineHeight: 1, flexShrink: 0 },
  rowLabel: {
    flex: 1, minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: '#cbd5e1',
  },
  rowTitle: { color: '#94a3b8' },
  rowState: { fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 },
  stateDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },

  feedHead: {
    marginTop: 6,
    fontFamily: FONT_TECH, fontSize: 9, fontWeight: 600,
    letterSpacing: '0.32em', textTransform: 'uppercase',
    color: '#4a5168',
  },
  feed: {
    display: 'flex', flexDirection: 'column', gap: 3,
    fontSize: 10, fontFamily: FONT_MONO, color: '#94a3b8',
    maxHeight: 110, overflowY: 'auto',
  },
  feedEmpty: { color: '#4a5168', fontStyle: 'italic' },
  feedRow: {
    display: 'flex', gap: 4, alignItems: 'baseline',
    overflow: 'hidden',
  },
  feedKind: { fontWeight: 700, flexShrink: 0, letterSpacing: '0.04em' },
  feedFrom: { color: '#64748b', flexShrink: 0 },
  feedPayload: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: '#cbd5e1', minWidth: 0,
  },
};

// SwarmSettingsPanel — drop-in card for Settings → Integrations. Pure
// presentational: caller passes `values` + `onChange(key, value)`. Does
// not read or write any store directly. Exported key + default
// constants are the canonical source for the WS bridge and orchestration
// layer to avoid string-typo drift.

import React from 'react';

export const SWARM_SETTING_KEYS = {
  allowAgentSpawn: 'swarm.allowAgentSpawn',
  maxWorkersPerSwarm: 'swarm.maxWorkersPerSwarm',
  maxConcurrentSwarmsPerPage: 'swarm.maxConcurrentSwarmsPerPage',
  requirePlanConfirm: 'swarm.requirePlanConfirm',
};

export const SWARM_SETTING_DEFAULTS = {
  allowAgentSpawn: false,
  maxWorkersPerSwarm: 8,
  maxConcurrentSwarmsPerPage: 4,
  requirePlanConfirm: true,
};

const FONT_MONO = 'var(--gh-font-mono, "JetBrains Mono", monospace)';
const FONT_TECH = 'var(--gh-font-techno, "Chakra Petch", sans-serif)';
const FONT_DISP = 'var(--gh-font-display, "Outfit", sans-serif)';

const ACCENT = '#5ec5ff';
const ACCENT_SOFT = 'rgba(94,197,255,0.15)';
const WARN = '#ffb547';

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function Toggle({ on, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!on}
      aria-label={label}
      style={{
        ...s.toggle,
        background: on ? ACCENT : 'rgba(255,255,255,0.06)',
        color: on ? '#001014' : '#94a3b8',
        borderColor: on ? ACCENT : 'rgba(255,255,255,0.13)',
      }}
    >
      <span style={{
        ...s.toggleDot,
        transform: on ? 'translateX(20px)' : 'translateX(0)',
        background: on ? '#001014' : '#94a3b8',
      }} />
      <span style={s.toggleText}>{on ? 'on' : 'off'}</span>
    </button>
  );
}

export default function SwarmSettingsPanel({ values, onChange }) {
  const v = { ...SWARM_SETTING_DEFAULTS, ...(values || {}) };
  const fire = (k, val) => onChange?.(k, val);

  const workers = clampNum(v.maxWorkersPerSwarm, 1, 14);
  const concurrent = clampNum(v.maxConcurrentSwarmsPerPage, 1, 4);
  const workerWarn = workers > 4;

  return (
    <div style={s.card}>
      <div style={s.head}>
        <span style={s.stamp}>orchestration</span>
        <h3 style={s.h}>Swarm <em style={s.em}>Orchestration</em></h3>
        <p style={s.lead}>Let agents in your terminals spawn additional agents to work in parallel.</p>
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.sectionTitle}>Allow agents to spawn agents</div>
          <Toggle
            on={!!v.allowAgentSpawn}
            onClick={() => fire('allowAgentSpawn', !v.allowAgentSpawn)}
            label="Allow agents to spawn agents"
          />
        </div>
        <p style={s.caption}>
          When off, swarm tools return an error. The WS bridge that connects MCP to Electron does not start.
        </p>
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.sectionTitle}>Workers per swarm (max)</div>
          <div style={s.numChip}>{workers}</div>
        </div>
        <input
          type="range"
          min={1}
          max={14}
          step={1}
          value={workers}
          onChange={(e) => fire('maxWorkersPerSwarm', clampNum(e.target.value, 1, 14))}
          style={s.range}
          aria-label="Workers per swarm"
        />
        <div style={s.rangeAxis}>
          <span>1</span>
          <span style={{ color: WARN }}>4 soft-warn</span>
          <span>14</span>
        </div>
        <p style={s.caption}>
          Hard cap. Soft-warn fires above 4 because merge-conflict risk grows.
        </p>
        {workerWarn ? (
          <div style={s.warn}>
            <span aria-hidden>⚠</span> Above 4 workers — merge conflicts get likely.
          </div>
        ) : null}
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.sectionTitle}>Concurrent swarms per page (max)</div>
          <div style={s.numChip}>{concurrent}</div>
        </div>
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={concurrent}
          onChange={(e) => fire('maxConcurrentSwarmsPerPage', clampNum(e.target.value, 1, 4))}
          style={s.range}
          aria-label="Concurrent swarms per page"
        />
        <div style={s.rangeAxis}>
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
        </div>
        <p style={s.caption}>
          Each swarm needs 1 orchestrator + N workers + the user pane, capped at 16 panes total.
        </p>
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.sectionTitle}>Require plan confirmation</div>
          <Toggle
            on={!!v.requirePlanConfirm}
            onClick={() => fire('requirePlanConfirm', !v.requirePlanConfirm)}
            label="Require plan confirmation"
          />
        </div>
        <p style={s.caption}>
          When on, the orchestrator pauses after planning and waits for your 'yes' in the user pane before spawning workers.
        </p>
      </div>
    </div>
  );
}

const s = {
  card: {
    background: 'linear-gradient(160deg, rgba(8,10,22,0.85), rgba(14,16,30,0.85))',
    border: '1px solid rgba(94,197,255,0.18)',
    borderRadius: 14,
    padding: 22,
    color: '#f1f5f9',
    fontFamily: FONT_MONO,
    display: 'flex', flexDirection: 'column', gap: 18,
    boxShadow: '0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(94,197,255,0.06)',
  },
  head: { display: 'flex', flexDirection: 'column', gap: 6 },
  stamp: {
    alignSelf: 'flex-start',
    fontFamily: FONT_TECH, fontSize: 9.5, fontWeight: 600,
    letterSpacing: '0.32em', textTransform: 'uppercase',
    color: ACCENT,
    padding: '4px 10px',
    border: `1px solid ${ACCENT}55`,
    background: ACCENT_SOFT,
    marginBottom: 4,
  },
  h: {
    fontFamily: FONT_DISP, fontWeight: 800,
    fontSize: 22, letterSpacing: '-0.03em',
    margin: 0, lineHeight: 1.1,
  },
  em: { fontStyle: 'normal', color: ACCENT, textShadow: '0 0 22px rgba(94,197,255,0.35)' },
  lead: { fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.55 },

  section: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '14px 0',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  sectionTitle: {
    fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, color: '#f1f5f9',
  },
  caption: {
    margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.55,
  },

  toggle: {
    all: 'unset',
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '4px 12px 4px 6px',
    borderRadius: 999,
    border: '1px solid',
    fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700,
    letterSpacing: '0.14em', textTransform: 'uppercase',
    minWidth: 60,
    transition: 'all 0.15s',
  },
  toggleDot: {
    width: 14, height: 14, borderRadius: '50%',
    transition: 'transform 0.15s',
  },
  toggleText: { lineHeight: 1 },

  numChip: {
    fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
    padding: '4px 10px', borderRadius: 8,
    background: ACCENT_SOFT, color: ACCENT,
    border: `1px solid ${ACCENT}55`,
    minWidth: 36, textAlign: 'center',
  },

  range: {
    width: '100%',
    accentColor: ACCENT,
    cursor: 'pointer',
  },
  rangeAxis: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 9, color: '#4a5168',
    fontFamily: FONT_MONO, letterSpacing: '0.08em',
  },

  warn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', borderRadius: 6,
    background: 'rgba(255,181,71,0.08)',
    border: `1px solid ${WARN}55`,
    color: WARN,
    fontFamily: FONT_MONO, fontSize: 11,
  },
};

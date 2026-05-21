// Swarm Runs — browse past swarm orchestration runs. Master list on
// the left (newest first), detail pane on the right with summary,
// channel timeline, and per-pane transcripts. Data sources:
//   - window.flowade.swarm.runs.list()         → on-disk meta.json
//   - window.flowade.swarm.runs.get(runId)     → meta + transcript ids
//   - window.flowade.swarm.runs.replayChannel(runId) → DB events
//   - window.flowade.swarm.runs.getTranscript(runId, terminalId) → log
import { useEffect, useMemo, useRef, useState } from 'react';

const FONT_DISP = 'var(--gh-font-display, "Outfit", sans-serif)';
const FONT_TECH = 'var(--gh-font-techno, "Chakra Petch", sans-serif)';
const FONT_MONO = 'var(--gh-font-mono, "JetBrains Mono", monospace)';

const STATUS_META = {
  'done':              { label: 'Done',       color: '#58e0a8', bg: 'rgba(88,224,168,0.10)', border: 'rgba(88,224,168,0.32)' },
  'cancelled':         { label: 'Cancelled',  color: '#ff8b8b', bg: 'rgba(255,139,139,0.08)', border: 'rgba(255,139,139,0.32)' },
  'planning':          { label: 'Planning',   color: '#ffd166', bg: 'rgba(255,209,102,0.08)', border: 'rgba(255,209,102,0.32)' },
  'awaiting-confirm':  { label: 'Awaiting',   color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.32)' },
};

const KIND_META = {
  plan:         { icon: '📋', color: '#4de6f0', label: 'Plan' },
  intent:       { icon: '🎯', color: '#a78bfa', label: 'Intent' },
  claim:        { icon: '🔒', color: '#94a3b8', label: 'Claim' },
  progress:     { icon: '◔',  color: '#94a3b8', label: 'Progress' },
  blocker:      { icon: '⚠',  color: '#ff8b8b', label: 'Blocker' },
  diff:         { icon: '✎',  color: '#4de6f0', label: 'Diff' },
  done:         { icon: '✓',  color: '#58e0a8', label: 'Done' },
  'review-fail':{ icon: '✗',  color: '#ff8b8b', label: 'Review fail' },
  cancel:       { icon: '⊘',  color: '#ff8b8b', label: 'Cancel' },
  finish:       { icon: '🏁', color: '#58e0a8', label: 'Finish' },
};

export default function SwarmRunsGlasshouse() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | done | cancelled | running

  const reload = async () => {
    setLoading(true);
    try {
      const rows = await window.flowade?.swarm?.runs?.list?.();
      const arr = Array.isArray(rows) ? rows : [];
      setRuns(arr);
      if (!selectedId && arr.length > 0) setSelectedId(arr[0].runId);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (filter === 'all') return runs;
    if (filter === 'running') return runs.filter(r => r.status !== 'done' && r.status !== 'cancelled');
    return runs.filter(r => r.status === filter);
  }, [runs, filter]);

  const selected = useMemo(() => runs.find(r => r.runId === selectedId) || null, [runs, selectedId]);

  return (
    <div style={p.root}>
      <div style={p.head}>
        <div>
          <h1 style={p.h1}>Swarm Runs</h1>
          <p style={p.sub}>{runs.length} archived run{runs.length === 1 ? '' : 's'} · transcripts live on disk</p>
        </div>
        <div style={p.headRight}>
          <FilterPill active={filter === 'all'}       onClick={() => setFilter('all')}>All</FilterPill>
          <FilterPill active={filter === 'done'}      onClick={() => setFilter('done')}>Done</FilterPill>
          <FilterPill active={filter === 'cancelled'} onClick={() => setFilter('cancelled')}>Cancelled</FilterPill>
          <FilterPill active={filter === 'running'}   onClick={() => setFilter('running')}>Running</FilterPill>
          <button style={p.refreshBtn} onClick={reload} title="Reload runs" aria-label="Reload">↻</button>
        </div>
      </div>

      <div style={p.body}>
        <aside style={p.listCol}>
          {loading && filtered.length === 0 && <div style={p.empty}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={p.empty}>
              No runs match this filter.<br/>
              Spawn a swarm from any claude pane with <code style={p.code}>flowade_swarm_start</code>.
            </div>
          )}
          {filtered.map(run => (
            <RunRow
              key={run.runId}
              run={run}
              active={run.runId === selectedId}
              onClick={() => setSelectedId(run.runId)}
            />
          ))}
        </aside>

        <main style={p.detailCol}>
          {selected ? <RunDetail run={selected} /> : (
            <div style={p.placeholder}>Select a run on the left to inspect its plan, channel timeline, and transcripts.</div>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master list row
// ---------------------------------------------------------------------------
function RunRow({ run, active, onClick }) {
  const status = STATUS_META[run.status] || STATUS_META['awaiting-confirm'];
  const startedAt = run.startedAt ? new Date(run.startedAt) : null;
  const dur = formatDuration(run.durationMs);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...p.row, ...(active ? p.rowActive : null) }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={p.rowHead}>
        <span style={{ ...p.statusPill, color: status.color, background: status.bg, borderColor: status.border }}>
          {status.label}
        </span>
        <span style={p.rowMeta}>{relativeTime(run.startedAt || run.updatedAt)}</span>
      </div>
      <div style={p.rowTitle} title={run.task || run.runId}>
        {truncate(run.task || '(no task captured)', 80)}
      </div>
      <div style={p.rowFoot}>
        <span style={p.chipMuted}>Team {run.teamId || '?'}</span>
        <span style={p.chipMuted}>{run.workerCount ?? '?'} {run.workerCount === 1 ? 'worker' : 'workers'}</span>
        {dur && <span style={p.chipMuted}>{dur}</span>}
        {run.transcriptCount > 0 && <span style={p.chipMuted}>{run.transcriptCount} log{run.transcriptCount === 1 ? '' : 's'}</span>}
      </div>
      <div style={p.rowId} title={run.runId}>{run.runId.slice(0, 8)}…</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
function RunDetail({ run }) {
  const status = STATUS_META[run.status] || STATUS_META['awaiting-confirm'];
  const [tab, setTab] = useState('summary'); // summary | timeline | transcripts
  return (
    <div style={d.root}>
      <header style={d.header}>
        <div>
          <div style={d.runIdRow}>
            <span style={{ ...p.statusPill, color: status.color, background: status.bg, borderColor: status.border }}>
              {status.label}
            </span>
            <code style={d.runId} title={run.runId}>{run.runId}</code>
            <CopyBtn value={run.runId} />
          </div>
          <h2 style={d.task}>{run.task || '(no task captured)'}</h2>
        </div>
      </header>

      <div style={d.statRow}>
        <Stat label="Team" value={run.teamId || '—'} />
        <Stat label="Workers" value={run.workerCount ?? '—'} />
        <Stat label="Provider" value={run.provider || '—'} />
        <Stat label="Workspace" value={run.workspace || '—'} />
        <Stat label="Started" value={run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'} />
        <Stat label="Duration" value={formatDuration(run.durationMs) || (run.startedAt && !run.finishedAt ? 'running…' : '—')} />
      </div>

      <div style={d.tabBar}>
        <TabBtn active={tab === 'summary'}     onClick={() => setTab('summary')}>Summary</TabBtn>
        <TabBtn active={tab === 'timeline'}    onClick={() => setTab('timeline')}>Timeline</TabBtn>
        <TabBtn active={tab === 'transcripts'} onClick={() => setTab('transcripts')}>Transcripts</TabBtn>
      </div>

      <div style={d.tabBody}>
        {tab === 'summary'     && <SummaryView run={run} />}
        {tab === 'timeline'    && <TimelineView run={run} />}
        {tab === 'transcripts' && <TranscriptsView run={run} />}
      </div>
    </div>
  );
}

function SummaryView({ run }) {
  if (run.cancelReason) {
    return (
      <div style={d.section}>
        <SectionLabel>Cancel reason</SectionLabel>
        <pre style={d.pre}>{run.cancelReason}</pre>
        {run.summary && (
          <>
            <SectionLabel>Summary</SectionLabel>
            <pre style={d.pre}>{run.summary}</pre>
          </>
        )}
      </div>
    );
  }
  if (!run.summary) {
    return <div style={d.placeholder}>No summary yet. {run.status === 'done' ? 'Orchestrator did not post one.' : 'Run is still in progress.'}</div>;
  }
  return (
    <div style={d.section}>
      <SectionLabel>Final summary</SectionLabel>
      <pre style={d.pre}>{run.summary}</pre>
    </div>
  );
}

function TimelineView({ run }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    setEvents(null); setErr(null);
    (async () => {
      try {
        const res = await window.flowade?.swarm?.runs?.replayChannel?.(run.runId, 2000);
        if (!alive) return;
        if (res?.error) setErr(res.error);
        setEvents(Array.isArray(res?.events) ? res.events : []);
      } catch (e) {
        if (alive) setErr(e?.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, [run.runId]);

  if (err) return <div style={d.placeholder}>Channel replay failed: {err}</div>;
  if (events === null) return <div style={d.placeholder}>Loading channel events…</div>;
  if (events.length === 0) return <div style={d.placeholder}>No channel events archived for this run.</div>;

  return (
    <ol style={d.timeline}>
      {events.map((ev) => {
        const km = KIND_META[ev.kind] || { icon: '·', color: '#94a3b8', label: ev.kind };
        return (
          <li key={ev.tokenId} style={d.tEvt}>
            <span style={{ ...d.tDot, color: km.color, borderColor: km.color + '60' }}>{km.icon}</span>
            <div style={d.tCol}>
              <div style={d.tHead}>
                <span style={{ ...d.tKind, color: km.color, borderColor: km.color + '40', background: km.color + '12' }}>{km.label}</span>
                <span style={d.tWorker}>{ev.workerId || '—'}</span>
                <span style={d.tTime}>{ev.postedAt ? new Date(ev.postedAt).toLocaleTimeString() : ''}</span>
                <span style={d.tTok}>#{ev.tokenId}</span>
              </div>
              {ev.payload && Object.keys(ev.payload).length > 0 && (
                <pre style={d.tPayload}>{stringifyPayload(ev.payload)}</pre>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TranscriptsView({ run }) {
  const transcripts = Array.isArray(run.transcripts) ? run.transcripts : [];
  const [openId, setOpenId] = useState(transcripts[0] || null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!openId) { setContent(null); return; }
    let alive = true;
    setLoading(true); setContent(null);
    (async () => {
      try {
        const raw = await window.flowade?.swarm?.runs?.getTranscript?.(run.runId, openId);
        if (alive) setContent(raw ?? '');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [run.runId, openId]);

  if (transcripts.length === 0) {
    return <div style={d.placeholder}>No transcripts archived for this run.</div>;
  }

  return (
    <div style={d.transcripts}>
      <div style={d.paneTabs}>
        {transcripts.map(tid => (
          <button
            key={tid}
            type="button"
            onClick={() => setOpenId(tid)}
            style={{ ...d.paneTab, ...(openId === tid ? d.paneTabActive : null) }}
            title={tid}
          >
            {labelForTerminal(tid, run)}
          </button>
        ))}
      </div>
      <div style={d.transcriptBody}>
        {loading && <div style={d.placeholder}>Loading…</div>}
        {!loading && content !== null && (
          content.length === 0
            ? <div style={d.placeholder}>(empty log)</div>
            : <pre style={d.pre}>{stripAnsi(content)}</pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...p.filter, ...(active ? p.filterActive : null) }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div style={d.stat}>
      <div style={d.statLabel}>{label}</div>
      <div style={d.statValue}>{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...d.tab, ...(active ? d.tabActive : null) }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#f1f5f9'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#94a3b8'; }}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }) {
  return <div style={d.sectionLabel}>{children}</div>;
}

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  const copy = () => {
    try {
      navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <button type="button" onClick={copy} style={d.copyBtn} title="Copy runId">
      {copied ? '✓' : '⧉'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function relativeTime(ts) {
  if (!ts) return '';
  const d = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(d)) return '';
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  try { return new Date(ts).toLocaleDateString(); } catch { return ''; }
}

function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function stringifyPayload(obj) {
  try {
    const s = JSON.stringify(obj, null, 2);
    return s.length > 1200 ? s.slice(0, 1200) + '\n…' : s;
  } catch { return String(obj); }
}

function stripAnsi(s) {
  // Strip CSI sequences + OSC + a few common control chars so the pre
  // tag shows readable text. Not a full terminal renderer.
  return String(s)
    .replace(/\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\][^]*/g, '')
    .replace(/\r/g, '');
}

function labelForTerminal(tid, run) {
  // panes array on meta has names; fall back to short id.
  const panes = Array.isArray(run.panes) ? run.panes : [];
  const match = panes.find(pn => pn?.terminalId === tid || pn?.paneId === tid);
  if (match) return match.label || match.role || tid.slice(0, 10) + '…';
  if (run.userTerminalId === tid) return 'User';
  if (Array.isArray(run.terminalIds) && run.terminalIds[0] === tid) return 'Orchestrator';
  return tid.length > 14 ? tid.slice(0, 12) + '…' : tid;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const p = {
  root: {
    flex: 1, minHeight: 0, minWidth: 0,
    display: 'flex', flexDirection: 'column',
    fontFamily: FONT_MONO, color: '#f1f5f9',
  },
  head: {
    padding: '24px 32px 14px',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    gap: 16,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    flexShrink: 0,
  },
  h1: { fontFamily: FONT_DISP, fontWeight: 800, fontSize: 26, letterSpacing: '-0.02em', margin: '0 0 4px' },
  sub: { fontSize: 11, color: '#94a3b8', margin: 0 },
  headRight: { display: 'flex', alignItems: 'center', gap: 6 },
  filter: {
    all: 'unset', cursor: 'pointer',
    padding: '5px 12px', borderRadius: 99,
    fontSize: 11, color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.10)',
    transition: 'all 0.15s',
  },
  filterActive: {
    color: '#4de6f0',
    background: 'rgba(77,230,240,0.08)',
    borderColor: 'rgba(77,230,240,0.4)',
  },
  refreshBtn: {
    all: 'unset', cursor: 'pointer',
    width: 28, height: 28, borderRadius: 6,
    display: 'grid', placeItems: 'center',
    color: '#94a3b8', fontSize: 14,
    border: '1px solid rgba(255,255,255,0.08)',
    marginLeft: 4,
    transition: 'all 0.12s',
  },

  body: {
    flex: 1, minHeight: 0,
    display: 'grid', gridTemplateColumns: '340px 1fr',
  },
  listCol: {
    borderRight: '1px solid rgba(255,255,255,0.05)',
    overflowY: 'auto',
    padding: '10px 10px 32px',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  detailCol: {
    overflowY: 'auto', minWidth: 0,
  },
  empty: {
    padding: '32px 18px', textAlign: 'center',
    fontSize: 11, color: '#4a5168', lineHeight: 1.6,
  },
  code: {
    fontFamily: FONT_MONO, fontSize: 10,
    padding: '2px 6px', borderRadius: 4,
    background: 'rgba(255,255,255,0.04)', color: '#94a3b8',
  },
  row: {
    all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
    padding: '12px 12px 10px',
    borderRadius: 10,
    border: '1px solid transparent',
    transition: 'all 0.12s',
    position: 'relative',
  },
  rowActive: {
    background: 'linear-gradient(180deg, rgba(77,230,240,0.10), rgba(77,230,240,0.03))',
    borderColor: 'rgba(77,230,240,0.30)',
    boxShadow: '0 0 0 1px rgba(77,230,240,0.10) inset',
  },
  rowHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  rowMeta: { fontSize: 10, color: '#4a5168' },
  rowTitle: {
    fontSize: 12.5, color: '#f1f5f9',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  rowFoot: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chipMuted: {
    fontSize: 9.5, letterSpacing: '0.05em',
    padding: '2px 7px', borderRadius: 99,
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#94a3b8',
  },
  rowId: {
    position: 'absolute', top: 10, right: 12,
    fontSize: 9, color: '#3a4156', letterSpacing: '0.04em',
    pointerEvents: 'none',
    fontFamily: FONT_MONO,
  },
  statusPill: {
    fontFamily: FONT_TECH, fontSize: 9, fontWeight: 700,
    letterSpacing: '0.18em', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: 99,
    border: '1px solid',
    whiteSpace: 'nowrap',
  },
  placeholder: {
    padding: '48px 32px', textAlign: 'center',
    color: '#4a5168', fontSize: 12, lineHeight: 1.6,
  },
};

const d = {
  root: {
    padding: '24px 32px 48px',
    display: 'flex', flexDirection: 'column', gap: 18,
    minWidth: 0,
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  runIdRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  runId: {
    fontFamily: FONT_MONO, fontSize: 10.5, color: '#4a5168',
    padding: '2px 8px', borderRadius: 5,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  copyBtn: {
    all: 'unset', cursor: 'pointer',
    width: 22, height: 22, borderRadius: 5,
    display: 'grid', placeItems: 'center',
    color: '#94a3b8', fontSize: 11,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  task: {
    fontFamily: FONT_DISP, fontWeight: 700,
    fontSize: 22, letterSpacing: '-0.01em', margin: 0,
    color: '#f1f5f9',
  },

  statRow: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
    padding: 14, borderRadius: 12,
    background: 'rgba(10, 14, 24, 0.55)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  stat: { display: 'flex', flexDirection: 'column', gap: 4 },
  statLabel: {
    fontFamily: FONT_TECH, fontSize: 9, fontWeight: 600,
    letterSpacing: '0.28em', textTransform: 'uppercase',
    color: '#4de6f0', opacity: 0.55,
  },
  statValue: { fontFamily: FONT_MONO, fontSize: 12, color: '#f1f5f9' },

  tabBar: {
    display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  tab: {
    all: 'unset', cursor: 'pointer',
    padding: '10px 14px',
    fontFamily: FONT_MONO, fontSize: 12,
    color: '#94a3b8',
    borderBottom: '2px solid transparent',
    transition: 'all 0.12s',
  },
  tabActive: { color: '#4de6f0', borderBottom: '2px solid #4de6f0' },

  tabBody: { paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 14 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionLabel: {
    fontFamily: FONT_TECH, fontSize: 9, fontWeight: 700,
    letterSpacing: '0.28em', textTransform: 'uppercase',
    color: '#4de6f0', opacity: 0.65,
  },
  pre: {
    fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.55,
    color: '#cbd5e1',
    padding: 16, borderRadius: 10,
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.06)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    margin: 0,
    maxHeight: 480, overflowY: 'auto',
  },
  placeholder: { padding: '32px 12px', color: '#4a5168', fontSize: 12, textAlign: 'center' },

  timeline: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  tEvt: { display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12 },
  tDot: {
    width: 26, height: 26, borderRadius: '50%',
    border: '1.5px solid', background: 'rgba(0,0,0,0.25)',
    display: 'grid', placeItems: 'center', fontSize: 13,
    marginTop: 2,
  },
  tCol: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  tHead: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  tKind: {
    fontFamily: FONT_TECH, fontSize: 9, fontWeight: 700,
    letterSpacing: '0.18em', textTransform: 'uppercase',
    padding: '2px 7px', borderRadius: 99,
    border: '1px solid',
  },
  tWorker: { fontSize: 11, color: '#f1f5f9' },
  tTime: { fontSize: 10, color: '#4a5168' },
  tTok: { fontSize: 10, color: '#3a4156', marginLeft: 'auto' },
  tPayload: {
    fontFamily: FONT_MONO, fontSize: 10.5, lineHeight: 1.5,
    color: '#94a3b8',
    margin: 0, padding: '8px 10px', borderRadius: 8,
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.04)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },

  transcripts: { display: 'flex', flexDirection: 'column', gap: 8 },
  paneTabs: {
    display: 'flex', gap: 4, flexWrap: 'wrap',
    paddingBottom: 4,
  },
  paneTab: {
    all: 'unset', cursor: 'pointer',
    padding: '5px 12px', borderRadius: 6,
    fontFamily: FONT_MONO, fontSize: 11,
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.08)',
    transition: 'all 0.12s',
  },
  paneTabActive: {
    color: '#4de6f0',
    background: 'rgba(77,230,240,0.08)',
    borderColor: 'rgba(77,230,240,0.40)',
  },
  transcriptBody: { display: 'flex' },
};

// Glasshouse settings page — inline, real wiring. Subnav + section cards.
// API keys read/write via window.flowade.env (which routes to OS keychain
// for SECRET_KEYS via keytar).

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import LegalDocViewer from './LegalDocViewer';
import { getKeybindings, saveKeybinding, resetKeybindings, detectConflicts } from '../../lib/keybindings';
import SwarmSettingsPanel, { SWARM_SETTING_KEYS, SWARM_SETTING_DEFAULTS } from '../swarm/SwarmSettingsPanel';

const FONT_DISP = 'var(--gh-font-display, "Outfit", sans-serif)';
const FONT_TECH = 'var(--gh-font-techno, "Chakra Petch", sans-serif)';
const FONT_MONO = 'var(--gh-font-mono, "JetBrains Mono", monospace)';

const SECTIONS = [
  { id: 'account',     label: 'Account' },
  { id: 'keys',        label: 'API Keys' },
  { id: 'memory',      label: 'Memory' },
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'notify',      label: 'Notifications' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'legal',       label: 'Legal' },
];

const KEY_DEFS = [
  { id: 'ANTHROPIC_API_KEY', label: 'Anthropic',   desc: 'Claude — required for AI chat & categorization' },
  { id: 'OPENAI_API_KEY',    label: 'OpenAI',      desc: 'GPT + embeddings (semantic search)' },
  { id: 'GITHUB_PAT',        label: 'GitHub PAT',  desc: 'Repo access for code search & PR helper' },
];

export default function SettingsGlasshouse({ onLogout }) {
  const [section, setSection] = useState('keys');

  return (
    <div style={s.root}>
      <div style={s.head}>
        <h1 style={s.h1}>Settings</h1>
        <p style={s.sub}>Preferences sync across devices · API keys stay local</p>
      </div>

      <div style={s.layout}>
        <nav style={s.subnav}>
          {SECTIONS.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              style={{ ...s.subnavLink, ...(section === item.id ? s.subnavLinkActive : null) }}
            >
              {item.label}
            </button>
          ))}
          <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={onLogout} style={{ ...s.subnavLink, color: '#ff6b6b' }}>Sign out</button>
          </div>
        </nav>

        <div style={s.card}>
          {section === 'account'      && <AccountSection />}
          {section === 'keys'         && <KeysSection />}
          {section === 'memory'       && <MemorySection />}
          {section === 'keybindings'  && <KeybindingsSection />}
          {section === 'notify'       && <NotificationsSection />}
          {section === 'integrations' && <IntegrationsSection />}
          {section === 'legal'        && <LegalSection />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function AccountSection() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('flowade_auth_user') || '{}')); } catch {}
  }, []);
  return (
    <>
      <h2 style={s.cardH2}>Account</h2>
      <p style={s.cardSub}>Workspace identity · email · sign-in info.</p>
      <Row label="Name">
        <input style={s.textInput} defaultValue={user?.name || ''} />
      </Row>
      <Row label="Email">
        <input style={s.textInput} defaultValue={user?.email || ''} disabled />
      </Row>
      <Row label="Workspace">
        <input style={s.textInput} defaultValue="Default" />
      </Row>
      <Row label="Plan">
        <span style={{ ...s.tag, color: '#4de6f0', borderColor: 'rgba(77,230,240,0.3)' }}>Trial · 6 days left</span>
      </Row>
    </>
  );
}

function KeysSection() {
  const [keys, setKeys] = useState({});
  const [savedAt, setSavedAt] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all(
      KEY_DEFS.map(k => window.flowade?.env?.get?.(k.id).then(v => [k.id, v]))
    ).then(rows => {
      if (!alive) return;
      const obj = {};
      rows.forEach(r => { if (r) obj[r[0]] = r[1] || ''; });
      setKeys(obj);
    });
    return () => { alive = false; };
  }, []);

  const setKey = useCallback(async (id, value) => {
    setKeys(k => ({ ...k, [id]: value }));
    try {
      await window.flowade?.env?.set?.(id, value);
      setSavedAt(s2 => ({ ...s2, [id]: Date.now() }));
    } catch {}
  }, []);

  return (
    <>
      <h2 style={s.cardH2}>API Keys</h2>
      <p style={s.cardSub}>Stored in your OS keychain — never sent to FlowADE servers.</p>
      {KEY_DEFS.map(k => {
        const recent = savedAt[k.id] && Date.now() - savedAt[k.id] < 2500;
        return (
          <div key={k.id} style={s.row}>
            <div style={s.rowLeft}>
              <div style={s.rowLabel}>{k.label}</div>
              <div style={s.rowDesc}>{k.desc}</div>
            </div>
            <input
              type="password"
              value={keys[k.id] ?? ''}
              onChange={(e) => setKey(k.id, e.target.value)}
              placeholder={`${k.id.toLowerCase().includes('pat') ? 'ghp_' : 'sk-'}...`}
              style={{ ...s.keyInput, ...(recent ? { borderColor: '#4de6f0', boxShadow: '0 0 0 3px rgba(77,230,240,0.12)' } : null) }}
            />
          </div>
        );
      })}
      <div style={s.vault}>
        <span style={{ color: '#4de6f0', fontSize: 18 }}>🔒</span>
        <div>
          <div style={s.vaultH}>Stored in your OS keychain</div>
          <div style={s.vaultB}>Same place Windows holds your wifi passwords. Never sent to FlowADE servers, never written to disk in plaintext.</div>
        </div>
      </div>
    </>
  );
}

function MemorySection() {
  const [auto, setAuto] = useState(() => readBool('flowade.mem.autoCategorize', true));
  const [embed, setEmbed] = useState(() => readBool('flowade.mem.autoEmbed', true));
  const [sync, setSync] = useState(() => readBool('flowade.mem.syncMobile', true));

  // Swarm transcript retention — controls the on-disk archive under
  // {userData}/flowade-data/swarm-transcripts/. Default ON, 30 days.
  const [purgeEnabled, setPurgeEnabled] = useState(() => readBool('flowade.swarm.purgeEnabled', true));
  const [retentionDays, setRetentionDays] = useState(() => {
    try {
      const raw = localStorage.getItem('flowade.swarm.retentionDays');
      const n = raw ? parseInt(raw, 10) : 30;
      return Number.isFinite(n) ? Math.max(1, Math.min(365, n)) : 30;
    } catch { return 30; }
  });
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);

  const updateRetentionDays = (raw) => {
    const n = parseInt(raw, 10);
    const clamped = Number.isFinite(n) ? Math.max(1, Math.min(365, n)) : 30;
    setRetentionDays(clamped);
    try { localStorage.setItem('flowade.swarm.retentionDays', String(clamped)); } catch {}
  };

  const purgeNow = async () => {
    if (purgeBusy) return;
    setPurgeBusy(true);
    setPurgeResult(null);
    try {
      const res = await window.flowade?.swarm?.purgeNow?.({ retentionDays, purgeEnabled });
      setPurgeResult(res || { purged: 0 });
    } catch (err) {
      setPurgeResult({ purged: 0, errors: [{ error: err?.message || String(err) }] });
    } finally {
      setPurgeBusy(false);
    }
  };

  return (
    <>
      <h2 style={s.cardH2}>Memory</h2>
      <p style={s.cardSub}>How knowledge gets organized.</p>
      <Toggle label="Auto-categorize on create" desc="Slot every new memory into a leaf via Haiku 4.5." on={auto} onChange={(v) => { setAuto(v); writeBool('flowade.mem.autoCategorize', v); }} />
      <Toggle label="Auto-embed on create" desc="Compute vector for semantic search." on={embed} onChange={(v) => { setEmbed(v); writeBool('flowade.mem.autoEmbed', v); }} />
      <Toggle label="Sync to mobile" desc="Real-time cross-device updates." on={sync} onChange={(v) => { setSync(v); writeBool('flowade.mem.syncMobile', v); }} />

      <Toggle
        label="Auto-purge old swarm transcripts"
        desc="Run a background sweep on app start that deletes finished swarm runs older than the retention window."
        on={purgeEnabled}
        onChange={(v) => { setPurgeEnabled(v); writeBool('flowade.swarm.purgeEnabled', v); }}
      />
      <Row label="Retention days">
        <input
          type="number"
          min={1}
          max={365}
          value={retentionDays}
          disabled={!purgeEnabled}
          onChange={(e) => updateRetentionDays(e.target.value)}
          style={{ ...s.textInput, width: 120, opacity: purgeEnabled ? 1 : 0.5 }}
        />
      </Row>
      <Row label="Purge now">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={purgeNow}
            disabled={purgeBusy}
            style={{
              all: 'unset', cursor: purgeBusy ? 'wait' : 'pointer',
              padding: '6px 14px', borderRadius: 6,
              background: 'rgba(77,230,240,0.10)',
              border: '1px solid rgba(77,230,240,0.32)',
              color: '#4de6f0',
              fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
              opacity: purgeBusy ? 0.6 : 1,
            }}
          >
            {purgeBusy ? 'Purging…' : 'Run purge'}
          </button>
          {purgeResult && (
            <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: FONT_MONO }}>
              {Number.isFinite(purgeResult.purged) ? `Purged ${purgeResult.purged} of ${purgeResult.scanned ?? '?'}` : 'Purge failed'}
              {purgeResult.errors && purgeResult.errors.length > 0 && ' · errors logged'}
            </span>
          )}
        </div>
      </Row>
    </>
  );
}

function PlaceholderSection({ title, body }) {
  return (
    <>
      <h2 style={s.cardH2}>{title}</h2>
      <p style={s.cardSub}>{body}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Legal — lists the current legal docs with version + last-accepted info.
// Documents live in the repo at /legal/* and are bundled with the build so
// users can read them offline. Links open in the user's default browser
// via the existing shell.openExternal IPC.
// ---------------------------------------------------------------------------

const LEGAL_DOCS = [
  { id: 'tos',      label: 'Terms of Service' },
  { id: 'privacy',  label: 'Privacy Policy' },
  { id: 'aup',      label: 'Acceptable Use Policy' },
  { id: 'ai',       label: 'AI Output Disclaimer' },
  { id: 'cookies',  label: 'Cookie & Local Storage' },
  { id: 'dmca',     label: 'DMCA Policy' },
  { id: 'license',  label: 'Software License' },
];

function LegalSection() {
  const [viewingDoc, setViewingDoc] = useState(null);
  const acceptedAt = (() => { try { return localStorage.getItem('flowade.legal.acceptedAt'); } catch { return null; } })();
  const acceptedVersion = (() => { try { return localStorage.getItem('flowade.legal.acceptedVersion'); } catch { return null; } })();

  return (
    <>
      <h2 style={s.cardH2}>Legal</h2>
      <p style={s.cardSub}>
        FlowADE is governed by the documents below. You agreed to them when you created your account.
        We will email you at least 30 days before any material change.
      </p>

      <div style={legalStyles.acceptanceBox}>
        <div style={legalStyles.acceptanceLabel}>YOUR ACCEPTANCE</div>
        {acceptedAt ? (
          <div style={legalStyles.acceptanceMeta}>
            <div>Accepted: <span style={legalStyles.acceptanceValue}>{new Date(acceptedAt).toLocaleString()}</span></div>
            <div>Version: <span style={legalStyles.acceptanceValue}>{acceptedVersion || 'unknown'}</span></div>
          </div>
        ) : (
          <div style={legalStyles.acceptanceMeta}>No acceptance recorded locally — re-accept via Sign out → Sign in.</div>
        )}
      </div>

      <div style={legalStyles.docList}>
        {LEGAL_DOCS.map(doc => (
          <button
            key={doc.id}
            onClick={() => setViewingDoc(doc.id)}
            style={legalStyles.docRow}
          >
            <span style={legalStyles.docLabel}>{doc.label}</span>
            <span style={legalStyles.docOpen}>Read →</span>
          </button>
        ))}
      </div>

      <p style={{ ...s.cardSub, marginTop: 14, fontSize: 11 }}>
        Questions? legal@flowade.com — for privacy-rights requests use privacy@flowade.com.
      </p>

      {viewingDoc && <LegalDocViewer docId={viewingDoc} onClose={() => setViewingDoc(null)} />}
    </>
  );
}

const legalStyles = {
  acceptanceBox: {
    padding: '12px 14px',
    background: 'rgba(77,230,240,0.04)',
    border: '1px solid rgba(77,230,240,0.18)',
    borderRadius: 8,
    marginBottom: 14,
  },
  acceptanceLabel: {
    fontFamily: 'var(--gh-font-techno, "Chakra Petch", sans-serif)',
    fontSize: 9, fontWeight: 700,
    letterSpacing: '0.32em', textTransform: 'uppercase',
    color: '#4de6f0',
    marginBottom: 6,
  },
  acceptanceMeta: {
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 1.6,
  },
  acceptanceValue: { color: '#f1f5f9', fontWeight: 600 },
  docList: { display: 'flex', flexDirection: 'column', gap: 6 },
  docRow: {
    all: 'unset', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    transition: 'background .15s, border-color .15s',
  },
  docLabel: {
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 12, fontWeight: 600,
    color: '#f1f5f9',
  },
  docOpen: {
    fontFamily: 'var(--gh-font-mono, monospace)',
    fontSize: 10,
    color: '#4de6f0',
    letterSpacing: '0.04em',
  },
};

// ---------------------------------------------------------------------------
// Keybindings — inline editor backed by src/lib/keybindings.js
// ---------------------------------------------------------------------------
function KeybindingsSection() {
  const [bindings, setBindings] = useState(() => getKeybindings());
  const [recordingId, setRecordingId] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [filter, setFilter] = useState('');

  // Capture key combos while recording.
  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setRecordingId(null); setConflict(null); return; }
      // Modifiers alone don't count.
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      let main = e.key;
      if (main === ' ') main = 'Space';
      if (main === 'Tab') main = 'Tab';
      else if (main.length === 1) main = main.toUpperCase();
      parts.push(main);
      const combo = parts.join('+');
      const conf = detectConflicts(recordingId, combo);
      if (conf) {
        setConflict({ id: recordingId, combo, with: conf.label });
        return;
      }
      saveKeybinding(recordingId, combo);
      setBindings(getKeybindings());
      setRecordingId(null);
      setConflict(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recordingId]);

  const grouped = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    const filtered = lc ? bindings.filter(b =>
      b.label.toLowerCase().includes(lc) || b.key.toLowerCase().includes(lc) || b.category.toLowerCase().includes(lc)
    ) : bindings;
    const out = {};
    for (const b of filtered) (out[b.category] ||= []).push(b);
    return out;
  }, [bindings, filter]);

  const reset = () => {
    if (!confirm('Reset every shortcut to its default?')) return;
    resetKeybindings();
    setBindings(getKeybindings());
  };

  return (
    <>
      <h2 style={s.cardH2}>Keybindings</h2>
      <p style={s.cardSub}>Customize keyboard shortcuts for terminal, layout, and navigation actions. Click a row to record a new combo; Esc cancels.</p>

      <div style={kb.toolbar}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter shortcuts…"
          style={kb.filterInput}
        />
        <button onClick={reset} style={kb.resetBtn}>Reset to defaults</button>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} style={kb.group}>
          <div style={kb.groupLabel}>{category}</div>
          {items.map(b => {
            const recording = recordingId === b.id;
            const conf = conflict && conflict.id === b.id ? conflict : null;
            const isCustom = b.key !== b.defaultKey;
            return (
              <div key={b.id} style={kb.row}>
                <div style={kb.rowLeft}>
                  <div style={kb.rowLabel}>{b.label}</div>
                  {isCustom && <div style={kb.rowDefault}>default: <kbd style={kb.kbdMute}>{b.defaultKey}</kbd></div>}
                  {conf && <div style={kb.conflictWarn}>{conf.combo} is already used by <strong>{conf.with}</strong>. Pick another or Esc.</div>}
                </div>
                <button
                  onClick={() => { setRecordingId(b.id); setConflict(null); }}
                  style={{ ...kb.combo, ...(recording ? kb.comboRecording : null), ...(isCustom && !recording ? kb.comboCustom : null) }}
                >
                  {recording ? 'Press combo… (Esc to cancel)' : <KeyChips combo={b.key} />}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function KeyChips({ combo }) {
  const parts = combo.split('+');
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <kbd style={kb.kbd}>{p}</kbd>
          {i < parts.length - 1 && <span style={kb.plus}>+</span>}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Notifications — push tokens + recent events + enable toggle
// ---------------------------------------------------------------------------
function NotificationsSection() {
  const [enabled, setEnabled] = useState(true);
  const [terminalDone, setTerminalDone] = useState(() => {
    try { const v = localStorage.getItem('flowade.notify.terminalDone'); return v === null || v === '1'; } catch { return true; }
  });
  const [tokens, setTokens] = useState([]);
  const [events, setEvents] = useState([]);
  const eventsRef = useRef([]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    (async () => {
      const t = await window.flowade?.notify?.getTokens?.() || [];
      setTokens(Array.isArray(t) ? t : []);
    })();
    try {
      const raw = localStorage.getItem('flowade_notifications');
      if (raw) setEvents(JSON.parse(raw).slice(0, 50));
    } catch {}
    const unsub = window.flowade?.notify?.onEvent?.((evt) => {
      const next = [evt, ...eventsRef.current].slice(0, 50);
      setEvents(next);
      try { localStorage.setItem('flowade_notifications', JSON.stringify(next)); } catch {}
    });
    return () => { unsub?.(); };
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await window.flowade?.notify?.setEnabled?.(next);
  };

  const removeToken = async (tok) => {
    await window.flowade?.notify?.removeToken?.(tok);
    const t = await window.flowade?.notify?.getTokens?.() || [];
    setTokens(Array.isArray(t) ? t : []);
  };

  return (
    <>
      <h2 style={s.cardH2}>Notifications & Devices</h2>
      <p style={s.cardSub}>Mobile push notifications, build / test / deploy events from your terminals.</p>

      <Toggle
        label="Prompt-done banners"
        desc="Top-center toast when a terminal finishes the prompt you submitted. Useful when running many panes in parallel."
        on={terminalDone}
        onChange={(v) => {
          setTerminalDone(v);
          try { localStorage.setItem('flowade.notify.terminalDone', v ? '1' : '0'); } catch {}
        }}
      />

      <Toggle
        label="Enable push notifications"
        desc="Receive build, test, and deploy notifications on registered mobile devices."
        on={enabled} onChange={toggle}
      />

      <div style={s.row}>
        <div style={s.rowLeft}>
          <div style={s.rowLabel}>Registered devices</div>
          <div style={s.rowDesc}>Pair a phone in the FlowADE mobile app to add a device. Each device shows its push token below.</div>
        </div>
        <span style={notif.deviceCount}>{tokens.length}</span>
      </div>

      {tokens.length === 0 ? (
        <div style={notif.empty}>No devices paired. Open FlowADE on iOS / Android, sign in, and they'll show up here.</div>
      ) : (
        <div style={notif.deviceList}>
          {tokens.map((tok) => {
            const t = typeof tok === 'string' ? { token: tok } : tok;
            const short = (t.token || '').slice(0, 28) + '…';
            return (
              <div key={t.token} style={notif.device}>
                <div style={notif.deviceMeta}>
                  <div style={notif.deviceLabel}>{t.label || 'Device'}</div>
                  <div style={notif.deviceTok} title={t.token}>{short}</div>
                </div>
                <button onClick={() => removeToken(t.token)} style={notif.removeBtn}>Remove</button>
              </div>
            );
          })}
        </div>
      )}

      <div style={s.row}>
        <div style={s.rowLeft}>
          <div style={s.rowLabel}>Recent events</div>
          <div style={s.rowDesc}>Last 50 build / test / deploy / crash events sent to mobile.</div>
        </div>
      </div>

      {events.length === 0 ? (
        <div style={notif.empty}>Nothing yet. Run a build or test in a terminal to see events here.</div>
      ) : (
        <div style={notif.eventList}>
          {events.map((evt, i) => (
            <div key={i} style={notif.event}>
              <span style={notif.evIcon}>{({
                build_success: '✅', build_error: '❌', test_pass: '✅', test_fail: '❌',
                server_start: '🚀', deploy_done: '🚢', install_done: '📦',
                crash: '💥', exit: '⏹️',
              })[evt.type] || '•'}</span>
              <div style={notif.evMeta}>
                <div style={notif.evTitle}>{evt.title || evt.type}</div>
                {evt.body && <div style={notif.evBody}>{evt.body}</div>}
              </div>
              <div style={notif.evTime}>{relativeTime(evt.timestamp || evt.ts)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Integrations — Slack / Linear / GitHub bridges (Pro+ tiers)
// ---------------------------------------------------------------------------
const INTEGRATIONS = [
  {
    id: 'github',
    name: 'GitHub',
    desc: 'Pull request notifications, repo activity feed, code search across your orgs. Reads PAT from your keychain.',
    color: '#94a3b8',
    icon: 'GH',
    status: 'connected',
    tier: 'Pro',
  },
  {
    id: 'slack',
    name: 'Slack',
    desc: 'Send terminal output snippets, build alerts, or AI thread summaries to a Slack channel.',
    color: '#a8a4c8',
    icon: 'SL',
    status: 'available',
    tier: 'Team',
  },
  {
    id: 'linear',
    name: 'Linear',
    desc: 'Surface issues + cycles in the Tasks panel. Two-way sync between Linear projects and FlowADE workspaces.',
    color: '#88c8f0',
    icon: 'LI',
    status: 'available',
    tier: 'Team',
  },
  {
    id: 'discord',
    name: 'Discord',
    desc: 'Mirror activity feed events to a Discord channel. Useful for indie team standups.',
    color: '#c0c8d8',
    icon: 'DC',
    status: 'planned',
    tier: 'Pro',
  },
  {
    id: 'webhook',
    name: 'Generic webhook',
    desc: 'Fire JSON payloads on terminal / build / memory events to a URL of your choice.',
    color: '#88f0d8',
    icon: 'WH',
    status: 'planned',
    tier: 'Pro',
  },
];

function IntegrationsSection() {
  // Swarm settings live in the same SettingsStore as the rest of the
  // app. Load on mount, write through on change so the WS bridge in
  // main.js picks up flips at next app start (or immediately for
  // settings that have hot-reload paths).
  const [swarm, setSwarm] = useState(SWARM_SETTING_DEFAULTS);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const entries = await Promise.all(
          Object.entries(SWARM_SETTING_KEYS).map(async ([k, key]) => {
            const v = await window.flowade?.settings?.get?.(key);
            return [k, (v === undefined || v === null) ? SWARM_SETTING_DEFAULTS[k] : v];
          })
        );
        if (alive) setSwarm(Object.fromEntries(entries));
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  const onSwarmChange = useCallback((key, value) => {
    setSwarm((s) => ({ ...s, [key]: value }));
    const storeKey = SWARM_SETTING_KEYS[key];
    if (storeKey) window.flowade?.settings?.set?.(storeKey, value).catch(() => {});
  }, []);

  return (
    <>
      <h2 style={s.cardH2}>Integrations</h2>
      <p style={s.cardSub}>Connect FlowADE to the tools your team already uses. New integrations land at the start of every quarter.</p>

      <SwarmSettingsPanel values={swarm} onChange={onSwarmChange} />

      <div style={ig.grid}>
        {INTEGRATIONS.map(it => (
          <div key={it.id} style={{ ...ig.card, ...(it.status === 'connected' ? ig.cardConnected : null) }}>
            <div style={ig.cardHead}>
              <div style={{ ...ig.icon, background: it.color + '20', borderColor: it.color + '40', color: it.color }}>{it.icon}</div>
              <div style={ig.cardMeta}>
                <div style={ig.cardName}>{it.name}</div>
                <div style={ig.cardTier}>{it.tier} tier</div>
              </div>
              <span style={{ ...ig.statusPill, ...(it.status === 'connected' ? ig.statusConnected : it.status === 'available' ? ig.statusAvailable : ig.statusPlanned) }}>
                {it.status === 'connected' ? '● connected' : it.status === 'available' ? 'available' : 'planned'}
              </span>
            </div>
            <p style={ig.cardDesc}>{it.desc}</p>
            <button style={{ ...ig.cardBtn, ...(it.status === 'connected' ? ig.cardBtnConnected : it.status === 'available' ? ig.cardBtnAvailable : ig.cardBtnPlanned) }}>
              {it.status === 'connected' ? 'Manage…' : it.status === 'available' ? 'Connect' : 'Notify when ready'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function relativeTime(ts) {
  if (!ts) return '';
  const d = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(d)) return '';
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
function Row({ label, children }) {
  return (
    <div style={s.row}>
      <div style={s.rowLeft}>
        <div style={s.rowLabel}>{label}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, desc, on, onChange }) {
  return (
    <div style={s.row}>
      <div style={s.rowLeft}>
        <div style={s.rowLabel}>{label}</div>
        <div style={s.rowDesc}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!on)}
        aria-pressed={on}
        style={{
          all: 'unset', cursor: 'pointer',
          width: 38, height: 22, borderRadius: 99,
          background: on ? 'rgba(77,230,240,0.18)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${on ? 'rgba(77,230,240,0.4)' : 'rgba(255,255,255,0.13)'}`,
          position: 'relative',
          transition: 'all 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 1, left: on ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: on ? '#4de6f0' : '#94a3b8',
          transition: 'all 0.18s',
        }} />
      </button>
    </div>
  );
}

function readBool(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch { return def; }
}
function writeBool(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch {}
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const s = {
  root: { flex: 1, padding: '32px 36px', overflowY: 'auto', minHeight: 0 },
  head: { marginBottom: 24, maxWidth: 720 },
  h1: { fontFamily: FONT_DISP, fontWeight: 800, fontSize: 32, letterSpacing: '-0.03em', margin: '0 0 6px' },
  sub: { fontSize: 13, color: '#94a3b8', margin: 0, fontFamily: FONT_MONO },

  layout: { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'start' },

  subnav: {
    display: 'flex', flexDirection: 'column', gap: 2,
    minHeight: 320,
  },
  subnavLink: {
    all: 'unset', cursor: 'pointer',
    padding: '8px 12px', borderRadius: 8,
    fontFamily: FONT_MONO, fontSize: 12,
    color: '#94a3b8',
    transition: 'all 0.15s',
  },
  subnavLinkActive: {
    background: 'rgba(77,230,240,0.08)',
    color: '#4de6f0',
  },

  card: {
    background: 'rgba(10, 14, 24, 0.55)',
    border: '1px solid rgba(255,255,255,0.13)',
    borderRadius: 14, padding: 28,
    backdropFilter: 'blur(14px) saturate(1.15)',
  },
  cardH2: {
    fontFamily: FONT_DISP, fontWeight: 800,
    fontSize: 22, letterSpacing: '-0.02em', margin: '0 0 4px',
  },
  cardSub: {
    fontSize: 12, color: '#94a3b8', marginBottom: 22,
    fontFamily: FONT_MONO,
  },

  row: {
    display: 'grid', gridTemplateColumns: '1fr auto', gap: 16,
    padding: '14px 0', alignItems: 'center',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  rowLeft: {},
  rowLabel: { fontSize: 13, color: '#f1f5f9' },
  rowDesc: {
    fontSize: 11, color: '#94a3b8', marginTop: 3,
    fontFamily: FONT_MONO,
  },

  textInput: {
    background: 'rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.13)',
    borderRadius: 8, padding: '8px 12px',
    color: '#f1f5f9',
    fontFamily: FONT_MONO, fontSize: 12, outline: 'none',
    width: 280,
  },
  keyInput: {
    background: 'rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.13)',
    borderRadius: 8, padding: '8px 12px',
    color: '#f1f5f9',
    fontFamily: FONT_MONO, fontSize: 12, outline: 'none',
    width: 320,
    transition: 'all 0.2s',
  },
  tag: {
    fontFamily: FONT_MONO, fontSize: 10,
    padding: '4px 10px', borderRadius: 99,
    border: '1px solid rgba(255,255,255,0.13)',
    color: '#94a3b8',
  },

  vault: {
    marginTop: 16, padding: '14px 16px',
    border: '1px dashed rgba(77,230,240,0.3)', borderRadius: 10,
    background: 'rgba(77,230,240,0.04)',
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'center',
  },
  vaultH: { fontSize: 12, fontWeight: 600, color: '#4de6f0', marginBottom: 3 },
  vaultB: { fontSize: 11, color: '#94a3b8', lineHeight: 1.5, fontFamily: FONT_MONO },
};

// Keybindings styles
const kb = {
  toolbar: {
    display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18,
  },
  filterInput: {
    flex: 1, background: 'rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.13)',
    borderRadius: 8, padding: '8px 12px',
    color: '#f1f5f9', fontFamily: FONT_MONO, fontSize: 12, outline: 'none',
  },
  resetBtn: {
    all: 'unset', cursor: 'pointer',
    padding: '8px 14px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.13)', color: '#94a3b8',
    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
  },
  group: { marginBottom: 18 },
  groupLabel: {
    fontFamily: FONT_TECH, fontSize: 9, fontWeight: 600,
    letterSpacing: '0.32em', textTransform: 'uppercase',
    color: '#4de6f0', opacity: 0.65, paddingBottom: 8,
    borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 4,
  },
  row: {
    display: 'grid', gridTemplateColumns: '1fr auto', gap: 16,
    padding: '10px 0', alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  rowLeft: { minWidth: 0 },
  rowLabel: { fontSize: 13, color: '#f1f5f9' },
  rowDefault: { fontSize: 10.5, color: '#4a5168', marginTop: 3, fontFamily: FONT_MONO },
  conflictWarn: {
    fontSize: 11, color: '#ff6b6b', marginTop: 6, fontFamily: FONT_MONO,
    padding: '4px 8px', background: 'rgba(255,107,107,0.08)',
    border: '1px solid rgba(255,107,107,0.25)', borderRadius: 6,
  },
  combo: {
    all: 'unset', cursor: 'pointer',
    padding: '6px 10px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.11)',
    background: 'rgba(0,0,0,0.4)',
    fontFamily: FONT_MONO, fontSize: 11,
    color: '#f1f5f9', minWidth: 110, textAlign: 'center',
  },
  comboCustom: {
    border: '1px solid rgba(77,230,240,0.35)',
    background: 'rgba(77,230,240,0.06)',
  },
  comboRecording: {
    border: '1px solid rgba(255,229,102,0.5)',
    background: 'rgba(255,229,102,0.08)',
    color: '#ffe566', fontSize: 10,
  },
  kbd: {
    fontFamily: FONT_MONO, fontSize: 10.5, padding: '2px 6px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.13)', borderRadius: 4,
    color: '#f1f5f9',
  },
  kbdMute: {
    fontFamily: FONT_MONO, fontSize: 10, padding: '1px 5px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
    color: '#94a3b8',
  },
  plus: { color: '#4a5168', fontSize: 9 },
};

// Notifications styles
const notif = {
  deviceCount: {
    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
    padding: '4px 10px', borderRadius: 99,
    background: 'rgba(77,230,240,0.1)', color: '#4de6f0',
  },
  empty: {
    padding: '14px 16px', borderRadius: 10,
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.08)',
    fontFamily: FONT_MONO, fontSize: 11, color: '#4a5168',
    textAlign: 'center', lineHeight: 1.55,
    margin: '8px 0 14px',
  },
  deviceList: { display: 'grid', gap: 6, marginBottom: 14 },
  device: {
    display: 'grid', gridTemplateColumns: '1fr auto', gap: 10,
    padding: '10px 12px', borderRadius: 8,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  deviceMeta: { minWidth: 0 },
  deviceLabel: { fontSize: 12, color: '#f1f5f9', fontFamily: FONT_MONO },
  deviceTok: {
    fontSize: 10, color: '#4a5168', marginTop: 2, fontFamily: FONT_MONO,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  removeBtn: {
    all: 'unset', cursor: 'pointer',
    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
    padding: '5px 12px', borderRadius: 6,
    border: '1px solid rgba(255,107,107,0.3)', color: '#ff6b6b',
    background: 'rgba(255,107,107,0.05)',
    fontFamily: FONT_MONO,
  },
  eventList: { display: 'grid', gap: 6 },
  event: {
    display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10,
    padding: '8px 12px', borderRadius: 8,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  evIcon: { fontSize: 14 },
  evMeta: { minWidth: 0 },
  evTitle: { fontSize: 12, color: '#f1f5f9', fontFamily: FONT_MONO },
  evBody: { fontSize: 10.5, color: '#94a3b8', marginTop: 2, fontFamily: FONT_MONO,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  evTime: { fontSize: 10, color: '#4a5168', fontFamily: FONT_MONO },
};

// Integrations styles
const ig = {
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12,
  },
  card: {
    padding: 16,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    display: 'flex', flexDirection: 'column', gap: 10,
    transition: 'all 0.15s',
  },
  cardConnected: {
    borderColor: 'rgba(77,230,240,0.3)',
    background: 'rgba(77,230,240,0.04)',
  },
  cardHead: {
    display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center',
  },
  icon: {
    width: 36, height: 36, borderRadius: 8,
    border: '1px solid', display: 'grid', placeItems: 'center',
    fontFamily: FONT_DISP, fontWeight: 700, fontSize: 12, letterSpacing: '0.05em',
  },
  cardMeta: { minWidth: 0 },
  cardName: { fontSize: 13, fontWeight: 600, color: '#f1f5f9' },
  cardTier: {
    fontSize: 10, color: '#4a5168', marginTop: 2, fontFamily: FONT_MONO,
    letterSpacing: '0.04em',
  },
  statusPill: {
    fontFamily: FONT_MONO, fontSize: 9, fontWeight: 700,
    padding: '3px 8px', borderRadius: 99,
    letterSpacing: '0.05em',
  },
  statusConnected: { background: 'rgba(88,224,168,0.12)', color: '#58e0a8' },
  statusAvailable: { background: 'rgba(77,230,240,0.1)', color: '#4de6f0' },
  statusPlanned: { background: 'rgba(255,255,255,0.04)', color: '#94a3b8' },
  cardDesc: {
    fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5, margin: 0,
    fontFamily: FONT_MONO,
  },
  cardBtn: {
    all: 'unset', cursor: 'pointer',
    padding: '8px 14px', borderRadius: 8,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
    fontFamily: FONT_MONO, textAlign: 'center', alignSelf: 'flex-start',
  },
  cardBtnConnected: {
    border: '1px solid rgba(77,230,240,0.4)',
    color: '#4de6f0', background: 'rgba(77,230,240,0.06)',
  },
  cardBtnAvailable: {
    background: 'linear-gradient(135deg, #4de6f0, #1aa9bc)',
    color: '#001014', boxShadow: '0 4px 14px rgba(77,230,240,0.2)',
  },
  cardBtnPlanned: {
    border: '1px solid rgba(255,255,255,0.13)', color: '#94a3b8',
    background: 'rgba(255,255,255,0.02)',
  },
};

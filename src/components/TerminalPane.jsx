import { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { FONTS, PROVIDERS } from '../lib/constants';
import { useTheme } from '../hooks/useTheme';
import { isGlasshouseEnabled } from '../lib/glasshouseTheme';
import { getRoleChip } from '../lib/swarmTheme';

// Platform sniff for visual chrome that should match the host OS (e.g.,
// macOS-style traffic-light dots). Falls back to navigator.platform when
// the Electron-injected platform isn't available.
function isMacPlatform() {
  try {
    if (typeof window !== 'undefined' && window.flowade?.platform === 'darwin') return true;
    const p = (typeof navigator !== 'undefined' && navigator.platform) || '';
    return /mac/i.test(p);
  } catch { return false; }
}

// Compact "host:port" label for the per-pane "Open in browser" pill.
// Falls back to the raw string if the URL won't parse so the pill never
// renders empty when the dev-server detector returns something exotic.
function shortHostLabel(url) {
  try { return new URL(url).host; } catch { return url; }
}

// Inline role chip — renders inside the pane header (NOT absolutely
// positioned), so it can't collide with the title, controls, or status
// badges. Returns null when no identity exists (web build, drag preview).
function RoleChip({ identity }) {
  if (!identity) return null;
  const chip = getRoleChip(identity);
  if (!chip) return null;
  return (
    <span
      title={identity.rootLabel ? `from ${identity.rootLabel}` : chip.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px 2px 6px',
        fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
        color: chip.color,
        background: chip.background,
        border: `1px solid ${chip.border}`,
        borderRadius: 999,
        textTransform: 'uppercase',
        flexShrink: 0,
        userSelect: 'none',
        lineHeight: 1.2,
        fontFamily: FONTS.mono,
      }}
    >
      <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>{chip.glyph}</span>
      <span>{chip.label}</span>
    </span>
  );
}
import { ToastContext } from '../contexts/ToastContext';
import { SettingsContext } from '../contexts/SettingsContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { streamChat } from '../lib/aiChat';
import { detectDevServerUrl } from '../lib/devServerDetector';

const fc = FONTS.mono;
const fb = FONTS.body;

function parseTerminalOptions(raw) {
  const text = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const last = lines.slice(-25);

  const numbered = [];
  for (const line of last) {
    const m = line.match(/^\s*(\d+)[.)]\s+(.+)/);
    if (m) numbered.push({ label: `${m[1]}. ${m[2].trim()}`, value: m[1] });
  }
  if (numbered.length >= 2) return numbered;

  const tail = last.slice(-5).join(' ');
  if (/\(y\)/i.test(tail) || /\by\/n\b/i.test(tail) || /\byes.*no\b/i.test(tail) || /\ballow\b.*\bdeny\b/i.test(tail)) {
    const opts = [{ label: 'Yes', value: 'y' }, { label: 'No', value: 'n' }];
    if (/\(a\)/i.test(tail) || /\balways\b/i.test(tail)) opts.push({ label: 'Always', value: 'a' });
    return opts;
  }
  return null;
}

function parseContextUsage(raw) {
  const text = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const m = text.match(/ctx\s+(\d+)%\s*used/);
  return m ? parseInt(m[1], 10) : null;
}

function parseTokenUsage(raw) {
  const text = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // Claude CLI: "input: 1,234 tokens | output: 567 tokens" or "Input tokens: 1234"
  const inputMatch = text.match(/input[:\s]+([0-9,]+)\s*(?:tokens|tok)/i);
  const outputMatch = text.match(/output[:\s]+([0-9,]+)\s*(?:tokens|tok)/i);
  if (inputMatch || outputMatch) {
    return {
      input: inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : 0,
      output: outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : 0,
    };
  }
  // Claude CLI cost line: "$0.0234 cost"
  const costMatch = text.match(/\$([0-9.]+)\s*(?:cost|spent|total)/i);
  if (costMatch) {
    const cost = parseFloat(costMatch[1]);
    // Estimate tokens from cost (assume Sonnet rates)
    const estInput = Math.round((cost / 3) * 1_000_000 * 0.7);
    const estOutput = Math.round((cost / 15) * 1_000_000 * 0.3);
    return { input: estInput, output: estOutput };
  }
  return null;
}

function ContextBar({ percent }) {
  const { colors } = useTheme();
  if (percent == null) return null;
  const color = percent >= 90 ? colors.status.error : percent >= 70 ? colors.status.warning : colors.accent.green;
  return (
    <div style={{ height: 3, background: colors.bg.surface, borderRadius: 2, flexShrink: 0 }}>
      <div style={{
        height: '100%', width: `${percent}%`, borderRadius: 2,
        background: color, transition: 'width .5s ease, background .5s ease',
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat message bubble for API-based providers
// ---------------------------------------------------------------------------
function ChatMessage({ msg, providerColor }) {
  const { colors } = useTheme();
  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      padding: '4px 12px',
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '8px 12px',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        background: isError
          ? `${colors.status.error}18`
          : isUser
            ? `${colors.accent.purple}18`
            : `${providerColor}12`,
        border: `1px solid ${isError ? colors.status.error + '30' : isUser ? colors.accent.purple + '25' : providerColor + '20'}`,
        color: isError ? colors.status.error : colors.text.primary,
        fontFamily: fc,
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {!isUser && !isError && (
          <span style={{
            display: 'block',
            fontSize: 9,
            fontWeight: 700,
            color: providerColor,
            marginBottom: 4,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}>
            {msg.providerName || 'AI'}
          </span>
        )}
        {isError && (
          <span style={{
            display: 'block',
            fontSize: 9,
            fontWeight: 700,
            color: colors.status.error,
            marginBottom: 4,
            letterSpacing: 0.8,
          }}>
            ERROR
          </span>
        )}
        {msg.images?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: msg.content ? 6 : 0 }}>
            {msg.images.map((img, i) => (
              <img
                key={i}
                src={img.dataUrl}
                alt={img.name || 'attached'}
                style={{
                  maxWidth: 200,
                  maxHeight: 150,
                  borderRadius: 6,
                  border: `1px solid ${colors.border.subtle}`,
                  cursor: 'pointer',
                  objectFit: 'contain',
                  background: colors.bg.surface,
                }}
                onClick={() => window.open(img.dataUrl, '_blank')}
              />
            ))}
          </div>
        )}
        {msg.content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing indicator dots
// ---------------------------------------------------------------------------
function TypingIndicator({ color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '4px 12px' }}>
      <div style={{
        padding: '8px 16px',
        borderRadius: '12px 12px 12px 2px',
        background: `${color}12`,
        border: `1px solid ${color}20`,
        display: 'flex',
        gap: 5,
        alignItems: 'center',
      }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: '50%', background: color,
            opacity: 0.6,
            animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 0.9; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Chat view — rendered inside the pane body for apiProvider providers
// ---------------------------------------------------------------------------
function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
  });
}

function ApiChatView({ id, provider, providerDef, inputVal, setInputVal, inputRef, attachedImages, setAttachedImages }) {
  const { colors } = useTheme();
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  const providerColor = providerDef?.color || colors.accent.cyan;
  const providerName = providerDef?.name || provider;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const apiKeyGetter = useCallback(async (keyName) => {
    try {
      return await window.flowade?.env?.get(keyName) || null;
    } catch {
      return null;
    }
  }, []);

  const sendMessage = useCallback(async (text, images) => {
    if ((!text.trim() && !images?.length) || isStreaming) return;

    const userMsg = { role: 'user', content: text.trim(), images: images?.length ? images : undefined };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    const history = [...messages, userMsg].map((m) => ({
      role: m.role === 'error' ? 'assistant' : m.role,
      content: m.content,
      images: m.images,
    }));

    let assistantContent = '';
    try {
      const stream = streamChat(provider, history, apiKeyGetter);
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          assistantContent += chunk.content;
          // Update in-progress message
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?._streaming) {
              return [...prev.slice(0, -1), { role: 'assistant', content: assistantContent, providerName, _streaming: true }];
            }
            return [...prev, { role: 'assistant', content: assistantContent, providerName, _streaming: true }];
          });
        } else if (chunk.type === 'error') {
          setMessages((prev) => [...prev, { role: 'error', content: chunk.content }]);
        } else if (chunk.type === 'usage') {
          window.flowade?.cost?.track({
            input: chunk.input, output: chunk.output,
            model: chunk.model, terminalId: id,
          });
        }
      }
      // Finalize — remove _streaming flag
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?._streaming) {
          return [...prev.slice(0, -1), { ...last, _streaming: false }];
        }
        return prev;
      });
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'error', content: `Stream failed: ${err.message}` }]);
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming, provider, providerName, apiKeyGetter]);

  // Expose sendMessage so the parent input bar can call it
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.terminalId === id && e.detail?.text) {
        sendMessage(e.detail.text);
      }
    };
    window.addEventListener('flowade:apiChatSend', handler);
    return () => window.removeEventListener('flowade:apiChatSend', handler);
  }, [id, sendMessage]);

  // Also expose for the TerminalPane's own send button via a ref-like pattern
  // We store sendMessage on the window keyed by terminal id
  useEffect(() => {
    window.__flowadeApiChat = window.__flowadeApiChat || {};
    window.__flowadeApiChat[id] = sendMessage;
    return () => { delete window.__flowadeApiChat?.[id]; };
  }, [id, sendMessage]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const imgs = await Promise.all(files.map(readFileAsDataUrl));
    setAttachedImages((prev) => [...prev, ...imgs]);
  }, [setAttachedImages]);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
      }}
    >
      {/* Scrollable message list */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '8px 0',
        scrollbarWidth: 'thin',
        scrollbarColor: `${colors.border.subtle} transparent`,
      }}>
        {messages.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 8, padding: 24,
          }}>
            <span style={{
              fontSize: 28, lineHeight: 1,
            }}>
              {provider === 'chatgpt' ? '\u{1F916}' : '\u{1F9BE}'}
            </span>
            <span style={{
              fontSize: 13, fontWeight: 600, color: providerColor, fontFamily: fc,
            }}>
              {providerName}
            </span>
            <span style={{
              fontSize: 11, color: colors.text.dim, fontFamily: fc, textAlign: 'center',
            }}>
              Type a message below to start chatting.
            </span>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} msg={msg} providerColor={providerColor} />
        ))}
        {isStreaming && !messages[messages.length - 1]?._streaming && (
          <TypingIndicator color={providerColor} />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Main TerminalPane component
// ===========================================================================

export default function TerminalPane({
  id, label, sessionName, provider = 'claude', cwd, fontSize = 13,
  isFocused, onClose, onCloseAllAfter, panesAfter = 0,
  onRename, onCwdChange,
  isDangerous, onToggleDanger,
  isDragging, isDropTarget,
  onDragStart, onDragEnd, onDragOver, onDrop,
  swarmIdentity = null,
}) {
  const { colors, terminalTheme } = useTheme();
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const outputBufRef = useRef('');
  const optionScanRef = useRef(null);
  const isDangerousRef = useRef(isDangerous);
  const inputRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [termOptions, setTermOptions] = useState(null);
  const [ctxPercent, setCtxPercent] = useState(null);
  const [isRenaming, setIsRenaming] = useState(false);
  // Rename editor edits ONLY the user-controllable sessionName piece —
  // the workspace + provider prefix in the display label is composed
  // upstream and shouldn't appear in the edit field.
  const [renameVal, setRenameVal] = useState(sessionName || label);
  const [inputVal, setInputVal] = useState('');
  const [promptY, setPromptY] = useState(null);
  const promptTimerRef = useRef(null);
  const inputStartPosRef = useRef({ x: 0, y: 0 });
  const inputLockedRef = useRef(false);
  const [mode, setMode] = useState('usage');
  const [currentCwd, setCurrentCwd] = useState(cwd || null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [attachedImages, setAttachedImages] = useState([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef(null);
  // Lean mode — compresses Claude responses to save tokens. Triggers the
  // /leanmode skill (alias of /caveman). Six levels of intensity exposed
  // through a caret submenu in the pane's hamburger.
  const [leanActive, setLeanActive] = useState(false);
  const [leanLevel, setLeanLevel] = useState('full');
  const [leanLevelsOpen, setLeanLevelsOpen] = useState(false);
  const leanInitRef = useRef(false);
  // Pane activity state — 'idle' | 'busy' | 'complete'. Two triggers
  // promote to 'busy': a user prompt submission (Enter in xterm or Send
  // from the input box) and any pty burst carrying meaningful output
  // (newlines or >= 5 visible chars after ANSI strip). Pure cursor /
  // focus / single-char echoes are ignored. After 1.2s of pty silence we
  // transition busy → complete, which auto-fades to idle after 3s.
  // Result: a background pane streaming an agent response shows BUSY
  // without the user having focused it, but a click on an idle pane
  // doesn't flicker the badge.
  const [activity, setActivity] = useState('idle');
  const lastDataAtRef = useRef(0);
  const ctxAlertedRef = useRef(0);
  const unsubDataRef = useRef(null);
  const unsubExitRef = useRef(null);
  const { addToast } = useContext(ToastContext);
  const { settings } = useContext(SettingsContext);

  // Determine if this is an API-based provider
  const providerDef = useMemo(() => PROVIDERS.find((p) => p.id === provider), [provider]);
  const isApiProvider = !!providerDef?.apiProvider;

  useEffect(() => { isDangerousRef.current = isDangerous; }, [isDangerous]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const close = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const close = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [attachMenuOpen]);

  const handleTakeScreenshot = useCallback(async () => {
    const img = await window.flowade?.dialog?.takeScreenshot();
    if (img) setAttachedImages((prev) => [...prev, img]);
    setAttachMenuOpen(false);
  }, []);

  const handlePickImagesMenu = useCallback(async () => {
    setAttachMenuOpen(false);
    const imgs = await window.flowade?.dialog?.pickImages();
    if (imgs?.length) setAttachedImages((prev) => [...prev, ...imgs]);
  }, []);

  useEffect(() => {
    if (leanInitRef.current) return;
    if (provider !== 'claude' || isApiProvider) return;
    leanInitRef.current = true;
    const leanDefault = settings?.leanDefault ?? settings?.cavemanDefault;
    const defaultLevel = settings?.leanLevel || 'full';
    if (leanDefault) {
      setLeanActive(true);
      setLeanLevel(defaultLevel);
      setTimeout(() => sendToTerminal(`/leanmode ${defaultLevel}\r`), 1500);
    } else if (!localStorage.getItem('fc-lean-hint') && !localStorage.getItem('fc-caveman-hint')) {
      localStorage.setItem('fc-lean-hint', '1');
      setTimeout(() => addToast('Tip: Enable Lean mode to compress AI replies and trim tokens.', 'info'), 3000);
    }
  }, [provider, isApiProvider, settings?.leanDefault, settings?.cavemanDefault, settings?.leanLevel]);

  // Idle / busy / complete state machine. Polled at 300ms; cheap.
  // Busy is set by markBusy() (Enter pressed) or by meaningful pty
  // output. Once output goes quiet for 1.2s we declare the prompt done
  // and stay on 'complete' indefinitely — the badge persists until the
  // user kicks off the next prompt, so the visual "this finished" flag
  // is still there when they come back to a 16-pane layout an hour later.
  useEffect(() => {
    const tick = setInterval(() => {
      const since = Date.now() - (lastDataAtRef.current || 0);
      setActivity(prev => {
        if (prev === 'busy' && since > 1200) {
          // Notify the rest of the app that this pane just finished a
          // prompt. NotificationCenter listens for this to surface a
          // top-center banner (configurable via Settings → Notifications).
          window.dispatchEvent(new CustomEvent('flowade:terminalComplete', {
            detail: { terminalId: id, label, provider, at: Date.now() },
          }));
          return 'complete';
        }
        return prev;
      });
    }, 300);
    return () => clearInterval(tick);
  }, [id, label, provider]);

  // Mark the pane as actively working on a user prompt. Resets the
  // silence timer so the polling effect won't immediately demote us to
  // 'complete' just because the prompt hasn't started producing output yet.
  const markBusy = useCallback(() => {
    lastDataAtRef.current = Date.now();
    setActivity('busy');
  }, []);

  const sendToTerminal = useCallback((text) => {
    window.flowade?.terminal.write(id, text);
  }, [id]);

  const voiceBaseRef = useRef('');
  const voiceWrittenRef = useRef('');
  const { listening, status: voiceStatus, toggle: toggleVoice } = useVoiceInput({
    onInterim: (text) => {
      if (isApiProvider) {
        setInputVal(voiceBaseRef.current + (voiceBaseRef.current ? ' ' : '') + text);
      } else {
        // Write only the new characters since last interim
        const prev = voiceWrittenRef.current;
        if (text.length > prev.length && text.startsWith(prev)) {
          const newPart = text.slice(prev.length);
          sendToTerminal(newPart);
          voiceWrittenRef.current = text;
        } else if (text !== prev) {
          // Transcription changed — erase old and write new
          if (prev.length > 0) {
            sendToTerminal('\b'.repeat(prev.length) + ' '.repeat(prev.length) + '\b'.repeat(prev.length));
          }
          sendToTerminal(text);
          voiceWrittenRef.current = text;
        }
      }
    },
    onFinal: (text) => {
      if (isApiProvider) {
        voiceBaseRef.current = voiceBaseRef.current + (voiceBaseRef.current ? ' ' : '') + text;
        setInputVal(voiceBaseRef.current);
      } else {
        // Erase interim text, write final, submit
        const prev = voiceWrittenRef.current;
        if (prev.length > 0) {
          sendToTerminal('\b'.repeat(prev.length) + ' '.repeat(prev.length) + '\b'.repeat(prev.length));
        }
        sendToTerminal(text + '\r');
        voiceWrittenRef.current = '';
      }
    },
  });

  const handleInputSend = useCallback(async () => {
    if (isApiProvider) {
      const text = inputVal.trim();
      if (!text && !attachedImages.length) return;
      const sendFn = window.__flowadeApiChat?.[id];
      if (sendFn) sendFn(text, attachedImages.length ? attachedImages : undefined);
      setInputVal('');
    } else {
      if (attachedImages.length) {
        for (const img of attachedImages) {
          const filePath = img.filePath || await window.flowade?.dialog?.saveImageTemp({ dataUrl: img.dataUrl, name: img.name });
          if (filePath) sendToTerminal(filePath + '\r');
        }
      } else {
        sendToTerminal('\r');
      }
    }
    markBusy();
    setAttachedImages([]);
    if (listening) { toggleVoice(); voiceBaseRef.current = ''; }
  }, [inputVal, attachedImages, sendToTerminal, isApiProvider, id, listening, toggleVoice, markBusy]);

  const pickFolder = useCallback(async () => {
    const folder = await window.flowade?.dialog.pickFolder(currentCwd);
    if (folder) {
      setCurrentCwd(folder);
      onCwdChange?.(folder);
      if (!isApiProvider) {
        sendToTerminal(`cd "${folder}"\r`);
      }
    }
  }, [currentCwd, onCwdChange, sendToTerminal, isApiProvider]);

  // Listen for snippet insertion from PromptTemplates
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.terminalId === id) {
        setInputVal((prev) => prev ? prev + '\n' + e.detail.text : e.detail.text);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('flowade:insertToTerminal', handler);
    return () => window.removeEventListener('flowade:insertToTerminal', handler);
  }, [id]);

  const handlePickImages = useCallback(async () => {
    const imgs = await window.flowade?.dialog?.pickImages();
    if (imgs?.length) setAttachedImages((prev) => [...prev, ...imgs]);
  }, []);

  const handlePasteImage = useCallback(async (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    const imgs = await Promise.all(files.map(readFileAsDataUrl));
    setAttachedImages((prev) => [...prev, ...imgs]);
  }, []);

  useEffect(() => {
    const handler = () => { if (!listening) voiceBaseRef.current = inputVal || ''; toggleVoice(); };
    window.addEventListener('flowade:toggleVoice', handler);
    return () => window.removeEventListener('flowade:toggleVoice', handler);
  }, [toggleVoice, listening, inputVal]);

  // ----- Terminal (PTY) setup — only for non-API providers -----
  useEffect(() => {
    if (isApiProvider) {
      setStatus('connected');
      return;
    }
    if (!termRef.current) return;

    const term = new Terminal({
      theme: terminalTheme,
      fontFamily: FONTS.mono,
      fontSize,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key === 'a') {
        const curY = term.buffer.active.cursorY;
        const baseY = term.buffer.active.baseY;
        let startRow = curY;
        while (startRow > 0) {
          const l = term.buffer.active.getLine(startRow);
          if (!l || !l.isWrapped) break;
          startRow--;
        }
        let endRow = curY;
        while (endRow < term.rows - 1) {
          const n = term.buffer.active.getLine(endRow + 1);
          if (!n || !n.isWrapped) break;
          endRow++;
        }
        const firstLine = term.buffer.active.getLine(startRow);
        if (!firstLine) return false;
        let startCol = 0;
        for (let i = 0; i < Math.min(firstLine.length, 30); i++) {
          const cell = firstLine.getCell(i);
          if (!cell || cell.getWidth() === 0) continue;
          const ch = cell.getChars();
          if (ch && '❯>$#%'.indexOf(ch) !== -1) {
            startCol = i + cell.getWidth();
            while (startCol < firstLine.length) {
              const sc = firstLine.getCell(startCol);
              if (!sc || sc.getChars() !== ' ') break;
              startCol++;
            }
            break;
          }
        }
        const lastLine = term.buffer.active.getLine(endRow);
        let endCol = 0;
        if (lastLine) {
          for (let i = lastLine.length - 1; i >= 0; i--) {
            const cell = lastLine.getCell(i);
            if (cell && cell.getChars().trim()) { endCol = i + 1; break; }
          }
        }
        let len;
        if (startRow === endRow) {
          len = endCol - startCol;
        } else {
          len = (term.cols - startCol);
          for (let r = startRow + 1; r < endRow; r++) len += term.cols;
          len += endCol;
        }
        if (len > 0) term.select(startCol, baseY + startRow, len);
        return false;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && term.hasSelection()) {
        term.clearSelection();
        window.flowade?.terminal.write(id, '\x05\x15');
        return false;
      }
      if (mod && event.key === 'v') return false;
      if (mod && event.key === 'c' && term.hasSelection()) return false;
      if (mod && ['t', 'w', 'k', '1', '2', '3', '4', ',', 'Tab'].includes(event.key)) return false;
      if (mod && event.shiftKey && event.key === 'D') return false;
      return true;
    });

    const termEl = termRef.current;
    const pasteHandler = (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text');
      if (text) window.flowade?.terminal.write(id, text);
    };
    termEl.addEventListener('paste', pasteHandler);

    (async () => {
      try {
        const info = await window.flowade.terminal.spawn({
          id,
          cols: term.cols,
          rows: term.rows,
          cwd: cwd || undefined,
          provider,
        });

        if (!info) { setStatus('error'); return; }

        if (info.existing && info.scrollback) {
          term.write(info.scrollback);
        }

        unsubDataRef.current = window.flowade.terminal.onData((termId, data) => {
          if (termId !== id) return;
          term.write(data);
          outputBufRef.current += data;
          if (outputBufRef.current.length > 3000) outputBufRef.current = outputBufRef.current.slice(-2000);
          // Track when output last arrived so the busy → complete silence
          // detector can fire once the prompt finishes streaming.
          lastDataAtRef.current = Date.now();
          // Promote to 'busy' when the burst carries meaningful output —
          // not when it's pure cursor / focus echo. Strip CSI + OSC ANSI
          // sequences and check what's left: any newline, or >=5 visible
          // chars, counts as real work. This catches background panes
          // whose AI agent is streaming a response without flickering for
          // every click-induced prompt repaint.
          const stripForActivity = data
            .replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '')
            .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
            .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
          // Newline (\n) signals real new output, not a prompt redraw —
          // \r alone is what bash uses to overwrite the current line, so
          // we deliberately ignore it. The 5-char fallback handles agents
          // that stream chunks without committing a line.
          const meaningful = /\n/.test(stripForActivity)
            || stripForActivity.replace(/\s/g, '').length >= 5;
          if (meaningful) {
            setActivity(a => (a === 'busy' ? a : 'busy'));
          }

          if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
          promptTimerRef.current = setTimeout(() => {
            const row = term.buffer.active.cursorY;
            const col = term.buffer.active.cursorX;
            setPromptY(row);
            if (!inputLockedRef.current) {
              inputStartPosRef.current = { x: col, y: term.buffer.active.baseY + row };
            }
          }, 100);

          const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
          if (stripped.includes('\n') || stripped.length > 40) {
            inputLockedRef.current = false;
          }

          const ctx = parseContextUsage(data);
          if (ctx != null) {
            setCtxPercent(ctx);
            if (ctx >= 90 && ctxAlertedRef.current < 90) {
              ctxAlertedRef.current = 90;
              addToast(`${label}: Context 90%+ — consider /compact`, 'error');
            } else if (ctx >= 70 && ctxAlertedRef.current < 70) {
              ctxAlertedRef.current = 70;
              addToast(`${label}: Context 70%+`, 'warning');
            }
          }

          // Token usage tracking
          const tokenUsage = parseTokenUsage(data);
          if (tokenUsage) {
            window.flowade?.cost?.track({
              input: tokenUsage.input, output: tokenUsage.output,
              model: provider === 'claude' ? 'claude-sonnet-4-6' : provider,
              terminalId: id,
            });
          }

          // Dev server URL detection
          const detectedUrl = detectDevServerUrl(outputBufRef.current);
          if (detectedUrl) {
            setPreviewUrl((prev) => {
              if (prev !== detectedUrl) {
                window.dispatchEvent(new CustomEvent('flowade:openInBrowser', { detail: { url: detectedUrl, terminalId: id } }));
              }
              return prev !== detectedUrl ? detectedUrl : prev;
            });
          }

          // Detect /rename in terminal output
          const renameMatch = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').match(/Session renamed to:\s*(.+)/);
          if (renameMatch) {
            const newName = renameMatch[1].trim();
            if (newName) onRename?.(newName);
          }

          if (optionScanRef.current) clearTimeout(optionScanRef.current);
          optionScanRef.current = setTimeout(() => {
            const options = parseTerminalOptions(outputBufRef.current);
            if (isDangerousRef.current && options) {
              const approve = options.find((o) => o.value === 'a') || options.find((o) => o.value === 'y');
              if (approve) {
                window.flowade.terminal.write(id, approve.value);
                outputBufRef.current = '';
                setTermOptions(null);
                return;
              }
            }
            setTermOptions(options);
          }, 400);
        });

        unsubExitRef.current = window.flowade.terminal.onExit((termId, exitCode) => {
          if (termId !== id) return;
          setStatus('disconnected');
          term.writeln(`\r\n\x1b[33m[Session ended — code ${exitCode}]\x1b[0m`);
        });

        setStatus('connected');

        if (!info.existing) {
          const provDef = PROVIDERS.find((p) => p.id === provider);
          if (provDef?.command) {
            setTimeout(() => window.flowade.terminal.write(id, provDef.command + '\r'), 500);
          }
        }
      } catch (err) {
        term.writeln(`\r\n\x1b[31mFailed to spawn terminal: ${err.message}\x1b[0m`);
        setStatus('error');
      }
    })();

    term.onData((data) => {
      window.flowade?.terminal.write(id, data);
      inputLockedRef.current = true;
      if (data === '\r' || data === '\n') {
        inputLockedRef.current = false;
        // User pressed Enter directly in xterm — mark the pane busy so
        // the status badge tracks prompt activity, not just typing noise.
        markBusy();
      }
      setTermOptions(null);
      outputBufRef.current = '';
    });

    term.onResize(({ cols, rows }) => {
      window.flowade?.terminal.resize(id, cols, rows);
    });

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(termRef.current);

    return () => {
      ro.disconnect();
      termEl.removeEventListener('paste', pasteHandler);
      unsubDataRef.current?.();
      unsubExitRef.current?.();
      term.dispose();
    };
  }, [id, isApiProvider]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  const statusColor = status === 'connected' ? colors.status.success
    : status === 'connecting' ? colors.status.warning : colors.status.error;

  const focusBorder = isFocused ? colors.border.focus : null;
  const borderColor = isDropTarget ? colors.accent.purple + '60'
    : isDangerous ? colors.border.danger
    : focusBorder
    || colors.border.subtle;

  const boxShadow = isDangerous
    ? '0 0 20px rgba(231,76,60,.06), 0 2px 8px rgba(0,0,0,.4)'
    : isFocused
    ? `0 0 0 1px ${colors.accent.purple}20, 0 2px 12px rgba(0,0,0,.3)`
    : '0 1px 4px rgba(0,0,0,.2)';

  const cwdShort = currentCwd ? currentCwd.split(/[/\\]/).slice(-2).join('/') : null;

  // Use provider color for the header label on API providers
  const headerLabelColor = isApiProvider
    ? (isDangerous ? colors.status.error : providerDef?.color || colors.accent.green)
    : (isDangerous ? colors.status.error : colors.accent.green);

  const handleOuterDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isApiProvider && e.dataTransfer?.files?.length) {
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        const imgs = await Promise.all(files.map(readFileAsDataUrl));
        setAttachedImages((prev) => [...prev, ...imgs]);
        return;
      }
    }
    onDrop?.();
  }, [isApiProvider, onDrop]);

  const accentColor = colors.accent.primary || colors.accent.purple;
  // Glasshouse swaps the pane chrome — cyan focus rim, glassy surface,
  // softer drop shadow. Internal terminal layer is untouched.
  const _glass = isGlasshouseEnabled();
  const _glassAccent = '#4de6f0';
  // Border priority: danger > activity (busy yellow / done green) > focus
  // (cyan) > resting subtle. Activity overrides focus so a 16-pane swarm
  // stays scannable — the focused pane keeps a cyan glow via box-shadow
  // below, so users still know where their cursor is even when its
  // border has flipped to busy/done.
  const _glassBorder = isDangerous
    ? 'rgba(255, 107, 107, 0.5)'
    : activity === 'busy'
      ? 'rgba(245, 200, 70, 0.65)'
      : activity === 'complete'
        ? 'rgba(88, 224, 168, 0.65)'
        : isFocused
          ? 'rgba(77, 230, 240, 0.45)'
          : 'rgba(255, 255, 255, 0.07)';
  // Outer shadow tint follows the same priority so the panel glow reads
  // the activity at a glance from across the screen.
  const _glassShadow = isDangerous
    ? `0 0 20px rgba(255, 107, 107, 0.12), 0 2px 8px rgba(0,0,0,.4)`
    : activity === 'busy'
      ? `0 0 0 1px rgba(245,200,70,0.32), 0 10px 32px rgba(0,0,0,0.5), 0 0 32px rgba(245,200,70,0.12)`
      : activity === 'complete'
        ? `0 0 0 1px rgba(88,224,168,0.32), 0 10px 32px rgba(0,0,0,0.5), 0 0 32px rgba(88,224,168,0.12)`
        : isFocused
          ? `0 0 0 1px rgba(77,230,240,0.25), 0 12px 36px rgba(0,0,0,0.5), 0 0 36px rgba(77,230,240,0.08)`
          : `inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.4)`;

  return (
    <div
      className={isFocused && !isDangerous ? 'fc-gradient-border active' : ''}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver?.(); }}
      onDrop={handleOuterDrop}
      style={{
        background: _glass ? 'rgba(8, 8, 18, 0.55)' : colors.bg.surface,
        backgroundImage: _glass ? 'none' : (isFocused ? (colors.gradient?.surface || 'none') : 'none'),
        border: `1px solid ${_glass ? _glassBorder : borderColor}`,
        borderRadius: _glass ? 12 : 10,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', minHeight: 0, flex: 1,
        opacity: isDragging ? 0.4 : 1,
        backdropFilter: _glass ? 'blur(14px) saturate(1.1)' : undefined,
        boxShadow: _glass
          ? _glassShadow
          : isDangerous
            ? `0 0 20px rgba(255, 107, 107, 0.12), 0 2px 8px rgba(0,0,0,.4)`
            : isFocused
              ? `0 0 0 1px ${accentColor}15, 0 4px 20px rgba(0,0,0,.3), 0 0 40px ${accentColor}06`
              : '0 1px 4px rgba(0,0,0,.2)',
        transition: 'border-color .3s ease, opacity .2s ease, box-shadow .3s ease, background-image .5s ease',
      }}
    >
      {/* Header */}
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
        onDragEnd={onDragEnd}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          background: isDangerous ? 'rgba(255, 60, 80, 0.06)' : 'transparent',
          borderBottom: `1px solid ${colors.border.subtle}`,
          cursor: 'grab', flexShrink: 0,
        }}
      >
        {/* Mac users get the macOS-style traffic-light cluster (decorative —
            mirrors the platform's native window control aesthetic). Windows
            and Linux keep the single status dot. Both platforms retain
            every other control: rename, drag, provider badge, ctx %,
            danger badge, preview toggle, mic, ..., close. */}
        {isMacPlatform() && (
          <span style={{ display: 'inline-flex', gap: 5, marginRight: 4, flexShrink: 0 }}
            title={`Status: ${isDangerous ? 'danger' : status}`}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff6b6b' }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffe566' }} />
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isDangerous ? colors.status.error : statusColor,
              animation: isDangerous || status === 'connecting' ? 'pulse 1.5s infinite' : 'none',
            }} />
          </span>
        )}
        {!isMacPlatform() && (
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: isDangerous ? colors.status.error : statusColor,
            animation: isDangerous || status === 'connecting' ? 'pulse 1.5s infinite' : 'none', flexShrink: 0,
          }} />
        )}

        <RoleChip identity={swarmIdentity} />

        {isRenaming ? (
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={() => { onRename?.(renameVal); setIsRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onRename?.(renameVal); setIsRenaming(false); }
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            style={{
              flex: 1, minWidth: 60, background: 'transparent', border: `1px solid ${colors.border.focus}`,
              borderRadius: 4, padding: '1px 6px', color: headerLabelColor,
              fontSize: 11, fontWeight: 600, fontFamily: fb, outline: 'none',
            }}
          />
        ) : (
          <span
            onDoubleClick={() => { setRenameVal(sessionName || label); setIsRenaming(true); }}
            style={{ fontSize: 11, fontWeight: 600, color: colors.text.secondary, fontFamily: fb, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {label}
          </span>
        )}

        {isApiProvider && (
          <span style={{
            fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, fontFamily: fc,
            background: `${providerDef.color}12`, color: providerDef.color,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>
            {providerDef.name}
          </span>
        )}

        {cwdShort && (
          <span style={{ fontSize: 9, color: colors.text.ghost, fontFamily: fc, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
            {cwdShort}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Activity flag — busy / complete only render; idle is silent so
            calm panes don't fight for attention. */}
        {activity === 'busy' && (
          <span title="Working — receiving output now"
            style={{
              fontSize: 8, fontWeight: 700, padding: '2px 6px 2px 5px', borderRadius: 99, fontFamily: fc,
              background: 'rgba(77,230,240,0.12)', color: '#4de6f0',
              letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#4de6f0',
              boxShadow: '0 0 8px #4de6f0', animation: 'pulse 1.1s infinite',
            }} />
            BUSY
          </span>
        )}
        {activity === 'complete' && (
          <span title="Last prompt finished — clears when you submit the next one"
            style={{
              fontSize: 8, fontWeight: 700, padding: '2px 6px 2px 5px', borderRadius: 99, fontFamily: fc,
              background: 'rgba(88,224,168,0.14)', color: '#58e0a8',
              letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
            <span style={{ fontSize: 9 }}>✓</span> DONE
          </span>
        )}

        {/* Lean mode flag — shows the active intensity. */}
        {leanActive && (
          <span title={`Lean mode active: ${leanLevel}`}
            style={{
              fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 99, fontFamily: fc,
              background: 'rgba(77,230,240,0.10)', color: '#4de6f0',
              letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center', gap: 3,
              border: '1px solid rgba(77,230,240,0.25)',
            }}>
            ⚡ LEAN <span style={{ opacity: 0.7, textTransform: 'lowercase' }}>{leanLevel}</span>
          </span>
        )}

        {ctxPercent != null && (
          <span style={{
            fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, fontFamily: fc,
            color: ctxPercent >= 90 ? colors.status.error : ctxPercent >= 70 ? colors.status.warning : colors.text.dim,
          }}>{ctxPercent}%</span>
        )}

        {isDangerous && (
          <span title="Danger mode — commands run without per-action confirmation"
            style={{
              fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
              background: colors.status.error + '18', color: colors.status.error, fontFamily: fc,
              letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center', gap: 4,
              border: `1px solid ${colors.status.error}30`,
            }}>⚠ DANGER</span>
        )}

        {!isApiProvider && previewUrl && (
          <button
            onClick={() => window.flowade?.shell?.openExternal?.(previewUrl)}
            title={`Open ${previewUrl} in your default browser`}
            style={{
              all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 7px', borderRadius: 99, height: 20,
              border: `1px solid ${colors.accent.cyan}55`,
              background: `${colors.accent.cyan}10`,
              color: colors.accent.cyan,
              fontFamily: fc, fontSize: 9, fontWeight: 700,
              letterSpacing: 0.4,
              transition: 'background .15s, border-color .15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${colors.accent.cyan}22`; e.currentTarget.style.borderColor = `${colors.accent.cyan}aa`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${colors.accent.cyan}10`; e.currentTarget.style.borderColor = `${colors.accent.cyan}55`; }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><line x1="21" y1="3" x2="14" y2="10" />
              <path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5" />
            </svg>
            <span>{shortHostLabel(previewUrl)}</span>
          </button>
        )}

        {/* Voice input toggle */}
        <button onClick={() => { if (!listening) voiceBaseRef.current = inputVal || ''; toggleVoice(); }}
          title={listening ? 'Stop voice (Ctrl+Shift+V)' : 'Voice input (Ctrl+Shift+V)'}
          style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 4, position: 'relative',
            color: listening ? colors.status.error : colors.text.dim, transition: 'all .15s',
            background: listening ? colors.status.error + '15' : 'transparent',
          }}
          onMouseEnter={(e) => { if (!listening) e.currentTarget.style.color = colors.text.secondary; }}
          onMouseLeave={(e) => { if (!listening) e.currentTarget.style.color = colors.text.dim; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="1" width="6" height="11" rx="3" /><path d="M19 10v1a7 7 0 01-14 0v-1" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          {listening && <span style={{ position: 'absolute', top: -1, right: -1, width: 6, height: 6, borderRadius: '50%', background: colors.status.error, animation: 'pulse 1s infinite' }} />}
        </button>

        {/* More menu — secondary actions */}
        <div ref={moreMenuRef} style={{ position: 'relative' }}>
          <button onClick={() => setMoreMenuOpen((o) => !o)} style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 4,
            color: colors.text.dim, transition: 'color .15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text.secondary; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.text.dim; }}
          title="More options">
            <svg width="12" height="12" viewBox="0 0 24 24" fill={colors.text.dim} stroke="none">
              <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {moreMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 40,
              background: colors.bg.elevated || colors.bg.overlay, border: `1px solid ${colors.border.medium || colors.border.subtle}`,
              borderRadius: 8, padding: 4, minWidth: 160,
              boxShadow: '0 8px 24px rgba(0,0,0,.4)',
            }}>
              <button onClick={() => { pickFolder(); setMoreMenuOpen(false); }} style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                Change folder
              </button>

              {!isApiProvider && (
                <button onClick={() => { setMode((m) => m === 'usage' ? 'tokens' : 'usage'); setMoreMenuOpen(false); }} style={{
                  all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                  color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                  {mode === 'usage' ? 'Show tokens' : 'Show usage'}
                </button>
              )}

              {provider === 'claude' && !isApiProvider && (
                <>
                  <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <button onClick={() => {
                      const next = !leanActive;
                      setLeanActive(next);
                      sendToTerminal(next ? `/leanmode ${leanLevel}\r` : '/leanmode off\r');
                      setMoreMenuOpen(false);
                    }} style={{
                      all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      flex: 1, padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                      color: leanActive ? '#4de6f0' : colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title="Compress AI responses to save tokens. Click ▾ for intensity levels.">
                      <span style={{ fontSize: 12, width: 12, textAlign: 'center' }}>{leanActive ? '⚡' : '🍃'}</span>
                      {leanActive ? `Lean off (${leanLevel})` : 'Lean mode'}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setLeanLevelsOpen(v => !v); }} style={{
                      all: 'unset', cursor: 'pointer',
                      padding: '6px 8px', borderRadius: 4,
                      color: leanLevelsOpen ? '#4de6f0' : colors.text.dim,
                      transition: 'background .1s', boxSizing: 'border-box',
                      fontSize: 10, lineHeight: 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title="Pick intensity"
                    >{leanLevelsOpen ? '▴' : '▾'}</button>
                  </div>
                  {leanLevelsOpen && (
                    <div style={{
                      padding: '4px 6px 4px 22px',
                      display: 'flex', flexDirection: 'column', gap: 1,
                      borderLeft: `1px solid ${colors.border.subtle}`,
                      marginLeft: 12,
                    }}>
                      {[
                        { id: 'lite',  label: 'Lite',  hint: '15-25% off' },
                        { id: 'full',  label: 'Full',  hint: '30-50% off · default' },
                        { id: 'ultra', label: 'Ultra', hint: '50-65% off' },
                      ].map(lvl => {
                        const active = leanLevel === lvl.id && leanActive;
                        return (
                          <button
                            key={lvl.id}
                            onClick={() => {
                              setLeanLevel(lvl.id);
                              setLeanActive(true);
                              sendToTerminal(`/leanmode ${lvl.id}\r`);
                              setLeanLevelsOpen(false);
                              setMoreMenuOpen(false);
                            }}
                            style={{
                              all: 'unset', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '4px 8px', borderRadius: 4,
                              fontSize: 10.5, fontFamily: fb, fontWeight: active ? 700 : 400,
                              color: active ? '#4de6f0' : colors.text.secondary,
                              background: active ? 'rgba(77,230,240,0.08)' : 'transparent',
                              transition: 'background .1s',
                            }}
                            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = colors.bg.overlay; }}
                            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                            title={`Sends /leanmode ${lvl.id} to the terminal`}
                          >
                            <span>{lvl.label}</span>
                            <span style={{ fontSize: 9, color: active ? '#4de6f0' : colors.text.dim, opacity: 0.85 }}>{lvl.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              <button onClick={() => { onToggleDanger?.(); setMoreMenuOpen(false); }} style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                color: isDangerous ? colors.status.error : colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isDangerous ? colors.status.error : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                {isDangerous ? 'Safe mode' : 'Danger mode'}
              </button>

              {window.flowade?.window?.popout && (
                <button onClick={() => { window.flowade.window.popout(id); setMoreMenuOpen(false); }} style={{
                  all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                  color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /></svg>
                  Pop out
                </button>
              )}

              {panesAfter > 0 && onCloseAllAfter && (
                <>
                  <div style={{ height: 1, background: colors.border.subtle, margin: '4px 6px' }} />
                  <button
                    onClick={() => { onCloseAllAfter(); setMoreMenuOpen(false); }}
                    style={{
                      all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                      color: colors.status.error, transition: 'background .1s', boxSizing: 'border-box',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.status.error + '12'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title="Closes every pane after this one in left-to-right, top-to-bottom order"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    Close all after this
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: colors.text.dim, fontFamily: fb }}>{panesAfter}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 4,
          color: colors.text.dim, transition: 'all .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = colors.status.error; e.currentTarget.style.background = colors.status.error + '15'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = colors.text.dim; e.currentTarget.style.background = 'transparent'; }}
        title="Close session">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <ContextBar percent={ctxPercent} />

      {/* Voice status bar */}
      {listening && (
        <div style={{
          padding: '4px 12px', background: colors.bg.overlay, borderBottom: `1px solid ${colors.border.subtle}`,
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: colors.status.error, animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontSize: 11, color: colors.text.dim, fontFamily: fc, fontStyle: 'italic' }}>
            {voiceStatus || 'Listening...'}
          </span>
        </div>
      )}

      {/* Body: either xterm terminal or API chat view, with optional preview */}
      {isApiProvider ? (
        <ApiChatView
          id={id}
          provider={provider}
          providerDef={providerDef}
          inputVal={inputVal}
          setInputVal={setInputVal}
          inputRef={inputRef}
          attachedImages={attachedImages}
          setAttachedImages={setAttachedImages}
        />
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
          <div ref={termRef} style={{ flex: 1, padding: '4px 8px', minHeight: 0, overflow: 'hidden' }} />
          {/* Floating action buttons below prompt */}
          <div style={{
            position: 'absolute',
            top: promptY != null ? `calc(${(promptY + 2) * fontSize * 1.35}px + 8px)` : undefined,
            bottom: promptY == null ? 8 : undefined,
            right: 12, display: 'flex', gap: 4,
            alignItems: 'center', zIndex: 2,
          }}>
            {attachedImages.length > 0 && (
              <div style={{
                display: 'flex', gap: 4, alignItems: 'center', padding: '3px 6px',
                background: colors.bg.surface + 'e0', borderRadius: 6,
                border: `1px solid ${colors.border.subtle}`,
              }}>
                {attachedImages.map((img, i) => (
                  <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={img.dataUrl} alt={img.name} style={{
                      width: 32, height: 32, objectFit: 'cover', borderRadius: 4,
                      border: `1px solid ${colors.border.subtle}`,
                    }} />
                    <button onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))} style={{
                      all: 'unset', cursor: 'pointer', position: 'absolute', top: -3, right: -3,
                      width: 14, height: 14, borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: colors.status.error, color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: 1,
                    }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div ref={attachMenuRef} style={{ position: 'relative' }}>
              <button onClick={() => setAttachMenuOpen((o) => !o)} title="Attach image"
                style={{
                  all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', width: 28, height: 28, borderRadius: 6,
                  background: colors.bg.surface + 'e0', border: `1px solid ${colors.border.subtle}`,
                  color: attachedImages.length ? colors.accent.cyan : colors.text.dim,
                  transition: 'all .15s', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = colors.accent.cyan; e.currentTarget.style.borderColor = colors.accent.cyan; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = attachedImages.length ? colors.accent.cyan : colors.text.dim; e.currentTarget.style.borderColor = colors.border.subtle; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              {attachMenuOpen && (
                <div style={{
                  position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, zIndex: 40,
                  background: colors.bg.elevated || colors.bg.overlay, border: `1px solid ${colors.border.medium || colors.border.subtle}`,
                  borderRadius: 8, padding: 4, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                }}>
                  <button onClick={handleTakeScreenshot} style={{
                    all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                    color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                    Screenshot
                  </button>
                  <button onClick={handlePickImagesMenu} style={{
                    all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                    color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Upload image
                  </button>
                </div>
              )}
            </div>
            <button onClick={handleInputSend} title={attachedImages.length ? 'Send images' : 'Submit (Enter)'}
              style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 5, padding: '5px 14px', borderRadius: 20,
                background: colors.accent.purple, color: '#fff',
                fontSize: 11, fontWeight: 600, fontFamily: fb, letterSpacing: 0.3,
                transition: 'all .15s', flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
              Send
            </button>
          </div>
        </div>
      )}

      {/* Quick-action buttons — only for terminal providers when options exist */}
      {!isApiProvider && termOptions && termOptions.length > 0 && (
        <div style={{
          padding: '6px 12px', background: colors.bg.overlay, borderTop: `1px solid ${colors.border.subtle}`,
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, color: colors.text.dim, fontFamily: fc }}>Quick:</span>
          {termOptions.map((opt, i) => (
            <button key={i} onClick={() => {
              sendToTerminal(/^\d+$/.test(opt.value) ? opt.value + '\r' : opt.value);
              setTermOptions(null);
              outputBufRef.current = '';
            }} style={{
              all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              padding: '4px 12px', borderRadius: 6, fontFamily: fc,
              background: colors.bg.surface, color: colors.accent.green, border: `1px solid ${colors.border.subtle}`,
              transition: 'all .15s ease',
            }}
            onMouseEnter={(e) => { e.target.style.borderColor = colors.accent.green; }}
            onMouseLeave={(e) => { e.target.style.borderColor = colors.border.subtle; }}
            >{opt.label}</button>
          ))}
        </div>
      )}

      {/* Bottom bar — only for API providers (terminal has floating buttons) */}
      {isApiProvider && (
        <>
          {attachedImages.length > 0 && (
            <div style={{
              display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center',
              borderTop: `1px solid ${colors.border.subtle}`, background: colors.bg.overlay,
              flexShrink: 0, overflowX: 'auto',
            }}>
              {attachedImages.map((img, i) => (
                <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={img.dataUrl} alt={img.name} style={{
                    width: 48, height: 48, objectFit: 'cover', borderRadius: 6,
                    border: `1px solid ${colors.border.subtle}`,
                  }} />
                  <button onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))} style={{
                    all: 'unset', cursor: 'pointer', position: 'absolute', top: -4, right: -4,
                    width: 16, height: 16, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: colors.status.error, color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1,
                  }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{
            display: 'flex', gap: 6, padding: '6px 10px', alignItems: 'center',
            borderTop: attachedImages.length ? 'none' : `1px solid ${colors.border.subtle}`,
            background: colors.bg.overlay, flexShrink: 0,
          }}>
            <div ref={attachMenuRef} style={{ position: 'relative' }}>
              <button onClick={() => setAttachMenuOpen((o) => !o)} title="Attach image"
                style={{
                  all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', width: 24, height: 24, borderRadius: 5,
                  color: attachedImages.length ? colors.accent.cyan : colors.text.dim,
                  transition: 'color .15s', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = colors.accent.cyan; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = attachedImages.length ? colors.accent.cyan : colors.text.dim; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              {attachMenuOpen && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 40,
                  background: colors.bg.elevated || colors.bg.overlay, border: `1px solid ${colors.border.medium || colors.border.subtle}`,
                  borderRadius: 8, padding: 4, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                }}>
                  <button onClick={handleTakeScreenshot} style={{
                    all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                    color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                    Screenshot
                  </button>
                  <button onClick={handlePickImagesMenu} style={{
                    all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: 11, fontFamily: fb,
                    color: colors.text.secondary, transition: 'background .1s', boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.bg.overlay; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Upload image
                  </button>
                </div>
              )}
            </div>
            <input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onPaste={handlePasteImage}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInputSend(); }
              }}
              placeholder={`Message ${providerDef?.name || 'AI'}...`}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: colors.text.primary, fontSize: 12, fontFamily: fc, padding: '3px 0',
              }}
            />
            <button onClick={handleInputSend}
              style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6,
                background: (inputVal.trim() || attachedImages.length) ? colors.accent.purple : 'transparent',
                color: (inputVal.trim() || attachedImages.length) ? '#fff' : colors.text.dim,
                transition: 'all .15s',
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

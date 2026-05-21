import { useEffect, useState } from 'react';

const BTN_W = 46;
const BTN_H = 32;

export default function WindowControls({ colors }) {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    const api = window.flowade?.window;
    if (!api) return;
    let mounted = true;
    api.isMaximized().then((v) => { if (mounted) setIsMax(!!v); });
    const off = api.onMaximizedChange ? api.onMaximizedChange((v) => setIsMax(!!v)) : null;
    return () => {
      mounted = false;
      if (typeof off === 'function') off();
    };
  }, []);

  const stroke = colors.text.dim;
  const strokeHover = colors.text.primary;

  const baseBtn = {
    all: 'unset',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: BTN_W,
    height: BTN_H,
    transition: 'background 0.12s ease',
    color: stroke,
  };

  const hoverNeutral = colors.bg.overlay || 'rgba(255,255,255,0.06)';

  const onEnterNeutral = (e) => {
    e.currentTarget.style.background = hoverNeutral;
    e.currentTarget.style.color = strokeHover;
  };
  const onLeaveNeutral = (e) => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = stroke;
  };
  const onEnterClose = (e) => {
    e.currentTarget.style.background = '#e81123';
    e.currentTarget.style.color = '#ffffff';
  };
  const onLeaveClose = (e) => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = stroke;
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: BTN_H,
        marginLeft: 4,
        WebkitAppRegion: 'no-drag',
      }}
    >
      <button
        onClick={() => window.flowade?.window?.minimize()}
        onMouseEnter={onEnterNeutral}
        onMouseLeave={onLeaveNeutral}
        style={baseBtn}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        onClick={() => window.flowade?.window?.maximize()}
        onMouseEnter={onEnterNeutral}
        onMouseLeave={onLeaveNeutral}
        style={baseBtn}
        title={isMax ? 'Restore' : 'Maximize'}
        aria-label={isMax ? 'Restore' : 'Maximize'}
      >
        {isMax ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            {/* back square */}
            <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            {/* front square — overlap mask */}
            <rect x="0.5" y="2.5" width="7" height="7" fill="currentColor" />
            <rect x="1.5" y="3.5" width="5" height="5" fill={colors.bg.glass || colors.bg.surface || '#161729'} />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        onClick={() => window.flowade?.window?.close()}
        onMouseEnter={onEnterClose}
        onMouseLeave={onLeaveClose}
        style={baseBtn}
        title="Close"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import type { TranslationResult } from '../../types';

interface Props {
  result: TranslationResult | null;
}

export default function AvatarPanel({ result }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    if (!result?.animations?.length || sentRef.current) return;
    sentRef.current = true;

    const iframe = iframeRef.current;
    if (!iframe) return;

    const sendAnimations = () => {
      try {
        iframe.contentWindow?.postMessage(
          { type: 'TAFAHOM_ANIMATIONS', animations: result.animations },
          '*'
        );
      } catch {}
    };

    iframe.addEventListener('load', sendAnimations);
    if (iframe.contentDocument?.readyState === 'complete') {
      sendAnimations();
    }

    return () => iframe.removeEventListener('load', sendAnimations);
  }, [result]);

  if (!result) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <p style={{ color: 'var(--text-muted)' }}>No translation result yet. Translate a video to see the avatar.</p>
      </div>
    );
  }

  if (!result.animations?.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <p style={{ color: 'var(--text-muted)' }}>No animations generated for this transcript.</p>
      </div>
    );
  }

  return (
    <div>
      <iframe
        ref={iframeRef}
        src="/unity/avatar-bridge.html"
        className="avatar-frame"
        title="Tafahom Avatar"
        allow="autoplay"
      />
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            sentRef.current = false;
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'TAFAHOM_ANIMATIONS', animations: result.animations },
              '*'
            );
          }}
        >
          Replay
        </button>
      </div>
    </div>
  );
}

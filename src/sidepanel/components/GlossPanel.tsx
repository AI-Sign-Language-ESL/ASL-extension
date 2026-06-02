import React from 'react';
import type { TranslationResult } from '../../types';

interface Props {
  result: TranslationResult | null;
}

export default function GlossPanel({ result }: Props) {
  if (!result) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <p style={{ color: 'var(--text-muted)' }}>No translation result yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: 0.5 }}>
          Gloss Translation
        </div>
        <div style={{ lineHeight: 2 }}>
          {result.gloss.length > 0 ? (
            result.gloss.map((word, i) => (
              <span key={i} className="gloss-tag">{word}</span>
            ))
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>No gloss tokens generated.</span>
          )}
        </div>
      </div>

      {result.transcript && (
        <div className="card">
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: 0.5 }}>
            Original Transcript
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }} dir="auto">
            {result.transcript}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
        <span>Animations: {result.animations?.length || 0}</span>
        <span>Tokens used: {result.tokens_used}</span>
        {result.remaining_tokens !== undefined && (
          <span>Remaining: {result.remaining_tokens}</span>
        )}
      </div>
    </div>
  );
}

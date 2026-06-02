import React from 'react';
import type { TranscriptSegmentWithTimestamp, ExtractionSource, DetectedLanguage } from '../../types';

interface Props {
  segments: TranscriptSegmentWithTimestamp[];
  transcript: string;
  onTranslate: () => void;
  translating: boolean;
  source?: ExtractionSource | null;
  language?: DetectedLanguage | null;
}

export default function TranscriptPanel({ segments, transcript, onTranslate, translating, source, language }: Props) {
  return (
    <div>
      <div className="card" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <div className="segment-header">
          <span>Segments ({segments.length})</span>
          {source && (
            <span className="source-indicator">
              {source === 'transcript_panel' ? '📝 Panel' : '🎤 Captions'}
            </span>
          )}
        </div>
        {segments.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{transcript}</div>
        ) : (
          segments.map((seg, i) => (
            <div key={i} className="segment">
              {seg.timestamp && <span className="time">{seg.timestamp}</span>}
              <span className="text" dir="auto">{seg.text}</span>
            </div>
          ))
        )}
      </div>
      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 8 }}
        onClick={onTranslate}
        disabled={translating}
      >
        {translating ? (
          <><div className="spinner" /> Translating...</>
        ) : (
          'Translate to Sign Language'
        )}
      </button>
    </div>
  );
}

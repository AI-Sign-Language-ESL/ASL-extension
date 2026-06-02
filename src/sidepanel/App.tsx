import React, { useEffect, useState, useCallback } from 'react';
import type { VideoInfo, TranscriptSegmentWithTimestamp, TranslationResult, ExtensionMessage, ExtractionSource, DetectedLanguage } from '../types';
import { sendMessage, sendMessageToCurrentTab } from '../utils/messages';
import { authService } from '../services/auth';
import { logger } from '../utils/logger';
import TranscriptPanel from './components/TranscriptPanel';
import GlossPanel from './components/GlossPanel';
import AvatarPanel from './components/AvatarPanel';

type Tab = 'transcript' | 'gloss' | 'avatar';

export default function App() {
  const [tab, setTab] = useState<Tab>('transcript');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [segments, setSegments] = useState<TranscriptSegmentWithTimestamp[]>([]);
  const [transcript, setTranscript] = useState('');
  const [source, setSource] = useState<ExtractionSource | null>(null);
  const [language, setLanguage] = useState<DetectedLanguage | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    init();
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => { chrome.runtime.onMessage.removeListener(handleMessage); };
  }, []);

  async function init() {
    const session = await authService.getSession();
    setIsAuth(!!session.token);
    try {
      const info = await sendMessage<VideoInfo>({ type: 'GET_VIDEO_INFO' });
      if (info?.videoId) setVideoInfo(info);
    } catch {}
    try {
      const stored = await chrome.storage.local.get(['translationResult', 'translationMeta']);
      if (stored.translationResult) {
        setResult(stored.translationResult);
        setTranscript(stored.translationResult.transcript || '');
        const meta = stored.translationMeta || {};
        if (meta.videoId) setVideoInfo((prev) => prev || { videoId: meta.videoId, videoTitle: meta.videoTitle || null, videoUrl: null });
        if (meta.source) setSource(meta.source);
        if (meta.language) setLanguage(meta.language);
        logger.info('Loaded stored translation result:', stored.translationResult.translation_id);
      }
    } catch {}
  }

  const handleMessage = (msg: ExtensionMessage) => {
    if (msg.type === 'VIDEO_INFO') setVideoInfo(msg.payload as VideoInfo);
    if (msg.type === 'TRANSLATION_RESULT') {
      const payload = msg.payload as { jobId: number; result: TranslationResult };
      if (payload?.result) { setResult(payload.result); setTranslating(false); }
    }
    if (msg.type === 'TRANSCRIPT_ERROR') { setError(msg.error || 'Translation failed'); setTranslating(false); }
  };

  const handleExtract = useCallback(async () => {
    setError(null);
    setExtracting(true);
    try {
      const res = await sendMessageToCurrentTab<{
        success: boolean;
        segments?: TranscriptSegmentWithTimestamp[];
        transcript?: string;
        source?: ExtractionSource;
        language?: DetectedLanguage;
        error?: string;
      }>({ type: 'EXTRACT_TRANSCRIPT' });
      if (res?.success && res.transcript) {
        setSegments(res.segments || []);
        setTranscript(res.transcript);
        setSource(res.source || null);
        setLanguage(res.language || null);
      } else {
        setError(res?.error || 'No transcript available');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleTranslate = useCallback(async () => {
    if (!transcript) return;
    setError(null);
    setTranslating(true);
    try {
      const res = await sendMessage<{ success: boolean; result?: TranslationResult; error?: string }>({
        type: 'START_TRANSLATION',
        payload: {
          videoId: videoInfo?.videoId || '',
          videoTitle: videoInfo?.videoTitle || '',
          transcript,
          segments,
        },
      });
      if (res?.success && res.result) {
        setResult(res.result);
      } else {
        setError(res?.error || 'Translation failed');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  }, [transcript, videoInfo, segments]);

  const hasTranscript = transcript.length > 0;
  const hasResult = result !== null;

  return (
    <div className="container">
      <div className="header">
        <span className="brand">TAFAHOM</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {videoInfo?.videoTitle?.slice(0, 40) || 'No video'}
        </span>
      </div>
      <div className="content">
        {!isAuth && (
          <div className="error-box">
            Please sign in to use Tafahom. Open the extension popup to log in.
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        {!hasTranscript && !hasResult && (
          <div className="card" style={{ textAlign: 'center', padding: 24 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
              Extract the transcript from this YouTube video to begin translation.
            </p>
            <button
              className="btn btn-primary"
              onClick={handleExtract}
              disabled={extracting || !videoInfo?.videoId}
            >
              {extracting ? <><div className="spinner" /> Extracting...</> : 'Extract Transcript'}
            </button>
          </div>
        )}
        {hasTranscript && (
          <>
            {source && (
              <div className="source-badge">
                Source: {source === 'transcript_panel' ? 'Transcript Panel' : 'Live Captions'}
                {language && ` · ${language === 'arabic' ? 'Arabic' : language === 'latin' ? 'English' : 'Detected'}`}
              </div>
            )}
            <div className="tabs">
              {(['transcript', 'gloss', 'avatar'] as Tab[]).map((t) => (
                <button
                  key={t}
                  className={`tab ${tab === t ? 'active' : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {tab === 'transcript' && (
              <TranscriptPanel
                segments={segments}
                transcript={transcript}
                onTranslate={handleTranslate}
                translating={translating}
                source={source}
                language={language}
              />
            )}
            {tab === 'gloss' && <GlossPanel result={result} />}
            {tab === 'avatar' && <AvatarPanel result={result} />}
          </>
        )}
        {!hasTranscript && hasResult && (
          <>
            <div className="tabs">
              {(['gloss', 'avatar'] as Tab[]).map((t) => (
                <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {tab === 'gloss' && <GlossPanel result={result} />}
            {tab === 'avatar' && <AvatarPanel result={result} />}
          </>
        )}
      </div>
      <div className="status-bar">
        <span className={`status-dot ${videoInfo?.videoId ? 'active' : 'inactive'}`} />
        {videoInfo?.videoId ? 'YouTube connected' : 'No video'}
      </div>
    </div>
  );
}

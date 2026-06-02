import React, { useEffect, useState, useCallback } from 'react';
import type { VideoInfo, User, AuthState, TranscriptState, TranslationState, ExtractionSource, DetectedLanguage } from '../types';
import { authService } from '../services/auth';
import { api } from '../services/api';
import { sendMessage, sendMessageToCurrentTab } from '../utils/messages';
import { logger } from '../utils/logger';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import VideoInfoCard from './components/VideoInfoCard';
import UserMenu from './components/UserMenu';

type View = 'loading' | 'auth' | 'register' | 'main';

export default function App() {
  const [view, setView] = useState<View>('loading');
  const [auth, setAuth] = useState<AuthState>({ isAuthenticated: false, user: null, token: null, loading: true });
  const [videoInfo, setVideoInfo] = useState<VideoInfo>({ videoId: null, videoTitle: null, videoUrl: null });
  const [transcriptState, setTranscriptState] = useState<TranscriptState>('idle');
  const [translationState, setTranslationState] = useState<TranslationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [extractionSource, setExtractionSource] = useState<ExtractionSource | null>(null);
  const [detectedLang, setDetectedLang] = useState<DetectedLanguage | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      const session = await authService.getSession();
      const isAuth = !!session.token;
      setAuth({ isAuthenticated: isAuth, user: session.user, token: session.token, loading: false });
      setView(isAuth ? 'main' : 'auth');
      const info = await sendMessage<VideoInfo>({ type: 'GET_VIDEO_INFO' });
      if (info?.videoId) setVideoInfo(info);
    } catch {
      setAuth({ isAuthenticated: false, user: null, token: null, loading: false });
      setView('auth');
    }
  }

  const handleLogin = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const data = await api.login(email, password);
      const user = data.user || await api.getMe();
      const token = data.access || '';
      await authService.saveSession(token, data.refresh, user);
      setAuth({ isAuthenticated: true, user, token, loading: false });
      setView('main');
    } catch (e) { setError((e as Error).message); }
  }, []);

  const handleRegister = useCallback(async (data: Record<string, string>) => {
    setError(null);
    try {
      await api.register(data);
      setView('auth');
      setError('Registration successful. Please log in.');
    } catch (e) { setError((e as Error).message); }
  }, []);

  const handleLogout = useCallback(async () => {
    await authService.clearSession();
    setAuth({ isAuthenticated: false, user: null, token: null, loading: false });
    setView('auth');
  }, []);

  const handleExtract = useCallback(async () => {
    setError(null);
    setTranscriptState('extracting');
    setExtractionSource(null);
    setDetectedLang(null);
    try {
      const result = await sendMessageToCurrentTab<{
        success: boolean;
        segments?: unknown[];
        transcript?: string;
        source?: ExtractionSource;
        language?: DetectedLanguage;
        error?: string;
      }>({ type: 'EXTRACT_TRANSCRIPT' });
      if (result?.success && result.transcript) {
        setTranscriptState('available');
        setExtractionSource(result.source || null);
        setDetectedLang(result.language || null);
      } else {
        setTranscriptState('unavailable');
        setError(result?.error || 'No transcript available');
      }
    } catch (e) {
      setTranscriptState('error');
      setError((e as Error).message);
    }
  }, []);

  const handleTranslate = useCallback(async () => {
    setError(null);
    setTranslationState('translating');
    try {
      const transcriptResponse = await sendMessageToCurrentTab<{
        success: boolean; transcript?: string; segments?: unknown[];
        source?: ExtractionSource; language?: DetectedLanguage; error?: string;
      }>({ type: 'EXTRACT_TRANSCRIPT' });
      if (!transcriptResponse?.success || !transcriptResponse.transcript) {
        throw new Error(transcriptResponse?.error || 'No transcript');
      }
      const response = await sendMessage<{ success: boolean; result?: unknown; error?: string }>({
        type: 'START_TRANSLATION',
        payload: {
          videoId: videoInfo.videoId,
          videoTitle: videoInfo.videoTitle,
          transcript: transcriptResponse.transcript,
          segments: transcriptResponse.segments,
        },
      });
      if (response?.success) {
        setTranslationState('complete');
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            await chrome.sidePanel.open({ tabId: tabs[0].id });
          }
        } catch {}
      } else {
        throw new Error(response?.error || 'Translation failed');
      }
    } catch (e) {
      setTranslationState('idle');
      setError((e as Error).message);
    }
  }, [videoInfo]);

  if (auth.loading) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <span className="brand">TAFAHOM</span>
        {auth.isAuthenticated && <UserMenu user={auth.user} onLogout={handleLogout} />}
      </div>
      {view === 'auth' && (
        <LoginForm onLogin={handleLogin} onSwitchToRegister={() => { setView('register'); setError(null); }} error={error} />
      )}
      {view === 'register' && (
        <RegisterForm onRegister={handleRegister} onSwitchToLogin={() => { setView('auth'); setError(null); }} error={error} />
      )}
      {view === 'main' && (
        <>
          <VideoInfoCard videoInfo={videoInfo} />
          <div className="card">
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={handleExtract}
                disabled={!videoInfo.videoId || transcriptState === 'extracting'}
              >
                {transcriptState === 'extracting' ? (
                  <><div className="spinner" /> Extracting...</>
                ) : (
                  'Extract Transcript'
                )}
              </button>
              <button className="btn btn-secondary" onClick={async () => {
                try {
                  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                  if (tabs[0]?.id) {
                    await chrome.sidePanel.open({ tabId: tabs[0].id });
                  }
                } catch (e) {
                  logger.error('Open Panel failed:', e);
                }
              }}>
                Open Panel
              </button>
            </div>
            {extractionSource && (
              <div className="source-badge" style={{ marginTop: 8 }}>
                {extractionSource === 'transcript_panel' ? '📝 Transcript Panel' : '🎤 Live Captions'}
                {detectedLang && ` · ${detectedLang === 'arabic' ? 'Arabic' : detectedLang === 'latin' ? 'English' : ''}`}
              </div>
            )}
            {transcriptState === 'available' && (
              <button
                className="btn btn-primary"
                style={{ marginTop: 8 }}
                onClick={handleTranslate}
                disabled={translationState === 'translating'}
              >
                {translationState === 'translating' ? (
                  <><div className="spinner" /> Translating...</>
                ) : (
                  'Translate to Sign Language'
                )}
              </button>
            )}
            {translationState === 'complete' && (
              <div className="success" style={{ marginTop: 8, textAlign: 'center' }}>
                Translation complete! Open the side panel to view.
              </div>
            )}
          </div>
          {error && <div className="error">{error}</div>}
        </>
      )}
    </div>
  );
}

import type { ExtensionMessage, VideoInfo, TranslationResult, TranscriptSegmentWithTimestamp, DetectedLanguage } from '../types';
import { authService } from '../services/auth';
import { clearExpiredCache } from '../utils/cache';
import { logger } from '../utils/logger';

let currentVideo: VideoInfo = { videoId: null, videoTitle: null, videoUrl: null };

// Load persisted video info from chrome.storage.session on startup
(async function loadPersistedVideoInfo() {
  try {
    const stored = await chrome.storage.session.get('currentVideo');
    if (stored.currentVideo?.videoId) {
      currentVideo = stored.currentVideo as VideoInfo;
      logger.info('Loaded persisted video info:', currentVideo.videoId);
    }
  } catch {}
})();

function getApiBaseUrl(): string {
  return 'https://api.tafahom.io/api/v1';
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await authService.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
  return headers;
}

async function refreshTokenIfNeeded(): Promise<boolean> {
  const session = await authService.getSession();
  if (!session.refresh) return false;
  try {
    const resp = await fetch(`${getApiBaseUrl()}/authentication/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: session.refresh }),
    });
    if (!resp.ok) throw new Error('Refresh failed');
    const data = await resp.json() as { access: string; refresh?: string };
    await authService.saveSession(data.access, data.refresh || session.refresh);
    return true;
  } catch (e) {
    logger.error('Token refresh failed:', e);
    await authService.clearSession();
    return false;
  }
}

async function authenticatedFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${getApiBaseUrl()}${endpoint}`;
  let headers = await getAuthHeaders();
  const mergedHeaders = { ...headers, ...(options.headers as Record<string, string> || {}) };
  const opts = { ...options, headers: mergedHeaders };
  let response = await fetch(url, opts);
  if (response.status === 401) {
    const refreshed = await refreshTokenIfNeeded();
    if (refreshed) {
      headers = await getAuthHeaders();
      opts.headers = { ...headers, ...(options.headers as Record<string, string> || {}) };
      response = await fetch(url, opts);
    } else {
      throw new Error('Session expired. Please log in again.');
    }
  }
  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, unknown>;
      errorMsg = (errorData.error as string) || (errorData.detail as string) || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }
  return response.json() as Promise<T>;
}

async function handleTranscriptReady(
  payload: {
    videoId: string;
    videoTitle: string;
    transcript: string;
    segments: TranscriptSegmentWithTimestamp[];
    source: string;
    language: DetectedLanguage;
  },
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    logger.info('TRANSCRIPT_READY: Submitting to process-transcript endpoint');
    const result = await authenticatedFetch<TranslationResult>('/youtube/process-transcript/', {
      method: 'POST',
      body: JSON.stringify({
        video_id: payload.videoId,
        title: payload.videoTitle,
        transcript: payload.transcript,
        segments: payload.segments,
        source: payload.source,
        language: payload.language,
      }),
    });
    logger.info('TRANSCRIPT_READY: Success', result);
    await chrome.storage.local.set({
      translationResult: result,
      translationMeta: { source: payload.source, language: payload.language, videoId: payload.videoId, videoTitle: payload.videoTitle },
    });
    logger.info('Translation result stored in chrome.storage.local');
    sendResponse({ success: true, result });
  } catch (e) {
    logger.error('TRANSCRIPT_READY: Failed', e);
    sendResponse({ success: false, error: (e as Error).message });
  }
}

async function handleStartTranslation(
  payload: { videoId: string; videoTitle: string; transcript: string; segments?: TranscriptSegmentWithTimestamp[] },
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    logger.info('START_TRANSLATION: Submitting to backend');
    const result = await authenticatedFetch<TranslationResult>('/youtube/process-transcript/', {
      method: 'POST',
      body: JSON.stringify({
        video_id: payload.videoId,
        title: payload.videoTitle,
        transcript: payload.transcript,
        segments: payload.segments || [],
      }),
    });
    logger.info('START_TRANSLATION: Success', result);
    await chrome.storage.local.set({ translationResult: result });
    logger.info('Translation result stored in chrome.storage.local');
    sendResponse({ success: true, result });
  } catch (e) {
    logger.error('START_TRANSLATION: Failed', e);
    sendResponse({ success: false, error: (e as Error).message });
  }
}

async function handleGetMe(sendResponse: (response: unknown) => void): Promise<void> {
  try {
    const user = await authenticatedFetch<Record<string, unknown>>('/users/me/');
    sendResponse({ success: true, user });
  } catch (e) {
    sendResponse({ success: false, error: (e as Error).message });
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  logger.info('Message received:', message.type, message.payload ? '(with payload)' : '');
  switch (message.type) {
    case 'VIDEO_INFO':
      currentVideo = message.payload as VideoInfo;
      chrome.storage.session.set({ currentVideo: message.payload }).catch(() => {});
      sendResponse({ received: true });
      break;
    case 'GET_VIDEO_INFO':
      sendResponse(currentVideo);
      break;
    case 'PING':
      sendResponse({ alive: true });
      break;
    case 'OPEN_SIDE_PANEL':
      (async () => {
        let tabId = sender.tab?.id;
        if (!tabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
        }
        if (tabId) {
          try {
            await chrome.sidePanel.open({ tabId });
            logger.info('Side panel opened for tab', tabId);
          } catch (e) {
            logger.error('Failed to open side panel:', e);
          }
        } else {
          logger.warn('No tab ID available for side panel');
        }
      })();
      sendResponse({ opened: true });
      break;
    case 'AUTH_EXPIRED':
      authService.clearSession().then(() => sendResponse({ cleared: true }));
      return true;
    case 'TRANSCRIPT_READY':
      handleTranscriptReady(
        message.payload as {
          videoId: string;
          videoTitle: string;
          transcript: string;
          segments: TranscriptSegmentWithTimestamp[];
          source: string;
          language: DetectedLanguage;
        },
        sendResponse
      );
      return true;
    case 'START_TRANSLATION':
      handleStartTranslation(
        message.payload as { videoId: string; videoTitle: string; transcript: string; segments?: TranscriptSegmentWithTimestamp[] },
        sendResponse
      );
      return true;
    case 'GET_ME':
      handleGetMe(sendResponse);
      return true;
    case 'FETCH_MAIN_PLAYER_RESPONSE':
      (async () => {
        try {
          const tabId = sender.tab?.id;
          if (!tabId) { sendResponse({ error: 'No tab' }); return; }
          logger.info('Executing script in MAIN world for tab', tabId);
          const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              try {
                return (window as any).ytInitialPlayerResponse || null;
              } catch { return null; }
            },
          });
          const data = result?.result as Record<string, unknown> | null | undefined;
          logger.info('MAIN world execution result:', data ? 'data received' : 'null');
          sendResponse({ data: data || null });
        } catch (e) {
          logger.error('MAIN world execution failed:', e);
          sendResponse({ error: (e as Error).message });
        }
      })();
      return true;
    case 'REFRESH_TOKEN':
      refreshTokenIfNeeded().then((ok) => sendResponse({ success: ok })).catch(() => sendResponse({ success: false }));
      return true;
    case 'FETCH_TEXT':
      console.log('[BACKGROUND] FETCH_TEXT received', message);
      (async () => {
        try {
          if (!message.payload || !(message.payload as any).url) {
            console.error('[BACKGROUND] Missing URL in payload');
            sendResponse({ error: 'Missing URL in payload' });
            return;
          }
          
          const url = (message.payload as any).url;
          console.log('[BACKGROUND] Fetch started for URL:', url);
          
          const resp = await fetch(url);
          console.log('[BACKGROUND] Fetch completed. Status:', resp.status);
          console.log('[BACKGROUND] Headers:', [...resp.headers.entries()]);
          
          if (!resp.ok) {
            console.warn('[BACKGROUND] Sending response: error HTTP', resp.status);
            sendResponse({ error: `HTTP ${resp.status}` });
            return;
          }
          
          const text = await resp.text();
          console.log('[BACKGROUND] Text length:', text.length);
          console.log('[BACKGROUND] Preview:', text.slice(0, 1000));
          
          console.log('[BACKGROUND] Sending response');
          sendResponse({ text });
        } catch (e) {
          console.error('[BACKGROUND] Fetch failed:', e);
          console.log('[BACKGROUND] Sending response with error');
          sendResponse({ error: (e as Error).message });
        }
      })();
      return true;
    default:
      logger.warn('Unknown message type:', message.type);
      sendResponse({ error: `Unknown type: ${message.type}` });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com/watch')) {
    try {
      if (chrome.runtime?.id) {
        chrome.tabs.sendMessage(tabId, { type: 'PING' } as ExtensionMessage).catch(() => {});
      }
    } catch (e) {
      logger.warn('Failed to send PING msg', e);
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  clearExpiredCache();
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
});

logger.info('Background service worker started');

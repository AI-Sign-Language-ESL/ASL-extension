const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[TAFAHOM:bg]', ...args);
}

function warn(...args) {
  if (DEBUG) console.warn('[TAFAHOM:bg]', ...args);
}

function error(...args) {
  console.error('[TAFAHOM:bg]', ...args);
}

let sessionData = {
  videoUrl: null,
  videoTitle: null,
  videoId: null,
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log('Message received:', request.type);

  switch (request.type) {
    case 'VIDEO_INFO':
      sessionData.videoUrl = request.videoUrl;
      sessionData.videoTitle = request.videoTitle;
      sessionData.videoId = request.videoId;
      log('Video info updated:', request.videoTitle, request.videoId);
      break;

    case 'GET_SESSION_DATA':
      sendResponse(sessionData);
      break;

    case 'AUTH_EXPIRED':
      log('Auth expired, clearing session');
      chrome.storage.local.remove(['token', 'refresh', 'user'], () => {
        chrome.action.setPopup({ popup: 'popup/popup.html' });
      });
      break;

    case 'OPEN_DASHBOARD':
      log('Opening dashboard tab');
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
      break;

    case 'REFRESH_TOKEN':
      (async () => {
        try {
          const { refresh } = await chrome.storage.local.get('refresh');
          if (!refresh) {
            log('No refresh token available');
            sendResponse({ success: false, error: 'No refresh token' });
            return;
          }
          const response = await fetch('https://api.tafahom.io/api/v1/authentication/token/refresh/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh }),
          });
          if (!response.ok) throw new Error('Refresh failed');
          const data = await response.json();
          await chrome.storage.local.set({
            token: data.access,
            refresh: data.refresh || refresh,
          });
          log('Token refreshed successfully');
          sendResponse({ success: true, token: data.access });
        } catch (e) {
          error('Token refresh failed:', e.message);
          chrome.storage.local.remove(['token', 'refresh', 'user']);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    case 'TRANSCRIPT_READY':
      log('Transcript ready, forwarding to backend');
      (async () => {
        try {
          const response = await fetch('https://api.tafahom.io/api/v1/youtube/process-transcript/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              video_id: request.videoId,
              title: request.videoTitle || '',
              transcript: request.transcript,
            }),
          });
          if (response.ok) {
            log('Transcript forwarded to backend successfully');
          } else {
            warn('Backend returned:', response.status);
          }
        } catch (e) {
          error('Failed to forward transcript:', e.message);
        }
      })();
      sendResponse({ received: true });
      break;

    case 'PING':
      sendResponse({ alive: true });
      break;

    default:
      log('Unknown message type:', request.type);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com/watch')) {
    log('YouTube tab updated, sending PAGE_READY');
    chrome.tabs.sendMessage(tabId, { type: 'PAGE_READY' }).catch(() => {});
  }
});

log('Background service worker started');

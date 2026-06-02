import { extractVideoId, extractTranscript, startCaptionCapture, stopCaptionCapture, getCapturedCaptions, clearCapturedCaptions } from '../services/transcript-service';
import { logger } from '../utils/logger';
import type { VideoInfo, ExtensionMessage, ExtractionResult, TranscriptSegmentWithTimestamp, ExtractionSource, DetectedLanguage } from '../types';

let currentVideoId: string | null = null;
let currentVideoTitle = '';
let currentVideoUrl = '';
let tafahomButton: HTMLElement | null = null;
let extractionInProgress = false;

function isYouTubePage(): boolean {
  return window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be');
}

function isWatchPage(): boolean {
  return window.location.pathname === '/watch' || window.location.pathname.startsWith('/watch/');
}

function getVideoTitle(): string | null {
  const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
  if (el?.textContent?.trim()) return el.textContent.trim();
  const el2 = document.querySelector('#title h1');
  if (el2?.textContent?.trim()) return el2.textContent.trim();
  const meta = document.querySelector('meta[name="title"]');
  if (meta) return meta.getAttribute('content');
  return document.title.replace(' - YouTube', '').trim() || null;
}

function getVideoUrl(): string {
  return window.location.href;
}

function injectButton(): void {
  removeButton();
  if (!isWatchPage()) return;
  const targetRow = document.querySelector('#top-level-buttons-computed') ||
                    document.querySelector('#actions-inner') ||
                    document.querySelector('#menu-container') ||
                    document.querySelector('#primary #menu');
  if (!targetRow) {
    setTimeout(injectButton, 2000);
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'tafahom-translate-btn';
  btn.setAttribute('data-tafahom', 'true');
  btn.innerHTML = `
    <span class="tafahom-btn-icon">🤟</span>
    <span class="tafahom-btn-label">Translate with Tafahom</span>
    <span class="tafahom-btn-spinner" style="display:none"></span>
  `;
  btn.addEventListener('click', handleTranslateClick);
  targetRow.appendChild(btn);
  tafahomButton = btn;
  logger.info('Tafahom button injected');
}

function removeButton(): void {
  document.querySelectorAll('[data-tafahom="true"]').forEach((el) => el.remove());
  tafahomButton = null;
}

function setButtonState(state: 'idle' | 'loading' | 'success' | 'error', message?: string): void {
  if (!tafahomButton) return;
  const label = tafahomButton.querySelector('.tafahom-btn-label');
  const spinner = tafahomButton.querySelector('.tafahom-btn-spinner') as HTMLElement;
  tafahomButton.classList.remove('tafahom-btn-loading', 'tafahom-btn-success', 'tafahom-btn-error');
  if (state === 'loading') {
    tafahomButton.classList.add('tafahom-btn-loading');
    if (spinner) spinner.style.display = 'inline-block';
    if (label) label.textContent = message || 'Extracting...';
  } else {
    if (spinner) spinner.style.display = 'none';
    if (state === 'success') {
      tafahomButton.classList.add('tafahom-btn-success');
      if (label) label.textContent = message || 'Translated!';
      setTimeout(() => { if (label) label.textContent = 'Translate with Tafahom'; tafahomButton?.classList.remove('tafahom-btn-success'); }, 3000);
    } else if (state === 'error') {
      tafahomButton.classList.add('tafahom-btn-error');
      if (label) label.textContent = message || 'Retry';
      setTimeout(() => { if (label) label.textContent = 'Translate with Tafahom'; tafahomButton?.classList.remove('tafahom-btn-error'); }, 5000);
    } else {
      if (label) label.textContent = 'Translate with Tafahom';
    }
  }
}

async function handleTranslateClick(): Promise<void> {
  if (extractionInProgress) return;
  extractionInProgress = true;
  setButtonState('loading', 'Extracting transcript...');
  try {
    const result = await extractTranscript();
    setButtonState('loading', 'Sending to Tafahom...');
    const response = await chrome.runtime.sendMessage({
      type: 'TRANSCRIPT_READY',
      payload: {
        videoId: result.videoId,
        videoTitle: result.videoTitle,
        transcript: result.transcript,
        segments: result.segments,
        source: result.source,
        language: result.language,
      },
    });
    if (response?.success) {
      setButtonState('success', 'Sent to Tafahom!');
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
    } else {
      setButtonState('error', response?.error || 'Failed');
      logger.error('Translation submission failed:', response?.error);
    }
  } catch (e) {
    setButtonState('error', (e as Error).message?.slice(0, 40) || 'Error');
    logger.error('Extraction failed:', e);
  } finally {
    extractionInProgress = false;
  }
}

function extractAndBroadcastInfo(): void {
  const vid = extractVideoId(window.location.href);
  const title = getVideoTitle();
  const url = getVideoUrl();
  if (vid && vid !== currentVideoId) {
    currentVideoId = vid;
    logger.info('Video ID:', vid);
    clearCapturedCaptions();
    injectButton();
  }
  if (title) currentVideoTitle = title;
  if (url) currentVideoUrl = url;
  if (currentVideoId) {
    chrome.runtime.sendMessage({
      type: 'VIDEO_INFO',
      payload: { videoId: currentVideoId, videoTitle: currentVideoTitle, videoUrl: currentVideoUrl } as VideoInfo,
    } as ExtensionMessage).catch(() => {});
  }
}

function safeSendResponse(sendResponse: (response: unknown) => void, response: unknown): void {
  try {
    sendResponse(response);
  } catch {
    // Sender disconnected before response was ready - this is expected
    // when the popup/sidepanel closes before async extraction completes
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_VIDEO_INFO':
      sendResponse({ videoId: currentVideoId, videoTitle: currentVideoTitle, videoUrl: currentVideoUrl } as VideoInfo);
      break;
    case 'EXTRACT_TRANSCRIPT':
      extractTranscript()
        .then((result: ExtractionResult) => {
          safeSendResponse(sendResponse, { success: true, ...result });
        })
        .catch((e) => {
          safeSendResponse(sendResponse, { success: false, error: e.message });
        });
      return true;
    case 'PING':
      sendResponse({ alive: true });
      break;
  }
});

function handleNavigation(): void {
  currentVideoId = null;
  removeButton();
  stopCaptionCapture();
  setTimeout(extractAndBroadcastInfo, 1500);
}

document.addEventListener('yt-navigate-finish', handleNavigation);
window.addEventListener('popstate', () => {
  setTimeout(extractAndBroadcastInfo, 1000);
});

setTimeout(extractAndBroadcastInfo, 2000);

const styleEl = document.createElement('style');
styleEl.textContent = `
  [data-tafahom="true"] {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px;
    height: 36px;
    border: none;
    border-radius: 18px;
    background: linear-gradient(135deg, #7c5cfc, #a78bfa);
    color: #fff;
    font-family: 'YouTube Sans', Roboto, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    margin-left: 8px;
    white-space: nowrap;
  }
  [data-tafahom="true"]:hover {
    background: linear-gradient(135deg, #6a48e8, #9678e8);
    transform: scale(1.03);
  }
  [data-tafahom="true"]:active {
    transform: scale(0.97);
  }
  [data-tafahom="true"].tafahom-btn-loading {
    opacity: 0.8;
    pointer-events: none;
  }
  [data-tafahom="true"].tafahom-btn-success {
    background: linear-gradient(135deg, #48c774, #5ddb8a);
  }
  [data-tafahom="true"].tafahom-btn-error {
    background: linear-gradient(135deg, #e04848, #f06060);
  }
  .tafahom-btn-icon {
    font-size: 16px;
  }
  .tafahom-btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: tafahom-spin 0.6s linear infinite;
  }
  @keyframes tafahom-spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleEl);

if (!isYouTubePage()) {
  logger.warn('Not a YouTube page');
} else {
  logger.info('Content script loaded');
}

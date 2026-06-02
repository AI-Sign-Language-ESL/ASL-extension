import type { TranscriptSegmentWithTimestamp, ExtractionSource, DetectedLanguage, ExtractionResult } from '../types';
import { logger } from '../utils/logger';

export class TranscriptError extends Error {
  code: string;
  constructor(message: string, code = 'UNKNOWN') {
    super(message);
    this.name = 'TranscriptError';
    this.code = code;
  }
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    let vid = u.searchParams.get('v');
    if (!vid && u.pathname.startsWith('/embed/')) vid = u.pathname.split('/')[2];
    if (!vid && u.pathname.startsWith('/shorts/')) vid = u.pathname.split('/')[2];
    if (!vid && u.hostname === 'youtu.be') vid = u.pathname.slice(1).split('?')[0];
    return vid && /^[0-9A-Za-z_-]{11}$/.test(vid) ? vid : null;
  } catch {
    return null;
  }
}

export function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function detectLanguage(text: string): DetectedLanguage {
  if (containsArabic(text)) return 'arabic';
  if (/[a-zA-Z]/.test(text)) return 'latin';
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findButtonByText(textPattern: RegExp): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>(
    'button, a[role="button"], [role="menuitem"], tp-yt-paper-listbox-button, #items > ytd-menu-service-item-renderer, ytd-menu-service-item-renderer'
  );
  for (const btn of buttons) {
    if (textPattern.test(btn.textContent?.trim() || '')) return btn;
  }
  return null;
}

async function openTranscriptPanel(): Promise<boolean> {
  const panelSelectors = [
    '#panels ytd-transcript-renderer',
    '#transcript ytd-transcript-renderer',
    'ytd-transcript-renderer',
    '#transcript-panel',
    '#panels',
    '#secondary ytd-transcript-renderer',
    '#secondary #transcript',
    '#transcript',
  ];
  for (const sel of panelSelectors) {
    const panel = document.querySelector(sel);
    if (panel && (panel as HTMLElement).offsetParent !== null) {
      logger.info('Transcript panel already open (found via', sel, ')');
      return true;
    }
  }

  const transcriptBtn = findButtonByText(/transcript|النص/i);
  if (transcriptBtn) {
    transcriptBtn.click();
    await sleep(1500);
    logger.info('Clicked transcript button directly');
    return true;
  }

  const moreBtnSelectors = [
    'button[aria-label="More actions"]',
    '#button[aria-label="More actions"]',
    'ytd-button-renderer#button-shape button[aria-label*="More"]',
    '#menu-button button',
    '#top-level-buttons-computed > ytd-button-renderer:last-child button',
    '#actions-inner > ytd-button-renderer:last-child button',
    'ytd-menu-renderer button[aria-label*="More"]',
    '#menu-container button[aria-label*="More"]',
    '#top-level-buttons-computed button:last-of-type',
    '#actions-inner button:last-of-type',
  ];
  let moreBtn: HTMLElement | null = null;
  for (const sel of moreBtnSelectors) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn) { moreBtn = btn; break; }
  }
  if (!moreBtn) {
    const btns = document.querySelectorAll<HTMLElement>('#top-level-buttons-computed button, #actions-inner button, #menu-container button');
    if (btns.length > 0) moreBtn = btns[btns.length - 1];
  }
  if (moreBtn) {
    logger.info('Clicking "More actions" button');
    moreBtn.click();
    await sleep(800);
    const menuItem = findButtonByText(/transcript|النص|show transcript/i);
    if (menuItem) {
      menuItem.click();
      await sleep(2000);
      logger.info('Opened transcript via menu item');
      return true;
    }
    logger.warn('Menu opened but no transcript option found');
    document.body.click();
    await sleep(300);
  }
  return false;
}

function getPanelContainer(): Element | null {
  const panelSelectors = [
    '#panels ytd-transcript-renderer',
    '#transcript ytd-transcript-renderer',
    'ytd-transcript-renderer',
    '#transcript-panel',
    '#panels',
    '#secondary ytd-transcript-renderer',
    '#secondary #transcript',
    '#transcript',
    '#panels.ytd-watch-flexy',
    'ytd-watch-flexy #panels',
  ];
  for (const sel of panelSelectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const JUNK_PATTERNS = /views?|likes?|channel|instagram|facebook|twitter|إضافة عنوان|إظهار النص|مطلوب|تعليق|مشاركة|حفظ|شكراً|اشتراك|subscribe|share|save|comment|http|www\.|\/shorts|@\w+/i;

const TIMESTAMP_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;

function findSegmentRows(): { rows: Element[]; selector: string } | null {
  const selectors = [
    'ytd-transcript-segment-renderer',
    '#segments ytd-transcript-segment-renderer',
    '#segments > *',
  ];

  const panel = getPanelContainer();
  if (!panel) return null;

  for (const sel of selectors) {
    const candidates = Array.from(panel.querySelectorAll(sel));
    if (candidates.length === 0) continue;
    logger.info(`Transcript row selector used: "${sel}"`);
    logger.info(`Found ${candidates.length} transcript rows`);
    logger.info('First row outerHTML:', candidates[0].outerHTML);
    return { rows: candidates, selector: sel };
  }

  const segmentsContainer = panel.querySelector('#segments');
  if (segmentsContainer && segmentsContainer.children.length > 0) {
    const children = Array.from(segmentsContainer.children);
    logger.info('Transcript row selector used: "#segments > children"');
    logger.info(`Found ${children.length} transcript rows`);
    logger.info('First row outerHTML:', children[0].outerHTML);
    return { rows: children, selector: '#segments > children' };
  }

  return null;
}

function extractTimestampFromRow(row: Element): string | null {
  const tsEl = row.querySelector('.segment-timestamp, .timestamp, [class*="time"], [class*="timestamp"]');
  if (tsEl) {
    const ts = tsEl.textContent?.trim().replace(/\s+/g, '') || '';
    if (TIMESTAMP_RE.test(ts)) return ts;
  }

  for (const child of row.children) {
    const text = child.textContent?.trim().replace(/\s+/g, '') || '';
    if (TIMESTAMP_RE.test(text)) return text;
  }

  return null;
}

function extractTextFromRow(row: Element): string | null {
  const textEl = row.querySelector('.segment-text, .text, [class*="text"], [class*="content"]');
  if (textEl) {
    const t = textEl.textContent?.trim() || '';
    if (t.length >= 2 && !JUNK_PATTERNS.test(t)) return t;
  }

  for (const child of row.children) {
    const text = child.textContent?.trim() || '';
    if (TIMESTAMP_RE.test(text.replace(/\s+/g, ''))) continue;
    if (text.length >= 2 && !JUNK_PATTERNS.test(text)) return text;
  }

  return null;
}

function isGenuineTranscriptRow(row: Element): boolean {
  const timestamp = extractTimestampFromRow(row);
  if (!timestamp) return false;

  const text = extractTextFromRow(row);
  if (!text) return false;

  if (JUNK_PATTERNS.test(text)) return false;

  const hasSpokenContent = /[\u0600-\u06FFa-zA-Z]{2,}/.test(text);
  if (!hasSpokenContent) return false;

  return true;
}

function extractRowData(row: Element): { timestamp: string; text: string } | null {
  const timestamp = extractTimestampFromRow(row);
  if (!timestamp) return null;

  const text = extractTextFromRow(row);
  if (!text) return null;

  return { timestamp, text };
}

export async function extractFromTranscriptPanel(): Promise<{
  segments: TranscriptSegmentWithTimestamp[];
  transcript: string;
} | null> {
  const opened = await openTranscriptPanel();
  if (!opened) {
    logger.warn('Failed to open transcript panel');
    return null;
  }

  await sleep(2000);

  const panel = getPanelContainer();
  if (!panel) {
    logger.warn('Transcript panel container not found after opening');
    return null;
  }

  const found = findSegmentRows();
  if (!found) {
    logger.warn('No transcript segment elements found in panel');
    logger.info('=== TRANSCRIPT PANEL HTML (first 3000 chars) ===');
    logger.info(panel.innerHTML?.slice(0, 3000));
    return null;
  }

  const segments: TranscriptSegmentWithTimestamp[] = [];
  for (const row of found.rows) {
    if (!isGenuineTranscriptRow(row)) continue;
    const data = extractRowData(row);
    if (data) {
      segments.push(data);
    }
  }

  if (segments.length === 0) {
    logger.warn('Found candidate rows but all were filtered or could not extract data');
    logger.info('First candidate row outerHTML:', found.rows[0].outerHTML);
    return null;
  }

  const transcript = segments.map((s) => s.text).join(' ');
  logger.info(`Successfully extracted ${segments.length} segments`);
  logger.info('First segment:', JSON.stringify(segments[0]));
  return { segments, transcript };
}

let captionObserver: MutationObserver | null = null;
let captionSegmentsBuffer: TranscriptSegmentWithTimestamp[] = [];
let lastCaptionText = '';

const CAPTION_SELECTORS = [
  '.ytp-caption-segment',
  '.caption-window',
  '.captions-text',
  '.ytp-caption-window-container span',
  '.caption-visual-line',
  '.caption-segment',
  '[class*="caption"]',
  '.ytp-subtitle-text',
  '.ytp-caption-window-rollup',
  '.ytp-caption-window',
];

function findCaptionElements(): NodeListOf<Element> {
  for (const sel of CAPTION_SELECTORS) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      logger.info(`Found ${els.length} caption elements via "${sel}"`);
      return els;
    }
  }
  return document.querySelectorAll('*');
}

function captureCaptionSegment(el: Element): void {
  const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || '';
  if (!text || text === lastCaptionText) return;
  lastCaptionText = text;
  captionSegmentsBuffer.push({ timestamp: '', text });
  logger.info('Caption captured:', text.slice(0, 60));
}

export function startCaptionCapture(): void {
  stopCaptionCapture();
  captionSegmentsBuffer = [];
  lastCaptionText = '';

  logger.info('=== DEBUG: Checking for caption elements ===');
  const allCaptionEls = findCaptionElements();
  logger.info(`Total caption elements found: ${allCaptionEls.length}`);
  allCaptionEls.forEach((el, i) => {
    if (i < 5) logger.info(`  Caption [${i}]: <${el.tagName.toLowerCase()}> text="${(el.textContent || '').slice(0, 80)}"`);
  });

  allCaptionEls.forEach(captureCaptionSegment);

  captionObserver = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node instanceof Element) {
          const isCaption = CAPTION_SELECTORS.some((sel) => {
            try { return node.matches?.(sel); } catch { return false; }
          });
          if (isCaption) {
            captureCaptionSegment(node);
          } else {
            for (const sel of CAPTION_SELECTORS) {
              const found = node.querySelectorAll(sel);
              if (found.length > 0) {
                found.forEach(captureCaptionSegment);
                break;
              }
            }
          }
        }
      }
    }
  });
  captionObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  logger.info('Caption MutationObserver started');
}

export function stopCaptionCapture(): void {
  if (captionObserver) {
    captionObserver.disconnect();
    captionObserver = null;
  }
}

export function getCapturedCaptions(): { segments: TranscriptSegmentWithTimestamp[]; transcript: string } | null {
  if (captionSegmentsBuffer.length === 0) return null;
  const segments = [...captionSegmentsBuffer];
  const transcript = segments.map((s) => s.text).join(' ');
  return { segments, transcript };
}

export function clearCapturedCaptions(): void {
  captionSegmentsBuffer = [];
  lastCaptionText = '';
}

export function isCaptionEnabled(): boolean {
  const btnSelectors = [
    '.ytp-subtitles-button',
    'button[aria-label*="subtitles"]',
    'button[aria-label*="captions"]',
    'button[aria-label*="ترجمة"]',
    'button[aria-label*="Subtitle"]',
    'button[aria-label*="Closed"]',
    '.ytp-subtitles-button[aria-pressed="true"]',
  ];
  for (const sel of btnSelectors) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (!btn) continue;
    const pressed = btn.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (btn.classList.contains('ytp-subtitles-button') && btn.tagName === 'BUTTON') {
      const icon = btn.querySelector('path');
      if (icon) return true;
    }
  }
  return false;
}

export async function enableCaptions(): Promise<boolean> {
  const btnSelectors = [
    '.ytp-subtitles-button',
    'button[aria-label*="subtitles"]',
    'button[aria-label*="captions"]',
    'button[aria-label*="ترجمة"]',
    'button[aria-label*="Subtitle"]',
    'button[aria-label*="Closed"]',
    '.ytp-button[aria-label*="subtitles"]',
    '.ytp-button[aria-label*="captions"]',
    '.ytp-button[aria-label*="ترجمة"]',
  ];
  for (const sel of btnSelectors) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn && !isCaptionEnabled()) {
      logger.info('Clicking captions button:', sel);
      btn.click();
      await sleep(800);
      return true;
    }
  }
  logger.warn('No captions button found');
  return false;
}

export async function extractTranscript(): Promise<ExtractionResult> {
  const videoId = extractVideoId(window.location.href);
  if (!videoId) throw new TranscriptError('No video ID found', 'NO_VIDEO_ID');

  const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                  document.querySelector('#title h1');
  const videoTitle = titleEl?.textContent?.trim() || document.title.replace(' - YouTube', '').trim() || '';

  const panelResult = await extractFromTranscriptPanel();
  if (panelResult && panelResult.segments.length > 0) {
    const transcript = panelResult.transcript;
    const language = detectLanguage(transcript);
    return {
      success: true,
      videoId,
      videoTitle,
      segments: panelResult.segments,
      transcript,
      source: 'transcript_panel',
      language,
    };
  }

  logger.info('Transcript panel extraction failed, trying live captions...');
  const captionsAvailable = await enableCaptions();
  if (captionsAvailable) {
    logger.info('Captions button clicked, waiting for caption elements...');
    startCaptionCapture();
    await sleep(4000);
    const captionResult = getCapturedCaptions();
    if (captionResult && captionResult.segments.length > 0) {
      const language = detectLanguage(captionResult.transcript);
      logger.info(`Captured ${captionResult.segments.length} caption segments`);
      return {
        success: true,
        videoId,
        videoTitle,
        segments: captionResult.segments,
        transcript: captionResult.transcript,
        source: 'live_captions',
        language,
      };
    }
    logger.warn('No captions captured after 4s wait');
  }

  throw new TranscriptError(
    'No transcript or captions available. Please ensure captions are enabled on this video.',
    'NO_TRANSCRIPT_AVAILABLE'
  );
}

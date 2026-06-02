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

export function extractPlayerResponse(): Record<string, unknown> | null {
  console.log('[TAFAHOM] Starting extraction - checking ytInitialPlayerResponse');

  try {
    const stored = document.body.getAttribute('data-tafahom-player-response');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          console.log('[TAFAHOM] Found cached player response in data attribute');
          return parsed;
        }
      } catch {}
    }
  } catch {}

  try {
    const scripts = document.querySelectorAll('script');
    console.log('[TAFAHOM] Scanning', scripts.length, 'script tags for ytInitialPlayerResponse');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('ytInitialPlayerResponse')) continue;

      const marker = 'ytInitialPlayerResponse = ';
      const idx = text.indexOf(marker);
      if (idx === -1) continue;

      const start = idx + marker.length;
      if (text[start] !== '{') continue;

      let depth = 0;
      let inString = false;
      let escape = false;
      let end = start;

      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }

      if (depth === 0 && end > start) {
        try {
          const jsonStr = text.slice(start, end);
          const data = JSON.parse(jsonStr) as Record<string, unknown>;
          logger.info('Extracted ytInitialPlayerResponse from script tag (balanced braces)');
          console.log('[TAFAHOM] ytInitialPlayerResponse extracted from script tag');

          const captions = data.captions;
          console.log('[TAFAHOM] playerResponse.captions:', captions ? 'exists' : 'undefined');
          if (captions) {
            const captionsObj = captions as Record<string, unknown>;
            const tracklist = captionsObj.playerCaptionsTracklistRenderer;
            console.log('[TAFAHOM] playerResponse.captions.playerCaptionsTracklistRenderer:', tracklist ? 'exists' : 'undefined');
            if (tracklist) {
              const tracklistObj = tracklist as Record<string, unknown>;
              const tracks = tracklistObj.captionTracks;
              console.log('[TAFAHOM] captionTracks:', tracks ? `found ${(tracks as unknown[]).length} tracks` : 'undefined');
              if (tracks) {
                for (const t of tracks as Array<Record<string, unknown>>) {
                  console.log('[TAFAHOM] Caption track:', t.languageCode, (t.baseUrl as string)?.slice(0, 80));
                }
              }
            }
          }

          cachePlayerResponse(data);
          return data;
        } catch (e) {
          logger.error('Failed to parse extracted JSON:', e);
        }
      }
    }
  } catch (e) {
    logger.error('Failed to parse ytInitialPlayerResponse:', e);
  }

  logger.warn('ytInitialPlayerResponse not found');
  console.log('[TAFAHOM] ytInitialPlayerResponse NOT FOUND - no caption tracks available');
  return null;
}

function cachePlayerResponse(data: Record<string, unknown>): void {
  try {
    const json = JSON.stringify(data);
    if (json.length < 500000) {
      document.body.setAttribute('data-tafahom-player-response', json);
    }
  } catch {}
}

export function extractCaptionTracks(playerResponse: Record<string, unknown>): Array<{
  languageCode: string;
  baseUrl: string;
  kind?: string;
  isTranslatable?: boolean;
  name?: { simpleText?: string };
}> | null {
  try {
    const captions = playerResponse.captions as Record<string, unknown> | undefined;
    if (!captions) {
      logger.warn('No captions key in player response');
      return null;
    }
    const tracklist = captions.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
    if (!tracklist) {
      logger.warn('No playerCaptionsTracklistRenderer in captions');
      return null;
    }
    const tracks = tracklist.captionTracks as Array<Record<string, unknown>> | undefined;
    if (!tracks || tracks.length === 0) {
      logger.warn('No captionTracks found');
      return null;
    }
    const result = tracks.map((t) => ({
      languageCode: t.languageCode as string,
      baseUrl: t.baseUrl as string,
      kind: t.kind as string | undefined,
      isTranslatable: t.isTranslatable as boolean | undefined,
      name: t.name as { simpleText?: string } | undefined,
    }));
    logger.info('Found caption tracks:', result.length);
    result.forEach((t) => {
      console.log('[TAFAHOM] Caption track:', t.languageCode, t.baseUrl?.slice(0, 80));
    });
    return result;
  } catch (e) {
    logger.error('Error extracting caption tracks:', e);
    return null;
  }
}

export async function downloadVTT(baseUrl: string): Promise<string> {
  logger.info('Downloading VTT from:', baseUrl);
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new TranscriptError(`Failed to download VTT: HTTP ${response.status}`, 'VTT_DOWNLOAD_FAILED');
  }
  const vtt = await response.text();
  logger.info('Downloaded VTT size:', vtt.length, 'bytes');
  console.log('[TAFAHOM] Downloaded VTT size:', vtt.length);
  return vtt;
}

export function parseVTT(vttContent: string): TranscriptSegmentWithTimestamp[] {
  const segments: TranscriptSegmentWithTimestamp[] = [];
  const lines = vttContent.split(/\r?\n/);

  let currentTimestamp = '';
  let currentText = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '') {
      if (currentTimestamp && currentText) {
        segments.push({ timestamp: currentTimestamp, text: currentText.trim() });
      }
      currentTimestamp = '';
      currentText = '';
      continue;
    }

    if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) {
      continue;
    }

    const timeMatch = line.match(/(\d{1,2}:?\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}\.\d{3})/);
    if (timeMatch) {
      currentTimestamp = formatTimestamp(timeMatch[1]);
      continue;
    }

    if (line.startsWith('NOTE ') || line.startsWith('STYLE') || line.startsWith('REGION')) {
      currentTimestamp = '';
      currentText = '';
      continue;
    }

    if (currentTimestamp && line && !line.startsWith('[')) {
      currentText += (currentText ? ' ' : '') + line;
    }
  }

  if (currentTimestamp && currentText) {
    segments.push({ timestamp: currentTimestamp, text: currentText.trim() });
  }

  logger.info('Parsed VTT segments:', segments.length);
  console.log('[TAFAHOM] Parsed transcript segments:', segments.length);
  return segments;
}

function formatTimestamp(t: string): string {
  const parts = t.split(':');
  if (parts.length === 3) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const s = parts[2].split('.')[0].padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  if (parts.length === 2) {
    const m = parts[0].padStart(2, '0');
    const s = parts[1].split('.')[0].padStart(2, '0');
    return `${m}:${s}`;
  }
  return t;
}

export async function extractFromCaptionTracks(): Promise<{
  segments: TranscriptSegmentWithTimestamp[];
  transcript: string;
  language: string;
} | null> {
  console.log('[TAFAHOM] Starting extractFromCaptionTracks');
  const playerResponse = extractPlayerResponse();
  if (!playerResponse) {
    logger.warn('No player response available for caption track extraction');
    console.log('[TAFAHOM] extractFromCaptionTracks: FAILED - no player response');
    return null;
  }

  const tracks = extractCaptionTracks(playerResponse);
  if (!tracks || tracks.length === 0) {
    logger.warn('No caption tracks found in player response');
    console.log('[TAFAHOM] extractFromCaptionTracks: FAILED - no caption tracks');
    return null;
  }

  console.log('[TAFAHOM] Found', tracks.length, 'caption tracks');
  tracks.forEach((t, i) => {
    console.log('[TAFAHOM] Track', i, ':', t.languageCode, '-', (t.baseUrl || '').slice(0, 60));
  });

  const arabicTrack = tracks.find((t) => t.languageCode === 'ar' || t.languageCode === 'ara');
  const preferredTrack = arabicTrack || tracks[0];

  logger.info('Using caption track:', preferredTrack.languageCode);
  console.log('[TAFAHOM] Arabic track detected:', preferredTrack.languageCode);
  console.log('[TAFAHOM] Track URL:', preferredTrack.baseUrl);
  console.log('[TAFAHOM] Downloading VTT from track URL');

  let vttContent: string;
  try {
    vttContent = await downloadVTT(preferredTrack.baseUrl);
  } catch (e) {
    logger.error('Failed to download VTT:', e);
    console.log('[TAFAHOM] VTT download FAILED:', (e as Error).message);
    return null;
  }

  const segments = parseVTT(vttContent);
  if (segments.length === 0) {
    logger.warn('No segments parsed from VTT');
    console.log('[TAFAHOM] parseVTT returned 0 segments');
    return null;
  }

  const transcript = segments.map((s) => s.text).join(' ');
  logger.info('Sending transcript to backend, segments:', segments.length);
  console.log('[TAFAHOM] Transcript segments:', segments.length);
  console.log('[TAFAHOM] Sending transcript to backend');

  return { segments, transcript, language: preferredTrack.languageCode };
}

export async function extractTranscript(): Promise<ExtractionResult> {
  console.log('[TAFAHOM] Starting transcript extraction...');
  console.log('[TAFAHOM] Transcript rows:', document.querySelectorAll('ytd-transcript-segment-renderer').length);
  console.log('[TAFAHOM] Caption segments:', document.querySelectorAll('.ytp-caption-segment').length);
  console.log('[TAFAHOM] Caption container:', document.querySelector('.ytp-caption-window-container'));
  console.log('[TAFAHOM] ytInitialPlayerResponse on window:', !!(window as unknown as Record<string, unknown>).ytInitialPlayerResponse);

  const videoId = extractVideoId(window.location.href);
  if (!videoId) throw new TranscriptError('No video ID found', 'NO_VIDEO_ID');
  console.log('[TAFAHOM] Video ID:', videoId);

  const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                  document.querySelector('#title h1');
  const videoTitle = titleEl?.textContent?.trim() || document.title.replace(' - YouTube', '').trim() || '';

  console.log('[TAFAHOM] Trying caption tracks...');
  const vttResult = await extractFromCaptionTracks();
  if (vttResult && vttResult.segments.length > 0) {
    const language: DetectedLanguage = vttResult.language === 'ar' || vttResult.language === 'ara' ? 'arabic' : 'latin';
    console.log('[TAFAHOM] Caption tracks succeeded - segments:', vttResult.segments.length, 'transcript length:', vttResult.transcript.length);
    console.log('[TAFAHOM] Preparing backend request...');
    return {
      success: true,
      videoId,
      videoTitle,
      segments: vttResult.segments,
      transcript: vttResult.transcript,
      source: 'vtt_track',
      language,
    };
  }
  console.log('[TAFAHOM] Trying caption tracks... FAILED - returned null');

  console.log('[TAFAHOM] Trying transcript panel...');
  const panelResult = await extractFromTranscriptPanel();
  if (panelResult && panelResult.segments.length > 0) {
    const transcript = panelResult.transcript;
    const language = detectLanguage(transcript);
    console.log('[TAFAHOM] Transcript panel succeeded - segments:', panelResult.segments.length, 'transcript length:', transcript.length);
    console.log('[TAFAHOM] Preparing backend request...');
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
  console.log('[TAFAHOM] Trying transcript panel... FAILED');

  console.log('[TAFAHOM] Trying caption extraction...');
  const captionsAvailable = await enableCaptions();
  if (captionsAvailable) {
    console.log('[TAFAHOM] Captions button clicked, waiting for caption elements...');
    startCaptionCapture();
    await sleep(2000);
    const captionResult = getCapturedCaptions();
    if (captionResult && captionResult.segments.length > 0) {
      const language = detectLanguage(captionResult.transcript);
      console.log('[TAFAHOM] Live captions succeeded - segments:', captionResult.segments.length, 'transcript length:', captionResult.transcript.length);
      console.log('[TAFAHOM] Preparing backend request...');
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
    console.log('[TAFAHOM] Live captions: no segments captured after 4s wait');
  } else {
    console.log('[TAFAHOM] Live captions: no captions button found');
  }

  console.log('[TAFAHOM] ALL EXTRACTION METHODS FAILED');
  console.log('[TAFAHOM] Transcript object: null');
  console.log('[TAFAHOM] Transcript length: 0');
  console.log('[TAFAHOM] Segments: null');
  console.log('[TAFAHOM] Segments length: 0');
  console.log('[TAFAHOM] No request sent to backend - throwing error');

  throw new TranscriptError(
    'No transcript or captions available. Please ensure captions are enabled on this video.',
    'NO_TRANSCRIPT_AVAILABLE'
  );
}

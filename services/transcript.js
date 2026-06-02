class YouTubeTranscript {
  constructor() {
    this._debug = typeof window !== 'undefined' && window.TAFAHOM_DEBUG === true;
    this._readyTranscript = null;
    this._observerActive = false;
    this._observer = null;
    this._autoFlowActive = false;
  }

  log(...args) {
    if (this._debug) console.log('[TAFAHOM]', ...args);
  }

  warn(...args) {
    if (this._debug) console.warn('[TAFAHOM]', ...args);
  }

  error(...args) {
    console.error('[TAFAHOM]', ...args);
  }

  getVideoIdFromUrl(url) {
    try {
      const u = new URL(url);
      let vid = u.searchParams.get('v');
      if (!vid && u.pathname.startsWith('/embed/')) {
        vid = u.pathname.split('/')[2];
      }
      if (!vid && u.pathname.startsWith('/shorts/')) {
        vid = u.pathname.split('/')[2];
      }
      return vid || null;
    } catch (e) {
      return null;
    }
  }

  getCurrentVideoId() {
    return this.getVideoIdFromUrl(window.location.href);
  }

  getVideoTitleFromDOM() {
    const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
    const el2 = document.querySelector('#title h1');
    if (el2 && el2.textContent.trim()) {
      return el2.textContent.trim();
    }
    const meta = document.querySelector('meta[name="title"]');
    if (meta) {
      return meta.getAttribute('content');
    }
    const title = document.title.replace(' - YouTube', '').trim();
    return title || null;
  }

  getVideoUrl() {
    return window.location.href;
  }

  // =============================================
  // Player data parsing (to detect caption tracks)
  // =============================================
  getPlayerResponseFromScriptTags() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('ytInitialPlayerResponse')) continue;

      const startIdx = text.indexOf('ytInitialPlayerResponse');
      const jsonStart = text.indexOf('{', startIdx);
      if (jsonStart === -1) continue;

      let depth = 0;
      let jsonEnd = -1;
      let inString = false;
      let escapeNext = false;

      for (let i = jsonStart; i < text.length; i++) {
        const ch = text[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\' && inString) { escapeNext = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') { depth++; continue; }
        if (ch === '}') {
          depth--;
          if (depth === 0) { jsonEnd = i; break; }
        }
      }

      if (jsonEnd === -1) continue;

      try {
        return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  getCaptionTracks() {
    const playerData = this.getPlayerResponseFromScriptTags();
    if (!playerData) return [];
    const captionRenderer = playerData?.captions?.playerCaptionsTracklistRenderer;
    if (!captionRenderer) return [];
    return captionRenderer.captionTracks || [];
  }

  getArabicTrackInfo(tracks) {
    const arabicTracks = tracks.filter((t) => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang.startsWith('ar');
    });

    if (arabicTracks.length === 0) return null;

    const manual = arabicTracks.find((t) => !t.kind || !t.kind.includes('asr'));
    if (manual) return { track: manual, type: 'manual', name: manual.name?.simpleText || manual.languageCode };

    const autoGen = arabicTracks.find((t) => t.kind && t.kind.includes('asr'));
    if (autoGen) return { track: autoGen, type: 'auto_generated', name: autoGen.name?.simpleText || autoGen.languageCode };

    const first = arabicTracks[0];
    return { track: first, type: 'other', name: first.name?.simpleText || first.languageCode };
  }

  // =============================================
  // Transcript panel detection (broad search)
  // =============================================
  _isTranscriptPanelOpen() {
    if (document.querySelectorAll('ytd-transcript-segment-renderer').length > 0) return true;
    return false;
  }

  _segmentCount() {
    return document.querySelectorAll('ytd-transcript-segment-renderer').length;
  }

  _logDOMDiagnostics() {
    console.log('[TAFAHOM] ===== Transcript DOM Diagnostics =====');

    const checks = {
      'ytd-transcript-segment-renderer': document.querySelectorAll('ytd-transcript-segment-renderer').length,
      'yt-formatted-string': document.querySelectorAll('yt-formatted-string').length,
      'ytd-engagement-panel-section-list-renderer': document.querySelectorAll('ytd-engagement-panel-section-list-renderer').length,
      '[target-id*="transcript"]': document.querySelectorAll('[target-id*="transcript"]').length,
      'ytd-transcript-renderer': document.querySelectorAll('ytd-transcript-renderer').length,
    };

    Object.entries(checks).forEach(([sel, count]) => {
      console.log(`[TAFAHOM]   ${sel}: ${count}`);
    });

    const engagementPanel = document.querySelector('ytd-engagement-panel-section-list-renderer');
    if (engagementPanel) {
      console.log('[TAFAHOM]   Engagement panel found, dumping innerHTML...');
      console.log('[TAFAHOM]   Engagement panel innerHTML start:');
      console.log(engagementPanel.innerHTML.substring(0, 3000));
      console.log('[TAFAHOM]   --- end engagement panel dump ---');

      const active = engagementPanel.hasAttribute('is-active');
      const visibility = engagementPanel.style.visibility || '';
      const display = engagementPanel.style.display || '';
      console.log(`[TAFAHOM]   Engagement panel: active=${active}, visibility="${visibility}", display="${display}"`);
    } else {
      console.log('[TAFAHOM]   No engagement panel found on page');
    }

    const allElements = document.querySelectorAll('*');
    const transcriptRelated = [];
    allElements.forEach((el) => {
      const id = (el.id || '').toLowerCase();
      const cls = (typeof el.className === 'string' ? el.className : el.className?.baseVal ?? '').toLowerCase();
      const tag = (el.tagName || '').toLowerCase();
      if (id.includes('transcript') || cls.includes('transcript') || tag.includes('transcript')) {
        const cn = typeof el.className === 'string' ? el.className : el.className?.baseVal ?? '';
        transcriptRelated.push({ tag: el.tagName, id: el.id, className: cn.substring(0, 60) });
      }
    });

    if (transcriptRelated.length > 0) {
      console.log(`[TAFAHOM]   Transcript-related elements (${transcriptRelated.length}):`);
      transcriptRelated.slice(0, 20).forEach((e) => {
        console.log(`[TAFAHOM]     <${e.tag}${e.id ? ' id="' + e.id + '"' : ''}${e.className ? ' class="' + e.className + '"' : ''}>`);
      });
    } else {
      console.log('[TAFAHOM]   No transcript-related elements found anywhere on page');
    }

    console.log('[TAFAHOM] ===== End Diagnostics =====');
  }

  _tryExtractAnyTranscript() {
    const strategies = [
      'ytd-transcript-segment-renderer #content',
      'ytd-transcript-segment-renderer .segment-text',
      'ytd-transcript-segment-renderer yt-formatted-string',
      'ytd-transcript-segment-renderer [slot="content"]',
      '#transcript-panel-content yt-formatted-string',
      'ytd-transcript-renderer yt-formatted-string',
      'ytd-engagement-panel-section-list-renderer yt-formatted-string',
      '.segment-text',
      '[id*="transcript"] yt-formatted-string',
      '[class*="transcript"] yt-formatted-string',
    ];

    for (const strategy of strategies) {
      const els = document.querySelectorAll(strategy);
      if (els.length > 0) {
        console.log(`[TAFAHOM] Trying extract strategy: ${strategy} (${els.length} elements)`);
        const texts = [];
        els.forEach((el) => {
          const text = (el.textContent || '').replace(/[\s\n\r]+/g, ' ').trim();
          if (text) texts.push(text);
        });
        if (texts.length >= 3) {
          const merged = texts.join(' ').replace(/\s+/g, ' ').trim();
          if (merged.length > 20) {
            console.log(`[TAFAHOM] Extract strategy "${strategy}" succeeded: ${merged.length} chars`);
            return merged;
          }
        }
      }
    }

    return null;
  }

  _extractSegments() {
    const transcript = this._tryExtractAnyTranscript();
    if (transcript) return transcript;

    const segments = document.querySelectorAll('ytd-transcript-segment-renderer');

    if (segments.length === 0) {
      console.log('[TAFAHOM] No ytd-transcript-segment-renderer found in DOM');
      return null;
    }

    console.log(`[TAFAHOM] Found ${segments.length} ytd-transcript-segment-renderer elements`);

    const texts = [];

    segments.forEach((seg) => {
      let textEl = seg.querySelector('#content');
      if (!textEl) textEl = seg.querySelector('.segment-text');
      if (!textEl) textEl = seg.querySelector('yt-formatted-string');
      if (!textEl) textEl = seg.querySelector('[slot="content"]');

      let text = '';
      if (textEl) {
        text = textEl.textContent || '';
      } else {
        text = seg.textContent || '';
      }

      const cleaned = text.replace(/[\s\n\r]+/g, ' ').trim();
      if (cleaned) {
        texts.push(cleaned);
      }
    });

    if (texts.length === 0) return null;

    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // =============================================
  // MutationObserver: auto-detect when user opens panel
  // =============================================
  watch() {
    if (this._observerActive) {
      console.log('[TAFAHOM] Observer already active');
      return;
    }

    if (this._isTranscriptPanelOpen()) {
      console.log('[TAFAHOM] Transcript panel already open, extracting directly');
      const transcript = this._extractSegments();
      if (transcript) {
        this._readyTranscript = transcript;
        console.log(`[TAFAHOM] Transcript extracted: ${transcript.length} chars`);
      }
      return;
    }

    console.log('[TAFAHOM] Starting MutationObserver to watch for transcript panel...');
    this._observerActive = true;

    let diagCount = 0;

    this._observer = new MutationObserver((mutations) => {
      if (this._readyTranscript) {
        return;
      }

      console.log('[TAFAHOM] DOM mutation detected');

      const segCount = document.querySelectorAll('ytd-transcript-segment-renderer').length;
      const fsCount = document.querySelectorAll('yt-formatted-string').length;
      const epCount = document.querySelectorAll('ytd-engagement-panel-section-list-renderer').length;
      const ttCount = document.querySelectorAll('[target-id*="transcript"]').length;

      console.log(`[TAFAHOM]   ytd-transcript-segment-renderer: ${segCount}`);
      console.log(`[TAFAHOM]   yt-formatted-string: ${fsCount}`);
      console.log(`[TAFAHOM]   ytd-engagement-panel-section-list-renderer: ${epCount}`);
      console.log(`[TAFAHOM]   [target-id*="transcript"]: ${ttCount}`);

      diagCount++;
      if (diagCount <= 3) {
        this._logDOMDiagnostics();
      }

      const transcript = this._tryExtractAnyTranscript();
      if (transcript) {
        this._readyTranscript = transcript;
        console.log(`[TAFAHOM] Transcript auto-extracted: ${transcript.length} chars`);
        document.dispatchEvent(new CustomEvent('__tafahom_transcript_ready', { detail: { transcript } }));
      }
    });

    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  getTranscriptIfReady() {
    return this._readyTranscript;
  }

  clearTranscript() {
    this._readyTranscript = null;
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._observerActive = false;
  }

  // =============================================
  // Arabic track selection with priority
  // =============================================
  _getBestArabicTrack(tracks) {
    if (!tracks || tracks.length === 0) return null;

    const arabicTracks = tracks.filter((t) => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang.startsWith('ar');
    });

    if (arabicTracks.length === 0) return null;

    // Priority 1: ar manual (no kind or kind != 'asr')
    const manual = arabicTracks.find((t) => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang === 'ar' && (!t.kind || !t.kind.includes('asr'));
    });
    if (manual) return manual;

    // Priority 2: ar-EG manual
    const arEG = arabicTracks.find((t) => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang === 'ar-eg' && (!t.kind || !t.kind.includes('asr'));
    });
    if (arEG) return arEG;

    // Priority 3: ar ASR (auto-generated)
    const autoGen = arabicTracks.find((t) => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang === 'ar' && t.kind && t.kind.includes('asr');
    });
    if (autoGen) return autoGen;

    // Priority 4: any ar-* 
    const anyAr = arabicTracks.find((t) => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang.startsWith('ar-');
    });
    if (anyAr) return anyAr;

    // Priority 5: track whose name contains "Arabic"
    const namedArabic = arabicTracks.find((t) => {
      const name = (t.name && (t.name.simpleText || t.name.runs?.[0]?.text) || '').toLowerCase();
      return name.includes('arabic');
    });
    if (namedArabic) return namedArabic;

    return arabicTracks[0];
  }

  // =============================================
  // Open transcript panel by clicking UI
  // =============================================
  _openTranscriptPanel() {
    return new Promise((resolve) => {
      if (this._isTranscriptPanelOpen()) {
        this.log('Transcript panel already open');
        resolve(true);
        return;
      }

      this.log('Attempting to open transcript panel...');

      // Strategy 1: Click the "..." button in the video action bar
      const moreButtonSelectors = [
        'ytd-menu-renderer yt-icon-button#button',
        'ytd-video-primary-info-renderer ytd-menu-renderer yt-icon-button',
        '#top-level-buttons-computed ~ ytd-menu-renderer button[aria-label]',
        'ytd-menu-renderer[aria-label] button',
        '#button yt-icon-button[aria-label*="More"]',
        '#button yt-icon-button[aria-label*="more"]',
      ];

      let moreButton = null;
      for (const sel of moreButtonSelectors) {
        moreButton = document.querySelector(sel);
        if (moreButton) break;
      }

      if (!moreButton) {
        this.warn('Could not find "..." button');
        resolve(false);
        return;
      }

      moreButton.click();
      this.log('Clicked "..." button, waiting for menu...');

      const checkInterval = setInterval(() => {
        const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-service-item-renderer tp-yt-paper-item');
        const transcriptItem = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-service-item-renderer tp-yt-paper-item, .ytd-menu-service-item-renderer'))
          .find(el => {
            const text = (el.textContent || '').toLowerCase();
            return text.includes('transcript') || text.includes('show transcript') || text.includes('open transcript');
          });

        if (transcriptItem) {
          clearInterval(checkInterval);
          transcriptItem.click();
          this.log('Clicked "Show transcript" menu item');
          setTimeout(() => resolve(this._isTranscriptPanelOpen()), 800);
          return;
        }

        // Also try pressing 't' as keyboard shortcut (YouTube sometimes supports this)
        const body = document.querySelector('body');
        if (body) {
          body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', keyCode: 84 }));
        }
      }, 200);

      // Timeout after 5s looking for menu item
      setTimeout(() => {
        clearInterval(checkInterval);
        this.warn('Timed out waiting for transcript menu item');
        resolve(false);
      }, 5000);
    });
  }

  // =============================================
  // Auto-flow: full pipeline from detection to submission
  // =============================================
  async startAutoFlow() {
    if (this._autoFlowActive) {
      this.log('Auto-flow already running, skipping');
      return;
    }

    this._autoFlowActive = true;
    this.clearTranscript();

    const videoId = this.getCurrentVideoId();
    if (!videoId) {
      this.warn('No video ID found');
      this._autoFlowActive = false;
      return;
    }

    const videoTitle = this.getVideoTitleFromDOM();
    this.log(`Auto-flow started for video ${videoId}: ${videoTitle}`);

    const tracks = this.getCaptionTracks();
    if (!tracks || tracks.length === 0) {
      this.log('No caption tracks available, stopping silently');
      this._autoFlowActive = false;
      return;
    }

    const arabicTrack = this._getBestArabicTrack(tracks);
    if (!arabicTrack) {
      this.log('No Arabic caption track found, stopping silently');
      this._autoFlowActive = false;
      return;
    }

    this.log(`Found Arabic track: ${arabicTrack.languageCode} (${arabicTrack.kind || 'manual'})`);

    // Open the transcript panel
    const opened = await this._openTranscriptPanel();
    if (!opened) {
      this.warn('Could not open transcript panel');
      this._autoFlowActive = false;
      return;
    }

    this.log('Transcript panel opened, waiting for segments...');

    // Start observer with 15-second timeout
    const transcript = await this._waitForSegments(15000);
    if (!transcript) {
      this.log('No transcript segments appeared within timeout, stopping silently');
      this._autoFlowActive = false;
      return;
    }

    this.log(`Transcript extracted: ${transcript.length} chars`);
    this._readyTranscript = transcript;

    // Submit to backend
    await this._submitTranscript({ videoId, videoTitle, transcript });
    this._autoFlowActive = false;
  }

  // =============================================
  // Wait for segments to appear via MutationObserver
  // =============================================
  _waitForSegments(timeoutMs) {
    return new Promise((resolve) => {
      if (this._segmentCount() >= 3) {
        const transcript = this._extractSegments();
        if (transcript) {
          resolve(transcript);
          return;
        }
      }

      this.log('Starting MutationObserver with timeout...');
      let checkCount = 0;

      const observer = new MutationObserver(() => {
        const count = this._segmentCount();
        checkCount++;

        if (checkCount <= 3) {
          this.log(`Segment check #${checkCount}: ${count} segments`);
        }

        if (count >= 3) {
          const transcript = this._extractSegments();
          if (transcript) {
            observer.disconnect();
            resolve(transcript);
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Also poll periodically in case observer misses changes
      const pollInterval = setInterval(() => {
        const count = this._segmentCount();
        if (count >= 3) {
          clearInterval(pollInterval);
          observer.disconnect();
          const transcript = this._extractSegments();
          if (transcript) {
            resolve(transcript);
          }
        }
      }, 300);

      setTimeout(() => {
        clearInterval(pollInterval);
        observer.disconnect();

        // One last attempt
        const transcript = this._extractSegments();
        if (transcript) {
          resolve(transcript);
        } else {
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  // =============================================
  // Submit transcript to backend
  // =============================================
  async _submitTranscript({ videoId, videoTitle, transcript }) {
    try {
      const payload = {
        video_id: videoId,
        title: videoTitle || '',
        transcript: transcript,
      };

      this.log('Submitting transcript to backend...');

      const response = await fetch(
        'https://api.tafahom.io/api/v1/youtube/process-transcript/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        const data = await response.json();
        this.log('Transcript submitted successfully:', data);
      } else {
        this.warn('Transcript submission returned:', response.status);
      }
    } catch (err) {
      this.warn('Failed to submit transcript:', err.message);
    }
  }

  // =============================================
  // Main extraction method
  // =============================================
  async extract() {
    const videoId = this.getCurrentVideoId();
    if (!videoId) {
      const msg = 'Failed to obtain video ID from URL';
      this.error(msg, window.location.href);
      return { success: false, error: msg };
    }
    console.log(`[TAFAHOM] Video ID found: ${videoId}`);

    const videoTitle = this.getVideoTitleFromDOM();
    console.log(`[TAFAHOM] Video title: ${videoTitle || 'Unknown'}`);

    const videoUrl = this.getVideoUrl();

    const tracks = this.getCaptionTracks();
    console.log('[TAFAHOM] Available caption tracks:', tracks.map((t) => ({
      languageCode: t.languageCode,
      kind: t.kind,
      name: t.name?.simpleText || t.languageCode,
    })));

    const arabicInfo = this.getArabicTrackInfo(tracks);

    if (arabicInfo) {
      console.log(`[TAFAHOM] Found Arabic transcript: ${arabicInfo.name} (${arabicInfo.type})`);
      if (arabicInfo.type === 'auto_generated') {
        console.log('[TAFAHOM] Using Arabic auto-generated captions');
      }
      console.log(`[TAFAHOM] Transcript language: ${arabicInfo.track.languageCode}`);
    } else if (tracks.length > 0) {
      const hasEnglish = tracks.some((t) => (t.languageCode || '').toLowerCase().startsWith('en'));
      console.log(hasEnglish
        ? '[TAFAHOM] No Arabic tracks found. Falling back to English.'
        : '[TAFAHOM] No Arabic tracks found. Using first available language.');
    } else {
      console.log('[TAFAHOM] No caption tracks found');
      return {
        success: false,
        requires_upload: true,
        message: 'No caption tracks available for this video. Please upload the video manually.',
      };
    }

    if (this._readyTranscript) {
      console.log(`[TAFAHOM] Using previously extracted transcript: ${this._readyTranscript.length} chars`);
      console.log('[TAFAHOM] Sending transcript to backend');
      return {
        success: true,
        videoId,
        videoUrl,
        videoTitle,
        transcript: this._readyTranscript,
      };
    }

    if (this._isTranscriptPanelOpen()) {
      const transcript = this._extractSegments();
      if (transcript) {
        console.log(`[TAFAHOM] Transcript length: ${transcript.length}`);
        if (this._debug) {
          console.log(`[TAFAHOM] Transcript preview: ${transcript.substring(0, 200)}...`);
        }
        console.log('[TAFAHOM] Sending transcript to backend');
        return {
          success: true,
          videoId,
          videoUrl,
          videoTitle,
          transcript,
        };
      }
      console.log('[TAFAHOM] Panel open but no segments found');
    }

    return {
      success: false,
      requires_panel: true,
      message: 'Please open the transcript panel once.',
    };
  }
}

const transcriptExtractor = new YouTubeTranscript();
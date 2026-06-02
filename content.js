(function () {
  const DEBUG = true;
  window.TAFAHOM_DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[TAFAHOM]', ...args);
  }

  function warn(...args) {
    if (DEBUG) console.warn('[TAFAHOM]', ...args);
  }

  function error(...args) {
    console.error('[TAFAHOM]', ...args);
  }

  log('Extension loaded');
  log('Content script injected into YouTube');

  let currentVideoId = null;
  let currentVideoTitle = '';
  let currentVideoUrl = '';

  function detectYouTube() {
    if (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be')) {
      log('YouTube page detected');
      return true;
    }
    return false;
  }

  function extractVideoInfo() {
    const vid = transcriptExtractor.getCurrentVideoId();
    const title = transcriptExtractor.getVideoTitleFromDOM();
    const url = transcriptExtractor.getVideoUrl();

    if (vid && vid !== currentVideoId) {
      log(`Video ID found: ${vid}`);
      currentVideoId = vid;
    }
    if (title && title !== currentVideoTitle) {
      currentVideoTitle = title;
    }
    if (url) {
      currentVideoUrl = url;
    }

    return { videoId: currentVideoId, videoTitle: currentVideoTitle, videoUrl: currentVideoUrl };
  }

  function broadcastVideoInfo() {
    const info = extractVideoInfo();
    if (info.videoId) {
      chrome.runtime.sendMessage({
        type: 'VIDEO_INFO',
        videoUrl: info.videoUrl,
        videoTitle: info.videoTitle,
        videoId: info.videoId,
      }).catch(() => {});
    }
  }

  if (!detectYouTube()) {
    error('Not a YouTube page, content script will not function');
  }

  // Schedule auto-flow on page load (wait for page to settle)
  setTimeout(() => {
    broadcastVideoInfo();
    transcriptExtractor.startAutoFlow();
  }, 2000);

  setInterval(broadcastVideoInfo, 3000);

  document.addEventListener('yt-navigate-finish', () => {
    log('YouTube SPA navigation detected (yt-navigate-finish)');
    currentVideoId = null;
    transcriptExtractor.clearTranscript();
    setTimeout(() => {
      extractVideoInfo();
      broadcastVideoInfo();
      transcriptExtractor.startAutoFlow();
    }, 2000);
  });

  window.addEventListener('popstate', () => {
    log('YouTube navigation via popstate');
    transcriptExtractor.clearTranscript();
    setTimeout(() => {
      broadcastVideoInfo();
      transcriptExtractor.startAutoFlow();
    }, 1500);
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log('Message received from extension:', request.type);

    if (request.type === 'GET_VIDEO_INFO') {
      const info = extractVideoInfo();
      log('Responding with video info:', info);
      sendResponse(info);
    }

    if (request.type === 'EXTRACT_TRANSCRIPT') {
      log('Transcript extraction requested');

      transcriptExtractor.extract()
        .then((result) => {
          if (result.success) {
            log('Transcript extracted successfully');
          } else if (result.requires_panel) {
            log('Transcript panel required, starting observer...');
            transcriptExtractor.watch();
          } else {
            warn('Transcript extraction failed:', result.error || result.message);
          }
          sendResponse(result);
        })
        .catch((err) => {
          error('Transcript extraction threw exception:', err.message);
          sendResponse({ success: false, error: err.message || 'Unknown extraction error' });
        });

      return true;
    }

    if (request.type === 'CHECK_TRANSCRIPT') {
      const transcript = transcriptExtractor.getTranscriptIfReady();
      if (transcript) {
        log('Transcript ready from observer');
        sendResponse({ success: true, transcript });
      } else {
        sendResponse({ success: false, ready: false });
      }
    }

    if (request.type === 'PING') {
      sendResponse({ alive: true });
    }
  });

  document.addEventListener('__tafahom_transcript_ready', (e) => {
    log('Transcript auto-extracted by observer, notifying extension');
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT_READY',
      videoId: currentVideoId,
      videoUrl: currentVideoUrl,
      videoTitle: currentVideoTitle,
      transcript: e.detail.transcript,
    }).catch(() => {});
  });

  log('Content script initialization complete');
})();

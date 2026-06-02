let currentUser = null;
let avatarPlayer = null;
let lastResult = null;
let currentVideoInfo = { url: null, title: null };

function $(id) { return document.getElementById(id); }

async function init() {
  const session = await auth.getSession();
  if (!session.token) {
    window.location.href = chrome.runtime.getURL('popup/popup.html');
    return;
  }

  try {
    currentUser = await api.getMe();
    if (session.user) {
      currentUser = { ...session.user, ...currentUser };
    }
    await auth.saveSession({ user: currentUser });
  } catch (e) {
    if (e.status === 401) {
      await auth.clearSession();
      window.location.href = chrome.runtime.getURL('popup/popup.html');
      return;
    }
    currentUser = session.user;
  }

  if (!currentUser) {
    window.location.href = chrome.runtime.getURL('popup/popup.html');
    return;
  }

  renderUserInfo();
  initAvatar();
  getCurrentVideo();
  loadHistory();
  setupEventListeners();
}

function renderUserInfo() {
  const name = currentUser.first_name || currentUser.email || 'User';
  $('nav-name').textContent = name;
  $('nav-avatar').textContent = name.charAt(0).toUpperCase();
  const tokens = currentUser.tokens !== undefined ? currentUser.tokens : currentUser.token_balance;
  if (tokens !== undefined) {
    $('nav-tokens').textContent = `Tokens: ${tokens}`;
  }
}

function initAvatar() {
  const container = $('avatar-container');
  avatarPlayer = new AvatarPlayer(container, {
    avatarUrl: CONFIG.UNITY_AVATAR_URL,
  });
  avatarPlayer.onReady(() => {
    const loading = $('avatar-loading');
    if (loading) loading.style.display = 'none';

    if (lastResult && lastResult.animations) {
      avatarPlayer.play(lastResult.animations);
    }
  });
}

async function getCurrentVideo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be/'))) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' }).catch(() => null);
      if (response) {
        currentVideoInfo = { url: response.videoUrl, title: response.videoTitle };
        updateVideoDisplay();
        $('translate-btn').disabled = false;
        return;
      }
    }
    const bg = await chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA' }).catch(() => null);
    if (bg && bg.videoUrl) {
      currentVideoInfo = { url: bg.videoUrl, title: bg.videoTitle };
      updateVideoDisplay();
      $('translate-btn').disabled = false;
    } else {
      $('video-title').textContent = 'No YouTube video detected';
      $('video-url').textContent = 'Navigate to a YouTube video to translate';
    }
  } catch (e) {
    $('video-title').textContent = 'No YouTube video detected';
  }
}

function updateVideoDisplay() {
  if (currentVideoInfo.title && currentVideoInfo.title !== 'YouTube') {
    $('video-title').textContent = currentVideoInfo.title;
    $('video-url').textContent = currentVideoInfo.url;
  }
}

function setStatus(msg, type) {
  const area = $('status-area');
  area.innerHTML = `<div class="status-msg ${type}">${msg}</div>`;
}

function clearStatus() {
  $('status-area').innerHTML = '';
}

async function handleTranslate() {
  const btn = $('translate-btn');
  if (btn.disabled) return;

  clearStatus();
  $('result-card').style.display = 'none';
  $('insufficient-card').style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || (!tab.url.includes('youtube.com/watch') && !tab.url.includes('youtu.be/'))) {
      setStatus('Please navigate to a YouTube video first.', 'error');
      return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Extracting transcript...';

    let transcriptResponse;
    try {
      transcriptResponse = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TRANSCRIPT' });
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';
      if (e.message && e.message.includes('Receiving end does not exist')) {
        setStatus('Content script not injected. Please refresh the YouTube page and try again.', 'error');
      } else {
        setStatus('Failed to communicate with content script: ' + (e.message || 'Unknown error'), 'error');
      }
      return;
    }

    if (!transcriptResponse || !transcriptResponse.success) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';

      if (transcriptResponse && transcriptResponse.requires_panel) {
        $('panel-overlay').style.display = 'block';
        $('panel-waiting').style.display = 'flex';
        $('panel-ready').style.display = 'none';
        clearStatus();
        pollTranscript(tab.id, btn);
        return;
      }

      if (transcriptResponse && transcriptResponse.requires_upload) {
        setStatus('No transcript available. Please upload the video manually.', 'error');
      } else {
        setStatus(transcriptResponse?.error || transcriptResponse?.message || 'Transcript extraction failed', 'error');
      }
      return;
    }

    btn.innerHTML = '<span class="spinner spinner-sm"></span> Translating...';
    setStatus('Sending to Tafahom AI...', 'loading');

    try {
      const result = await api.signTranslate(currentVideoInfo.url || tab.url, transcriptResponse.transcript);
      if (!result.success) {
        throw new Error(result.error || 'Translation failed');
      }

      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';

      clearStatus();
      showResult(result);

      await loadHistory();

      if (result.animations && result.animations.length > 0) {
        setTimeout(() => {
          avatarPlayer.play(result.animations);
        }, 800);
      }
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';

      if (e.data?.detail?.includes('token') || e.data?.detail?.includes('Insufficient') || e.message?.includes('token')) {
        $('insufficient-card').style.display = 'block';
        setStatus('', '');
      } else {
        setStatus('Backend request failed: ' + (e.message || 'Unknown error'), 'error');
      }
    }
}

function pollTranscript(tabId, btn) {
  let attempts = 0;
  const maxAttempts = 60;

  const interval = setInterval(async () => {
    attempts++;
    if (attempts >= maxAttempts) {
      clearInterval(interval);
      $('panel-overlay').style.display = 'none';
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';
      setStatus('Timed out waiting for transcript panel.', 'error');
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_TRANSCRIPT' });
      if (response && response.success && response.transcript) {
        clearInterval(interval);
        $('panel-ready').style.display = 'block';
        $('panel-waiting').style.display = 'none';
        $('panel-overlay').style.display = 'none';

        btn.innerHTML = '<span class="spinner spinner-sm"></span> Translating...';
        setStatus('Sending to Tafahom AI...', 'loading');

        const tab = await chrome.tabs.get(tabId);
        const result = await api.signTranslate(currentVideoInfo.url || tab.url, response.transcript);
        if (!result.success) {
          throw new Error(result.error || 'Translation failed');
        }

        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';

        clearStatus();
        showResult(result);
        await loadHistory();

        if (result.animations && result.animations.length > 0) {
          setTimeout(() => {
            avatarPlayer.play(result.animations);
          }, 800);
        }
      }
    } catch (e) {
      clearInterval(interval);
      $('panel-overlay').style.display = 'none';
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';
      setStatus('Transcript check failed: ' + (e.message || 'Unknown error'), 'error');
    }
  }, 2000);
}

function showResult(result) {
  lastResult = result;
  $('result-card').style.display = 'block';
  $('result-transcript').textContent = result.transcript || '';

  const glossEl = $('result-gloss');
  glossEl.innerHTML = '';
  if (result.gloss && result.gloss.length > 0) {
    result.gloss.forEach((word) => {
      const span = document.createElement('span');
      span.textContent = word;
      glossEl.appendChild(span);
    });
  }
}

async function loadHistory() {
  try {
    const data = await api.getHistory();
    const items = data.results || data || [];
    const listEl = $('history-list');
    $('history-count').textContent = items.length;

    if (items.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No translations yet</p>';
      return;
    }

    listEl.innerHTML = '';
    items.slice(0, 10).forEach((item) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <span class="history-item-title" title="${item.video_title || 'Untitled'}">${item.video_title || 'Untitled'}</span>
        <div class="history-item-meta">
          <span class="history-item-date">${item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
          <button class="history-item-btn" data-id="${item.id}">Play</button>
        </div>
      `;
      div.querySelector('.history-item-btn').addEventListener('click', async function () {
        try {
          const detail = await api.getTranslation(item.id);
          if (detail.animations) {
            showResult(detail);
            avatarPlayer.play(detail.animations);
          }
        } catch (e) {
          setStatus('Could not load translation.', 'error');
        }
      });
      listEl.appendChild(div);
    });
  } catch (e) {
    $('history-list').innerHTML = '<p class="empty-state">Could not load history</p>';
  }
}

function setupEventListeners() {
  $('translate-btn').addEventListener('click', handleTranslate);

  $('play-btn').addEventListener('click', function () {
    if (lastResult && lastResult.animations) {
      avatarPlayer.play(lastResult.animations);
    }
  });

  $('replay-btn').addEventListener('click', function () {
    if (lastResult && lastResult.animations) {
      avatarPlayer.replay(lastResult.animations);
    }
  });

  $('upgrade-btn').addEventListener('click', function () {
    chrome.tabs.create({ url: CONFIG.PRICING_URL });
  });

  $('nav-logout').addEventListener('click', async function () {
    await auth.logout();
    window.location.href = chrome.runtime.getURL('popup/popup.html');
  });
}

document.addEventListener('DOMContentLoaded', init);

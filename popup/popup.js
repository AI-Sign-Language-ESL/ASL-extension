let currentUser = null;
let currentVideo = { url: null, title: null };
let lastTranslation = null;
let regEmail = '';
let verifyEmail = '';

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
}

function showError(id, msg) {
  const el = $(id);
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

function hideError(id) {
  const el = $(id);
  if (el) el.classList.remove('show');
}

function showSuccess(id, msg) {
  const el = $(id);
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

function hideSuccess(id) {
  const el = $(id);
  if (el) el.classList.remove('show');
}

async function init() {
  showScreen('loading-screen');

  const session = await auth.getSession();
  if (session.token) {
    try {
      currentUser = await api.getMe();
      if (session.user) {
        currentUser = { ...session.user, ...currentUser };
      }
      await auth.saveSession({ user: currentUser });
      showDashboard();
    } catch (e) {
      if (e.status === 401) {
        await auth.clearSession();
        showScreen('login-screen');
      } else {
        currentUser = session.user;
        if (currentUser) {
          showDashboard();
        } else {
          showScreen('login-screen');
        }
      }
    }
  } else {
    showScreen('login-screen');
  }

  getVideoInfoFromTab();
  loadHistory();
}

async function getVideoInfoFromTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be/'))) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' }).catch(() => null);
      if (response) {
        currentVideo = { url: response.videoUrl, title: response.videoTitle };
        updateVideoDisplay();
        return;
      }
    }
    const bg = await chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA' }).catch(() => null);
    if (bg && bg.videoUrl) {
      currentVideo = { url: bg.videoUrl, title: bg.videoTitle };
      updateVideoDisplay();
    }
  } catch (e) {
  }
}

function updateVideoDisplay() {
  const el = $('video-title');
  const btn = $('translate-btn');
  if (currentVideo.title && currentVideo.title !== 'YouTube') {
    el.textContent = currentVideo.title;
    btn.disabled = false;
  } else {
    el.textContent = 'No YouTube video detected';
    btn.disabled = true;
  }
}

function showDashboard() {
  if (currentUser) {
    const name = currentUser.first_name || currentUser.email || 'User';
    $('user-name').textContent = name;
    $('user-avatar').textContent = name.charAt(0).toUpperCase();
    const tokens = currentUser.tokens !== undefined ? currentUser.tokens : currentUser.token_balance;
    $('token-count').textContent = tokens !== undefined ? tokens : '-';
  }
  showScreen('dashboard-screen');
  updateVideoDisplay();
}

$('translate-btn').addEventListener('click', async function () {
  const btn = this;
  if (btn.disabled) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showError('translation-status', 'Failed to communicate with active tab');
      return;
    }
    if (!tab.url || (!tab.url.includes('youtube.com/watch') && !tab.url.includes('youtu.be/'))) {
      showError('translation-status', 'Content script not injected. Please navigate to a YouTube video page.');
      return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Translating...';
    $('translation-status').innerHTML = '<div class="status-loading"><div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Extracting transcript...</div>';
    $('result-area').style.display = 'none';

    let msgResponse;
    try {
      msgResponse = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TRANSCRIPT' });
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';
      if (e.message && e.message.includes('Receiving end does not exist')) {
        showError('translation-status', 'Content script not injected. Please refresh the YouTube page and try again.');
      } else {
        showError('translation-status', 'Failed to communicate with content script: ' + (e.message || 'Unknown error'));
      }
      return;
    }

    if (!msgResponse || !msgResponse.success) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';

      if (msgResponse && msgResponse.requires_upload) {
        showError('translation-status', 'No transcript available. Please upload the video manually.');
      } else {
        showError('translation-status', msgResponse?.error || msgResponse?.message || 'Transcript extraction failed');
      }
      return;
    }

    $('translation-status').innerHTML = '<div class="status-loading"><div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Sending to Tafahom AI...</div>';

    try {
      const result = await api.signTranslate(currentVideo.url || tab.url, msgResponse.transcript);
      if (!result.success) {
        throw new Error(result.error || 'Translation failed');
      }

      lastTranslation = result;
      $('translation-status').innerHTML = '';
      showResult(result);

      if (result.animations && result.animations.length > 0) {
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
      }
    } catch (apiErr) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';
      showError('translation-status', 'Backend request failed: ' + (apiErr.message || 'Unknown error'));
      return;
    }
  } catch (e) {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Translate Video';
    showError('translation-status', e.message || 'Translation failed');
  }
});

function showResult(result) {
  $('result-area').style.display = 'block';
  const glossEl = $('result-gloss');
  glossEl.innerHTML = '';
  if (result.gloss && result.gloss.length > 0) {
    result.gloss.forEach((word) => {
      const span = document.createElement('span');
      span.textContent = word;
      glossEl.appendChild(span);
    });
  } else {
    glossEl.innerHTML = '<span class="text-muted" style="font-size:12px;">Translation complete</span>';
  }
}

$('replay-btn').addEventListener('click', function () {
  if (lastTranslation && lastTranslation.animations) {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  }
});

$('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError('login-error');
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const btn = $('login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const result = await auth.login(email, password);
    if (result.requires_2fa) {
      showError('login-error', '2FA is required. Please use the web app.');
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }
    currentUser = result.user;
    showDashboard();
    loadHistory();
  } catch (e) {
    showError('login-error', e.message || 'Login failed. Please check your credentials.');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

$('register-link').addEventListener('click', function (e) {
  e.preventDefault();
  hideError('register-error');
  hideSuccess('register-verify-info');
  showScreen('register-screen');
});

$('register-back').addEventListener('click', function () {
  showScreen('login-screen');
});

$('register-back-link').addEventListener('click', function (e) {
  e.preventDefault();
  showScreen('login-screen');
});

$('register-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError('register-error');
  const firstName = $('reg-first-name').value.trim();
  const lastName = $('reg-last-name').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  const confirm = $('reg-confirm').value;
  const btn = $('register-btn');

  if (password !== confirm) {
    showError('register-error', 'Passwords do not match.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const result = await auth.register({
      first_name: firstName,
      last_name: lastName,
      email: email,
      password: password,
    });

    if (result.needs_verification) {
      regEmail = email;
      showSuccess('register-verify-info', 'Account created! Please check your email for the verification code.');
      $('register-verify-info').style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Account';
      verifyEmail = email;
      showScreen('verify-screen');
    } else if (result.user) {
      currentUser = result.user;
      showDashboard();
      loadHistory();
    } else {
      showScreen('login-screen');
    }
  } catch (e) {
    const msg = e.data?.email?.[0] || e.data?.password?.[0] || e.data?.detail || e.message || 'Registration failed';
    showError('register-error', msg);
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});

$('verify-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError('verify-error');
  const code = $('verify-code').value.trim();
  const btn = $('verify-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const result = await auth.verifyEmail(verifyEmail, code);
    if (result.user) {
      currentUser = result.user;
      showDashboard();
      loadHistory();
    } else {
      showScreen('login-screen');
    }
  } catch (e) {
    showError('verify-error', e.data?.detail || e.message || 'Verification failed');
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
});

$('resend-code-btn').addEventListener('click', async function () {
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    await auth.resendCode(verifyEmail);
    btn.textContent = 'Code sent!';
    setTimeout(() => { btn.textContent = 'Resend Code'; btn.disabled = false; }, 3000);
  } catch (e) {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Resend Code'; btn.disabled = false; }, 3000);
  }
});

$('forgot-link').addEventListener('click', function (e) {
  e.preventDefault();
  hideError('forgot-error');
  hideSuccess('forgot-success');
  showScreen('forgot-screen');
});

$('forgot-back').addEventListener('click', function () {
  showScreen('login-screen');
});

$('forgot-back-link').addEventListener('click', function (e) {
  e.preventDefault();
  showScreen('login-screen');
});

$('forgot-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError('forgot-error');
  hideSuccess('forgot-success');
  const email = $('forgot-email').value.trim();
  const btn = $('forgot-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await auth.forgotPassword(email);
    showSuccess('forgot-success', 'Reset link sent! Check your email.');
    btn.textContent = 'Send Reset Link';
    btn.disabled = false;
  } catch (e) {
    showError('forgot-error', e.data?.detail || e.message || 'Failed to send reset link');
    btn.textContent = 'Send Reset Link';
    btn.disabled = false;
  }
});

$('logout-btn').addEventListener('click', async function () {
  await auth.logout();
  currentUser = null;
  lastTranslation = null;
  currentVideo = { url: null, title: null };
  $('result-area').style.display = 'none';
  $('translation-status').innerHTML = '';
  showScreen('login-screen');
});

$('open-dashboard-btn').addEventListener('click', function () {
  chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
});

async function loadHistory() {
  const listEl = $('history-list');
  const countEl = $('history-count');
  try {
    const data = await api.getHistory();
    const items = data.results || data || [];
    if (items.length === 0) {
      listEl.innerHTML = '<p class="text-muted" style="font-size:12px;text-align:center;padding:16px;">No translations yet</p>';
      countEl.textContent = '0';
      return;
    }
    countEl.textContent = items.length;
    listEl.innerHTML = '';
    items.slice(0, 5).forEach((item) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <span class="history-item-title">${item.video_title || 'Untitled'}</span>
        <span class="history-item-date">${item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</span>
        <button class="history-item-play" data-id="${item.id}">Play</button>
      `;
      div.querySelector('.history-item-play').addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
      });
      listEl.appendChild(div);
    });
  } catch (e) {
    listEl.innerHTML = '<p class="text-muted" style="font-size:12px;text-align:center;padding:16px;">Could not load history</p>';
    countEl.textContent = '-';
  }
}

document.addEventListener('DOMContentLoaded', init);

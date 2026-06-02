const CONFIG = {
  API_BASE_URL: 'https://api.tafahom.io/api/v1',
  UNITY_AVATAR_URL: 'https://tafahom.io/avatar-bridge.html',
  PRICING_URL: 'https://tafahom.io/pricing',
  FRONTEND_URL: 'https://tafahom.io',
};

const PUBLIC_ENDPOINTS = [
  '/authentication/login/',
  '/authentication/login/2fa/',
  '/authentication/login/google/',
  '/users/register/',
  '/authentication/password/reset/',
  '/authentication/password/reset/confirm/',
  '/authentication/verify-email/',
  '/authentication/resend-code/',
  '/authentication/token/refresh/',
];

class TafahomAPI {
  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL;
    this.isRefreshing = false;
    this.failedQueue = [];
  }

  async getTokens() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['token', 'refresh'], (result) => {
        resolve(result);
      });
    });
  }

  async setTokens(access, refresh) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ token: access, refresh: refresh || undefined }, resolve);
    });
  }

  async clearTokens() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['token', 'refresh', 'user'], resolve);
    });
  }

  async request(endpoint, options = {}) {
    const { token } = await this.getTokens();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    let response = await fetch(url, {
      ...options,
      headers,
    });

    const isPublic = PUBLIC_ENDPOINTS.some((ep) => endpoint.includes(ep));
    if (response.status === 401 && !isPublic) {
      const refreshed = await this._refreshToken();
      if (refreshed) {
        const { token: newToken } = await this.getTokens();
        headers.Authorization = `Bearer ${newToken}`;
        response = await fetch(url, {
          ...options,
          headers,
        });
      } else {
        await this.clearTokens();
        chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' });
        throw new Error('Session expired');
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.detail || errorData.error || errorData.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = errorData;
      throw error;
    }

    return response.json();
  }

  async _refreshToken() {
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;
    const { refresh } = await this.getTokens();

    if (!refresh) {
      this.isRefreshing = false;
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/authentication/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });

      if (!response.ok) {
        throw new Error('Refresh failed');
      }

      const data = await response.json();
      await this.setTokens(data.access, data.refresh || refresh);

      this.failedQueue.forEach((p) => p.resolve(data.access));
      this.failedQueue = [];
      return true;
    } catch (e) {
      this.failedQueue.forEach((p) => p.reject(e));
      this.failedQueue = [];
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  // ----- AUTH -----
  async login(email, password) {
    return this.request('/authentication/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async refreshToken() {
    const { refresh } = await this.getTokens();
    if (!refresh) throw new Error('No refresh token');
    return this.request('/authentication/token/refresh/', {
      method: 'POST',
      body: JSON.stringify({ refresh }),
    });
  }

  async logout() {
    const { token } = await this.getTokens();
    return this.request('/authentication/logout/', {
      method: 'POST',
      body: JSON.stringify({ refresh: (await this.getTokens()).refresh }),
    }).catch(() => ({}));
  }

  async register(data) {
    return this.request('/users/register/basic/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async forgotPassword(email) {
    return this.request('/authentication/password/reset/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token, newPassword, confirmPassword) {
    return this.request('/authentication/password/reset/confirm/', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword, confirm_password: confirmPassword }),
    });
  }

  async verifyEmail(email, code) {
    return this.request('/authentication/verify-email/', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
  }

  async resendCode(email) {
    return this.request('/authentication/resend-code/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  // ----- USER -----
  async getMe() {
    return this.request('/users/me/');
  }

  // ----- YOUTUBE -----
  async processTranscript(videoId, videoTitle, transcript) {
    return this.request('/youtube/process-transcript/', {
      method: 'POST',
      body: JSON.stringify({
        video_id: videoId,
        title: videoTitle,
        transcript: transcript,
      }),
    });
  }

  async signTranslate(videoUrl, transcript) {
    return this.request('/youtube/sign-translate/', {
      method: 'POST',
      body: JSON.stringify({
        url: videoUrl,
        video_url: videoUrl,
        transcript: transcript,
      }),
    });
  }

  async getHistory() {
    return this.request('/youtube/history/');
  }

  async getTranslation(id) {
    return this.request(`/youtube/${id}/`);
  }

  async deleteTranslation(id) {
    return this.request(`/youtube/${id}/`, { method: 'DELETE' });
  }

  // ----- BILLING -----
  async getPlans() {
    return this.request('/billing/plans/');
  }

  async getMyTokens() {
    return this.request('/billing/me/tokens/');
  }
}

const api = new TafahomAPI();

class TafahomAuth {
  async saveSession(data) {
    const payload = {};
    if (data.access) payload.token = data.access;
    if (data.token) payload.token = data.token;
    if (data.refresh) payload.refresh = data.refresh;
    if (data.user) payload.user = JSON.stringify(data.user);
    return new Promise((resolve) => {
      chrome.storage.local.set(payload, resolve);
    });
  }

  async getSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['token', 'refresh', 'user'], (result) => {
        resolve({
          token: result.token || null,
          refresh: result.refresh || null,
          user: result.user ? JSON.parse(result.user) : null,
        });
      });
    });
  }

  async clearSession() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['token', 'refresh', 'user'], resolve);
    });
  }

  async isAuthenticated() {
    const { token } = await this.getSession();
    return !!token;
  }

  async login(email, password) {
    const data = await api.login(email, password);

    if (data.requires_2fa) {
      return { requires_2fa: true, user_id: data.user_id, message: data.message };
    }

    await this.saveSession(data);

    if (data.user) {
      return { success: true, user: data.user };
    }

    const me = await api.getMe();
    await this.saveSession({ user: me });
    return { success: true, user: me };
  }

  async register(userData) {
    const data = await api.register(userData);

    if (data.access || data.token) {
      await this.saveSession(data);
    }

    if (data.user) {
      return { success: true, user: data.user, needs_verification: data.needs_verification || false };
    }

    if (data.needs_verification) {
      return { success: true, needs_verification: true, email: userData.email };
    }

    return { success: true, needs_verification: false };
  }

  async logout() {
    try {
      await api.logout();
    } catch (e) {
    }
    await this.clearSession();
  }

  async refreshToken() {
    const { refresh } = await this.getSession();
    if (!refresh) throw new Error('No refresh token');
    const data = await api.refreshToken();
    await this.saveSession({ access: data.access, refresh: data.refresh || refresh });
    return data.access;
  }

  async forgotPassword(email) {
    return api.forgotPassword(email);
  }

  async resetPassword(token, newPassword, confirmPassword) {
    return api.resetPassword(token, newPassword, confirmPassword);
  }

  async verifyEmail(email, code) {
    const data = await api.verifyEmail(email, code);
    if (data.access || data.token) {
      await this.saveSession(data);
    }
    if (data.user) {
      return { success: true, user: data.user };
    }
    return { success: true };
  }

  async resendCode(email) {
    return api.resendCode(email);
  }
}

const auth = new TafahomAuth();

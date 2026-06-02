import type { User, SessionData } from '../types';
import { logger } from '../utils/logger';

const STORAGE_KEYS = {
  token: 'tafahom_token',
  refresh: 'tafahom_refresh',
  user: 'tafahom_user',
};

class AuthService {
  async getSession(): Promise<SessionData> {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.token,
      STORAGE_KEYS.refresh,
      STORAGE_KEYS.user,
    ]);
    return {
      token: result[STORAGE_KEYS.token] ?? null,
      refresh: result[STORAGE_KEYS.refresh] ?? null,
      user: result[STORAGE_KEYS.user] ?? null,
    };
  }

  async saveSession(access: string, refresh?: string, user?: User): Promise<void> {
    const data: Record<string, unknown> = {};
    if (access) data[STORAGE_KEYS.token] = access;
    if (refresh) data[STORAGE_KEYS.refresh] = refresh;
    if (user) data[STORAGE_KEYS.user] = user;
    await chrome.storage.local.set(data);
  }

  async clearSession(): Promise<void> {
    await chrome.storage.local.remove([
      STORAGE_KEYS.token,
      STORAGE_KEYS.refresh,
      STORAGE_KEYS.user,
    ]);
  }

  async isAuthenticated(): Promise<boolean> {
    const { token } = await this.getSession();
    return !!token;
  }
}

export const authService = new AuthService();

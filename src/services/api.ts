import type { TranslationResult, User, TranscriptSegmentWithTimestamp, DetectedLanguage } from '../types';
import { authService } from './auth';
import { logger } from '../utils/logger';

const CONFIG = {
  API_BASE_URL: 'https://api.tafahom.io/api/v1',
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

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

class TafahomAPI {
  private baseUrl = CONFIG.API_BASE_URL;
  private isRefreshing = false;
  private failedQueue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];

  private async getToken(): Promise<string | null> {
    const session = await authService.getSession();
    return session.token;
  }

  async request<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    let response = await fetch(url, { ...options, headers });
    const isPublic = PUBLIC_ENDPOINTS.some((ep) => endpoint.includes(ep));
    if (response.status === 401 && !isPublic) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        const newToken = await this.getToken();
        if (newToken) headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(url, { ...options, headers });
      } else {
        await authService.clearSession();
        chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' });
        throw new ApiError('Session expired', 401);
      }
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg =
        (errorData as Record<string, unknown>).detail as string ||
        (errorData as Record<string, unknown>).error as string ||
        (errorData as Record<string, unknown>).message as string ||
        `HTTP ${response.status}`;
      throw new ApiError(msg, response.status, errorData);
    }
    return response.json() as Promise<T>;
  }

  private async refreshToken(): Promise<boolean> {
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({ resolve: (t: string) => resolve(true), reject });
      });
    }
    this.isRefreshing = true;
    const session = await authService.getSession();
    if (!session.refresh) {
      this.isRefreshing = false;
      return false;
    }
    try {
      const response = await fetch(`${this.baseUrl}/authentication/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: session.refresh }),
      });
      if (!response.ok) throw new Error('Refresh failed');
      const data = (await response.json()) as { access: string; refresh?: string };
      await authService.saveSession(data.access, data.refresh || session.refresh);
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

  async login(email: string, password: string): Promise<{ access: string; refresh?: string; user?: User }> {
    return this.request('/authentication/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(data: Record<string, string>): Promise<Record<string, unknown>> {
    return this.request('/users/register/basic/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMe(): Promise<User> {
    return this.request('/users/me/');
  }

  async submitTranslation(data: {
    video_id: string;
    title: string;
    transcript: string;
    segments?: { start: number; duration: number; text: string }[];
    language?: string;
  }): Promise<TranslationResult> {
    return this.request('/youtube/browser-transcript/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async processTranscript(data: {
    video_id: string;
    title: string;
    transcript: string;
    segments: { timestamp: string; text: string }[];
    source: string;
    language: string;
  }): Promise<TranslationResult> {
    return this.request('/youtube/process-transcript/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async fetchTranscript(videoId: string): Promise<{
    success: boolean;
    transcript: string;
    segments: { start: number; duration: number; text: string }[];
    source: string;
    duration: number;
    error?: string;
  }> {
    return this.request('/youtube/transcript/fetch/', {
      method: 'POST',
      body: JSON.stringify({ video_id: videoId }),
    });
  }

  async getHistory(): Promise<unknown[]> {
    return this.request('/youtube/history/');
  }

  async getPlans(): Promise<unknown[]> {
    return this.request('/billing/plans/');
  }
}

export const api = new TafahomAPI();
